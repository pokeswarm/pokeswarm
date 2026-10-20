import type { World } from '../world';

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
    projectiles.add(p.id, p.x, p.y, vx, vy, a.projectileLifetimeSeconds, a.damage, a.projectileRadius);
    p.attackCooldown += a.cooldownSeconds;
  }
}

/** 発射体を動かし、敵に当たったらダメージを与える。HP が 0 以下になった敵の撃破を記録する */
export function moveProjectiles(world: World): void {
  const { projectiles: pr, enemies: e, enemyHash, scratch } = world;
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
    let hit = -1;
    for (let k = 0; k < n; k++) {
      const j = scratch[k]!;
      if (e.hp[j]! <= 0) continue;
      const dx = e.x[j]! - x;
      const dy = e.y[j]! - y;
      const r = pr.radius[i]! + e.radius[j]!;
      if (dx * dx + dy * dy <= r * r && (hit === -1 || e.id[j]! < e.id[hit]!)) hit = j;
    }
    if (hit === -1) continue;
    e.hp[hit]! -= pr.damage[i]!;
    if (e.hp[hit]! <= 0) {
      world.events.push({ type: 'enemyKilled', enemyId: e.id[hit]!, by: pr.owner[i]! });
      world.stats.kills++;
    }
    pr.removeAt(i);
  }
}
