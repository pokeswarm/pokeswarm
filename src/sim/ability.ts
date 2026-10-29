import type { Player } from './entities/player';
import type { Modifiers } from './upgrades';
import type { World } from './world';

/**
 * 特性（ホウエン。作者の決定 2026年10月29日。07 の133章）: 系統ごとに1つ。プレイヤーだけ・特性のある地方だけ。
 * いつも効く mods は recomputeModifiers で足し、HP が少ない間だけ効く pinch（しんりょく・もうか・げきりゅう）は技の威力を出すときに足す
 */
export function abilityOf(world: World, p: Pick<Player, 'line'>) {
  return world.rules.abilities?.[p.line];
}

/** HP が少ない間だけ効く特性の効果（今効いていなければ null）。HP は本人のブラウザの値で決める（ダメージも本人のブラウザで決まる） */
export function pinchMods(world: World, p: Player): Modifiers | null {
  const pinch = abilityOf(world, p)?.pinch;
  if (!pinch || p.down) return null;
  return p.hp <= (p.maxHp * pinch.hpPct) / 100 ? pinch.mods : null;
}
