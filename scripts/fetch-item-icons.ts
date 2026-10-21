/**
 * 持ち物のアイコンのドット絵を作る（作者の決定。2026年10月21日）。
 *
 *   npm run item-icons
 *
 * PokeAPI の公式のアイテム画像（PokeAPI/sprites の items）を取得し、色合いで分かる低解像度のドット絵（size × size）に縮める。
 * 入力: data/game/items.json（持ち物のキー）
 * 出力: data/render/item-icons.json（1文字が1ドットの表と色。クレジットの文も入れる）
 * 取得した画像は scripts/.cache/item-sprites/ に保存し、再取得しない。
 * 権利は任天堂・クリーチャーズ・ゲームフリーク・株式会社ポケモンに帰属する（00_vision.md 4章。クレジットに出す）。
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts', '.cache');
/** 出来上がりの大きさ（アイコンの枠の内側） */
const SIZE = 14;
/** この不透明度より薄いところは透明にする */
const ALPHA_MIN = 0.45;
/** 1つのアイコンで使う色の数（似た色をまとめ、ドット絵らしくする） */
const COLORS = 10;
const PALETTE_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

async function cached(path: string, url: string): Promise<Buffer> {
  if (existsSync(path)) return readFile(path);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} を取得できません（${res.status}）`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buf);
  return buf;
}

async function spriteUrl(key: string): Promise<string> {
  const json = JSON.parse((await cached(join(CACHE, 'pokeapi', 'item', `${key}.json`), `https://pokeapi.co/api/v2/item/${key}`)).toString('utf8')) as {
    sprites: { default: string | null };
  };
  if (!json.sprites.default) throw new Error(`持ち物 ${key} の画像がありません`);
  return json.sprites.default;
}

/** 色を COLORS 色にまとめる（k 平均法。初めの代表は明るさの順に等間隔に選ぶので、毎回同じ結果になる） */
function reduce(colors: [number, number, number][]): [number, number, number][] {
  const lum = (c: [number, number, number]): number => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  const sorted = [...colors].sort((a, b) => lum(a) - lum(b));
  const k = Math.min(COLORS, sorted.length);
  let centers = Array.from({ length: k }, (_, i) => sorted[Math.floor(((i + 0.5) * sorted.length) / k)]!);
  const nearest = (c: [number, number, number]): number => {
    let best = 0;
    let bd = Infinity;
    centers.forEach((m, i) => {
      const d = (c[0] - m[0]) ** 2 + (c[1] - m[1]) ** 2 + (c[2] - m[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };
  for (let it = 0; it < 12; it++) {
    const sum = centers.map((): [number, number, number, number] => [0, 0, 0, 0]);
    for (const c of colors) {
      const s = sum[nearest(c)]!;
      s[0] += c[0];
      s[1] += c[1];
      s[2] += c[2];
      s[3]++;
    }
    centers = centers.map((m, i) => (sum[i]![3]! ? [sum[i]![0]! / sum[i]![3]!, sum[i]![1]! / sum[i]![3]!, sum[i]![2]! / sum[i]![3]!] : m) as [number, number, number]);
  }
  return colors.map((c) => centers[nearest(c)]!.map(Math.round) as [number, number, number]);
}

/** 画像の不透明な部分を切り出し、縦横比を保って SIZE × SIZE に縮める（ドットごとに、元の範囲の色を不透明度で重み付けして平均） */
function shrink(png: PNG): { rows: string[]; palette: Record<string, string> } {
  const { width: w, height: h, data } = png;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3]! < 16) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const scale = Math.max(bw, bh) / SIZE;
  // 縮めた後の大きさと、真ん中に置くためのずれ
  const ow = Math.max(1, Math.round(bw / scale));
  const oh = Math.max(1, Math.round(bh / scale));
  const offX = Math.floor((SIZE - ow) / 2);
  const offY = Math.floor((SIZE - oh) / 2);
  // まず縮めたドットの色を集め、色の数をまとめてから表にする
  const cells: ([number, number, number] | null)[] = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const tx = x - offX;
      const ty = y - offY;
      if (tx < 0 || ty < 0 || tx >= ow || ty >= oh) {
        cells.push(null);
        continue;
      }
      // 元の画像の範囲 [sx0, sx1) × [sy0, sy1)
      const sx0 = x0 + (tx * bw) / ow;
      const sx1 = x0 + ((tx + 1) * bw) / ow;
      const sy0 = y0 + (ty * bh) / oh;
      const sy1 = y0 + ((ty + 1) * bh) / oh;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) {
        for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
          const i = (sy * w + sx) * 4;
          const al = data[i + 3]! / 255;
          r += data[i]! * al;
          g += data[i + 1]! * al;
          b += data[i + 2]! * al;
          a += al;
          n++;
        }
      }
      cells.push(n === 0 || a / n < ALPHA_MIN ? null : [r / a, g / a, b / a]);
    }
  }
  const opaque = cells.filter((c): c is [number, number, number] => c !== null);
  const reduced = reduce(opaque);
  const palette: Record<string, string> = {};
  const index = new Map<string, string>();
  const rows: string[] = [];
  let k = 0;
  for (let y = 0; y < SIZE; y++) {
    let row = '';
    for (let x = 0; x < SIZE; x++) {
      if (!cells[y * SIZE + x]) {
        row += '.';
        continue;
      }
      const c = reduced[k++]!;
      const hex = `#${c.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
      let ch = index.get(hex);
      if (!ch) {
        ch = PALETTE_CHARS[index.size]!;
        index.set(hex, ch);
        palette[ch] = hex;
      }
      row += ch;
    }
    rows.push(row);
  }
  return { rows, palette };
}

const items = JSON.parse(await readFile(join(ROOT, 'data', 'game', 'items.json'), 'utf8')) as { items: Record<string, unknown> };
const out: Record<string, { palette: Record<string, string>; rows: string[] }> = {};
for (const key of Object.keys(items.items)) {
  const url = await spriteUrl(key);
  const png = PNG.sync.read(await cached(join(CACHE, 'item-sprites', `${key}.png`), url));
  out[key] = shrink(png);
  console.log(`${key.padEnd(16)} ${Object.keys(out[key]!.palette).length} 色`);
}
await writeFile(
  join(ROOT, 'data', 'render', 'item-icons.json'),
  JSON.stringify(
    {
      size: SIZE,
      source: 'https://github.com/PokeAPI/sprites (sprites/items)',
      credit: 'Item images © Nintendo / Creatures Inc. / GAME FREAK inc. / The Pokémon Company (via PokeAPI/sprites)',
      items: out,
    },
    null,
    2,
  ) + '\n',
);
console.log(`持ち物 ${Object.keys(out).length} 個を data/render/item-icons.json に出力しました。`);
