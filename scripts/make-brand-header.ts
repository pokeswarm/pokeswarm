/**
 * SNS のヘッダー画像と、リンクを貼ったときに出る画像（OGP）を作る（作者の依頼 2026年10月22日・23日）。
 * どちらも、プレイ画面と同じ地面にプレイアブルのポケモンを並べる。
 *
 *   node scripts/make-brand-header.ts
 *
 * 入力: public/map/kanto/meadow.png（地面のタイル）・data/render/obstacles.json（木と岩の自作のドット絵）・
 *       public/sprites/<key>/（SpriteCollab のドット絵。待機の動作の下向きの1コマ目）・data/game/playables.json（並べる順）・
 *       assets/brand/logo-400-transparent.png（ロゴのアイコン。scripts/make-brand-icon.ts で作る）
 * 出力: assets/brand/header-1500x500.png（X などのヘッダーの大きさ）
 *       public/og-image.png（1200×630。リンクの画像。真ん中にロゴと「PokéSwarm」の文字の窓を置く）
 * 拡大はプレイ画面と同じ2倍（ニアレストネイバー）。ポケモンのドット絵は SpriteCollab のもので、クレジットは公開しているゲームと同じ。
 * 文字はゲームのフォントを使えないので、5×7 ドットの自作の文字で描く
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** プレイ画面と同じ拡大率 */
const SCALE = 2;
type Rgb = [number, number, number];

function readPng(path: string): PNG {
  return PNG.sync.read(readFileSync(path));
}

class Canvas {
  readonly png: PNG;
  readonly w: number;
  readonly h: number;
  // node の型の取り除き（strip-only）は、引数のプロパティ宣言を読めないので、ふつうに代入する
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.png = new PNG({ width: w, height: h });
  }

  /** src の (sx, sy, sw, sh) を (dx, dy) に scale 倍で重ねる（透明なところは描かない） */
  blit(src: PNG, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, scale: number): void {
    for (let y = 0; y < sh * scale; y++) {
      for (let x = 0; x < sw * scale; x++) {
        const si = ((sy + Math.floor(y / scale)) * src.width + sx + Math.floor(x / scale)) * 4;
        const a = src.data[si + 3]! / 255;
        if (a > 0) this.blend(dx + x, dy + y, [src.data[si]!, src.data[si + 1]!, src.data[si + 2]!], a);
      }
    }
  }

  blend(x: number, y: number, rgb: Rgb, a = 1): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    for (let c = 0; c < 3; c++) this.png.data[i + c] = Math.round(rgb[c]! * a + this.png.data[i + c]! * (1 - a));
    this.png.data[i + 3] = 255;
  }

  rect(x: number, y: number, w: number, h: number, rgb: Rgb, a = 1): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.blend(xx, yy, rgb, a);
  }

  /** 暗くする（影） */
  darken(x: number, y: number, k: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    for (let c = 0; c < 3; c++) this.png.data[i + c] = Math.round(this.png.data[i + c]! * k);
  }

  save(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, PNG.sync.write(this.png));
  }
}

// ---- 地面・木と岩・ポケモン ----

const tile = readPng(join(ROOT, 'public', 'map', 'kanto', 'meadow.png'));
function ground(c: Canvas): void {
  for (let y = 0; y < c.h; y += tile.height * SCALE) for (let x = 0; x < c.w; x += tile.width * SCALE) c.blit(tile, 0, 0, tile.width, tile.height, x, y, SCALE);
}

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
function props(c: Canvas, list: [string, number, number][]): void {
  for (const [name, x, y] of list) {
    const art = pixelArt(name);
    c.blit(art, 0, 0, art.width, art.height, x, y, obstacles.dot);
  }
}

const playables = JSON.parse(readFileSync(join(ROOT, 'data', 'game', 'playables.json'), 'utf8')) as { pokemon: Record<string, { sprite: string }> };
interface Frame {
  png: PNG;
  x: number;
  y: number;
  w: number;
  h: number;
}
/** 待機の動作の下向きの1コマ目（透明なところを切り詰める） */
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

/** ポケモンを足元 (footX, footY) に立たせる（足元にうすい楕円の影） */
function stand(c: Canvas, key: string, footX: number, footY: number): void {
  const f = frameOf(playables.pokemon[key]!.sprite);
  const rx = Math.round((f.w * SCALE) / 3);
  const ry = 5;
  for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) c.darken(Math.round(footX) + x, footY + y, 0.7);
  c.blit(f.png, f.x, f.y, f.w, f.h, Math.round(footX - (f.w * SCALE) / 2), footY - f.h * SCALE + 4, SCALE);
}

/** 2段に、少しずらして並べる */
function lineup(c: Canvas, rowsY: [number, number], margin: number): void {
  const keys = Object.keys(playables.pokemon);
  const perRow = Math.ceil(keys.length / 2);
  const step = Math.floor((c.w - margin * 2) / perRow);
  keys.forEach((key, i) => {
    const row = i < perRow ? 0 : 1;
    const col = row === 0 ? i : i - perRow;
    stand(c, key, margin + step / 2 + col * step + (row === 1 ? step / 2 - 20 : 0), rowsY[row]);
  });
}

