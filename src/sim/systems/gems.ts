import type { PlayerId } from '../commands';
import { findEnemyIndex, type World } from '../world';

/**
 * 倒した敵の場所に経験値の玉を落とす（ソロ・ホストだけ。ゲストはホストから受け取る）。
 * 玉が上限に達していたら、新しい玉を作らずに一番古い玉へ経験値をまとめる。
 * 倒れた敵はこの更新の最後に取り除かれるので、それより前に呼ぶ。
 */
export function dropGems(world: World): void {
  if (world.role === 'guest') return;
  const { gems, enemies: e } = world;
  const p = world.rules.pickups;
  for (const ev of world.events) {
    if (ev.type !== 'enemyKilled') continue;
    const i = findEnemyIndex(world, ev.enemyId);
    if (i === -1) continue;
    if (gems.count >= gems.capacity) {
      const g = gems.oldest();
      gems.value[g]! += p.xpPerKill;
      world.events.push({ type: 'gemMerged', id: gems.id[g]!, value: gems.value[g]! });
      continue;
    }
    const id = world.nextGemId++;
    gems.add(id, e.x[i]!, e.y[i]!, p.xpPerKill, p.gemRadius);
    world.events.push({ type: 'gemSpawned', id, x: e.x[i]!, y: e.y[i]!, value: p.xpPerKill });
  }
}

/** 取得範囲に入った玉を、一番近いプレイヤーへ吸い寄せる（各ブラウザで計算する。見た目と触れる判定のため） */
export function moveGems(world: World): void {
  const { gems, players } = world;
  const speed = world.rules.pickups.magnetSpeed * world.dt;
  for (let i = 0; i < gems.count; i++) {
    gems.prevX[i] = gems.x[i]!;
    gems.prevY[i] = gems.y[i]!;
    if (gems.pending[i]) continue;
    let best = Infinity;
    let tx = 0;
    let ty = 0;
    for (const p of players) {
      const dx = p.x - gems.x[i]!;
      const dy = p.y - gems.y[i]!;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) {
        best = d2;
        tx = p.x;
        ty = p.y;
      }
      if (!gems.attracted[i] && d2 <= p.pickupRange * p.pickupRange) gems.attracted[i] = 1;
    }
    if (!gems.attracted[i] || best === Infinity || best === 0) continue;
    const d = Math.sqrt(best);
    const step = Math.min(speed, d);
    gems.x[i]! += ((tx - gems.x[i]!) / d) * step;
    gems.y[i]! += ((ty - gems.y[i]!) / d) * step;
  }
}

/**
 * 自分のプレイヤーが触れた玉を拾う。触れたかは自分のブラウザで判定する。
 * ソロ・ホストはその場で確定し、ゲストは自分の画面で消して見せてホストへ伝える。
 */
export function collectGems(world: World): void {
  const { gems } = world;
  const me = world.players.find((p) => p.id === world.localPlayerId);
  if (!me) return;
  const r = me.radius + world.rules.pickups.gemRadius;
  for (let i = gems.count - 1; i >= 0; i--) {
    if (gems.pending[i]) continue;
    const dx = gems.x[i]! - me.x;
    const dy = gems.y[i]! - me.y;
    if (dx * dx + dy * dy > r * r) continue;
    if (world.role === 'guest') {
      gems.pending[i] = 1;
      world.events.push({ type: 'pickupRequested', id: gems.id[i]!, by: me.id });
    } else {
      confirmPickup(world, gems.id[i]!, me.id);
    }
  }
}

/** ホスト（ソロ）: 玉の取得を確定する。すでに無ければ（先に誰かが拾った）何もしない */
export function confirmPickup(world: World, id: number, by: PlayerId): boolean {
  const g = world.gems.indexOf(id);
  if (g === -1) return false;
  const value = world.gems.value[g]!;
  world.gems.removeAt(g);
  world.xp += value;
  world.events.push({ type: 'gemCollected', id, by, value });
  return true;
}
