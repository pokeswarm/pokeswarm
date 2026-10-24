import { insideObstacle, rayLengthToObstacle } from '../obstacles';
import {
  MOTION_BOOMERANG,
  MOTION_FOLLOW,
  MOTION_HOMING,
  MOTION_LOB,
  MOTION_BOUNCE,
  MOTION_STREAM,
  MOTION_SWEEP,
  MOTION_SPIRAL,
  MOTION_LINEAR,
  MOTION_ORBIT,
  MOTION_PULSE,
  MOTION_SNAKE,
  SHAPE_CIRCLE,
  SHAPE_LINE,
  SHAPE_SECTOR,
  snakeOffset,
  type ProjectileSpawn,
} from '../entities/projectiles';
import type { Player, PlayerMove } from '../entities/player';
import type { HitEffect } from '../events';
import { axisToUnit } from '../math';
import { typeMultiplier, type MoveStats } from '../moves';
import type { World } from '../world';
import { applyHitEffect } from './commands';
import { fireDelayedExplosion, fireEffects, type FxSource } from './moveEffects';
import { healPlayer } from './health';
import { breakOnDamage, damageTakenMultiplier } from './status';

/** 持ち物の威力の倍率（でんきだま: その系統が持っているときだけ） */
function heldPowerMultiplier(world: World, p: Player): number {
  let m = 1;
  for (const it of p.items) {
    const def = world.rules.items[it.item]!;
    if (def.powerMultiplier && (!def.lines || def.lines.includes(p.line)) && (!def.forms || def.forms.includes(p.species))) m *= def.powerMultiplier;
  }
  return m;
}

/** 一撃で倒すときのダメージ（どの雑魚の HP より大きい） */
const INSTAKILL_DAMAGE = 1e9;

/** 技のレベルの性能（レベルは 1〜最大に収める） */
export function moveStatsOf(world: World, pm: { move: number; level: number }): MoveStats {
  const levels = world.rules.moves[pm.move]!.levels;
  return levels[Math.max(1, Math.min(pm.level, levels.length)) - 1]!;
}

/**
 * 持ち物の効果のうち、技の数・持続・射程・貫通を変えるもの（ポイントマックス・ひかりのねんど・ズームレンズ・するどいツメ）を足した、その技のレベルの性能
 */
export function playerMoveStats(world: World, p: Player, pm: { move: number; level: number }): MoveStats {
  const st = moveStatsOf(world, pm);
  const m = p.mods;
  if (m.amountBonus === 0 && m.durationPct === 0 && m.rangePct === 0 && m.pierceBonus === 0) return st;
  return {
    ...st,
    count: st.count + m.amountBonus,
    durationSeconds: st.durationSeconds * Math.max(0.1, 1 + m.durationPct / 100),
    range: st.range * Math.max(0.1, 1 + m.rangePct / 100),
    pierce: st.pierce + m.pierceBonus,
  };
}

/** 持ち物の効果を掛けた、その技の威力・大きさ・速さ・クールダウン */
export function scaledMoveStats(world: World, p: Player, pm: PlayerMove, st: MoveStats) {
  const def = world.rules.moves[pm.move]!;
  const m = p.mods;
  const classPct = def.damageClass === 'physical' ? m.physicalPowerPct : m.specialPowerPct;
  return {
    // ポケモンのステータス（物理・特殊の威力。種族値のランクとレベル）と、持ち物の効果を掛ける
    power:
      st.power *
      (def.damageClass === 'physical' ? p.physicalPower : p.specialPower) *
      Math.max(0, 1 + (m.powerPct + classPct + (m.typePowerPct[def.type] ?? 0)) / 100) *
      heldPowerMultiplier(world, p) *
      // とっておき: 覚えているほかの技が多いほど強い
      (1 + (st.perMovePowerPct * Math.max(0, p.moves.length - 1)) / 100),
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
      // いつも効く技（かくばる・テクスチャー）は使わない（効果は持ち物と同じく、いつも足されている）
      if (!def || def.pattern === 'passive') continue;
      const st = playerMoveStats(world, p, pm);
      pm.cooldown -= world.dt;
      if (pm.burstLeft > 0) {
        fireBurst(world, p, pm, st);
        continue;
      }
      if (pm.cooldown > 0) continue;
      const needsTarget = def.pattern === 'nearest' || def.pattern === 'homing' || def.pattern === 'chain';
      // 射程内に敵がいなければ待つ
      if (needsTarget && nearestEnemy(world, p.x, p.y, st.range) === -1) {
        pm.cooldown = 0;
        continue;
      }
      // 出した技が消えるまで次を出さない技（ボルテッカー）は、再使用を少なくとも持続の長さにする
      // 消えてから数える技（こなゆき・ふぶき）は、持続の分を足す
      pm.cooldown = Math.max(scaledMoveStats(world, p, pm, st).cooldownSeconds, def.waitForEnd ? st.durationSeconds : 0) + (def.restAfterEnd ? st.durationSeconds : 0);
      world.events.push({ type: 'moveUsed', playerId: p.id, move: pm.move });
      const from = world.projectiles.count;
      switch (def.pattern) {
        case 'nearest':
        case 'facing':
        case 'homing':
        case 'boomerang':
        case 'barrage':
          pm.burstLeft = st.count;
          pm.burstTimer = 0;
          // 向きをランダムに選ぶ技（にどげり）は、使うたびに1つの向きを選び、連撃はその向きへ
          pm.aimAngle = def.randomAim ? world.rng.next() * Math.PI * 2 : undefined;
          if (def.pattern === 'barrage' && def.body) {
            const [fx, fy] = axisToUnit(p.facingX, p.facingY);
            const a = pm.aimAngle ?? Math.atan2(fy, fx);
            world.events.push({ type: 'bodyAttack', playerId: p.id, dirX: Math.cos(a), dirY: Math.sin(a), distance: def.body.lungeDistance, afterimages: def.body.afterimages });
          }
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
        case 'screen':
          fireScreen(world, p, pm, st);
          break;
        case 'metronome':
          fireMetronome(world, p, pm);
          break;
        case 'whip':
          fireWhip(world, p, pm, st);
          break;
        case 'lob':
          fireLob(world, p, pm, st);
          break;
        case 'strike':
          fireStrike(world, p, pm, st);
          break;
        case 'chain':
          fireChain(world, p, pm, st);
          break;
        case 'bounce':
          fireBounce(world, p, pm, st);
          break;
        case 'trail':
          fireTrail(world, p, pm, st);
          break;
        case 'cross':
          fireCross(world, p, pm, st);
          break;
        case 'scatter':
          fireScatter(world, p, pm, st);
          break;
        case 'stream':
          fireStream(world, p, pm, st);
          break;
        case 'eruption':
          fireEruption(world, p, pm, st);
          break;
        case 'spin':
          fireSpin(world, p, pm, st);
          break;
        case 'heal':
          fireHeal(world, p, pm, st);
          break;
        case 'sweep':
          fireSweep(world, p, pm, st);
          break;
        case 'spiral':
          fireSpiral(world, p, pm, st);
          break;
        case 'pulse':
          firePulse(world, p, pm, st);
          break;
        case 'weather':
          fireWeather(world, p, pm, st);
          break;
      }
      // ゆびをふる・ものまね は、選んだ技の分を fireMetronome の中で起こす
      if (def.pattern !== 'metronome') fireSpawnEffects(world, from, world.projectiles.count);
      if (def.effects.some((fx) => fx.trigger === 'cast')) {
        const [fx, fy] = axisToUnit(p.facingX, p.facingY);
        const sc = scaledMoveStats(world, p, pm, st);
        fireEffects(world, 'cast', { owner: p.id, move: pm.move, level: pm.level, damage: sc.power, size: sc.size, x: p.x, y: p.y, dirX: fx, dirY: fy, length: 0 });
      }
    }
  }
}