// ---- 自作の文字（5×7 ドット）とロゴの窓 ----

const GLYPHS: Record<string, string[]> = {
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  o: ['.....', '.....', '.###.', '#...#', '#...#', '#...#', '.###.'],
  k: ['#....', '#....', '#..#.', '#.#..', '##...', '#.#..', '#..#.'],
  é: ['...#.', '..#..', '.###.', '#...#', '#####', '#....', '.###.'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  w: ['.....', '.....', '#...#', '#...#', '#.#.#', '#.#.#', '.#.#.'],
  a: ['.....', '.....', '.###.', '....#', '.####', '#...#', '.####'],
  r: ['.....', '.....', '#.##.', '##..#', '#....', '#....', '#....'],
  m: ['.....', '.....', '##.#.', '#.#.#', '#.#.#', '#.#.#', '#.#.#'],
};
const YELLOW: Rgb = [248, 208, 48];
const OUTLINE: Rgb = [24, 20, 37];

/** 文字列の幅（ドット） */
function textWidth(text: string): number {
  return [...text].length * 6 - 1;
}

/** 黄色い文字に暗い縁（ゲームのタイトルと同じ見た目） */
function text(c: Canvas, s: string, x: number, y: number, dot: number): void {
  const mask = new Set<string>();
  [...s].forEach((ch, i) => GLYPHS[ch]!.forEach((row, gy) => [...row].forEach((v, gx) => v === '#' && mask.add(`${i * 6 + gx},${gy}`))));
  // 縁: 上下左右に1ドット広げた形を先に暗く塗る
  for (const k of mask) {
    const [gx, gy] = k.split(',').map(Number) as [number, number];
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]] as const) c.rect(x + (gx + ox) * dot, y + (gy + oy) * dot, dot, dot, OUTLINE);
  }
  for (const k of mask) {
    const [gx, gy] = k.split(',').map(Number) as [number, number];
    c.rect(x + gx * dot, y + gy * dot, dot, dot, YELLOW);
  }
}

/** ロゴのアイコン（32×32 ドット）を、logo-400-transparent.png から読み戻す */
function logoGrid(): PNG {
  const big = readPng(join(ROOT, 'assets', 'brand', 'logo-400-transparent.png'));
  const grid = 32;
  const scale = Math.floor(big.width / grid);
  const off = Math.floor((big.width - grid * scale) / 2);
  const png = new PNG({ width: grid, height: grid });
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const si = ((off + y * scale + (scale >> 1)) * big.width + off + x * scale + (scale >> 1)) * 4;
      png.data.set(big.data.subarray(si, si + 4), (y * grid + x) * 4);
    }
  }
  return png;
}

/** タイトル画面のロゴと同じ黒い窓（白い枠） */
function darkWindow(c: Canvas, x: number, y: number, w: number, h: number): void {
  c.rect(x, y, w, h, [248, 248, 248]);
  c.rect(x + 4, y + 4, w - 8, h - 8, [0, 0, 0]);
  c.rect(x + 6, y + 6, w - 12, h - 12, [248, 248, 248]);
  c.rect(x + 8, y + 8, w - 16, h - 16, [0, 0, 0]);
}

// ---- SNS のヘッダー（1500×500） ----
{
  const c = new Canvas(1500, 500);
  ground(c);
  props(c, [
    ['tree', 60, 20],
    ['rock', 300, 40],
    ['tree', 1180, 10],
    ['rock', 1400, 60],
    ['tree', 760, 400],
    ['rock', 120, 420],
    ['tree', 1320, 390],
  ]);
  lineup(c, [250, 360], 60);
  c.save(join(ROOT, 'assets', 'brand', 'header-1500x500.png'));
}

// ---- リンクの画像（OGP。1200×630） ----
{
  const c = new Canvas(1200, 630);
  ground(c);
  props(c, [
    ['tree', 40, 30],
    ['rock', 1080, 60],
    ['tree', 1100, 250],
    ['rock', 30, 280],
  ]);
  // 上の真ん中に、ロゴと文字の窓
  const dot = 10;
  const logoScale = 3;
  const tw = textWidth('PokéSwarm') * dot;
  const boxW = 32 * logoScale + 24 + tw + 64;
  const boxH = 32 * logoScale + 48;
  const bx = Math.round((c.w - boxW) / 2);
  const by = 60;
  darkWindow(c, bx, by, boxW, boxH);
  const logo = logoGrid();
  c.blit(logo, 0, 0, 32, 32, bx + 32, by + 24, logoScale);
  text(c, 'PokéSwarm', bx + 32 + 32 * logoScale + 24, by + Math.round((boxH - 7 * dot) / 2), dot);
  lineup(c, [400, 530], 64);
  c.save(join(ROOT, 'public', 'og-image.png'));
}

console.log('assets/brand/header-1500x500.png と public/og-image.png に書き出しました');
