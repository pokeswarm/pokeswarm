import Phaser from 'phaser';
import { findEnemyIndex, type World } from '../../sim/world';
import { hazardHits } from '../../sim/systems/stage';

/**
 * 色違いのフシギバナの技の絵（07 の255章）。見た目だけ（当たりはシミュレーション）:
 * ねむりごなの雲（花から粉が飛び、やわらかい雲が流れる）・ヘドロの毒だまり・ハードプラントの根・ギガドレインで吸われる光の粒
 */
export class ShinyVenusaurPlant {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly add: Phaser.GameObjects.Graphics;
  private readonly floor: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, depth: number, floorDepth: number) {
    this.g = scene.add.graphics().setDepth(depth);
    this.add = scene.add.graphics().setDepth(depth + 0.01).setBlendMode(Phaser.BlendModes.ADD);
    this.floor = scene.add.graphics().setDepth(floorDepth);
  }

  update(world: World, timeMs: number, alpha: number): void {
    this.g.clear();
    this.add.clear();
    this.floor.clear();
    const moves = world.rules.stage.moves;
    const roots: { h: World['hazards'][number]; t: number; left: number }[] = [];
    for (const h of world.hazards) {
      const mv = moves[h.move];
      if (!mv) continue;
      const total = Math.max(1, Math.round((mv.activeSeconds ?? 0) / world.dt));
      const t = h.activeTicks === undefined ? 0 : (total - h.activeTicks + alpha) * world.dt;
      const left = h.activeTicks === undefined ? 0 : Math.max(0, (h.activeTicks - alpha) * world.dt);
      if (mv.id === 'venusaur-s-sleep-powder') {
        if (h.activeTicks === undefined) this.drawPowderLaunch(world, h, timeMs);
        else {
          // 流れている雲は、描く時刻まで進める
          const x = h.x + (h.vx ?? 0) * world.dt * (alpha - 1);
          const y = h.y + (h.vy ?? 0) * world.dt * (alpha - 1);
          this.drawCloud(x, y, h.radius, timeMs, Math.min(1, t / 0.4) * Math.min(1, left / 0.6), h.x * 0.013 + h.y * 0.007);
        }
      } else if (mv.id === 'venusaur-s-sludge-puddle' && h.activeTicks !== undefined) {
        this.drawPuddle(h.x, h.y, h.radius, timeMs, Math.min(1, t / 0.15) * Math.min(1, left / 0.5), h.x * 0.021 + h.y * 0.017);
      } else if (mv.id === 'venusaur-s-frenzy-plant' && h.activeTicks !== undefined) {
        roots.push({ h, t, left });
      } else if (mv.id === 'venusaur-s-body-slam' && h.activeTicks !== undefined) {
        // 着地: 当たりの縁まで土ぼこりの輪が広がる（くぼみの絵は体の下に隠れるので、届いた範囲を輪で見せる）
        const total0 = Math.max(1, Math.round(world.rules.stage.bossRules.hazardActiveSeconds / world.dt));
        this.drawSlamDust(h.x, h.y, h.radius, Math.min(1, (total0 - h.activeTicks + alpha) / total0));
      } else if (mv.id === 'venusaur-s-giga-drain' && h.activeTicks !== undefined) {
        this.drawDrain(world, h, timeMs, mv);
      }
    }
    // 根は画面の下（手前）ほどあとに描く
    roots.sort((p, q) => p.h.y - q.h.y);
    for (const r of roots) this.drawRoots(r.h.x, r.h.y, r.h.radius, timeMs, r.t, r.left, r.h.x * 0.031 + r.h.y * 0.023);
  }

  /** 予告の間: 背中の花から粉の玉が山なりに飛び、落ちる所で雲がふくらみ始める */
  private drawPowderLaunch(world: World, h: World['hazards'][number], timeMs: number): void {
    const p = Math.min(1, (h.totalTicks - h.ticksLeft) / Math.max(1, h.totalTicks));
    const b = findEnemyIndex(world, h.dasher);
    const bx = b !== -1 ? world.enemies.x[b]! : h.x;
    const by = (b !== -1 ? world.enemies.y[b]! : h.y) - 70;
    const k = Math.min(1, p / 0.6);
    const x = bx + (h.x - bx) * k;
    const y = by + (h.y - by) * k - Math.sin(Math.PI * k) * 120;
    if (k < 1) {
      this.g.fillStyle(0xefe6fb, 0.55).fillCircle(x, y, 10);
      this.g.fillStyle(0xd7f5e5, 0.4).fillCircle(x - 4, y + 3, 7);
    }
    if (p > 0.55) {
      const grow = (p - 0.55) / 0.45;
      this.drawCloud(h.x, h.y, h.radius * (0.4 + 0.6 * grow), timeMs, grow * 0.8, h.x * 0.013 + h.y * 0.007);
    }
  }

  /** のしかかりの着地: 土ぼこりの輪が当たりの縁まで広がって薄れる。縁に土の粒 */
  private drawSlamDust(x: number, y: number, r: number, k: number): void {
    const e = 1 - (1 - k) * (1 - k);
    const rr = r * (0.55 + 0.45 * e);
    this.floor.fillStyle(0x3e2c1f, 0.3 * (1 - k)).fillCircle(x, y, rr);
    this.g.lineStyle(10 * (1 - k) + 2, 0xd7ccc8, 0.75 * (1 - k)).strokeCircle(x, y, rr);
    for (let c = 0; c < 12; c++) {
      const ang = (c / 12) * Math.PI * 2 + 0.3;
      const d = rr + 4;
      this.g.fillStyle(0xa1887f, 0.9 * (1 - k)).fillCircle(x + Math.cos(ang) * d, y + Math.sin(ang) * d - Math.sin(Math.PI * e) * 10, 5 * (1 - k) + 2);
    }
  }

  /** ねむりごなの雲: 重なる淡い塊（ゆっくり揺れる）と、ゆっくり上る胞子。明滅させない */
  private drawCloud(x: number, y: number, r: number, timeMs: number, a: number, seed: number): void {
    if (a <= 0.01) return;
    const n = 9;
    for (let k = 0; k < n; k++) {
      const ang = (k / n) * Math.PI * 2 + seed;
      const d = k === 0 ? 0 : r * (0.45 + 0.1 * Math.sin(seed * 3 + k * 1.7));
      const wob = Math.sin(timeMs / 900 + k * 1.3 + seed) * r * 0.06;
      const cx = x + Math.cos(ang) * d + wob;
      const cy = y + Math.sin(ang) * d * 0.8 + Math.cos(timeMs / 1100 + k) * r * 0.05;
      const br = r * (k === 0 ? 0.62 : 0.5 + 0.08 * Math.sin(seed + k * 2.3));
      this.g.fillStyle(k % 3 === 0 ? 0xd9f2e6 : 0xe8def8, 0.16 * a).fillCircle(cx, cy, br);
    }
    this.g.fillStyle(0xf3eefc, 0.12 * a).fillCircle(x, y, r * 0.55);
    // 当たりの広さ: 縁まで薄く満たし、淡い輪郭（雲の外に見えて当たる所を作らない）
    this.g.fillStyle(0xe8def8, 0.08 * a).fillCircle(x, y, r);
    this.g.lineStyle(2, 0xd1c4e9, 0.35 * a).strokeCircle(x, y, r * 0.98);
    // 胞子: ゆっくり上って消える小さな粒
    for (let k = 0; k < 12; k++) {
      const life = ((timeMs / 2600 + k / 12 + seed) % 1 + 1) % 1;
      const px = x + Math.sin(k * 2.39 + seed * 5) * r * 0.75 + Math.sin(timeMs / 700 + k) * 4;
      const py = y + Math.cos(k * 1.71 + seed * 3) * r * 0.55 - life * 26;
      this.add.fillStyle(k % 2 ? 0xfff9c4 : 0xe1f5fe, 0.55 * a * Math.sin(Math.PI * life)).fillRect(px - 1.5, py - 1.5, 3, 3);
    }
  }

  /** ヘドロの毒だまり: ふちの不揃いな紫の溜まり、泡がふくらんではじける */
  private drawPuddle(x: number, y: number, r: number, timeMs: number, a: number, seed: number): void {
    if (a <= 0.01) return;
    const pts: { x: number; y: number }[] = [];
    const n = 24;
    for (let k = 0; k < n; k++) {
      const ang = (k / n) * Math.PI * 2;
      const rr = r * (0.86 + 0.06 * Math.sin(ang * 3 + seed * 7) + 0.05 * Math.sin(ang * 5 + seed) + 0.04 * Math.sin(ang * 7 + seed * 3));
      pts.push({ x: x + Math.cos(ang) * rr, y: y + Math.sin(ang) * rr });
    }
    this.floor.fillStyle(0x4a148c, 0.55 * a).fillPoints(pts as Phaser.Math.Vector2[], true);
    this.floor.fillStyle(0x7b1fa2, 0.45 * a).fillCircle(x + r * 0.1, y - r * 0.08, r * 0.6);
    this.floor.fillStyle(0xab47bc, 0.35 * a).fillEllipse(x - r * 0.2, y - r * 0.25, r * 0.5, r * 0.22);
    for (let k = 0; k < 4; k++) {
      const life = ((timeMs / 900 + k / 4 + seed) % 1 + 1) % 1;
      const bx = x + Math.cos(k * 1.9 + seed * 4) * r * 0.5;
      const by = y + Math.sin(k * 2.7 + seed * 2) * r * 0.45;
      const br = 2 + life * 5;
      if (life < 0.85) this.floor.lineStyle(1.5, 0xe1bee7, 0.7 * a).strokeCircle(bx, by, br);
      else this.floor.fillStyle(0xe1bee7, 0.5 * a * (1 - life) * 6).fillCircle(bx, by, br + 2);
    }
  }

  /**
   * ハードプラントの根: 当たりの円と同じ大きさのひび割れた土から、棘のある太い根が 4 本突き出て揺れる。
   * 突き出るのは 0.18 秒、最後の 0.4 秒で引っ込む
   */
  private drawRoots(x: number, y: number, r: number, timeMs: number, t: number, left: number, seed: number): void {
    const rise = Math.min(1, t / 0.18);
    const out = Math.min(1, left / 0.4);
    const k = (1 - (1 - rise) * (1 - rise)) * out;
    // 割れた土（当たりの円）
    this.floor.fillStyle(0x2e1f14, 0.6 * out).fillCircle(x, y, r);
    this.floor.fillStyle(0x4e342e, 0.5 * out).fillCircle(x, y, r * 0.7);
    for (let c = 0; c < 6; c++) {
      const ang = (c / 6) * Math.PI * 2 + seed;
      this.floor.lineStyle(2, 0x1a120c, 0.7 * out).lineBetween(x + Math.cos(ang) * r * 0.3, y + Math.sin(ang) * r * 0.3, x + Math.cos(ang + 0.2) * r * 0.98, y + Math.sin(ang + 0.2) * r * 0.98);
    }
    // 突き出た瞬間の土の粒
    if (t < 0.3) {
      for (let c = 0; c < 8; c++) {
        const ang = (c / 8) * Math.PI * 2 + seed;
        const d = r * (0.4 + t * 2.5);
        this.g.fillStyle(0x6d4c41, 0.9 * (1 - t / 0.3)).fillRect(x + Math.cos(ang) * d - 2, y + Math.sin(ang) * d * 0.7 - t * 60 - 2, 4, 4);
      }
    }
    if (k <= 0.02) return;
    // 太い根 3 本（茶色の幹・根元ほど太い）。外へ反りながら上へ伸びて揺れる
    const vines = 3;
    for (let v = 0; v < vines; v++) {
      const side = v - 1;
      const bx = x + side * r * 0.42;
      const by = y + (v === 1 ? -r * 0.1 : r * 0.12);
      const height = r * (v === 1 ? 2.3 : 1.8) * k;
      const lean = side * r * 0.55 + Math.sin(timeMs / 420 + v * 1.4 + seed) * 6;
      const seg = 10;
      const pts: [number, number][] = [];
      for (let s2 = 0; s2 <= seg; s2++) {
        const u = s2 / seg;
        pts.push([bx + lean * u * u + Math.sin(u * 4 + v * 2 + seed) * 6 * u, by - height * u]);
      }
      const base = v === 1 ? 34 : 28;
      // 影の縁 → 幹 → 光の筋（どれも加算しない）
      for (const [grow, color, dx] of [[8, 0x24160f, 0], [0, 0x5d4037, 0], [-0.62, 0x8d6e63, -0.22]] as const) {
        for (let s2 = 0; s2 < seg; s2++) {
          const u = s2 / seg;
          const w0 = base * (1 - u * 0.78);
          const width = grow < 0 ? Math.max(2, w0 * -grow * 0.4) : w0 + grow;
          const [x0, y0] = pts[s2]!;
          const [x1, y1] = pts[s2 + 1]!;
          this.g.lineStyle(width, color, out).lineBetween(x0 + dx * w0, y0, x1 + dx * w0, y1);
        }
      }
      // 大きな棘（左右交互。根元ほど大きい）
      for (let s2 = 1; s2 < seg; s2 += 2) {
        const [sx, sy] = pts[s2]!;
        const u = s2 / seg;
        const dir = s2 % 4 === 1 ? 1 : -1;
        const half = (base * (1 - u * 0.78)) / 2;
        const len = 12 * (1 - u) + 6;
        this.g.fillStyle(0x24160f, out).fillTriangle(sx + dir * (half - 1), sy - 5, sx + dir * (half - 1), sy + 4, sx + dir * (half + len), sy - 7);
        this.g.fillStyle(0xbcaaa4, out).fillTriangle(sx + dir * half, sy - 3, sx + dir * half, sy + 2, sx + dir * (half + len - 3), sy - 6);
      }
      // 若い葉（幹の途中に 2 枚）
      for (const s2 of [4, 7]) {
        const [lx, ly] = pts[s2]!;
        const dir = s2 === 4 ? -1 : 1;
        const sway = Math.sin(timeMs / 300 + s2 + v) * 3;
        this.g.fillStyle(0x2e7d32, out).fillEllipse(lx + dir * 16, ly - 4 + sway, 22, 9);
        this.g.fillStyle(0x66bb6a, out).fillEllipse(lx + dir * 15, ly - 6 + sway, 12, 4);
      }
      // 先はとがって少し曲がる
      const [tx, ty] = pts[seg]!;
      this.g.fillStyle(0x5d4037, out).fillTriangle(tx - 5, ty + 6, tx + 5, ty + 6, tx + side * 8, ty - 14);
    }
  }

  /** ギガドレイン: 光線に入っている人から、緑の光の粒がフシギバナへ流れる */
  private drawDrain(world: World, h: World['hazards'][number], timeMs: number, mv: NonNullable<World['rules']['stage']['moves'][number]>): void {
    const b = findEnemyIndex(world, h.dasher);
    if (b === -1) return;
    const bx = world.enemies.x[b]!;
    const by = world.enemies.y[b]! - 40;
    for (const p of world.players) {
      if (p.down || !hazardHits(h, p.x, p.y, p.radius, mv)) continue;
      for (let k = 0; k < 10; k++) {
        const u = ((timeMs / 600 + k / 10) % 1 + 1) % 1;
        const px = p.x + (bx - p.x) * u + Math.sin(u * 9 + k) * 10 * (1 - u);
        const py = p.y - 10 + (by - p.y + 10) * u + Math.cos(u * 7 + k) * 10 * (1 - u);
        this.add.fillStyle(u < 0.5 ? 0xccff90 : 0x69f0ae, 0.85 * Math.sin(Math.PI * u)).fillCircle(px, py, 3 + 2 * (1 - u));
      }
    }
  }
}