/** 出したばかりの技そのもの（index from〜to − 1）の spawn の効き方を起こす。遅れて現れるもの（stage 3）は、現れたときに起こす */
function fireSpawnEffects(world: World, from: number, to: number): void {
  const pr = world.projectiles;
  for (let i = from; i < to; i++) {
    if (pr.stage[i] !== 0) continue;
    if (!world.rules.moves[pr.move[i]!]!.effects.some((fx) => fx.trigger === 'spawn')) return;
    fireEffects(world, 'spawn', fxSourceOf(world, i, pr.x[i]!, pr.y[i]!));
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
    // 飛ぶ弾が曲がる速さ（ほかの動き方は、それぞれ上書きする）
    angularSpeed: world.rules.moves[pm.move]!.curve,
    orbitRadius: 0,
    shape: SHAPE_CIRCLE,
    length: 0,
    dirX: 0,
    dirY: 0,
    growth: 0,
  };
}

/** nearest・facing・homing・boomerang・barrage: 間隔が来た分だけ1発ずつ飛ばす */
function fireBurst(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const def = world.rules.moves[pm.move]!;
  pm.burstTimer -= pm.burstTimer > 0 ? world.dt : 0;
  while (pm.burstLeft > 0 && pm.burstTimer <= 0) {
    if (def.pattern === 'barrage') {
      fireBarrageHit(world, p, pm, st);
      pm.burstLeft--;
      pm.burstTimer += st.intervalSeconds;
      continue;
    }
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
    // 蛇行する弾（りゅうのいかり）: 出した場所から、同じ揺れ方で続けて飛ぶので、つながった炎に見える
    if (def.snake && def.pattern !== 'homing' && def.pattern !== 'boomerang') {
      world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_SNAKE, x: p.x, y: p.y, vx: dx * speed, vy: dy * speed, ox: p.x, oy: p.y, orbitRadius: def.snake.amplitude, angularSpeed: (Math.PI * 2 * speed) / def.snake.wavelength });
      pm.burstLeft--;
      pm.burstTimer += st.intervalSeconds;
      continue;
    }
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

/**
 * barrage（連打）の1発: 向き（ランダムに選んだ向き、無ければ向いている方向）を中心にした開き arcDegrees・距離 range の中の
 * ランダムな場所に、外へ押し出す小さな当たり判定を出す（拳・蹴り。進む向きへ speed で少し進んで消える）
 */
function fireBarrageHit(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const [fx, fy] = axisToUnit(p.facingX, p.facingY);
  const center = pm.aimAngle ?? Math.atan2(fy, fx);
  const speed0 = scaledMoveStats(world, p, pm, st).speed;
  const width = world.rules.moves[pm.move]!.barrageWidth;
  if (width) {
    // 長方形: 自分を通る横の辺のランダムな所から、向きへまっすぐ。奥行き range まで届いたら消える
    const dx = Math.cos(center);
    const dy = Math.sin(center);
    const off = (world.rng.next() - 0.5) * width;
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x: p.x - dy * off, y: p.y + dx * off, vx: dx * speed0, vy: dy * speed0, life: st.range / Math.max(1, speed0) });
    return;
  }
  const a = center + (world.rng.next() - 0.5) * ((Math.min(360, st.arcDegrees) * Math.PI) / 180);
  const d = st.range * (0.3 + 0.7 * world.rng.next());
  const speed = speed0;
  world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed });
}

/** melee: 向いている方向 → 反対側 → 左 → 右 の順に当たり判定を出す（持ち主に付いていく。range 0 なら自分の周り） */
function fireMelee(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const [fx, fy] = axisToUnit(p.facingX, p.facingY);
  const body = world.rules.moves[pm.move]!.body;
  if (body) world.events.push({ type: 'bodyAttack', playerId: p.id, dirX: fx, dirY: fy, distance: body.lungeDistance, afterimages: body.afterimages });
  if (st.arcDegrees > 0) {
    // 扇形: 自分を中心に、向いている方向へ（360 度なら自分の周り全部。数が2以上なら反対側にも）
    const sc = scaledMoveStats(world, p, pm, st);
    const half = Math.min(Math.PI, (st.arcDegrees * Math.PI) / 360);
    const n = half >= Math.PI ? 1 : Math.min(st.count, 2);
    // 外へ進む攻撃: 厚さ band の帯が、中心から届く距離まで持続の間に進む
    const reach = st.range + sc.size;
    const band = reachBand(world, pm.move, reach);
    const growth = band > 0 ? (reach - band) / st.durationSeconds : 0;
    for (let k = 0; k < n; k++) {
      const s = k === 0 ? 1 : -1;
      world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_FOLLOW, x: p.x, y: p.y, radius: band > 0 ? band : reach, band, growth, shape: SHAPE_SECTOR, length: half, dirX: fx * s, dirY: fy * s, vx: fx * s, vy: fy * s });
    }
    return;
  }
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
  const body = world.rules.moves[pm.move]!.body;
  if (body) world.events.push({ type: 'bodyAttack', playerId: p.id, dirX: ax, dirY: ay, distance: body.lungeDistance, afterimages: body.afterimages });
  const step = st.spreadDegrees > 0 ? st.spreadDegrees / st.count : 12;
  for (let k = 0; k < st.count; k++) {
    const offset = ((k - (st.count - 1) / 2) * step * Math.PI) / 180;
    const a = Math.atan2(ay, ax) + offset;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    // 障害物は技も遮る（ビームは障害物の手前まで）
    const length = rayLengthToObstacle(world, p.x, p.y, dx, dy, st.range);
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_FOLLOW, x: p.x, y: p.y, shape: SHAPE_LINE, length, dirX: dx, dirY: dy, vx: dx, vy: dy });
  }
}

