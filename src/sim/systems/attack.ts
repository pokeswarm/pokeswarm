import { MOTION_FOLLOW, MOTION_LINEAR, MOTION_ORBIT } from '../entities/projectiles';
import type { Player, PlayerMove } from '../entities/player';
import type { HitEffect } from '../events';
import { axisToUnit } from '../math';
import { typeMultiplier, type MoveStats } from '../moves';
import type { World } from '../world';
import { applyHitEffect } from './commands';
import { damageTakenMultiplier } from './status';

/** 技のレベルの性能（レベルは 1〜最大に収める） */
export function moveStatsOf(world: World, pm: { move: number; level: number }): MoveStats {
  const levels = world.rules.moves[pm.move]!.levels;
  return levels[Math.max(1, Math.min(pm.level, levels.length)) - 1]!;
}

/** 射程内の一番近い敵の index。いなければ -1（同じ距離なら id の小さい方。ハッシュの並び順に左右されないように） */
function nearestEnemy(world: World, x: number, y: number, range: number): number {
  const { enemies: e, enemyHash, scratch } = world;
  const n = enemyHash.queryRect(x - range, y - range, x + range, y + range, scratch);
  let best = -1;
  let bestD2 = range * range;
  for (let k = 0; k < n; k++) {
    const i = scratch[k]!;
    if (e.hp[i]! <= 0) continue;
    const dx = e.x[i]! - x;
    const dy = e.y[i]! - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2 || (d2 === bestD2 && best !== -1 && e.id[i]! < e.id[best]!)) {
      bestD2 = d2;
      best = i;
    }
  }
  return best;
}

/**
 * 覚えている技を使う（技は自動で発動する）。出し方（pattern）ごとに当たり判定を作る:
 * - nearest・facing: count 発を interval ごとに飛ばす
 * - melee: 向いている方向（count 2 で反対側、3・4 で左右も）に一瞬の当たり判定
 * - orbit: count 個の当たり判定が持ち主の周りを回る
 */
export function useMoves(world: World): void {
  for (const p of world.players) {
    for (const pm of p.moves) {
      const def = world.rules.moves[pm.move];
      if (!def) continue;
      const st = moveStatsOf(world, pm);
      pm.cooldown -= world.dt;
      if (pm.burstLeft > 0) {
        fireBurst(world, p, pm, st);
        continue;
      }
      if (pm.cooldown > 0) continue;
      switch (def.pattern) {
        case 'nearest':
          // 射程内に敵がいなければ待つ
          if (nearestEnemy(world, p.x, p.y, st.range) === -1) {
            pm.cooldown = 0;
            continue;
          }
          pm.burstLeft = st.count;
          pm.burstTimer = 0;
          pm.cooldown = st.cooldownSeconds;
          fireBurst(world, p, pm, st);
          break;
        case 'facing':
          pm.burstLeft = st.count;
          pm.burstTimer = 0;
          pm.cooldown = st.cooldownSeconds;
          fireBurst(world, p, pm, st);
          break;
        case 'melee':
          fireMelee(world, p, pm, st);
          pm.cooldown = st.cooldownSeconds;
          break;
        case 'orbit':
          fireOrbit(world, p, pm, st);
          pm.cooldown = st.cooldownSeconds;
          break;
      }
    }
  }
}

function base(world: World, p: Player, pm: PlayerMove, st: MoveStats) {
  return {
    owner: p.id,
    move: pm.move,
    level: pm.level,
    // ポケモンのステータス（物理・特殊の威力）は区切り3で掛ける
    damage: st.power,
    radius: st.size,
    pierce: st.pierce,
    life: st.durationSeconds,
    hitIntervalTicks: Math.round(st.hitIntervalSeconds / world.dt),
    vx: 0,
    vy: 0,
    ox: 0,
    oy: 0,
    angle: 0,
    angularSpeed: 0,
    orbitRadius: 0,
  };
}

