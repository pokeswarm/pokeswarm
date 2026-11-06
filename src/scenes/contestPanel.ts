import { audio } from '../audio';
import { generated } from '../data';
import { localName } from '../data/simRules';
import { getLocale, t, tMaybe } from '../i18n';
import { compactScreen, windowCss } from '../render/pixelUi';
import { crowdAir, primaryScore, type ContestEntrant, type ContestState } from '../sim/contest';
import type { ContestCommand } from '../sim/commands';
import type { World } from '../sim/world';
import { ContestStage } from './contestStage';

/** 本人のセーブから決まる、その部門で出られるランク（RunScene が渡す） */
export type ContestRankOf = (category: string) => number;

/**
 * ポケモンコンテストの画面（ホウエン。07 の188・192章）:
 * リーグかコンテストかを選ぶ → 部門と技を2個選ぶ → 舞台で制限時間の間、観客を見て好きなときに技を出す → 順位とコイン（07 の230章）
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
  private soundKey = '';
  /** 舞台の人ごとの、音を鳴らし終えた技の数 */
  private heard = new Map<number, number>();
  /** 今の観客の盛り上がり（自分が技を出せるときだけ。出せないときは null） */
  private gauge: number | null = null;
  /** 技を出すボタンと、残り時間の文字（毎フレーム直す） */
  private pressButton: HTMLButtonElement | null = null;
  private timeLine: HTMLDivElement | null = null;
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    if (this.pressButton) e.preventDefault();
    if (this.gauge !== null) this.press();
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
    const onStage = c.phase === 'appeal' || c.phase === 'result';
    const me = c.entrants.find((e) => e.playerId === localId);
    const key = `${c.phase}:${c.answers.has(localId)}:${c.entries.has(localId)}:${this.category}:${this.moves.join()}:${me?.appeals.length ?? 0}`;
    if (key !== this.shown) {
      this.shown = key;
      this.shade.style.display = 'flex';
      this.body.replaceChildren();
      this.status.replaceChildren();
      this.pressButton = null;
      this.timeLine = null;
      this.stage.canvas.style.display = c.phase === 'entry' ? 'none' : 'block';
      this.status.style.display = onStage ? 'block' : 'none';
      if (c.phase === 'branch') this.drawBranch(world, c, localId);
      else if (c.phase === 'entry') this.drawEntry(world, c, localId);
      else if (c.phase === 'result') this.drawResult(world, c, localId);
      else this.drawPerformance(world, me);
    }
    this.playSounds(world, c, localId);
    if (c.phase === 'entry') return;
    const air = c.phase === 'appeal' ? crowdAir(world.rules.contest!.timing, world.seed, c.elapsed * world.dt) : null;
    const ready = c.phase === 'appeal' && !!me && c.elapsed >= me.readyAt;
    this.gauge = ready ? air : null;
    if (this.pressButton) {
      // 次の技を出せるまでは押せない
      this.pressButton.disabled = !ready;
      this.pressButton.style.opacity = ready ? '1' : '0.45';
    }
    if (this.timeLine) this.timeLine.textContent = t('contest.timeLeft', { n: Math.ceil(c.ticksLeft * world.dt) });
    this.stage.draw(world, c, (id) => this.speciesKeyOf(world, id), localId, air, now);
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
    c.entrants.forEach((e, k) => {
      if ((this.heard.get(k) ?? 0) === e.appeals.length) return;
      this.heard.set(k, e.appeals.length);
      if (e.last?.move === null || !e.last) return;
      const type = world.rules.types.names[world.rules.moves[e.last.move]?.type ?? -1];
      audio.sfx.play(`move.${type ?? 'normal'}`);
    });
    if (c.phase === this.soundKey) return;
    this.soundKey = c.phase;
    if (c.phase === 'result') audio.sfx.play(c.results?.[0]?.playerId === localId ? 'clear' : 'section');
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
      this.line(t('contest.score', { n: primaryScore(world, me, this.category) }));
      const category = this.category;
      this.button(t('contest.enter'), () => this.send({ op: 'entry', category, moves: this.moves, rank: this.rankOf(category) }));
    }
  }

  private drawPerformance(world: World, me: ContestEntrant | undefined): void {
    this.line(t('contest.perform'), 'font-size:20px', this.status);
    this.timeLine = this.line('', 'color:#f8d030', this.status);
    // 1 回ごとの評価と点だけ見せる。合計は結果まで見せない
    const a = me?.last;
    if (a) this.line(t(`contest.rating.${a.rating}`, { n: a.points }), a.rating === 'great' ? 'color:#ff8fb0;font-size:20px' : 'color:#ffd54f', this.status);
    else this.line(t('contest.performNote'), '', this.status);
    if (!me) return;
    const move = me.moves.length ? me.moves[me.appeals.length % me.moves.length] : null;
    const b = this.button(t('contest.appealMove', { move: this.moveName(world, move) }), () => this.press());
    b.style.minHeight = '56px';
    b.style.fontSize = '20px';
    this.pressButton = b;
  }

  private drawResult(world: World, c: ContestState, localId: number): void {
    const cfg = world.rules.contest!;
    this.line(t('contest.resultTitle', { rank: tMaybe(`contest.rank.${cfg.ranks[c.rank]!.id}`) }), 'font-size:20px', this.status);
    for (const r of c.results ?? []) {
      const color = r.playerId === localId ? 'color:#f8d030' : '';
      this.line(t('contest.resultRow', { place: r.place, name: this.entrantName(world, r), score: r.score, coins: r.coins }), color, this.status);
      this.line(t('contest.resultDetail', { status: r.status, performance: r.performance }), `${color};font-size:13px;opacity:0.8`, this.status);
    }
    if (world.role === 'guest') this.line(t('contest.waitingHost'), 'opacity:0.75');
    else this.button(t('contest.finish'), () => this.send({ op: 'finish' }));
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
