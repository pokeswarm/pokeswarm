import type { PlayerId } from './commands';
import { EnemyStore } from './entities/enemies';
import { GemStore } from './entities/gems';
import type { Player } from './entities/player';
import { ProjectileStore } from './entities/projectiles';
import type { SimEvent } from './events';
import { Rng } from './rng';
import type { StatusKind } from '../data/schema';
import type { SimRules } from './rules';
import { SpatialHash } from './spatial/spatialHash';

/**
 * このブラウザの役割。
 * - solo: すべてをこのブラウザで決める
 * - host: 敵の出現・HP の集計・撃破の確定を担い、結果をゲストへ送る
 * - guest: 敵の出現と撃破はホストから受け取り、自分の攻撃の命中はホストへ伝える
 */
export type SimRole = 'solo' | 'host' | 'guest';

/** レベルアップの候補1つ */
export type UpgradeOffer =
  | { readonly kind: 'moveNew'; readonly move: number }
  | { readonly kind: 'moveUp'; readonly slot: number }
  | { readonly kind: 'itemNew'; readonly item: number }
  | { readonly kind: 'itemUp'; readonly slot: number }
  | { readonly kind: 'passiveNew'; readonly passive: number }
  | { readonly kind: 'passiveUp'; readonly slot: number }
  /** 派生・固有技: slot の技を to に置き換える（材料の持ち物が消える持ち物ならなくなる） */
  | { readonly kind: 'derive'; readonly slot: number; readonly to: number; readonly item: number; readonly unique: boolean };

/** レベルアップの選択の状態 */
export interface LevelUpState {
  /** 上がった後のレベル */
  readonly level: number;
  /** プレイヤーごとの候補 */
  readonly offers: Map<PlayerId, UpgradeOffer[]>;
  /** 選び終えた（または見送った）プレイヤー */
  readonly done: Set<PlayerId>;
  /** 時間切れまでの残り（更新回数） */
  ticksLeft: number;
}

/** ランの結果 */
export type RunOutcome = 'clear' | 'fail';

/** ボスの範囲技の予告中の範囲。ticksLeft が 0 になったときに中にいたらダメージを受ける */
export interface Hazard {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly damage: number;
  ticksLeft: number;
  readonly totalTicks: number;
  /** 落ちたときの演出 */
  readonly effect: string;
}

/** シミュレーションの全状態 */
export interface World {
  tick: number;
  readonly role: SimRole;
  /** このブラウザで操作しているプレイヤー */
  readonly localPlayerId: PlayerId;
  readonly seed: number;
  /** 1回の更新の秒数 */
  readonly dt: number;
  readonly rules: SimRules;
  readonly players: Player[];
  readonly enemies: EnemyStore;
  readonly projectiles: ProjectileStore;
  /** 経験値の玉 */
  readonly gems: GemStore;
  nextGemId: number;
  /** 全員で共有する経験値の合計（ホストが確定する） */
  xp: number;
  /** 全員で共有するレベルと、次のレベルまでに貯めた経験値 */
  level: number;
  xpIntoLevel: number;
  /** 選択を待っているレベルアップの数 */
  pendingLevelUps: number;
  /** レベルアップの選択中（ゲームは止まっている）。null なら選択中でない */
  levelUp: LevelUpState | null;
  /** 敵の空間ハッシュ（毎回作り直す） */
  readonly enemyHash: SpatialHash;
  readonly rng: Rng;
  nextEnemyId: number;
  /** 出現数の端数 */
  spawnAccumulator: number;
  /** この更新で起きた出来事（更新のたびに空にする） */
  readonly events: SimEvent[];
  readonly stats: { kills: number };
  /** 状態異常の種類（番号は data/game/status.json の並び） */
  readonly statusKinds: readonly StatusKind[];
  /** 時間帯ごとに出す敵の種類（rules.spawn.waves を更新回数と種類の番号に直したもの） */
  readonly waves: readonly {
    readonly startTick: number;
    readonly hpMultiplier: number;
    readonly damageMultiplier: number;
    readonly xpMultiplier: number;
    readonly spawnPerSecond: number;
    readonly capPerPlayer: number;
    readonly kinds: readonly number[];
  }[];
  /** 全員で共有する復活可能数 */
  revives: number;
  /** ランの結果。決まったらシミュレーションは進まない */
  outcome: RunOutcome | null;
  /** 中ボス・ボスを出す予定（更新回数の順）。nextBoss は次に出す予定の番号 */
  readonly bossSchedule: readonly { readonly tick: number; readonly kind: number }[];
  nextBoss: number;
  /** 出ているボス（範囲技を使う rank: boss）と、次の技までの残り（ソロ・ホスト） */
  readonly bosses: { id: number; cooldown: number }[];
  /** 予告中の範囲 */
  readonly hazards: Hazard[];
  /** 近傍検索の作業用（更新中にメモリを確保しないため） */
  readonly scratch: Int32Array;
  /** 発射体の命中候補の作業用 */
  readonly hitScratch: Int32Array;
  /** 押し合いの近傍検索の作業用（小さくして、密集時に集めすぎないようにする） */
  readonly neighborScratch: Int32Array;
}

