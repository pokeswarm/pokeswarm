import { audio } from '../audio';
import { generated } from '../data';
import { localName } from '../data/simRules';
import { getLocale, t, tMaybe } from '../i18n';
import { compactScreen, windowCss } from '../render/pixelUi';
import { contestScore, type ContestEntrant, type ContestState } from '../sim/contest';
import type { ContestCommand } from '../sim/commands';
import { hash01 } from '../sim/math';
import type { World } from '../sim/world';
import { ContestStage } from './contestStage';

/** 本人のセーブから決まる、その部門で出られるランク（RunScene が渡す） */
export type ContestRankOf = (category: string) => number;

/**
 * ポケモンコンテストの画面（ホウエン。07 の188・192章）:
 * リーグかコンテストかを選ぶ → 部門と技を2個選ぶ → 舞台で一次審査・二次審査（観客の空気を見てアピール）→ 順位とコイン
 */
export class ContestPanel {
  /** 画面全体を覆う幕（後ろのマップを見せない） */
  private readonly shade: HTMLDivElement;
  private readonly root: HTMLDivElement;
  private readonly stage = new ContestStage();
  private readonly status: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private shown = '';
  private category: string | null = null;
  private moves: number[] = [];
  /** 自分の番が始まった時刻（針の動き） */
  private turnStart = 0;
  private turnKey = '';
  private soundKey = '';
  /** 今の針の値（自分の番だけ） */
  private gauge: number | null = null;
  private readonly onKey = (e: KeyboardEvent): void => {
    if ((e.key === ' ' || e.key === 'Enter') && this.gauge !== null) {
      e.preventDefault();
      this.press();
    }
  };

  constructor(
    private readonly send: (cmd: DistributiveOmit<ContestCommand, 'playerId'>) => void,
    private readonly rankOf: ContestRankOf,
    private readonly speciesKeyOf: (world: World, playerId: number) => string,
  ) {
    this.shade = document.createElement('div');
    this.shade.style.cssText = 'position:fixed;inset:0;background:#140c24;z-index:24;display:none;align-items:center;justify-content:center';
    this.root = document.createElement('div');
    this.root.style.cssText = `width:min(760px,96vw,max(340px,calc((100vh - 170px) * 16 / 9)));max-height:98vh;overflow:auto;${windowCss('dark')};padding:${compactScreen() ? '6px 10px' : '14px 18px'};font-size:16px;line-height:1.5;box-sizing:border-box;display:flex;flex-direction:column;gap:8px`;
    this.status = document.createElement('div');
    this.status.style.cssText = 'min-height:3em;text-align:center';
    this.body = document.createElement('div');
    this.body.style.cssText = 'display:flex;flex-direction:column;gap:8px';
    this.root.append(this.stage.canvas, this.status, this.body);
    this.stage.canvas.addEventListener('pointerdown', () => {
      if (this.gauge !== null) this.press();
    });
    document.addEventListener('keydown', this.onKey);
    this.shade.append(this.root);
    document.body.appendChild(this.shade);
  }

  /** 毎フレーム呼ぶ。舞台は毎回描き、ボタンは状態が変わったときだけ作り直す */
  update(world: World, localId: number): void {
    const c = world.contest;
    if (!c || world.levelUp || world.outcome) {
      this.shade.style.display = 'none';
      this.shown = '';
      this.gauge = null;
      return;
    }
    const now = performance.now();
    const onStage = c.phase === 'primary' || c.phase === 'appeal' || c.phase === 'result';
    const mine = c.phase === 'appeal' && !c.shown && c.entrants[c.turn]?.playerId === localId;
    const key = `${c.phase}:${c.answers.has(localId)}:${c.entries.has(localId)}:${this.category}:${this.moves.join()}:${c.round}:${c.turn}:${c.shown}:${c.fast}`;
    if (key !== this.shown) {
      this.shown = key;
      this.shade.style.display = 'flex';
      this.body.replaceChildren();
      this.status.replaceChildren();
      this.stage.canvas.style.display = c.phase === 'entry' ? 'none' : 'block';
      this.status.style.display = onStage ? 'block' : 'none';
      if (c.phase === 'branch') this.drawBranch(world, c, localId);
      else if (c.phase === 'entry') this.drawEntry(world, c, localId);
      else if (c.phase === 'result') this.drawResult(world, c, localId);
      else this.drawPerformance(world, c, mine);
    }
    this.playSounds(world, c, localId);
    if (c.phase === 'entry') return;
    if (mine) {
      const tk = `${c.round}:${c.turn}`;
      if (tk !== this.turnKey) {
        this.turnKey = tk;
        this.turnStart = now;
      }
      const timing = world.rules.contest!.timing;
      // 高まる速さは番ごとに変わる（画面だけの値。シードから決める）
      const period = timing.periodMin + (timing.periodMax - timing.periodMin) * hash01(world.seed, c.turn, c.round, 0xa17);
      this.gauge = ContestStage.airAt((now - this.turnStart) / 1000, period, timing.riseShare);
    } else this.gauge = null;
    this.stage.draw(world, c, (id) => this.speciesKeyOf(world, id), this.gauge, now);
  }

  hide(): void {
    document.removeEventListener('keydown', this.onKey);
    this.shade.remove();
  }