/**
 * stream: 向いている方向へ、太い流れを出し続ける（07 22.5 ハイドロポンプ）。弾ではなく持ち主に付いていく直線で、
 * 次に使うまで消えない（再使用の時間だけ残るので、途切れずに出し続けて見える）。count 2 以上は spreadDegrees ずつ広げて並べる
 */
function fireStream(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const [fx, fy] = axisToUnit(p.facingX, p.facingY);
  const sc = scaledMoveStats(world, p, pm, st);
  for (let k = 0; k < st.count; k++) {
    const offset = ((k - (st.count - 1) / 2) * st.spreadDegrees * Math.PI) / 180;
    const a = Math.atan2(fy, fx) + offset;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    world.projectiles.add({
      ...base(world, p, pm, st),
      motion: MOTION_STREAM,
      x: p.x,
      y: p.y,
      shape: SHAPE_LINE,
      length: rayLengthToObstacle(world, p.x, p.y, dx, dy, st.range),
      dirX: dx,
      dirY: dy,
      angle: offset,
      // 向きを変える速さ（ラジアン/秒）は speed を度/秒として使う
      angularSpeed: (st.speed * Math.PI) / 180,
      orbitRadius: st.range,
      // 出ている時間は持続（再使用より長ければ再使用まで）。前は再使用までずっと出していて、ハイドロポンプの「持続 1 秒・再使用 3 秒」（作者の決定）が効いていなかった
      life: Math.min(st.durationSeconds, sc.cooldownSeconds) + world.dt,
    });
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

/** screen: range の中の近い敵 count 体の足元に、同時に当たり判定を置く（画面じゅうの敵へ） */
function fireScreen(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const { enemies: e, enemyHash, scratch } = world;
  const n = enemyHash.queryRect(p.x - st.range, p.y - st.range, p.x + st.range, p.y + st.range, scratch);
  const found: { i: number; d2: number }[] = [];
  // ハッシュの衝突で同じ敵が2回入っていることがある
  const seen = new Set<number>();
  for (let k = 0; k < n; k++) {
    const i = scratch[k]!;
    if (e.hp[i]! <= 0 || seen.has(i)) continue;
    seen.add(i);
    const d2 = (e.x[i]! - p.x) ** 2 + (e.y[i]! - p.y) ** 2;
    if (d2 <= st.range * st.range) found.push({ i, d2 });
  }
  // 近い順（同じ距離なら id の小さい順。ハッシュの並び順に左右されないように）
  found.sort((a, b) => a.d2 - b.d2 || e.id[a.i]! - e.id[b.i]!);
  for (const { i } of found.slice(0, st.count)) {
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x: e.x[i]!, y: e.y[i]! });
  }
}

/** 一度に出し終える出し方（ゆびをふるで選ぶ技。連射の出し方は、出し続ける状態を持てないので選ばない） */
/** 続けて撃つ出し方（ゆびをふる・ものまね では一度にまとめて撃つ） */
const BURST_PATTERNS = new Set(['nearest', 'facing', 'homing', 'boomerang', 'barrage']);
const ONE_SHOT_PATTERNS = new Set(['melee', 'orbit', 'beam', 'ground', 'nova', 'screen', 'whip', 'lob', 'strike', 'chain', 'bounce', 'cross', 'scatter', 'eruption', 'spin', 'sweep', 'spiral', 'pulse', 'weather']);

/** metronome（ゆびをふる）: ほかの技からランダムに1つを、その技の最大レベルで出す */
function fireMetronome(world: World, p: Player, self?: PlayerMove): void {
  // 選ぶ技: ものまね は遊べるポケモンの最初の技、ゆびをふる は固有技（作者の決定 2026年10月23日）。
  // 続けて撃つ技（ひのこ・スピードスター など）は一度にまとめて撃ち、出し続ける技・回復は選ばない
  const own = self ? world.rules.moves[self.move]! : null;
  const pool = (own && own.randomPool.length > 0 ? own.randomPool : world.rules.moves.map((_, i) => i)).filter((i) => {
    const pat = world.rules.moves[i]!.pattern;
    return ONE_SHOT_PATTERNS.has(pat) || BURST_PATTERNS.has(pat);
  });
  if (pool.length === 0) return;
  const move = pool[world.rng.int(pool.length)]!;
  const def = world.rules.moves[move]!;
  // ものまね は自分のレベルの割合で（最大なら選んだ技も最大）、ゆびをふる は最大レベルで出す
  const max = def.levels.length;
  const level = own && self && own.randomScaled ? Math.max(1, Math.round((self.level / own.levels.length) * max)) : max;
  const pm: PlayerMove = { move, level, cooldown: 0, burstLeft: 0, burstTimer: 0 };
  const st = playerMoveStats(world, p, pm);
  if (BURST_PATTERNS.has(def.pattern)) {
    pm.burstLeft = st.count;
    fireBurst(world, p, pm, { ...st, intervalSeconds: 0 });
    return;
  }
  const fire: Record<string, (w: World, p: Player, pm: PlayerMove, st: MoveStats) => void> = {
    melee: fireMelee,
    orbit: fireOrbit,
    beam: fireBeam,
    ground: fireGround,
    nova: fireNova,
    screen: fireScreen,
    whip: fireWhip,
    lob: fireLob,
    strike: fireStrike,
    chain: fireChain,
    bounce: fireBounce,
    cross: fireCross,
    scatter: fireScatter,
    eruption: fireEruption,
    spin: fireSpin,
    sweep: fireSweep,
    spiral: fireSpiral,
    pulse: firePulse,
    weather: fireWeather,
  };
  const from = world.projectiles.count;
  fire[def.pattern]?.(world, p, pm, st);
  fireSpawnEffects(world, from, world.projectiles.count);
}

/**
 * whip（横なぎ）: 左右へ長い直線で払う。向いている側（左右）から、count 2 で反対側、3・4 で上下も。
 * 5〜8 は斜め（向いている側の上・下、反対側の上・下）も（作者の指摘 2026年10月23日: ポイントマックスで 5 以上にしても4方向のままだった）
 */
function fireWhip(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const side = p.facingX < 0 ? -1 : 1;
  const d = Math.SQRT1_2;
  const dirs: [number, number][] = [
    [side, 0],
    [-side, 0],
    [0, -1],
    [0, 1],
    [side * d, -d],
    [side * d, d],
    [-side * d, -d],
    [-side * d, d],
  ];
  const body = world.rules.moves[pm.move]!.body;
  if (body) world.events.push({ type: 'bodyAttack', playerId: p.id, dirX: side, dirY: 0, distance: body.lungeDistance, afterimages: body.afterimages });
  // 2本目からは interval ずつ遅らせる（同時に払わず、左 → 右と順に。作者の指摘 2026年10月25日）。遅れる分は出番を待つもの（stage 3）
  dirs.slice(0, Math.max(1, Math.min(dirs.length, st.count))).forEach(([dx, dy], k) => {
    const length = rayLengthToObstacle(world, p.x, p.y, dx, dy, st.range);
    const wait = st.intervalSeconds * k;
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_FOLLOW, x: p.x, y: p.y, shape: SHAPE_LINE, length, dirX: dx, dirY: dy, vx: dx, vy: dy, ...(wait > 0 ? { life: wait, stage: 3, armLife: st.durationSeconds } : {}) });
  });
}