/** nearest・facing: 間隔が来た分だけ1発ずつ飛ばす */
function fireBurst(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const def = world.rules.moves[pm.move]!;
  pm.burstTimer -= pm.burstTimer > 0 ? world.dt : 0;
  while (pm.burstLeft > 0 && pm.burstTimer <= 0) {
    let dx: number;
    let dy: number;
    if (def.pattern === 'nearest') {
      const t = nearestEnemy(world, p.x, p.y, st.range);
      if (t === -1) {
        pm.burstLeft = 0;
        return;
      }
      dx = world.enemies.x[t]! - p.x;
      dy = world.enemies.y[t]! - p.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= d;
      dy /= d;
    } else {
      [dx, dy] = axisToUnit(p.facingX, p.facingY);
    }
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x: p.x, y: p.y, vx: dx * st.speed, vy: dy * st.speed });
    pm.burstLeft--;
    pm.burstTimer += st.intervalSeconds;
  }
}

/** melee: 向いている方向 → 反対側 → 左 → 右 の順に当たり判定を出す（持ち主に付いていく） */
function fireMelee(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const [fx, fy] = axisToUnit(p.facingX, p.facingY);
  const dirs: [number, number][] = [
    [fx, fy],
    [-fx, -fy],
    [-fy, fx],
    [fy, -fx],
  ];
  for (let k = 0; k < Math.min(st.count, dirs.length); k++) {
    const [dx, dy] = dirs[k]!;
    const ox = dx * st.range;
    const oy = dy * st.range;
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_FOLLOW, x: p.x + ox, y: p.y + oy, ox, oy, vx: dx, vy: dy });
  }
}

/** orbit: count 個を等間隔に並べて回す（回る速さ speed は円周上の速さ） */
function fireOrbit(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const angularSpeed = st.range > 0 ? st.speed / st.range : 0;
  for (let k = 0; k < st.count; k++) {
    const angle = (k / st.count) * Math.PI * 2;
    world.projectiles.add({
      ...base(world, p, pm, st),
      motion: MOTION_ORBIT,
      x: p.x + Math.cos(angle) * st.range,
      y: p.y + Math.sin(angle) * st.range,
      angle,
      angularSpeed,
      orbitRadius: st.range,
    });
  }
}

/**
 * 当たり判定を動かし、敵に当たったらダメージを与える。HP が 0 以下になった敵の撃破を記録する。
 * 同じ敵には、当たり直しの間隔（無ければ1回だけ）を空けないと当たらない。貫通可能数を使い切ったら消える。
 * 当たり判定の位置は描画と自分の命中判定にだけ使うので、三角関数を使ってよい（ほかのブラウザとそろえる必要がない）。
 */
