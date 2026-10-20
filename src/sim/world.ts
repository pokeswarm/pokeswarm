import type { PlayerId } from './commands';
import { EnemyStore } from './entities/enemies';
import type { Player } from './entities/player';
import { ProjectileStore } from './entities/projectiles';
import type { SimEvent } from './events';
import { Rng } from './rng';
import type { SimRules } from './rules';
import { SpatialHash } from './spatial/spatialHash';

/**
 * このブラウザの役割。
 * - solo: すべてをこのブラウザで決める
 * - host: 敵の出現・HP の集計・撃破の確定を担い、結果をゲストへ送る
 * - guest: 敵の出現と撃破はホストから受け取り、自分の攻撃の命中はホストへ伝える
 */
export type SimRole = 'solo' | 'host' | 'guest';

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
  /** 敵の空間ハッシュ（毎回作り直す） */
  readonly enemyHash: SpatialHash;
  readonly rng: Rng;
  nextEnemyId: number;
  /** 出現数の端数 */
  spawnAccumulator: number;
  /** この更新で起きた出来事（更新のたびに空にする） */
  readonly events: SimEvent[];
  readonly stats: { kills: number; empowered: number };
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
    enemies: new EnemyStore(capacity),
    projectiles: new ProjectileStore(rules.attack.maxProjectiles, rules.attack.hitMemory),
    enemyHash: new SpatialHash(rules.spawn.spatialCellSize, capacity),
    rng: new Rng(seed),
    nextEnemyId: 1,
    spawnAccumulator: 0,
    events: [],
    stats: { kills: 0, empowered: 0 },
    scratch: new Int32Array(capacity * 2),
    hitScratch: new Int32Array(capacity * 2),
    neighborScratch: new Int32Array(Math.max(8, rules.spawn.separation.maxNeighbors * 4)),
  };
}

export function findPlayer(world: World, id: PlayerId): Player | undefined {
  return world.players.find((p) => p.id === id);
}

/** 実際の敵の上限: min(全体の上限, 1人あたりの上限 × 人数) */
export function enemyCap(world: World): number {
  const s = world.rules.spawn;
  return Math.min(s.capGlobal, s.capPerPlayer * world.players.length);
}

export function findEnemyIndex(world: World, id: number): number {
  const e = world.enemies;
  for (let i = 0; i < e.count; i++) if (e.id[i] === id) return i;
  return -1;
}
