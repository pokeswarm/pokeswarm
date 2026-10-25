import { SHAPE_LINE } from '../entities/projectiles';
import type { World } from '../world';
import { spawnItem } from './items';

/**
 * マップの箱（作者の決定 2026年10月25日）: 攻撃を決まった回数当てると開き、一時的な強化（プラスパワーなど）を落とす。
 * 出す・当たったかの判定・開けるのはソロ・ホスト（ほかの人の技も、ホストの画面にある当たり判定で数える）。
 * ゲストは、ホストから届く出現と開いた知らせに合わせる
 */
export function stepBoxes(world: World): void {
  const cfg = world.rules.pickups.boxes;
  if (!cfg || world.role === 'guest' || world.players.length === 0) return;
  despawnFarBoxes(world, cfg.despawnDistance);
  if (--world.boxTimer <= 0) {
    world.boxTimer = Math.round(cfg.spawnSeconds / world.dt);
    if (world.boxes.length < cfg.max) {
      // だれかの周りのランダムな場所
      const p = world.players[world.rng.int(world.players.length)]!;
      const a = world.rng.next() * Math.PI * 2;
      const d = cfg.distanceMin + world.rng.next() * (cfg.distanceMax - cfg.distanceMin);
      addBox(world, world.nextBoxId++, Math.round(p.x + Math.cos(a) * d), Math.round(p.y + Math.sin(a) * d));
    }
  }
  hitBoxes(world, cfg.radius);
}

export function addBox(world: World, id: number, x: number, y: number): void {
  const hits = world.rules.pickups.boxes?.hits ?? 1;
  world.boxes.push({ id, x, y, hp: hits, hits: [] });
  world.events.push({ type: 'boxSpawned', id, x, y });
}

/** 箱を取り除く（開いた・遠くなった）。opened なら開いた演出を出す */
export function removeBox(world: World, id: number, opened: boolean): void {
  const k = world.boxes.findIndex((b) => b.id === id);
  if (k === -1) return;
  const b = world.boxes[k]!;
  world.boxes.splice(k, 1);
  world.events.push({ type: 'boxRemoved', id, x: b.x, y: b.y, opened });
}

function despawnFarBoxes(world: World, distance: number): void {
  for (const b of [...world.boxes]) {
    if (world.players.some((p) => (p.x - b.x) ** 2 + (p.y - b.y) ** 2 < distance * distance)) continue;
    removeBox(world, b.id, false);
  }
}

/** 技の当たり判定（技そのもの・効き方）が重なった箱を数え、決まった回数で開ける */
function hitBoxes(world: World, radius: number): void {
  if (world.boxes.length === 0) return;
  const pr = world.projectiles;
  for (const b of [...world.boxes]) {
    for (let i = 0; i < pr.count; i++) {
      // 予告の印（2）・出番を待つもの（3）は当たらない
      if (pr.stage[i]! >= 2) continue;
      const r = pr.radius[i]! + radius;
      const line = pr.shape[i] === SHAPE_LINE;
      const d2 = line ? segmentDistance2(b.x, b.y, pr.x[i]!, pr.y[i]!, pr.dirX[i]!, pr.dirY[i]!, pr.length[i]!) : (b.x - pr.x[i]!) ** 2 + (b.y - pr.y[i]!) ** 2;
      if (d2 > r * r) continue;
      const serial = pr.serial[i]!;
      if (b.hits.includes(serial)) continue;
      b.hits.push(serial);
      if (b.hits.length > 32) b.hits.shift();
      b.hp--;
      world.events.push({ type: 'boxHit', id: b.id });
      if (b.hp <= 0) {
        removeBox(world, b.id, true);
        spawnItem(world, world.nextItemId++, 'buff', b.x, b.y);
        break;
      }
    }
  }
}

/** 点と線分（start から dir の向きへ length）の距離の2乗 */
function segmentDistance2(px: number, py: number, sx: number, sy: number, dx: number, dy: number, length: number): number {
  const t = Math.max(0, Math.min(length, (px - sx) * dx + (py - sy) * dy));
  return (px - sx - dx * t) ** 2 + (py - sy - dy * t) ** 2;
}

/** 箱の一時的な強化の残り時間を減らし、切れたら外す */
export function tickBuffs(world: World, recompute: (p: World['players'][number]) => void): void {
  for (const p of world.players) {
    if (!p.buffs || p.buffs.length === 0) continue;
    let changed = false;
    for (const b of p.buffs) if (--b.ticksLeft <= 0) changed = true;
    if (!changed) continue;
    p.buffs = p.buffs.filter((b) => b.ticksLeft > 0);
    recompute(p);
  }
}
