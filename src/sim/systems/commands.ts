import type { InputCommand } from '../commands';
import type { HitEffect } from '../events';
import { currentWaveIndex, findEnemyIndex, findPlayer, type World } from '../world';
import { breakOnDamage, damageTakenMultiplier } from './status';
import { confirmPickup } from './gems';
import { addXp, applyOffer, banUpgrade, chooseUpgrade, mirrorLevelUp, rerollUpgrades, skipUpgrade } from './leveling';
import { addHazard, endRun } from './stage';
import { applyRevive } from './health';

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
        if (cmd.maxHp !== undefined) p.maxHp = cmd.maxHp;
        // 復活させた直後は、本人から「倒れている」がまだ届くので無視する
        if (!world.reviveGrace.has(p.id)) {
          if (cmd.hp !== undefined) p.hp = cmd.hp;
          if (cmd.down !== undefined) p.down = cmd.down;
        }
        break;
      }
      case 'spawnEnemy': {
        const kind = world.rules.enemies.kinds[cmd.kind];
        if (!kind) break;
        // 接触ダメージは自分の今の時間帯の倍率で（自分が受けるダメージは自分のブラウザで判定するため）
        const wave = world.waves[currentWaveIndex(world)]!;
        const boss = (kind.rank ?? 'normal') !== 'normal';
        e.add(cmd.id, cmd.kind, cmd.x, cmd.y, kind.hp, kind.moveSpeed, kind.radius, kind.contactDamage * (boss ? 1 : wave.damageMultiplier), cmd.vx ?? 0, cmd.vy ?? 0);
        if (boss) world.events.push({ type: 'bossAppeared', id: cmd.id, kind: cmd.kind });
        break;
      }
      case 'damageEnemy': {
        const i = findEnemyIndex(world, cmd.id);
        if (i === -1 || e.hp[i]! <= 0) break;
        applyHitEffect(world, i, cmd, cmd.by);
        world.events.push({ type: 'enemyAffected', enemyId: cmd.id, by: cmd.by, ...pickEffect(cmd) });
        e.hp[i]! -= cmd.amount * damageTakenMultiplier(world, i);
        breakOnDamage(world, i);
        if (e.hp[i]! <= 0) {
          world.events.push({ type: 'enemyKilled', enemyId: cmd.id, kind: e.kind[i]!, by: cmd.by });
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
        world.events.push({ type: 'enemyKilled', enemyId: cmd.id, kind: e.kind[i]!, by: cmd.by });
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
        addXp(world, cmd.value);
        break;
      }
      case 'chooseUpgrade':
        chooseUpgrade(world, cmd.playerId, cmd.index);
        break;
      case 'rerollUpgrades':
        rerollUpgrades(world, cmd.playerId);
        break;
      case 'skipUpgrade':
        skipUpgrade(world, cmd.playerId);
        break;
      case 'banUpgrade':
        banUpgrade(world, cmd.playerId, cmd.index);
        break;
      case 'levelUpState':
        if (world.role === 'guest') {
          mirrorLevelUp(world, cmd.state);
          for (const [id, n] of cmd.rerolls ?? []) {
            const p = findPlayer(world, id);
            if (p) p.rerolls = n;
          }
        }
        break;
      case 'applyUpgrade': {
        const p = findPlayer(world, cmd.playerId);
        if (p && world.role === 'guest') applyOffer(world, p, cmd.offer);
        break;
      }
      case 'addHazard':
        if (world.role === 'guest') addHazard(world, cmd.move, cmd.x, cmd.y, cmd.dirX, cmd.dirY, cmd.dasher);
        break;
      case 'bossHp': {
        const i = findEnemyIndex(world, cmd.id);
        if (i !== -1 && e.hp[i]! > 0) {
          e.hp[i] = Math.max(1, cmd.hp);
          e.maxHp[i] = cmd.maxHp;
          if (cmd.x !== undefined && cmd.y !== undefined) {
            e.x[i] = cmd.x;
            e.y[i] = cmd.y;
          }
        }
        break;
      }
      case 'endRun':
        if (world.role === 'guest') {
          if (cmd.legendary) world.legendary = { kind: cmd.legendary.kind, appearTick: 0, endTick: 0, spawned: true, result: cmd.legendary.result };
          endRun(world, cmd.outcome);
        }
        break;
      case 'legendaryWarning':
        if (world.role === 'guest' && !world.legendary) {
          world.legendary = { kind: cmd.kind, appearTick: 0, endTick: 0, spawned: false, result: null };
          world.cleared = true;
          world.hazards.length = 0;
          world.events.push({ type: 'legendaryWarning', kind: cmd.kind });
        }
        break;
      case 'revivePlayer':
        if (world.role === 'guest') applyRevive(world, cmd.playerId, cmd.revives);
        break;
      case 'removePlayer': {
        const k = world.players.findIndex((p) => p.id === cmd.playerId);
        if (k !== -1 && cmd.playerId !== world.localPlayerId) {
          world.players.splice(k, 1);
          world.events.push({ type: 'playerLeft', playerId: cmd.playerId });
        }
        break;
      }
      case 'correctEnemies': {
        // 経過時間（時間帯・ボスの出現時刻の表示）をホストにそろえる。少しのずれは通信の遅れなので気にしない
        if (cmd.tick !== undefined && world.role === 'guest' && Math.abs(world.tick - cmd.tick) > 3) world.tick = cmd.tick;
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
  // 中ボス・ボスは押されにくく、動きを止める状態異常の時間が短い（止め続けて倒せないようにする）
  const boss = (world.rules.enemies.kinds[world.enemies.kind[i]!]?.rank ?? 'normal') !== 'normal';
  const br = world.rules.stage.bossRules;
  const kb = boss ? br.knockbackMultiplier : 1;
  world.enemies.knockBack(i, fx.kbx * kb, fx.kby * kb, kb > 0 ? fx.kbTicks : 0);
  if (fx.status >= 0 && fx.status < world.statusKinds.length) {
    const stops = world.statusKinds[fx.status]!.speedMultiplier === 0;
    const ticks = boss && stops ? Math.round(fx.statusTicks * br.stopStatusMultiplier) : fx.statusTicks;
    if (ticks > 0) world.enemies.applyStatus(i, fx.status, ticks, by);
  }
}

export function pickEffect(fx: HitEffect): HitEffect {
  return { kbx: fx.kbx, kby: fx.kby, kbTicks: fx.kbTicks, status: fx.status, statusTicks: fx.statusTicks };
}
