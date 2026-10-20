import type { PlayerId } from './commands';
import { EnemyStore } from './entities/enemies';
import type { Player } from './entities/player';
import { ProjectileStore } from './entities/projectiles';
import type { SimEvent } from './events';
import { Rng } from './rng';
import type { SimRules } from './rules';
import { SpatialHash } from './spatial/spatialHash';

/** シミュレーションの全状態 */
export interface World {
  tick: number;
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
}

export function createWorld(tickRate: number, seed: number, rules: SimRules): World {
  const capacity = rules.spawn.capGlobal;
  return {
    tick: 0,
    dt: 1 / tickRate,
    rules,
    players: [],
    enemies: new EnemyStore(capacity),
    projectiles: new ProjectileStore(rules.attack.maxProjectiles),
    enemyHash: new SpatialHash(rules.spawn.spatialCellSize, capacity),
    rng: new Rng(seed),
    nextEnemyId: 1,
    spawnAccumulator: 0,
    events: [],
    stats: { kills: 0, empowered: 0 },
    scratch: new Int32Array(capacity * 2),
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
