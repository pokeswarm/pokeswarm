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

const out = {
  credit: '自作（scripts/make-move-sprites.ts で計算して描いた。公式の素材は使っていない）',
  sprites: {
    'frenzy-plant': roots(),
    'root-line': rootLine(),
    'water-stream': stream(),
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
