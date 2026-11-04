import type { ContestConfig } from '../data/schema';
import type { ContestCommand, PlayerId } from './commands';
import type { Player } from './entities/player';
import { hash01 } from './math';
import { endRun } from './systems/stage';
import type { World } from './world';

/**
 * ポケモンコンテスト（ホウエン。07 の188・192章）: リーグの代わりにコンテストへ進む、もう1つの終わり方。
 * 最大4人（足りない分は NPC）。一次審査（ポロックと技の強化）→ 二次審査（選んだ技を順に披露。タイミングで点が伸びる）→ 順位とコイン。
 * 手順はソロ・ホストが決めて全員へ送り（contestApplied）、どのブラウザでも同じ結果を計算する。
 * アピールのタイミング（gauge）はブラウザの画面の針の値で、コマンドに載せて送る
 */
export interface ContestEntry {
  readonly category: string;
  readonly moves: readonly number[];
  /** 本人のセーブから決まる、その部門で出られるランク */
  readonly rank: number;
}

/** 舞台に立つ1人（プレイヤーか NPC） */
export interface ContestEntrant {
  readonly playerId: PlayerId | null;
  readonly npc: string | null;
  readonly category: string | null;
  /** 披露する技（順番どおり） */
  readonly moves: readonly number[];
  /** 一次審査の点 */
  readonly primary: number;
  /** 二次審査の点（1回ごと） */
  readonly appeals: number[];
  /** NPC の1回の点（プレイヤーは 0） */
  readonly npcAppeal: number;
}

export interface ContestResult {
  /** プレイヤーの番号。NPC は null */
  readonly playerId: PlayerId | null;
  /** NPC のポケモン（data のキー）。プレイヤーは null */
  readonly npc: string | null;
  readonly score: number;
  readonly place: number;
  readonly coins: number;
}

/** 直前のアピールの出来（画面の文字と音） */
export interface ContestAppeal {
  readonly points: number;
  readonly rating: 'great' | 'good' | 'ok' | 'npc';
  readonly move: number | null;
  /** 満員の歓声でボーナスが付いた */
  readonly cheer: boolean;
}

export interface ContestState {
  phase: 'branch' | 'entry' | 'primary' | 'appeal' | 'result';
  readonly answers: Map<PlayerId, boolean>;
  readonly entries: Map<PlayerId, ContestEntry>;
  rank: number;
  results: ContestResult[] | null;
  /** 残り時間（branch・entry はホストの待ち時間。primary・appeal は次へ進むまで） */
  ticksLeft: number;
  /** 舞台に立つ順（一次審査の点の低い順。最後が一番の注目） */
  entrants: ContestEntrant[];
  /** 二次審査の何回目か・その中の何人目か */
  round: number;
  turn: number;
  /** この人のアピールが終わって、結果を見せている */
  shown: boolean;
  lastAppeal: ContestAppeal | null;
  /** 観客の盛り上がり（0〜crowdMax） */
  crowd: number;
  /** はやおくり */
  fast: boolean;
}

const NPC_SALT = 0xc0de;

/** 区間が終わったとき（ソロ・ホスト）: 決まった区間の後で分岐を出す */
export function maybeOpenContest(world: World, endedSection: number): void {
  const cfg = world.rules.contest;
  if (!cfg || world.contestOffered || endedSection !== cfg.afterSection) return;
  applyContest(world, { op: 'open', playerId: 0 });
}

