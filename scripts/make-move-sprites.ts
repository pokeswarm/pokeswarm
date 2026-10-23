/**
 * 技のドット絵（作者の案 2026年10月23日: 光の円・線の代わりに、技ごとのドット絵を描く）を、計算で作る。
 *
 *   npm run move-sprites
 *
 * 出力: data/render/move-sprites.json（コミットする。描くときに、1文字1ドットの表からテクスチャを作る）
 * 確認用: --preview=<フォルダ> で、各コマを拡大した PNG を書き出す
 *
 * 公式の画像は使わず、乱数（種を固定）と図形だけで描く。絵ごとに:
 * - palette: 色の一覧。表の 0〜9 が色の番号、. が透明
 * - parts: 絵の部品。main（1枚の絵。円の範囲に合わせる）、start・middle・end（線の始まり・途中・終わり。途中は並べて長さに合わせる）
 * - 部品ごとにコマの並び。frameMs ごとに次のコマへ。loopFrom があれば、最後まで行ったらそのコマから繰り返す（伸びきった後の揺れ）
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]));

type Grid = number[][]; // -1 = 透明、0〜 = 色の番号

interface SpriteOut {
  palette: string[];
  frameMs: number;
  loopFrom?: number;
  parts: Record<string, string[][]>;
}

/** 種を固定した乱数（mulberry32） */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blank(w: number, h: number): Grid {
  return Array.from({ length: h }, () => Array<number>(w).fill(-1));
}

function toRows(g: Grid): string[] {
  return g.map((row) => row.map((c) => (c < 0 ? '.' : String(c))).join(''));
}

function set(g: Grid, x: number, y: number, c: number): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (yi >= 0 && yi < g.length && xi >= 0 && xi < g[0]!.length) g[yi]![xi] = c;
}

/** 色の付いたドットの外側に、輪郭の色を付ける（ドット絵らしく形をはっきりさせる） */
function outline(g: Grid, color: number): Grid {
  const out = g.map((r) => r.slice());
  for (let y = 0; y < g.length; y++) {
    for (let x = 0; x < g[0]!.length; x++) {
      if (g[y]![x]! >= 0) continue;
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => (g[y + dy!]?.[x + dx!] ?? -1) >= 0 && g[y + dy!]![x + dx!] !== color);
      if (near) out[y]![x] = color;
    }
  }
  return out;
}

// ---------------- ハードプラント: 地面を這って広がる根 ----------------
/**
 * 真ん中の根元から、何本もの根がうねりながら外へ這い出し、枝分かれする（上から見た地面）。
 * コマ 0〜3 で伸び、4・5 で先がうねる（loopFrom 4）。根元には若葉
 */
