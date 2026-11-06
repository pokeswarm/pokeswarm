import type { ContestConfig } from '../data/schema';
import type { ContestCommand, PlayerId } from './commands';
import type { Player } from './entities/player';
import { hash01 } from './math';
import { endRun } from './systems/stage';
import type { World } from './world';

/**
 * ポケモンコンテスト（ホウエン。07 の188・230章）: リーグの代わりにコンテストへ進む、もう1つの終わり方。
 * 最大4人（足りない分は NPC）が舞台に立ち、制限時間の間、全員が同時に好きなときに技を出す。順番は無い。
 * 観客の盛り上がりは見えない値（シードから決まる波）で、盛り上がった瞬間に出すほど点が伸びる。
 * 時間が来たら ステータス（ポロックなど）＋パフォーマンス（技の点）で順位を決める。
 * 手順はソロ・ホストが決めて全員へ送り（contestApplied）、どのブラウザでも同じ結果を計算する。
 * 押した瞬間の盛り上がり（gauge）はブラウザの画面の値で、コマンドに載せて送る
 */
export interface ContestEntry {
  readonly category: string;
  readonly moves: readonly number[];
  /** 本人のセーブから決まる、その部門で出られるランク */
  readonly rank: number;
}

/** 直前のアピールの出来（画面の文字と音） */
export interface ContestAppeal {
  readonly points: number;
  readonly rating: 'great' | 'good' | 'ok';
  readonly move: number | null;
  /** 出した時刻（c.elapsed） */
  readonly at: number;
}

/** 舞台に立つ1人（プレイヤーか NPC） */
export interface ContestEntrant {
  readonly playerId: PlayerId | null;
  readonly npc: string | null;
  readonly category: string | null;
  /** 披露する技（順番どおりに繰り返す） */
  readonly moves: readonly number[];
  /** ステータスの点（ポロックと技の強化。NPC は決まった割合） */
  readonly primary: number;
  /** パフォーマンスの点（1回ごと） */
  readonly appeals: number[];
  /** NPC の1回の点（プレイヤーは 0） */
  readonly npcPoints: number;
  /** 次に技を出せる時刻（c.elapsed） */
  readyAt: number;
  last: ContestAppeal | null;
}

export interface ContestResult {
  /** プレイヤーの番号。NPC は null */
  readonly playerId: PlayerId | null;
  /** NPC のポケモン（data のキー）。プレイヤーは null */
  readonly npc: string | null;
  /** ステータスの点 */
  readonly status: number;
  /** パフォーマンスの点 */
  readonly performance: number;
  readonly score: number;
  readonly place: number;
  readonly coins: number;
}

export interface ContestState {
  phase: 'branch' | 'entry' | 'appeal' | 'result';
  readonly answers: Map<PlayerId, boolean>;
  readonly entries: Map<PlayerId, ContestEntry>;
  rank: number;
  results: ContestResult[] | null;
  /** 残り時間（branch・entry はホストの待ち時間。appeal は制限時間） */
  ticksLeft: number;
  /** アピールが始まってからの更新回数（観客の波の時刻） */
  elapsed: number;
  entrants: ContestEntrant[];
  /** NPC が技を出す予定（時刻の順。ソロ・ホスト） */
  npcPlan: { tick: number; index: number }[];
}

const NPC_SALT = 0xc0de;
const CROWD_SALT = 0xa17;

type Timing = ContestConfig['timing'];

/**
 * 観客の盛り上がり（0〜1。1 が一番盛り上がった瞬間）。全員で共通の、見えない値。
 * 静かな所からゆっくり高まり（riseShare の間）、頂点の後は早く冷める。波の長さは毎回変わるので、拍子を覚えるのでなく客を見る
 */
export function crowdAir(timing: Timing, seed: number, seconds: number): number {
  let start = 0;
  for (let n = 0; n < 1000; n++) {
    const period = wavePeriod(timing, seed, n);
    if (seconds < start + period) {
      const f = (seconds - start) / period;
      return f < timing.riseShare ? f / timing.riseShare : (1 - f) / (1 - timing.riseShare);
    }
    start += period;
  }
  return 0;
}

function wavePeriod(timing: Timing, seed: number, n: number): number {
  return timing.periodMin + (timing.periodMax - timing.periodMin) * hash01(seed, n, 0, CROWD_SALT);
}

/** 制限時間の中の、波の頂点の時刻（秒） */
export function crowdPeaks(timing: Timing, seed: number, totalSeconds: number): number[] {
  const out: number[] = [];
  let start = 0;
  for (let n = 0; n < 1000; n++) {
    const period = wavePeriod(timing, seed, n);
    const peak = start + period * timing.riseShare;
    if (peak >= totalSeconds) break;
    out.push(peak);
    start += period;
  }
  return out;
}

/** 盛り上がりに応じた点の倍率（頂点で 1 + bonus。静かな時はほとんど入らないので、連打より山を待つ方が伸びる） */
export function appealMultiplier(timing: Timing, gauge: number): number {
  return timing.floor + (1 + timing.bonus - timing.floor) * gauge ** timing.curve;
}

