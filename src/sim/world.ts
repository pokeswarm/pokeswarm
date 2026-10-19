import type { PlayerId } from './commands';
import type { Player } from './entities/player';
import { Rng } from './rng';

/** シミュレーションの全状態 */
export interface World {
  tick: number;
  /** 1回の更新の秒数 */
  readonly dt: number;
  readonly players: Player[];
  readonly rng: Rng;
}

export function createWorld(tickRate: number, seed: number): World {
  return {
    tick: 0,
    dt: 1 / tickRate,
    players: [],
    rng: new Rng(seed),
  };
}

export function findPlayer(world: World, id: PlayerId): Player | undefined {
  return world.players.find((p) => p.id === id);
}
