import {
  MOTION_BOOMERANG,
  MOTION_FOLLOW,
  MOTION_HOMING,
  MOTION_LINEAR,
  MOTION_ORBIT,
  SHAPE_CIRCLE,
  SHAPE_LINE,
  type ProjectileSpawn,
} from '../entities/projectiles';
import type { Player, PlayerMove } from '../entities/player';
import type { HitEffect } from '../events';
import { axisToUnit } from '../math';
import { typeMultiplier, type MoveStats } from '../moves';
import type { World } from '../world';
import { applyHitEffect } from './commands';
import { healPlayer } from './health';
import { breakOnDamage, damageTakenMultiplier } from './status';

/** 一撃で倒すときのダメージ（どの雑魚の HP より大きい） */
const INSTAKILL_DAMAGE = 1e9;

/** 技のレベルの性能（レベルは 1〜最大に収める） */
export function moveStatsOf(world: World, pm: { move: number; level: number }): MoveStats {
  const levels = world.rules.moves[pm.move]!.levels;
  return levels[Math.max(1, Math.min(pm.level, levels.length)) - 1]!;
}

/** 持ち物・パッシブの効果を掛けた、その技の威力・大きさ・速さ・クールダウン */
export function scaledMoveStats(world: World, p: Player, pm: PlayerMove, st: MoveStats) {
  const def = world.rules.moves[pm.move]!;
  const m = p.mods;
  const classPct = def.damageClass === 'physical' ? m.physicalPowerPct : m.specialPowerPct;
  return {
    // ポケモンのステータス（物理・特殊の威力。種族値のランクとレベル）と、持ち物・パッシブの効果を掛ける
    power:
      st.power *
      (def.damageClass === 'physical' ? p.physicalPower : p.specialPower) *
      Math.max(0, 1 + (m.powerPct + classPct + (m.typePowerPct[def.type] ?? 0)) / 100),
    size: st.size * Math.max(0.1, 1 + (m.areaPct + (m.typeAreaPct[def.type] ?? 0)) / 100),
    speed: st.speed * Math.max(0.1, 1 + m.projectileSpeedPct / 100),
    cooldownSeconds: st.cooldownSeconds * Math.max(0.2, 1 + m.cooldownPct / 100),
  };
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

/** 一番近い敵への向き。いなければ向いている方向 */
function aim(world: World, p: Player, range: number): [number, number] {
  const t = nearestEnemy(world, p.x, p.y, range);
  if (t === -1) return axisToUnit(p.facingX, p.facingY);
  const dx = world.enemies.x[t]! - p.x;
  const dy = world.enemies.y[t]! - p.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  return [dx / d, dy / d];
}

/** 向きを spreadDegrees の範囲でばらつかせる（見た目と自分の命中だけに関わるので三角関数を使ってよい） */
function spread(world: World, dx: number, dy: number, degrees: number): [number, number] {
  if (degrees <= 0) return [dx, dy];
  const a = Math.atan2(dy, dx) + ((world.rng.next() - 0.5) * degrees * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
}

/**
 * 覚えている技を使う（技は自動で発動する）。出し方は data/schema.ts の MOVE_PATTERNS を参照。
 * nearest・facing・homing・boomerang は count 発を interval ごとに出し、それ以外は count 個を同時に出す。
 */
export function useMoves(world: World): void {
  for (const p of world.players) {
    // 倒れている間は技を使わない
    if (p.down) continue;
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
      const needsTarget = def.pattern === 'nearest' || def.pattern === 'homing';
      // 射程内に敵がいなければ待つ
      if (needsTarget && nearestEnemy(world, p.x, p.y, st.range) === -1) {
        pm.cooldown = 0;
        continue;
      }
      pm.cooldown = scaledMoveStats(world, p, pm, st).cooldownSeconds;
      switch (def.pattern) {
        case 'nearest':
        case 'facing':
        case 'homing':
        case 'boomerang':
          pm.burstLeft = st.count;
          pm.burstTimer = 0;
          fireBurst(world, p, pm, st);
          break;
        case 'melee':
          fireMelee(world, p, pm, st);
          break;
        case 'orbit':
          fireOrbit(world, p, pm, st);
          break;
        case 'beam':
          fireBeam(world, p, pm, st);
          break;
        case 'ground':
          fireGround(world, p, pm, st);
          break;
        case 'nova':
          fireNova(world, p, pm, st);
          break;
      }
    }
  }
}

function base(world: World, p: Player, pm: PlayerMove, st: MoveStats): Omit<ProjectileSpawn, 'motion' | 'x' | 'y'> {
  const sc = scaledMoveStats(world, p, pm, st);
  return {
    owner: p.id,
    move: pm.move,
    level: pm.level,
    damage: sc.power,
    radius: sc.size,
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
    shape: SHAPE_CIRCLE,
    length: 0,
    dirX: 0,
    dirY: 0,
    growth: 0,
  };
}

/** nearest・facing・homing・boomerang: 間隔が来た分だけ1発ずつ飛ばす */
function fireBurst(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const def = world.rules.moves[pm.move]!;
  pm.burstTimer -= pm.burstTimer > 0 ? world.dt : 0;
  while (pm.burstLeft > 0 && pm.burstTimer <= 0) {
    let dir: [number, number];
    if (def.pattern === 'nearest' || def.pattern === 'homing') {
      const t = nearestEnemy(world, p.x, p.y, st.range);
      if (t === -1) {
        pm.burstLeft = 0;
        return;
      }
      dir = aim(world, p, st.range);
    } else {
      dir = axisToUnit(p.facingX, p.facingY);
    }
    const [dx, dy] = spread(world, dir[0], dir[1], st.spreadDegrees);
    const speed = scaledMoveStats(world, p, pm, st).speed;
    const motion = def.pattern === 'homing' ? MOTION_HOMING : def.pattern === 'boomerang' ? MOTION_BOOMERANG : MOTION_LINEAR;
    // boomerang は出したときの速度を ox・oy に覚えておき、時間とともに減速・反転させる
    world.projectiles.add({
      ...base(world, p, pm, st),
      motion,
      x: p.x,
      y: p.y,
      vx: dx * speed,
      vy: dy * speed,
      ox: dx * speed,
      oy: dy * speed,
    });
    pm.burstLeft--;
    pm.burstTimer += st.intervalSeconds;
  }
}

/** melee: 向いている方向 → 反対側 → 左 → 右 の順に当たり判定を出す（持ち主に付いていく。range 0 なら自分の周り） */
function fireMelee(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const [fx, fy] = axisToUnit(p.facingX, p.facingY);
  const dirs: [number, number][] = [
    [fx, fy],
    [-fx, -fy],
    [-fy, fx],
    [fy, -fx],
  ];
  const n = st.range > 0 ? Math.min(st.count, dirs.length) : 1;
  for (let k = 0; k < n; k++) {
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
 * beam: 一番近い敵（いなければ向いている方向）へ直線を出す。count 2 以上は少しずつ角度をずらす。
 * spreadDegrees があれば、その角度の中に等間隔に並べる（じわれ: 360 で四方へ）
 */
function fireBeam(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const [ax, ay] = aim(world, p, st.range);
  const step = st.spreadDegrees > 0 ? st.spreadDegrees / st.count : 12;
  for (let k = 0; k < st.count; k++) {
    const offset = ((k - (st.count - 1) / 2) * step * Math.PI) / 180;
    const a = Math.atan2(ay, ax) + offset;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_FOLLOW, x: p.x, y: p.y, shape: SHAPE_LINE, length: st.range, dirX: dx, dirY: dy, vx: dx, vy: dy });
  }
}

/** ground: 一番近い敵の位置（いなければ前方 range の位置）に、地面に残る当たり判定を置く */
function fireGround(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const t = nearestEnemy(world, p.x, p.y, st.range);
  let tx: number;
  let ty: number;
  if (t !== -1) {
    tx = world.enemies.x[t]!;
    ty = world.enemies.y[t]!;
  } else {
    const [fx, fy] = axisToUnit(p.facingX, p.facingY);
    tx = p.x + fx * st.range * 0.5;
    ty = p.y + fy * st.range * 0.5;
  }
  const sc = scaledMoveStats(world, p, pm, st);
  for (let k = 0; k < st.count; k++) {
    // 2つ目以降は周りに散らす
    const r = k === 0 ? 0 : sc.size * 1.5 * (0.5 + world.rng.next());
    const a = world.rng.next() * Math.PI * 2;
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x: tx + Math.cos(a) * r, y: ty + Math.sin(a) * r });
  }
}

