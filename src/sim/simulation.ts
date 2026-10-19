import type { InputCommand, PlayerId } from './commands';
import { createPlayer, type Player } from './entities/player';
import { applyCommands } from './systems/commands';
import { movePlayers } from './systems/movement';
import { createWorld, type World } from './world';

export interface SimulationOptions {
  tickRate: number;
  seed: number;
}

export interface PlayerSpawn {
  id: PlayerId;
  x: number;
  y: number;
  radius: number;
  moveSpeed: number;
}

/**
 * シミュレーション本体。Phaser に依存しない。
 * step() に「その更新で適用する入力コマンド」を渡して1回ずつ進める。
 */
export class Simulation {
  readonly world: World;

  constructor(options: SimulationOptions) {
    this.world = createWorld(options.tickRate, options.seed);
  }

  addPlayer(spawn: PlayerSpawn): Player {
    const p = createPlayer(spawn.id, spawn.x, spawn.y, spawn.radius, spawn.moveSpeed);
    this.world.players.push(p);
    return p;
  }

  step(commands: readonly InputCommand[]): void {
    applyCommands(this.world, commands);
    movePlayers(this.world);
    this.world.tick++;
  }
}
