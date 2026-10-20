import type { InputCommand, PlayerId } from './commands';
import { createPlayer, type Player, type PlayerInit } from './entities/player';
import type { SimRules } from './rules';
import { moveProjectiles, useMoves } from './systems/attack';
import { applyCommands } from './systems/commands';
import { moveEnemies, rebuildEnemyHash, separateEnemies } from './systems/enemyMovement';
import { movePlayers } from './systems/movement';
import { spawnEnemies } from './systems/spawn';
import { tickStatuses } from './systems/status';
import { collectGems, dropGems, moveGems } from './systems/gems';
import { openLevelUpIfPending, recomputeModifiers, stepLevelUp } from './systems/leveling';
import { emptyModifiers } from './upgrades';
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

/** プレイヤーの初期値。技を省略したら技の定義の最初の技をレベル1で覚える（テスト用の簡便さ） */
export type PlayerSpawn = Omit<PlayerInit, 'mods'>;

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
    const moves = spawn.moves ?? (this.world.rules.moves.length > 0 ? [{ move: 0, level: 1 }] : []);
    const p = createPlayer({
      rerolls: this.world.rules.leveling.initialRerolls,
      ...spawn,
      moves: moves.slice(0, this.world.rules.combat.maxMoveSlots),
      mods: emptyModifiers(this.world.rules.types.names.length),
    });
    recomputeModifiers(this.world, p);
    this.world.players.push(p);
    return p;
  }

  step(commands: readonly InputCommand[]): void {
    const w = this.world;
    w.events.length = 0;
    applyCommands(w, commands);
    // レベルアップの選択中は全員のゲームを止める（入力の状態と選択だけ受け付ける）
    if (w.levelUp) {
      stepLevelUp(w);
      return;
    }
    movePlayers(w);
    spawnEnemies(w);
    moveEnemies(w);
    rebuildEnemyHash(w);
    separateEnemies(w);
    tickStatuses(w);
    useMoves(w);
    moveProjectiles(w);
    dropGems(w);
    moveGems(w);
    collectGems(w);
    openLevelUpIfPending(w);
    w.enemies.removeDead();
    w.tick++;
  }
}
