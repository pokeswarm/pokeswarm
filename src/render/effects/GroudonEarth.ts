import Phaser from 'phaser';
import type { World } from '../../sim/world';

function rnd(a: number, b: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

type Hz = World['hazards'][number];

/** 消えた後もしばらく描く物（岩の刃が崩れる・溶岩が冷える） */
interface Lingering {
  kind: 'blade' | 'splash';
  x: number;
  y: number;
  r: number;
  dirX: number;
  dirY: number;
  seed: number;
  startMs: number;
  /** 当たり判定が消えた時刻（0 はまだある） */
  goneMs: number;
}

const BLADE_LINGER_MS = 900;
const SPLASH_LINGER_MS = 1600;

/**
 * グラードンの技の絵（07 の283章）: だんがいのつるぎの裂ける割れ目と突き上がる岩の刃・ふんかの打ち上がって落ちる溶岩と飛び散り・
 * ソーラービームの集まる日の光・ゲンシカイキの体の溶岩の筋と放射状の割れ目。見た目だけ（当たりはシミュレーション）
 */
export class GroudonEarth {
  /** 地面（割れ目・影・溶岩だまり） */
  private readonly gf: Phaser.GameObjects.Graphics;
  /** 岩の刃・溶岩の塊（ふつうの重ね方） */
  private readonly gn: Phaser.GameObjects.Graphics;
  /** 光（加算） */
  private readonly ga: Phaser.GameObjects.Graphics;
  /** ボスより手前（溜めの光・ゲンシカイキの体の光） */
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
    const groudon = this.groudon(world);
    const seen = new Set<string>();
    // だんがいのつるぎは、1 回の技の割れ目を 1 本の線で描く（組ごとに集める）
    const cracks = new Map<number, Hz[]>();
    for (const hz of world.hazards) {
      const id = moves[hz.move]?.id ?? '';
      if (!id.startsWith('groudon-')) continue;
      const p = hz.activeTicks === undefined ? 1 - hz.ticksLeft / Math.max(1, hz.totalTicks) : 1;
      const key = `${hz.group ?? 0}:${Math.round(hz.x)}:${Math.round(hz.y)}`;
      if (id.startsWith('groudon-precipice-blades')) {
        const list = cracks.get(hz.group ?? 0) ?? [];
        list.push(hz);
        cracks.set(hz.group ?? 0, list);
        if (hz.activeTicks !== undefined) {
          seen.add(key);
          if (!this.lingering.has(key)) this.lingering.set(key, { kind: 'blade', x: hz.x, y: hz.y, r: hz.radius, dirX: hz.dirX, dirY: hz.dirY, seed: rnd(hz.x, hz.y), startMs: timeMs, goneMs: 0 });
        }
      } else if (id.startsWith('groudon-eruption')) {
        if (hz.activeTicks === undefined) this.drawLavaFlight(hz, groudon, p, timeMs);
        else {
          seen.add(key);
          if (!this.lingering.has(key)) this.lingering.set(key, { kind: 'splash', x: hz.x, y: hz.y, r: hz.radius, dirX: 0, dirY: 1, seed: rnd(hz.x, hz.y), startMs: timeMs, goneMs: 0 });
        }
      } else if (id.startsWith('groudon-solar-beam') && hz.activeTicks === undefined && groudon) {
        this.drawSunGather(groudon, p, timeMs, id.endsWith('-sun'));
      } else if (id === 'groudon-primal-reversion' && groudon) {
        this.drawReversion(groudon, p, timeMs);
      }
    }
    for (const list of cracks.values()) this.drawCrack(list, groudon, timeMs);
    // 消えた刃・溶岩も、しばらく崩れる・冷えるまで描く
    for (const [key, l] of this.lingering) {
      if (!seen.has(key) && l.goneMs === 0) l.goneMs = timeMs;
      const limit = l.kind === 'blade' ? BLADE_LINGER_MS : SPLASH_LINGER_MS;
      if (l.goneMs > 0 && timeMs - l.goneMs > limit) {
        this.lingering.delete(key);
        continue;
      }
      if (l.kind === 'blade') this.drawBlade(l, timeMs);
      else this.drawSplash(l, timeMs);
    }
    if (!world.legendary) this.lingering.clear();
  }

  /** グラードン（ゲンシの姿も同じ敵）の足元の位置と体の大きさ */
  private groudon(world: World): { x: number; y: number; r: number } | null {
    const e = world.enemies;
    for (let i = 0; i < e.count; i++) {
      if (e.hp[i]! <= 0) continue;
      if (world.rules.enemies.kinds[e.kind[i]!]?.id === 'legend-groudon') return { x: e.x[i]!, y: e.y[i]!, r: e.radius[i]! };
    }
    return null;
  }

  /**
   * だんがいのつるぎの割れ目: グラードンの足元から、刃の並ぶ所を通って 1 本の割れ目が伸びる（予告の間に先へ伸び、奥が赤く光る）。
   * 刃が出た所から先は、割れ目の奥の光が強い
   */
  private drawCrack(list: Hz[], groudon: { x: number; y: number; r: number } | null, timeMs: number): void {
    // グラードンに近い順
    const ox = groudon?.x ?? list[0]!.x;
    const oy = groudon?.y ?? list[0]!.y;
    const sorted = [...list].sort((a, b) => Math.hypot(a.x - ox, a.y - oy) - Math.hypot(b.x - ox, b.y - oy));
    // 2 本同時（ゲンシカイキ）は向きで分ける: 隣り合う点が離れすぎたら別の線
    const lines: Hz[][] = [];
    for (const h of sorted) {
      const line = lines.find((l) => Math.hypot(l[l.length - 1]!.x - h.x, l[l.length - 1]!.y - h.y) < h.radius * 2.2);
      if (line) line.push(h);
      else lines.push([h]);
    }
    for (const line of lines) {
      const first = line[0]!;
      const p = first.activeTicks === undefined ? 1 - first.ticksLeft / Math.max(1, first.totalTicks) : 1;
      // 割れ目の折れ線（グラードンの足元から）。ぎざぎざは場所から決める（どのフレームでも同じ形）
      const pts: [number, number][] = [[ox, oy]];
      for (const h of line) pts.push([h.x, h.y]);
      const last = line[line.length - 1]!;
      pts.push([last.x + last.dirX * last.radius, last.y + last.dirY * last.radius]);
      const jag: [number, number][] = [];
      for (let k = 0; k < pts.length - 1; k++) {
        const [x0, y0] = pts[k]!;
        const [x1, y1] = pts[k + 1]!;
        const len = Math.hypot(x1 - x0, y1 - y0) || 1;
        const nx = -(y1 - y0) / len;
        const ny = (x1 - x0) / len;
        const steps = Math.max(2, Math.round(len / 14));
        for (let s = 0; s < steps; s++) {
          const t = s / steps;
          const off = (rnd(Math.round(x0 + x1), k * 31 + s) - 0.5) * 16;
          jag.push([x0 + (x1 - x0) * t + nx * off, y0 + (y1 - y0) * t + ny * off]);
        }
      }
      jag.push(pts[pts.length - 1]!);
      // 予告の間に先へ伸びる（予告の 7 割で端まで）
      const reach = Math.min(1, p / 0.7);
      const n = Math.max(2, Math.ceil(jag.length * reach));
      const glow = 0.35 + 0.65 * p;
      // 当たる幅の帯（予告の間だけ。赤い丸の代わり）
      if (first.activeTicks === undefined) this.strokePath(this.gf, jag, n, first.radius * 2, 0xff1744, 0.1 + 0.12 * p);
      // 外側の暗い割れ目 → 奥の赤 → 芯の橙
      this.strokePath(this.gf, jag, n, 13, 0x1a0f0a, 0.85);
      this.strokePath(this.gf, jag, n, 7, 0x8e1b10, 0.9 * glow);
      this.strokePath(this.ga, jag, n, 3, 0xff6d00, 0.9 * glow);
      // 割れ目から立ちのぼる熱の粒
      for (let k = 0; k < n; k += 3) {
        const [x, y] = jag[k]!;
        const t = ((timeMs / 700 + rnd(x, y)) % 1 + 1) % 1;
        this.ga.fillStyle(0xffab40, 0.5 * (1 - t) * glow).fillCircle(x + (rnd(y, x) - 0.5) * 6, y - t * 26, 2.2);
      }
    }
  }

  private strokePath(g: Phaser.GameObjects.Graphics, pts: [number, number][], n: number, width: number, color: number, alpha: number): void {
    g.lineStyle(width, color, alpha);
    g.beginPath();
    g.moveTo(pts[0]![0], pts[0]![1]);
    for (let k = 1; k < n; k++) g.lineTo(pts[k]![0], pts[k]![1]);
    g.strokePath();
  }

  /**
   * だんがいのつるぎの刃: 割れ目から、赤く焼けた岩の刃が 3 本、外へ開いて一気に突き上がる（0.12 秒）。
   * 刃は光の当たる面と影の面に分かれ、ふちは溶岩の熱で赤く光る。根元は溶岩が噴き、岩のかけらが飛ぶ。当たり判定が消えた後は沈む
   */
  private drawBlade(l: Lingering, timeMs: number): void {
    const age = timeMs - l.startMs;
    const rise = 1 - Math.pow(1 - Math.min(1, age / 140), 3);
    const sink = l.goneMs > 0 ? Math.min(1, (timeMs - l.goneMs) / BLADE_LINGER_MS) : 0;
    const alpha = 1 - sink * 0.5;
    const bx = l.x;
    const by = l.y + l.r * 0.3;
    const heat = 1 - sink;
    // 根元: 溶岩が噴いて光る
    this.gf.fillStyle(0x1a0f0a, 0.7 * alpha).fillEllipse(bx, by, l.r * 2.6, l.r * 0.9);
    this.ga.fillStyle(0xff3d00, 0.55 * heat).fillEllipse(bx, by, l.r * 2.0, l.r * 0.6);
    this.ga.fillStyle(0xffab40, 0.45 * heat).fillEllipse(bx, by, l.r * 1.0, l.r * 0.3);
    // 3 本の刃（真ん中が一番高い。左右は外へ傾く）
    const shards = [
      { off: -0.55, w: 0.45, h: 2.3, lean: -0.45 },
      { off: 0.55, w: 0.42, h: 2.0, lean: 0.4 },
      { off: 0, w: 0.62, h: 3.6 + l.seed * 0.8, lean: (l.seed - 0.5) * 0.2 },
    ];
    for (const sh of shards) {
      const h = l.r * sh.h * rise * (1 - sink * 0.9);
      if (h < 3) continue;
      const w = l.r * sh.w;
      const x0 = bx + l.r * sh.off;
      const tipX = x0 + sh.lean * h;
      const tipY = by - h;
      const left = new Phaser.Math.Vector2(x0 - w, by);
      const right = new Phaser.Math.Vector2(x0 + w, by);
      const mid = new Phaser.Math.Vector2(x0 + w * 0.15 + sh.lean * h * 0.05, by);
      const tip = new Phaser.Math.Vector2(tipX, tipY);
      // 肩の折れ（刃らしいぎざぎざ）
      const sl = new Phaser.Math.Vector2(x0 - w * 0.75 + sh.lean * h * 0.45, by - h * 0.45);
      const sr = new Phaser.Math.Vector2(x0 + w * 0.6 + sh.lean * h * 0.5, by - h * 0.55);
      this.gn.fillStyle(0x9c4a33, alpha).fillPoints([left, sl, tip, mid], true);
      this.gn.fillStyle(0x4a1c14, alpha).fillPoints([mid, tip, sr, right], true);
      // 面の境目の暗い線と、光の当たる面の明るい筋
      this.gn.lineStyle(2, 0x2b0f0a, 0.8 * alpha).lineBetween(mid.x, mid.y, tip.x, tip.y);
      this.gn.lineStyle(2, 0xd7835f, 0.7 * alpha).lineBetween(left.x + w * 0.25, by - 4, (sl.x + tip.x) / 2, (sl.y + tip.y) / 2);
      // ふちが熱で赤く光る（下ほど強い）
      this.ga.lineStyle(3, 0xff3d00, 0.75 * heat).beginPath().moveTo(left.x, left.y).lineTo(sl.x, sl.y).lineTo(tip.x, tip.y).lineTo(sr.x, sr.y).lineTo(right.x, right.y).strokePath();
      this.ga.lineStyle(1.5, 0xffd180, 0.6 * heat).beginPath().moveTo(left.x, left.y).lineTo(sl.x, sl.y).strokePath();
      this.ga.fillStyle(0xffab40, 0.6 * heat).fillCircle(tip.x, tip.y, 3);
    }
    // 突き上がった瞬間の岩のかけらと火の粉
    if (age < 600) {
      const t = age / 600;
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (rnd(l.seed, k + 9) - 0.5) * 2.4;
        const sp = l.r * (1.4 + rnd(k, l.seed) * 1.8);
        const x = bx + Math.cos(a) * sp * t;
        const y = by + Math.sin(a) * sp * t + 260 * t * t;
        if (k % 3 === 0) this.ga.fillStyle(0xffab40, 1 - t).fillCircle(x, y, 2.5);
        else this.gn.fillStyle(k % 2 ? 0x4a1c14 : 0x9c4a33, 1 - t).fillRect(x - 3.5, y - 3.5, 7, 7);
      }
    }
    // 熱でゆらめく煙（残っている間）
    for (let k = 0; k < 3; k++) {
      const t = ((timeMs / 900 + k / 3 + l.seed) % 1 + 1) % 1;
      this.gf.fillStyle(0x3e2723, 0.18 * (1 - t) * alpha).fillCircle(bx + (k - 1) * l.r * 0.6, by - l.r * 0.3 - t * l.r * 2.2, l.r * (0.35 + t * 0.4));
    }
  }

  /**
   * ふんかの溶岩の塊: グラードンの背中から打ち上がり、放物線を描いて落ちる場所へ向かう（予告の終わりに着く）。
   * 落ちる所の地面には影が広がる
   */
  private drawLavaFlight(hz: Hz, groudon: { x: number; y: number; r: number } | null, p: number, timeMs: number): void {
    // 着く所の影（だんだん濃く大きく）
    this.gf.fillStyle(0x000000, 0.12 + 0.3 * p).fillEllipse(hz.x, hz.y, hz.radius * 1.6 * (0.5 + 0.5 * p), hz.radius * 0.7 * (0.5 + 0.5 * p));
    if (!groudon) return;
    const sx = groudon.x;
    const sy = groudon.y - groudon.r * 1.6;
    const t = p;
    const x = sx + (hz.x - sx) * t;
    const peak = 170 + rnd(hz.x, hz.y) * 90;
    const y = sy + (hz.y - sy) * t - peak * 4 * t * (1 - t);
    // 尾（少し前の位置を結ぶ）
    for (let k = 1; k <= 5; k++) {
      const tt = Math.max(0, t - k * 0.025);
      const xx = sx + (hz.x - sx) * tt;
      const yy = sy + (hz.y - sy) * tt - peak * 4 * tt * (1 - tt);
      this.ga.fillStyle(k < 3 ? 0xffab40 : 0xff3d00, 0.5 - k * 0.08).fillCircle(xx, yy, 9 - k);
    }
    const rr = 19 + rnd(hz.y, hz.x) * 7;
    this.gn.fillStyle(0x2b1b17, 1).fillCircle(x, y, rr);
    this.ga.fillStyle(0xff6d00, 0.85).fillCircle(x - rr * 0.2, y - rr * 0.15, rr * 0.55);
    this.ga.fillStyle(0xffe082, 0.8).fillCircle(x - rr * 0.25, y - rr * 0.25, rr * 0.25);
    // 揺らめく光
    this.ga.fillStyle(0xff3d00, 0.18 + 0.08 * Math.sin(timeMs / 60)).fillCircle(x, y, rr * 1.9);
  }

  /** ふんかの着いた所: 溶岩が飛び散り、溶岩だまりがしばらく赤く光ってから冷えて黒くなる */
  private drawSplash(l: Lingering, timeMs: number): void {
    const age = timeMs - l.startMs;
    const cool = Math.min(1, age / (SPLASH_LINGER_MS + 400));
    const r = l.r;
    // 溶岩だまり
    this.gf.fillStyle(0x1b1210, 0.75 * (1 - cool * 0.5)).fillEllipse(l.x, l.y, r * 1.9, r * 1.0);
    this.ga.fillStyle(0xff3d00, 0.7 * (1 - cool)).fillEllipse(l.x, l.y, r * 1.5, r * 0.75);
    this.ga.fillStyle(0xffab40, 0.6 * (1 - cool) ** 2).fillEllipse(l.x, l.y, r * 0.8, r * 0.4);
    // 飛び散るしずく（最初の 0.5 秒）
    if (age < 500) {
      const t = age / 500;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2 + l.seed * 3;
        const d = r * (0.6 + rnd(k, l.seed) * 0.9) * t;
        const up = -r * 1.3 * t * (1 - t) * (0.6 + rnd(l.seed, k));
        const x = l.x + Math.cos(a) * d;
        const y = l.y + Math.sin(a) * d * 0.5 + up;
        this.ga.fillStyle(k % 3 ? 0xff6d00 : 0xffd54f, 1 - t).fillCircle(x, y, 3.5 * (1 - t * 0.5));
      }
      // 着いた瞬間の光の輪
      this.ga.lineStyle(4, 0xffab40, 0.8 * (1 - t)).strokeEllipse(l.x, l.y, r * 2.2 * t + r, (r * 2.2 * t + r) * 0.5);
    }
  }

  /** ソーラービームの溜め: 日の光の粒がまわりから口元へ集まり、口元の光の玉が大きくなる（ひざしの間は集まるのが速い） */
  private drawSunGather(groudon: { x: number; y: number; r: number }, p: number, timeMs: number, sun: boolean): void {
    const mx = groudon.x + groudon.r * 0.3;
    const my = groudon.y - groudon.r * 1.5;
    const speed = sun ? 420 : 760;
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2 + rnd(k, 3) * 0.5;
      const t = ((timeMs / speed + rnd(k, 7)) % 1 + 1) % 1;
      const d = groudon.r * (4.6 - 4.0 * t);
      const px = mx + Math.cos(a) * d;
      const py = my + Math.sin(a) * d * 0.8;
      // 光の尾（口元へ向かう）と粒。草の上でも見えるよう、ふつうの重ね方で白と黄
      const al = 0.45 + 0.5 * t;
      this.gt.lineStyle(9, 0xfff176, 0.6 * al).lineBetween(px, py, px - (mx - px) * 0.4, py - (my - py) * 0.4);
      this.gt.fillStyle(0xfff59d, al).fillCircle(px, py, 13 + t * 5);
      this.gt.fillStyle(0xffffff, al).fillCircle(px, py, 7 + t * 3);
    }
    // 口元の光の玉（だんだん大きく）
    const rr = groudon.r * (0.25 + 0.55 * p);
    this.gt.fillStyle(0xffee58, 0.25 + 0.25 * p).fillCircle(mx, my, rr * 2);
    this.gt.fillStyle(0xfff59d, 0.85).fillCircle(mx, my, rr);
    this.gt.fillStyle(0xffffff, 0.95).fillCircle(mx, my, rr * 0.55);
  }

  /**
   * ゲンシカイキ: 地面に割れ目が放射状に走り、割れ目と体のまわりに溶岩の光が満ちていく。終わりの少し前に強く光って、姿が変わる
   */
  private drawReversion(groudon: { x: number; y: number; r: number }, p: number, timeMs: number): void {
    const { x, y, r } = groudon;
    // 放射状の割れ目
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + rnd(k, 1) * 0.4;
      const len = r * (3.6 + rnd(k, 2) * 2.4) * Math.min(1, p * 1.6);
      const pts: [number, number][] = [[x, y + r * 0.3]];
      const steps = 10;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const off = (rnd(k * 7, s) - 0.5) * 30 * (1 - t * 0.4);
        pts.push([x + Math.cos(a) * len * t - Math.sin(a) * off, y + r * 0.3 + (Math.sin(a) * len * t + Math.cos(a) * off) * 0.55]);
      }
      this.strokePath(this.gf, pts, pts.length, 16, 0x1a0f0a, 0.85);
      this.strokePath(this.gf, pts, pts.length, 9, 0xd84315, 0.5 + 0.5 * p);
      this.strokePath(this.gf, pts, pts.length, 4, 0xffd180, 0.3 + 0.7 * p);
    }
    // 体のまわりの熱（下から上へ流れる光の筋）
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const t = ((timeMs / 520 + rnd(k, 5)) % 1 + 1) % 1;
      const bx = x + Math.cos(a) * r * 1.1;
      const by = y + r * 0.2 - t * r * 3.2;
      this.gt.lineStyle(13, k % 2 ? 0xff6d00 : 0xffab40, 0.55 * p * (1 - t)).lineBetween(bx, by, bx, by - r * 0.9);
    }
    // 終わりに体が強く光る（一度だけ。明滅させない）
    const flash = p > 0.8 ? (p - 0.8) / 0.2 : 0;
    this.ga.fillStyle(0xff6d00, 0.3 * p + 0.3 * flash).fillEllipse(x, y - r * 1.1, r * 4, r * 4.4);
    this.gt.fillStyle(0xffab40, 0.12 * p + 0.45 * flash).fillEllipse(x, y - r * 1.1, r * 3, r * 3.4);
  }
}
