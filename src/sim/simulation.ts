import type { InputCommand, PlayerId } from './commands';
import { createPlayer, type Player } from './entities/player';
import type { SimRules } from './rules';
import { playerAttacks, moveProjectiles } from './systems/attack';
import { applyCommands } from './systems/commands';
import { moveEnemies, rebuildEnemyHash, separateEnemies } from './systems/enemyMovement';
import { movePlayers } from './systems/movement';
import { spawnEnemies } from './systems/spawn';
import { createWorld, type World } from './world';

export interface SimulationOptions {
  tickRate: number;
  seed: number;
  rules: SimRules;
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
    this.world = createWorld(options.tickRate, options.seed, options.rules);
  }

  addPlayer(spawn: PlayerSpawn): Player {
    const p = createPlayer(spawn.id, spawn.x, spawn.y, spawn.radius, spawn.moveSpeed);
    this.world.players.push(p);
    return p;
  }

  step(commands: readonly InputCommand[]): void {
    const w = this.world;
    w.events.length = 0;
    applyCommands(w, commands);
    movePlayers(w);
    spawnEnemies(w);
    moveEnemies(w);
    rebuildEnemyHash(w);
    separateEnemies(w);
    playerAttacks(w);
    moveProjectiles(w);
    w.enemies.removeDead();
    w.tick++;
  }
}
