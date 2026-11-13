import Phaser from 'phaser';
import { findEnemyIndex, type World } from '../../sim/world';

function rnd(a: number, b: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/** 尾の炎の段の数・間隔（ワールドの単位） */
const TAIL = 20;
const STEP = 17;

/**
 * 色違いのリザードンの フレアドライブ の突進（07 の254章）: 体が炎の塊になり、前に白熱した弧、うしろに 3 層の炎の尾と火の粉、
 * 通った跡に少しの間だけ焦げ跡。見た目だけ（当たりはシミュレーション）
 */
export class ShinyCharizardFlame {
  private readonly g: Phaser.GameObjects.Graphics;
  /** 加算しない炎（外の層。明るい床でも色が沈まない） */
  private readonly body: Phaser.GameObjects.Graphics;
  private readonly front: Phaser.GameObjects.Graphics;
  private readonly floor: Phaser.GameObjects.Graphics;
  private scorch: { x: number; y: number; at: number; a: number }[] = [];
  private embers: { x: number; y: number; vx: number; vy: number; at: number }[] = [];
  private last: { x: number; y: number } | null = null;
  private lastTick = -1;

  constructor(scene: Phaser.Scene, depth: number, frontDepth: number, floorDepth: number) {
    this.body = scene.add.graphics().setDepth(depth - 0.01);
    this.g = scene.add.graphics().setDepth(depth).setBlendMode(Phaser.BlendModes.ADD);
    this.front = scene.add.graphics().setDepth(frontDepth).setBlendMode(Phaser.BlendModes.ADD);
    this.floor = scene.add.graphics().setDepth(floorDepth);
  }

  update(world: World, timeMs: number, alpha: number): void {
    this.g.clear();
    this.body.clear();
    this.front.clear();
    this.floor.clear();
    const moves = world.rules.stage.moves;
    // 炎のまとい: 体のまわりで炎の舌がゆらめく（体を隠さないよう、うしろの層と、手前の小さな火の粉）
    for (const h of world.hazards) {
      if (moves[h.move]?.id !== 'charizard-s-mantle') continue;
      const k = findEnemyIndex(world, h.dasher);
      if (k === -1) continue;
      const ex = world.enemies.prevX[k]! + (world.enemies.x[k]! - world.enemies.prevX[k]!) * alpha;
      const ey = world.enemies.prevY[k]! + (world.enemies.y[k]! - world.enemies.prevY[k]!) * alpha;
      const fade = h.activeTicks === undefined ? 0.3 : Math.min(1, h.activeTicks / 12);
      this.drawMantle(ex, ey - 30, h.radius, timeMs, fade);
    }
    const dash = world.hazards.find((h) => moves[h.move]?.id === 'charizard-s-blaze-dash' && h.activeTicks !== undefined);
    const i = dash ? findEnemyIndex(world, dash.dasher) : -1;
    if (dash && i !== -1 && world.enemies.kbTicks[i]! > 0) {
      const e = world.enemies;
      const x = e.prevX[i]! + (e.x[i]! - e.prevX[i]!) * alpha;
      const y = e.prevY[i]! + (e.y[i]! - e.prevY[i]!) * alpha - 30;
      const dx = dash.dirX;
      const dy = dash.dirY;
      this.drawComet(x, y, dx, dy, timeMs);
      // 焦げ跡と火の粉（シミュレーションが進んだときだけ足す）
      if (world.tick !== this.lastTick) {
        this.lastTick = world.tick;
        if (this.last) {
          this.scorch.push({ x: x, y: y + 34, at: timeMs, a: Math.atan2(dy, dx) });
          for (let k = 0; k < 3; k++) {
            const a = Math.atan2(-dy, -dx) + (rnd(world.tick, k) - 0.5) * 1.4;
            const sp = 120 + rnd(k, world.tick) * 220;
            this.embers.push({ x: x + (rnd(world.tick, k + 5) - 0.5) * 30, y: y + (rnd(world.tick, k + 9) - 0.5) * 30, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, at: timeMs });
          }
        }
        this.last = { x, y };
      }
    } else {
      this.last = null;
    }
    this.drawPillars(world, timeMs, alpha);
    this.scorch = this.scorch.filter((s) => timeMs - s.at < 900);
    for (const s of this.scorch) {
      const t = (timeMs - s.at) / 900;
      this.floor.fillStyle(0x1a0f0a, 0.35 * (1 - t)).fillEllipse(s.x, s.y, 46, 22);
      this.g.fillStyle(0xff5722, 0.18 * (1 - t) * (1 - t)).fillEllipse(s.x, s.y, 30, 12);
    }
    this.embers = this.embers.filter((m) => timeMs - m.at < 600);
    for (const m of this.embers) {
      const t = (timeMs - m.at) / 1000;
      const px = m.x + m.vx * t;
      const py = m.y + m.vy * t + 200 * t * t;
      this.g.fillStyle(t < 0.25 ? 0xffe082 : 0xff7043, 0.9 * (1 - t / 0.6)).fillRect(px - 2, py - 2, 4, 4);
    }
  }

  /**
   * 究極のブラストバーンの柱（07 の254章）: 足元から噴き出して伸び、層ごとに逆の向きへ回る。回っている間はうしろに薄い残像（回る向きが分かるように）。
   * 終わりは縮んで消える。当たりの円の真ん中が柱の根元
   */
  private drawPillars(world: World, timeMs: number, alpha: number): void {
    const a = world.arena;
    const list: { x: number; y: number; cx: number; cy: number; t: number; left: number; trail: number; seed: number }[] = [];
    for (const h of world.hazards) {
      const mv = world.rules.stage.moves[h.move];
      if (mv?.id !== 'charizard-s-ultimate' || h.activeTicks === undefined || !mv.spin || h.orbitX === undefined || h.orbitY === undefined) continue;
      const total = Math.max(1, Math.round((mv.activeSeconds ?? 0) / world.dt));
      const t = (total - h.activeTicks + alpha) * world.dt;
      const left = Math.max(0, (h.activeTicks - alpha) * world.dt);
      // シミュレーションの 1 回分の回りを、描く時刻まで補う（外の層ほど速く動くので、補わないとカクつく）
      const spinning = t >= mv.spin.afterSeconds;
      const w = spinning ? (((h.orbitSign ?? 1) * mv.spin.degreesPerSecond * Math.PI) / 180) * world.dt * (alpha - 1) : 0;
      const rx = h.x - h.orbitX;
      const ry = h.y - h.orbitY;
      const x = h.orbitX + rx * Math.cos(w) - ry * Math.sin(w);
      const y = h.orbitY + rx * Math.sin(w) + ry * Math.cos(w);
      // 固定マップの外の柱は描かない（上下の外へ並ぶ分）
      if (a && (Math.abs(x - a.x) > a.halfWidth + 80 || Math.abs(y - a.y) > a.halfHeight + 80)) continue;
      // 残像は回る中心 (cx, cy) の周りに戻した所へ描く。揺れ方は柱ごとに変える（seed）
      list.push({ x, y, cx: h.orbitX, cy: h.orbitY, t, left, trail: spinning ? (h.orbitSign ?? 1) * ((mv.spin.degreesPerSecond * Math.PI) / 180) : 0, seed: (h.group ?? 0) + Math.round(Math.hypot(rx, ry) / 40) * 1.3 + Math.atan2(h.dirY, h.dirX) * 2 });
    }
    // 画面の下（手前）の柱ほどあとに描く
    list.sort((p, q) => p.y - q.y);
    for (const p of list) {
      const r = 62;
      const grow = Math.min(1, p.t / 0.22);
      const ease = 1 - (1 - grow) * (1 - grow);
      const fade = Math.min(1, p.left / 0.35);
      const height = r * 2.1 * ease * (0.4 + 0.6 * fade);
      // 残像: 回る向きのうしろへ少し戻した所に、薄く
      if (p.trail !== 0) {
        for (const [back, al] of [[0.09, 0.28], [0.18, 0.13]] as const) {
          const b = -p.trail * back;
          const gx = p.cx + (p.x - p.cx) * Math.cos(b) - (p.y - p.cy) * Math.sin(b);
          const gy = p.cy + (p.x - p.cx) * Math.sin(b) + (p.y - p.cy) * Math.cos(b);
          this.drawColumn(gx, gy, r, height, timeMs, p.seed, al * fade, true);
        }
      }
      // 根元: 当たりの円と同じ丸に、焦げと照り返し
      this.floor.fillStyle(0x1a0f0a, 0.4 * fade).fillCircle(p.x, p.y, r);
      this.g.fillStyle(0xff6d00, 0.3 * fade * ease).fillCircle(p.x, p.y, r * 0.95);
      this.g.fillStyle(0xffab40, 0.25 * fade * ease).fillCircle(p.x, p.y, r * 0.6);
      // 噴き出した瞬間: 根元から当たりの円の縁まで広がる熱の輪（1 回だけ）
      if (p.t < 0.3) {
        const k = p.t / 0.3;
        this.g.lineStyle(7 * (1 - k) + 1, 0xffe082, 0.85 * (1 - k)).strokeCircle(p.x, p.y, r * (0.5 + k * 0.5));
      }
      this.drawColumn(p.x, p.y, r, height, timeMs, p.seed, fade, false);
    }
  }

  /**
   * 炎の柱 1 本: 根元 (x, y) から上へ height。縁が揺らめく 1 枚の形を 4 層重ねる（外は赤・中は橙で加算しない、芯は黄と白で加算）。
   * 上は 3 本の炎の舌、下は地面に接する丸い縁
   */
  private drawColumn(x: number, y: number, r: number, height: number, timeMs: number, seed: number, al: number, ghost: boolean): void {
    if (height < 4 || al <= 0.01) return;
    const n = ghost ? 6 : 12;
    const layers = ghost
      ? [{ w: 0.8, color: 0xff7043, a: 0.8, add: false }]
      : [
          { w: 0.82, color: 0xbf360c, a: 0.65, add: false },
          { w: 0.62, color: 0xff6d00, a: 0.8, add: false },
          { w: 0.38, color: 0xffc107, a: 0.85, add: true },
          { w: 0.17, color: 0xfff8e1, a: 0.85, add: true },
        ];
    for (const layer of layers) {
      const target = layer.add ? this.g : this.body;
      const half = r * layer.w;
      // 層ごとに少し低く（芯は外の炎の中に収まる）
      const top = height * (0.75 + 0.25 * layer.w);
      const sway = (t: number): number => Math.sin(timeMs / 110 + seed) * 8 * t + Math.sin(timeMs / 60 + t * 6 + seed) * 3 * t;
      const edge = (t: number, side: number): number => half * (1 - 0.5 * t) * (1 + 0.08 * Math.sin(timeMs / 45 + t * 11 + side * 2 + seed));
      const pts: { x: number; y: number }[] = [];
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        pts.push({ x: x + sway(t) - edge(t, -1), y: y - t * top });
      }
      // 上の 3 本の炎の舌（左から右へ）
      const w0 = half * 0.5;
      const cx = x + sway(1);
      for (let j = -1; j <= 1; j++) {
        const flick = 0.55 + 0.45 * Math.abs(Math.sin(timeMs / 85 + j * 1.7 + seed));
        pts.push({ x: cx + j * w0 * 0.6 - w0 * 0.25, y: y - top });
        pts.push({ x: cx + j * w0 * 0.7 + j * 4, y: y - top - half * (j === 0 ? 1.1 : 0.7) * flick });
        pts.push({ x: cx + j * w0 * 0.6 + w0 * 0.25, y: y - top });
      }
      for (let k = n; k >= 0; k--) {
        const t = k / n;
        pts.push({ x: x + sway(t) + edge(t, 1), y: y - t * top });
      }
      // 地面に接する丸い縁（手前へ少しふくらむ）
      for (let k = 1; k < 6; k++) {
        const a = (k / 6) * Math.PI;
        pts.push({ x: x + Math.cos(a) * half, y: y + Math.sin(a) * half * 0.3 });
      }
      target.fillStyle(layer.color, layer.a * al).fillPoints(pts as Phaser.Math.Vector2[], true);
    }
  }

  /** 炎のまとい: 体のまわりから上へ伸びる炎の舌（外は赤、内は黄）。体の真ん中は空ける */
  private drawMantle(x: number, y: number, r: number, timeMs: number, fade: number): void {
    const n = 18;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const flick = 0.6 + 0.4 * Math.abs(Math.sin(timeMs / 90 + k * 1.3));
      const bx = x + Math.cos(a) * r * 0.95;
      const by = y + Math.sin(a) * r * 0.7 + 22;
      const h = r * 1.3 * flick;
      const lean = Math.cos(a) * 16;
      // 下半分（手前）の炎は体の前に、少し薄く
      const front = Math.sin(a) > 0.2;
      const back = front ? this.front : this.body;
      const al = front ? 0.6 : 1;
      back.fillStyle(0xd84315, 0.6 * fade * al).fillTriangle(bx - 15, by, bx + 15, by, bx + lean, by - h);
      back.fillStyle(0xff9100, 0.8 * fade * al).fillTriangle(bx - 9, by, bx + 9, by, bx + lean * 0.7, by - h * 0.7);
      (front ? this.front : this.g).fillStyle(0xffe082, 0.65 * fade * al).fillTriangle(bx - 4, by, bx + 4, by, bx + lean * 0.5, by - h * 0.45);
    }
    // 手前に上る火の粉
    for (let k = 0; k < 8; k++) {
      const t = (timeMs / 700 + k / 8) % 1;
      const ex = x + Math.sin(k * 2.1 + t * 4) * r * 0.6;
      const ey = y + r * 0.4 - t * r * 1.6;
      this.front.fillStyle(0xffcc80, 0.8 * (1 - t) * fade).fillRect(ex - 2, ey - 2, 4, 4);
    }
  }

  /** 炎の塊: うしろへ 3 層の尾（外は赤く広く、中は橙、芯は白っぽい黄）、前に白熱した弧 */
  private drawComet(x: number, y: number, dx: number, dy: number, timeMs: number): void {
    const px = -dy;
    const py = dx;
    const layers = [
      { width: 104, color: 0xbf360c, alpha: 0.55, add: false },
      { width: 76, color: 0xff6d00, alpha: 0.7, add: false },
      { width: 46, color: 0xffc107, alpha: 0.8, add: false },
      { width: 22, color: 0xfff8e1, alpha: 0.75, add: true },
    ];
    for (const layer of layers) {
      for (let k = 0; k < TAIL; k++) {
        const t = k / TAIL;
        // 尾はうしろほど細く、ゆらめく
        const wob = Math.sin(timeMs / 55 + k * 0.9) * 8 * t;
        const cx = x - dx * k * STEP + px * wob;
        const cy = y - dy * k * STEP + py * wob;
        const r = layer.width * (1 - t * 0.85) * 0.5;
        if (r < 1) continue;
        (layer.add ? this.g : this.body).fillStyle(layer.color, layer.alpha * (1 - t * 0.8)).fillCircle(cx, cy, r);
      }
    }
    // 尾から外へはねる炎の舌
    for (let k = 0; k < 10; k++) {
      const t = ((timeMs / 300 + k / 10) % 1);
      const back = 20 + t * TAIL * STEP * 0.8;
      const side = (k % 2 ? 1 : -1) * (14 + t * 26);
      const bx = x - dx * back + px * side;
      const by = y - dy * back + py * side;
      this.body.lineStyle(6 * (1 - t), 0xff9100, 0.85 * (1 - t)).lineBetween(bx, by, bx - dx * 20 + px * side * 0.3, by - dy * 20 + py * side * 0.3);
    }
    // 前の白熱した弧（体の前の空気が燃える）
    const a = Math.atan2(dy, dx);
    for (const [r, w, c, al] of [[54, 10, 0xff7043, 0.5], [50, 5, 0xffe082, 0.8], [47, 2, 0xffffff, 0.9]] as const) {
      this.front.lineStyle(w, c, al);
      this.front.beginPath();
      this.front.arc(x + dx * 8, y + dy * 8, r, a - 1.1, a + 1.1, false);
      this.front.strokePath();
    }
  }
}
