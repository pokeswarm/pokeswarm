import Phaser from 'phaser';
import { findEnemyIndex, type World } from '../../sim/world';

function rnd(a: number, b: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

type Hz = World['hazards'][number];

interface Lingering {
  kind: 'impact' | 'crater';
  x: number;
  y: number;
  r: number;
  seed: number;
  startMs: number;
  goneMs: number;
}

const IMPACT_MS = 900;
const CRATER_MS = 1300;

/**
 * レックウザの技の絵（07 の288章）: ガリョウテンセイの影と落ちてくる緑の光・りゅうせいぐんの降る流星・しんそくの白い筋・
 * ぼうふうの風の渦・はかいこうせんの太い光線。見た目だけ（当たりはシミュレーション）
 */
export class RayquazaSky {
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
    const ray = this.rayquaza(world);
    const seen = new Set<string>();
    for (const hz of world.hazards) {
      const id = moves[hz.move]?.id ?? '';
      if (!id.startsWith('rayquaza-')) continue;
      const p = hz.activeTicks === undefined ? 1 - hz.ticksLeft / Math.max(1, hz.totalTicks) : 1;
      const key = `${id}:${hz.group ?? 0}:${Math.round(hz.x)}:${Math.round(hz.y)}`;
      if (id === 'rayquaza-dragon-ascent') {
        if (hz.activeTicks === undefined) this.drawAscentShadow(hz, p, timeMs);
        else {
          seen.add(key);
          if (!this.lingering.has(key)) this.lingering.set(key, { kind: 'impact', x: hz.x, y: hz.y, r: hz.radius, seed: rnd(hz.x, hz.y), startMs: timeMs, goneMs: 0 });
        }
      } else if (id === 'rayquaza-draco-meteor') {
        if (hz.activeTicks === undefined) this.drawMeteorFall(hz, p);
        else {
          seen.add(key);
          if (!this.lingering.has(key)) this.lingering.set(key, { kind: 'crater', x: hz.x, y: hz.y, r: hz.radius, seed: rnd(hz.x, hz.y), startMs: timeMs, goneMs: 0 });
        }
      } else if (id === 'rayquaza-extreme-speed') {
        if (hz.activeTicks === undefined) this.drawSpeedAim(hz, p);
        else this.drawSpeedStreak(world, hz, timeMs);
      } else if (id === 'rayquaza-hurricane') {
        if (hz.activeTicks === undefined) this.drawWindGather(hz, p, timeMs);
        else this.drawVortex(hz, timeMs);
      } else if (id === 'rayquaza-hyper-beam') {
        if (hz.activeTicks === undefined) this.drawBeamCharge(hz, ray, p, timeMs);
        else this.drawBeam(hz, timeMs);
      }
    }
    // りゅうせいぐんの溜め: 撃ち上げる光の玉（技の始めの間）
    for (const [key, l] of this.lingering) {
      if (!seen.has(key) && l.goneMs === 0) l.goneMs = timeMs;
      const limit = l.kind === 'impact' ? IMPACT_MS : CRATER_MS;
      if (l.goneMs > 0 && timeMs - l.goneMs > limit) {
        this.lingering.delete(key);
        continue;
      }
      if (l.kind === 'impact') this.drawImpact(l, timeMs);
      else this.drawCrater(l, timeMs);
    }
    if (!world.legendary) this.lingering.clear();
  }

  private rayquaza(world: World): { x: number; y: number; r: number } | null {
    const e = world.enemies;
    for (let i = 0; i < e.count; i++) {
      if (e.hp[i]! <= 0) continue;
      if (world.rules.enemies.kinds[e.kind[i]!]?.id === 'legend-rayquaza') return { x: e.x[i]!, y: e.y[i]!, r: e.radius[i]! };
    }
    return null;
  }

  /**
   * ガリョウテンセイの予告: 空高く消えた後、地上の大きな影が狙った人を追う。終わりの 3 割で、空から緑の光の筋が影へ落ちてくる
   */
  private drawAscentShadow(hz: Hz, p: number, timeMs: number): void {
    const r = hz.radius;
    this.gf.fillStyle(0x000000, 0.18 + 0.32 * p).fillEllipse(hz.x, hz.y, r * 2 * (0.6 + 0.4 * p), r * 0.9 * (0.6 + 0.4 * p));
    this.gf.lineStyle(4, 0x69f0ae, 0.25 + 0.5 * p).strokeEllipse(hz.x, hz.y, r * 2, r * 0.9);
    // 影の中の、ゆっくり回る緑の光の点（追ってくる物の印）
    for (let k = 0; k < 6; k++) {
      const a = timeMs / 500 + (k / 6) * Math.PI * 2;
      this.ga.fillStyle(0x69f0ae, 0.35 * p).fillCircle(hz.x + Math.cos(a) * r * 0.75, hz.y + Math.sin(a) * r * 0.33, 6);
    }
    if (p > 0.7) {
      const t = (p - 0.7) / 0.3;
      const topY = hz.y - 700;
      const headY = topY + (hz.y - topY) * t;
      this.ga.lineStyle(44, 0x00e676, 0.35).lineBetween(hz.x, topY, hz.x, headY);
      this.gt.lineStyle(18, 0xb9f6ca, 0.85).lineBetween(hz.x, Math.max(topY, headY - 260), hz.x, headY);
      this.gt.lineStyle(6, 0xffffff, 0.95).lineBetween(hz.x, Math.max(topY, headY - 200), hz.x, headY);
      this.gt.fillStyle(0xffffff, 0.95).fillCircle(hz.x, headY, 20);
    }
  }

  /** ガリョウテンセイが落ちた所: 緑の衝撃の輪が 2 重に広がり、岩のかけらが飛び、地面が割れる */
  private drawImpact(l: Lingering, timeMs: number): void {
    const age = timeMs - l.startMs;
    const t = Math.min(1, age / IMPACT_MS);
    const r = l.r;
    for (let k = 0; k < 2; k++) {
      const tt = Math.max(0, Math.min(1, (age - k * 150) / 600));
      if (tt <= 0 || tt >= 1) continue;
      this.ga.lineStyle(20 * (1 - tt), 0x00e676, 0.8 * (1 - tt)).strokeEllipse(l.x, l.y, r * (1 + 2.4 * tt) * 2, r * (1 + 2.4 * tt) * 0.9);
      this.gt.lineStyle(5 * (1 - tt), 0xffffff, 0.9 * (1 - tt)).strokeEllipse(l.x, l.y, r * (1 + 2.4 * tt) * 2, r * (1 + 2.4 * tt) * 0.9);
    }
    // 放射状の割れ目（残る）
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + l.seed * 2;
      const len = r * (1.1 + rnd(k, l.seed) * 0.8);
      this.gf.lineStyle(7, 0x0c1410, 0.8 * (1 - t * 0.6)).lineBetween(l.x, l.y, l.x + Math.cos(a) * len, l.y + Math.sin(a) * len * 0.45);
      this.gf.lineStyle(2, 0x69f0ae, 0.6 * (1 - t)).lineBetween(l.x, l.y, l.x + Math.cos(a) * len * 0.8, l.y + Math.sin(a) * len * 0.36);
    }
    if (age < 600) {
      const tt = age / 600;
      for (let k = 0; k < 12; k++) {
        const a = -Math.PI / 2 + (rnd(l.seed, k) - 0.5) * 3;
        const sp = r * (1.4 + rnd(k, l.seed) * 1.6);
        this.gn.fillStyle(k % 2 ? 0x5d5348 : 0x8d8173, 1 - tt).fillRect(l.x + Math.cos(a) * sp * tt - 5, l.y + Math.sin(a) * sp * tt + 300 * tt * tt - 5, 10, 10);
      }
    }
  }

  /** りゅうせいぐんの予告: 落ちる所の影がだんだん濃く大きく、空から斜めに流星が落ちてくる（炎の尾を引く） */
  private drawMeteorFall(hz: Hz, p: number): void {
    const r = hz.radius;
    this.gf.fillStyle(0x000000, 0.12 + 0.3 * p).fillEllipse(hz.x, hz.y, r * 2 * (0.4 + 0.6 * p), r * 0.9 * (0.4 + 0.6 * p));
    this.gf.lineStyle(3, 0xffab40, 0.2 + 0.5 * p).strokeEllipse(hz.x, hz.y, r * 2, r * 0.9);
    if (p < 0.25) return;
    const t = (p - 0.25) / 0.75;
    const sx = hz.x - 420;
    const sy = hz.y - 760;
    const x = sx + (hz.x - sx) * t;
    const y = sy + (hz.y - sy) * t;
    const dx = hz.x - sx;
    const dy = hz.y - sy;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    this.ga.lineStyle(30, 0xff6d00, 0.4).lineBetween(x - ux * 220, y - uy * 220, x, y);
    this.gt.lineStyle(12, 0xffcc80, 0.8).lineBetween(x - ux * 150, y - uy * 150, x, y);
    this.gt.fillStyle(0xfff3e0, 1).fillCircle(x, y, 16);
    this.gt.fillStyle(0x7c4dff, 0.55).fillCircle(x, y, 26);
  }

  /** りゅうせいぐんが落ちた所: 白い光の爆発と、橙の光の輪。焦げた穴がしばらく残る */
  private drawCrater(l: Lingering, timeMs: number): void {
    const age = timeMs - l.startMs;
    const t = Math.min(1, age / CRATER_MS);
    const r = l.r;
    this.gf.fillStyle(0x140c08, 0.6 * (1 - t * 0.7)).fillEllipse(l.x, l.y, r * 1.8, r * 0.8);
    this.ga.fillStyle(0xff6d00, 0.45 * (1 - t)).fillEllipse(l.x, l.y, r * 1.4, r * 0.6);
    if (age < 400) {
      const tt = age / 400;
      this.gt.fillStyle(0xffffff, 0.9 * (1 - tt)).fillCircle(l.x, l.y - r * 0.2, r * (0.6 + 0.7 * tt));
      this.ga.lineStyle(10, 0xffab40, 0.8 * (1 - tt)).strokeEllipse(l.x, l.y, r * (1 + 1.6 * tt) * 2, r * (1 + 1.6 * tt) * 0.9);
    }
  }

  /** しんそくの予告: 駆け抜ける道に細い白い線（だんだん濃く） */
  private drawSpeedAim(hz: Hz, p: number): void {
    const x1 = hz.x + hz.dirX * hz.length;
    const y1 = hz.y + hz.dirY * hz.length;
    this.gf.lineStyle(hz.radius * 2, 0xffffff, 0.06 + 0.1 * p).lineBetween(hz.x, hz.y, x1, y1);
    this.gt.lineStyle(3, 0xe0f7fa, 0.4 + 0.5 * p).lineBetween(hz.x, hz.y, x1, y1);
  }

  /** しんそく: 駆け抜けた道に残る白と緑の光の筋（体の後ろに長く伸び、すぐ細って消える） */
  private drawSpeedStreak(world: World, hz: Hz, timeMs: number): void {
    const i = findEnemyIndex(world, hz.dasher);
    if (i < 0) return;
    const bx = world.enemies.x[i]!;
    const by = world.enemies.y[i]!;
    this.ga.lineStyle(hz.radius * 2.2, 0x00e676, 0.35).lineBetween(hz.x, hz.y, bx, by);
    this.gt.lineStyle(hz.radius * 0.8, 0xffffff, 0.75).lineBetween(hz.x, hz.y, bx, by);
    // 筋の上を走る細い光
    for (let k = 0; k < 5; k++) {
      const t = ((timeMs / 120 + k / 5) % 1 + 1) % 1;
      const x = hz.x + (bx - hz.x) * t;
      const y = hz.y + (by - hz.y) * t;
      this.gt.lineStyle(4, 0xb9f6ca, 0.8).lineBetween(x, y, x - hz.dirX * 60, y - hz.dirY * 60);
    }
  }

  /** ぼうふうの溜め: まわりの風がレックウザへ吸い寄せられる（白い風の筋が渦を巻いて集まる） */
  private drawWindGather(hz: Hz, p: number, timeMs: number): void {
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + timeMs / 300;
      const d = hz.radius * (2.6 - 2.0 * (((timeMs / 600 + k / 10) % 1 + 1) % 1));
      const x = hz.x + Math.cos(a) * d;
      const y = hz.y + Math.sin(a) * d * 0.6;
      this.gt.lineStyle(7, 0xe0f2f1, 0.5 + 0.3 * p).lineBetween(x, y, x + Math.cos(a + 1.6) * 40, y + Math.sin(a + 1.6) * 24);
    }
  }

  /** ぼうふう: 進む大きな竜巻（下は細く、上へ広がる。回る白と緑の風の帯と、巻き上げられた砂と小石） */
  private drawVortex(hz: Hz, timeMs: number): void {
    const r = hz.radius;
    const H = r * 2.8;
    this.gf.fillStyle(0x000000, 0.28).fillEllipse(hz.x, hz.y, r * 2.2, r * 0.9);
    this.gf.lineStyle(6, 0xe0f2f1, 0.35).strokeEllipse(hz.x, hz.y, r * 2.2, r * 0.9);
    // 下から上へ、広がっていく風の輪（ずれながら回る）
    const rings = 9;
    for (let k = 0; k < rings; k++) {
      const t = k / (rings - 1);
      const cy = hz.y - t * H;
      const rw = r * (0.35 + 0.95 * t);
      const sway = Math.sin(timeMs / 300 + t * 3) * r * 0.18 * t;
      const ph = timeMs / 120 + k * 0.7;
      // 輪の手前半分を明るく（回っている見え方）
      this.ga.lineStyle(14, 0x69f0ae, 0.28).strokeEllipse(hz.x + sway, cy, rw * 2, rw * 0.5);
      const a0 = ph % (Math.PI * 2);
      const pts: Phaser.Math.Vector2[] = [];
      for (let s2 = 0; s2 <= 8; s2++) {
        const aa = a0 + (s2 / 8) * Math.PI * 0.9;
        pts.push(new Phaser.Math.Vector2(hz.x + sway + Math.cos(aa) * rw, cy + Math.sin(aa) * rw * 0.25));
      }
      this.gt.lineStyle(5, 0xf1f8e9, 0.75).strokePoints(pts);
    }
    // 巻き上げられた砂と小石
    for (let k = 0; k < 14; k++) {
      const t = ((timeMs / 900 + rnd(k, 5)) % 1 + 1) % 1;
      const a = timeMs / 150 + k * 1.3;
      const rw = r * (0.35 + 0.95 * t);
      this.gt.fillStyle(k % 2 ? 0x8d8173 : 0xbdb3a4, 0.9).fillRect(hz.x + Math.cos(a) * rw - 4, hz.y - t * H + Math.sin(a) * rw * 0.25 - 4, 8, 8);
    }
  }

  /** はかいこうせんの溜め: 口元に光が集まって大きくなり、狙う向きに細い線 */
  private drawBeamCharge(hz: Hz, ray: { x: number; y: number; r: number } | null, p: number, timeMs: number): void {
    const x1 = hz.x + hz.dirX * hz.length;
    const y1 = hz.y + hz.dirY * hz.length;
    this.gt.lineStyle(3, 0xffe082, 0.3 + 0.5 * p).lineBetween(hz.x, hz.y, x1, y1);
    const mx = ray?.x ?? hz.x;
    const my = (ray?.y ?? hz.y) - (ray?.r ?? 40) * 0.8;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + rnd(k, 2);
      const t = ((timeMs / 450 + rnd(k, 7)) % 1 + 1) % 1;
      const d = 200 * (1 - t);
      this.gt.fillStyle(0xfff8e1, 0.5 + 0.5 * t).fillCircle(mx + Math.cos(a) * d, my + Math.sin(a) * d * 0.8, 10 + 4 * t);
    }
    this.gt.fillStyle(0xffb300, 0.5).fillCircle(mx, my, 30 + 50 * p);
    this.gt.fillStyle(0xffffff, 0.9).fillCircle(mx, my, 14 + 26 * p);
  }

  /** はかいこうせん: 橙の外側と白い芯の太い光線。なぎ払う向きに合わせて回る */
  private drawBeam(hz: Hz, timeMs: number): void {
    const x1 = hz.x + hz.dirX * hz.length;
    const y1 = hz.y + hz.dirY * hz.length;
    const w = hz.radius * 2;
    const flick = 1 + 0.08 * Math.sin(timeMs / 40);
    this.ga.lineStyle(w * 1.8 * flick, 0xff6f00, 0.4).lineBetween(hz.x, hz.y, x1, y1);
    this.ga.lineStyle(w * flick, 0xffb300, 0.85).lineBetween(hz.x, hz.y, x1, y1);
    this.gt.lineStyle(w * 0.4, 0xfffde7, 0.95).lineBetween(hz.x, hz.y, x1, y1);
    this.gt.fillStyle(0xffffff, 0.9).fillCircle(hz.x, hz.y, w * 0.9);
  }
}