function roots(): SpriteOut {
  const size = 32;
  const c = size / 2;
  // 0 輪郭（こげ茶）・1 根の暗い所・2 根・3 根の明るい所・4 若葉の暗い所・5 若葉
  const palette = ['#2b1a12', '#4e342e', '#795548', '#a1887f', '#558b2f', '#9ccc65'];
  const r = rng(20261023);
  // 根の通り道を先に決める（どのコマでも同じ形で、伸びる長さだけ変える）
  interface Root { pts: [number, number][]; branches: { at: number; pts: [number, number][] }[] }
  const list: Root[] = [];
  const n = 6;
  for (let k = 0; k < n; k++) {
    let a = (k / n) * Math.PI * 2 + (r() - 0.5) * 0.6;
    // 根元のこぶの縁から出す
    let x = c + Math.cos(a) * 2;
    let y = c + Math.sin(a) * 2;
    const pts: [number, number][] = [];
    const len = 12 + Math.floor(r() * 3);
    for (let s = 0; s < len; s++) {
      // うねりながら外へ（真ん中へ戻らないよう、外向きに少し引っぱる）
      a += (r() - 0.5) * 0.6;
      x += Math.cos(a);
      y += Math.sin(a);
      pts.push([x, y]);
    }
    const branches: Root['branches'] = [];
    for (let b = 0; b < 2; b++) {
      const at = 4 + Math.floor(r() * (len - 6));
      const [bx0, by0] = pts[at]!;
      let ba = a + (r() < 0.5 ? -1 : 1) * (0.8 + r() * 0.5);
      let bx = bx0;
      let by = by0;
      const bp: [number, number][] = [];
      for (let s = 0; s < 4 + Math.floor(r() * 3); s++) {
        ba += (r() - 0.5) * 0.8;
        bx += Math.cos(ba);
        by += Math.sin(ba);
        bp.push([bx, by]);
      }
      branches.push({ at, pts: bp });
    }
    list.push({ pts, branches });
  }
  const frame = (grow: number, wiggle: number): Grid => {
    const g = blank(size, size);
    for (const root of list) {
      const shown = Math.max(1, Math.floor(root.pts.length * grow));
      root.pts.slice(0, shown).forEach(([x, y], s) => {
        // 先ほどうねる（コマで向きを変える）
        const tip = s / root.pts.length;
        const w = wiggle * Math.sin(s * 0.9 + wiggle * 2) * tip * 1.2;
        const thick = s < root.pts.length * 0.3;
        set(g, x + w, y - w, 2);
        if (thick) {
          set(g, x + w + 1, y - w, 1);
          set(g, x + w, y - w - 1, 3);
        }
      });
      for (const br of root.branches) {
        if (br.at >= shown) continue;
        const bShown = Math.max(0, Math.floor(br.pts.length * Math.min(1, (grow - br.at / root.pts.length) * 2)));
        br.pts.slice(0, bShown).forEach(([x, y], s) => set(g, x + wiggle * Math.sin(s + wiggle) * 0.6, y, s === 0 ? 1 : 2));
      }
    }
    // 根元（こぶ）と若葉
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) set(g, c + dx, c + dy, dx + dy < 0 ? 3 : 1);
    if (grow >= 0.75) {
      for (const [dx, dy, col] of [[-1, -3, 5], [0, -4, 5], [1, -3, 4], [2, -4, 5], [-2, -4, 4]] as const) set(g, c + dx + (wiggle > 0 ? 1 : 0) * (dy < -3 ? 1 : 0), c + dy, col);
    }
    return outline(g, 0);
  };
  const frames = [frame(0.25, 0), frame(0.5, 0), frame(0.75, 0), frame(1, 0), frame(1, 1), frame(1, -1)];
  return { palette, frameMs: 110, loopFrom: 4, parts: { main: frames.map(toRows) } };
}

// ---------------- ハードプラント: 地面を這って伸びる根（線） ----------------
/**
 * 横向きの1本の根。高さ H。途中の部品は幅 TILE で、並べてもつながる（うねりの周期を幅にそろえる）。
 * 始まりは地面から出る太い根元と土くれ、終わりは細くなる先と細い根。コマごとにうねりを少しずらす（這って見せる）
 */