  private press(): void {
    if (this.gauge === null) return;
    audio.sfx.play('ui.confirm');
    this.send({ op: 'appeal', gauge: this.gauge });
    this.gauge = null;
  }

  private playSounds(world: World, c: ContestState, localId: number): void {
    const key = `${c.phase}:${c.round}:${c.turn}:${c.shown}`;
    if (key === this.soundKey) return;
    this.soundKey = key;
    if (c.phase === 'appeal' && c.shown && c.lastAppeal) {
      if (c.lastAppeal.cheer) audio.sfx.play('levelUp');
      else if (c.lastAppeal.move !== null) {
        const type = world.rules.types.names[world.rules.moves[c.lastAppeal.move]?.type ?? -1];
        audio.sfx.play(`move.${type ?? 'normal'}`);
      }
    } else if (c.phase === 'result') audio.sfx.play(c.results?.[0]?.playerId === localId ? 'clear' : 'section');
  }

  private line(text: string, css = '', parent: HTMLElement = this.body): HTMLDivElement {
    const d = document.createElement('div');
    d.style.cssText = css;
    d.textContent = text;
    parent.append(d);
    return d;
  }

  private button(text: string, onClick: () => void, on = false, parent: HTMLElement = this.body): HTMLButtonElement {
    const b = document.createElement('button');
    b.style.cssText = `${windowCss('light')};min-height:44px;padding:6px 12px;cursor:pointer;font:inherit;font-size:16px;${on ? 'outline:3px solid #f8d030' : ''}`;
    b.textContent = text;
    b.onclick = onClick;
    parent.append(b);
    return b;
  }

  private moveName(world: World, move: number | null | undefined): string {
    const def = move === null || move === undefined ? undefined : world.rules.moves[move];
    return def ? localName(generated.moves[def.key]?.names, getLocale(), def.key) : '';
  }

  private entrantName(world: World, e: Pick<ContestEntrant, 'playerId' | 'npc'>): string {
    const p = world.players.find((q) => q.id === e.playerId);
    return p ? localName(generated.pokemon[world.rules.species[p.species]?.key ?? '']?.names, getLocale(), '') : t('contest.npc', { pokemon: localName(generated.pokemon[e.npc ?? '']?.names, getLocale(), '') });
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
      const order = this.moves.indexOf(pm.move);
      this.button(`${order >= 0 ? `${order + 1}. ` : ''}${this.moveName(world, pm.move)}（${type}）`, () => {
        this.moves = this.moves.includes(pm.move) ? this.moves.filter((m) => m !== pm.move) : [...this.moves, pm.move].slice(-2);
        this.shown = '';
      }, order >= 0);
    }
    const want = Math.min(2, me.moves.length);
    if (this.category && this.moves.length === want) {
      this.line(t('contest.score', { n: contestScore(world, me, { category: this.category, moves: this.moves }) }));
      const category = this.category;
      this.button(t('contest.enter'), () => this.send({ op: 'entry', category, moves: this.moves, rank: this.rankOf(category) }));
    }
  }

  private drawPerformance(world: World, c: ContestState, mine: boolean): void {
    const e = c.entrants[c.turn];
    if (c.phase === 'primary') {
      this.line(t('contest.primary'), 'font-size:20px', this.status);
      this.line(t('contest.primaryNote'), '', this.status);
    } else if (e) {
      this.line(t('contest.appeal', { n: c.round + 1 }), 'font-size:20px', this.status);
      if (mine) {
        const move = e.moves.length ? e.moves[c.round % e.moves.length] : null;
        this.line(t('contest.yourTurn', { move: this.moveName(world, move) }), 'color:#f8d030', this.status);
        const b = this.button(t('contest.appealButton'), () => this.press());
        b.style.minHeight = '56px';
        b.style.fontSize = '20px';
      } else if (c.shown && c.lastAppeal) {
        const name = this.entrantName(world, e);
        const a = c.lastAppeal;
        this.line(a.move !== null ? t('contest.appealLine', { name, move: this.moveName(world, a.move) }) : name, '', this.status);
        this.line(a.cheer ? t('contest.cheer', { n: a.points }) : t(`contest.rating.${a.rating}`, { n: a.points }), a.cheer || a.rating === 'great' ? 'color:#ff8fb0;font-size:20px' : 'color:#ffd54f', this.status);
      } else this.line(t('contest.watch', { name: this.entrantName(world, e) }), '', this.status);
    }
    if (world.role !== 'guest' && !c.fast && !mine) this.button(t('contest.fast'), () => this.send({ op: 'fast' }));
  }

  private drawResult(world: World, c: ContestState, localId: number): void {
    const cfg = world.rules.contest!;
    this.line(t('contest.resultTitle', { rank: tMaybe(`contest.rank.${cfg.ranks[c.rank]!.id}`) }), 'font-size:20px', this.status);
    for (const r of c.results ?? []) {
      this.line(t('contest.resultRow', { place: r.place, name: this.entrantName(world, r), score: r.score, coins: r.coins }), r.playerId === localId ? 'color:#f8d030' : '', this.status);
    }
    if (world.role === 'guest') this.line(t('contest.waitingHost'), 'opacity:0.75');
    else this.button(t('contest.finish'), () => this.send({ op: 'finish' }));
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
