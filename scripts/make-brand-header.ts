/**
 * SNS のヘッダー画像（作者の依頼 2026年10月22日）: プレイ画面と同じ地面に、プレイアブルのポケモンを並べる。
 *
 *   node scripts/make-brand-header.ts
 *
 * 入力: public/map/kanto/meadow.png（地面のタイル）・data/render/obstacles.json（木と岩の自作のドット絵）・
 *       public/sprites/<key>/（SpriteCollab のドット絵。待機の動作の下向きの1コマ目）・data/game/playables.json（並べる順）
 * 出力: assets/brand/header-1500x500.png（X などのヘッダーの大きさ）
 * 拡大はプレイ画面と同じ2倍（ニアレストネイバー）。ポケモンのドット絵は SpriteCollab のもので、クレジットは公開しているゲームと同じ
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = 1500;
const H = 500;
/** プレイ画面と同じ拡大率 */
const SCALE = 2;
const out = new PNG({ width: W, height: H });

/** src の (sx, sy, sw, sh) を、out の (dx, dy) に scale 倍で重ねる（透明なところは描かない） */
function blit(src: PNG, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, scale: number): void {
  for (let y = 0; y < sh * scale; y++) {
    for (let x = 0; x < sw * scale; x++) {
      const ox = dx + x;
      const oy = dy + y;
      if (ox < 0 || oy < 0 || ox >= W || oy >= H) continue;
      const si = ((sy + Math.floor(y / scale)) * src.width + sx + Math.floor(x / scale)) * 4;
      const a = src.data[si + 3]! / 255;
      if (a === 0) continue;
      const oi = (oy * W + ox) * 4;
      for (let c = 0; c < 3; c++) out.data[oi + c] = Math.round(src.data[si + c]! * a + out.data[oi + c]! * (1 - a));
      out.data[oi + 3] = 255;
    }
  }
}

function readPng(path: string): PNG {
  return PNG.sync.read(readFileSync(path));
}

// 地面（プレイ画面の最初の区間と同じ草原）
const tile = readPng(join(ROOT, 'public', 'map', 'kanto', 'meadow.png'));
for (let y = 0; y < H; y += tile.height * SCALE) for (let x = 0; x < W; x += tile.width * SCALE) blit(tile, 0, 0, tile.width, tile.height, x, y, SCALE);

// 木と岩（自作のドット絵）を上と下の端に少し
const obstacles = JSON.parse(readFileSync(join(ROOT, 'data', 'render', 'obstacles.json'), 'utf8')) as { dot: number; palette: Record<string, string>; sprites: Record<string, string[]> };
function pixelArt(name: string): PNG {
  const rows = obstacles.sprites[name]!;
  const png = new PNG({ width: rows[0]!.length, height: rows.length });
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const hex = obstacles.palette[ch];
      if (!hex) return;
      const rgb = [1, 3, 5].map((p) => parseInt(hex.slice(p, p + 2), 16));
      const a = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) : 255;
      png.data.set([...rgb, a], (y * png.width + x) * 4);
    }),
  );
  return png;
}
const props: [string, number, number][] = [
  ['tree', 60, 20],
  ['rock', 300, 40],
  ['tree', 1180, 10],
  ['rock', 1400, 60],
  ['tree', 760, 400],
  ['rock', 120, 420],
  ['tree', 1320, 390],
];
for (const [name, x, y] of props) {
  const art = pixelArt(name);
  blit(art, 0, 0, art.width, art.height, x, y, obstacles.dot);
}

// プレイアブルのポケモン（待機の動作の下向きの1コマ目。透明なところを切り詰める）
const playables = JSON.parse(readFileSync(join(ROOT, 'data', 'game', 'playables.json'), 'utf8')) as { pokemon: Record<string, { sprite: string }> };
interface Frame {
  png: PNG;
  x: number;
  y: number;
  w: number;
  h: number;
}
function frameOf(sprite: string): Frame {
  const base = join(ROOT, 'public', 'sprites', sprite);
  const anims = JSON.parse(readFileSync(join(base, 'anims.json'), 'utf8')) as { animations: Record<string, { frameKeyPrefix: string }> };
  const atlas = JSON.parse(readFileSync(join(base, 'atlas.json'), 'utf8')) as { frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }> };
  const f = atlas.frames[`${anims.animations.Idle!.frameKeyPrefix}/0/0`]!.frame;
  const png = readPng(join(base, 'atlas.png'));
  let x0 = f.w;
  let y0 = f.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      if (png.data[((f.y + y) * png.width + f.x + x) * 4 + 3] === 0) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return { png, x: f.x + x0, y: f.y + y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** 足元の影（プレイ画面と同じく、うすい楕円） */
function shadow(cx: number, cy: number, rx: number, ry: number): void {
  for (let y = -ry; y <= ry; y++) {
    for (let x = -rx; x <= rx; x++) {
      if ((x * x) / (rx * rx) + (y * y) / (ry * ry) > 1) continue;
      const i = ((cy + y) * W + cx + x) * 4;
      for (let c = 0; c < 3; c++) out.data[i + c] = Math.round(out.data[i + c]! * 0.7);
    }
  }
}

// 2段に、少しずらして並べる（真ん中寄り。SNS のアイコンが重なる左下は低めの段の端になる）
const keys = Object.keys(playables.pokemon);
const perRow = Math.ceil(keys.length / 2);
const step = Math.floor((W - 120) / perRow);
keys.forEach((key, i) => {
  const row = i < perRow ? 0 : 1;
  const col = row === 0 ? i : i - perRow;
  const f = frameOf(playables.pokemon[key]!.sprite);
  const footX = 60 + step / 2 + col * step + (row === 1 ? step / 2 - 20 : 0);
  const footY = row === 0 ? 250 : 360;
  shadow(Math.round(footX), footY, Math.round((f.w * SCALE) / 3), 5);
  blit(f.png, f.x, f.y, f.w, f.h, Math.round(footX - (f.w * SCALE) / 2), footY - f.h * SCALE + 4, SCALE);
});

const dir = join(ROOT, 'assets', 'brand');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'header-1500x500.png'), PNG.sync.write(out));
console.log(`${dir}/header-1500x500.png に書き出しました`);