function rootLine(): SpriteOut {
  const H = 12;
  const TILE = 12;
  // 0 輪郭・1 樹皮の暗い所・2 樹皮・3 樹皮の明るい所・4 土・5 若葉
  const palette = ['#24150e', '#4e342e', '#6d4c41', '#a1887f', '#8d6e63', '#9ccc65'];
  const FRAMES = 3;
  const mid = (H - 1) / 2;
  /** x の位置の、根の中心の高さ（うねり）と太さ */
  const body = (g: Grid, gx: number, x: number, f: number, half: number): void => {
    const cy = mid + Math.sin(((x + f * 3) / TILE) * Math.PI * 2) * 1.6;
    for (let y = Math.round(cy - half); y <= Math.round(cy + half); y++) {
      const d = (y - cy) / Math.max(0.5, half);
      // 上側を明るく、下側を暗く。樹皮の節（斜めの筋）を入れる
      let col = d < -0.4 ? 3 : d > 0.45 ? 1 : 2;
      if ((x + y * 2 + 40) % 6 === 0 && Math.abs(d) < 0.8) col = 1;
      set(g, gx, y, col);
    }
  };
  const start: Grid[] = [];
  const middle: Grid[] = [];
  const end: Grid[] = [];
  for (let f = 0; f < FRAMES; f++) {
    const m = blank(TILE, H);
    for (let x = 0; x < TILE; x++) body(m, x, x, f, 2.2);
    middle.push(outline(m, 0));
    // 始まり: 太い根元が地面から出る（土くれ付き）
    const st = blank(TILE, H);
    for (let x = 0; x < TILE; x++) body(st, x, x, f, 3.6 - (x / TILE) * 1.4);
    const sOut = outline(st, 0);
    const r = rng(4242 + f);
    for (let k = 0; k < 6; k++) {
      const x = Math.floor(r() * 5);
      const y = r() < 0.5 ? Math.floor(r() * 2) : H - 1 - Math.floor(r() * 2);
      if ((sOut[y]?.[x] ?? -1) < 0) set(sOut, x, y, 4);
    }
    start.push(sOut);
    // 終わり: 細くなって途切れ、細い根が2本分かれる
    const e = blank(TILE, H);
    for (let x = 0; x < TILE - 2; x++) body(e, x, x, f, Math.max(0.4, 2.2 - (x / (TILE - 3)) * 2));
    const tipY = mid + Math.sin(((TILE - 3 + f * 3) / TILE) * Math.PI * 2) * 1.6;
    for (let k = 0; k < 3; k++) {
      set(e, TILE - 6 + k, tipY - 2 - k * 0.7, 2);
      set(e, TILE - 5 + k, tipY + 2 + k * 0.5, 2);
    }
    if (f === 1) set(e, TILE - 8, tipY - 3, 5);
    end.push(outline(e, 0));
  }
  return { palette, frameMs: 120, parts: { start: start.map(toRows), middle: middle.map(toRows), end: end.map(toRows) } };
}

// ---------------- ハイドロポンプ: 水流（始まり・途中・終わり） ----------------
/**
 * 横向きの水流。高さ H。途中の部品は幅 TILE で、並べてもつなぎ目が出ない（波の周期を幅にそろえる）。
 * コマごとに模様を前へずらして、流れて見せる。始まりは口が細く、終わりはしぶき
 */
function stream(): SpriteOut {
  const H = 14;
  const TILE = 8;
  // 0 輪郭（濃い青）・1 濃い青・2 青・3 明るい青・4 水色・5 白（泡）
  const palette = ['#0d2b5c', '#01579b', '#0288d1', '#29b6f6', '#81d4fa', '#ffffff'];
  const FRAMES = 4;
  const mid = (H - 1) / 2;
  // 泡の筋を行ごとにずらす量（横に流れる筋に見せる。並べてもつながるよう、ずらすだけで周期は TILE）
  const ROW_SHIFT = [0, 5, 2, 6, 1, 4, 7, 3, 5, 0, 6, 2, 4, 1];
  /** x（流れの方向の位置）・コマ f の、流れの中の1列（上下の端は波打つ） */
  const column = (g: Grid, gx: number, x: number, f: number, half: number): void => {
    const phase = ((x + f * 2) / TILE) * Math.PI * 2;
    const top = Math.round(mid - half + Math.sin(phase) * 0.6);
    const bottom = Math.round(mid + half - Math.sin(phase + 1.3) * 0.6);
    for (let y = top; y <= bottom; y++) {
      const d = Math.abs(y - mid) / Math.max(1, half);
      let col = d > 0.85 ? 1 : d > 0.6 ? 2 : d > 0.3 ? 3 : 4;
      // 泡の筋: 流れに乗って前へ進む
      const streak = (x + f * 2 + ROW_SHIFT[(y + H) % H]! + 64) % TILE;
      if (d < 0.6 && streak < 2) col = 5;
      else if (d < 0.85 && streak === 2) col = 4;
      set(g, gx, y, col);
    }
  };
  const middle: Grid[] = [];
  const start: Grid[] = [];
  const end: Grid[] = [];
  for (let f = 0; f < FRAMES; f++) {
    const m = blank(TILE, H);
    for (let x = 0; x < TILE; x++) column(m, x, x, f, 5);
    middle.push(outline(m, 0));
    // 始まり: 口が細く、だんだん太くなる
    const s = blank(TILE, H);
    for (let x = 0; x < TILE; x++) column(s, x, x, f, 2 + (x / (TILE - 1)) * 3);
    start.push(outline(s, 0));
    // 終わり: 太さを保ったまま途切れ、しぶきが散る
    const EW = 12;
    const e = blank(EW, H);
    const r = rng(777 + f * 31);
    for (let x = 0; x < 5; x++) column(e, x, x, f, 5 - x * 0.6);
    const body = outline(e, 0);
    for (let k = 0; k < 14; k++) {
      const x = 4 + Math.floor(r() * (EW - 4));
      const y = Math.round(mid + (r() - 0.5) * (H - 2) * (0.5 + (x / EW) * 0.6));
      const col = r() < 0.5 ? 5 : r() < 0.5 ? 4 : 3;
      if (body[y]?.[x] !== undefined && body[y]![x]! >= 0) continue;
      set(body, x, y, col);
      if (r() < 0.35) set(body, x + 1, y, 4);
    }
    end.push(body);
  }
  return { palette, frameMs: 70, parts: { start: start.map(toRows), middle: middle.map(toRows), end: end.map(toRows) } };
}

