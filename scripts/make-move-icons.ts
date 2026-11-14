/**
 * 技のアイコンの絵を計算で描く（作者の案 2026年11月14日: 使い回しをやめ、大きく色数も増やす。07 の264章）。
 *   npm run move-icons                       data/render/move-icons.json を書き出す
 *   npm run move-icons -- --preview out.png  前の絵（白い絵柄）と新しい絵を並べた確認用の画像も書く
 *
 * 絵は 32 × 32。外側の 2 ドットは枠（タイプの技・派生技・固有技の色）なので、3〜28 の中に描く。背景はタイプの色の四角（描かない所）。
 * 図形（円・多角形・太い線・炎・葉）を塗り、最後に全体へ 1 ドットの暗い輪郭を付ける。光は左上から。
 * 公式の画像は使わない。技の名前ごとに 1 枚（同じ名前の技 nameOf は同じ絵）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { iconPixels, type IconTier } from '../src/render/iconPixels.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const N = 32;
const OUTLINE = '#140c1c';

type Pt = [number, number];
type Shape = (x: number, y: number) => boolean;
type Paint = string | ((x: number, y: number) => string | null);

// ---- 形 ----
const circle = (cx: number, cy: number, r: number): Shape => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const ellipse = (cx: number, cy: number, rx: number, ry: number, deg = 0): Shape => {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return (x, y) => {
    const u = (x - cx) * c + (y - cy) * s;
    const v = -(x - cx) * s + (y - cy) * c;
    return (u / rx) ** 2 + (v / ry) ** 2 <= 1;
  };
};
const poly = (pts: Pt[]): Shape => (x, y) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const union = (...s: Shape[]): Shape => (x, y) => s.some((f) => f(x, y));
/** 点を結ぶ太い線。r は線に沿った位置 t（0〜1）での太さ（半径） */
const stroke = (pts: Pt[], r: number | ((t: number) => number)): Shape => {
  const lens: number[] = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  const total = lens[lens.length - 1] || 1;
  const rad = typeof r === 'number' ? () => r : r;
  return (x, y) => {
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1]!;
      const [bx, by] = pts[i]!;
      const dx = bx - ax;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy || 1;
      const k = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
      const t = (lens[i - 1]! + k * (lens[i]! - lens[i - 1]!)) / total;
      if ((x - ax - k * dx) ** 2 + (y - ay - k * dy) ** 2 <= rad(t) ** 2) return true;
    }
    return false;
  };
};
/** 3 次ベジェ曲線の点 */
function bez(p0: Pt, p1: Pt, p2: Pt, p3: Pt, steps = 24): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const m = 1 - t;
    out.push([m ** 3 * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t ** 3 * p3[0], m ** 3 * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t ** 3 * p3[1]]);
  }
  return out;
}
/** 星（とがった点が n 個） */
function star(cx: number, cy: number, ro: number, ri: number, n: number, rotDeg = -90): Shape {
  const pts: Pt[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = ((rotDeg + (i * 180) / n) * Math.PI) / 180;
    const r = i % 2 ? ri : ro;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return poly(pts);
}
/**
 * 炎の舌: 根元の丸（中心 cx, by − w・半径 w）から、高さ h の先へ細くなる。dir は伸びる向き（度。−90 が上）。
 * wob はゆらぎの大きさ
 */
function flame(cx: number, cy: number, w: number, h: number, dirDeg = -90, wob = 0.25, phase = 0): Shape {
  const a = (dirDeg * Math.PI) / 180;
  const fx = Math.cos(a);
  const fy = Math.sin(a);
  return (x, y) => {
    // 伸びる向きを v、横を u にとる
    const dx = x - cx;
    const dy = y - cy;
    const v = dx * fx + dy * fy;
    const u = -dx * fy + dy * fx;
    if (v < 0) return u * u + v * v <= w * w;
    const t = v / h;
    if (t > 1) return false;
    const center = Math.sin(t * Math.PI * 1.6 + phase) * w * wob * t;
    const half = w * Math.pow(1 - t, 1.1) * (1 + 0.25 * Math.sin(t * Math.PI));
    return Math.abs(u - center) <= half;
  };
}
/** 葉（2 つの円の重なり。長さ len・幅 wid・向き deg） */
function leaf(cx: number, cy: number, len: number, wid: number, deg: number): Shape {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // 中心を通る長さ len、幅 wid のレンズ: 半径 R の円 2 つ
  const R = ((len / 2) ** 2 + (wid / 2) ** 2) / wid;
  const off = R - wid / 2;
  return (x, y) => {
    const u = (x - cx) * c + (y - cy) * s;
    const v = -(x - cx) * s + (y - cy) * c;
    return u * u + (v - off) ** 2 <= R * R && u * u + (v + off) ** 2 <= R * R;
  };
}

// ---- 絵 ----
class Pic {
  px: (string | null)[] = Array(N * N).fill(null);
  get(x: number, y: number): string | null {
    return x < 0 || y < 0 || x >= N || y >= N ? null : this.px[y * N + x]!;
  }
  /** 形の中を塗る（ピクセルの中心で決める） */
  fill(shape: Shape, paint: Paint): this {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const cx = x + 0.5;
        const cy = y + 0.5;
        if (!shape(cx, cy)) continue;
        const c = typeof paint === 'string' ? paint : paint(cx, cy);
        if (c) this.px[y * N + x] = c;
      }
    }
    return this;
  }
  /** 光が左上から当たる立体の塗り: 光の側のふちは hi、反対のふちは lo、中は mid */
  bevel(shape: Shape, hi: string, mid: string, lo: string, d = 1.5, lx = -0.7, ly = -0.7): this {
    return this.fill(shape, (x, y) => (!shape(x + lx * d, y + ly * d) ? hi : !shape(x - lx * d, y - ly * d) ? lo : mid));
  }
  /** 球の塗り（光は左上） */
  ball(cx: number, cy: number, r: number, cols: string[]): this {
    return this.fill(circle(cx, cy, r), (x, y) => {
      const nx = (x - cx) / r;
      const ny = (y - cy) / r;
      const l = -0.6 * nx - 0.7 * ny + 0.35 * Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const k = Math.max(0, Math.min(cols.length - 1, Math.floor(((l + 0.6) / 1.6) * cols.length)));
      return cols[k]!;
    });
  }
  dot(x: number, y: number, c: string): this {
    if (x >= 0 && y >= 0 && x < N && y < N) this.px[Math.floor(y) * N + Math.floor(x)] = c;
    return this;
  }
  /** 全体の外に 1 ドットの輪郭（4 方向） */
  outline(c = OUTLINE): this {
    const add: number[] = [];
    for (let y = 2; y < N - 2; y++) {
      for (let x = 2; x < N - 2; x++) {
        if (this.get(x, y)) continue;
        if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1)) add.push(y * N + x);
      }
    }
    for (const i of add) this.px[i] = c;
    return this;
  }
}

