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
