import type { World } from './world';

/**
 * マップの障害物（作者の決定。2026年10月）: 区間ごとに、通り抜けられないもの（木・岩・柱など）を置く。
 * プレイヤーも敵も技も遮る。量は少なく、まっすぐ一方向へ進み続けるだけの単調なプレイを崩す程度にする。
 *
 * 置き方: 地面を cellSize のマスに区切り、マスごとにランのシードから計算して 0〜1 個置く（乱数の状態は使わない）。
 * 同じランなら協力プレイの全員で同じ場所になり、通信は要らない。場所は区間によらず同じで、区間で変わるのは見た目だけ
 * （区間が進んだ瞬間に足元へ障害物が現れないように）。最初の場所の近く（safeRadius）には置かない。
 */
export interface ObstacleRules {
  readonly cellSize: number;
  /** マスに1つ置く確率 */
  readonly chance: number;
  /** マスの端からこれだけ離して置く（隣のマスの障害物とくっつかないように） */
  readonly margin: number;
  /** 当たり判定の半径 */
  readonly radius: number;
  readonly safeRadius: number;
  /** 区間（spawn.json の waves）ごとに使う見た目の種類（data/render/obstacles.json のキー） */
  readonly sections: readonly (readonly string[])[];
}

export interface Obstacle {
  readonly x: number;
  readonly y: number;
  /** 見た目を選ぶための数（区間の種類の数で割った余りを使う） */
  readonly variant: number;
}

/** 整数3つから、よく混ざった 32bit の数を作る（同じ入力なら必ず同じ） */
function mix(seed: number, a: number, b: number): number {
  let h = (seed ^ Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

const UNIT = 1 / 4294967296;

/** マス (cx, cy) の障害物（無ければ null）。一度計算したら覚えておく */
export function obstacleInCell(world: World, cx: number, cy: number): Obstacle | null {
  const key = cx * 1000003 + cy;
  const cached = world.obstacleCache.get(key);
  if (cached !== undefined) return cached;
  const cfg = world.rules.obstacles;
  let out: Obstacle | null = null;
  if (cfg.chance > 0 && mix(world.seed, cx, cy) * UNIT < cfg.chance) {
    const span = cfg.cellSize - cfg.margin * 2;
    const x = cx * cfg.cellSize + cfg.margin + mix(world.seed + 1, cx, cy) * UNIT * span;
    const y = cy * cfg.cellSize + cfg.margin + mix(world.seed + 2, cx, cy) * UNIT * span;
    if (x * x + y * y > cfg.safeRadius * cfg.safeRadius) out = { x, y, variant: mix(world.seed + 3, cx, cy) };
  }
  world.obstacleCache.set(key, out);
  return out;
}

/** (x0, y0)〜(x1, y1) の範囲にかかるマスの障害物を順に渡す */
export function forEachObstacleIn(world: World, x0: number, y0: number, x1: number, y1: number, fn: (o: Obstacle) => void): void {
  const size = world.rules.obstacles.cellSize;
  if (world.rules.obstacles.chance <= 0) return;
  const cx0 = Math.floor(x0 / size);
  const cy0 = Math.floor(y0 / size);
  const cx1 = Math.floor(x1 / size);
  const cy1 = Math.floor(y1 / size);
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const o = obstacleInCell(world, cx, cy);
      if (o) fn(o);
    }
  }
}

/** 半径 r の円が障害物に重なっていたら、外へ押し出した位置を返す（重なっていなければ null） */
export function pushOutOfObstacles(world: World, x: number, y: number, r: number): [number, number] | null {
  const R = world.rules.obstacles.radius;
  let nx = x;
  let ny = y;
  let moved = false;
  forEachObstacleIn(world, x - r - R, y - r - R, x + r + R, y + r + R, (o) => {
    const dx = nx - o.x;
    const dy = ny - o.y;
    const min = r + R;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) return;
    const d = Math.sqrt(d2);
    // ちょうど中心なら右へ出す
    const ux = d > 1e-6 ? dx / d : 1;
    const uy = d > 1e-6 ? dy / d : 0;
    nx = o.x + ux * min;
    ny = o.y + uy * min;
    moved = true;
  });
  return moved ? [nx, ny] : null;
}

/** 点が障害物の中にあるか（飛ぶ技を止める） */
export function insideObstacle(world: World, x: number, y: number): boolean {
  const R = world.rules.obstacles.radius;
  let hit = false;
  forEachObstacleIn(world, x - R, y - R, x + R, y + R, (o) => {
    if ((x - o.x) ** 2 + (y - o.y) ** 2 < R * R) hit = true;
  });
  return hit;
}

/** (x, y) から向き (dx, dy) に len 進む線が、最初に障害物に当たるまでの長さ（当たらなければ len） */
export function rayLengthToObstacle(world: World, x: number, y: number, dx: number, dy: number, len: number): number {
  const R = world.rules.obstacles.radius;
  const ex = x + dx * len;
  const ey = y + dy * len;
  let best = len;
  forEachObstacleIn(world, Math.min(x, ex) - R, Math.min(y, ey) - R, Math.max(x, ex) + R, Math.max(y, ey) + R, (o) => {
    // 線と円の交点（手前の方）
    const fx = x - o.x;
    const fy = y - o.y;
    const b = fx * dx + fy * dy;
    const c = fx * fx + fy * fy - R * R;
    // 始点が中にあるときは遮らない（自分の足元の障害物で技が出なくならないように）
    if (c <= 0) return;
    const disc = b * b - c;
    if (disc < 0) return;
    const t = -b - Math.sqrt(disc);
    if (t >= 0 && t < best) best = t;
  });
  return best;
}

/** プレイヤー（自分のブラウザで動かす人）と敵を、障害物の外へ押し出す */
export function blockByObstacles(world: World): void {
  if (world.rules.obstacles.chance <= 0) return;
  for (const p of world.players) {
    if (p.down || p.remote) continue;
    const out = pushOutOfObstacles(world, p.x, p.y, p.radius);
    if (out) [p.x, p.y] = out;
  }
  const e = world.enemies;
  for (let i = 0; i < e.count; i++) {
    const out = pushOutOfObstacles(world, e.x[i]!, e.y[i]!, e.radius[i]!);
    if (out) [e.x[i], e.y[i]] = out;
  }
}
