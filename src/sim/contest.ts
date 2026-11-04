import type { ContestConfig } from '../data/schema';
import type { ContestCommand, PlayerId } from './commands';
import type { Player } from './entities/player';
import { hash01 } from './math';
import { endRun } from './systems/stage';
import type { World } from './world';

/**
 * ポケモンコンテスト（ホウエン。作者の決定 2026年11月4日。07 の188章）: リーグの代わりにコンテストへ進む、もう1つの終わり方。
 * 最大4人（足りない分は NPC）で点数を競い、順位が高いほどコインをもらえる。作り込みは後で（今は骨組み）。
 * 開く・答える・出場するの順番はホストが決めて全員へ送り、どのブラウザでも同じ結果を計算する
 */
export interface ContestEntry {
  readonly category: string;
  readonly moves: readonly number[];
  /** 本人のセーブから決まる、その部門で出られるランク */
  readonly rank: number;
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

export interface ContestState {
  phase: 'branch' | 'entry' | 'result';
  readonly answers: Map<PlayerId, boolean>;
  readonly entries: Map<PlayerId, ContestEntry>;
  rank: number;
  results: ContestResult[] | null;
  /** 協力プレイの答えの残り時間（0 でまだの人を決める。ソロは待つ） */
  ticksLeft: number;
}

const NPC_SALT = 0xc0de;

/** 区間が終わったとき（ソロ・ホスト）: 決まった区間の後で分岐を出す */
export function maybeOpenContest(world: World, endedSection: number): void {
  const cfg = world.rules.contest;
  if (!cfg || world.contestOffered || endedSection !== cfg.afterSection) return;
  applyContest(world, { op: 'open', playerId: 0 });
}

function fresh(world: World, cfg: ContestConfig): ContestState {
  return { phase: 'branch', answers: new Map(), entries: new Map(), rank: 0, results: null, ticksLeft: Math.round(cfg.answerSeconds / world.dt) };
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
    finishEntries(world, cfg, c);
  }
}

/** 協力プレイで答えない人がいても止まらないように（ホスト）。ソロはいくらでも待つ */
export function stepContest(world: World): void {
  const c = world.contest;
  if (!c || world.role !== 'host' || c.phase === 'result' || --c.ticksLeft > 0) return;
  for (const p of world.players) {
    if (c.phase === 'branch' && !c.answers.has(p.id)) applyContest(world, { op: 'answer', playerId: p.id, go: false });
    else if (c.phase === 'entry' && !c.entries.has(p.id)) {
      const moves = p.moves.slice(0, 2).map((m) => m.move);
      applyContest(world, { op: 'entry', playerId: p.id, category: world.rules.contest!.categories[0]!, moves, rank: 0 });
    }
  }
}

/** プレイヤーの点数: 選んだ部門のポロック・ほかのポロック・技の強化回数の累計・選んだ技が部門に合っているか */
export function contestScore(world: World, p: Pick<Player, 'pokeblocks' | 'moveUps'>, entry: Pick<ContestEntry, 'category' | 'moves'>): number {
  const s = world.rules.contest!.score;
  let score = (p.moveUps ?? 0) * s.moveUp;
  for (const [cat, n] of Object.entries(p.pokeblocks ?? {})) score += n * (cat === entry.category ? s.pokeblockChosen : s.pokeblockOther);
  for (const m of entry.moves) score += world.rules.moves[m]?.contestType === entry.category ? s.moveMatch : s.moveOther;
  return Math.round(score);
}

function finishEntries(world: World, cfg: ContestConfig, c: ContestState): void {
  // ランクは出場者の中で一番低い人に合わせる（同じ会場で競う）
  c.rank = Math.min(cfg.ranks.length - 1, ...[...c.entries.values()].map((e) => e.rank));
  const rank = cfg.ranks[c.rank]!;
  const rows: Omit<ContestResult, 'place' | 'coins'>[] = world.players.map((p) => ({ playerId: p.id, npc: null, score: contestScore(world, p, c.entries.get(p.id)!) }));
  // 足りない分は NPC（ランクの強い方から。点数はシードで少しずれる）
  const needed = Math.max(0, cfg.entrants - rows.length);
  rank.npcScores.slice(-needed || rank.npcScores.length).slice(0, needed).forEach((base, k) => {
    const jitter = 1 - cfg.npcJitter + 2 * cfg.npcJitter * hash01(world.seed, k, c.rank, NPC_SALT);
    // ポケモンは並びの続きから取り、同じ会場で被らないようにする
    const start = Math.floor(hash01(world.seed, 0, c.rank + 100, NPC_SALT) * cfg.npcPokemon.length);
    rows.push({ playerId: null, npc: cfg.npcPokemon[(start + k) % cfg.npcPokemon.length]!, score: Math.round(base * jitter) });
  });
  // 同点はプレイヤーを上に
  rows.sort((a, b) => b.score - a.score || Number(a.playerId === null) - Number(b.playerId === null));
  c.results = rows.map((r, i) => ({ ...r, place: i + 1, coins: Math.round((rank.coins * (cfg.placementPct[i] ?? 0)) / 100) }));
  for (const r of c.results) {
    const p = world.players.find((q) => q.id === r.playerId);
    if (p) p.bonusCoins = (p.bonusCoins ?? 0) + r.coins;
  }
  c.phase = 'result';
}