// ---- 色 ----
const FIRE = { dark: '#b3260f', red: '#e04a1c', orange: '#ff8a24', yellow: '#ffd23c', white: '#fff6c8' };
const WATER = { deep: '#1d4fa8', mid: '#3a86f0', light: '#86c8ff', white: '#e6f6ff' };
const GRASS = { deep: '#226b2a', mid: '#43a047', light: '#86d058', pale: '#d2f5a0', vein: '#1b4f20' };
const ELEC = { deep: '#c08a00', mid: '#ffd21f', light: '#fff27a', white: '#ffffff' };
const GRAY = { white: '#ffffff', light: '#dfe4ec', mid: '#a7b0c0', dark: '#646d7e' };

/** 三重の炎（外は赤・中は橙・芯は黄） */
function fireTongue(p: Pic, cx: number, cy: number, w: number, h: number, dir = -90, wob = 0.25, phase = 0): void {
  p.fill(flame(cx, cy, w, h, dir, wob, phase), FIRE.red);
  const a = (dir * Math.PI) / 180;
  p.fill(flame(cx - Math.cos(a) * w * 0.25, cy - Math.sin(a) * w * 0.25, w * 0.68, h * 0.72, dir, wob, phase), FIRE.orange);
  p.fill(flame(cx - Math.cos(a) * w * 0.45, cy - Math.sin(a) * w * 0.45, w * 0.36, h * 0.45, dir, wob * 0.5, phase), FIRE.yellow);
}

/**
 * 上下のキバの列（かみつく系統の絵。ゲームの中の絵 fangFace と同じ考え: 正面から見た上の列と下の列。
 * 上の列は広く、両はしに長い犬歯。歯ぐきは上が ∩、下が ∪）
 */
