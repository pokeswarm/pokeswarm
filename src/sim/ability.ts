import type { Player } from './entities/player';
import type { SimAbility } from './rules';
import type { Modifiers } from './upgrades';
import type { World } from './world';
import { hash01 } from './math';
import { bumpRunStat } from './runStats';
import { currentWeather } from './systems/stage';
import { findEnemyIndex } from './world';

/**
 * 特性（ホウエン。作者の決定 2026年10月29日。07 の133章）: 系統ごとに1つ。プレイヤーだけ・特性のある地方だけ。
 * いつも効く mods は recomputeModifiers で足し、HP が少ない間だけ効く pinch（しんりょく・もうか・げきりゅう）は技の威力を出すときに足す。
 * HP・接触・倒した敵のように本人のブラウザでしか分からないものは、本人のブラウザで効かせる
 */
export function abilityOf(world: World, p: Pick<Player, 'line' | 'species' | 'id' | 'x' | 'y'>, depth = 0): SimAbility | undefined {
  const ab = world.rules.abilities;
  const line = ab?.lines[p.line];
  if (!ab || !line) return undefined;
  const def = ab.defs[line.forms[p.species] ?? line.key];
  if (!def?.trace || depth > 0) return def;
  // トレース: 協力プレイでは一番近い味方（トレースでない特性）を写す。ソロでは pool のどれか（ランと人で決まる）
  let best: SimAbility | undefined;
  let bestD = Infinity;
  for (const o of world.players) {
    if (o.id === p.id || o.down) continue;
    const a = abilityOf(world, o, depth + 1);
    const d = (o.x - p.x) ** 2 + (o.y - p.y) ** 2;
    if (a && !a.trace && d < bestD) {
      best = a;
      bestD = d;
    }
  }
  if (best) return best;
  const pool = def.trace;
  return ab.defs[pool[Math.floor(hash01(world.seed, p.id, 0, 0x7ace) * pool.length) % pool.length]!] ?? def;
}

/** HP が少ない間だけ効く特性の効果（今効いていなければ null）。HP は本人のブラウザの値で決める（ダメージも本人のブラウザで決まる） */
export function pinchMods(world: World, p: Player): Modifiers | null {
  const pinch = abilityOf(world, p)?.pinch;
  if (!pinch || p.down) return null;
  return p.hp <= (p.maxHp * pinch.hpPct) / 100 ? pinch.mods : null;
}

/** 技の威力の倍率（なまけ） */
export function abilityPowerMultiplier(world: World, p: Player): number {
  return abilityOf(world, p)?.truant?.powerMultiplier ?? 1;
}

/** 天気の間の移動速度の倍率（すいすい） */
export function abilityMoveSpeedFactor(world: World, p: Player): number {
  const w = abilityOf(world, p)?.weather;
  if (!w || w.moveSpeedPct === 0) return 1;
  const now = currentWeather(world)?.id;
  return now && w.kinds.includes(now) ? 1 + w.moveSpeedPct / 100 : 1;
}

/** 敵 i の移動速度の倍率（ありじごく: 周りの雑魚・かげふみ: 周りの中ボス・ボス） */
export function abilityEnemySlow(world: World, i: number): number {
  if (!world.rules.abilities) return 1;
  const e = world.enemies;
  const boss = (world.rules.enemies.kinds[e.kind[i]!]?.rank ?? 'normal') !== 'normal';
  let m = 1;
  for (const p of world.players) {
    const s = abilityOf(world, p)?.enemySlow;
    if (!s || p.down || (s.ranks === 'boss') !== boss) continue;
    if ((e.x[i]! - p.x) ** 2 + (e.y[i]! - p.y) ** 2 <= s.radius * s.radius) m = Math.min(m, 1 - s.pct / 100);
  }
  return m;
}

/** 触れてきた敵 i から受けるダメージの倍率（あついしぼう） */
export function abilityContactTaken(world: World, p: Player, i: number): number {
  const t = abilityOf(world, p)?.typeDamageTakenPct;
  if (!t) return 1;
  let pct = 0;
  for (const type of world.rules.enemies.kinds[world.enemies.kind[i]!]?.types ?? []) pct += t[type] ?? 0;
  return Math.max(0, 1 + pct / 100);
}

/**
 * 倒れる攻撃を HP 1 で耐える（がんじょう。区間ごとに1回）。耐えたら true。本人のブラウザで決める
 */
export function abilitySturdy(world: World, p: Player): boolean {
  if (!abilityOf(world, p)?.sturdy || p.sturdySection === world.section) return false;
  p.sturdySection = world.section;
  p.hp = 1;
  bumpRunStat(world, p, 'sturdy');
  return true;
}

/**
 * 毎回の更新（本人のブラウザの自分のプレイヤーだけ）: 区間が変わったときの回復（しぜんかいふく）・天気の回復（うるおいボディ）・
 * 倒した敵の数（じしんかじょうの重ね・いかくの記録）
 */
export function stepAbilities(world: World): void {
  const me = world.players.find((p) => p.id === world.localPlayerId);
  if (!me || !world.rules.abilities) return;
  const a = abilityOf(world, me);
  if (!a) return;
  if (me.abilitySection !== world.section) {
    if (me.abilitySection !== undefined && a.sectionHealPct && !me.down) me.hp = Math.min(me.maxHp, me.hp + (me.maxHp * a.sectionHealPct) / 100);
    me.abilitySection = world.section;
  }
  if (a.weather && a.weather.regenPctPerSecond > 0 && !me.down) {
    const now = currentWeather(world)?.id;
    if (now && a.weather.kinds.includes(now)) me.hp = Math.min(me.maxHp, me.hp + (me.maxHp * a.weather.regenPctPerSecond * world.dt) / 100);
  }
  const ks = a.killStack;
  if (ks && me.killStack && world.tick >= me.killStack.untilTick) me.killStack = undefined;
  for (const ev of world.events) {
    if (ev.type !== 'enemyKilled' || ev.by !== me.id) continue;
    if (ks) {
      const pct = Math.min(ks.maxPct, (me.killStack?.pct ?? 0) + ks.perKillPct);
      me.killStack = { pct, untilTick: world.tick + Math.round(ks.seconds / world.dt) };
      if (pct >= ks.maxPct) bumpRunStat(world, me, 'moxieMax');
    }
    if (a.intimidateRadius) {
      const i = findEnemyIndex(world, ev.enemyId);
      if (i >= 0 && (world.enemies.x[i]! - me.x) ** 2 + (world.enemies.y[i]! - me.y) ** 2 <= a.intimidateRadius ** 2) bumpRunStat(world, me, 'intimidateKills');
    }
  }
}

/** 倒すたびに重なる物理の威力（じしんかじょう）の今の % */
export function killStackPct(world: World, p: Player): number {
  return p.killStack && world.tick < p.killStack.untilTick ? p.killStack.pct : 0;
}
