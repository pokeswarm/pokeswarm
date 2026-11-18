import type { Player, PlayerMove } from './entities/player';
import type { SimActiveSkill } from './rules';
import type { World } from './world';
import { fireMirrorShards, fireSheerCold, fireSurfWave, scaledMoveStats, skillMoveStats } from './systems/attack';

/**
 * アクティブスキル（作者の案 2026年11月18日。07 の305・307章）: キー（SPACE・Q・E）で使う技。
 * ためておける回数があり、1 回分ずつ時間で戻る。技の枠の技（move）を持つスキルは、レベル・再使用・威力がその技の値。
 * 自分のプレイヤーだけを動かす（ほかのブラウザでは、届いた知らせで見た目だけを出す）
 */

/** 系統のスキルを持たせる（ランの始め。最初は満タン） */
export function initSkills(world: World, p: Player): void {
  const list = world.rules.activeSkills?.lines[p.line];
  if (!list || list.length === 0) return;
  p.skills = list.map((skill) => ({ skill, level: 1, charges: 0, rechargeTicks: 0 }));
  for (const s of p.skills) s.charges = maxCharges(world, p, s);
}

export function skillDef(world: World, skill: number): SimActiveSkill {
  return world.rules.activeSkills!.defs[skill]!;
}

/** スキルの技（技の枠の技。無ければ undefined） */
export function skillMove(world: World, p: Player, s: { skill: number }): PlayerMove | undefined {
  const d = skillDef(world, s.skill);
  return d.move >= 0 ? p.moves.find((m) => m.move === d.move) : undefined;
}

/** スキルのレベル（技の枠の技があれば、その技のレベル） */
export function skillLevel(world: World, p: Player, s: { skill: number; level: number }): number {
  return skillMove(world, p, s)?.level ?? s.level;
}

/** ためておける回数（レベルと、技の数の強化 = ポイントマックス） */
export function maxCharges(world: World, p: Player, s: { skill: number; level: number }): number {
  const d = skillDef(world, s.skill);
  return Math.max(1, d.baseCharges + Math.floor((skillLevel(world, p, s) - 1) * d.chargesPerLevel) + Math.max(0, p.mods.amountBonus));
}

/** 1 回分が戻るまでの更新回数（技の枠の技はその技の再使用。どちらも技の再使用の強化 = メトロノーム などで速くなる） */
export function rechargeTicksOf(world: World, p: Player, s: { skill: number }): number {
  const pm = skillMove(world, p, s);
  const seconds = pm ? skillMoveStats(world, p, pm).sc.cooldownSeconds : (skillDef(world, s.skill).rechargeSeconds ?? 8) * Math.max(0.2, 1 + p.mods.cooldownPct / 100);
  return Math.max(1, Math.round(seconds / world.dt));
}

/** 毎回の更新: 回数を時間で戻す・強化の切れ目・ミラーコートの終わり */
export function stepSkills(world: World): void {
  for (const p of world.players) {
    if (p.skillBuff && world.tick >= p.skillBuff.untilTick) p.skillBuff = undefined;
    if (p.calm && world.tick >= p.calm.untilTick) p.calm = undefined;
    if (p.mirror && world.tick >= p.mirror.untilTick) releaseMirror(world, p);
    if (!p.skills || p.remote) continue;
    for (const s of p.skills) {
      const max = maxCharges(world, p, s);
      if (s.charges >= max) {
        s.charges = max;
        s.rechargeTicks = 0;
        continue;
      }
      if (s.rechargeTicks <= 0) s.rechargeTicks = rechargeTicksOf(world, p, s);
      if (--s.rechargeTicks <= 0) {
        s.charges++;
        if (s.charges < max) s.rechargeTicks = rechargeTicksOf(world, p, s);
      }
    }
  }
}

/** 向き（押している向き。押していなければ向いている向き）の単位ベクトル */
export function aimOf(p: Player): [number, number] {
  const dx = p.inputX !== 0 || p.inputY !== 0 ? p.inputX : p.facingX;
  const dy = p.inputX !== 0 || p.inputY !== 0 ? p.inputY : p.facingY;
  if (dx === 0 && dy === 0) return [0, 1];
  const d = Math.hypot(dx, dy);
  return [dx / d, dy / d];
}