function fangRows(p: Pic, gum: { hi: string; mid: string; lo: string }, fang: { hi: string; lo: string }): void {
  const upperArc = bez([3.5, 13], [8, 6], [24, 6], [28.5, 13]);
  const lowerArc = bez([8, 23], [11, 28], [21, 28], [24, 23]);
  const tooth = (x: number, top: number, len: number, w: number, upward: boolean): void => {
    const tip = upward ? top - len : top + len;
    p.bevel(poly([[x - w, top], [x + w, top], [x + w * 0.25, tip], [x - w * 0.25, tip]]), fang.hi, fang.hi, fang.lo, 1);
  };
  // 上の列（犬歯は長い）
  tooth(6.6, 11, 9.5, 2.1, false);
  tooth(25.4, 11, 9.5, 2.1, false);
  for (const x of [11, 14.3, 17.7, 21]) tooth(x, 9, 4.6, 1.5, false);
  // 下の列（狭く小さい。犬歯は上の犬歯の内側）
  tooth(10.6, 24, 8, 1.8, true);
  tooth(21.4, 24, 8, 1.8, true);
  for (const x of [14.2, 17.8]) tooth(x, 26, 4, 1.4, true);
  p.bevel(stroke(upperArc, 2.4), gum.hi, gum.mid, gum.lo, 1.2);
  p.bevel(stroke(lowerArc, 1.9), gum.hi, gum.mid, gum.lo, 1.2);
}

/** 白い速さの線（左向きに流れる） */
function speedLines(p: Pic, lines: [number, number, number][], c = GRAY.white): void {
  for (const [x, y, len] of lines) p.fill(stroke([[x, y], [x + len, y]], (t) => 0.4 + 0.6 * t), c);
}

/** 稲妻の形（点を順に結んだ太いジグザグ） */
function boltShape(pts: Pt[]): Shape {
  return poly(pts);
}

