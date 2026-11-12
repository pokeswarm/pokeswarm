import Phaser from 'phaser';
import { findEnemyIndex, type World } from '../../sim/world';

/** 決まった乱数（0〜1） */
function rnd(a: number, b: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/** ギザギザの電撃の折れ線（ゆっくり形が変わる。点滅はさせない） */
function bolt(x0: number, y0: number, x1: number, y1: number, seed: number, jag: number, segs: number): [number, number][] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const pts: [number, number][] = [[x0, y0]];
  for (let k = 1; k < segs; k++) {
    const t = k / segs;
    const off = (rnd(seed, k) - 0.5) * 2 * jag * Math.sin(t * Math.PI);
    pts.push([x0 + dx * t + nx * off, y0 + dy * t + ny * off]);
  }
  pts.push([x1, y1]);
  return pts;
}

/**
 * サンダーの技の絵（07 の〔サンダー〕章）: 発電機を結ぶ電撃・でんじはの輪・ドリルくちばし・蓄電の溜まり具合・必中のかみなり・でんじほう・こうそくいどうの残像。
 * 見た目だけ（当たりはシミュレーション）
 */
export class ZapdosElectric {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly gn: Phaser.GameObjects.Graphics;
  private readonly front: Phaser.GameObjects.Graphics;
  /** 必中のかみなりが落ちた時（全員の上に稲妻） */
  private strikes: { at: number }[] = [];
  private seen = new Set<object>();
  /** サンダーの前の場所（速く飛んだら残像） */
  private last: { x: number; y: number } | null = null;
  private trail: { x0: number; y0: number; x1: number; y1: number; at: number }[] = [];
  private lastTick = -1;

  constructor(
    scene: Phaser.Scene,
    depth: number,
    floorDepth: number,
    frontDepth: number,
  ) {
    this.g = scene.add.graphics().setDepth(depth).setBlendMode(Phaser.BlendModes.ADD);
    this.gn = scene.add.graphics().setDepth(floorDepth);
    this.front = scene.add.graphics().setDepth(frontDepth);
  }

  update(world: World, timeMs: number): void {
    this.g.clear();
    this.gn.clear();
    this.front.clear();
    const moves = world.rules.stage.moves;
    // 形は 0.15 秒ごとに少し変える（点滅させない）
    const phase = Math.floor(timeMs / 150);
    for (const hz of world.hazards) {
      const move = moves[hz.move];
      if (!move?.id.startsWith('zapdos-')) continue;
      const p = hz.activeTicks === undefined ? 1 - hz.ticksLeft / Math.max(1, hz.totalTicks) : 1;
      const seed = (hz.group ?? 0) * 7 + Math.round(hz.x) + Math.round(hz.y) * 3;
      if (move.arenaLinks) this.drawLink(hz, p, seed, phase);
      else if (move.surfRing) this.drawWave(hz, move.surfRing.gapDegrees, phase);
      else if (move.dashSpeed && hz.activeTicks !== undefined) this.drawDrill(world, hz.dasher, timeMs);
      else if (move.interruptDamage && hz.activeTicks === undefined) this.drawCharge(world, hz, move.interruptDamage.hpPct, p, timeMs, phase);
      else if (move.id === 'zapdos-zap-cannon-charge' && hz.activeTicks === undefined) this.drawCannonCharge(world, hz.dasher, p, phase);
      else if (move.id === 'zapdos-zap-cannon') this.drawCannon(hz, p, phase);
      else if (move.id === 'zapdos-thunder-all' && hz.activeTicks !== undefined && !this.seen.has(hz)) {
        this.seen.add(hz);
        this.strikes.push({ at: timeMs });
      }
    }
    if (this.seen.size > 30) this.seen.clear();
    this.strikes = this.strikes.filter((s) => timeMs - s.at < 700);
    for (const s of this.strikes) this.drawStrikeAll(world, (timeMs - s.at) / 700, s.at);
    this.drawAfterimage(world, timeMs);
  }