/**
 * lob（放物線）: 向いている側の斜め上へ投げ、重さで弧を描いて落ちる。
 * 落とす場所が決まっている技（lobTarget）は、真上寄りに speed で投げ上げ、持続の秒数でちょうどその場所に落ちるよう重さを決める
 */
function fireLob(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const speed = scaledMoveStats(world, p, pm, st).speed;
  const target = world.rules.moves[pm.move]!.lobTarget;
  if (target) {
    const T = st.durationSeconds;
    const t0 = target === 'nearest' ? nearestEnemy(world, p.x, p.y, st.range) : -1;
    for (let k = 0; k < st.count; k++) {
      let dx: number;
      let dy: number;
      if (t0 !== -1 && k === 0) {
        dx = world.enemies.x[t0]! - p.x;
        dy = world.enemies.y[t0]! - p.y;
      } else {
        // 自分の周り range の中（近すぎない所）のランダムな場所
        const a = world.rng.next() * Math.PI * 2;
        const r = st.range * (0.25 + 0.75 * Math.sqrt(world.rng.next()));
        dx = Math.cos(a) * r;
        dy = Math.sin(a) * r;
      }
      const vy = -speed * (0.85 + world.rng.next() * 0.3);
      // 落ちる場所 = 投げた場所 + v × T + 重さ × dt² × n(n+1)/2（更新 n 回ぶん。速さを先に変えてから動かすので、式どおりの T²/2 より少し多い）
      const n = Math.max(1, Math.round(T / world.dt));
      const gravity = (dy - vy * n * world.dt) / ((world.dt * world.dt * n * (n + 1)) / 2);
      world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LOB, x: p.x, y: p.y, vx: dx / T, vy, angularSpeed: gravity });
    }
    return;
  }
  const side = p.facingX < 0 ? -1 : p.facingX > 0 ? 1 : world.rng.next() < 0.5 ? -1 : 1;
  for (let k = 0; k < st.count; k++) {
    // 数が多いときは、左右・高さをばらつかせる
    const sx = (k % 2 === 0 ? side : -side) * (0.25 + world.rng.next() * 0.35);
    const vy = -(0.85 + world.rng.next() * 0.3);
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LOB, x: p.x, y: p.y, vx: sx * speed, vy: vy * speed, angularSpeed: speed * 2.2 });
  }
}

/** range の中にいる敵（同じ敵は1回だけ） */
function enemiesInRange(world: World, x: number, y: number, range: number): number[] {
  const { enemies: e, enemyHash, scratch } = world;
  const n = enemyHash.queryRect(x - range, y - range, x + range, y + range, scratch);
  const out: number[] = [];
  const seen = new Set<number>();
  for (let k = 0; k < n; k++) {
    const i = scratch[k]!;
    if (e.hp[i]! <= 0 || seen.has(i)) continue;
    seen.add(i);
    if ((e.x[i]! - x) ** 2 + (e.y[i]! - y) ** 2 <= range * range) out.push(i);
  }
  // ハッシュの並び順に左右されないように、id の順にそろえてから乱数で選ぶ
  return out.sort((a, b) => e.id[a]! - e.id[b]!);
}

/** strike（落雷）: range の中のランダムな敵 count 体の足元に、同時に当たり判定を置く */
function fireStrike(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const e = world.enemies;
  const pool = enemiesInRange(world, p.x, p.y, st.range);
  for (let k = 0; k < st.count && pool.length > 0; k++) {
    const i = pool.splice(world.rng.int(pool.length), 1)[0]!;
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x: e.x[i]!, y: e.y[i]! });
  }
}

/** chain（連鎖）: 一番近い敵から、近くの敵へ count 回飛び移る線（1回に range の半分まで跳ぶ） */
function fireChain(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const e = world.enemies;
  let x = p.x;
  let y = p.y;
  let reach = st.range;
  const used = new Set<number>();
  const hop = world.rules.moves[pm.move]!.chainHopSeconds;
  for (let k = 0; k < st.count; k++) {
    let best = -1;
    let bestD2 = reach * reach;
    for (const i of enemiesInRange(world, x, y, reach)) {
      if (used.has(i)) continue;
      const d2 = (e.x[i]! - x) ** 2 + (e.y[i]! - y) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    if (best === -1) break;
    used.add(best);
    const len = Math.sqrt(bestD2) || 1;
    const dx = (e.x[best]! - x) / len;
    const dy = (e.y[best]! - y) / len;
    // 2回目からは、跳ぶごとに少し遅れて現れる（出番を待つもの stage 3。待つ間は見えず当たらない）
    const wait = hop * k;
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x, y, shape: SHAPE_LINE, length: len, dirX: dx, dirY: dy, ...(wait > 0 ? { life: wait, stage: 3, armLife: st.durationSeconds } : {}) });
    x = e.x[best]!;
    y = e.y[best]!;
    reach = st.range * 0.5;
  }
}

/** bounce（跳ね返り）: ランダムな方向へ飛び、自分のまわりの枠の端で跳ね返る */
function fireBounce(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const speed = scaledMoveStats(world, p, pm, st).speed;
  for (let k = 0; k < st.count; k++) {
    const [fx, fy] = axisToUnit(p.facingX, p.facingY);
    // spreadDegrees があれば、その幅でランダムにずらす（ボルテッカー: 毎回違う向きへ駆け出す。作者の指摘 2026年10月25日）
    const jitter = st.spreadDegrees > 0 ? ((world.rng.next() - 0.5) * st.spreadDegrees * Math.PI) / 180 : 0;
    const a = Math.atan2(fy, fx) + world.rules.moves[pm.move]!.bounceAngle + jitter + (k / st.count) * Math.PI * 2;
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_BOUNCE, x: p.x, y: p.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, ox: st.range, oy: st.range * 0.56 });
  }
}

/** trail（足あと）: 歩いていると、足元にしばらく残る当たり判定を置く */
function fireTrail(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  if (p.x === p.prevX && p.y === p.prevY) return;
  world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x: p.x, y: p.y });
}

