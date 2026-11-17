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
