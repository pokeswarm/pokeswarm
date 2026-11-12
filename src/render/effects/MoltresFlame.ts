import Phaser from 'phaser';
import { findEnemyIndex, type World } from '../../sim/world';

function rnd(a: number, b: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * ファイヤーの技の絵（07 の〔ファイヤー〕章）: ねっぷうの熱の弧・エアスラッシュの風の刃・ゴッドバードの炎の筋・オーバーヒートの炎の輪・
 * 炎が弱まった間の煙・もえつきるの炎の海と台風の目・燃え尽きた後の灰。見た目だけ（当たりはシミュレーション）
 */
export class MoltresFlame {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly gn: Phaser.GameObjects.Graphics;
  private lastTick = -1;
  private tickMs = 0;

  constructor(scene: Phaser.Scene, depth: number, floorDepth: number) {
    this.g = scene.add.graphics().setDepth(depth).setBlendMode(Phaser.BlendModes.ADD);
    this.gn = scene.add.graphics().setDepth(floorDepth);
  }

  update(world: World, timeMs: number): void {
    this.g.clear();
    this.gn.clear();
    if (world.tick !== this.lastTick) {
      this.lastTick = world.tick;
      this.tickMs = timeMs;
    }
    const frac = Math.min(1, (timeMs - this.tickMs) / (world.dt * 1000));
    const moves = world.rules.stage.moves;
    for (const hz of world.hazards) {
      const move = moves[hz.move];
      if (!move?.id.startsWith('moltres-')) continue;
      const p = hz.activeTicks === undefined ? 1 - hz.ticksLeft / Math.max(1, hz.totalTicks) : 1;
      const seed = (hz.group ?? 0) * 7 + Math.round(hz.x) + Math.round(hz.y) * 3;
      if (move.surfRing?.arcDegrees && hz.activeTicks === undefined) this.drawHeatAim(hz, move.surfRing.arcDegrees, p);
      else if (move.surfRing?.arcDegrees && hz.activeTicks !== undefined) this.drawHeatArc(hz, move.surfRing.arcDegrees, move.surfRing.speed, world.dt, frac, timeMs, seed);
      else if (move.travel && hz.activeTicks !== undefined) this.drawBlade(hz, move.travel.speed, world.dt, frac, timeMs);
      else if (move.dashSpeed && hz.activeTicks !== undefined) this.drawStreak(world, hz, timeMs);
      else if (move.rings && move.id === 'moltres-overheat' && hz.activeTicks !== undefined) this.drawFireBand(hz.x, hz.y, hz.innerRadius ?? 0, hz.radius, 1, timeMs, seed);
      else if (move.id === 'moltres-cooled') this.drawSmoke(world, hz.dasher, timeMs);
      else if (move.id === 'moltres-burn-up') this.drawBurnUp(world, hz, p, timeMs, seed);
      else if (move.id === 'moltres-burnt-out') this.drawAsh(world, hz.dasher, timeMs);
    }
  }

  /** ねっぷうの予告: 当たる向き（弧の扇）を赤く。だんだん濃く */
  private drawHeatAim(hz: World['hazards'][number], arc: number, p: number): void {
    const a0 = Math.atan2(hz.dirY, hz.dirX) - (arc * Math.PI) / 360;
    const a1 = a0 + (arc * Math.PI) / 180;
    this.gn.fillStyle(0xff1744, 0.08 + 0.14 * p).slice(hz.x, hz.y, 520, a0, a1, false).fillPath();
    this.gn.lineStyle(2, 0xff5252, 0.8).slice(hz.x, hz.y, 520, a0, a1, false).strokePath();
  }

  /** ねっぷう: 熱でゆらめく橙の弧（ふちに炎の舌） */
  private drawHeatArc(hz: World['hazards'][number], arc: number, speed: number, dt: number, frac: number, timeMs: number, seed: number): void {
    const grow = speed * dt * frac;
    const outer = hz.radius + grow;
    const inner = (hz.innerRadius ?? 0) + grow;
    const mid = (outer + inner) / 2;
    const a0 = Math.atan2(hz.dirY, hz.dirX) - (arc * Math.PI) / 360;
    const a1 = a0 + (arc * Math.PI) / 180;
    const fade = Math.min(1, (hz.activeTicks ?? 0) / 10);
    this.g.lineStyle(outer - inner, 0xff7043, 0.32 * fade);
    this.g.beginPath();
    this.g.arc(hz.x, hz.y, mid, a0, a1, false);
    this.g.strokePath();
    this.g.lineStyle((outer - inner) * 0.4, 0xffcc80, 0.45 * fade);
    this.g.beginPath();
    this.g.arc(hz.x, hz.y, mid, a0, a1, false);
    this.g.strokePath();
    // 外のふちの炎の舌（ゆらめく）
    const n = Math.max(8, Math.round(((a1 - a0) * outer) / 26));
    for (let k = 0; k <= n; k++) {
      const a = a0 + ((a1 - a0) * k) / n;
      const lick = 10 + 10 * Math.abs(Math.sin(timeMs / 90 + k * 1.7 + seed));
      this.g.lineStyle(5, 0xffab40, 0.6 * fade).lineBetween(hz.x + Math.cos(a) * outer, hz.y + Math.sin(a) * outer, hz.x + Math.cos(a) * (outer + lick), hz.y + Math.sin(a) * (outer + lick));
    }
  }

  /** エアスラッシュ: 進む向きに開いた、白緑の三日月の刃 */
  private drawBlade(hz: World['hazards'][number], speed: number, dt: number, frac: number, timeMs: number): void {
    const vx = hz.vx ?? hz.dirX * speed;
    const vy = hz.vy ?? hz.dirY * speed;
    const x = hz.x - vx * dt * (1 - frac);
    const y = hz.y - vy * dt * (1 - frac);
    const a = Math.atan2(vy, vx);
    const r = hz.radius * 1.3;
    this.g.lineStyle(7, 0xccff90, 0.55);
    this.g.beginPath();
    this.g.arc(x - Math.cos(a) * r * 0.4, y - Math.sin(a) * r * 0.4, r, a - 1.1, a + 1.1, false);
    this.g.strokePath();
    this.g.lineStyle(3, 0xffffff, 0.9);
    this.g.beginPath();
    this.g.arc(x - Math.cos(a) * r * 0.4, y - Math.sin(a) * r * 0.4, r, a - 0.9, a + 0.9, false);
    this.g.strokePath();
    void timeMs;
  }

  /** ゴッドバード: 突き抜ける体のうしろに、白から橙の炎の筋 */
  private drawStreak(world: World, hz: World['hazards'][number], timeMs: number): void {
    const i = findEnemyIndex(world, hz.dasher);
    if (i === -1) return;
    const x = world.enemies.x[i]!;
    const y = world.enemies.y[i]! - 30;
    for (let k = 1; k <= 8; k++) {
      const d = k * 34;
      const wob = Math.sin(timeMs / 40 + k) * 6;
      this.g.fillStyle(k < 3 ? 0xffffff : k < 5 ? 0xffe082 : 0xff7043, 0.55 - k * 0.055).fillCircle(x - hz.dirX * d - hz.dirY * wob, y - hz.dirY * d + hz.dirX * wob, 46 - k * 4);
    }
  }

  /** 炎の帯（オーバーヒートの輪）: 帯の中を炎で満たし、ふちに舌 */
  private drawFireBand(x: number, y: number, inner: number, outer: number, alpha: number, timeMs: number, seed: number): void {
    const mid = (inner + outer) / 2;
    this.g.lineStyle(outer - inner, 0xff5722, 0.4 * alpha).strokeCircle(x, y, mid);
    this.g.lineStyle((outer - inner) * 0.45, 0xffd180, 0.5 * alpha).strokeCircle(x, y, mid);
    const n = Math.max(12, Math.round((Math.PI * 2 * outer) / 30));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const lick = 12 + 14 * Math.abs(Math.sin(timeMs / 80 + k * 2.3 + seed));
      this.g.lineStyle(6, 0xffab40, 0.65 * alpha).lineBetween(x + Math.cos(a) * outer, y + Math.sin(a) * outer, x + Math.cos(a) * (outer + lick), y + Math.sin(a) * (outer + lick));
    }
  }

  /** 炎が弱まった間: 体から細い灰色の煙が上る */
  private drawSmoke(world: World, dasher: number, timeMs: number): void {
    const i = findEnemyIndex(world, dasher);
    if (i === -1) return;
    const x = world.enemies.x[i]!;
    const y = world.enemies.y[i]! - 40;
    for (let k = 0; k < 6; k++) {
      const t = ((timeMs / 1400 + k / 6) % 1);
      this.gn.fillStyle(0x9e9e9e, 0.35 * (1 - t)).fillCircle(x + Math.sin(t * 6 + k) * 14 + (k - 3) * 10, y - t * 90, 8 + t * 14);
    }
  }

  /** もえつきる: ためる間は台風の目の外に炎が集まり、落ちると目の外が炎の海 */
  private drawBurnUp(world: World, hz: World['hazards'][number], p: number, timeMs: number, seed: number): void {
    const inner = hz.innerRadius ?? 0;
    if (hz.activeTicks === undefined) {
      // 目のふちに、だんだん濃くなる炎の輪（目の大きさが分かるように）
      this.drawFireBand(hz.x, hz.y, inner, inner + 24, 0.3 + 0.6 * p, timeMs, seed);
      // 外から寄ってくる火の粉
      for (let k = 0; k < 40; k++) {
        const a = rnd(k, seed) * Math.PI * 2;
        const d = 900 * (1 - ((p + rnd(k, 3)) % 1)) + inner;
        this.g.fillStyle(0xffab40, 0.6).fillCircle(hz.x + Math.cos(a) * d, hz.y + Math.sin(a) * d * 0.7, 4);
      }
      return;
    }
    const fade = Math.min(1, (hz.activeTicks ?? 0) / 12);
    const a = world.arena;
    const outer = a ? Math.hypot(a.halfWidth, a.halfHeight) + 200 : hz.radius;
    this.gn.lineStyle(outer - inner, 0xbf360c, 0.55 * fade).strokeCircle(hz.x, hz.y, (outer + inner) / 2);
    this.drawFireBand(hz.x, hz.y, inner, inner + 60, fade, timeMs, seed);
    // 炎の海の揺らめき
    for (let k = 0; k < 70; k++) {
      const ang = rnd(k, seed + 1) * Math.PI * 2;
      const d = inner + 70 + rnd(k, seed + 2) * 900;
      const h = 18 + 22 * Math.abs(Math.sin(timeMs / 70 + k));
      const x = hz.x + Math.cos(ang) * d;
      const y = hz.y + Math.sin(ang) * d * 0.7;
      this.g.lineStyle(10, 0xff7043, 0.55 * fade).lineBetween(x, y, x, y - h);
      this.g.lineStyle(4, 0xffe082, 0.7 * fade).lineBetween(x, y - h * 0.3, x, y - h * 0.8);
    }
  }

  /** 燃え尽きた後: 灰が舞い落ちる */
  private drawAsh(world: World, dasher: number, timeMs: number): void {
    const i = findEnemyIndex(world, dasher);
    if (i === -1) return;
    const x = world.enemies.x[i]!;
    const y = world.enemies.y[i]! - 50;
    for (let k = 0; k < 14; k++) {
      const t = (timeMs / 1800 + k / 14) % 1;
      this.gn.fillStyle(k % 2 ? 0x757575 : 0xbdbdbd, 0.7 * (1 - t)).fillRect(x + (rnd(k, 1) - 0.5) * 90 + Math.sin(t * 5 + k) * 8, y + t * 70, 4, 4);
    }
  }
}