/** cross（十字）: 向いている方向から等しい角度で count 方向へ同時に撃つ */
function fireCross(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const [fx, fy] = axisToUnit(p.facingX, p.facingY);
  const start = Math.atan2(fy, fx);
  const speed = scaledMoveStats(world, p, pm, st).speed;
  const snake = world.rules.moves[pm.move]!.snake;
  for (let k = 0; k < st.count; k++) {
    const a = start + (k / st.count) * Math.PI * 2;
    const vx = Math.cos(a) * speed;
    const vy = Math.sin(a) * speed;
    // 蛇行する弾（ヘドロウェーブ）: 出した場所を ox・oy に覚え、時間から位置を決める。隣どうしで揺れの向きを逆にする
    if (snake) {
      const omega = (Math.PI * 2 * speed) / snake.wavelength;
      world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_SNAKE, x: p.x, y: p.y, vx, vy, ox: p.x, oy: p.y, orbitRadius: snake.amplitude * (k % 2 === 0 ? 1 : -1), angularSpeed: omega });
      continue;
    }
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x: p.x, y: p.y, vx, vy });
  }
}

/**
 * scatter（水たまり）: 自分の周り range の中のランダムな場所に、しばらく残る当たり判定を置く。
 * scatterJitter があれば、数と大きさも使うたびにランダムにする（マグニチュード）
 */
function fireScatter(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const jit = world.rules.moves[pm.move]!.scatterJitter;
  const b0 = base(world, p, pm, st);
  const count = jit ? Math.min(st.count, jit.countMin) + world.rng.int(Math.max(1, st.count - Math.min(st.count, jit.countMin) + 1)) : st.count;
  for (let k = 0; k < count; k++) {
    const a = world.rng.next() * Math.PI * 2;
    const r = st.range * (0.3 + world.rng.next() * 0.7);
    // speed があれば、置いた場所からランダムな向きへゆっくり動く
    const b = world.rng.next() * Math.PI * 2;
    const radius = jit ? b0.radius * (jit.sizeMin + world.rng.next() * (jit.sizeMax - jit.sizeMin)) : b0.radius;
    world.projectiles.add({ ...b0, radius, motion: MOTION_LINEAR, x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r, vx: Math.cos(b) * st.speed, vy: Math.sin(b) * st.speed });
  }
}

/**
 * eruption（爆炎の柱）: 自分を中心に count 方向へ、円の柱を段に分けて外へ向かって順に出す（ブラストバーン。作者の決定 2026年10月23日）。
 * 段 k（0 から）は、距離 range × (k + 1) / 段の数、半径 size × (1 + sizeGrowth × k)、interval × k 秒遅れて現れ、duration の間残る。
 * 遅れて現れる柱は、出番を待つもの（stage 3）として置き、待つ間は見えず当たらない
 */
function fireEruption(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const def = world.rules.moves[pm.move]!;
  const er = def.eruption ?? { stages: 3, sizeGrowth: 0.25 };
  const sc = scaledMoveStats(world, p, pm, st);
  const [fx, fy] = axisToUnit(p.facingX, p.facingY);
  const a0 = Math.atan2(fy, fx);
  for (let k = 0; k < er.stages; k++) {
    const d = (st.range * (k + 1)) / er.stages;
    const radius = sc.size * (1 + er.sizeGrowth * k);
    const wait = st.intervalSeconds * k;
    for (let j = 0; j < st.count; j++) {
      const a = a0 + (j / st.count) * Math.PI * 2;
      const x = p.x + Math.cos(a) * d;
      const y = p.y + Math.sin(a) * d;
      if (wait <= 0) world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x, y, radius });
      else world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x, y, radius, life: wait, stage: 3, armLife: st.durationSeconds });
    }
  }
}

/**
 * spin（回転）: 自分のまわりに、開き arcDegrees の扇形を count 枚、等しい角度で出す。使うたびに arcDegrees ずつ時計回りへずらす
 * （画面は y が下なので、角度を足すと時計回り）。再使用が短いほど速く回って見える（こうそくスピン。作者の決定 2026年10月23日）
 */
function fireSpin(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const sc = scaledMoveStats(world, p, pm, st);
  const [fx, fy] = axisToUnit(p.facingX, p.facingY);
  const step = (Math.max(1, st.arcDegrees) * Math.PI) / 180;
  const start = Math.atan2(fy, fx) + (pm.spinStep ?? 0) * step;
  pm.spinStep = ((pm.spinStep ?? 0) + 1) % 360;
  const half = Math.min(Math.PI, step / 2);
  const n = Math.max(1, st.count);
  for (let k = 0; k < n; k++) {
    const a = start + (k / n) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_FOLLOW, x: p.x, y: p.y, radius: st.range + sc.size, shape: SHAPE_SECTOR, length: half, dirX: dx, dirY: dy, vx: dx, vy: dy });
  }
}

/**
 * heal（回復）: 最大 HP の healPct % を回復し、guardPct があれば duration の間、受けるダメージを減らす（なまける・ドわすれ）。
 * 見た目だけの円（当たらない。stage 2）を自分に付けて出す
 */
function fireHeal(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  healPlayer(world, p.id, (p.maxHp * st.healPct) / 100);
  if (st.guardPct > 0) {
    p.guardPct = st.guardPct;
    p.guardUntilTick = world.tick + Math.round(st.durationSeconds / world.dt);
  }
  world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_FOLLOW, x: p.x, y: p.y, damage: 0, stage: 2, fxIndex: -1 });
}

/** spiral（うず）: 自分を中心に count 個を等しい角度に並べ、回りながら duration の間に range まで広がる（はなびらのまい） */
function fireSpiral(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const [fx, fy] = axisToUnit(p.facingX, p.facingY);
  const a0 = Math.atan2(fy, fx);
  const n = Math.max(1, st.count);
  // 回る速さは技の curve（度/秒）。無ければ 1 秒で半周
  const turn = world.rules.moves[pm.move]!.curve || Math.PI;
  for (let k = 0; k < n; k++) {
    const a = a0 + (k / n) * Math.PI * 2;
    world.projectiles.add({
      ...base(world, p, pm, st),
      motion: MOTION_SPIRAL,
      x: p.x + Math.cos(a) * 16,
      y: p.y + Math.sin(a) * 16,
      angle: a,
      angularSpeed: turn,
      orbitRadius: 16,
      ox: Math.max(0, st.range - 16) / st.durationSeconds,
    });
  }
}