// ---------------- 飛ぶ物（案 A）: 形を式で描く ----------------
/**
 * 大きさ size × size のマスに、u・v（−1〜1。u が右、v が下）の式で色を決めて描く（-1 は透明）。
 * rot だけ回した座標で式を呼ぶので、回転したコマも同じ式から作れる（葉っぱ・花びら）。最後に輪郭を付ける
 */
function shape(size: number, fn: (u: number, v: number) => number, rot = 0, edge = 0): Grid {
  const g = blank(size, size);
  const c = Math.cos(-rot);
  const s = Math.sin(-rot);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = ((x + 0.5) / size) * 2 - 1;
      const py = ((y + 0.5) / size) * 2 - 1;
      const col = fn(px * c - py * s, px * s + py * c);
      if (col >= 0) g[y]![x] = col;
    }
  }
  return edge >= 0 ? outline(g, edge) : g;
}

/** 左上から光が当たる丸みの明るさ（−1 暗い 〜 1 明るい） */
function light(u: number, v: number, r: number): number {
  return (-u - v) / (Math.SQRT2 * Math.max(0.01, r));
}

/** ひのこ: 右へ進むゆらめく炎（尾は左。コマごとに尾がゆれる） */
function ember(): SpriteOut {
  // 0 輪郭（こげ赤）・1 赤・2 橙・3 黄・4 白
  const palette = ['#5d1a0e', '#d84315', '#ff9800', '#ffeb3b', '#fffde7'];
  const frames = [0, 1, 2].map((f) =>
    shape(16, (u, v) => {
      // 頭の丸（右寄り）と、左へ細くなる尾
      const head = Math.hypot(u - 0.25, v) / 0.5;
      const t = Math.max(0, Math.min(1, (0.3 - u) / 1.25));
      const wob = Math.sin(t * 5 + f * 2.1) * 0.18 * t;
      const tail = u < 0.3 && u > -0.95 && Math.abs(v - wob) < 0.5 * (1 - t) + 0.05;
      if (head > 1 && !tail) return -1;
      const d = head <= 1 ? head * 0.7 : 0.6 + t * 0.6;
      return d < 0.35 ? 4 : d < 0.6 ? 3 : d < 0.85 ? 2 : 1;
    }),
  );
  return { palette, frameMs: 80, parts: { main: frames.map(toRows) } };
}

/** みずでっぽう: 右へ進むしずく */
function waterDrop(): SpriteOut {
  const palette = ['#0d2b5c', '#0277bd', '#29b6f6', '#b3e5fc', '#ffffff'];
  const frames = [0, 1].map((f) =>
    shape(12, (u, v) => {
      const head = Math.hypot(u - 0.3, v) / 0.55;
      const t = Math.max(0, Math.min(1, (0.3 - u) / 1.2));
      const tail = u < 0.3 && u > -0.9 && Math.abs(v) < 0.55 * (1 - t);
      if (head > 1 && !tail) return -1;
      // 左上の光の点（コマで少し動く）
      if (Math.hypot(u - 0.4 + f * 0.08, v + 0.22) < 0.16) return 4;
      const l = light(u - 0.3, v, 0.55);
      return l > 0.45 ? 3 : l > -0.3 ? 2 : 1;
    }),
  );
  return { palette, frameMs: 100, parts: { main: frames.map(toRows) } };
}

