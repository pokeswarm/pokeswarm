import { generated } from '../data';
import { localName } from '../data/simRules';
import { getLocale, t, tMaybe } from '../i18n';
import { compactScreen, windowCss } from '../render/pixelUi';
import { contestScore, type ContestState } from '../sim/contest';
import type { ContestCommand } from '../sim/commands';
import type { World } from '../sim/world';

/** 本人のセーブから決まる、その部門で出られるランク（RunScene が渡す） */
export type ContestRankOf = (category: string) => number;

/**
 * ポケモンコンテストの画面（ホウエン。07 の188章。作り込みは後で。今は骨組み）:
 * リーグかコンテストかを選ぶ → 部門と技を2個選ぶ → 順位とコイン
 */
export class ContestPanel {
  private readonly root: HTMLDivElement;
  private shown = '';
  private category: string | null = null;
  private moves: number[] = [];

  constructor(
    private readonly send: (cmd: DistributiveOmit<ContestCommand, 'playerId'>) => void,
    private readonly rankOf: ContestRankOf,
  ) {
    this.root = document.createElement('div');
    this.root.style.cssText = `position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,94vw);max-height:96vh;overflow:auto;${windowCss('dark')};padding:${compactScreen() ? '8px 12px' : '18px 22px'};font-size:16px;line-height:1.5;box-sizing:border-box;z-index:24;display:none;flex-direction:column;gap:10px`;
    document.body.appendChild(this.root);
  }

  /** 毎フレーム呼ぶ。状態が変わったときだけ作り直す */
  update(world: World, localId: number): void {
    const c = world.contest;
    if (!c || world.levelUp || world.outcome) {
      this.root.style.display = 'none';
      this.shown = '';
      return;
    }
    const key = `${c.phase}:${c.answers.has(localId)}:${c.entries.has(localId)}:${this.category}:${this.moves.join()}`;
    if (key === this.shown) return;
    this.shown = key;
    this.root.style.display = 'flex';
    this.root.replaceChildren();
    if (c.phase === 'branch') this.drawBranch(world, c, localId);
    else if (c.phase === 'entry') this.drawEntry(world, c, localId);
    else this.drawResult(world, c, localId);
  }

  hide(): void {
    this.root.remove();
  }

  private line(text: string, css = ''): HTMLDivElement {
    const d = document.createElement('div');
    d.style.cssText = css;
    d.textContent = text;
    this.root.append(d);
    return d;
  }

  private button(text: string, onClick: () => void, on = false, parent: HTMLElement = this.root): HTMLButtonElement {
    const b = document.createElement('button');
    b.style.cssText = `${windowCss('light')};min-height:44px;padding:6px 12px;cursor:pointer;font:inherit;font-size:16px;${on ? 'outline:3px solid #f8d030' : ''}`;
    b.textContent = text;
    b.onclick = onClick;
    parent.append(b);
    return b;
  }

  private drawBranch(world: World, c: ContestState, localId: number): void {
    this.line(t('contest.title'), 'font-size:22px');
    this.line(t('contest.branchNote'));
    if (c.answers.has(localId)) {
      this.line(t('contest.waiting'));
      return;
    }
    this.button(t('contest.goContest'), () => this.send({ op: 'answer', go: true }));
    this.button(t('contest.goLeague'), () => this.send({ op: 'answer', go: false }));
    if (world.players.length > 1) this.line(t('contest.coopNote'), 'opacity:0.75');
  }

  private drawEntry(world: World, c: ContestState, localId: number): void {
    const me = world.players.find((p) => p.id === localId);
    if (!me) return;
    this.line(t('contest.title'), 'font-size:22px');
    if (c.entries.has(localId)) {
      this.line(t('contest.waiting'));
      return;
    }
    const cfg = world.rules.contest!;
    this.line(t('contest.moveUps', { n: me.moveUps ?? 0 }));
    this.line(t('contest.chooseCategory'), 'opacity:0.75');
    for (const cat of cfg.categories) {
      this.button(t('contest.categoryRow', { name: tMaybe(`contest.category.${cat}`), n: me.pokeblocks?.[cat] ?? 0, rank: tMaybe(`contest.rank.${cfg.ranks[Math.min(cfg.ranks.length - 1, this.rankOf(cat))]!.id}`) }), () => {
        this.category = cat;
        this.shown = '';
      }, this.category === cat);
    }
    this.line(t('contest.chooseMoves'), 'opacity:0.75');
    for (const pm of me.moves) {
      const def = world.rules.moves[pm.move]!;
      const type = def.contestType ? tMaybe(`contest.category.${def.contestType}`) : '-';
      this.button(`${localName(generated.moves[def.key]?.names, getLocale(), def.key)}（${type}）`, () => {
        this.moves = this.moves.includes(pm.move) ? this.moves.filter((m) => m !== pm.move) : [...this.moves, pm.move].slice(-2);
        this.shown = '';
      }, this.moves.includes(pm.move));
    }
    const want = Math.min(2, me.moves.length);
    if (this.category && this.moves.length === want) {
      this.line(t('contest.score', { n: contestScore(world, me, { category: this.category, moves: this.moves }) }));
      const category = this.category;
      this.button(t('contest.enter'), () => this.send({ op: 'entry', category, moves: this.moves, rank: this.rankOf(category) }));
    }
  }

  private drawResult(world: World, c: ContestState, localId: number): void {
    const cfg = world.rules.contest!;
    this.line(t('contest.resultTitle', { rank: tMaybe(`contest.rank.${cfg.ranks[c.rank]!.id}`) }), 'font-size:22px');
    for (const r of c.results ?? []) {
      const p = world.players.find((q) => q.id === r.playerId);
      const name = p
        ? localName(generated.pokemon[world.rules.species[p.species]?.key ?? '']?.names, getLocale(), '')
        : t('contest.npc', { pokemon: localName(generated.pokemon[r.npc ?? '']?.names, getLocale(), '') });
      this.line(t('contest.resultRow', { place: r.place, name, score: r.score, coins: r.coins }), r.playerId === localId ? 'color:#f8d030' : '');
    }
    if (world.role === 'guest') this.line(t('contest.waitingHost'), 'opacity:0.75');
    else this.button(t('contest.finish'), () => this.send({ op: 'finish' }));
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