  /** 発電機を結ぶ電撃: 予告は細い放電（だんだん明るく）、落ちると太い電撃 */
  private drawLink(hz: World['hazards'][number], p: number, seed: number, phase: number): void {
    const ex = hz.x + hz.dirX * hz.length;
    const ey = hz.y + hz.dirY * hz.length;
    const segs = Math.max(6, Math.round(hz.length / 45));
    if (hz.activeTicks === undefined) {
      const pts = bolt(hz.x, hz.y, ex, ey, seed + phase, 14, segs);
      this.g.lineStyle(2, 0xfff59d, 0.25 + 0.55 * p);
      this.g.strokePoints(pts.map(([x, y]) => new Phaser.Math.Vector2(x, y)));
      // 両端の発電機の火花
      for (const [x, y] of [[hz.x, hz.y], [ex, ey]] as const) this.g.fillStyle(0xffee58, 0.3 + 0.5 * p).fillCircle(x, y, 10 + 14 * p);
      return;
    }
    const pts = bolt(hz.x, hz.y, ex, ey, seed + phase, 26, segs).map(([x, y]) => new Phaser.Math.Vector2(x, y));
    this.gn.lineStyle(hz.radius * 2, 0xfdd835, 0.18).lineBetween(hz.x, hz.y, ex, ey);
    this.g.lineStyle(hz.radius * 1.4, 0xffd600, 0.35).strokePoints(pts);
    this.g.lineStyle(10, 0xfff176, 0.85).strokePoints(pts);
    this.g.lineStyle(4, 0xffffff, 1).strokePoints(pts);
  }

  /** でんじは: 黄色いギザギザの輪（切れ目つき） */
  private drawWave(hz: World['hazards'][number], gapDegrees: number, phase: number): void {
    if (hz.activeTicks === undefined) return;
    const r = (hz.radius + (hz.innerRadius ?? 0)) / 2;
    const gap = (gapDegrees * Math.PI) / 180;
    const a0 = Math.atan2(hz.dirY, hz.dirX) + gap / 2;
    const span = Math.PI * 2 - gap;
    const n = Math.max(24, Math.round((r * span) / 22));
    const pts: Phaser.Math.Vector2[] = [];
    for (let k = 0; k <= n; k++) {
      const a = a0 + (k / n) * span;
      const rr = r + (k % 2 ? 1 : -1) * (6 + rnd(k, phase) * 5);
      pts.push(new Phaser.Math.Vector2(hz.x + Math.cos(a) * rr, hz.y + Math.sin(a) * rr));
    }
    this.gn.lineStyle(hz.radius - (hz.innerRadius ?? 0), 0xfff176, 0.16);
    this.gn.beginPath();
    this.gn.arc(hz.x, hz.y, r, a0, a0 + span, false);
    this.gn.strokePath();
    this.g.lineStyle(6, 0xffeb3b, 0.8).strokePoints(pts);
    this.g.lineStyle(2, 0xffffff, 0.9).strokePoints(pts);
  }

  /** ドリルくちばし: 体のまわりに回る電気の渦 */
  private drawDrill(world: World, dasher: number, timeMs: number): void {
    const i = findEnemyIndex(world, dasher);
    if (i === -1) return;
    const x = world.enemies.x[i]!;
    const y = world.enemies.y[i]! - 30;
    for (let k = 0; k < 3; k++) {
      const a = timeMs / 60 + (k * Math.PI * 2) / 3;
      this.front.lineStyle(4, 0xfff176, 0.8);
      this.front.beginPath();
      this.front.arc(x, y, 46 + k * 6, a, a + 1.6, false);
      this.front.strokePath();
    }
  }

