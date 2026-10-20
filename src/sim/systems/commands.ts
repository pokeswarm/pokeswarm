import type { InputCommand } from '../commands';
import { findEnemyIndex, findPlayer, type World } from '../world';

export function applyCommands(world: World, commands: readonly InputCommand[]): void {
  const e = world.enemies;
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'move': {
        const p = findPlayer(world, cmd.playerId);
        if (!p || p.remote) break;
        p.inputX = cmd.dx;
        p.inputY = cmd.dy;
        break;
      }
      case 'remotePlayer': {
        const p = findPlayer(world, cmd.playerId);
        if (!p || !p.remote) break;
        p.netX = cmd.x;
        p.netY = cmd.y;
        p.facingX = cmd.facingX;
        p.facingY = cmd.facingY;
        p.inputX = cmd.inputX;
        p.inputY = cmd.inputY;
        break;
      }
      case 'spawnEnemy': {
        const kind = world.rules.enemies.kinds[cmd.kind];
        if (!kind) break;
        e.add(cmd.id, cmd.kind, cmd.x, cmd.y, kind.hp, kind.moveSpeed, kind.radius);
        break;
      }
      case 'damageEnemy': {
        const i = findEnemyIndex(world, cmd.id);
        if (i === -1 || e.hp[i]! <= 0) break;
        e.hp[i]! -= cmd.amount;
        if (e.hp[i]! <= 0) {
          world.events.push({ type: 'enemyKilled', enemyId: cmd.id, by: cmd.by });
          world.stats.kills++;
        }
        break;
      }
      case 'killEnemy': {
        const i = findEnemyIndex(world, cmd.id);
        if (i === -1 || e.hp[i]! <= 0) break;
        e.hp[i] = 0;
        world.events.push({ type: 'enemyKilled', enemyId: cmd.id, by: cmd.by });
        world.stats.kills++;
        break;
      }
      case 'retireEnemy': {
        const i = findEnemyIndex(world, cmd.id);
        if (i !== -1) e.hp[i] = 0;
        break;
      }
      case 'correctEnemies': {
        const index = new Map<number, number>();
        for (let i = 0; i < e.count; i++) index.set(e.id[i]!, i);
        for (let k = 0; k + 2 < cmd.data.length; k += 3) {
          const i = index.get(cmd.data[k]!);
          if (i === undefined) continue;
          e.x[i] = cmd.data[k + 1]!;
          e.y[i] = cmd.data[k + 2]!;
        }
        break;
      }
    }
  }
}