/** 区間が終わったとき（ソロ・ホスト）: 決まった区間の後で分岐を出す */
export function maybeOpenContest(world: World, endedSection: number): void {
  const cfg = world.rules.contest;
  if (!cfg || world.contestOffered || endedSection !== cfg.afterSection) return;
  applyContest(world, { op: 'open', playerId: 0 });
}

function fresh(world: World, cfg: ContestConfig): ContestState {
  return { phase: 'branch', answers: new Map(), entries: new Map(), rank: 0, results: null, ticksLeft: Math.round(cfg.answerSeconds / world.dt), elapsed: 0, entrants: [], npcPlan: [] };
}

/** コンテストの決まった手順を進める。ホストは全員へも送る（contestApplied） */
export function applyContest(world: World, cmd: ContestCommand): void {
  const cfg = world.rules.contest;
  if (!cfg) return;
  if (cmd.op === 'open') {
    if (world.contest) return;
    world.contestOffered = true;
    world.contest = fresh(world, cfg);
  } else {
    const c = world.contest;
    if (!c) return;
    if (cmd.op === 'answer' && c.phase === 'branch') c.answers.set(cmd.playerId, cmd.go);
    else if (cmd.op === 'entry' && c.phase === 'entry') c.entries.set(cmd.playerId, { category: cmd.category, moves: cmd.moves, rank: cmd.rank });
    else if (cmd.op === 'appeal' && c.phase === 'appeal') {
      const k = c.entrants.findIndex((e) => e.playerId === cmd.playerId);
      // 技を出せるかはホストが決める（ゲストは送られてきたものをそのまま当てはめる）
      if (k === -1 || (world.role !== 'guest' && c.elapsed < c.entrants[k]!.readyAt)) return;
      appeal(world, cfg, c, k, Math.max(0, Math.min(1, cmd.gauge)));
    } else if (cmd.op === 'npc' && cmd.playerId === 0 && c.phase === 'appeal' && c.entrants[cmd.index]?.npc) {
      appeal(world, cfg, c, cmd.index, Math.max(0, Math.min(1, cmd.gauge)));
    } else if (cmd.op === 'advance' && cmd.playerId === 0 && c.phase === 'appeal') {
      finishPerformance(cfg, world, c);
    } else if (cmd.op === 'finish' && c.phase === 'result') {
      if (world.role !== 'guest') endRun(world, 'contest');
      return;
    } else return;
  }
  if (world.role === 'host') world.events.push({ type: 'contestApplied', command: cmd });
  advanceContest(world);
}

/** 全員の答え・出場がそろったら次へ（抜けた人がいたときも呼ぶ） */
export function advanceContest(world: World): void {
  const cfg = world.rules.contest;
  const c = world.contest;
  if (!cfg || !c) return;
  const ids = world.players.map((p) => p.id);
  if (c.phase === 'branch' && ids.every((id) => c.answers.has(id))) {
    // 全員がコンテストを選んだときだけ。だれかがリーグを選べば、全員リーグへ続ける
    if (!ids.every((id) => c.answers.get(id))) {
      world.contest = null;
      return;
    }
    c.phase = 'entry';
    c.ticksLeft = Math.round(cfg.answerSeconds / world.dt);
  } else if (c.phase === 'entry' && ids.every((id) => c.entries.has(id))) {
    startPerformance(world, cfg, c);
  }
}

/** 時間で進む手順（ソロ・ホスト）。答えない人がいても止まらないように（ソロの分岐と出場はいくらでも待つ） */
export function stepContest(world: World): void {
  const c = world.contest;
  if (!c || c.phase === 'result') return;
  if (c.phase === 'appeal') {
    // 観客の波はどのブラウザでも同じ時刻で見る。NPC と時間切れはソロ・ホストが決める
    c.elapsed++;
    if (world.role === 'guest') return;
    while (c.phase === 'appeal' && c.npcPlan[0] && c.npcPlan[0].tick <= c.elapsed) {
      const { index } = c.npcPlan.shift()!;
      applyContest(world, { op: 'npc', playerId: 0, index, gauge: crowdAir(world.rules.contest!.timing, world.seed, c.elapsed * world.dt) });
    }
    if (--c.ticksLeft <= 0) applyContest(world, { op: 'advance', playerId: 0 });
    return;
  }
  if (world.role !== 'host' || --c.ticksLeft > 0) return;
  for (const p of world.players) {
    if (c.phase === 'branch' && !c.answers.has(p.id)) applyContest(world, { op: 'answer', playerId: p.id, go: false });
    else if (c.phase === 'entry' && !c.entries.has(p.id)) {
      const moves = p.moves.slice(0, 2).map((m) => m.move);
      applyContest(world, { op: 'entry', playerId: p.id, category: world.rules.contest!.categories[0]!, moves, rank: 0 });
    }
  }
}

