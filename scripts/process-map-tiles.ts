/**
 * 生成AIで作ったマップのタイル画像（assets/map/<地方>/）を、ゲームで使うサイズに整える。
 *   1. 各ブロックの中央付近の平均色で TILE×TILE に縮小（ドットの境界のにじみを避ける）
 *   2. COLORS 色に減色（ディザなし）
 *   3. 継ぎ目の確認用に 3×3 に並べた（assets/map/<地方>/preview/ に出力）プレビューも出力
 * 使い方: node scripts/process-map-tiles.ts [地方名=kanto]
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const TILE = 128;
const COLORS = 32;
/** ブロックのうち、色を拾う中央部分の割合 */
const CENTER = 0.5;

/** 元ファイル名 → 出力名（ステージのタイル ID） */
const NAMES: Record<string, string> = {
  'grassy_meadow_ground.png': 'meadow.png',
  'rocky_cave_floor.png': 'cave.png',
  'dark_forest.png': 'night_forest.png',
  'barren_wasteland_ground.png': 'wasteland.png',
  'sandy_beach_ground.png': 'beach.png',
  'elite_hall_floor.png': 'elite_hall.png',
};

type Rgb = [number, number, number];

function downscale(src: PNG, size: number): Rgb[] {
  const out: Rgb[] = [];
  const bw = src.width / size;
  const bh = src.height / size;
  for (let ty = 0; ty < size; ty++) {
    for (let tx = 0; tx < size; tx++) {
      const x0 = Math.floor((tx + (1 - CENTER) / 2) * bw);
      const x1 = Math.max(x0 + 1, Math.ceil((tx + (1 + CENTER) / 2) * bw));
      const y0 = Math.floor((ty + (1 - CENTER) / 2) * bh);
      const y1 = Math.max(y0 + 1, Math.ceil((ty + (1 + CENTER) / 2) * bh));
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * src.width + x) * 4;
          r += src.data[i]!; g += src.data[i + 1]!; b += src.data[i + 2]!; n++;
        }
      }
      out.push([r / n, g / n, b / n]);
    }
  }
  return out;
}

const dist2 = (a: Rgb, b: Rgb) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** k-means（初期値は色の頻度の高い順に、離れた色を選ぶ） */
function buildPalette(pixels: Rgb[], k: number): Rgb[] {
  const bins = new Map<number, { c: Rgb; n: number }>();
  for (const p of pixels) {
    const key = ((p[0] >> 3) << 10) | ((p[1] >> 3) << 5) | (p[2] >> 3);
    const e = bins.get(key);
    if (e) e.n++; else bins.set(key, { c: p, n: 1 });
  }
  const sorted = [...bins.values()].sort((a, b) => b.n - a.n);
  const centers: Rgb[] = [];
  for (const e of sorted) {
    if (centers.every((c) => dist2(c, e.c) > 12 * 12)) centers.push(e.c);
    if (centers.length === k) break;
  }
  for (let it = 0; it < 12; it++) {
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (const p of pixels) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < centers.length; i++) {
        const d = dist2(p, centers[i]!);
        if (d < bd) { bd = d; best = i; }
      }
      const s = sum[best]!;
      s[0]! += p[0]; s[1]! += p[1]; s[2]! += p[2]; s[3]!++;
    }
    sum.forEach((s, i) => { if (s[3]) centers[i] = [s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!]; });
  }
  return centers.map((c) => [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])]);
}

function nearest(p: Rgb, palette: Rgb[]): Rgb {
  let best = palette[0]!, bd = Infinity;
  for (const c of palette) {
    const d = dist2(p, c);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function toPng(pixels: Rgb[], w: number, h: number): PNG {
  const png = new PNG({ width: w, height: h });
  pixels.forEach((p, i) => {
    png.data[i * 4] = p[0]; png.data[i * 4 + 1] = p[1]; png.data[i * 4 + 2] = p[2]; png.data[i * 4 + 3] = 255;
  });
  return png;
}

const region = process.argv[2] ?? 'kanto';
const inDir = path.join('assets', 'map', region);
const outDir = path.join('public', 'map', region);
const previewDir = path.join(inDir, 'preview');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(previewDir, { recursive: true });

for (const [file, outName] of Object.entries(NAMES)) {
  const src = PNG.sync.read(fs.readFileSync(path.join(inDir, file)));
  const small = downscale(src, TILE);
  const palette = buildPalette(small, COLORS);
  const tile = small.map((p) => nearest(p, palette));
  fs.writeFileSync(path.join(outDir, outName), PNG.sync.write(toPng(tile, TILE, TILE)));

  const preview: Rgb[] = [];
  for (let y = 0; y < TILE * 3; y++) for (let x = 0; x < TILE * 3; x++) preview.push(tile[(y % TILE) * TILE + (x % TILE)]!);
  fs.writeFileSync(path.join(previewDir, outName), PNG.sync.write(toPng(preview, TILE * 3, TILE * 3)));
  console.log(`${file} -> ${outName} (${TILE}x${TILE}, ${palette.length}色)`);
}
