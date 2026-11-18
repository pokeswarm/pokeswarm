import Phaser from 'phaser';
import { findEnemyIndex, type World } from '../../sim/world';

function rnd(a: number, b: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

type Hz = World['hazards'][number];
type V = Phaser.Math.Vector2;
const v2 = (x: number, y: number): V => new Phaser.Math.Vector2(x, y);

interface Lingering {
  kind: 'zap' | 'star' | 'shade' | 'mirror' | 'smash';
  x: number;
  y: number;
  r: number;
  dirX: number;
  dirY: number;
  seed: number;
  startMs: number;
}

const LINGER_MS: Record<Lingering['kind'], number> = { zap: 700, star: 600, shade: 700, mirror: 600, smash: 900 };

/**
 * デオキシスの技の絵（07 の293章）: サイコブーストの DNA の螺旋を巻いた光線・スピードスターの星・ナイトヘッドの影の柱・
 * テレポートと姿の変わり目の DNA の光・ばかぢからの叩きつけ・でんじほうの電気の玉と大放電・てっぺきの鋼の殻・
 * ミラーコートの光る結晶の殻と反射の輪・コスモパワーの降る星・じこさいせいの光。見た目だけ（当たりはシミュレーション）
 */
export class DeoxysCosmos {
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
    for (const hz of world.hazards) {
      const id = moves[hz.move]?.id ?? '';
      if (!id.startsWith('deoxys-')) continue;
      const p = hz.activeTicks === undefined ? 1 - hz.ticksLeft / Math.max(1, hz.totalTicks) : 1;
      const active = hz.activeTicks !== undefined;
      const key = `${id}:${hz.group ?? 0}:${Math.round(hz.x)}:${Math.round(hz.y)}`;
      const boss = this.boss(world, hz);
      const linger = (kind: Lingering['kind']): void => {
        if (!this.lingering.has(key)) this.lingering.set(key, { kind, x: hz.x, y: hz.y, r: hz.radius, dirX: hz.dirX, dirY: hz.dirY, seed: rnd(hz.x, hz.y), startMs: timeMs });
      };
      if (id.startsWith('deoxys-psycho-boost') || id === 'deoxys-double-team-beam') {
        if (active) this.drawPsychoBeam(hz, timeMs);
        else this.drawPsychoCharge(hz, p, timeMs);
      } else if (id === 'deoxys-swift' || id === 'deoxys-swift-fast') {
        if (active) this.drawStar(hz, timeMs);
      } else if (id === 'deoxys-night-shade') {
        if (active) linger('shade');
        else this.drawShadePool(hz, p, timeMs);
      } else if (id.startsWith('deoxys-teleport') || id === 'deoxys-double-team') {
        if (!active) this.drawTeleport(hz, p, timeMs);
      } else if (id.startsWith('deoxys-form-change')) {
        if (!active && boss) this.drawFormChange(boss, p, timeMs);
      } else if (id.startsWith('deoxys-superpower')) {
        if (active) linger('smash');
        else this.drawSmashAim(hz, p, timeMs, moves[hz.move]?.arc ?? 90);
      } else if (id === 'deoxys-zap-cannon') {
        if (!active && boss) this.drawZapCharge(boss, p, timeMs);
      } else if (id === 'deoxys-zap-orb') {
        if (active) this.drawZapOrb(hz, timeMs);
      } else if (id === 'deoxys-zap-burst') {
        if (active) linger('zap');
        else this.drawZapWarn(hz, p, timeMs);
      } else if (id === 'deoxys-iron-defense') {
        if (boss) this.drawSteelShell(boss, active ? 1 : p, timeMs);
      } else if (id === 'deoxys-mirror-coat') {
        if (!active && boss) this.drawMirrorShell(world, hz, boss, p, timeMs);
      } else if (id === 'deoxys-mirror-burst') {
        if (active) linger('mirror');
        else this.drawMirrorWarn(hz, p, timeMs);
      } else if (id === 'deoxys-cosmic-power') {
        if (!active && boss) this.drawCosmicCharge(boss, p, timeMs);
      } else if (id === 'deoxys-cosmic-stars') {
        if (active) linger('star');
        else this.drawStarFall(hz, p, timeMs);
      } else if (id === 'deoxys-recover') {
        if (!active && boss) this.drawRecover(boss, p, timeMs);
      }
    }
    for (const [key, l] of this.lingering) {
      const age = timeMs - l.startMs;
      if (age > LINGER_MS[l.kind]) {
        this.lingering.delete(key);
        continue;
      }
      const t = age / LINGER_MS[l.kind];
      if (l.kind === 'zap') this.drawZapBlast(l, t, timeMs);
      else if (l.kind === 'star') this.drawStarImpact(l, t);
      else if (l.kind === 'shade') this.drawShadePillar(l, t, timeMs);
      else if (l.kind === 'mirror') this.drawMirrorBlast(l, t);
      else this.drawSmash(l, t);
    }
    if (!world.legendary) this.lingering.clear();
  }

  private boss(world: World, hz: Hz): { x: number; y: number; r: number } | null {
    if (hz.dasher === -1) return null;
    const i = findEnemyIndex(world, hz.dasher);
    if (i < 0) return null;
    return { x: world.enemies.x[i]!, y: world.enemies.y[i]!, r: world.enemies.radius[i]! };
  }

  /** DNA の二重らせん（2 本の波線と、その間の横木）。(x0,y0) から (x1,y1) へ、幅 w */
  private helix(g: Phaser.GameObjects.Graphics, x0: number, y0: number, x1: number, y1: number, w: number, phase: number, colA: number, colB: number, alpha: number, wave = 90): void {
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1) return;
    const ux = (x1 - x0) / len;
    const uy = (y1 - y0) / len;
    const nx = -uy;
    const ny = ux;
    const a: V[] = [];
    const b: V[] = [];
    const step = 14;
    for (let d = 0; d <= len; d += step) {
      const s = Math.sin((d / wave) * Math.PI * 2 + phase) * w;
      a.push(v2(x0 + ux * d + nx * s, y0 + uy * d + ny * s));
      b.push(v2(x0 + ux * d - nx * s, y0 + uy * d - ny * s));
    }
    g.lineStyle(5, colA, alpha).strokePoints(a);
    g.lineStyle(5, colB, alpha).strokePoints(b);
    // 横木（塩基の対）
    for (let d = wave / 4; d <= len; d += wave / 2) {
      const s = Math.sin((d / wave) * Math.PI * 2 + phase) * w;
      g.lineStyle(2, 0xffffff, alpha * 0.35).lineBetween(x0 + ux * d + nx * s, y0 + uy * d + ny * s, x0 + ux * d - nx * s, y0 + uy * d - ny * s);
    }
  }

  /** サイコブーストの溜め: 撃つ道に細い光、口元に紫の光が渦を巻いて集まる */
  private drawPsychoCharge(hz: Hz, p: number, timeMs: number): void {
    const x1 = hz.x + hz.dirX * hz.length;
    const y1 = hz.y + hz.dirY * hz.length;
    this.gt.lineStyle(3, 0xff80ab, 0.3 + 0.5 * p).lineBetween(hz.x, hz.y, x1, y1);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + timeMs / 260;
      const t = ((timeMs / 420 + rnd(k, 3)) % 1 + 1) % 1;
      const d = 170 * (1 - t);
      this.ga.fillStyle(k % 2 ? 0xea80fc : 0xff80ab, 0.4 + 0.5 * t).fillCircle(hz.x + Math.cos(a + t * 2) * d, hz.y + Math.sin(a + t * 2) * d * 0.8, 6 + 6 * t);
    }
    this.ga.fillStyle(0xd500f9, 0.45).fillCircle(hz.x, hz.y, 20 + 40 * p);
    this.gt.fillStyle(0xffffff, 0.9).fillCircle(hz.x, hz.y, 8 + 18 * p);
  }

  /** サイコブースト: 紫の外側・桃色・白い芯の太い光線に、DNA のらせんが巻きつく。口元に光の花 */
  private drawPsychoBeam(hz: Hz, timeMs: number): void {
    const x1 = hz.x + hz.dirX * hz.length;
    const y1 = hz.y + hz.dirY * hz.length;
    const w = hz.radius * 2;
    const flick = 1 + 0.07 * Math.sin(timeMs / 35);
    this.ga.lineStyle(w * 1.7 * flick, 0x7c4dff, 0.4).lineBetween(hz.x, hz.y, x1, y1);
    this.ga.lineStyle(w * flick, 0xf50057, 0.55).lineBetween(hz.x, hz.y, x1, y1);
    this.gt.lineStyle(w * 0.55, 0xff80ab, 0.85).lineBetween(hz.x, hz.y, x1, y1);
    this.gt.lineStyle(w * 0.22, 0xffffff, 0.95).lineBetween(hz.x, hz.y, x1, y1);
    this.helix(this.gt, hz.x, hz.y, x1, y1, w * 0.62, -timeMs / 60, 0xea80fc, 0xffab40, 0.85);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + timeMs / 300;
      this.ga.fillStyle(0xff4081, 0.5).fillEllipse(hz.x + Math.cos(a) * w * 0.7, hz.y + Math.sin(a) * w * 0.7, w * 0.9, w * 0.5);
    }
    this.gt.fillStyle(0xffffff, 0.9).fillCircle(hz.x, hz.y, w * 0.6);
  }

  /** スピードスター: 回る 5 つの角の星（黄色・白い芯・光のかさ・短い尾） */
  private drawStar(hz: Hz, timeMs: number): void {
    const r = Math.max(14, hz.radius * 1.4);
    const rot = timeMs / 120 + hz.x * 0.01;
    const sp = Math.hypot(hz.vx ?? 0, hz.vy ?? 0) || 1;
    const tx = -(hz.vx ?? 0) / sp;
    const ty = -(hz.vy ?? 0) / sp;
    this.gn.lineStyle(r * 0.9, 0xffecb3, 0.35).lineBetween(hz.x, hz.y, hz.x + tx * r * 3, hz.y + ty * r * 3);
    this.gn.fillStyle(0xfff59d, 0.3).fillCircle(hz.x, hz.y, r * 1.5);
    this.gt.fillStyle(0xffc400, 1).fillPoints(this.starPts(hz.x, hz.y, r, r * 0.45, rot), true);
    this.gt.fillStyle(0xfffde7, 1).fillPoints(this.starPts(hz.x, hz.y, r * 0.55, r * 0.25, rot), true);
  }

  private starPts(x: number, y: number, ro: number, ri: number, rot: number): V[] {
    const pts: V[] = [];
    for (let k = 0; k < 10; k++) {
      const a = rot + (k * Math.PI) / 5 - Math.PI / 2;
      const rr = k % 2 ? ri : ro;
      pts.push(v2(x + Math.cos(a) * rr, y + Math.sin(a) * rr));
    }
    return pts;
  }

  /** ナイトヘッドの予告: 地面に黒い影がしみ出して広がり、縁から紫の影の炎がゆらめく。中に光る目 */
  private drawShadePool(hz: Hz, p: number, timeMs: number): void {
    const r = hz.radius;
    const s = 0.4 + 0.6 * p;
    this.gf.fillStyle(0x0a0410, 0.35 + 0.4 * p).fillEllipse(hz.x, hz.y, r * 2 * s, r * 0.9 * s);
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + rnd(k, hz.x) * 0.5;
      const fl = (0.5 + 0.5 * Math.sin(timeMs / 120 + k * 1.7)) * p;
      const bx = hz.x + Math.cos(a) * r * s;
      const by = hz.y + Math.sin(a) * r * 0.45 * s;
      this.gn.fillStyle(0x4a148c, 0.55).fillTriangle(bx - 9, by, bx + 9, by, bx + Math.cos(a) * 6, by - 18 - 30 * fl);
    }
    if (p > 0.4) {
      const e = (p - 0.4) / 0.6;
      this.ga.fillStyle(0xff1744, 0.9 * e).fillEllipse(hz.x - 14, hz.y - 4, 12, 5);
      this.ga.fillStyle(0xff1744, 0.9 * e).fillEllipse(hz.x + 14, hz.y - 4, 12, 5);
    }
  }

  /** ナイトヘッド: 影から黒い柱が立ち、紫の炎をまとって昇り、ほどけて消える */
  private drawShadePillar(l: Lingering, t: number, timeMs: number): void {
    const r = l.r;
    const h = 420 * Math.min(1, t * 4);
    const w = r * (1 - t * 0.6);
    this.gf.fillStyle(0x0a0410, 0.7 * (1 - t)).fillEllipse(l.x, l.y, r * 2, r * 0.9);
    this.gn.fillStyle(0x12061f, 0.6 * (1 - t)).fillTriangle(l.x - w, l.y, l.x + w, l.y, l.x, l.y - h);
    this.ga.fillStyle(0x7c4dff, 0.45 * (1 - t)).fillTriangle(l.x - w * 0.7, l.y, l.x + w * 0.7, l.y, l.x, l.y - h * 0.85);
    for (let k = 0; k < 8; k++) {
      const tt = ((timeMs / 500 + rnd(k, l.seed)) % 1 + 1) % 1;
      const side = (rnd(l.seed, k) - 0.5) * w * 1.6;
      this.gn.fillStyle(0x311b92, 0.7 * (1 - tt) * (1 - t)).fillCircle(l.x + side, l.y - tt * h, 10 + 10 * tt);
    }
  }

  /** テレポート: 現れる所に縮む紫の輪と、地面から立つ光、DNA の短いらせん */
  private drawTeleport(hz: Hz, p: number, timeMs: number): void {
    const rr = 120 * (1 - p) + 30;
    this.ga.lineStyle(6, 0xea80fc, 0.3 + 0.6 * p).strokeEllipse(hz.x, hz.y, rr * 2, rr * 0.9);
    this.gf.fillStyle(0x4a148c, 0.25 + 0.3 * p).fillEllipse(hz.x, hz.y, 90, 40);
    this.ga.fillStyle(0xb388ff, 0.25 * p).fillTriangle(hz.x - 36, hz.y, hz.x + 36, hz.y, hz.x, hz.y - 260);
    this.helix(this.gt, hz.x, hz.y, hz.x, hz.y - 200 * p, 18, timeMs / 80, 0xff80ab, 0xffab40, 0.5 + 0.4 * p, 70);
  }

  /** 姿の変わり目: DNA の二重らせんが体のまわりを回りながら昇り、光の殻に包まれる。終わりに光がはじける */
  private drawFormChange(b: { x: number; y: number; r: number }, p: number, timeMs: number): void {
    const R = b.r * 3.2;
    const cy = b.y - b.r * 1.5;
    this.ga.fillStyle(0xff80ab, 0.25 + 0.35 * p).fillCircle(b.x, cy, R * (0.8 + 0.2 * p));
    this.gt.lineStyle(4, 0xffffff, 0.3 + 0.5 * p).strokeCircle(b.x, cy, R * (0.8 + 0.2 * p));
    for (let s = 0; s < 2; s++) {
      const pts: V[] = [];
      for (let k = 0; k <= 30; k++) {
        const t = k / 30;
        const a = timeMs / 160 + t * Math.PI * 4 + s * Math.PI;
        pts.push(v2(b.x + Math.cos(a) * R, b.y + b.r * 1.2 - t * R * 3 + Math.sin(a) * R * 0.25));
      }
      this.gt.lineStyle(5, s ? 0xffab40 : 0xea80fc, 0.85).strokePoints(pts);
    }
    for (let k = 0; k < 12; k++) {
      const t = ((timeMs / 700 + rnd(k, 5)) % 1 + 1) % 1;
      const a = rnd(5, k) * Math.PI * 2;
      this.gt.fillStyle(0xfff59d, 1 - t).fillRect(b.x + Math.cos(a) * R * 1.1 - 3, b.y + b.r - t * R * 3 - 3, 6, 6);
    }
    if (p > 0.88) this.gt.fillStyle(0xffffff, 0.8 * (1 - (p - 0.88) / 0.12)).fillCircle(b.x, cy, R * 1.2);
  }

  /** ばかぢからの予告: 扇の中に赤橙の力がたまり、触手の振り下ろす向きに 3 本の筋 */
  private drawSmashAim(hz: Hz, p: number, timeMs: number, arc: number): void {
    const a0 = Math.atan2(hz.dirY, hz.dirX);
    const half = (arc * Math.PI) / 360;
    const r = hz.radius;
    const pts: V[] = [v2(hz.x, hz.y)];
    for (let k = 0; k <= 16; k++) {
      const a = a0 - half + (2 * half * k) / 16;
      pts.push(v2(hz.x + Math.cos(a) * r * p, hz.y + Math.sin(a) * r * p));
    }
    this.ga.fillStyle(0xff3d00, 0.18 + 0.25 * p).fillPoints(pts, true);
    for (let k = -1; k <= 1; k++) {
      const a = a0 + k * half * 0.55;
      const len = r * (0.4 + 0.6 * p);
      this.gt.lineStyle(6, 0xffab40, 0.4 + 0.5 * p).lineBetween(hz.x + Math.cos(a) * r * 0.2, hz.y + Math.sin(a) * r * 0.2, hz.x + Math.cos(a) * len, hz.y + Math.sin(a) * len);
    }
    const pulse = 0.5 + 0.5 * Math.sin(timeMs / 70);
    this.ga.fillStyle(0xff6d00, 0.4 * p * pulse).fillCircle(hz.x, hz.y, 40);
  }

  /** ばかぢから: 扇の先へ広がる衝撃の弧、床の割れ、舞い上がる石 */
  private drawSmash(l: Lingering, t: number): void {
    const a0 = Math.atan2(l.dirY, l.dirX);
    const r = l.r;
    for (let k = 0; k < 3; k++) {
      const tt = Math.min(1, t * 1.6 + k * 0.1);
      const rr = r * (0.4 + 0.75 * tt);
      const pts: V[] = [];
      for (let s = 0; s <= 12; s++) {
        const a = a0 - 0.8 + (1.6 * s) / 12;
        pts.push(v2(l.x + Math.cos(a) * rr, l.y + Math.sin(a) * rr));
      }
      this.ga.lineStyle(16 * (1 - tt), 0xff6d00, 0.8 * (1 - tt)).strokePoints(pts);
      this.gt.lineStyle(4 * (1 - tt), 0xfff3e0, 0.9 * (1 - tt)).strokePoints(pts);
    }
    for (let k = 0; k < 5; k++) {
      const a = a0 + (k - 2) * 0.32;
      const len = r * (0.6 + 0.35 * rnd(k, l.seed));
      this.gf.lineStyle(6, 0x0d0f11, 0.8 * (1 - t)).lineBetween(l.x + Math.cos(a) * r * 0.3, l.y + Math.sin(a) * r * 0.3, l.x + Math.cos(a) * len, l.y + Math.sin(a) * len);
    }
    for (let k = 0; k < 10; k++) {
      const a = a0 + (rnd(l.seed, k) - 0.5) * 1.6;
      const d = r * (0.5 + 0.5 * rnd(k, l.seed)) + t * 60;
      const y = -(200 * t - 320 * t * t);
      this.gn.fillStyle(0x59636a, 1 - t).fillRect(l.x + Math.cos(a) * d - 5, l.y + Math.sin(a) * d + y - 5, 10, 10);
    }
  }

  /** でんじほうの溜め: 体のまわりに電気の火花が走り、腕の先に電気の玉がふくらむ */
  private drawZapCharge(b: { x: number; y: number; r: number }, p: number, timeMs: number): void {
    const cx = b.x;
    const cy = b.y - b.r;
    this.bolt(this.gt, cx, cy, 90 + 40 * p, 5, timeMs, 0xfff59d, 0.8);
    this.ga.fillStyle(0xffea00, 0.4).fillCircle(cx, cy, 20 + 40 * p);
    this.gt.fillStyle(0xffffff, 0.9).fillCircle(cx, cy, 10 + 20 * p);
  }

  /** (x,y) から放射状に、ぎざぎざの稲妻を n 本（時間でちらつく） */
  private bolt(g: Phaser.GameObjects.Graphics, x: number, y: number, len: number, n: number, timeMs: number, col: number, alpha: number): void {
    const f = Math.floor(timeMs / 60);
    for (let k = 0; k < n; k++) {
      const a = rnd(f, k) * Math.PI * 2;
      const pts: V[] = [v2(x, y)];
      for (let s = 1; s <= 5; s++) {
        const d = (len * s) / 5;
        const off = (rnd(f + s, k * 7) - 0.5) * len * 0.35;
        pts.push(v2(x + Math.cos(a) * d - Math.sin(a) * off, y + Math.sin(a) * d + Math.cos(a) * off));
      }
      g.lineStyle(7, 0x40c4ff, alpha * 0.5).strokePoints(pts);
      g.lineStyle(3, col, alpha).strokePoints(pts);
    }
  }

  /** でんじほうの玉: 白い芯・黄色の玉・青白い電気の輪、まわりへ走る稲妻、地面の照り返し */
  private drawZapOrb(hz: Hz, timeMs: number): void {
    const r = hz.radius;
    this.gf.fillStyle(0xffea00, 0.15).fillEllipse(hz.x, hz.y + r * 0.6, r * 2.6, r * 1.1);
    this.ga.fillStyle(0xffd600, 0.35).fillCircle(hz.x, hz.y, r * 1.5);
    this.ga.fillStyle(0xffea00, 0.7).fillCircle(hz.x, hz.y, r);
    this.gt.fillStyle(0xfffde7, 0.95).fillCircle(hz.x, hz.y, r * 0.55);
    for (let k = 0; k < 3; k++) {
      const a = timeMs / (200 + k * 90) + k;
      this.gt.lineStyle(3, 0x80d8ff, 0.8).strokeEllipse(hz.x, hz.y, r * 2.1, r * 2.1 * Math.abs(Math.cos(a)) + 6);
    }
    this.bolt(this.gt, hz.x, hz.y, r * 2.2, 4, timeMs, 0xfff9c4, 0.9);
  }

  /** でんじほうの大放電の予告: 地面に広がる黄色の輪と、走る火花 */
  private drawZapWarn(hz: Hz, p: number, timeMs: number): void {
    const r = hz.radius;
    this.gf.fillStyle(0xffea00, 0.08 + 0.16 * p).fillEllipse(hz.x, hz.y, r * 2, r * 0.9);
    this.ga.lineStyle(5, 0xffea00, 0.4 + 0.5 * p).strokeEllipse(hz.x, hz.y, r * 2 * p, r * 0.9 * p);
    this.bolt(this.gt, hz.x, hz.y, r * p, 3, timeMs, 0xfff59d, 0.6);
  }

  /** でんじほうの大放電: 白い光、四方へ伸びる太い稲妻、焦げ跡と散る火花 */
  private drawZapBlast(l: Lingering, t: number, timeMs: number): void {
    const r = l.r;
    if (t < 0.18) this.gt.fillStyle(0xffffff, 0.85 * (1 - t / 0.18)).fillCircle(l.x, l.y, r * 1.1);
    this.gf.fillStyle(0x101010, 0.5 * (1 - t)).fillEllipse(l.x, l.y, r * 1.6, r * 0.7);
    this.ga.fillStyle(0xffea00, 0.5 * (1 - t)).fillCircle(l.x, l.y, r * (0.6 + 0.6 * t));
    this.bolt(this.gt, l.x, l.y, r * 1.3, 8, timeMs, 0xfffde7, 1 - t);
    this.ga.lineStyle(10 * (1 - t), 0x80d8ff, 0.8 * (1 - t)).strokeEllipse(l.x, l.y, r * 2 * (0.6 + 0.8 * t), r * 0.9 * (0.6 + 0.8 * t));
  }

  /** てっぺき: 体を包む、鋼の六角の板でできた殻（光が板の上を流れる） */
  private drawSteelShell(b: { x: number; y: number; r: number }, p: number, timeMs: number): void {
    const cx = b.x;
    const cy = b.y - b.r * 1.4;
    const R = b.r * 3.1 * (0.7 + 0.3 * p);
    for (let ring = 0; ring < 2; ring++) {
      const n = ring ? 12 : 6;
      const rr = ring ? R * 0.92 : R * 0.45;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + (ring ? timeMs / 2000 : -timeMs / 2600);
        const hx = cx + Math.cos(a) * rr;
        const hy = cy + Math.sin(a) * rr * 0.9;
        const s = R * (ring ? 0.27 : 0.3);
        const pts: V[] = [];
        for (let j = 0; j < 6; j++) pts.push(v2(hx + Math.cos((j * Math.PI) / 3) * s, hy + Math.sin((j * Math.PI) / 3) * s));
        const shine = 0.5 + 0.5 * Math.sin(timeMs / 300 - a * 2);
        this.gt.fillStyle(0x90a4ae, 0.22 * p).fillPoints(pts, true);
        this.gt.lineStyle(5, shine > 0.8 ? 0xffffff : 0xcfd8dc, (0.5 + 0.4 * shine) * p).strokePoints(pts, true);
      }
    }
  }

  /** ミラーコートの構え: 体を包む、虹色に光る結晶の殻（受けたダメージが多いほど明るく、ひびが光る） */
  private drawMirrorShell(world: World, hz: Hz, b: { x: number; y: number; r: number }, p: number, timeMs: number): void {
    const i = findEnemyIndex(world, hz.dasher);
    const taken = i >= 0 ? Math.max(0, (hz.hpAtStart ?? world.enemies.hp[i]!) - world.enemies.hp[i]!) : 0;
    const charge = Math.min(1, taken / 15000);
    const cx = b.x;
    const cy = b.y - b.r * 1.4;
    const R = b.r * 3.1;
    const cols = [0xff80ab, 0xffd180, 0xffff8d, 0xb9f6ca, 0x80d8ff, 0xb388ff];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + timeMs / 1500;
      const a2 = a + Math.PI / 4;
      const pts = [v2(cx, cy), v2(cx + Math.cos(a) * R, cy + Math.sin(a) * R * 0.95), v2(cx + Math.cos(a2) * R, cy + Math.sin(a2) * R * 0.95)];
      this.gt.fillStyle(cols[k % cols.length]!, 0.14 + 0.26 * charge).fillPoints(pts, true);
      this.gt.lineStyle(3, 0xffffff, 0.3 + 0.3 * p).lineBetween(pts[0]!.x, pts[0]!.y, pts[1]!.x, pts[1]!.y);
      this.gt.lineStyle(5, 0xffffff, 0.45 + 0.5 * p).lineBetween(pts[1]!.x, pts[1]!.y, pts[2]!.x, pts[2]!.y);
    }
    this.gt.lineStyle(3, 0xe1f5fe, 0.5 + 0.4 * p).strokeCircle(cx, cy, R * 0.97);
    if (charge > 0) {
      for (let k = 0; k < 6; k++) {
        const a = rnd(k, 9) * Math.PI * 2;
        this.gt.lineStyle(3, 0xffffff, 0.9 * charge).lineBetween(cx + Math.cos(a) * R * 0.3, cy + Math.sin(a) * R * 0.3, cx + Math.cos(a + 0.2) * R * 0.95, cy + Math.sin(a + 0.2) * R * 0.95);
      }
    }
  }

  private drawMirrorWarn(hz: Hz, p: number, timeMs: number): void {
    const r = hz.radius;
    this.ga.lineStyle(6, 0xb388ff, 0.4 + 0.5 * p).strokeEllipse(hz.x, hz.y, r * 2, r * 0.9);
    this.gt.lineStyle(2, 0xffffff, 0.3 + 0.5 * Math.abs(Math.sin(timeMs / 80))).strokeEllipse(hz.x, hz.y, r * 2 * p, r * 0.9 * p);
  }

  /** ミラーコートの反射: 虹色の光の輪が広がり、結晶のかけらが飛ぶ */
  private drawMirrorBlast(l: Lingering, t: number): void {
    const r = l.r * (0.6 + 0.6 * t);
    const cols = [0xff80ab, 0xffd180, 0xffff8d, 0xb9f6ca, 0x80d8ff, 0xb388ff];
    cols.forEach((c, k) => this.ga.lineStyle(8, c, 0.7 * (1 - t)).strokeEllipse(l.x, l.y, (r + k * 8) * 2, (r + k * 8) * 0.9));
    if (t < 0.15) this.gt.fillStyle(0xffffff, 0.7 * (1 - t / 0.15)).fillEllipse(l.x, l.y, r * 2, r * 0.9);
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2 + l.seed;
      const d = r * 1.05;
      const x = l.x + Math.cos(a) * d;
      const y = l.y + Math.sin(a) * d * 0.45 - 30 * t;
      this.gt.fillStyle(cols[k % cols.length]!, 1 - t).fillTriangle(x, y - 9, x + 6, y + 5, x - 6, y + 5);
    }
  }

  /** コスモパワーの溜め: 体のまわりに小さな星が集まって回り、上へ打ち上がる */
  private drawCosmicCharge(b: { x: number; y: number; r: number }, p: number, timeMs: number): void {
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + timeMs / 250;
      const d = b.r * 2.2 * (1.2 - 0.5 * p);
      const x = b.x + Math.cos(a) * d;
      const y = b.y - b.r + Math.sin(a) * d * 0.5 - p * 60;
      this.gt.fillStyle(k % 3 ? 0xfff59d : 0x80d8ff, 0.9).fillPoints(this.starPts(x, y, 10, 4, a), true);
    }
    this.ga.fillStyle(0x7c4dff, 0.3 * p).fillCircle(b.x, b.y - b.r, b.r * 2.2);
  }

  /** コスモパワーの流れ星の予告: 落ちる所の青い印と、空から斜めに落ちる白い星（光の尾） */
  private drawStarFall(hz: Hz, p: number, timeMs: number): void {
    const r = hz.radius;
    this.gf.fillStyle(0x1a237e, 0.15 + 0.3 * p).fillEllipse(hz.x, hz.y, r * 2 * (0.4 + 0.6 * p), r * 0.9 * (0.4 + 0.6 * p));
    this.ga.lineStyle(3, 0x80d8ff, 0.3 + 0.5 * p).strokeEllipse(hz.x, hz.y, r * 2, r * 0.9);
    if (p < 0.3) return;
    const t = (p - 0.3) / 0.7;
    const sx = hz.x + 260;
    const sy = hz.y - 760;
    const x = sx + (hz.x - sx) * t;
    const y = sy + (hz.y - sy) * t;
    const len = Math.hypot(hz.x - sx, hz.y - sy);
    const ux = (hz.x - sx) / len;
    const uy = (hz.y - sy) / len;
    this.ga.lineStyle(18, 0x448aff, 0.4).lineBetween(x - ux * 200, y - uy * 200, x, y);
    this.gt.lineStyle(6, 0xe3f2fd, 0.85).lineBetween(x - ux * 120, y - uy * 120, x, y);
    this.ga.fillStyle(0x82b1ff, 0.5).fillCircle(x, y, 26);
    this.gt.fillStyle(0xffffff, 1).fillPoints(this.starPts(x, y, 18, 7, timeMs / 90), true);
  }

  /** 流れ星が落ちた所: 白い光と、四方へ散る小さな星 */
  private drawStarImpact(l: Lingering, t: number): void {
    const r = l.r;
    if (t < 0.25) this.gt.fillStyle(0xffffff, 0.8 * (1 - t / 0.25)).fillCircle(l.x, l.y - 6, r * 0.9);
    this.ga.lineStyle(8 * (1 - t), 0x80d8ff, 0.8 * (1 - t)).strokeEllipse(l.x, l.y, r * 2 * (0.7 + t), r * 0.9 * (0.7 + t));
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + l.seed * 6;
      const d = r * (0.3 + 1.1 * t);
      this.gt.fillStyle(k % 2 ? 0xfff59d : 0xe3f2fd, 1 - t).fillPoints(this.starPts(l.x + Math.cos(a) * d, l.y + Math.sin(a) * d * 0.5 - 30 * t, 9, 4, a + t * 4), true);
    }
  }

  /** じこさいせい: 体を包むやわらかな光と、下から昇る光の粒・DNA の短いらせん */
  private drawRecover(b: { x: number; y: number; r: number }, p: number, timeMs: number): void {
    this.ga.fillStyle(0xb9f6ca, 0.2 + 0.2 * p).fillCircle(b.x, b.y - b.r, b.r * 2.2);
    for (let k = 0; k < 12; k++) {
      const t = ((timeMs / 900 + rnd(k, 4)) % 1 + 1) % 1;
      const a = rnd(4, k) * Math.PI * 2;
      this.gt.fillStyle(k % 2 ? 0xccff90 : 0xffffff, 1 - t).fillCircle(b.x + Math.cos(a) * b.r * 1.6, b.y + b.r * 0.6 - t * b.r * 4, 5 + 3 * (1 - t));
    }
    this.helix(this.gt, b.x, b.y + b.r, b.x, b.y - b.r * 3, 16, timeMs / 90, 0xb9f6ca, 0xffffff, 0.5 * p, 70);
  }
}