/** ステータスの点: 選んだ部門のポロック・ほかのポロック・技の強化回数の累計 */
export function primaryScore(world: World, p: Pick<Player, 'pokeblocks' | 'moveUps'>, category: string): number {
  const s = world.rules.contest!.score;
  let score = (p.moveUps ?? 0) * s.moveUp;
  for (const [cat, n] of Object.entries(p.pokeblocks ?? {})) score += n * (cat === category ? s.pokeblockChosen : s.pokeblockOther);
  return Math.round(score);
}

/** 技の基本の点（タイミングで増える前）: 技が部門に合っているか */
export function appealBase(world: World, move: number | undefined, category: string | null): number {
  const s = world.rules.contest!.score;
  if (move === undefined) return 0;
  return world.rules.moves[move]?.contestType === category ? s.moveMatch : s.moveOther;
}

function startPerformance(world: World, cfg: ContestConfig, c: ContestState): void {
  // ランクは出場者の中で一番低い人に合わせる（同じ会場で競う）
  c.rank = Math.min(cfg.ranks.length - 1, ...[...c.entries.values()].map((e) => e.rank));
  const rank = cfg.ranks[c.rank]!;
  const rows: ContestEntrant[] = world.players.map((p) => {
    const e = c.entries.get(p.id)!;
    return { playerId: p.id, npc: null, category: e.category, moves: e.moves, primary: primaryScore(world, p, e.category), appeals: [], npcPoints: 0, readyAt: 0, last: null };
  });
  // 足りない分は NPC（ランクの強い方から。点数はシードで少しずれる）。山ごとに技を出す
  const needed = Math.max(0, cfg.entrants - rows.length);
  const start = Math.floor(hash01(world.seed, 0, c.rank + 100, NPC_SALT) * cfg.npcPokemon.length);
  const peaks = crowdPeaks(cfg.timing, world.seed, cfg.performanceSeconds);
  const plan: ContestState['npcPlan'] = [];
  rank.npcScores.slice(-needed || rank.npcScores.length).slice(0, needed).forEach((base, k) => {
    const jitter = 1 - cfg.npcJitter + 2 * cfg.npcJitter * hash01(world.seed, k, c.rank, NPC_SALT);
    const total = base * jitter;
    // ポケモンは並びの続きから取り、同じ会場で被らないようにする
    const npc = cfg.npcPokemon[(start + k) % cfg.npcPokemon.length]!;
    const moves = (cfg.npcMoves[npc] ?? []).map((key) => world.rules.moves.findIndex((m) => m.key === key)).filter((m) => m >= 0);
    const npcPoints = Math.round((total * (1 - cfg.npcPrimaryShare)) / Math.max(1, peaks.length));
    const index = rows.length;
    rows.push({ playerId: null, npc, category: null, moves, primary: Math.round(total * cfg.npcPrimaryShare), appeals: [], npcPoints, readyAt: 0, last: null });
    peaks.forEach((peak, n) => {
      const miss = (hash01(world.seed, n, index, NPC_SALT + 2) * 2 - 1) * cfg.npcMissSeconds;
      plan.push({ tick: Math.max(1, Math.round((peak + miss) / world.dt)), index });
    });
  });
  c.npcPlan = plan.sort((a, b) => a.tick - b.tick || a.index - b.index);
  c.entrants = rows;
  c.phase = 'appeal';
  c.elapsed = 0;
  c.ticksLeft = Math.round(cfg.performanceSeconds / world.dt);
}

/** 技を出して点を決める。gauge は出した瞬間の観客の盛り上がり（0〜1） */
function appeal(world: World, cfg: ContestConfig, c: ContestState, k: number, gauge: number): void {
  const e = c.entrants[k]!;
  const move = e.moves.length ? e.moves[e.appeals.length % e.moves.length] : undefined;
  const points = e.npc ? e.npcPoints : Math.round(appealBase(world, move, e.category) * appealMultiplier(cfg.timing, gauge));
  const rating = gauge >= cfg.timing.great ? 'great' : gauge >= cfg.timing.good ? 'good' : 'ok';
  e.appeals.push(points);
  e.last = { points, rating, move: move ?? null, at: c.elapsed };
  e.readyAt = c.elapsed + Math.round(cfg.cooldownSeconds / world.dt);
}

function finishPerformance(cfg: ContestConfig, world: World, c: ContestState): void {
  const rank = cfg.ranks[c.rank]!;
  const rows = c.entrants.map((e) => {
    const performance = e.appeals.reduce((a, b) => a + b, 0);
    return { playerId: e.playerId, npc: e.npc, status: e.primary, performance, score: e.primary + performance };
  });
  // 同点はプレイヤーを上に
  rows.sort((a, b) => b.score - a.score || Number(a.playerId === null) - Number(b.playerId === null));
  c.results = rows.map((r, i) => ({ ...r, place: i + 1, coins: Math.round((rank.coins * (cfg.placementPct[i] ?? 0)) / 100) }));
  for (const r of c.results) {
    const p = world.players.find((q) => q.id === r.playerId);
    if (p) p.bonusCoins = (p.bonusCoins ?? 0) + r.coins;
  }
  c.phase = 'result';
  c.npcPlan = [];
}