/** テレポートの行き先（固定マップの中に収める。障害物は着いた後の更新で押し出される） */
export function teleportDestination(world: World, p: Player, skill: number): { x: number; y: number } {
  const d = skillDef(world, skill);
  const [ax, ay] = aimOf(p);
  let x = p.x + ax * (d.distance ?? 300);
  let y = p.y + ay * (d.distance ?? 300);
  const a = world.arena;
  if (a) {
    x = Math.max(a.x - a.halfWidth + p.radius, Math.min(a.x + a.halfWidth - p.radius, x));
    y = Math.max(a.y - a.halfHeight + p.radius, Math.min(a.y + a.halfHeight - p.radius, y));
  }
  return { x, y };
}

/** なみのりの通り道（狙いを見せる）: 長さと幅 */
export function surfLane(world: World, p: Player, skill: number): { length: number; width: number } | null {
  const pm = skillMove(world, p, { skill });
  if (!pm) return null;
  const { st, sc } = skillMoveStats(world, p, pm);
  return { length: st.range, width: sc.size * 1.6 * (Math.max(1, st.count) - 1) + sc.size * 2 };
}

/** 今スキルを使えるか（回数があり、動ける状態） */
export function canUseSkill(p: Player, slot: number): boolean {
  const s = p.skills?.[slot];
  if (!s || s.charges <= 0 || p.down) return false;
  // 体が動く技・押し飛ばし・眠り・凍り・泣いている・反動の間は使えない
  return !p.dashTicks && !p.pushTicks && !p.sleepTicks && !p.frozenTicks && !p.cryTicks && !p.recoverTicks && !(p.sleep && (p.sleep.asleep || p.sleep.wakeTicks > 0));
}

/** スキルを使う（枠の番号。キーの順） */
export function useSkill(world: World, p: Player, slot: number): void {
  if (p.remote || !canUseSkill(p, slot)) return;
  const s = p.skills![slot]!;
  const d = skillDef(world, s.skill);
  const pm = skillMove(world, p, s);
  if (d.move >= 0 && !pm) return;
  const max = maxCharges(world, p, s);
  if (s.charges >= max) s.rechargeTicks = rechargeTicksOf(world, p, s);
  s.charges--;
  const [dx, dy] = aimOf(p);
  const fromX = p.x;
  const fromY = p.y;
  runSkill(world, p, d, pm, dx, dy);
  world.events.push({ type: 'skillUsed', playerId: p.id, skill: s.skill, slot, fromX, fromY, toX: p.x, toY: p.y, dirX: dx, dirY: dy, stacks: p.skillBuff?.stacks ?? 0 });
}

/** スキルの中身（自分のブラウザ: 当たりも効き目も。ほかのブラウザ: 見た目だけ。当たりは当てた人のブラウザで決まる） */
function runSkill(world: World, p: Player, d: SimActiveSkill, pm: PlayerMove | undefined, dx: number, dy: number): void {
  switch (d.kind) {
    case 'teleport': {
      if (p.remote) return;
      const to = teleportDestination(world, p, world.rules.activeSkills!.defs.indexOf(d));
      p.x = p.prevX = to.x;
      p.y = p.prevY = to.y;
      if (d.buff) {
        const live = p.skillBuff && world.tick < p.skillBuff.untilTick;
        const stacks = Math.min(d.buff.maxStacks, (live ? p.skillBuff!.stacks : 0) + 1);
        p.skillBuff = { stacks, pct: stacks * d.buff.powerPct, untilTick: world.tick + Math.round(d.buff.seconds / world.dt) };
      }
      return;
    }
    case 'surf': {
      if (!pm || !d.surf) return;
      fireSurfWave(world, p, pm, p.x, p.y, dx, dy, d.surf);
      // 自分も波に乗って進む（体が動く技と同じ。入力では動けない）
      if (!p.remote && d.surf.rideSeconds > 0) {
        const speed = scaledMoveStats(world, p, pm, skillMoveStats(world, p, pm).st).speed * 0.85;
        p.dashTicks = Math.round(d.surf.rideSeconds / world.dt);
        p.dashBusyTicks = p.dashTicks;
        p.dashVx = dx * speed;
        p.dashVy = dy * speed;
      }
      return;
    }
    case 'sheerCold': {
      if (!pm || !d.sheerCold) return;
      const surf = world.rules.activeSkills!.defs.find((x) => x.kind === 'surf' && x.move >= 0);
      fireSheerCold(world, p, pm, dx, dy, surf?.move ?? -1, d.sheerCold);
      return;
    }
    case 'mirrorCoat': {
      if (!pm || !d.mirror) return;
      const { st } = skillMoveStats(world, p, pm);
      p.mirror = { untilTick: world.tick + Math.round(st.durationSeconds / world.dt), absorbed: 0, hits: 0, slot: world.rules.activeSkills!.defs.indexOf(d) };
      return;
    }
  }
}

