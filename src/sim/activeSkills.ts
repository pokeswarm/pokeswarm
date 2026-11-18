import type { Player } from './entities/player';
import type { SimActiveSkill } from './rules';
import type { World } from './world';

/**
 * アクティブスキル（作者の案 2026年11月18日。07 の305章）: キー（SPACE・Q・E）で使う、技の枠とは別の技。
 * ためておける回数があり、1 回分ずつ時間で戻る。レベルアップの候補で回数が増える。
 * 自分のプレイヤーだけを動かす（位置は本人のブラウザが決め、ほかのブラウザへは位置として届く）
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

/** ためておける回数（レベルと、技の数の強化 = ポイントマックス） */
export function maxCharges(world: World, p: Player, s: { skill: number; level: number }): number {
  const d = skillDef(world, s.skill);
  return Math.max(1, d.baseCharges + (s.level - 1) * d.chargesPerLevel + Math.max(0, p.mods.amountBonus));
}

/** 1 回分が戻るまでの更新回数（技の再使用の強化 = メトロノーム などで速くなる） */
export function rechargeTicksOf(world: World, p: Player, s: { skill: number }): number {
  const d = skillDef(world, s.skill);
  return Math.max(1, Math.round((d.rechargeSeconds * Math.max(0.2, 1 + p.mods.cooldownPct / 100)) / world.dt));
}

/** 毎回の更新: 回数を時間で戻す・強化の切れ目 */
export function stepSkills(world: World): void {
  for (const p of world.players) {
    if (p.skillBuff && world.tick >= p.skillBuff.untilTick) p.skillBuff = undefined;
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
function aimOf(p: Player): [number, number] {
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
  let x = p.x + ax * d.distance;
  let y = p.y + ay * d.distance;
  const a = world.arena;
  if (a) {
    x = Math.max(a.x - a.halfWidth + p.radius, Math.min(a.x + a.halfWidth - p.radius, x));
    y = Math.max(a.y - a.halfHeight + p.radius, Math.min(a.y + a.halfHeight - p.radius, y));
  }
  return { x, y };
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
  const max = maxCharges(world, p, s);
  if (s.charges >= max) s.rechargeTicks = rechargeTicksOf(world, p, s);
  s.charges--;
  if (d.kind === 'teleport') {
    const fromX = p.x;
    const fromY = p.y;
    const to = teleportDestination(world, p, s.skill);
    p.x = p.prevX = to.x;
    p.y = p.prevY = to.y;
    if (d.buff) {
      const live = p.skillBuff && world.tick < p.skillBuff.untilTick;
      const stacks = Math.min(d.buff.maxStacks, (live ? p.skillBuff!.stacks : 0) + 1);
      p.skillBuff = { stacks, pct: stacks * d.buff.powerPct, untilTick: world.tick + Math.round(d.buff.seconds / world.dt) };
    }
    world.events.push({ type: 'skillUsed', playerId: p.id, skill: s.skill, fromX, fromY, toX: p.x, toY: p.y, stacks: p.skillBuff?.stacks ?? 0 });
  }
}

/** スキルの強化で上がる技の威力（%） */
export function skillPowerPct(world: World, p: Player): number {
  return p.skillBuff && world.tick < p.skillBuff.untilTick ? p.skillBuff.pct : 0;
}
