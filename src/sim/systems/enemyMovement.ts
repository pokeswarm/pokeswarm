import type { Player } from '../entities/player';
import { axisToUnit, hash01 } from '../math';
import { currentWaveIndex, type World } from '../world';
import { speedMultiplier } from './status';

/**
 * 雑魚敵の移動。一番近いプレイヤーへまっすぐ向かう。
 * 一番近いプレイヤーからも離れすぎた敵は、そのプレイヤーの進行方向側へ移し替える。
 */
export function moveEnemies(world: World): void {
  const { enemies: e, players } = world;
  if (players.length === 0) return;
  const s = world.rules.spawn;
  const relocate2 = s.relocateDistance * s.relocateDistance;
  // 前の時間帯の種類を消すのはホスト（ソロ）だけ。ゲストはホストから知らせを受けて消す
  const retire = s.retireOldWaveKinds && world.role !== 'guest';
  const waveKinds = world.waves[currentWaveIndex(world)]!.kinds;
  for (let i = 0; i < e.count; i++) {
    const x = e.x[i]!;
    const y = e.y[i]!;
    e.prevX[i] = x;
    e.prevY[i] = y;

    let target: Player = players[0]!;
    let best = Infinity;
    for (const p of players) {
      const dx = p.x - x;
      const dy = p.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) {
        best = d2;
        target = p;
      }
    }

    if (best > relocate2) {
      if (retire && !waveKinds.includes(e.kind[i]!)) {
        e.hp[i] = 0;
        world.events.push({ type: 'enemyRetired', id: e.id[i]! });
        continue;
      }
      const [fx, fy] = axisToUnit(target.facingX, target.facingY);
      // 移し替え先は共有の乱数ではなく、敵の id と移し替えた回数から決める
      // （ホストとゲストで乱数の使い方や更新番号が違っても、同じ場所になる）
      const id = e.id[i]!;
      const n = e.relocations[i]!++;
      const dist = s.spawnDistanceMin + hash01(world.seed, id, n, 1) * (s.spawnDistanceMax - s.spawnDistanceMin);
      const side = (hash01(world.seed, id, n, 2) * 2 - 1) * s.relocateSideSpread;
      // 進行方向 (fx, fy) の先、横方向 (-fy, fx) にばらつかせる
      e.x[i] = e.prevX[i] = target.x + fx * dist - fy * side;
      e.y[i] = e.prevY[i] = target.y + fy * dist + fx * side;
      continue;
    }
    if (best > 0) {
      const d = Math.sqrt(best);
      const step = Math.min(e.speed[i]! * speedMultiplier(world, i) * world.dt, d);
      e.x[i] = x + ((target.x - x) / d) * step;
      e.y[i] = y + ((target.y - y) / d) * step;
    }
    // ノックバックは止まっていても効く
    if (e.kbTicks[i]! > 0) {
      e.x[i]! += e.kbVx[i]! * world.dt;
      e.y[i]! += e.kbVy[i]! * world.dt;
      e.kbTicks[i]!--;
    }
  }
}

export function rebuildEnemyHash(world: World): void {
  const { enemies: e, enemyHash } = world;
  enemyHash.clear();
  for (let i = 0; i < e.count; i++) enemyHash.insert(i, e.x[i]!, e.y[i]!);
}

/** 敵同士の簡易的な押し合い。調べる相手の数に上限を設けて負荷を抑える */
export function separateEnemies(world: World): void {
  // 密集していても集める数は neighborScratch の大きさまで（負荷が敵の密度に比例して増えないように）
  const { enemies: e, enemyHash, neighborScratch: scratch } = world;
  const { strength, maxNeighbors } = world.rules.spawn.separation;
  if (strength === 0 || maxNeighbors === 0) return;
  for (let i = 0; i < e.count; i++) {
    const r = e.radius[i]!;
    const n = enemyHash.queryRect(e.x[i]! - r * 2, e.y[i]! - r * 2, e.x[i]! + r * 2, e.y[i]! + r * 2, scratch);
    let checked = 0;
    for (let k = 0; k < n && checked < maxNeighbors; k++) {
      const j = scratch[k]!;
      if (j === i) continue;
      checked++;
      const dx = e.x[i]! - e.x[j]!;
      const dy = e.y[i]! - e.y[j]!;
      const minD = r + e.radius[j]!;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minD * minD) continue;
      if (d2 === 0) {
        // 完全に重なっていたら番号で決まる向きにずらす
        e.x[i]! += i < j ? 0.5 : -0.5;
        continue;
      }
      const d = Math.sqrt(d2);
      const push = ((minD - d) / d) * strength * 0.5;
      e.x[i]! += dx * push;
      e.y[i]! += dy * push;
    }
  }
}