const ART: Record<string, () => Pic> = {
  // ひのこ: 小さな火の粉が 3 つ、右上へ飛ぶ
  ember: () => {
    const p = new Pic();
    fireTongue(p, 13, 22, 5, 15, -95, 0.25);
    fireTongue(p, 23.5, 15, 3, 9, -80, 0.3, 1);
    fireTongue(p, 7, 10, 2, 6, -100, 0.3, 2);
    fireTongue(p, 24, 26, 1.8, 5, -85, 0.3, 1);
    return p.outline();
  },
  // かえんほうしゃ: 左下から右上へ広がる炎の帯
  flamethrower: () => {
    const p = new Pic();
    // 細い炎の流れが、先で大きく燃え広がる
    const stream = stroke(bez([4, 28], [8, 23], [11, 20], [15, 16]), (t) => 1.4 + 1.6 * t);
    const burst: [number, number, number, number, number][] = [
      [19, 13, 7, 15, -50], [17, 15, 4.5, 12, -100], [22, 14, 4.5, 11, 0], [18, 12, 3.5, 9, -150], [23, 17, 3.2, 8, 50],
    ];
    p.fill(stream, FIRE.red);
    for (const [x, y, w, h, d] of burst) p.fill(flame(x, y, w, h, d, 0.25), FIRE.red);
    p.fill(stroke(bez([4.5, 27.5], [8, 23], [11, 20], [15, 16]), (t) => 0.7 + 1 * t), FIRE.orange);
    for (const [x, y, w, h, d] of burst) p.fill(flame(x, y, w * 0.62, h * 0.7, d, 0.25), FIRE.orange);
    p.fill(circle(19.5, 13.5, 4.4), FIRE.yellow);
    p.fill(stroke(bez([5, 27], [8, 23.5], [12, 19.5], [17, 15]), 0.55), FIRE.yellow);
    p.fill(circle(19, 14, 1.6), FIRE.white);
    return p.outline();
  },
  // ほのおのキバ: かみつく あごに炎がまとう
  'fire-fang': () => {
    const p = new Pic();
    // 歯ぐきのふちから炎の舌が立つ
    fireTongue(p, 8, 9, 2.6, 7, -110, 0.3);
    fireTongue(p, 16, 6.5, 3, 6.5, -90, 0.3, 2);
    fireTongue(p, 24, 9, 2.6, 7, -70, 0.3, 1);
    fangRows(p, { hi: '#ff8a5c', mid: '#d8402a', lo: '#8e1d12' }, { hi: '#ffffff', lo: '#ffd9a8' });
    return p.outline();
  },
  // かみつく: 黒いあごと白い牙
  bite: () => {
    const p = new Pic();
    fangRows(p, { hi: '#a77ec8', mid: '#6b3f8e', lo: '#3c2052' }, { hi: '#ffffff', lo: '#c9c3d6' });
    return p.outline();
  },
  // ひっかく: 3 本の爪あと（右上から左下へ）
  scratch: () => {
    const p = new Pic();
    for (let i = 0; i < 3; i++) {
      const o = i * 5.5 - 5.5;
      const pts = bez([22 + o, 5], [19 + o, 12], [14 + o, 19], [9 + o, 27]);
      p.fill(stroke(pts, (t) => 0.4 + 1.6 * Math.sin(t * Math.PI)), GRAY.mid);
      p.fill(stroke(pts.map(([x, y]) => [x - 0.6, y - 0.3] as Pt), (t) => 0.2 + 0.9 * Math.sin(t * Math.PI)), GRAY.white);
    }
    return p.outline();
  },
  // たいあたり: 体（丸）がぶつかって星が弾ける
  tackle: () => {
    const p = new Pic();
    speedLines(p, [[3, 13, 6], [3, 18, 5], [4, 23, 5]]);
    p.fill(star(21, 14, 9, 4.2, 8, -80), ELEC.light);
    p.fill(star(21, 14, 5.5, 2.6, 8, -80), GRAY.white);
    p.ball(13, 18, 6.5, ['#6b5a4a', '#9c8468', '#c7ab86', '#ecd8b4']);
    return p.outline();
  },
  // でんこうせっか: 白い光の筋と、先を走る光の矢
  'quick-attack': () => {
    const p = new Pic();
    for (const [y, x0, x1] of [[9, 4, 19], [15, 3, 25], [21, 5, 21]] as const) {
      p.fill(stroke([[x0, y], [x1, y]], (t) => 0.3 + 1.4 * t), GRAY.light);
      p.fill(stroke([[x0 + 4, y], [x1, y]], (t) => 0.1 + 0.7 * t), GRAY.white);
    }
    p.fill(poly([[22, 10], [29, 15], [22, 20], [24, 15]]), GRAY.white);
    return p.outline();
  },
  // つるのムチ: しなるつると葉
  'vine-whip': () => {
    const p = new Pic();
    const pts = [...bez([5, 27], [9, 14], [20, 26], [22, 13]), ...bez([22, 13], [24, 4], [14, 4], [16, 10]).slice(1)];
    p.fill(stroke(pts, (t) => 2.4 - 1.6 * t), GRASS.deep);
    p.fill(stroke(pts.map(([x, y]) => [x - 0.6, y - 0.6] as Pt), (t) => 1.3 - 0.9 * t), GRASS.light);
    p.bevel(leaf(10, 17, 8, 3.6, -50), GRASS.pale, GRASS.light, GRASS.mid, 1);
    p.bevel(leaf(25, 22, 7, 3, 30), GRASS.pale, GRASS.light, GRASS.mid, 1);
    return p.outline();
  },
  // はっぱカッター: 回りながら飛ぶ鋭い葉 2 枚と、回る筋
  'razor-leaf': () => {
    const p = new Pic();
    // 回りながら飛ぶ 2 枚の葉（向きを変えて、枝に見えないように離す）
    for (const [cx, cy, deg] of [[19.5, 10.5, -40], [12, 21.5, 15]] as const) {
      p.bevel(leaf(cx, cy, 18, 5.4, deg), GRASS.pale, GRASS.light, GRASS.deep, 1.2);
      const a = (deg * Math.PI) / 180;
      p.fill(stroke([[cx - Math.cos(a) * 5.5, cy - Math.sin(a) * 5.5], [cx + Math.cos(a) * 5.5, cy + Math.sin(a) * 5.5]], 0.45), GRASS.vein);
    }
    // 切る音の光
    p.fill(star(26, 21, 3.2, 0.9, 4, 0), GRAY.white);
    p.fill(star(6, 9, 2.2, 0.7, 4, 0), GRAY.white);
    return p.outline();
  },
  // やどりぎのタネ: 茶色い種から芽とつるが伸びる
  'leech-seed': () => {
    const p = new Pic();
    p.fill(stroke(bez([13, 20], [6, 18], [5, 10], [9, 6]), 0.7), GRASS.mid);
    p.fill(stroke(bez([19, 20], [27, 19], [27, 11], [23, 8]), 0.7), GRASS.mid);
    p.fill(stroke([[16, 16], [16, 9]], 1), GRASS.mid);
    p.bevel(leaf(12.5, 8.5, 8, 3.6, -25), GRASS.pale, GRASS.light, GRASS.mid, 1);
    p.bevel(leaf(19.5, 8.5, 8, 3.6, 25), GRASS.pale, GRASS.light, GRASS.mid, 1);
    p.ball(16, 21, 6, ['#5b3a1e', '#8a5a2b', '#b9803f', '#e2b46c']);
    p.fill(stroke(bez([13, 18], [15, 20], [15, 23], [14, 25]), 0.4), '#5b3a1e');
    return p.outline();
  },
  // ねむりごな: 青白い粉の雲と、眠りの Z
  'sleep-powder': () => {
    const p = new Pic();
    const cloud = union(circle(11, 20, 6), circle(17, 17, 7), circle(23, 21, 5.5), circle(16, 23, 5.5));
    p.bevel(cloud, '#e8ecff', '#b3bdf5', '#7e86d6', 1.6);
    const r = (s: number): () => number => {
      let a = s;
      return () => ((a = (a * 9301 + 49297) % 233280) / 233280);
    };
    const rnd = r(7);
    for (let i = 0; i < 9; i++) p.dot(7 + rnd() * 19, 13 + rnd() * 14, '#ffffff');
    const z = (x: number, y: number, s: number): void => {
      p.fill(stroke([[x, y], [x + s, y], [x, y + s], [x + s, y + s]], 0.65), GRAY.white);
    };
    z(19, 4, 5);
    z(25, 9, 3.5);
    return p.outline();
  },
  // あわ: 大小の泡
  bubble: () => {
    const p = new Pic();
    const bub = (cx: number, cy: number, r: number): void => {
      p.fill(circle(cx, cy, r), WATER.light);
      p.fill(circle(cx + r * 0.12, cy + r * 0.12, r - 1.4), WATER.mid);
      p.fill(ellipse(cx - r * 0.38, cy - r * 0.38, r * 0.32, r * 0.2, -45), WATER.white);
    };
    bub(12, 19, 7);
    bub(22, 11, 5);
    bub(23, 23, 3.5);
    bub(8, 8, 2.5);
    return p.outline();
  },
  // みずでっぽう: 左から右上へ細い水の流れと しぶき
  'water-gun': () => {
    const p = new Pic();
    const pts = bez([3, 27], [9, 21], [15, 16], [22, 11]);
    p.fill(stroke(pts, (t) => 1.6 + 2.2 * t), WATER.deep);
    p.fill(stroke(pts, (t) => 1 + 1.6 * t), WATER.mid);
    p.fill(stroke(pts.map(([x, y]) => [x - 0.5, y - 1] as Pt), (t) => 0.3 + 0.7 * t), WATER.white);
    // 当たった先のしぶき
    for (const [x, y, r] of [[25, 7, 2], [27.5, 12, 1.6], [21, 5, 1.4], [26.5, 3.8, 1], [28.5, 8, 1]] as const) {
      p.fill(circle(x, y, r), WATER.light);
      p.dot(x - r * 0.4, y - r * 0.4, WATER.white);
    }
    return p.outline();
  },
  // ハイドロポンプ: 太い 2 本の激流が噴き出す
  'hydro-pump': () => {
    const p = new Pic();
    for (const o of [-5, 5]) {
      const pts = bez([3 + o * 0.2, 16 + o], [10, 16 + o], [18, 16 + o * 0.8], [28, 16 + o * 0.7]);
      p.fill(stroke(pts, (t) => 2.2 + 2.4 * t), WATER.deep);
      p.fill(stroke(pts, (t) => 1.4 + 1.6 * t), WATER.mid);
      p.fill(stroke(pts.map(([x, y]) => [x, y - 1.4] as Pt), (t) => 0.3 + 0.6 * t), WATER.white);
    }
    for (const [x, y] of [[26, 5], [28, 26], [22, 4]] as const) p.fill(circle(x, y, 1.4), WATER.light);
    return p.outline();
  },
  // でんきショック: 小さな火花の稲妻と 光の点
  'thunder-shock': () => {
    const p = new Pic();
    const b = boltShape([[18, 4], [10, 16], [15, 16], [11, 28], [22, 13], [17, 13], [22, 4]]);
    p.bevel(b, ELEC.white, ELEC.mid, ELEC.deep, 1);
    for (const [x, y] of [[6, 9], [25, 21], [27, 9], [6, 23]] as const) {
      p.fill(star(x, y, 2.6, 0.9, 4, 0), ELEC.light);
    }
    return p.outline();
  },
  // 10まんボルト: 太い稲妻と、まわりに走る電気
  thunderbolt: () => {
    const p = new Pic();
    for (const [x, y, r] of [[6, 10, 2.8], [26, 22, 2.8], [6, 25, 1.8], [27, 7, 1.8]] as const) p.fill(star(x, y, r, r * 0.3, 4, 0), ELEC.light);
    const b = boltShape([[20, 3], [8, 18], [15, 18], [10, 29], [25, 13], [18, 13], [24, 3]]);
    p.bevel(b, ELEC.white, ELEC.mid, ELEC.deep, 1.4);
    p.fill(stroke([[19, 7], [13, 15]], 0.45), ELEC.white);
    return p.outline();
  },
};

