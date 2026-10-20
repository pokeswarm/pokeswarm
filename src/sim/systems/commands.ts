import type { InputCommand } from '../commands';
import type { HitEffect } from '../events';
import { findEnemyIndex, findPlayer, type World } from '../world';
import { damageTakenMultiplier } from './status';
import { confirmPickup } from './gems';

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
        applyHitEffect(world, i, cmd, cmd.by);
        world.events.push({ type: 'enemyAffected', enemyId: cmd.id, by: cmd.by, ...pickEffect(cmd) });
        e.hp[i]! -= cmd.amount * damageTakenMultiplier(world, i);
        if (e.hp[i]! <= 0) {
          world.events.push({ type: 'enemyKilled', enemyId: cmd.id, by: cmd.by });
          world.stats.kills++;
        }
        break;
      }
      case 'affectEnemy': {
        // 自分が当てた分は自分の画面で付け済み
        if (cmd.by === world.localPlayerId) break;
        const i = findEnemyIndex(world, cmd.id);
        if (i !== -1) applyHitEffect(world, i, cmd, cmd.by);
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
      case 'spawnGem':
        world.gems.add(cmd.id, cmd.x, cmd.y, cmd.value, world.rules.pickups.gemRadius);
        break;
      case 'mergeGem': {
        const g = world.gems.indexOf(cmd.id);
        if (g !== -1) world.gems.value[g] = cmd.value;
        break;
      }
      case 'requestPickup':
        if (world.role === 'host') confirmPickup(world, cmd.id, cmd.by);
        break;
      case 'collectGem': {
        // 経験値はホストが確定したものだけを足す（同じ玉を2回数えない）
        const g = world.gems.indexOf(cmd.id);
        if (g !== -1) world.gems.removeAt(g);
        world.xp += cmd.value;
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

/** 命中の効果（ノックバック・状態異常）を敵に付ける */
export function applyHitEffect(world: World, i: number, fx: HitEffect, by: number): void {
  world.enemies.knockBack(i, fx.kbx, fx.kby, fx.kbTicks);
  if (fx.status >= 0 && fx.status < world.statusKinds.length) world.enemies.applyStatus(i, fx.status, fx.statusTicks, by);
}

export function pickEffect(fx: HitEffect): HitEffect {
  return { kbx: fx.kbx, kby: fx.kby, kbTicks: fx.kbTicks, status: fx.status, statusTicks: fx.statusTicks };
}