/** あわ: うすい膜の泡（コマで少し伸び縮み） */
function bubble(): SpriteOut {
  const palette = ['#01579b', '#4fc3f7', '#b3e5fc', '#e1f5fe', '#ffffff'];
  const frames = [0, 1, 2, 1].map((f) =>
    shape(14, (u, v) => {
      const sx = 0.85 + f * 0.05;
      const sy = 0.95 - f * 0.05;
      const d = Math.hypot(u / sx, v / sy);
      if (d > 1) return -1;
      if (Math.hypot(u + 0.35, v + 0.4) < 0.18) return 4;
      if (d > 0.82) return 1;
      if (d > 0.68 && u + v < -0.2) return 2;
      // 中は透明。右下に うすい照り返し
      return d > 0.55 && u + v > 0.5 ? 3 : -1;
      // 中が透明なので輪郭は付けない（ふちの濃い色が輪郭の代わり）
    }, 0, -1),
  );
  return { palette, frameMs: 120, parts: { main: frames.map(toRows) } };
}

/** 葉っぱ（はっぱカッター）・花びら（はなびらのまい）: 線に並べる。コマで回る */
function leafLine(kind: 'leaf' | 'petal'): SpriteOut {
  const palette =
    kind === 'leaf' ? ['#1b3d14', '#33691e', '#558b2f', '#8bc34a', '#c5e1a5'] : ['#6a1b3a', '#c2185b', '#f06292', '#f8bbd0', '#ffffff'];
  const one = (rot: number): Grid =>
    shape(12, (u, v) => {
      // 葉: 先のとがった細長い形。花びら: 丸く先に切れ込み
      const inside = kind === 'leaf' ? (u / 0.95) ** 2 + (v / (0.42 * (1 - Math.abs(u) * 0.35))) ** 2 < 1 : (u / 0.8) ** 2 + (v / 0.55) ** 2 < 1 && !(u > 0.55 && Math.abs(v) < 0.12);
      if (!inside) return -1;
      if (kind === 'leaf' && Math.abs(v) < 0.08 && u > -0.85) return 1;
      const l = light(u, v, 0.8);
      return l > 0.4 ? 4 : l > -0.1 ? 3 : 2;
    }, rot);
  const frames = [0, 1, 2, 3].map((f) => {
    // 途中の部品: 幅 12 に葉を1枚（回る角度は場所ごとにずらさず、コマで回す）
    return one((f * Math.PI) / 4 + 0.4);
  });
  const rows = frames.map(toRows);
  return { palette, frameMs: 70, parts: { start: rows, middle: rows, end: rows } };
}

/** いわおとし・いわなだれ（岩）・ストーンエッジ（とがった石） */
function rock(kind: 'rock' | 'stone'): SpriteOut {
  const palette = kind === 'rock' ? ['#2b211b', '#5d4037', '#8d6e63', '#a1887f', '#d7ccc8'] : ['#1c2833', '#37474f', '#607d8b', '#90a4ae', '#eceff1'];
  const r = rng(kind === 'rock' ? 99 : 123);
  // ごつごつ: 角度ごとの半径をばらつかせる。石は 4 つの尖り
  const radii = Array.from({ length: 12 }, () => 0.72 + r() * 0.25);
  const g = shape(16, (u, v) => {
    const a = Math.atan2(v, u);
    const d = Math.hypot(u, v);
    let rr: number;
    if (kind === 'rock') {
      const k = ((a + Math.PI) / (Math.PI * 2)) * 12;
      const i = Math.floor(k) % 12;
      rr = radii[i]! + (radii[(i + 1) % 12]! - radii[i]!) * (k - Math.floor(k));
    } else {
      // とがった石の破片: 横に長いひし形（先が鋭い）
      rr = 1 / (Math.abs(Math.cos(a)) / 0.95 + Math.abs(Math.sin(a)) / 0.42);
    }
    if (d > rr) return -1;
    // ひび
    if (kind === 'rock' && Math.abs(u * 0.6 - v - 0.1) < 0.07 && d < rr * 0.8) return 1;
    // 石は面ごとに色を分ける
    // 石は面ごとに色を分ける（上の面が明るい。真ん中に稜線）
    if (kind === 'stone') return Math.abs(v) < 0.06 ? 4 : v < 0 ? (u < 0 ? 3 : 4) : u < 0 ? 1 : 2;
    const l = light(u, v, rr);
    return l > 0.5 ? 4 : l > 0.05 ? 3 : l > -0.45 ? 2 : 1;
  });
  return { palette, frameMs: 1000, parts: { main: [toRows(g)] } };
}