/** sweep（往復するなぎ払い）: 向いている方向を中心に、細い扇形を spreadDegrees の幅で行って戻る（おうふくビンタ） */
function fireSweep(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const sc = scaledMoveStats(world, p, pm, st);
  const def = world.rules.moves[pm.move]!;
  // 向きをランダムに選ぶ技（まわしげり）は、近くのランダムな向きへ払う
  const [fx, fy] = def.randomAim ? ((r: number): [number, number] => [Math.cos(r), Math.sin(r)])(world.rng.next() * Math.PI * 2) : axisToUnit(p.facingX, p.facingY);
  if (def.body) world.events.push({ type: 'bodyAttack', playerId: p.id, dirX: fx, dirY: fy, distance: def.body.lungeDistance, afterimages: def.body.afterimages });
  const half = Math.min(Math.PI, (st.arcDegrees * Math.PI) / 360);
  const amp = (Math.min(360, st.spreadDegrees) * Math.PI) / 360;
  world.projectiles.add({
    ...base(world, p, pm, st),
    motion: MOTION_SWEEP,
    x: p.x,
    y: p.y,
    radius: st.range + sc.size,
    shape: SHAPE_SECTOR,
    length: half,
    angle: Math.atan2(fy, fx),
    angularSpeed: amp,
    dirX: Math.cos(Math.atan2(fy, fx) - amp),
    dirY: Math.sin(Math.atan2(fy, fx) - amp),
    // 行きと戻りの両方で当たる。片道だけ（はたく）は orbitRadius 1 の印を付け、同じ敵には1回
    ...(def.sweepOnce ? { orbitRadius: 1, hitIntervalTicks: 0 } : { hitIntervalTicks: Math.max(1, Math.round(st.durationSeconds / 2 / world.dt)) }),
  });
}

/**
 * pulse（広がって縮む輪）: 自分を中心に、厚さ size の輪が range まで広がってから縮む（スパーク・ワイルドボルト。作者の決定 2026年10月25日）。
 * count 2 以上は interval ごとに続けて出す（遅れる輪は出番を待つもの stage 3）
 */
function firePulse(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const band = scaledMoveStats(world, p, pm, st).size;
  const outer = Math.max(band + 1, st.range);
  for (let k = 0; k < Math.max(1, st.count); k++) {
    const wait = st.intervalSeconds * k;
    world.projectiles.add({
      ...base(world, p, pm, st),
      motion: MOTION_PULSE,
      x: p.x,
      y: p.y,
      radius: band,
      band,
      ox: band,
      orbitRadius: outer,
      ...(wait > 0 ? { life: wait, stage: 3, armLife: st.durationSeconds } : {}),
    });
  }
}

/**
 * weather（天気）: duration の間、自分の周り半径 size（画面くらい）の敵すべてに、当たり直しの間隔ごとに当たる
 * （こなゆき・ふぶき。作者の決定 2026年10月25日）。持ち主に付いていく大きな円で、見た目は画面に降る雪（範囲は塗らない）
 */
function fireWeather(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_FOLLOW, x: p.x, y: p.y });
}

/** nova: 自分を中心に、大きさ size から range まで広がる輪 */
function fireNova(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const sc = scaledMoveStats(world, p, pm, st);
  // 外へ進む攻撃なら、中が空いた帯（厚さ band）として広がる
  const band = reachBand(world, pm.move, st.range);
  const start = band > 0 ? band : sc.size;
  const growth = Math.max(0, (st.range - start) / st.durationSeconds);
  for (let k = 0; k < st.count; k++) {
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_FOLLOW, x: p.x, y: p.y, radius: start, band, growth, life: st.durationSeconds * (1 + k * 0.6) });
  }
}

/** 外へ進む攻撃（sweep）の帯の厚さ。届く距離 reach に対する割合から。外へ進まない技は 0 */
export function reachBand(world: World, move: number, reach: number): number {
  const sweep = world.rules.moves[move]?.sweep ?? 0;
  return sweep > 0 ? Math.max(1, reach * sweep) : 0;
}

