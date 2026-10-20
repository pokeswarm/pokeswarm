import type { World } from '../sim/world';
import { elapsedSeconds } from '../sim/world';
import { addStat, maxStat } from './saveData';
import type { SaveStore } from './saveStore';

/**
 * ラン中の記録をセーブデータに足す（01_game_design.md 8.2）。
 * 出来事（撃破・進化・派生など）を observe で数えるだけにして、数分ごと（commit）とラン終了時（finish）に
 * まとめて足す（Firestore の書き込みを増やさない）。足した分は消すので、同じ分を2回足さない。
 *
 * 記録の名前（data/game/achievements.json・unlocks.json の条件で使う）:
 *   kills, defeated.<ポケモン>, midbossKills, bossKills, legendaryKills, evolutions, evolvedTo.<ポケモン>,
 *   derivations, derived.<技>, uniqueMoves, playSeconds,
 *   runs, runs.<ポケモン>, clears, clears.<ポケモン>, clears.solo, clears.coop,
 *   bestKills, bestLevel, longestSeconds（最高記録）
 * 協力プレイ（03_network.md 3.6）: 雑魚はとどめを刺した人だけ、中ボス・ボスは参加者全員に数える。
 */
export class RunRecorder {
  private readonly pending = new Map<string, number>();
  private seconds = 0;
  /** このランで自分が倒した数（最高記録に使う） */
  private runKills = 0;
  private finished = false;

  constructor(
    private readonly store: SaveStore,
    /** 使ったポケモン（data/game/playables.json のキー） */
    private readonly pokemon: string,
  ) {}

  private count(key: string, n = 1): void {
    this.pending.set(key, (this.pending.get(key) ?? 0) + n);
  }

  /** 1回の更新の後に呼び、その更新の出来事を数える */
  observe(world: World): void {
    if (this.finished) return;
    const me = world.localPlayerId;
    for (const ev of world.events) {
      switch (ev.type) {
        case 'enemyKilled': {
          const kind = world.rules.enemies.kinds[ev.kind];
          if (!kind) break;
          const rank = kind.rank ?? 'normal';
          const species = kind.species ?? kind.id;
          // 雑魚は自分がとどめを刺したときだけ、中ボス・ボスは全員に数える
          if (rank === 'normal' && ev.by !== me) break;
          if (ev.by === me) {
            this.count('kills');
            this.runKills++;
          }
          this.count(`defeated.${species}`);
          if (rank === 'midboss') this.count('midbossKills');
          if (rank === 'boss') this.count('bossKills');
          if (rank === 'legendary') this.count('legendaryKills');
          break;
        }
        case 'evolved':
          if (ev.playerId !== me) break;
          this.count('evolutions');
          this.count(`evolvedTo.${world.rules.species[ev.to]?.key ?? ev.to}`);
          break;
        case 'upgradeChosen':
          if (ev.playerId !== me || ev.offer.kind !== 'derive') break;
          this.count('derivations');
          this.count(`derived.${world.rules.moves[ev.offer.to]?.key ?? ev.offer.to}`);
          if (ev.offer.unique) this.count('uniqueMoves');
          break;
        default:
          break;
      }
    }
  }

  /** ここまでに数えた分と遊んだ時間をセーブデータに足す（足すものが無ければ何もしない） */
  commit(world: World): void {
    if (this.finished) return;
    const seconds = Math.floor(elapsedSeconds(world)) - this.seconds;
    if (seconds > 0) {
      this.count('playSeconds', seconds);
      this.seconds += seconds;
    }
    if (this.pending.size === 0) return;
    const add = [...this.pending];
    this.pending.clear();
    this.store.update((d) => {
      for (const [key, n] of add) addStat(d, key, n);
    });
  }

  /** ラン終了時: 残りを足し、回数・クリア・最高記録を記録する */
  finish(world: World): void {
    if (this.finished) return;
    const clear = world.outcome === 'clear';
    this.count('runs');
    this.count(`runs.${this.pokemon}`);
    if (clear) {
      this.count('clears');
      this.count(`clears.${this.pokemon}`);
      this.count(world.role === 'solo' ? 'clears.solo' : 'clears.coop');
    }
    this.commit(world);
    this.finished = true;
    this.store.update((d) => {
      maxStat(d, 'bestKills', this.runKills);
      maxStat(d, 'bestLevel', world.level);
      maxStat(d, 'longestSeconds', Math.floor(elapsedSeconds(world)));
    });
  }
}
