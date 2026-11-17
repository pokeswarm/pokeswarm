import Phaser from 'phaser';
import type { World } from '../../sim/world';

function rnd(a: number, b: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

type Hz = World['hazards'][number];

interface Lingering {
  kind: 'splash' | 'bolt';
  x: number;
  y: number;
  r: number;
  seed: number;
  startMs: number;
  goneMs: number;
}

const SPLASH_LINGER_MS = 1200;
const BOLT_LINGER_MS = 500;

/**
 * カイオーガの技の絵（07 の284章）: こんげんのはどうの深い青の光線・しおふきの打ち上がって落ちる潮・かみなりの雷雲と稲妻・
 * ゲンシカイキの水の輪と光。見た目だけ（当たりはシミュレーション）
 */
export class KyogreSea {
  private readonly gf: Phaser.GameObjects.Graphics;
  private readonly gn: Phaser.GameObjects.Graphics;
  private readonly ga: Phaser.GameObjects.Graphics;
  private readonly gt: Phaser.GameObjects.Graphics;
  private readonly lingering = new Map<string, Lingering>();

  constructor(scene: Phaser.Scene, depth: number, floorDepth: number, topDepth: number) {
    this.gf = scene.add.graphics().setDepth(floorDepth);
    this.gn = scene.add.graphics().setDepth(depth);
    this.ga = scene.add.graphics().setDepth(depth + 0.01).setBlendMode(Phaser.BlendModes.ADD);
    this.gt = scene.add.graphics().setDepth(topDepth);
  }

  update(world: World, timeMs: number): void {
    this.gf.clear();
    this.gn.clear();
    this.ga.clear();
    this.gt.clear();
    const moves = world.rules.stage.moves;
    const kyogre = this.kyogre(world);
    const seen = new Set<string>();
    let pulseCharge = -1;
    for (const hz of world.hazards) {
      const id = moves[hz.move]?.id ?? '';
      if (!id.startsWith('kyogre-')) continue;
      const p = hz.activeTicks === undefined ? 1 - hz.ticksLeft / Math.max(1, hz.totalTicks) : 1;
      const key = `${hz.group ?? 0}:${Math.round(hz.x)}:${Math.round(hz.y)}`;
      if (id.startsWith('kyogre-origin-pulse')) {
        if (hz.activeTicks === undefined) {
          this.drawPulseAim(hz, p);
          pulseCharge = Math.max(pulseCharge, p);
        } else this.drawPulseBeam(hz, timeMs);
      } else if (id.startsWith('kyogre-water-spout')) {
        if (hz.activeTicks === undefined) this.drawSpoutFlight(hz, kyogre, p, timeMs);
        else {
          seen.add(key);
          if (!this.lingering.has(key)) this.lingering.set(key, { kind: 'splash', x: hz.x, y: hz.y, r: hz.radius, seed: rnd(hz.x, hz.y), startMs: timeMs, goneMs: 0 });
        }
      } else if (id.startsWith('kyogre-thunder')) {
        if (hz.activeTicks === undefined) this.drawStormCloud(hz, p, timeMs);
        else {
          seen.add(key);
          if (!this.lingering.has(key)) this.lingering.set(key, { kind: 'bolt', x: hz.x, y: hz.y, r: hz.radius, seed: rnd(hz.x, hz.y + timeMs), startMs: timeMs, goneMs: 0 });
        }
      } else if (id === 'kyogre-primal-reversion' && kyogre) {
        this.drawReversion(kyogre, p, timeMs);
      }
    }
    if (pulseCharge >= 0 && kyogre) this.drawPulseCharge(kyogre, pulseCharge, timeMs);
    for (const [key, l] of this.lingering) {
      if (!seen.has(key) && l.goneMs === 0) l.goneMs = timeMs;
      const limit = l.kind === 'splash' ? SPLASH_LINGER_MS : BOLT_LINGER_MS;
      if (l.goneMs > 0 && timeMs - l.goneMs > limit) {
        this.lingering.delete(key);
        continue;
      }
      if (l.kind === 'splash') this.drawSplash(l, timeMs);
      else this.drawBolt(l, timeMs);
    }
    if (!world.legendary) this.lingering.clear();
  }

  private kyogre(world: World): { x: number; y: number; r: number } | null {
    const e = world.enemies;
    for (let i = 0; i < e.count; i++) {
      if (e.hp[i]! <= 0) continue;
      if (world.rules.enemies.kinds[e.kind[i]!]?.id === 'legend-kyogre') return { x: e.x[i]!, y: e.y[i]!, r: e.radius[i]! };
    }
    return null;
  }

  /** こんげんのはどうの予告: 光線の通る道に、細く光る青い線（だんだん濃く） */
  private drawPulseAim(hz: Hz, p: number): void {
    const x1 = hz.x + hz.dirX * hz.length;
    const y1 = hz.y + hz.dirY * hz.length;
    this.gf.lineStyle(hz.radius * 2, 0x1e88e5, 0.08 + 0.14 * p).lineBetween(hz.x, hz.y, x1, y1);
    this.gt.lineStyle(3, 0x81d4fa, 0.35 + 0.5 * p).lineBetween(hz.x, hz.y, x1, y1);
  }

  /** こんげんのはどうの溜め: 体のまわりの水が光の粒になって口元へ集まり、口元に深い青の光の玉 */
  private drawPulseCharge(k: { x: number; y: number; r: number }, p: number, timeMs: number): void {
    const mx = k.x;
    const my = k.y - k.r * 0.6;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + rnd(i, 4) * 0.5;
      const t = ((timeMs / 520 + rnd(i, 9)) % 1 + 1) % 1;
      const d = k.r * (3.6 - 3.0 * t);
      const px = mx + Math.cos(a) * d;
      const py = my + Math.sin(a) * d * 0.8;
      this.gt.lineStyle(8, 0x4fc3f7, 0.5 * (0.4 + 0.6 * t)).lineBetween(px, py, px - (mx - px) * 0.35, py - (my - py) * 0.35);
      this.gt.fillStyle(0xe1f5fe, 0.45 + 0.5 * t).fillCircle(px, py, 9 + t * 4);
    }
    const rr = k.r * (0.3 + 0.5 * p);
    this.gt.fillStyle(0x1565c0, 0.5).fillCircle(mx, my, rr * 1.8);
    this.gt.fillStyle(0x4fc3f7, 0.85).fillCircle(mx, my, rr);
    this.gt.fillStyle(0xffffff, 0.9).fillCircle(mx, my, rr * 0.5);
  }

  /** こんげんのはどうの光線: 深い青の太い帯に、白く光る芯。波打つ光の筋が先へ流れ、先で水しぶきが散る */
  private drawPulseBeam(hz: Hz, timeMs: number): void {
    const len = hz.length;
    const x1 = hz.x + hz.dirX * len;
    const y1 = hz.y + hz.dirY * len;
    const w = hz.radius * 2;
    const nx = -hz.dirY;
    const ny = hz.dirX;
    this.gn.lineStyle(w * 1.5, 0x0d47a1, 0.55).lineBetween(hz.x, hz.y, x1, y1);
    this.ga.lineStyle(w, 0x1e88e5, 0.85).lineBetween(hz.x, hz.y, x1, y1);
    this.ga.lineStyle(w * 0.45, 0x81d4fa, 0.9).lineBetween(hz.x, hz.y, x1, y1);
    this.gt.lineStyle(w * 0.2, 0xffffff, 0.85).lineBetween(hz.x, hz.y, x1, y1);
    // 波打つ光の筋（先へ流れる）
    for (let k = 0; k < 10; k++) {
      const t = ((timeMs / 380 + k / 10) % 1 + 1) % 1;
      const d = t * len;
      const off = Math.sin(t * 18 + k) * w * 0.4;
      const cx = hz.x + hz.dirX * d + nx * off;
      const cy = hz.y + hz.dirY * d + ny * off;
      this.ga.lineStyle(4, 0xe1f5fe, 0.8 * (1 - t)).lineBetween(cx, cy, cx + hz.dirX * 30, cy + hz.dirY * 30);
    }
    // 根元の光
    this.ga.fillStyle(0x4fc3f7, 0.6).fillCircle(hz.x, hz.y, w * 1.1);
  }

  /** しおふきの潮: カイオーガの背中から水の塊が打ち上がり、放物線で落ちる所へ（予告の終わりに着く）。落ちる所に影 */
  private drawSpoutFlight(hz: Hz, k: { x: number; y: number; r: number } | null, p: number, timeMs: number): void {
    this.gf.fillStyle(0x0d2a4a, 0.12 + 0.3 * p).fillEllipse(hz.x, hz.y, hz.radius * 1.6 * (0.5 + 0.5 * p), hz.radius * 0.7 * (0.5 + 0.5 * p));
    if (!k) return;
    const sx = k.x;
    const sy = k.y - k.r * 1.3;
    const peak = 170 + rnd(hz.x, hz.y) * 90;
    const pos = (t: number): [number, number] => [sx + (hz.x - sx) * t, sy + (hz.y - sy) * t - peak * 4 * t * (1 - t)];
    const [x, y] = pos(p);
    for (let s = 1; s <= 5; s++) {
      const [xx, yy] = pos(Math.max(0, p - s * 0.03));
      this.gt.fillStyle(0xb3e5fc, 0.55 - s * 0.09).fillCircle(xx, yy, 11 - s);
    }
    const rr = 17 + rnd(hz.y, hz.x) * 6;
    this.gt.fillStyle(0x1e88e5, 0.95).fillCircle(x, y, rr);
    this.gt.fillStyle(0x81d4fa, 0.95).fillCircle(x - rr * 0.25, y - rr * 0.25, rr * 0.55);
    this.gt.fillStyle(0xffffff, 0.9).fillCircle(x - rr * 0.35, y - rr * 0.35, rr * 0.22);
    // 揺れる水面の光
    this.gt.lineStyle(2, 0xe1f5fe, 0.5 + 0.3 * Math.sin(timeMs / 70)).strokeCircle(x, y, rr * 1.15);
  }

  /** しおふきの着いた所: 水しぶきが王冠のように跳ね、波紋が広がり、水たまりがしばらく光ってから引く */
  private drawSplash(l: Lingering, timeMs: number): void {
    const age = timeMs - l.startMs;
    const fade = Math.min(1, age / (SPLASH_LINGER_MS + 300));
    const r = l.r;
    this.gf.fillStyle(0x1565c0, 0.45 * (1 - fade)).fillEllipse(l.x, l.y, r * 1.8, r * 0.95);
    this.gf.fillStyle(0x81d4fa, 0.35 * (1 - fade)).fillEllipse(l.x, l.y, r * 1.0, r * 0.5);
    // 波紋（2 重に広がる）
    for (let k = 0; k < 2; k++) {
      const t = Math.min(1, (age - k * 160) / 700);
      if (t <= 0) continue;
      this.gf.lineStyle(4, 0xe1f5fe, 0.7 * (1 - t)).strokeEllipse(l.x, l.y, r * (1 + 1.6 * t), r * (0.5 + 0.8 * t));
    }
    if (age < 550) {
      const t = age / 550;
      // 王冠のしぶき
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2 + l.seed * 3;
        const d = r * (0.5 + 0.7 * t);
        const up = -r * 1.6 * t * (1 - t) * (0.7 + 0.6 * rnd(k, l.seed));
        this.gt.fillStyle(k % 3 ? 0x81d4fa : 0xffffff, 1 - t).fillCircle(l.x + Math.cos(a) * d, l.y + Math.sin(a) * d * 0.5 + up, 7 * (1 - t * 0.5));
      }
    }
  }

  /** かみなりの予告: 狙った所の上に黒い雷雲が広がり、中で光がちらつく（明滅させず、ゆっくり強まる） */
  private drawStormCloud(hz: Hz, p: number, timeMs: number): void {
    const cx = hz.x;
    const cy = hz.y - 170;
    // 地面の影と、落ちる所の印
    this.gf.fillStyle(0x0a0f1e, 0.15 + 0.3 * p).fillEllipse(hz.x, hz.y, hz.radius * 2.1, hz.radius * 1.0);
    this.gf.lineStyle(3, 0xfff59d, 0.25 + 0.5 * p).strokeEllipse(hz.x, hz.y, hz.radius * 2, hz.radius);
    for (let k = 0; k < 7; k++) {
      const ox = (k - 3) * hz.radius * 0.45 + Math.sin(timeMs / 600 + k) * 6;
      const oy = (k % 2) * 14 - 8;
      const rr = hz.radius * (0.55 + 0.25 * rnd(k, 2)) * (0.6 + 0.4 * p);
      this.gt.fillStyle(0x263238, 0.75).fillCircle(cx + ox, cy + oy, rr);
      this.gt.fillStyle(0x455a64, 0.55).fillCircle(cx + ox - rr * 0.2, cy + oy - rr * 0.25, rr * 0.6);
    }
    // 雲の中の光（だんだん強く）
    this.gt.fillStyle(0xfff59d, 0.15 + 0.35 * p * (0.6 + 0.4 * Math.sin(timeMs / 140))).fillEllipse(cx, cy + 6, hz.radius * 1.6, hz.radius * 0.6);
  }

  /** かみなり: 雲から地面へ、枝分かれする太い稲妻。着いた所に焦げと火花 */
  private drawBolt(l: Lingering, timeMs: number): void {
    const age = timeMs - l.startMs;
    const t = Math.min(1, age / (BOLT_LINGER_MS + 200));
    const top = l.y - 190;
    const pts: [number, number][] = [[l.x + (l.seed - 0.5) * 20, top]];
    const steps = 7;
    for (let s = 1; s <= steps; s++) {
      const f = s / steps;
      pts.push([l.x + (rnd(l.seed * 9, s) - 0.5) * 46 * (1 - f * 0.6), top + (l.y - top) * f]);
    }
    const strokeAll = (g: Phaser.GameObjects.Graphics, w: number, c: number, a: number): void => {
      g.lineStyle(w, c, a).beginPath().moveTo(pts[0]![0], pts[0]![1]);
      for (const [x, y] of pts.slice(1)) g.lineTo(x, y);
      g.strokePath();
    };
    if (age < 260) {
      strokeAll(this.ga, 40, 0xfff176, 0.55 * (1 - t));
      strokeAll(this.gt, 16, 0xfff59d, 1 - t);
      strokeAll(this.gt, 7, 0xffffff, 1 - t);
      // 枝
      for (let b = 2; b < 5; b++) {
        const [x0, y0] = pts[b]!;
        const dir = rnd(b, l.seed) < 0.5 ? -1 : 1;
        this.gt.lineStyle(7, 0xfff59d, 0.9 * (1 - t)).lineBetween(x0, y0, x0 + dir * 55, y0 + 44);
      }
    }
    // 焦げと火花
    this.gf.fillStyle(0x1a1a1a, 0.45 * (1 - t)).fillEllipse(l.x, l.y, l.r * 1.7, l.r * 0.8);
    this.ga.fillStyle(0xfff59d, 0.6 * (1 - t)).fillEllipse(l.x, l.y, l.r * 1.4 * (0.5 + t), l.r * 0.6 * (0.5 + t));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + l.seed;
      const d = l.r * (0.4 + 1.2 * t);
      this.gt.fillStyle(0xfff9c4, 1 - t).fillRect(l.x + Math.cos(a) * d - 3, l.y + Math.sin(a) * d * 0.5 - 3 - 30 * t * (1 - t), 6, 6);
    }
  }

  /** ゲンシカイキ: まわりの水面に光の輪が次々と広がり、体のまわりを水の筋が上へ流れる。終わりに一度だけ強く光る */
  private drawReversion(k: { x: number; y: number; r: number }, p: number, timeMs: number): void {
    const { x, y, r } = k;
    for (let i = 0; i < 4; i++) {
      const t = ((timeMs / 900 + i / 4) % 1 + 1) % 1;
      this.gf.lineStyle(18, 0x1565c0, 0.75 * p * (1 - t)).strokeEllipse(x, y + r * 0.3, r * (1.5 + 5 * t), r * (0.7 + 2.4 * t));
      this.gf.lineStyle(7, 0xffffff, 0.85 * p * (1 - t)).strokeEllipse(x, y + r * 0.3, r * (1.5 + 5 * t), r * (0.7 + 2.4 * t));
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const t = ((timeMs / 560 + rnd(i, 5)) % 1 + 1) % 1;
      const bx = x + Math.cos(a) * r * 1.2;
      const by = y + r * 0.2 - t * r * 3;
      this.gt.lineStyle(12, i % 2 ? 0x4fc3f7 : 0xb3e5fc, 0.55 * p * (1 - t)).lineBetween(bx, by, bx, by - r * 0.8);
    }
    const flash = p > 0.8 ? (p - 0.8) / 0.2 : 0;
    this.ga.fillStyle(0x1e88e5, 0.3 * p + 0.3 * flash).fillEllipse(x, y - r * 0.6, r * 4.2, r * 3.6);
    this.gt.fillStyle(0xb3e5fc, 0.12 * p + 0.45 * flash).fillEllipse(x, y - r * 0.6, r * 3.2, r * 2.8);
  }
}