/** 扇の中心から (dx, dy) にある半径 r の敵が、向き (fx, fy)・片側の開き half の扇の角度に入るか（距離は別に確かめる） */
function inSector(dx: number, dy: number, r: number, fx: number, fy: number, half: number): boolean {
  if (half >= Math.PI) return true;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= r) return true;
  const cos = (dx * fx + dy * fy) / d;
  const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
  // 敵の大きさの分だけ、角度の判定をゆるめる
  return angle <= half + Math.asin(Math.min(1, r / d));
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
    // 出番を待つもの（stage 3）: 時間が来たら、技そのものとして現れる（見えず当たらないまま待つ）
    if (pr.stage[i] === 3) {
      pr.life[i]! -= world.dt;
      if (pr.life[i]! <= 0) {
        pr.stage[i] = pr.armStage[i]!;
        pr.life[i] = pr.maxLife[i] = pr.armLife[i]!;
        // 効き方から出た、遅れて伸びる亀裂（じわれ）は、1本ずつ光らせない
        if (pr.stage[i] === 0) world.events.push({ type: 'projectileHit', x: pr.x[i]!, y: pr.y[i]!, owner: pr.owner[i]!, move: pr.move[i]! });
        fireSpawnEffects(world, i, i + 1);
      }
      continue;
    }
    const owner = world.players.find((p) => p.id === pr.owner[i]);
    const motion = pr.motion[i]!;
    if (motion === MOTION_LINEAR) {
      // 曲がる弾（angularSpeed）は速度の向きを回す。広がる輪（growth）は半径を広げる
      if (pr.angularSpeed[i] !== 0) {
        const c = Math.cos(pr.angularSpeed[i]! * world.dt);
        const s = Math.sin(pr.angularSpeed[i]! * world.dt);
        const vx = pr.vx[i]!;
        pr.vx[i] = vx * c - pr.vy[i]! * s;
        pr.vy[i] = vx * s + pr.vy[i]! * c;
      }
      pr.radius[i]! += pr.growth[i]! * world.dt;
      pr.x[i]! += pr.vx[i]! * world.dt;
      pr.y[i]! += pr.vy[i]! * world.dt;
    } else if (motion === MOTION_BOOMERANG) {
      // 出したときの速度 (ox, oy) から、残り時間の半分で止まり、その後は戻ってくる
      const k = 1 - 2 * (1 - pr.life[i]! / pr.maxLife[i]!);
      pr.x[i]! += pr.ox[i]! * k * world.dt;
      pr.y[i]! += pr.oy[i]! * k * world.dt;
    } else if (motion === MOTION_LOB) {
      pr.vy[i]! += pr.angularSpeed[i]! * world.dt;
      pr.x[i]! += pr.vx[i]! * world.dt;
      pr.y[i]! += pr.vy[i]! * world.dt;
    } else if (motion === MOTION_BOUNCE) {
      pr.x[i]! += pr.vx[i]! * world.dt;
      pr.y[i]! += pr.vy[i]! * world.dt;
      // 持ち主のまわりの枠の端で跳ね返る（持ち主がいなければ、そのまま飛ぶ）
      if (owner) {
        if ((pr.x[i]! > owner.x + pr.ox[i]! && pr.vx[i]! > 0) || (pr.x[i]! < owner.x - pr.ox[i]! && pr.vx[i]! < 0)) pr.vx[i] = -pr.vx[i]!;
        if ((pr.y[i]! > owner.y + pr.oy[i]! && pr.vy[i]! > 0) || (pr.y[i]! < owner.y - pr.oy[i]! && pr.vy[i]! < 0)) pr.vy[i] = -pr.vy[i]!;
      }
    } else if (motion === MOTION_SNAKE) {
      const [dx, dy] = snakeOffset(pr.vx[i]!, pr.vy[i]!, pr.orbitRadius[i]!, pr.angularSpeed[i]!, pr.maxLife[i]! - pr.life[i]! + world.dt);
      pr.x[i] = pr.ox[i]! + dx;
      pr.y[i] = pr.oy[i]! + dy;
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
    } else if (motion === MOTION_SPIRAL) {
      pr.angle[i]! += pr.angularSpeed[i]! * world.dt;
      pr.orbitRadius[i]! += pr.ox[i]! * world.dt;
      pr.x[i] = owner.x + Math.cos(pr.angle[i]!) * pr.orbitRadius[i]!;
      pr.y[i] = owner.y + Math.sin(pr.angle[i]!) * pr.orbitRadius[i]!;
    } else if (motion === MOTION_ORBIT) {
      pr.angle[i]! += pr.angularSpeed[i]! * world.dt;
      pr.x[i] = owner.x + Math.cos(pr.angle[i]!) * pr.orbitRadius[i]!;
      pr.y[i] = owner.y + Math.sin(pr.angle[i]!) * pr.orbitRadius[i]!;
    } else if (motion === MOTION_STREAM) {
      stepStream(world, i, owner);
    } else if (motion === MOTION_PULSE) {
      pr.x[i] = owner.x;
      pr.y[i] = owner.y;
      const t = Math.min(1, (pr.maxLife[i]! - pr.life[i]! + world.dt) / pr.maxLife[i]!);
      pr.radius[i] = pr.ox[i]! + (pr.orbitRadius[i]! - pr.ox[i]!) * Math.sin(Math.PI * t);
    } else if (motion === MOTION_SWEEP) {
      // 前半に片側の端からもう片側の端へ、後半に戻る（片道だけのもの orbitRadius 1 は、全体で片側の端からもう片側の端へ）
      pr.x[i] = owner.x;
      pr.y[i] = owner.y;
      const t = 1 - pr.life[i]! / pr.maxLife[i]!;
      const s = pr.orbitRadius[i] === 1 ? t : t < 0.5 ? t * 2 : 2 - t * 2;
      const a = pr.angle[i]! - pr.angularSpeed[i]! + 2 * pr.angularSpeed[i]! * s;
      pr.dirX[i] = Math.cos(a);
      pr.dirY[i] = Math.sin(a);
    }
    pr.life[i]! -= world.dt;
    if (pr.life[i]! <= 0) {
      expire(world, i);
      continue;
    }
    // 遅れて弾ける印は当たらない
    if (pr.stage[i] === 2) continue;
    tickEveryEffects(world, i);
    // 障害物は技も遮る（飛んでいく技は当たると消える）。跳ね返る技（ボルテッカー）は枠の端で跳ね返り続けるので、障害物は通り抜ける
    if ((motion === MOTION_HOMING || motion === MOTION_BOOMERANG || motion === MOTION_LOB || motion === MOTION_SNAKE || (motion === MOTION_LINEAR && (pr.vx[i] !== 0 || pr.vy[i] !== 0))) && insideObstacle(world, pr.x[i]!, pr.y[i]!)) {
      world.events.push({ type: 'projectileHit', x: pr.x[i]!, y: pr.y[i]!, owner: pr.owner[i]!, move: pr.move[i]! });
      expire(world, i);
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
      if (d2 > r * r) continue;
      // 外へ進む帯: 帯より内側にいる敵には当たらない（もう通り過ぎた）
      const inner = pr.band[i]! > 0 ? pr.radius[i]! - pr.band[i]! - e.radius[j]! : 0;
      if (inner > 0 && d2 < inner * inner) continue;
      if (pr.shape[i] === SHAPE_SECTOR && !inSector(e.x[j]! - x, e.y[j]! - y, e.radius[j]!, pr.dirX[i]!, pr.dirY[i]!, pr.length[i]!)) continue;
      hitScratch[hits++] = j;
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
    let firstX = NaN;
    let firstY = NaN;
    for (let k = 0; k < candidates.length && pr.pierceLeft[i]! > 0; k++) {
      const j = candidates[k]!;
      // ハッシュの衝突で同じ敵が2回入っていることがある
      if (pr.isBlocked(i, e.id[j]!, world.tick)) continue;
      pr.recordHit(i, e.id[j]!, world.tick);
      pr.pierceLeft[i]!--;
      hitAny = true;
      if (Number.isNaN(firstX)) {
        firstX = e.x[j]!;
        firstY = e.y[j]!;
      }
      if (line) {
        hitX = e.x[j]!;
        hitY = e.y[j]!;
      }
      // 当たった敵ごとの効き方（かみなり: 落雷を受けた敵から電気が連鎖する）。見た目もそろうように、どのブラウザでも起こす
      if (pr.stage[i] === 0 && def.effects.some((fx) => fx.trigger === 'eachHit')) fireEffects(world, 'eachHit', fxSourceOf(world, i, e.x[j]!, e.y[j]!));
      if (!local) continue;
      // ノックバックの向き: 直線は線の向き、それ以外は当たり判定から敵へ（重なっていれば進む向き）
      const kx = line ? pr.dirX[i]! : e.x[j]! - x || pr.vx[i]!;
      const ky = line ? pr.dirY[i]! : e.y[j]! - y || pr.vy[i]!;
      // 効果（ノックバック・状態異常）は当てたプレイヤーの画面ですぐ付け、相手へは命中と一緒に送る
      const fx = rollHitEffect(world, st, kx, ky, pr.knockback[i]!, def.randomStatuses);
      applyHitEffect(world, j, fx, ownerId);
      const kind = world.rules.enemies.kinds[e.kind[j]!];
      // 急所（クリティカットなど・技ごとの急所）の判定は、当てたプレイヤーのブラウザの乱数で行う
      const critPct = (owner?.mods.critChancePct ?? 0) + st.critChancePct;
      const crit = critPct > 0 && world.rng.next() * 100 < critPct;
      // 一撃（じわれ）: 雑魚だけ。当てたプレイヤーのブラウザの乱数で決め、倒しきる量を送る
      const instakill = st.instakillChance > 0 && (kind?.rank ?? 'normal') === 'normal' && world.rng.next() < st.instakillChance;
      // たたりめ: 状態異常の敵へのダメージを上げる
      const statusBonus = st.statusBonusPct > 0 && e.hasAnyStatus(j) ? 1 + st.statusBonusPct / 100 : 1;
      const amount = instakill
        ? INSTAKILL_DAMAGE
        : pr.damage[i]! *
          typeMultiplier(world.rules.types, world.rules.combat.typeMultipliers, def.type, owner?.types ?? [], kind?.types ?? []) *
          (crit ? world.rules.combat.critMultiplier : 1) *
          statusBonus;
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
    // hit の効き方は、その当たり判定が初めて敵に当たったときに1回だけ（当たった敵の位置で）
    if (hitAny && pr.stage[i] === 0 && pr.hitFired[i] === 0) {
      pr.hitFired[i] = 1;
      fireEffects(world, 'hit', fxSourceOf(world, i, firstX, firstY));
    }
    if (pr.pierceLeft[i]! <= 0) expire(world, i);
  }
}