/** ホネブーメラン・ボーンラッシュ: 骨（回して飛ばす） */
function bone(): SpriteOut {
  const palette = ['#3e2f1c', '#a1887f', '#d7ccc8', '#efebe9', '#ffffff'];
  const g = shape(16, (u, v) => {
    const knob = [[-0.7, -0.22], [-0.7, 0.22], [0.7, -0.22], [0.7, 0.22]].some(([x, y]) => Math.hypot(u - x!, v - y!) < 0.24);
    const shaft = Math.abs(u) < 0.72 && Math.abs(v) < 0.14;
    if (!knob && !shaft) return -1;
    return v < -0.05 ? 4 : v < 0.1 ? 3 : 2;
  });
  return { palette, frameMs: 1000, parts: { main: [toRows(g)] } };
}

/** スピードスター: 星（回す。コマで中が瞬く） */
function star(): SpriteOut {
  const palette = ['#7a4a00', '#ff9800', '#ffd54f', '#fff59d', '#ffffff'];
  const frames = [0, 1].map((f) =>
    shape(14, (u, v) => {
      // 五角の星: 角の向きからのずれで半径を内側 0.42・外側 0.98 の間で変える（とがった形）
      const a = Math.atan2(v, u) + Math.PI / 2;
      const d = Math.hypot(u, v);
      const seg = (Math.PI * 2) / 5;
      const off = Math.abs((((a % seg) + seg) % seg) - seg / 2) / (seg / 2);
      const rr = 0.42 + 0.56 * off ** 1.4;
      if (d > rr) return -1;
      if (d < 0.18 + f * 0.1) return 4;
      return d < rr * 0.55 ? 3 : 2;
    }),
  );
  return { palette, frameMs: 90, parts: { main: frames.map(toRows) } };
}

/** どくばり: 右を向いた細い針（先が紫） */
function needle(): SpriteOut {
  const palette = ['#2a1033', '#6a1b9a', '#ab47bc', '#cfd8dc', '#ffffff'];
  const g = shape(14, (u, v) => {
    if (u < -0.95 || u > 0.98) return -1;
    // 根元が太く、先が鋭い
    const w = 0.3 * (1 - (u + 0.95) / 1.93) + 0.04;
    if (Math.abs(v) > w) return -1;
    if (u > 0.45) return 2;
    return v < 0 ? 4 : 3;
  });
  return { palette, frameMs: 1000, parts: { main: [toRows(g)] } };
}

/** ヘドロばくだん: 紫のぶよぶよした泥の玉（コマでふちが揺れ、泡が浮く） */
function sludge(): SpriteOut {
  const palette = ['#2a0d33', '#7b1fa2', '#ab47bc', '#ce93d8', '#f3e5f5'];
  const frames = [0, 1, 2].map((f) =>
    shape(16, (u, v) => {
      const a = Math.atan2(v, u);
      const rr = 0.78 + Math.sin(a * 5 + f * 2) * 0.08 + Math.sin(a * 3 - f) * 0.05;
      const d = Math.hypot(u, v);
      if (d > rr) return -1;
      // 泡
      if (Math.hypot(u - 0.25 + f * 0.05, v + 0.15 - f * 0.12) < 0.13) return 4;
      if (Math.hypot(u + 0.3, v - 0.25 + f * 0.08) < 0.09) return 3;
      const l = light(u, v, rr);
      return l > 0.45 ? 3 : l > -0.3 ? 2 : 1;
    }),
  );
  return { palette, frameMs: 110, parts: { main: frames.map(toRows) } };
}