export function moveProjectiles(world: World): void {
  const { projectiles: pr, enemies: e, enemyHash, scratch, hitScratch } = world;
  let maxEnemyRadius = 0;
  for (const k of world.rules.enemies.kinds) maxEnemyRadius = Math.max(maxEnemyRadius, k.radius);
  // 末尾から回す（removeAt で末尾の要素が手前に来ても、処理済みなので問題ない）
  for (let i = pr.count - 1; i >= 0; i--) {
    pr.prevX[i] = pr.x[i]!;
    pr.prevY[i] = pr.y[i]!;
    const owner = world.players.find((p) => p.id === pr.owner[i]);
    const motion = pr.motion[i]!;
    if (motion === MOTION_LINEAR) {
      pr.x[i]! += pr.vx[i]! * world.dt;
      pr.y[i]! += pr.vy[i]! * world.dt;
    } else if (!owner) {
      pr.removeAt(i);
      continue;
    } else if (motion === MOTION_FOLLOW) {
      pr.x[i] = owner.x + pr.ox[i]!;
      pr.y[i] = owner.y + pr.oy[i]!;
    } else if (motion === MOTION_ORBIT) {
      pr.angle[i]! += pr.angularSpeed[i]! * world.dt;
      pr.x[i] = owner.x + Math.cos(pr.angle[i]!) * pr.orbitRadius[i]!;
      pr.y[i] = owner.y + Math.sin(pr.angle[i]!) * pr.orbitRadius[i]!;
    }
    pr.life[i]! -= world.dt;
    if (pr.life[i]! <= 0) {
      pr.removeAt(i);
      continue;
    }
    const x = pr.x[i]!;
    const y = pr.y[i]!;
    const reach = pr.radius[i]! + maxEnemyRadius;
    const n = enemyHash.queryRect(x - reach, y - reach, x + reach, y + reach, scratch);
    // 重なっていて、今当たれる敵を集める
    let hits = 0;
    for (let k = 0; k < n; k++) {
      const j = scratch[k]!;
      if (e.hp[j]! <= 0 || pr.isBlocked(i, e.id[j]!, world.tick)) continue;
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
    const ownerId = pr.owner[i]!;
    const local = ownerId === world.localPlayerId;
    const def = world.rules.moves[pr.move[i]!]!;
    const st = moveStatsOf(world, { move: pr.move[i]!, level: pr.level[i]! });
    let hitAny = false;
    for (let k = 0; k < candidates.length && pr.pierceLeft[i]! > 0; k++) {
      const j = candidates[k]!;
      // ハッシュの衝突で同じ敵が2回入っていることがある
      if (pr.isBlocked(i, e.id[j]!, world.tick)) continue;
      pr.recordHit(i, e.id[j]!, world.tick);
      pr.pierceLeft[i]!--;
      hitAny = true;
      if (!local) continue;
      // 効果（ノックバック・状態異常）は当てたプレイヤーの画面ですぐ付け、相手へは命中と一緒に送る
      const fx = rollHitEffect(world, st, e.x[j]! - x || pr.vx[i]!, e.y[j]! - y || pr.vy[i]!);
      applyHitEffect(world, j, fx, ownerId);
      const kind = world.rules.enemies.kinds[e.kind[j]!];
      const amount =
        pr.damage[i]! * typeMultiplier(world.rules.types, world.rules.combat.typeMultipliers, def.type, owner?.types ?? [], kind?.types ?? []);
      if (world.role === 'guest') {
        world.events.push({ type: 'damageDealt', enemyId: e.id[j]!, amount, by: ownerId, ...fx });
        continue;
      }
      if (world.role === 'host') world.events.push({ type: 'enemyAffected', enemyId: e.id[j]!, by: ownerId, ...fx });
      e.hp[j]! -= amount * damageTakenMultiplier(world, j);
      if (e.hp[j]! <= 0) {
        world.events.push({ type: 'enemyKilled', enemyId: e.id[j]!, by: ownerId });
        world.stats.kills++;
      }
    }
    if (hitAny) world.events.push({ type: 'projectileHit', x, y, owner: ownerId, move: pr.move[i]! });
    if (pr.pierceLeft[i]! <= 0) pr.removeAt(i);
  }
}

/**
 * 命中の効果を決める。ノックバックは当たり判定から敵へ向かう向き（重なっていれば進む向き）。
 * 状態異常が付くかの判定は、当てたプレイヤーのブラウザの乱数で行う（03_network.md 3.2）。
 */
function rollHitEffect(world: World, st: MoveStats, dirX: number, dirY: number): HitEffect {
  let kbx = 0;
  let kby = 0;
  let kbTicks = 0;
  if (st.knockback > 0 && st.knockbackSeconds > 0) {
    const len = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
    kbx = (dirX / len) * st.knockback;
    kby = (dirY / len) * st.knockback;
    kbTicks = Math.round(st.knockbackSeconds / world.dt);
  }
  let status = -1;
  let statusTicks = 0;
  if (st.status >= 0 && st.statusChance > 0 && world.rng.next() < st.statusChance) {
    status = st.status;
    statusTicks = Math.round(st.statusSeconds / world.dt);
  }
  return { kbx, kby, kbTicks, status, statusTicks };
}