  /** 蓄電: 体に集まる電気と、止めるのに要るダメージの溜まり具合（輪）。外の輪は残りの時間 */
  private drawCharge(world: World, hz: World['hazards'][number], hpPct: number, p: number, timeMs: number, phase: number): void {
    const i = findEnemyIndex(world, hz.dasher);
    if (i === -1) return;
    const x = world.enemies.x[i]!;
    const y = world.enemies.y[i]! - 40;
    const need = (world.enemies.maxHp[i]! * hpPct) / 100;
    const done = Math.max(0, Math.min(1, ((hz.hpAtStart ?? world.enemies.hp[i]!) - world.enemies.hp[i]!) / Math.max(1, need)));
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + timeMs / 900;
      const r0 = 120 - ((p * 3 + k / 6) % 1) * 80;
      const pts = bolt(x + Math.cos(a) * r0, y + Math.sin(a) * r0, x, y, k * 31 + phase, 8, 5).map(([px, py]) => new Phaser.Math.Vector2(px, py));
      this.g.lineStyle(3, 0xfff59d, 0.7).strokePoints(pts);
    }
    this.g.fillStyle(0xffee58, 0.18 + 0.3 * p).fillCircle(x, y, 30 + 20 * p);
    // 溜まり具合: 黄色い輪（ダメージで満ちると止まる）・外の白い輪は残り時間
    const r = 92;
    this.front.lineStyle(8, 0x37474f, 0.6).strokeCircle(x, y, r);
    this.front.lineStyle(8, 0xffeb3b, 0.95);
    this.front.beginPath();
    this.front.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + done * Math.PI * 2, false);
    this.front.strokePath();
    this.front.lineStyle(3, 0xffffff, 0.8);
    this.front.beginPath();
    this.front.arc(x, y, r + 10, -Math.PI / 2, -Math.PI / 2 + (1 - p) * Math.PI * 2, false);
    this.front.strokePath();
  }

  /** でんじほうを ためる: 胸の前に電気の玉が育つ */
  private drawCannonCharge(world: World, dasher: number, p: number, phase: number): void {
    const i = findEnemyIndex(world, dasher);
    if (i === -1) return;
    const x = world.enemies.x[i]!;
    const y = world.enemies.y[i]! - 36;
    const r = 14 + 46 * p;
    this.g.fillStyle(0xfff176, 0.35).fillCircle(x, y, r * 1.5);
    this.g.fillStyle(0xffffff, 0.9).fillCircle(x, y, r * 0.6);
    for (let k = 0; k < 5; k++) {
      const a = rnd(k, phase) * Math.PI * 2;
      const pts = bolt(x, y, x + Math.cos(a) * r * 1.8, y + Math.sin(a) * r * 1.8, k + phase * 7, 6, 4).map(([px, py]) => new Phaser.Math.Vector2(px, py));
      this.g.lineStyle(3, 0xffee58, 0.9).strokePoints(pts);
    }
  }

  /** でんじほう: 予告の帯（赤い予告に重ねて電気の筋）と、太い光線 */
  private drawCannon(hz: World['hazards'][number], p: number, phase: number): void {
    const ex = hz.x + hz.dirX * hz.length;
    const ey = hz.y + hz.dirY * hz.length;
    if (hz.activeTicks === undefined) {
      const pts = bolt(hz.x, hz.y, ex, ey, phase, 30, 24).map(([x, y]) => new Phaser.Math.Vector2(x, y));
      this.g.lineStyle(3, 0xfff59d, 0.3 + 0.5 * p).strokePoints(pts);
      return;
    }
    this.g.lineStyle(hz.radius * 2.2, 0xffd600, 0.3).lineBetween(hz.x, hz.y, ex, ey);
    this.g.lineStyle(hz.radius * 1.4, 0xfff176, 0.7).lineBetween(hz.x, hz.y, ex, ey);
    this.g.lineStyle(hz.radius * 0.6, 0xffffff, 0.95).lineBetween(hz.x, hz.y, ex, ey);
    for (let k = 0; k < 3; k++) {
      const pts = bolt(hz.x, hz.y, ex, ey, phase * 3 + k, hz.radius * 1.1, 30).map(([x, y]) => new Phaser.Math.Vector2(x, y));
      this.g.lineStyle(3, 0xffffff, 0.8).strokePoints(pts);
    }
  }

  /** 必中のかみなり: 全員の上に空から稲妻（1 回の短い光） */
  private drawStrikeAll(world: World, t: number, seed: number): void {
    for (const pl of world.players) {
      if (pl.down) continue;
      const top = pl.y - 900;
      const pts = bolt(pl.x + 40, top, pl.x, pl.y, seed + pl.id, 60, 14).map(([x, y]) => new Phaser.Math.Vector2(x, y));
      this.g.lineStyle(22, 0xffd600, 0.5 * (1 - t)).strokePoints(pts);
      this.g.lineStyle(8, 0xffffff, 1 - t).strokePoints(pts);
      this.g.fillStyle(0xfff59d, 0.6 * (1 - t)).fillCircle(pl.x, pl.y, 60 + 60 * t);
    }
  }

  /** こうそくいどう: 速く飛んだ跡に、黄色い光の筋が一瞬残る */
  private drawAfterimage(world: World, timeMs: number): void {
    const kind = world.rules.enemies.kinds.findIndex((k) => k.id === 'legend-zapdos');
    let i = -1;
    for (let k = 0; k < world.enemies.count; k++) if (world.enemies.kind[k] === kind && world.enemies.hp[k]! > 0) i = k;
    if (i === -1) {
      this.last = null;
      return;
    }
    const x = world.enemies.x[i]!;
    const y = world.enemies.y[i]! - 30;
    if (world.tick !== this.lastTick) {
      this.lastTick = world.tick;
      if (this.last && Math.hypot(x - this.last.x, y - this.last.y) > 600 * world.dt && Math.hypot(x - this.last.x, y - this.last.y) < 200) this.trail.push({ x0: this.last.x, y0: this.last.y, x1: x, y1: y, at: timeMs });
      this.last = { x, y };
    }
    this.trail = this.trail.filter((s) => timeMs - s.at < 260);
    for (const s of this.trail) {
      const t = (timeMs - s.at) / 260;
      this.g.lineStyle(26 * (1 - t), 0xfff176, 0.45 * (1 - t)).lineBetween(s.x0, s.y0, s.x1, s.y1);
    }
  }
}