/** シャドーボール（黒紫の玉に渦）・はどうだん（青い玉に波の輪）。コマで模様が回る */
function orb(kind: 'shadow' | 'aura'): SpriteOut {
  const palette = kind === 'shadow' ? ['#0b0410', '#1a0b24', '#4a148c', '#7e57c2', '#d1c4e9'] : ['#06264d', '#0d47a1', '#1e88e5', '#64b5f6', '#e3f2fd'];
  const frames = [0, 1, 2, 3].map((f) =>
    shape(16, (u, v) => {
      const d = Math.hypot(u, v);
      if (d > 0.9) return -1;
      const a = Math.atan2(v, u) + (f * Math.PI) / 2;
      if (kind === 'shadow') {
        // 渦の筋
        const swirl = Math.sin(a * 2 + d * 7);
        if (d < 0.25) return 1;
        return swirl > 0.55 ? 4 : swirl > 0 ? 3 : d > 0.75 ? 2 : 1;
      }
      // はどうだん: 中が明るく、外へ広がる波の輪
      const ring = Math.sin(d * 14 - f * 1.6 + Math.sin(a * 3) * 0.6);
      if (d < 0.3) return 4;
      return ring > 0.4 ? 3 : d > 0.75 ? 1 : 2;
    }),
  );
  return { palette, frameMs: 90, parts: { main: frames.map(toRows) } };
}

/** 線用の絵（葉・花びら）の途中の部品を、1枚の絵（main）として使う（放射状に飛ばす・うずで回す） */
function single(sp: SpriteOut): SpriteOut {
  return { ...sp, parts: { main: sp.parts.middle! } };
}

/** トライアタック: 三角の3つの角が ほのお（赤）・こおり（水色）・でんき（黄）の玉。回して飛ばす */
function triOrb(): SpriteOut {
  const palette = ['#1a1a2e', '#e53935', '#ff8a65', '#29b6f6', '#b3e5fc', '#fdd835', '#fff59d', '#ffffff'];
  const corners = [0, 1, 2].map((k) => [Math.cos(-Math.PI / 2 + (k * Math.PI * 2) / 3) * 0.6, Math.sin(-Math.PI / 2 + (k * Math.PI * 2) / 3) * 0.6] as const);
  const g = shape(16, (u, v) => {
    for (let k = 0; k < 3; k++) {
      const [cx, cy] = corners[k]!;
      const d = Math.hypot(u - cx, v - cy);
      if (d < 0.36) return d < 0.15 ? 7 : [2, 4, 6][k]! - (d > 0.26 ? 1 : 0);
    }
    // 角をつなぐ白い三角の線
    const inTri = corners.every(([cx, cy], k) => {
      const [nx, ny] = corners[(k + 1) % 3]!;
      return (nx - cx) * (v - cy) - (ny - cy) * (u - cx) >= -0.02;
    });
    const nearEdge = corners.some(([cx, cy], k) => {
      const [nx, ny] = corners[(k + 1) % 3]!;
      const len = Math.hypot(nx - cx, ny - cy);
      return Math.abs((nx - cx) * (cy - v) - (cx - u) * (ny - cy)) / len < 0.07;
    });
    return inTri && nearEdge ? 7 : -1;
  });
  return { palette, frameMs: 1000, parts: { main: [toRows(g)] } };
}

/**
 * はかいこうせん: 白と黒が入れ替わりながらチカチカするレーザー（作者の決定 2026年10月23日）。
 * 偶数のコマは白い芯に黒いふち、奇数のコマは黒い芯に白いふち。始まりは丸い光、終わりは広がる光
 */
