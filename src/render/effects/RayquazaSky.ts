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

const IMPACT_MS = 1400;
const CRATER_MS = 1800;

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
      if (id.startsWith('rayquaza-dragon-ascent')) {
        if (hz.activeTicks === undefined) this.drawAscentShadow(hz, p, timeMs);
        else {
          seen.add(key);
          if (!this.lingering.has(key)) this.lingering.set(key, { kind: 'impact', x: hz.x, y: hz.y, r: hz.radius, seed: rnd(hz.x, hz.y), startMs: timeMs, goneMs: 0 });
        }
      } else if (id === 'rayquaza-draco-meteor') {
        if (hz.activeTicks === undefined) this.drawMeteorFall(hz, p, ray, timeMs);
        else {
          seen.add(key);
          if (!this.lingering.has(key)) this.lingering.set(key, { kind: 'crater', x: hz.x, y: hz.y, r: hz.radius, seed: rnd(hz.x, hz.y), startMs: timeMs, goneMs: 0 });
        }
      } else if (id === 'rayquaza-extreme-speed') {
        if (hz.activeTicks === undefined) this.drawSpeedAim(hz, p, timeMs);
        else this.drawSpeedStreak(world, hz, timeMs);
      } else if (id === 'rayquaza-hurricane') {
        if (hz.activeTicks === undefined) this.drawWindGather(hz, p, timeMs);
        else this.drawVortex(hz, timeMs);
      } else if (id === 'rayquaza-hyper-beam') {
        if (hz.activeTicks === undefined) this.drawBeamCharge(hz, ray, p, timeMs);
        else this.drawBeam(world, hz, timeMs);
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
    // 空を旋回するレックウザの長い体の影（うねる帯）。高いうちは大きく薄く、降りてくるほど小さく濃く、輪が締まる
    const spread = 1.9 - 0.9 * p;
    const alpha = 0.32 + 0.33 * p;
    const turn = timeMs / 380;
    for (let k = 0; k < 16; k++) {
      const s = k / 15;
      const a = turn - s * 2.4;
      const rr = r * spread * (0.95 + 0.12 * Math.sin(s * 9 + timeMs / 200));
      const w = r * 0.5 * (1 - s * 0.7) * (0.7 + 0.3 * p);
      const x = hz.x + Math.cos(a) * rr;
      const y = hz.y + Math.sin(a) * rr * 0.44;
      // 暗い床でも分かるよう、影の縁に薄い緑の光（体がまとう光が地面に映る）
      this.ga.fillStyle(0x00e676, 0.1 * (1 - s * 0.6)).fillEllipse(x, y, w * 2.6, w * 1.2);
      this.gf.fillStyle(0x000000, alpha * (1 - s * 0.5)).fillEllipse(x, y, w * 2, w * 0.9);
    }
    // 落ちる所: 締まっていく緑の輪と、竜の紋の刻み
    this.gf.fillStyle(0x000000, 0.1 + 0.25 * p).fillEllipse(hz.x, hz.y, r * 2, r * 0.9);
    this.gf.lineStyle(4, 0x69f0ae, 0.3 + 0.5 * p).strokeEllipse(hz.x, hz.y, r * 2, r * 0.9);
    const inner = 1 + (1 - p) * 0.8;
    this.ga.lineStyle(3, 0x00e676, 0.25 + 0.45 * p).strokeEllipse(hz.x, hz.y, r * 2 * inner, r * 0.9 * inner);
    for (let k = 0; k < 8; k++) {
      const a = timeMs / 700 + (k / 8) * Math.PI * 2;
      const x = hz.x + Math.cos(a) * r * 0.86;
      const y = hz.y + Math.sin(a) * r * 0.39;
      this.ga.fillStyle(0x69f0ae, 0.5 * p).fillTriangle(x - 7, y, x + 7, y, x + Math.cos(a) * 14, y + Math.sin(a) * 7);
    }
    // 終わりの 3 割: 緑の炎をまとって空から真っ逆さまに降ってくる（りゅうせい のように）
    if (p > 0.55) {
      const t = (p - 0.55) / 0.45;
      const k = Math.pow(t, 1.5);
      const topY = hz.y - 950;
      const hx = hz.x + (1 - k) * 80;
      const hy = topY + (hz.y - topY) * k;
      const ux = -80 / 950;
      const flick = 0.9 + 0.2 * rnd(Math.floor(timeMs / 50), hz.x);
      const tri = (g: Phaser.GameObjects.Graphics, c: number, al: number, w: number, l: number): void => {
        g.fillStyle(c, al).fillTriangle(hx - w, hy, hx + w, hy, hx - ux * l, hy - l);
      };
      tri(this.ga, 0x00c853, 0.45, 70, 520 * flick);
      tri(this.ga, 0x00e676, 0.7, 48, 380 * flick);
      tri(this.gt, 0xb9f6ca, 0.85, 28, 260 * flick);
      tri(this.gt, 0xffffff, 0.95, 13, 170 * flick);
      this.ga.fillStyle(0x00e676, 0.55).fillCircle(hx, hy, 74 * flick);
      this.gt.fillStyle(0xccff90, 0.9).fillCircle(hx, hy, 40);
      this.gt.fillStyle(0xffffff, 1).fillCircle(hx, hy + 6, 22);
      // 頭を包む、回る風の輪
      for (let j = 0; j < 3; j++) {
        const yy = hy - 40 - j * 70;
        const ww = 60 + j * 26;
        this.gt.lineStyle(4, 0xe8f5e9, 0.7 - j * 0.18).strokeEllipse(hx, yy, ww * 2, ww * 0.5);
      }
      // 地面に落ちる強い光（近づくほど明るく）
      this.ga.fillStyle(0x00e676, 0.45 * k).fillEllipse(hz.x, hz.y, r * 2.4, r * 1.05);
    }
  }

  /** ガリョウテンセイが落ちた所: 緑の衝撃の輪が 2 重に広がり、岩のかけらが飛び、地面が割れる */
  private drawImpact(l: Lingering, timeMs: number): void {
    const age = timeMs - l.startMs;
    const t = Math.min(1, age / IMPACT_MS);
    const r = l.r;
    // 一瞬の白い光と、地面から立つ緑の光の柱（すぐ細って消える）
    if (age < 120) this.gt.fillStyle(0xffffff, 0.85 * (1 - age / 120)).fillEllipse(l.x, l.y, r * 2.6, r * 1.2);
    if (age < 500) {
      const tt = age / 500;
      // 下が太く上へ細る光の柱（何枚も重ねて、縁をやわらかく）。根もとに光のたまり
      const w = r * 0.95 * (1 - tt * 0.8);
      const top = l.y - 760 * (0.6 + 0.4 * tt);
      for (const [c, al, k] of [[0x00c853, 0.25, 1.4], [0x00e676, 0.4, 1], [0xb9f6ca, 0.6, 0.55], [0xffffff, 0.8, 0.22]] as const) {
        const g = c === 0xffffff || c === 0xb9f6ca ? this.gt : this.ga;
        g.fillStyle(c, al * (1 - tt)).fillTriangle(l.x - w * k, l.y, l.x + w * k, l.y, l.x, top);
      }
      this.ga.fillStyle(0x00e676, 0.5 * (1 - tt)).fillEllipse(l.x, l.y, w * 3, w * 1.3);
    }
    // 緑の衝撃の輪（3 重）と、土ぼこりの輪
    for (let k = 0; k < 3; k++) {
      const tt = Math.max(0, Math.min(1, (age - k * 130) / 620));
      if (tt <= 0 || tt >= 1) continue;
      const rr = r * (1 + 2.6 * tt);
      this.ga.lineStyle(22 * (1 - tt), 0x00e676, 0.8 * (1 - tt)).strokeEllipse(l.x, l.y, rr * 2, rr * 0.9);
      this.gt.lineStyle(5 * (1 - tt), 0xffffff, 0.9 * (1 - tt)).strokeEllipse(l.x, l.y, rr * 2, rr * 0.9);
    }
    if (age < 900) {
      const tt = age / 900;
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2 + l.seed;
        const d = r * (1.0 + 1.6 * Math.sqrt(tt));
        this.gn.fillStyle(0x6d6459, 0.45 * (1 - tt)).fillCircle(l.x + Math.cos(a) * d, l.y + Math.sin(a) * d * 0.45 - tt * 20, r * (0.3 + 0.35 * tt));
      }
    }
    // 跳ね上がった石板（割れて斜めに立つ。しばらく残る）
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + l.seed * 3;
      const d = r * (0.8 + 0.25 * rnd(k, l.seed));
      const cx = l.x + Math.cos(a) * d;
      const cy = l.y + Math.sin(a) * d * 0.45;
      const up = Math.min(1, age / 120) * (1 - Math.max(0, t - 0.7) / 0.3);
      const hgt = r * (0.3 + 0.2 * rnd(l.seed, k)) * up;
      const wd = r * 0.32;
      const tx = Math.cos(a) * 10;
      this.gn.fillStyle(0x0e1012, 0.6).fillEllipse(cx, cy + 2, wd * 2.4, wd * 0.7);
      this.gn.fillStyle(0x59636a, 1).fillPoints([
        new Phaser.Math.Vector2(cx - wd, cy),
        new Phaser.Math.Vector2(cx + wd, cy),
        new Phaser.Math.Vector2(cx + wd * 0.7 + tx, cy - hgt),
        new Phaser.Math.Vector2(cx - wd * 0.8 + tx, cy - hgt * 0.85),
      ], true);
      this.gn.fillStyle(0x9aa5ab, 1).fillRect(cx - wd * 0.8 + tx, cy - hgt * 0.95, wd * 1.5, Math.max(1, hgt * 0.18));
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

  /**
   * りゅうせいぐんの予告（07 の291章）: レックウザの口から光の玉が空へ撃ち上がり、空から燃える岩が斜めに落ちてくる。
   * 岩は暗い芯と、進む側が赤く溶けた面。まわりに白→黄→橙の炎の衣と、竜の紫の光。後ろに長く細る炎の尾・火の粉・煙。
   * 地面は落ちる所の影と、近づくほど明るくなる橙の照り返し
   */
  private drawMeteorFall(hz: Hz, p: number, ray: { x: number; y: number; r: number } | null, timeMs: number): void {
    const r = hz.radius;
    const seed = rnd(hz.x, hz.y);
    // 撃ち上げ: 最初の 2 割、口元から空へ昇る光の玉
    if (ray && p < 0.22) {
      const t = p / 0.22;
      const ox = ray.x + (seed - 0.5) * 60;
      const oy = ray.y - ray.r * 0.8 - t * 900;
      this.ga.lineStyle(26, 0x7c4dff, 0.35 * (1 - t)).lineBetween(ox, oy + 140, ox, oy);
      this.gt.lineStyle(8, 0xffe0b2, 0.9 * (1 - t * 0.5)).lineBetween(ox, oy + 90, ox, oy);
      this.gt.fillStyle(0xffffff, 1).fillCircle(ox, oy, 13);
    }
    // 地面: 落ちる所の影と、近づく炎の照り返し
    const t = Math.max(0, Math.min(1, (p - 0.18) / 0.82));
    this.gf.fillStyle(0x000000, 0.12 + 0.32 * p).fillEllipse(hz.x, hz.y, r * 2 * (0.45 + 0.55 * p), r * 0.9 * (0.45 + 0.55 * p));
    this.gf.lineStyle(3, 0xffab40, 0.25 + 0.5 * p).strokeEllipse(hz.x, hz.y, r * 2, r * 0.9);
    if (t > 0) this.ga.fillStyle(0xff6d00, 0.4 * t * t).fillEllipse(hz.x, hz.y, r * 2.4, r * 1.05);
    if (p < 0.18) return;
    // 落ちる道: 左上から（流星ごとに少し向きが違う）。だんだん速く
    const sx = hz.x - 260 - seed * 260;
    const sy = hz.y - 900;
    const k = Math.pow(t, 1.35);
    const x = sx + (hz.x - sx) * k;
    const y = sy + (hz.y - sy) * k;
    const len = Math.hypot(hz.x - sx, hz.y - sy);
    const ux = (hz.x - sx) / len;
    const uy = (hz.y - sy) / len;
    const nx = -uy;
    const ny = ux;
    const R = 30;
    const flick = (n: number): number => 0.85 + 0.3 * rnd(Math.floor(timeMs / 50) + n, seed * 97);
    // 煙: 尾のさらに後ろに、暗い紫がかった煙の玉
    for (let i = 0; i < 7; i++) {
      const d = 180 + i * 46;
      const w = Math.sin(timeMs / 140 + i * 1.7 + seed * 9) * 10;
      this.gn.fillStyle(0x2a2233, 0.28 * (1 - i / 7)).fillCircle(x - ux * d + nx * w, y - uy * d + ny * w, R * (0.9 + i * 0.16));
    }
    // 竜の光（紫の大きなかさ）
    this.ga.fillStyle(0x7c4dff, 0.28).fillCircle(x, y, R * 2.6);
    this.ga.fillStyle(0xb388ff, 0.22).fillCircle(x - ux * R, y - uy * R, R * 1.8);
    // 炎の尾: 太い赤橙 → 橙 → 薄い黄 → 白の芯（三角を重ねる。長さはちらつく）
    const L1 = 320 * flick(1);
    const L2 = 220 * flick(2);
    const L3 = 130 * flick(3);
    const tail = (g: Phaser.GameObjects.Graphics, color: number, alpha: number, w: number, l: number): void => {
      g.fillStyle(color, alpha).fillTriangle(x + nx * w, y + ny * w, x - nx * w, y - ny * w, x - ux * l, y - uy * l);
    };
    tail(this.ga, 0xff3d00, 0.55, R * 1.5, L1);
    tail(this.ga, 0xff9100, 0.7, R * 1.1, L2);
    tail(this.gt, 0xffd180, 0.85, R * 0.75, L3);
    tail(this.gt, 0xfffde7, 0.9, R * 0.4, L3 * 0.6);
    // 炎の衣（頭のまわり）
    this.ga.fillStyle(0xff6d00, 0.75).fillCircle(x, y, R * 1.45 * flick(4));
    this.gt.fillStyle(0xffcc80, 0.9).fillCircle(x + ux * 3, y + uy * 3, R * 1.12);
    // 岩: 暗い芯（ゆっくり回るでこぼこの形）と、進む側の溶けた面
    const pts: Phaser.Math.Vector2[] = [];
    const lit: Phaser.Math.Vector2[] = [];
    const spin = timeMs / 400 + seed * 6;
    for (let i = 0; i < 8; i++) {
      const ang = spin + (i / 8) * Math.PI * 2;
      const rr = R * (0.72 + 0.3 * rnd(i, seed * 31));
      pts.push(new Phaser.Math.Vector2(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr));
      lit.push(new Phaser.Math.Vector2(x + ux * R * 0.22 + Math.cos(ang) * rr * 0.72, y + uy * R * 0.22 + Math.sin(ang) * rr * 0.72));
    }
    this.gt.fillStyle(0x3a221a, 1).fillPoints(pts, true);
    this.gt.fillStyle(0xd84315, 1).fillPoints(lit, true);
    this.gt.fillStyle(0xffab40, 1).fillCircle(x + ux * R * 0.42, y + uy * R * 0.42, R * 0.38);
    this.gt.fillStyle(0xffffff, 0.95).fillCircle(x + ux * R * 0.55, y + uy * R * 0.55, R * 0.2);
    // 岩のひび（溶けて光る）
    this.gt.lineStyle(3, 0xffd54f, 0.9);
    for (let i = 0; i < 3; i++) {
      const ang = spin + i * 2.1;
      this.gt.lineBetween(x - ux * 4, y - uy * 4, x + Math.cos(ang) * R * 0.6, y + Math.sin(ang) * R * 0.6);
    }
    // 火の粉: 尾から横へこぼれて流れる
    for (let i = 0; i < 10; i++) {
      const life = (timeMs / 420 + rnd(i, seed * 13)) % 1;
      const d = 40 + life * 300;
      const side = (rnd(seed * 7, i) - 0.5) * 2 * (16 + life * 70);
      const sz = 9 * (1 - life) + 3;
      this.gt.fillStyle(life < 0.4 ? 0xffe082 : 0xff7043, 1 - life).fillRect(x - ux * d + nx * side - sz / 2, y - uy * d + ny * side - sz / 2, sz, sz);
    }
  }

  /**
   * りゅうせいぐんが落ちた所（07 の291章）: 白い光、ふくらむ火の玉と衝撃の輪、飛び散る岩と火の粉、立ち昇る煙。
   * 焦げた穴に溶けたひびがしばらく赤く光って冷えていく
   */
  private drawCrater(l: Lingering, timeMs: number): void {
    const age = timeMs - l.startMs;
    const t = Math.min(1, age / CRATER_MS);
    const r = l.r;
    // 焦げた穴と、盛り上がった縁
    this.gf.fillStyle(0x0d0a09, 0.75 * (1 - t * 0.6)).fillEllipse(l.x, l.y, r * 2.0, r * 0.88);
    this.gf.lineStyle(6, 0x4e3b30, 0.7 * (1 - t * 0.6)).strokeEllipse(l.x, l.y, r * 2.15, r * 0.95);
    // 溶けたひび（放射状。赤く光って冷える）
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + l.seed * 5;
      const len = r * (0.8 + rnd(k, l.seed) * 0.7);
      const mx = l.x + Math.cos(a + 0.25) * len * 0.5;
      const my = l.y + Math.sin(a + 0.25) * len * 0.22;
      const ex = l.x + Math.cos(a) * len;
      const ey = l.y + Math.sin(a) * len * 0.44;
      this.gf.lineStyle(6, 0x0a0706, 0.8 * (1 - t * 0.5)).lineBetween(l.x, l.y, mx, my).lineBetween(mx, my, ex, ey);
      this.ga.lineStyle(3, t < 0.5 ? 0xffab40 : 0xff3d00, 0.85 * (1 - t)).lineBetween(l.x, l.y, mx, my).lineBetween(mx, my, ex, ey);
    }
    this.ga.fillStyle(0xff6d00, 0.5 * (1 - t)).fillEllipse(l.x, l.y, r * 1.2, r * 0.5);
    // 白い光（一瞬・その場だけ）
    if (age < 140) this.gt.fillStyle(0xffffff, 0.85 * (1 - age / 140)).fillCircle(l.x, l.y - r * 0.2, r * 1.3);
    // 火の玉: ふくらんで上へ昇りながら暗くなる
    if (age < 650) {
      const tt = age / 650;
      const fy = l.y - r * 0.3 - tt * r * 0.8;
      // いくつもの火の塊がもくもくと広がる（丸 1 つの板に見えないように）
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + l.seed * 4;
        const d = r * (0.25 + 0.55 * tt);
        const px = l.x + Math.cos(a) * d;
        const py = fy + Math.sin(a) * d * 0.6 - tt * r * 0.3 * rnd(k, l.seed);
        this.ga.fillStyle(k % 2 ? 0xff3d00 : 0xff6d00, 0.6 * (1 - tt)).fillCircle(px, py, r * (0.42 + 0.35 * tt));
      }
      this.gt.fillStyle(0xffe0b2, 0.85 * (1 - tt) * (1 - tt)).fillCircle(l.x, fy + r * 0.1, r * (0.45 + 0.35 * tt));
    }
    // 煙: 火の玉の後に立ち昇る暗い煙
    if (age > 250 && age < 1700) {
      const tt = (age - 250) / 1450;
      for (let k = 0; k < 4; k++) {
        const ox = (rnd(k, l.seed) - 0.5) * r * 1.2;
        this.gn.fillStyle(0x2b2526, 0.4 * (1 - tt)).fillCircle(l.x + ox, l.y - r * 0.5 - tt * r * (1.4 + k * 0.3), r * (0.45 + 0.5 * tt));
      }
    }
    // 衝撃の輪
    if (age < 450) {
      const tt = age / 450;
      const rr = r * (1 + 1.8 * tt);
      this.ga.lineStyle(14 * (1 - tt), 0xffab40, 0.85 * (1 - tt)).strokeEllipse(l.x, l.y, rr * 2, rr * 0.9);
      this.gt.lineStyle(4 * (1 - tt), 0xfff3e0, 0.9 * (1 - tt)).strokeEllipse(l.x, l.y, rr * 2, rr * 0.9);
    }
    // 飛び散る岩のかけらと火の粉（放物線）
    if (age < 750) {
      const tt = age / 750;
      for (let k = 0; k < 10; k++) {
        const a = rnd(l.seed, k) * Math.PI * 2;
        const sp = r * (1.0 + rnd(k, l.seed) * 1.5);
        const px = l.x + Math.cos(a) * sp * tt;
        const py = l.y + Math.sin(a) * sp * tt * 0.45 - (r * 1.6 * tt - r * 2.2 * tt * tt);
        if (k % 3 === 0) this.gt.fillStyle(0xffcc80, 1 - tt).fillRect(px - 3.5, py - 3.5, 7, 7);
        else {
          this.gn.fillStyle(0x3e2c24, 1 - tt * 0.6).fillRect(px - 5.5, py - 5.5, 11, 11);
          this.gn.fillStyle(0xe65100, 1 - tt).fillRect(px - 5.5, py - 5.5, 11, 4);
        }
      }
    }
  }

  /**
   * しんそくの予告（07 の292章）: 駆け抜ける道の両側に白い縁が出て、道の上を進む向きへ「く」の字の印が流れる。
   * 出る所（レックウザの前）に風が渦を巻いて縮む
   */
  private drawSpeedAim(hz: Hz, p: number, timeMs: number): void {
    const len = hz.length;
    const x1 = hz.x + hz.dirX * len;
    const y1 = hz.y + hz.dirY * len;
    const nx = -hz.dirY;
    const ny = hz.dirX;
    const w = hz.radius;
    this.gf.lineStyle(w * 2, 0xffffff, 0.05 + 0.12 * p).lineBetween(hz.x, hz.y, x1, y1);
    for (const sgn of [1, -1]) {
      this.gt.lineStyle(3, 0xe0f7fa, 0.35 + 0.5 * p).lineBetween(hz.x + nx * w * sgn, hz.y + ny * w * sgn, x1 + nx * w * sgn, y1 + ny * w * sgn);
    }
    // 流れる「く」の字（速さの印）
    const step = 150;
    const off = (timeMs * 1.4) % step;
    for (let d = off; d < len; d += step) {
      const cx = hz.x + hz.dirX * d;
      const cy = hz.y + hz.dirY * d;
      const bx = cx - hz.dirX * w * 0.8;
      const by = cy - hz.dirY * w * 0.8;
      this.gt.lineStyle(6, 0xb9f6ca, 0.25 + 0.55 * p).lineBetween(bx + nx * w * 0.7, by + ny * w * 0.7, cx, cy).lineBetween(cx, cy, bx - nx * w * 0.7, by - ny * w * 0.7);
    }
    // 出る所の、縮んでいく風の輪
    const rr = w * (2.4 - 1.6 * p);
    this.ga.lineStyle(6, 0x69f0ae, 0.3 + 0.5 * p).strokeEllipse(hz.x, hz.y, rr * 2, rr);
  }

  /**
   * しんそく（07 の292章）: 体の後ろに、細って消える白と緑の光の尾。前に押しのけられた空気の白い「く」の字、
   * 道の両側へ並行に流れる速さの線と、巻き上がる砂ぼこり
   */
  private drawSpeedStreak(world: World, hz: Hz, timeMs: number): void {
    const i = findEnemyIndex(world, hz.dasher);
    if (i < 0) return;
    const bx = world.enemies.x[i]!;
    const by = world.enemies.y[i]!;
    const dx = hz.dirX;
    const dy = hz.dirY;
    const nx = -dy;
    const ny = dx;
    const w = hz.radius;
    const run = Math.max(0, (bx - hz.x) * dx + (by - hz.y) * dy);
    const L = Math.min(run, 900);
    // 光の尾: 体の後ろ L まで、先が太く後ろが細い（三角を重ねる）
    const tail = (g: Phaser.GameObjects.Graphics, c: number, al: number, ww: number, l: number): void => {
      if (l <= 0) return;
      g.fillStyle(c, al).fillTriangle(bx + nx * ww, by + ny * ww, bx - nx * ww, by - ny * ww, bx - dx * l, by - dy * l);
    };
    tail(this.ga, 0x00c853, 0.4, w * 1.6, L);
    tail(this.ga, 0x00e676, 0.6, w * 1.05, L * 0.75);
    tail(this.gt, 0xe8f5e9, 0.85, w * 0.55, L * 0.55);
    // 走った道の地面の擦れ跡（薄く）
    this.gf.lineStyle(w * 1.4, 0x000000, 0.18).lineBetween(hz.x, hz.y, bx, by);
    // 前の空気の壁（白い「く」の字）
    const fx = bx + dx * w * 1.2;
    const fy = by + dy * w * 1.2;
    for (let j = 0; j < 2; j++) {
      const back = j * 34;
      const sw = w * (1.7 + j * 0.5);
      const cx = fx - dx * back;
      const cy = fy - dy * back;
      this.gt.lineStyle(7 - j * 2, 0xffffff, 0.9 - j * 0.3)
        .lineBetween(cx, cy, cx - dx * sw + nx * sw, cy - dy * sw + ny * sw)
        .lineBetween(cx, cy, cx - dx * sw - nx * sw, cy - dy * sw - ny * sw);
    }
    // 速さの線: 道の両側に、後ろへ流れる細い線
    for (let k = 0; k < 14; k++) {
      const side = (rnd(k, 3) - 0.5) * 2 * w * 2.6;
      const t = ((timeMs / 160 + rnd(k, 9)) % 1 + 1) % 1;
      const d = t * Math.min(L, 700);
      const sx = bx - dx * d + nx * side;
      const sy = by - dy * d + ny * side;
      const ll = 70 + 90 * rnd(9, k);
      this.gt.lineStyle(3, k % 3 ? 0xffffff : 0xb9f6ca, 0.75 * (1 - t)).lineBetween(sx, sy, sx - dx * ll, sy - dy * ll);
    }
    // 巻き上がる砂ぼこり（体の少し後ろの両脇）
    for (let k = 0; k < 8; k++) {
      const t = ((timeMs / 300 + k / 8) % 1 + 1) % 1;
      const sgn = k % 2 ? 1 : -1;
      const d = 40 + t * 220;
      const out = w * (0.9 + t * 1.6);
      this.gn.fillStyle(0x8d8173, 0.45 * (1 - t)).fillCircle(bx - dx * d + nx * out * sgn, by - dy * d + ny * out * sgn - t * 20, 10 + 22 * t);
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

  /**
   * ぼうふう（07 の292章）: 進む大きな竜巻。下は細く上へ広がる半透明の風の体に、斜めに巻く白い帯と回る風の輪。
   * 足もとで土ぼこりが渦を巻いて広がり、砂・小石・石板のかけら・草が巻き上げられて回る
   */
  private drawVortex(hz: Hz, timeMs: number): void {
    const r = hz.radius;
    const H = r * 2.8;
    this.gf.fillStyle(0x000000, 0.28).fillEllipse(hz.x, hz.y, r * 2.2, r * 0.9);
    this.gf.lineStyle(6, 0xe0f2f1, 0.35).strokeEllipse(hz.x, hz.y, r * 2.2, r * 0.9);
    // 足もとの土ぼこり（渦を巻いて外へ）
    for (let k = 0; k < 12; k++) {
      const t = ((timeMs / 700 + k / 12) % 1 + 1) % 1;
      const a = timeMs / 160 + k * 0.52;
      const d = r * (0.5 + 0.9 * t);
      this.gn.fillStyle(0xa1978a, 0.5 * (1 - t)).fillCircle(hz.x + Math.cos(a) * d, hz.y + Math.sin(a) * d * 0.42 - t * 16, r * (0.22 + 0.28 * t));
    }
    // 風の体（左右の縁がうねる、半透明の漏斗）
    const left: Phaser.Math.Vector2[] = [];
    const right: Phaser.Math.Vector2[] = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      const cy = hz.y - t * H;
      const rw = r * (0.35 + 0.95 * t);
      const sway = Math.sin(timeMs / 300 + t * 3) * r * 0.18 * t;
      left.push(new Phaser.Math.Vector2(hz.x + sway - rw, cy));
      right.push(new Phaser.Math.Vector2(hz.x + sway + rw, cy));
    }
    this.gn.fillStyle(0xcfd8dc, 0.3).fillPoints([...left, ...right.reverse()], true);
    // 斜めに巻く白い帯（体の手前を上へ巻き上がる）
    for (let b = 0; b < 4; b++) {
      const pts: Phaser.Math.Vector2[] = [];
      for (let k = 0; k <= 14; k++) {
        const t = k / 14;
        const cy = hz.y - t * H;
        const rw = r * (0.35 + 0.95 * t);
        const sway = Math.sin(timeMs / 300 + t * 3) * r * 0.18 * t;
        const aa = timeMs / 140 + b * (Math.PI / 2) + t * 4.2;
        if (Math.sin(aa) < 0) {
          if (pts.length > 1) this.gt.lineStyle(4, 0xffffff, 0.55).strokePoints(pts);
          pts.length = 0;
          continue;
        }
        pts.push(new Phaser.Math.Vector2(hz.x + sway + Math.cos(aa) * rw, cy + Math.sin(aa) * rw * 0.25));
      }
      if (pts.length > 1) this.gt.lineStyle(4, 0xffffff, 0.55).strokePoints(pts);
    }
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
    // 巻き上げられた砂・小石・石板のかけら（回りながら昇る。手前を回る物は大きく）・草
    for (let k = 0; k < 18; k++) {
      const t = ((timeMs / 900 + rnd(k, 5)) % 1 + 1) % 1;
      const a = timeMs / 150 + k * 1.3;
      const rw = r * (0.35 + 0.95 * t);
      const front = Math.sin(a) > 0;
      const x = hz.x + Math.cos(a) * rw;
      const y = hz.y - t * H + Math.sin(a) * rw * 0.25;
      const g = front ? this.gt : this.gn;
      if (k % 6 === 0) {
        // 石板のかけら（回る平たい板）
        const s = 14 + 6 * rnd(k, 1);
        const sp = Math.cos(timeMs / 90 + k);
        g.fillStyle(0x3d4448, 1).fillRect(x - s / 2, y - (s * Math.abs(sp)) / 4, s, Math.max(2, (s * Math.abs(sp)) / 2));
        g.fillStyle(0x5f686d, 1).fillRect(x - s / 2, y - (s * Math.abs(sp)) / 4, s, 2);
      } else if (k % 6 === 3) {
        g.fillStyle(0x4f7a3a, 0.95).fillTriangle(x - 7, y, x + 7, y - 3, x, y + 5);
      } else {
        const s = front ? 9 : 6;
        g.fillStyle(k % 2 ? 0x8d8173 : 0xbdb3a4, 0.9).fillRect(x - s / 2, y - s / 2, s, s);
      }
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

  /**
   * はかいこうせん（07 の292章）: 橙の外側と白い芯の太い光線。光線のまわりを先へ流れる光の輪と粒、
   * 口元の光の放射、なぎ払った床に残る焦げ跡、マップの端に当たる所の爆発
   */
  private drawBeam(world: World, hz: Hz, timeMs: number): void {
    const dx = hz.dirX;
    const dy = hz.dirY;
    // 光線がマップの端へ届く所（その先は壁の絵の下）
    let len = hz.length;
    const ar = world.arena;
    if (ar) {
      const tx = dx > 0 ? (ar.x + ar.halfWidth - hz.x) / dx : dx < 0 ? (ar.x - ar.halfWidth - hz.x) / dx : Infinity;
      const ty = dy > 0 ? (ar.y + ar.halfHeight - hz.y) / dy : dy < 0 ? (ar.y - ar.halfHeight - hz.y) / dy : Infinity;
      len = Math.max(0, Math.min(len, tx, ty));
    }
    const x1 = hz.x + dx * len;
    const y1 = hz.y + dy * len;
    const nx = -dy;
    const ny = dx;
    const w = hz.radius * 2;
    const flick = 1 + 0.08 * Math.sin(timeMs / 40);
    // なぎ払った床の焦げ跡（光線の下）
    this.gf.lineStyle(w * 0.9, 0x120a06, 0.35).lineBetween(hz.x, hz.y, x1, y1);
    this.ga.lineStyle(w * 1.8 * flick, 0xff6f00, 0.4).lineBetween(hz.x, hz.y, x1, y1);
    this.ga.lineStyle(w * flick, 0xffb300, 0.85).lineBetween(hz.x, hz.y, x1, y1);
    this.gt.lineStyle(w * 0.4, 0xfffde7, 0.95).lineBetween(hz.x, hz.y, x1, y1);
    // 光線のまわりを先へ流れる光の輪（光線に垂直な平たい輪）
    for (let d = (timeMs * 1.6) % 160; d < len; d += 160) {
      const cx = hz.x + dx * d;
      const cy = hz.y + dy * d;
      const rr = w * (0.95 + 0.15 * Math.sin(d / 50));
      this.gt.lineStyle(4, 0xfff3e0, 0.7).lineBetween(cx + nx * rr, cy + ny * rr, cx + nx * rr * 0.6 + dx * 18, cy + ny * rr * 0.6 + dy * 18);
      this.gt.lineStyle(4, 0xfff3e0, 0.7).lineBetween(cx - nx * rr, cy - ny * rr, cx - nx * rr * 0.6 + dx * 18, cy - ny * rr * 0.6 + dy * 18);
    }
    // 光線の縁からこぼれる粒
    for (let k = 0; k < 16; k++) {
      const t = ((timeMs / 500 + rnd(k, 11)) % 1 + 1) % 1;
      const d = rnd(11, k) * len;
      const side = (k % 2 ? 1 : -1) * w * (0.7 + t * 0.9);
      const s = 8 * (1 - t) + 3;
      this.gt.fillStyle(0xffe082, 1 - t).fillRect(hz.x + dx * (d + t * 60) + nx * side - s / 2, hz.y + dy * (d + t * 60) + ny * side - s / 2, s, s);
    }
    // 口元の光（放射状の光の筋）
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + timeMs / 200;
      const l = w * (1.6 + 0.6 * rnd(Math.floor(timeMs / 60), k));
      const sw = 0.16;
      this.ga.fillStyle(0xffcc80, 0.55).fillTriangle(
        hz.x + Math.cos(a - sw) * w * 0.7, hz.y + Math.sin(a - sw) * w * 0.7,
        hz.x + Math.cos(a + sw) * w * 0.7, hz.y + Math.sin(a + sw) * w * 0.7,
        hz.x + Math.cos(a) * l, hz.y + Math.sin(a) * l,
      );
    }
    this.ga.fillStyle(0xffb300, 0.6).fillCircle(hz.x, hz.y, w * 1.25 * flick);
    this.gt.fillStyle(0xffffff, 0.9).fillCircle(hz.x, hz.y, w * 0.85);
    // マップの端に当たる所: もくもくふくらむ光の塊と、飛び散る火花
    if (len < hz.length) {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + timeMs / 260;
        const d = w * (0.5 + 0.3 * Math.sin(timeMs / 90 + k * 2));
        this.ga.fillStyle(k % 2 ? 0xff6f00 : 0xff3d00, 0.45).fillCircle(x1 + Math.cos(a) * d, y1 + Math.sin(a) * d, w * (0.9 + 0.25 * rnd(Math.floor(timeMs / 70), k)));
      }
      this.ga.fillStyle(0xffb300, 0.6).fillCircle(x1, y1, w * 1.1 * flick);
      this.gt.fillStyle(0xfff8e1, 0.9).fillCircle(x1, y1, w * 0.6 * flick);
      for (let k = 0; k < 12; k++) {
        const t = ((timeMs / 380 + rnd(k, 13)) % 1 + 1) % 1;
        const a = Math.atan2(-dy, -dx) + (rnd(13, k) - 0.5) * 2.6;
        const d = w * (0.6 + 2.6 * t);
        const s = 10 * (1 - t) + 3;
        this.gt.fillStyle(k % 3 ? 0xffcc80 : 0xffffff, 1 - t).fillRect(x1 + Math.cos(a) * d - s / 2, y1 + Math.sin(a) * d - s / 2 + 60 * t * t, s, s);
      }
    }
  }
}