export function createWorld(tickRate: number, seed: number, rules: SimRules, role: SimRole, localPlayerId: PlayerId): World {
  // ゲストは、ホストで倒されたが撃破の知らせがまだ届いていない敵を持つため、上限より多くなりうる。
  // 入れ物があふれて出現を取りこぼさないよう、余裕を持たせる
  const capacity = role === 'guest' ? rules.spawn.capGlobal * 2 : rules.spawn.capGlobal;
  return {
    tick: 0,
    role,
    localPlayerId,
    seed,
    dt: 1 / tickRate,
    rules,
    players: [],
    enemies: new EnemyStore(capacity, rules.status.kinds.length),
    statusKinds: rules.status.kinds,
    // ゲストは、拾ってホストの確定を待っている玉の分だけホストより多くなりうるので余裕を持たせる
    gems: new GemStore(role === 'guest' ? rules.pickups.maxGems * 2 : rules.pickups.maxGems),
    nextGemId: 1,
    xp: 0,
    revives: rules.stats.revive.initialCount,
    outcome: null,
    bossSchedule: buildBossSchedule(rules, tickRate),
    nextBoss: 0,
    bosses: [],
    hazards: [],
    level: 1,
    xpIntoLevel: 0,
    pendingLevelUps: 0,
    levelUp: null,
    projectiles: new ProjectileStore(rules.combat.maxProjectiles, rules.combat.hitMemory),
    enemyHash: new SpatialHash(rules.spawn.spatialCellSize, capacity),
    rng: new Rng(seed),
    nextEnemyId: 1,
    spawnAccumulator: 0,
    events: [],
    stats: { kills: 0 },
    waves: rules.spawn.waves.map((w) => ({
      startTick: Math.round(w.startSeconds * tickRate),
      hpMultiplier: w.hpMultiplier,
      damageMultiplier: w.damageMultiplier,
      xpMultiplier: w.xpMultiplier ?? 1,
      spawnPerSecond: w.spawnPerSecond ?? rules.spawn.spawnPerSecond,
      capPerPlayer: w.capPerPlayer ?? rules.spawn.capPerPlayer,
      kinds: w.kinds.map((id) => {
        const i = rules.enemies.kinds.findIndex((k) => k.id === id);
        if (i === -1) throw new Error(`敵の種類 ${id} がありません`);
        return i;
      }),
    })),
    scratch: new Int32Array(capacity * 2),
    hitScratch: new Int32Array(capacity * 2),
    neighborScratch: new Int32Array(Math.max(8, rules.spawn.separation.maxNeighbors * 4)),
  };
}

function kindIndexOf(rules: SimRules, id: string): number {
  const i = rules.enemies.kinds.findIndex((k) => k.id === id);
  if (i === -1) throw new Error(`敵の種類 ${id} がありません`);
  return i;
}

/** 中ボス（stage.midbosses）とボス（ランの長さの時点）を出す予定 */
function buildBossSchedule(rules: SimRules, tickRate: number): { tick: number; kind: number }[] {
  const out = rules.stage.midbosses.map((m) => ({ tick: Math.round(m.atSeconds * tickRate), kind: kindIndexOf(rules, m.kind) }));
  if (rules.stage.boss) out.push({ tick: Math.round(rules.stage.durationSeconds * tickRate), kind: kindIndexOf(rules, rules.stage.boss.kind) });
  return out.sort((a, b) => a.tick - b.tick);
}

/** ランの経過秒数（レベルアップの選択で止まっている間は進まない） */
export function elapsedSeconds(world: World): number {
  return world.tick * world.dt;
}

export function findPlayer(world: World, id: PlayerId): Player | undefined {
  return world.players.find((p) => p.id === id);
}

/** 実際の敵の上限: min(全体の上限, 今の時間帯の1人あたりの上限 × 人数) */
export function enemyCap(world: World): number {
  const wave = world.waves[currentWaveIndex(world)]!;
  return Math.min(world.rules.spawn.capGlobal, wave.capPerPlayer * world.players.length);
}

export function findEnemyIndex(world: World, id: number): number {
  const e = world.enemies;
  for (let i = 0; i < e.count; i++) if (e.id[i] === id) return i;
  return -1;
}

/** 今の時間帯の番号 */
export function currentWaveIndex(world: World, tick = world.tick): number {
  let i = 0;
  while (i + 1 < world.waves.length && world.waves[i + 1]!.startTick <= tick) i++;
  return i;
}