function hyperBeam(): SpriteOut {
  const H = 12;
  const TILE = 8;
  // 0 黒・1 濃い灰・2 灰・3 明るい灰・4 白
  const palette = ['#0a0a0a', '#3a3a3a', '#8a8a8a', '#d6d6d6', '#ffffff'];
  const mid = (H - 1) / 2;
  const tone = (d: number, inv: boolean): number => {
    const c = d < 0.45 ? 4 : d < 0.7 ? 3 : d < 0.88 ? 2 : 0;
    return inv ? 4 - c : c;
  };
  const start: Grid[] = [];
  const middle: Grid[] = [];
  const end: Grid[] = [];
  for (let f = 0; f < 4; f++) {
    const inv = f % 2 === 1;
    const m = blank(TILE, H);
    for (let x = 0; x < TILE; x++) for (let y = 0; y < H; y++) set(m, x, y, tone(Math.abs(y - mid) / (H / 2), inv));
    middle.push(m);
    // 始まり: 丸く光る口
    const s = blank(TILE, H);
    for (let x = 0; x < TILE; x++) for (let y = 0; y < H; y++) {
      const d = Math.hypot((x - (TILE - 1)) / TILE, (y - mid) / (H / 2));
      if (x >= TILE - 2 || d < 1) set(s, x, y, tone(Math.min(1, Math.abs(y - mid) / (H / 2) + (TILE - 1 - x) * 0.06), inv));
    }
    start.push(s);
    // 終わり: 先で広がって消える光
    const EW = 10;
    const e = blank(EW, H);
    for (let x = 0; x < EW; x++) for (let y = 0; y < H; y++) {
      const half = 1 - x / EW;
      const d = Math.abs(y - mid) / (H / 2);
      if (d < half + 0.15 && (x < 6 || (x + y + f) % 2 === 0)) set(e, x, y, tone(d / Math.max(0.2, half + 0.15), inv));
    }
    end.push(e);
  }
  return { palette, frameMs: 50, parts: { start: start.map(toRows), middle: middle.map(toRows), end: end.map(toRows) } };
}

const out = {
  credit: '自作（scripts/make-move-sprites.ts で計算して描いた。公式の素材は使っていない）',
  sprites: {
    'frenzy-plant': roots(),
    'root-line': rootLine(),
    'water-stream': stream(),
    ember: ember(),
    'water-drop': waterDrop(),
    bubble: bubble(),
    'leaf-line': leafLine('leaf'),
    'petal-line': leafLine('petal'),
    leaf: single(leafLine('leaf')),
    petal: single(leafLine('petal')),
    'tri-orb': triOrb(),
    'hyper-beam': hyperBeam(),
    rock: rock('rock'),
    stone: rock('stone'),
    bone: bone(),
    star: star(),
    needle: needle(),
    sludge: sludge(),
    'shadow-orb': orb('shadow'),
    'aura-orb': orb('aura'),
  } as Record<string, SpriteOut>,
};
writeFileSync(join(ROOT, 'data/render/move-sprites.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`技のドット絵 ${Object.keys(out.sprites).length} 種類を data/render/move-sprites.json に出力しました。`);

// 確認用: 部品ごとにコマを横に並べ、拡大した PNG を書き出す
const previewDir = args.get('preview');
if (previewDir) {
  mkdirSync(previewDir, { recursive: true });
  const SCALE = 8;
  for (const [id, sp] of Object.entries(out.sprites)) {
    const parts = Object.entries(sp.parts);
    const w = Math.max(...parts.map(([, fr]) => fr.reduce((s, f) => s + f[0]!.length + 2, 0)));
    const h = parts.reduce((s, [, fr]) => s + fr[0]!.length + 2, 0);
    const png = new PNG({ width: w * SCALE, height: h * SCALE });
    // 背景は草の色（ゲームの地面に近い色で見る）
    for (let i = 0; i < png.data.length; i += 4) png.data.set([76, 140, 60, 255], i);
    let oy = 0;
    for (const [, frames] of parts) {
      let ox = 0;
      for (const f of frames) {
        f.forEach((row, y) =>
          [...row].forEach((ch, x) => {
            if (ch === '.') return;
            const hex = sp.palette[Number(ch)]!;
            const rgb = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
            for (let yy = 0; yy < SCALE; yy++) for (let xx = 0; xx < SCALE; xx++) png.data.set([...rgb, 255], (((oy + y) * SCALE + yy) * png.width + (ox + x) * SCALE + xx) * 4);
          }),
        );
        ox += f[0]!.length + 2;
      }
      oy += frames[0]!.length + 2;
    }
    writeFileSync(join(previewDir, `${id}.png`), PNG.sync.write(png));
  }
  console.log(`確認用の PNG を ${previewDir} に出力しました。`);
}