/** nova: 自分を中心に、大きさ size から range まで広がる輪 */
function fireNova(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const sc = scaledMoveStats(world, p, pm, st);
  const growth = Math.max(0, (st.range - sc.size) / st.durationSeconds);
  for (let k = 0; k < st.count; k++) {
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_FOLLOW, x: p.x, y: p.y, growth, life: st.durationSeconds * (1 + k * 0.6) });
  }
}

/** 点 (px, py) と、始点 (x, y)・向き (dx, dy)・長さ len の線分との距離の2乗 */
function segmentDistance2(px: number, py: number, x: number, y: number, dx: number, dy: number, len: number): number {
  const t = Math.max(0, Math.min(len, (px - x) * dx + (py - y) * dy));
  const cx = x + dx * t - px;
  const cy = y + dy * t - py;
  return cx * cx + cy * cy;
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
    } else if (motion === MOTION_BOOMERANG) {
      // 出したときの速度 (ox, oy) から、残り時間の半分で止まり、その後は戻ってくる
      const k = 1 - 2 * (1 - pr.life[i]! / pr.maxLife[i]!);
      pr.x[i]! += pr.ox[i]! * k * world.dt;
      pr.y[i]! += pr.oy[i]! * k * world.dt;
    } else if (motion === MOTION_HOMING) {
      const t = nearestEnemy(world, pr.x[i]!, pr.y[i]!, 300);
      if (t !== -1) {
        const dx = e.x[t]! - pr.x[i]!;
        const dy = e.y[t]! - pr.y[i]!;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const sp = Math.sqrt(pr.vx[i]! * pr.vx[i]! + pr.vy[i]! * pr.vy[i]!);
        pr.vx[i] = (dx / d) * sp;
        pr.vy[i] = (dy / d) * sp;
      }
      pr.x[i]! += pr.vx[i]! * world.dt;
      pr.y[i]! += pr.vy[i]! * world.dt;
    } else if (!owner) {
      pr.removeAt(i);
      continue;
    } else if (motion === MOTION_FOLLOW) {
      pr.x[i] = owner.x + pr.ox[i]!;
      pr.y[i] = owner.y + pr.oy[i]!;
      pr.radius[i]! += pr.growth[i]! * world.dt;
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
    const line = pr.shape[i] === SHAPE_LINE;
    const reach = pr.radius[i]! + maxEnemyRadius;
    const len = line ? pr.length[i]! : 0;
    const ex = x + pr.dirX[i]! * len;
    const ey = y + pr.dirY[i]! * len;
    const n = enemyHash.queryRect(Math.min(x, ex) - reach, Math.min(y, ey) - reach, Math.max(x, ex) + reach, Math.max(y, ey) + reach, scratch);
    // 重なっていて、今当たれる敵を集める
    let hits = 0;
    for (let k = 0; k < n; k++) {
      const j = scratch[k]!;
      if (e.hp[j]! <= 0 || pr.isBlocked(i, e.id[j]!, world.tick)) continue;
      const r = pr.radius[i]! + e.radius[j]!;
      const d2 = line
        ? segmentDistance2(e.x[j]!, e.y[j]!, x, y, pr.dirX[i]!, pr.dirY[i]!, len)
        : (e.x[j]! - x) * (e.x[j]! - x) + (e.y[j]! - y) * (e.y[j]! - y);
      if (d2 <= r * r) hitScratch[hits++] = j;
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
    let hitX = x;
    let hitY = y;
    for (let k = 0; k < candidates.length && pr.pierceLeft[i]! > 0; k++) {
      const j = candidates[k]!;
      // ハッシュの衝突で同じ敵が2回入っていることがある
      if (pr.isBlocked(i, e.id[j]!, world.tick)) continue;
      pr.recordHit(i, e.id[j]!, world.tick);
      pr.pierceLeft[i]!--;
      hitAny = true;
      if (line) {
        hitX = e.x[j]!;
        hitY = e.y[j]!;
      }
      if (!local) continue;
      // ノックバックの向き: 直線は線の向き、それ以外は当たり判定から敵へ（重なっていれば進む向き）
      const kx = line ? pr.dirX[i]! : e.x[j]! - x || pr.vx[i]!;
      const ky = line ? pr.dirY[i]! : e.y[j]! - y || pr.vy[i]!;
      // 効果（ノックバック・状態異常）は当てたプレイヤーの画面ですぐ付け、相手へは命中と一緒に送る
      const fx = rollHitEffect(world, st, kx, ky);
      applyHitEffect(world, j, fx, ownerId);
      const kind = world.rules.enemies.kinds[e.kind[j]!];
      // 急所（クリティカットなど・技ごとの急所）の判定は、当てたプレイヤーのブラウザの乱数で行う
      const critPct = (owner?.mods.critChancePct ?? 0) + st.critChancePct;
      const crit = critPct > 0 && world.rng.next() * 100 < critPct;
      // 一撃（じわれ）: 雑魚だけ。当てたプレイヤーのブラウザの乱数で決め、倒しきる量を送る
      const instakill = st.instakillChance > 0 && (kind?.rank ?? 'normal') === 'normal' && world.rng.next() < st.instakillChance;
      const amount = instakill
        ? INSTAKILL_DAMAGE
        : pr.damage[i]! *
          typeMultiplier(world.rules.types, world.rules.combat.typeMultipliers, def.type, owner?.types ?? [], kind?.types ?? []) *
          (crit ? world.rules.combat.critMultiplier : 1);
      // 吸収（ギガドレインなど）: 与えたダメージの一部を回復する
      if (st.lifestealPct > 0) healPlayer(world, ownerId, (amount * st.lifestealPct) / 100);
      if (world.role === 'guest') {
        world.events.push({ type: 'damageDealt', enemyId: e.id[j]!, amount, by: ownerId, ...fx });
        continue;
      }
      if (world.role === 'host') world.events.push({ type: 'enemyAffected', enemyId: e.id[j]!, by: ownerId, ...fx });
      e.hp[j]! -= amount * damageTakenMultiplier(world, j);
      breakOnDamage(world, j);
      if (e.hp[j]! <= 0) {
        world.events.push({ type: 'enemyKilled', enemyId: e.id[j]!, kind: e.kind[j]!, by: ownerId });
        world.stats.kills++;
      }
    }
    if (hitAny) world.events.push({ type: 'projectileHit', x: hitX, y: hitY, owner: ownerId, move: pr.move[i]! });
    if (pr.pierceLeft[i]! <= 0) pr.removeAt(i);
  }
}

/**
 * 命中の効果を決める。ノックバックは (dirX, dirY) の向き。
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