// ---- 書き出し ----
function toArt(p: Pic): { palette: string[]; rows: string[] } {
  const palette: string[] = [];
  const rows: string[] = [];
  for (let y = 0; y < N; y++) {
    let row = '';
    for (let x = 0; x < N; x++) {
      const c = p.px[y * N + x];
      if (!c) {
        row += '.';
        continue;
      }
      let i = palette.indexOf(c);
      if (i === -1) {
        i = palette.length;
        palette.push(c);
      }
      row += i.toString(36);
    }
    rows.push(row);
  }
  if (palette.length > 36) throw new Error('色が 36 を超えました');
  return { palette, rows };
}

const read = (p: string): unknown => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const moves = (read('data/game/moves.json') as { moves: Record<string, unknown> }).moves;
const out: Record<string, { palette: string[]; rows: string[] }> = {};
for (const [key, draw] of Object.entries(ART)) {
  if (!moves[key]) throw new Error(`技 ${key} が data/game/moves.json にありません`);
  out[key] = toArt(draw());
}
const file = path.join(ROOT, 'data/render/move-icons.json');
fs.writeFileSync(file, JSON.stringify({ credit: '自作（scripts/make-move-icons.ts で計算して描く）', size: N, icons: out }, null, 2) + '\n');
console.log(`${Object.keys(out).length} 個の絵を ${path.relative(ROOT, file)} に書きました`);

