import type { World } from '../world';
import { healPlayer } from './health';

/** 状態異常による移動の速さの倍率（かかっているもののうち一番遅いもの） */
export function speedMultiplier(world: World, i: number): number {
  const e = world.enemies;
  let m = 1;
  for (let s = 0; s < world.statusKinds.length; s++) {
    if (e.hasStatus(i, s)) m = Math.min(m, world.statusKinds[s]!.speedMultiplier);
  }
  return m;
}

/** 状態異常による、触れたときのダメージの倍率（こうげきダウン。かかっているものを掛け合わせる） */
export function contactDamageMultiplier(world: World, i: number): number {
  const e = world.enemies;
  let m = 1;
  for (let s = 0; s < world.statusKinds.length; s++) {
    if (e.hasStatus(i, s)) m *= world.statusKinds[s]!.contactDamageMultiplier;
  }
  return m;
}

/** 状態異常による受けるダメージの倍率（かかっているものを掛け合わせる） */
export function damageTakenMultiplier(world: World, i: number): number {
  const e = world.enemies;
  let m = 1;
  for (let s = 0; s < world.statusKinds.length; s++) {
    if (e.hasStatus(i, s)) m *= world.statusKinds[s]!.damageTakenMultiplier;
  }
  return m;
}

/**
 * 状態異常の時間を進め、継続ダメージを与える。
 * HP を減らすのはソロとホストだけ（ゲストの HP は見た目用で、撃破はホストから届く）。
 */
export function tickStatuses(world: World): void {
  const e = world.enemies;
  const n = world.statusKinds.length;
  const applyDamage = world.role !== 'guest';
  for (let i = 0; i < e.count; i++) {
    if (e.hp[i]! <= 0) continue;
    const taken = applyDamage ? damageTakenMultiplier(world, i) : 1;
    for (let s = 0; s < n; s++) {
      const k = i * n + s;
      if (e.statusTicks[k]! === 0) continue;
      e.statusTicks[k]!--;
      const dps = world.statusKinds[s]!.damagePerSecond;
      if (!applyDamage || dps === 0 || e.hp[i]! <= 0) continue;
      e.hp[i]! -= dps * world.dt * taken;
      // やどりぎ: 継続ダメージの分だけ、付けたプレイヤーが回復する
      if (world.statusKinds[s]!.healsAttacker) healPlayer(world, e.statusBy[k]!, dps * world.dt * taken);
      if (e.hp[i]! <= 0) {
        world.events.push({ type: 'enemyKilled', enemyId: e.id[i]!, kind: e.kind[i]!, by: e.statusBy[k]! });
        world.stats.kills++;
      }
    }
  }
}

/** ダメージを受けたら治る状態異常（ねむり）を治す。HP を減らした側（ソロ・ホスト）が呼ぶ */
export function breakOnDamage(world: World, i: number): void {
  const e = world.enemies;
  for (let s = 0; s < world.statusKinds.length; s++) {
    if (world.statusKinds[s]!.breaksOnDamage) e.statusTicks[i * e.statusCount + s] = 0;
  }
}
