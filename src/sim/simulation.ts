import type { InputCommand, PlayerId } from './commands';
import { createPlayer, type Player } from './entities/player';
import type { SimRules } from './rules';
import { playerAttacks, moveProjectiles } from './systems/attack';
import { applyCommands } from './systems/commands';
import { moveEnemies, rebuildEnemyHash, separateEnemies } from './systems/enemyMovement';
import { movePlayers } from './systems/movement';
import { spawnEnemies } from './systems/spawn';
import { createWorld, type SimRole, type World } from './world';

export interface SimulationOptions {
  tickRate: number;
  seed: number;
  rules: SimRules;
  /** 省略時は solo */
  role?: SimRole;
  /** このブラウザで操作するプレイヤー（省略時は 1） */
  localPlayerId?: PlayerId;
}

export interface PlayerSpawn {
  id: PlayerId;
  x: number;
  y: number;
  radius: number;
  moveSpeed: number;
  /** 別のブラウザが操作するプレイヤー */
  remote?: boolean;
}

/**
 * シミュレーション本体。Phaser に依存しない。
 * step() に「その更新で適用する入力コマンド」を渡して1回ずつ進める。
 */
export class Simulation {
  readonly world: World;

  constructor(options: SimulationOptions) {
    this.world = createWorld(options.tickRate, options.seed, options.rules, options.role ?? 'solo', options.localPlayerId ?? 1);
  }

  addPlayer(spawn: PlayerSpawn): Player {
    const p = createPlayer(spawn.id, spawn.x, spawn.y, spawn.radius, spawn.moveSpeed, spawn.remote ?? false);
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