/** 直線（始点・向き・長さ・太さ）に最初に触れる敵までの距離。いなければ長さ */
function firstEnemyAlong(world: World, x: number, y: number, dx: number, dy: number, len: number, width: number): number {
  const { enemies: e, enemyHash, scratch } = world;
  const ex = x + dx * len;
  const ey = y + dy * len;
  const n = enemyHash.queryRect(Math.min(x, ex) - width, Math.min(y, ey) - width, Math.max(x, ex) + width, Math.max(y, ey) + width, scratch);
  let best = len;
  for (let k = 0; k < n; k++) {
    const j = scratch[k]!;
    if (e.hp[j]! <= 0) continue;
    const t = (e.x[j]! - x) * dx + (e.y[j]! - y) * dy;
    if (t < 0 || t >= best) continue;
    const r = width + e.radius[j]!;
    if (segmentDistance2(e.x[j]!, e.y[j]!, x, y, dx, dy, len) <= r * r) best = t;
  }
  return best;
}

/** 出し続ける流れの1回分: 持ち主に付いていき、向いている方向へ回り、障害物の手前まで伸び、流れの先で爆発する */
function stepStream(world: World, i: number, owner: Player): void {
  const pr = world.projectiles;
  pr.x[i] = owner.x;
  pr.y[i] = owner.y;
  const [fx, fy] = axisToUnit(owner.facingX, owner.facingY);
  const want = Math.atan2(fy, fx) + pr.angle[i]!;
  const cur = Math.atan2(pr.dirY[i]!, pr.dirX[i]!);
  // 近いほうの回り方で、決まった速さまで向きを変える
  let diff = want - cur;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const turn = pr.angularSpeed[i]! * world.dt;
  const a = cur + Math.max(-turn, Math.min(turn, diff));
  pr.dirX[i] = Math.cos(a);
  pr.dirY[i] = Math.sin(a);
  pr.length[i] = rayLengthToObstacle(world, owner.x, owner.y, pr.dirX[i]!, pr.dirY[i]!, pr.orbitRadius[i]!);
}

/** 当たり判定 i を元にした、効き方の元（位置は (x, y)） */
function fxSourceOf(world: World, i: number, x: number, y: number): FxSource {
  const pr = world.projectiles;
  const vlen = Math.sqrt(pr.vx[i]! * pr.vx[i]! + pr.vy[i]! * pr.vy[i]!);
  const line = pr.shape[i] === SHAPE_LINE;
  const dirX = line || vlen === 0 ? pr.dirX[i]! || 1 : pr.vx[i]! / vlen;
  const dirY = line || vlen === 0 ? pr.dirY[i]! : pr.vy[i]! / vlen;
  return { owner: pr.owner[i]!, move: pr.move[i]!, level: pr.level[i]!, damage: pr.damage[i]!, size: pr.radius[i]!, x, y, dirX, dirY, length: line ? pr.length[i]! : 0, serial: pr.serial[i]! };
}

/** 当たり判定 i を消す。技そのもの（段階 0）なら end の効き方、印（段階 2）なら遅れた爆発を起こす */
function expire(world: World, i: number): void {
  const pr = world.projectiles;
  if (pr.stage[i] === 0) fireEffects(world, 'end', fxSourceOf(world, i, pr.x[i]!, pr.y[i]!));
  else if (pr.stage[i] === 2) fireDelayedExplosion(world, pr.fxIndex[i]!, fxSourceOf(world, i, pr.x[i]!, pr.y[i]!));
  pr.removeAt(i);
}

/** every の効き方: 残っている間、決まった間隔で起こす。流れは、流れが最初に当たる敵（いなければ流れの先）で */
function tickEveryEffects(world: World, i: number): void {
  const pr = world.projectiles;
  if (pr.stage[i] !== 0) return;
  const every = world.rules.moves[pr.move[i]!]!.effects.find((fx) => fx.trigger === 'every');
  if (!every) return;
  pr.fxTimer[i]! += world.dt;
  const period = every.everySeconds ?? 0.5;
  if (pr.fxTimer[i]! < period) return;
  pr.fxTimer[i]! -= period;
  let x = pr.x[i]!;
  let y = pr.y[i]!;
  if (pr.motion[i] === MOTION_STREAM) {
    const along = firstEnemyAlong(world, x, y, pr.dirX[i]!, pr.dirY[i]!, pr.length[i]!, pr.radius[i]!);
    x += pr.dirX[i]! * along;
    y += pr.dirY[i]! * along;
  }
  const src = fxSourceOf(world, i, x, y);
  fireEffects(world, 'every', { ...src, length: pr.motion[i] === MOTION_STREAM ? 0 : src.length });
}

/**
 * 命中の効果を決める。ノックバックは (dirX, dirY) の向き。
 * 状態異常が付くかの判定は、当てたプレイヤーのブラウザの乱数で行う（03_network.md 3.2）。
 */
function rollHitEffect(world: World, st: MoveStats, dirX: number, dirY: number, knockback = NaN, randomStatuses: readonly number[] = []): HitEffect {
  let kbx = 0;
  let kby = 0;
  let kbTicks = 0;
  // 効き方の部品のノックバックの上書き（マイナスなら中心へ引き寄せる）
  const kb = Number.isNaN(knockback) ? st.knockback : knockback;
  if (kb !== 0 && st.knockbackSeconds > 0) {
    const len = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
    kbx = (dirX / len) * kb;
    kby = (dirY / len) * kb;
    kbTicks = Math.round(st.knockbackSeconds / world.dt);
  }
  let status = -1;
  let statusTicks = 0;
  if ((st.status >= 0 || randomStatuses.length > 0) && st.statusChance > 0 && world.rng.next() < st.statusChance) {
    // トライアタック: やけど・こおり・まひ のどれか
    status = randomStatuses.length > 0 ? randomStatuses[world.rng.int(randomStatuses.length)]! : st.status;
    statusTicks = Math.round(st.statusSeconds / world.dt);
  }
  return { kbx, kby, kbTicks, status, statusTicks };
}
