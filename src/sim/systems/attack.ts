import type { HitEffect } from '../events';
import type { World } from '../world';
import { applyHitEffect } from './commands';
import { damageTakenMultiplier } from './status';

/**
 * 仮の自動攻撃: 一定間隔で、射程内の一番近い敵へ弾を撃つ。
 * 技の仕組み（フェーズ1）ができたら置き換える。
 */
export function playerAttacks(world: World): void {
  const { enemies: e, enemyHash, scratch, projectiles } = world;
  const a = world.rules.attack;
  const range2 = a.range * a.range;
  for (const p of world.players) {
    p.attackCooldown -= world.dt;
    if (p.attackCooldown > 0) continue;
    const n = enemyHash.queryRect(p.x - a.range, p.y - a.range, p.x + a.range, p.y + a.range, scratch);
    let best = -1;
    let bestD2 = range2;
    for (let k = 0; k < n; k++) {
      const i = scratch[k]!;
      if (e.hp[i]! <= 0) continue;
      const dx = e.x[i]! - p.x;
      const dy = e.y[i]! - p.y;
      const d2 = dx * dx + dy * dy;
      // 同じ距離なら id の小さい方（ハッシュの並び順に左右されないように）
      if (d2 < bestD2 || (d2 === bestD2 && best !== -1 && e.id[i]! < e.id[best]!)) {
        bestD2 = d2;
        best = i;
      }
    }
    if (best === -1) {
      p.attackCooldown = 0;
      continue;
    }
    const d = Math.sqrt(bestD2) || 1;
    const vx = ((e.x[best]! - p.x) / d) * a.projectileSpeed;
    const vy = ((e.y[best]! - p.y) / d) * a.projectileSpeed;
    const pierce = a.pierce === 'infinite' ? Infinity : a.pierce;
    projectiles.add(p.id, p.x, p.y, vx, vy, a.projectileLifetimeSeconds, a.damage, a.projectileRadius, pierce);
    p.attackCooldown += a.cooldownSeconds;
  }
}

/**
 * 発射体を動かし、敵に当たったらダメージを与える。HP が 0 以下になった敵の撃破を記録する。
 * 1つの発射体は同じ敵に1回だけ当たり、貫通可能数を使い切ったら消える。
 */
export function moveProjectiles(world: World): void {
  const { projectiles: pr, enemies: e, enemyHash, scratch, hitScratch } = world;
  let maxEnemyRadius = 0;
  for (const k of world.rules.enemies.kinds) maxEnemyRadius = Math.max(maxEnemyRadius, k.radius);
  // 末尾から回す（removeAt で末尾の要素が手前に来ても、処理済みなので問題ない）
  for (let i = pr.count - 1; i >= 0; i--) {
    pr.prevX[i] = pr.x[i]!;
    pr.prevY[i] = pr.y[i]!;
    pr.x[i]! += pr.vx[i]! * world.dt;
    pr.y[i]! += pr.vy[i]! * world.dt;
    pr.life[i]! -= world.dt;
    if (pr.life[i]! <= 0) {
      pr.removeAt(i);
      continue;
    }
    const x = pr.x[i]!;
    const y = pr.y[i]!;
    const reach = pr.radius[i]! + maxEnemyRadius;
    const n = enemyHash.queryRect(x - reach, y - reach, x + reach, y + reach, scratch);
    // 重なっていて、まだ当てていない敵を集める
    let hits = 0;
    for (let k = 0; k < n; k++) {
      const j = scratch[k]!;
      if (e.hp[j]! <= 0 || pr.hasHit(i, e.id[j]!)) continue;
      const dx = e.x[j]! - x;
      const dy = e.y[j]! - y;
      const r = pr.radius[i]! + e.radius[j]!;
      if (dx * dx + dy * dy <= r * r) hitScratch[hits++] = j;
    }
    if (hits === 0) continue;
    // 同じ更新で複数に重なったら id の小さい順に当てる（ハッシュの並び順に左右されないように）
    const candidates = hitScratch.subarray(0, hits).sort((a, b) => e.id[a]! - e.id[b]!);
    // 命中の扱い（03_network.md 3.3）:
    // - 自分の攻撃: ソロ・ホストはその場で HP を減らす。ゲストは命中をホストへ伝える（HP はホストが集計）
    // - 別のブラウザのプレイヤーの攻撃: 見た目だけ（命中の判定はそのプレイヤーのブラウザが行う）
    const owner = pr.owner[i]!;
    const local = owner === world.localPlayerId;
    let hitAny = false;
    for (let k = 0; k < candidates.length && pr.pierceLeft[i]! > 0; k++) {
      const j = candidates[k]!;
      // ハッシュの衝突で同じ敵が2回入っていることがある
      if (pr.hasHit(i, e.id[j]!)) continue;
      pr.recordHit(i, e.id[j]!);
      pr.pierceLeft[i]!--;
      hitAny = true;
      if (!local) continue;
      // 効果（ノックバック・状態異常）は当てたプレイヤーの画面ですぐ付け、相手へは命中と一緒に送る
      const fx = rollHitEffect(world, pr.vx[i]!, pr.vy[i]!);
      applyHitEffect(world, j, fx, owner);
      if (world.role === 'guest') {
        world.events.push({ type: 'damageDealt', enemyId: e.id[j]!, amount: pr.damage[i]!, by: owner, ...fx });
        continue;
      }
      if (world.role === 'host') world.events.push({ type: 'enemyAffected', enemyId: e.id[j]!, by: owner, ...fx });
      e.hp[j]! -= pr.damage[i]! * damageTakenMultiplier(world, j);
      if (e.hp[j]! <= 0) {
        world.events.push({ type: 'enemyKilled', enemyId: e.id[j]!, by: owner });
        world.stats.kills++;
      }
    }
    if (hitAny) world.events.push({ type: 'projectileHit', x, y, owner: pr.owner[i]! });
    if (pr.pierceLeft[i]! <= 0) pr.removeAt(i);
  }
}

/**
 * 仮の自動攻撃の効果を決める。ノックバックは発射体の進む向き。
 * 状態異常が付くかの判定は、当てたプレイヤーのブラウザの乱数で行う（03_network.md 3.2）。
 */
function rollHitEffect(world: World, vx: number, vy: number): HitEffect {
  const a = world.rules.attack;
  const tickRate = 1 / world.dt;
  let kbx = 0;
  let kby = 0;
  let kbTicks = 0;
  if (a.knockback && a.knockback.speed > 0) {
    const len = Math.sqrt(vx * vx + vy * vy) || 1;
    kbx = (vx / len) * a.knockback.speed;
    kby = (vy / len) * a.knockback.speed;
    kbTicks = Math.round(a.knockback.durationSeconds * tickRate);
  }
  let status = -1;
  let statusTicks = 0;
  if (a.status && world.rng.next() < a.status.chance) {
    status = world.statusKinds.findIndex((k) => k.id === a.status!.id);
    statusTicks = Math.round(a.status.durationSeconds * tickRate);
  }
  return { kbx, kby, kbTicks, status, statusTicks };
}