function fresh(world: World, cfg: ContestConfig): ContestState {
  return { phase: 'branch', answers: new Map(), entries: new Map(), rank: 0, results: null, ticksLeft: Math.round(cfg.answerSeconds / world.dt), entrants: [], round: 0, turn: 0, shown: false, lastAppeal: null, crowd: 0, fast: false };
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
    else if (cmd.op === 'appeal' && c.phase === 'appeal' && !c.shown && c.entrants[c.turn]?.playerId === cmd.playerId) {
      appeal(world, cfg, c, Math.max(0, Math.min(1, cmd.gauge)));
    } else if (cmd.op === 'advance' && cmd.playerId === 0 && (c.phase === 'primary' || c.phase === 'appeal')) {
      advancePerformance(world, cfg, c);
    } else if (cmd.op === 'fast' && (c.phase === 'primary' || c.phase === 'appeal')) c.fast = true;
    else if (cmd.op === 'finish' && c.phase === 'result') {
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
  if (!c || world.role === 'guest' || c.phase === 'result') return;
  if (c.phase === 'primary' || c.phase === 'appeal') {
    c.ticksLeft -= c.fast ? world.rules.contest!.fastMultiplier : 1;
    if (c.ticksLeft <= 0) applyContest(world, { op: 'advance', playerId: 0 });
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

/** 一次審査の点: 選んだ部門のポロック・ほかのポロック・技の強化回数の累計 */
export function primaryScore(world: World, p: Pick<Player, 'pokeblocks' | 'moveUps'>, category: string): number {
  const s = world.rules.contest!.score;
  let score = (p.moveUps ?? 0) * s.moveUp;
  for (const [cat, n] of Object.entries(p.pokeblocks ?? {})) score += n * (cat === category ? s.pokeblockChosen : s.pokeblockOther);
  return Math.round(score);
}

/** 二次審査の基本の点（タイミングで増える前）: 技が部門に合っているか */
export function appealBase(world: World, move: number | undefined, category: string | null): number {
  const s = world.rules.contest!.score;
  if (move === undefined) return 0;
  return world.rules.moves[move]?.contestType === category ? s.moveMatch : s.moveOther;
}

/** 出る前の見込みの点（タイミングの分を除く） */
export function contestScore(world: World, p: Pick<Player, 'pokeblocks' | 'moveUps'>, entry: Pick<ContestEntry, 'category' | 'moves'>): number {
  return primaryScore(world, p, entry.category) + entry.moves.reduce((sum, m) => sum + appealBase(world, m, entry.category), 0);
}

function startPerformance(world: World, cfg: ContestConfig, c: ContestState): void {
  // ランクは出場者の中で一番低い人に合わせる（同じ会場で競う）
  c.rank = Math.min(cfg.ranks.length - 1, ...[...c.entries.values()].map((e) => e.rank));
  const rank = cfg.ranks[c.rank]!;
  const rows: ContestEntrant[] = world.players.map((p) => {
    const e = c.entries.get(p.id)!;
    return { playerId: p.id, npc: null, category: e.category, moves: e.moves, primary: primaryScore(world, p, e.category), appeals: [], npcAppeal: 0 };
  });
  // 足りない分は NPC（ランクの強い方から。点数はシードで少しずれる）
  const needed = Math.max(0, cfg.entrants - rows.length);
  const start = Math.floor(hash01(world.seed, 0, c.rank + 100, NPC_SALT) * cfg.npcPokemon.length);
  rank.npcScores.slice(-needed || rank.npcScores.length).slice(0, needed).forEach((base, k) => {
    const jitter = 1 - cfg.npcJitter + 2 * cfg.npcJitter * hash01(world.seed, k, c.rank, NPC_SALT);
    const total = base * jitter;
    // ポケモンは並びの続きから取り、同じ会場で被らないようにする
    const npc = cfg.npcPokemon[(start + k) % cfg.npcPokemon.length]!;
    const moves = (cfg.npcMoves[npc] ?? []).map((key) => world.rules.moves.findIndex((m) => m.key === key)).filter((m) => m >= 0);
    const appealShare = (1 - cfg.npcPrimaryShare) / cfg.rounds;
    rows.push({ playerId: null, npc, category: null, moves, primary: Math.round(total * cfg.npcPrimaryShare), appeals: [], npcAppeal: Math.round(total * appealShare) });
  });
  rows.sort((a, b) => a.primary - b.primary);
  c.entrants = rows;
  c.phase = 'primary';
  c.ticksLeft = Math.round(cfg.primarySeconds / world.dt);
}

/** その人のアピールを始める。NPC と抜けた人はすぐ結果へ */
function beginTurn(world: World, cfg: ContestConfig, c: ContestState): void {
  const e = c.entrants[c.turn]!;
  c.shown = false;
  c.lastAppeal = null;
  if (e.playerId !== null && world.players.some((p) => p.id === e.playerId)) {
    c.ticksLeft = Math.round(cfg.appealSeconds / world.dt);
    return;
  }
  appeal(world, cfg, c, hash01(world.seed, c.turn, c.round, NPC_SALT + 1));
}

/** アピールの点を決めて、結果を見せる。gauge は針の値（0〜1。真ん中で止めるほど 1） */
function appeal(world: World, cfg: ContestConfig, c: ContestState, gauge: number): void {
  const e = c.entrants[c.turn]!;
  const move = e.moves.length ? e.moves[c.round % e.moves.length] : undefined;
  const npc = e.playerId === null;
  const points = npc ? e.npcAppeal : Math.round(appealBase(world, move, e.category) * (1 + cfg.timing.bonus * gauge));
  const match = npc || world.rules.moves[move ?? -1]?.contestType === e.category;
  const rating = npc ? 'npc' : gauge >= cfg.timing.great ? 'great' : gauge >= cfg.timing.good ? 'good' : 'ok';
  // 盛り上がり: 部門に合った技で上がり、いいタイミングでさらに上がる。合わない技で下がる。いっぱいになると歓声のボーナス
  let crowd = c.crowd + (match ? 1 : -1) + (rating === 'great' ? 1 : 0);
  if (npc) crowd = c.crowd + (gauge > 0.5 ? 1 : 0);
  let cheer = false;
  let total = points;
  if (crowd >= cfg.crowdMax) {
    crowd = 0;
    cheer = true;
    total += cfg.crowdBonus;
  }
  c.crowd = Math.max(0, crowd);
  e.appeals.push(total);
  c.lastAppeal = { points: total, rating, move: move ?? null, cheer };
  c.shown = true;
  c.ticksLeft = Math.round((npc ? cfg.npcTurnSeconds : cfg.revealSeconds) / world.dt);
}

function advancePerformance(world: World, cfg: ContestConfig, c: ContestState): void {
  if (c.phase === 'primary') {
    c.phase = 'appeal';
    c.round = 0;
    c.turn = 0;
    beginTurn(world, cfg, c);
    return;
  }
  // 時間切れ: 押さなかった人は針 0 のアピール
  if (!c.shown) {
    appeal(world, cfg, c, 0);
    return;
  }
  c.turn++;
  if (c.turn >= c.entrants.length) {
    c.turn = 0;
    c.round++;
  }
  if (c.round >= cfg.rounds) {
    finishPerformance(cfg, world, c);
    return;
  }
  beginTurn(world, cfg, c);
}

function finishPerformance(cfg: ContestConfig, world: World, c: ContestState): void {
  const rank = cfg.ranks[c.rank]!;
  const rows = c.entrants.map((e) => ({ playerId: e.playerId, npc: e.npc, score: e.primary + e.appeals.reduce((a, b) => a + b, 0) }));
  // 同点はプレイヤーを上に
  rows.sort((a, b) => b.score - a.score || Number(a.playerId === null) - Number(b.playerId === null));
  c.results = rows.map((r, i) => ({ ...r, place: i + 1, coins: Math.round((rank.coins * (cfg.placementPct[i] ?? 0)) / 100) }));
  for (const r of c.results) {
    const p = world.players.find((q) => q.id === r.playerId);
    if (p) p.bonusCoins = (p.bonusCoins ?? 0) + r.coins;
  }
  c.phase = 'result';
  c.lastAppeal = null;
}