/** ミラーコートの終わり: 吸った分だけ鏡の破片を飛ばす */
function releaseMirror(world: World, p: Player): void {
  const m = p.mirror!;
  p.mirror = undefined;
  const d = skillDef(world, m.slot);
  const pm = d.move >= 0 ? p.moves.find((x) => x.move === d.move) : undefined;
  if (!pm || !d.mirror) return;
  const { st } = skillMoveStats(world, p, pm);
  const count = Math.min(d.mirror.maxShards, Math.max(1, st.count) + Math.round(m.hits * d.mirror.shardsPerHit));
  const mult = 1 + (m.absorbed / Math.max(1, p.maxHp)) * (d.mirror.absorbPowerPct / 100);
  fireMirrorShards(world, p, pm, count, mult, d.mirror.shardSpeed);
  world.events.push({ type: 'mirrorReleased', playerId: p.id, count });
}

/** ミラーコートが効いているか */
export function mirrorActive(world: World, p: Player): boolean {
  return !!p.mirror && world.tick < p.mirror.untilTick;
}

/** ミラーコートに吸わせる（ダメージを受けない。少しの間は続けて吸わない） */
export function absorbIntoMirror(world: World, p: Player, amount: number): void {
  const m = p.mirror!;
  m.absorbed += amount;
  m.hits++;
  p.invincibleTicks = Math.round(world.rules.stats.hurtInvincibleSeconds / world.dt);
  world.events.push({ type: 'mirrorAbsorbed', playerId: p.id, amount });
}

/** ほかのブラウザのプレイヤーが使ったスキルを、見た目だけ出す（位置と向きは届いた値） */
export function replaySkill(world: World, p: Player, slot: number, x: number, y: number, dx: number, dy: number): void {
  const s = p.skills?.[slot];
  if (!s || !p.remote) return;
  const d = skillDef(world, s.skill);
  const pm = skillMove(world, p, s);
  const ox = p.x;
  const oy = p.y;
  p.x = x;
  p.y = y;
  if (d.kind === 'mirrorCoat' && pm) p.mirror = { untilTick: world.tick + Math.round(skillMoveStats(world, p, pm).st.durationSeconds / world.dt), absorbed: 0, hits: 0, slot: s.skill };
  else runSkill(world, p, d, pm, dx, dy);
  p.x = ox;
  p.y = oy;
}

/**
 * キーで使う技（pattern "skill"）を、スキルの枠に無いプレイヤーが持っているとき（技の表を測るミュウ など）: 使えるようになるたびに出す。
 * スキルの枠にあれば何もしない（キーで使う）
 */
export function autoSkillMove(world: World, p: Player, pm: PlayerMove): void {
  const defs = world.rules.activeSkills?.defs ?? [];
  const di = defs.findIndex((d) => d.move === pm.move);
  if (di === -1 || p.skills?.some((s) => s.skill === di)) return;
  pm.cooldown -= world.dt;
  if (pm.cooldown > 0) return;
  const { sc } = skillMoveStats(world, p, pm);
  pm.cooldown = sc.cooldownSeconds;
  const [dx, dy] = aimOf(p);
  runSkill(world, p, defs[di]!, pm, dx, dy);
}

/** スキルの強化で上がる技の威力（%） */
export function skillPowerPct(world: World, p: Player): number {
  return p.skillBuff && world.tick < p.skillBuff.untilTick ? p.skillBuff.pct : 0;
}