// 確認用の画像: 1 行に 1 技（前の絵 ×3・新しい絵 ×3・新しい絵の 1 倍と 2 倍）
const previewAt = process.argv.indexOf('--preview');
if (previewAt !== -1) {
  const icons = read('data/render/icons.json') as Parameters<typeof iconPixels>[0];
  const gen = read('data/generated/moves.json') as Record<string, { type: string }>;
  const der = read('data/game/derivations.json') as { derivations: { to: string }[]; unique: { to: string }[] };
  const tierOf = (k: string): IconTier => (der.unique.some((d) => d.to === k) ? 'unique' : der.derivations.some((d) => d.to === k) ? 'derived' : 'base');
  const keys = Object.keys(out);
  const cols = 2;
  const cellW = 96 + 8 + 96 + 8 + 32 + 8 + 64 + 24;
  const cellH = 96 + 8;
  const png = new PNG({ width: cols * cellW + 8, height: Math.ceil(keys.length / cols) * cellH + 8 });
  png.data.fill(0);
  for (let i = 0; i < png.data.length; i += 4) png.data.set([42, 44, 56, 255], i);
  const blit = (px: Uint8ClampedArray, ox: number, oy: number, s: number): void => {
    for (let y = 0; y < N * s; y++) {
      for (let x = 0; x < N * s; x++) {
        const si = (Math.floor(y / s) * N + Math.floor(x / s)) * 4;
        if (!px[si + 3]) continue;
        const di = ((oy + y) * png.width + ox + x) * 4;
        png.data.set([px[si]!, px[si + 1]!, px[si + 2]!, 255], di);
      }
    }
  };
  keys.forEach((k, i) => {
    const color = icons.typeColors[gen[k]?.type ?? 'normal'] ?? '#888888';
    const glyph = icons.moveGlyphs[k] ?? icons.moves[(moves[k] as { pattern: string }).pattern] ?? 'nearest';
    const ox = 8 + (i % cols) * cellW;
    const oy = 8 + Math.floor(i / cols) * cellH;
    blit(iconPixels(icons, glyph, color, tierOf(k)), ox, oy, 3);
    const neu = iconPixels(icons, glyph, color, tierOf(k), out[k]);
    blit(neu, ox + 104, oy, 3);
    blit(neu, ox + 208, oy + 32, 1);
    blit(neu, ox + 248, oy + 16, 2);
  });
  const dest = path.resolve(process.argv[previewAt + 1] ?? 'move-icons-preview.png');
  fs.writeFileSync(dest, PNG.sync.write(png));
  console.log(`確認用の画像: ${dest}（${keys.join(', ')}）`);
}
