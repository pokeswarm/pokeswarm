import type { PlayerId } from '../sim/commands';
import { currentWaveIndex, type World } from '../sim/world';
import type { BgmRun } from '../data/schema';
import { audio } from '.';

/** 経験値の玉を続けて拾ったとみなす間隔（ミリ秒）と、上げる音の高さの上限（半音） */
const GEM_STREAK_MS = 600;
const GEM_STREAK_MAX = 12;
/** ふしぎなアメなどで続けてレベルが上がったときの、音の間隔（秒） */
const LEVEL_UP_GAP = 0.14;

/**
 * ランの出来事に合わせて効果音と BGM を鳴らす（07_content_draft.md 14章）。
 * 技を使う音・ダメージ・拾う音は自分のぶんだけ。ボス・区間・ランの終わりは全員に鳴らす。
 */
export class RunSounds {
  private gemStreak = 0;
  private lastGemAt = 0;
  private section = -1;
  private legendary = false;
  /** 伝説が乱入した（三犬）。出ている間は乱入の曲 */
  private intruder = false;
  private intruderAlive = true;
  private intruderSince = 0;

  constructor(
    private readonly localId: PlayerId,
    /** その地方のランの曲（data/regions/<地方>.json） */
    private readonly bgmRun: BgmRun,
  ) {}

  /** 更新のたびに、その更新の出来事を見て鳴らす */
  onEvents(world: World): void {
    let levelUps = 0;
    for (const ev of world.events) {
      switch (ev.type) {
        case 'moveUsed':
          if (ev.playerId === this.localId) {
            const type = world.rules.types.names[world.rules.moves[ev.move]!.type] ?? 'normal';
            audio.sfx.play(`move.${type}`);
          }
          break;
        case 'projectileHit':
          if (ev.owner === this.localId) audio.sfx.play('hit');
          break;
        case 'enemyKilled': {
          const rank = world.rules.enemies.kinds[ev.kind]?.rank ?? 'normal';
          if (rank !== 'normal') audio.sfx.play('boss.defeat');
          else if (ev.by === this.localId) audio.sfx.play('kill');
          break;
        }
        case 'gemCollected':
          if (ev.by === this.localId) this.playGem();
          break;
        case 'levelUp':
          audio.sfx.play('levelUp', { delay: levelUps++ * LEVEL_UP_GAP });
          break;
        case 'evolved':
          audio.sfx.play('evolve');
          break;
        case 'itemCollected':
          if (ev.kind === 'potion' && ev.by === this.localId) audio.sfx.play('item.potion');
          else if (ev.kind === 'magnet') audio.sfx.play('item.magnet');
          else if (ev.kind === 'buff' && ev.by === this.localId) audio.sfx.play('levelUp');
          break;
        case 'playerFrozen':
          if (ev.playerId === this.localId) audio.sfx.play('down');
          break;
        case 'boxRemoved':
          if (ev.opened) audio.sfx.play('candy.hit');
          break;
        case 'bossAppeared':
          audio.sfx.play('boss.appear');
          break;
        case 'sectionAdvanced':
          audio.sfx.play('section');
          break;
        case 'hazardTelegraphed':
          audio.sfx.play('warn');
          break;
        case 'hazardStruck':
          audio.sfx.play('explosion');
          break;
        case 'playerDamaged':
          if (ev.playerId === this.localId) audio.sfx.play('hurt');
          break;
        case 'playerDown':
          if (ev.playerId === this.localId) audio.sfx.play('down');
          break;
        case 'playerRevived':
          audio.sfx.play('revive');
          break;
        case 'legendaryWarning':
          audio.sfx.play('danger');
          this.legendary = true;
          break;
        case 'intruderWarning':
          audio.sfx.play('danger');
          this.intruder = true;
          this.intruderSince = world.tick;
          break;
        case 'upgradeChosen':
          if (ev.playerId === this.localId) audio.sfx.play('ui.confirm');
          break;
        case 'runEnded':
          audio.sfx.play(ev.outcome === 'clear' ? 'clear' : 'fail');
          audio.bgm.play(null);
          break;
      }
    }
    this.updateBgm(world);
  }

  /** 区間ごとの曲（伝説戦は伝説の曲）。ランが終わったら止める */
  private updateBgm(world: World): void {
    if (world.outcome) return;
    if (this.legendary || world.legendary) {
      // 続けて戦うラウンド（レッド戦）は、ラウンドの曲
      audio.bgm.play((world.legendary && legendRoundBgm(world, world.legendary.kind)) || this.bgmRun.legendary);
      return;
    }
    // 伝説の乱入（三犬）: 乱入した伝説が出ている間は乱入の曲（いなくなったら区間の曲へ戻す）
    if (this.intruder && this.bgmRun.intruder) {
      if (world.tick % 15 === 0) this.intruderAlive = intruderPresent(world, this.intruderSince);
      if (this.intruderAlive) {
        audio.bgm.play(this.bgmRun.intruder);
        this.section = -1;
        return;
      }
      this.intruder = false;
    }
    const section = currentWaveIndex(world);
    if (section === this.section) return;
    this.section = section;
    audio.bgm.play(this.bgmRun.sections[section] ?? null);
  }

  /** 経験値の玉: 続けて拾うと少しずつ音が上がる */
  private playGem(): void {
    const now = performance.now();
    this.gemStreak = now - this.lastGemAt < GEM_STREAK_MS ? Math.min(GEM_STREAK_MAX, this.gemStreak + 1) : 0;
    this.lastGemAt = now;
    audio.sfx.play('gem', { semitones: this.gemStreak });
  }
}

/** 乱入する伝説（三犬）が出ているか。知らせ（since）から出てくるまでの「DANGER」の間も true */
function intruderPresent(world: World, since: number): boolean {
  const lg = world.rules.stage.legendary;
  if (world.intruder && !world.intruder.done) return true;
  if (world.tick - since <= Math.round(((lg?.warningSeconds ?? 0) + 2) / world.dt)) return true;
  const ids = lg?.intruders?.kinds ?? [];
  const e = world.enemies;
  for (let i = 0; i < e.count; i++) if (e.hp[i]! > 0 && ids.includes(world.rules.enemies.kinds[e.kind[i]!]?.id ?? '')) return true;
  return false;
}

/** 伝説戦のラウンドの曲（data/regions の legendary.rounds・bonusRounds の bgm）。無ければ null */
function legendRoundBgm(world: World, kind: number): string | null {
  const lg = world.rules.stage.legendary;
  const id = world.rules.enemies.kinds[kind]?.id ?? '';
  return [...(lg?.rounds ?? []), ...(lg?.bonusRounds ?? [])].find((r) => r.kinds.includes(id))?.bgm ?? null;
}
