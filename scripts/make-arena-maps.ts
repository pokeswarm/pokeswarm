/**
 * 伝説戦の固定マップの絵（07 の205章）を、計算で描いて書き出す（生成AIを使わない自作のドット絵。公式の背景は使わない）。
 * 乱数はシード付きなので、何度実行しても同じ絵になる。
 *
 *   npm run arena-maps
 *
 * 出力（public/map/<地方>/）:
 * - arena-<id>-floor.png  床（マップの広さぴったり。不透明）
 * - arena-<id>-wall.png   壁（床より MARGIN ドット外まで。真ん中は透明。技の絵のはみ出しを隠すので、技より手前に描く）
 * - arena-<id>-shimmer-a.png・-b.png  水のきらめき（透明の上に光る点だけ。交互にゆっくり濃くして水を動かす）
 *
 * 絵の 1 ドットはワールドの 2 ピクセル（床 800×440 → マップ 1600×880）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

type Rgb = readonly [number, number, number];
const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const W = 800;
const H = 440;
/** 壁の絵が床より外へ出す幅（ドット）。引きのカメラでも外の暗い所が見えにくいように */
const MARGIN = 60;

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(seed + 0x9e3779b9, 0x5bd1e995);
  h = Math.imul(h ^ ix, 0x5bd1e995);
  h ^= h >>> 15;
  h = Math.imul(h ^ iy, 0x5bd1e995);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const s = (t: number) => t * t * (3 - 2 * t);
  const tx = s(x - x0), ty = s(y - y0);
  const a = hash2(x0, y0, seed), b = hash2(x0 + 1, y0, seed), c = hash2(x0, y0 + 1, seed), d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** 大きいむらと小さいむらを重ねたノイズ（0〜1） */
function fbm(x: number, y: number, seed: number): number {
  return valueNoise(x, y, seed) * 0.55 + valueNoise(x * 2.1, y * 2.1, seed + 1) * 0.3 + valueNoise(x * 4.3, y * 4.3, seed + 2) * 0.15;
}

/** 一番近い種（岩の塊）。edge は隣の塊との境までの距離（ひび割れ）、id は種の番号、dx・dy は種への向き */
function worley(x: number, y: number, cell: number, seed: number): { edge: number; id: number; dx: number; dy: number } {
  const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
  const seeds: { px: number; py: number; d: number; id: number }[] = [];
  for (let j = cy - 2; j <= cy + 2; j++) for (let i = cx - 2; i <= cx + 2; i++) {
    const px = (i + hash2(i, j, seed)) * cell, py = (j + hash2(i, j, seed + 7)) * cell;
    seeds.push({ px, py, d: Math.hypot(px - x, py - y), id: i * 7919 + j });
  }
  seeds.sort((a, b) => a.d - b.d);
  const a = seeds[0]!;
  let edge = Infinity;
  for (const b of seeds.slice(1)) {
    const gap = Math.hypot(a.px - b.px, a.py - b.py);
    if (gap > 0) edge = Math.min(edge, (b.d * b.d - a.d * a.d) / (2 * gap));
  }
  return { edge, id: a.id, dx: a.px - x, dy: a.py - y };
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** 0〜1 の値を色の段に分ける（段の境目は格子状に混ぜる。ドット絵の陰影） */
function ramp(colors: readonly Rgb[], t: number, x: number, y: number, dither = 0.6): Rgb {
  const n = colors.length - 1;
  const v = Math.max(0, Math.min(0.999, t)) * n + ((BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16 - 0.5) * dither;
  return colors[Math.max(0, Math.min(n, Math.round(v)))]!;
}

function toPng(px: readonly (Rgb | null)[], w: number, h: number): Buffer {
  const png = new PNG({ width: w, height: h });
  px.forEach((p, i) => {
    png.data[i * 4] = p?.[0] ?? 0;
    png.data[i * 4 + 1] = p?.[1] ?? 0;
    png.data[i * 4 + 2] = p?.[2] ?? 0;
    png.data[i * 4 + 3] = p ? 255 : 0;
  });
  return PNG.sync.write(png, { colorType: 6 });
}

// --- ルギア: うずまきじまの奥（潮が引いた岩棚に、渦の形の浅瀬が残る） ---

const ROCK = ['#2b3948', '#334353', '#3c4e5f', '#46596b', '#526779'].map(hex);
const WATER = ['#193f52', '#1d4a5c', '#225769', '#276477'].map(hex);
const CRACK = hex('#222e3b');
const CRACK_LIGHT = hex('#5d7386');
const WATER_SHADE = hex('#163b4d');
const WATER_EDGE = hex('#4f95a5');
const RIM = hex('#6a8294');

const u = (x: number) => x - W / 2;
/** 横長のマップに渦を広げるので、縦を詰めて測る */
const v = (y: number) => (y - H / 2) * 1.75;

/** 渦の腕の場所（0 なら岩、0〜1 は水の深さ）。真ん中はルギアが降りる岩場で、水を置かない */
function channelDepth(x: number, y: number): number {
  const r = Math.hypot(u(x), v(y));
  if (r < 62) return 0;
  const warp = (fbm(x / 70, y / 70, 11) - 0.5) * 1.5;
  const phase = Math.atan2(v(y), u(x)) * 3 + Math.log(r / 40 + 1) * 5.2 + warp;
  const s = Math.sin(phase);
  const out = r / (W / 2);
  // 外へ行くほど細く、途切れる
  const thresh = 0.42 + Math.max(0, out - 0.45) * 0.75 + Math.max(0, (92 - r) / 30) * 0.5 + (fbm(x / 26, y / 26, 13) - 0.5) * 0.55;
  return s > thresh ? Math.min(1, (s - thresh) / Math.max(0.12, 1 - thresh)) : 0;
}

function lugiaFloor(): { floor: Rgb[]; shimmerA: (Rgb | null)[]; shimmerB: (Rgb | null)[] } {
  const depth = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) depth[y * W + x] = channelDepth(x, y);
  const wet = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && depth[y * W + x]! > 0;

  const floor: Rgb[] = [];
  const shimmerA: (Rgb | null)[] = [];
  const shimmerB: (Rgb | null)[] = [];
  const glintA = hex('#8fd3df');
  const glintB = hex('#c9eef2');

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const r = Math.hypot(u(x), v(y));
    const out = r / (W / 2);
    let col: Rgb;
    let glint = 0;
    const d = depth[y * W + x]!;
    if (d > 0) {
      col = ramp(WATER, 0.15 + d * 0.8 + (fbm(x / 18, y / 18, 21) - 0.5) * 0.35, x, y);
      if (!wet(x, y - 1) || !wet(x, y - 2)) col = WATER_SHADE; // 上の岩の影
      else if (!wet(x, y + 1)) col = WATER_EDGE; // 手前のふちの波
      // きらめき: 流れに沿った短い線を、まばらに置く。腕と同じ向きの筋（phase が同じ線）を、ノイズで切って短くする
      const phase = Math.atan2(v(y), u(x)) * 3 + Math.log(r / 40 + 1) * 5.2 + (fbm(x / 40, y / 40, 23) - 0.5) * 1.2;
      const lane = Math.floor((phase * 5) / Math.PI);
      const inLane = Math.sin(phase * 10) > 0.86;
      const pos = Math.log(r / 40 + 1) * 26;
      if (d > 0.25 && inLane) {
        if (valueNoise(pos, lane, 25) > 0.78) glint = 1;
        else if (valueNoise(pos, lane, 27) > 0.78) glint = 2;
      }
    } else {
      // 岩: 大きいむら＋岩板ごとの明るさ＋真ん中ほど明るい（天井の穴からの光）
      const slab = worley(x, y, 46, 31);
      const base = 0.42 + (fbm(x / 60, y / 60, 33) - 0.5) * 0.9 + (hash2(slab.id, 1, 35) - 0.5) * 0.28;
      const light = 0.22 * Math.max(0, 1 - out * 1.5) - 0.2 * Math.max(0, out - 0.75);
      col = ramp(ROCK, base + light, x, y);
      // 岩板の割れ目（どこでも引くと石畳に見えるので、むらの濃い所だけ）
      const cracked = fbm(x / 48, y / 48, 37) > 0.5;
      if (cracked && slab.edge < 0.7) col = CRACK;
      else if (cracked && slab.edge < 1.7 && slab.dy < 0) col = CRACK_LIGHT;
      // 細かい欠け
      const grit = hash2(x, y, 39);
      if (grit < 0.012) col = ROCK[0]!;
      else if (grit > 0.992) col = ROCK[4]!;
      // 水路の上のふちは水に磨かれて明るい
      if (wet(x, y + 1) || wet(x, y + 2)) col = RIM;
    }
    // 壁ぎわの影（上の壁が高いので、上を長く）
    const edgeD = Math.min(x, W - 1 - x);
    const top = y;
    const bottom = H - 1 - y;
    const shade = Math.max(0, 1 - top / 26) * 0.7 + Math.max(0, 1 - edgeD / 14) * 0.55 + Math.max(0, 1 - bottom / 7) * 0.45;
    const threshold = (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16;
    if (shade > threshold) col = [Math.round(col[0] * 0.62), Math.round(col[1] * 0.62), Math.round(col[2] * 0.68)];
    floor.push(col);
    shimmerA.push(glint === 1 ? glintA : null);
    shimmerB.push(glint === 2 ? glintB : null);
  }

  // 岩の上の小物（避ける物に見えないよう、小さく少なく）
  const stamp = (cx: number, cy: number, rows: readonly string[], colors: Readonly<Record<string, Rgb>>) => {
    rows.forEach((row, dy) => [...row].forEach((ch, dx) => {
      const c = colors[ch];
      const px = cx + dx, py = cy + dy;
      if (c && px >= 0 && py >= 0 && px < W && py < H) floor[py * W + px] = c;
    }));
  };
  const sets: { rows: readonly (readonly string[])[]; colors: Readonly<Record<string, Rgb>>; groups: number }[] = [
    // フジツボの群れ
    { rows: [['.a.a.', 'abbab', '.a.a.', 'a.a..', 'b.ab.'], ['a.a', 'bab', '.a.']], colors: { a: hex('#8796a3'), b: hex('#3a4856') }, groups: 16 },
    // 海藻
    { rows: [['g..g.', 'g.g..', '.gg.g', '.dgd.', '..d..'], ['.g.', 'g.g', '.g.', '.d.']], colors: { g: hex('#3f7a68'), d: hex('#2b5a4d') }, groups: 14 },
    // 貝がら・小石
    { rows: [['.pp.', 'pqqp', '.rr.'], ['ss.', 'stt', '.t.']], colors: { p: hex('#c8a9a0'), q: hex('#957a78'), r: hex('#5e4f55'), s: hex('#6a7f91'), t: hex('#37475a') }, groups: 12 },
  ];
  let n = 0;
  const rand = () => hash2(n++, 7, 41);
  sets.forEach((set) => {
    for (let c = 0; c < set.groups; c++) {
      const gx = 12 + rand() * (W - 24);
      const gy = 34 + rand() * (H - 50);
      const items = 3 + Math.floor(rand() * 6);
      for (let i = 0; i < items; i++) {
        const x = Math.round(gx + (rand() - 0.5) * 34);
        const y = Math.round(gy + (rand() - 0.5) * 22);
        const rows = set.rows[Math.floor(rand() * set.rows.length)]!;
        if (Math.hypot(u(x), v(y)) < 62) continue;
        if (wet(x, y) || wet(x + 5, y) || wet(x, y + 5) || wet(x + 5, y + 5) || wet(x, y + 7) || wet(x + 5, y + 7)) continue;
        stamp(x, y, rows, set.colors);
      }
    }
  });
  return { floor, shimmerA, shimmerB };
}

const WALL_ROCK = ['#141c28', '#1c2734', '#263443', '#324355', '#435769'].map(hex);

/** 壁が床へ張り出す幅（0〜INSET_MAX ドット）。床の端の位置ごとに決まる。歩ける端は直線だが、絵は岩の形にする */
const INSET_MAX = 5;
const inset = (p: number, seed: number) => Math.floor(Math.pow(fbm(p / 11, seed, 67), 1.6) * (INSET_MAX + 2.5));

function lugiaWall(): (Rgb | null)[] {
  const fw = W + MARGIN * 2;
  const fh = H + MARGIN * 2;
  const out: (Rgb | null)[] = [];
  const dark = hex('#0b1020');
  const rimLight = hex('#7d97a8');
  const rimDark = hex('#1a2430');
  const fallCols = ['#3f8096', '#6fb4c4', '#a9dde5', '#6fb4c4', '#3f8096'].map(hex);
  // 上の壁を流れ落ちる水。真ん中の 1 本は渦の水路へ注ぐ
  const falls = [
    { x: MARGIN + 432, w: 6 },
    { x: MARGIN + 92, w: 3 },
    { x: MARGIN + 640, w: 4 },
  ];
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
    const ix = x - MARGIN, iy = y - MARGIN;
    // 床の端からの距離（内側へ張り出す分を足す。0 以下は床が見える）
    const fromLeft = inset(iy, 1) - ix;
    const fromRight = ix - (W - 1 - inset(iy, 2));
    const fromTop = inset(ix, 3) - iy;
    const fromBottom = iy - (H - 1 - inset(ix, 4));
    const dist = Math.max(fromLeft, fromRight, fromTop, fromBottom);
    if (dist <= 0) {
      out.push(null);
      continue;
    }
    const isTop = fromTop >= Math.max(fromLeft, fromRight, fromBottom);
    const size = isTop ? 26 : 20;
    const stone = worley(x, y, size, 53);
    // 岩の塊: 左上が明るく、右下が暗い丸み
    const round = (stone.dx + stone.dy) / size;
    let t = 0.5 + round * 0.42 + (hash2(stone.id, 2, 55) - 0.5) * 0.25 + (fbm(x / 30, y / 30, 57) - 0.5) * 0.3;
    // 上の壁は地層の横じま
    if (isTop) t += Math.sin(y * 0.55 + fbm(x / 40, y / 12, 59) * 7) * 0.11;
    // 外ほど暗い
    t -= Math.max(0, dist - 8) * 0.012;
    let col = ramp(WALL_ROCK, t, x, y);
    if (stone.edge < 0.8) col = WALL_ROCK[0]!;
    if (dist > MARGIN - 14 && (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16 < (dist - (MARGIN - 14)) / 14) col = dark;
    // 床との境: ぬれて明るい岩のふち。歩ける端が分かるように
    if (dist <= 1) col = rimDark;
    else if (dist <= 2.5) col = rimLight;
    else if (dist <= 4 && stone.edge >= 0.8) col = WALL_ROCK[4]!;
    // 流れ落ちる水
    if (iy < 2) {
      for (const f of falls) {
        const sway = Math.round((fbm(f.x / 50, y / 22, 63) - 0.5) * 4);
        const k = x - (f.x + sway);
        // 下へ行くほど広がる
        const spread = iy > -8 ? 1 : 0;
        if (k >= -spread && k < f.w + spread && y > 22) {
          const c = fallCols[Math.min(4, Math.max(0, Math.round(((k + spread + 0.5) / (f.w + spread * 2)) * 4)))]!;
          col = hash2(x, (y + (x & 1) * 3) >> 2, 65) > 0.12 ? c : fallCols[0]!;
        }
      }
    }
    out.push(col);
  }
  return out;
}

const outDir = path.join('public', 'map', 'johto');
fs.mkdirSync(outDir, { recursive: true });
const { floor, shimmerA, shimmerB } = lugiaFloor();
const wall = lugiaWall();
fs.writeFileSync(path.join(outDir, 'arena-lugia-floor.png'), toPng(floor, W, H));
fs.writeFileSync(path.join(outDir, 'arena-lugia-shimmer-a.png'), toPng(shimmerA, W, H));
fs.writeFileSync(path.join(outDir, 'arena-lugia-shimmer-b.png'), toPng(shimmerB, W, H));
fs.writeFileSync(path.join(outDir, 'arena-lugia-wall.png'), toPng(wall, W + MARGIN * 2, H + MARGIN * 2));
for (const f of ['floor', 'shimmer-a', 'shimmer-b', 'wall']) {
  console.log(`${outDir}/arena-lugia-${f}.png ${Math.round(fs.statSync(path.join(outDir, `arena-lugia-${f}.png`)).size / 1024)}KB`);
}

// 床と壁を重ねた確認用の絵（第 1 引数のパスへ。リポジトリに入れない）
const previewPath = process.argv[2];
if (previewPath) {
  const fw = W + MARGIN * 2;
  const fh = H + MARGIN * 2;
  const merged: (Rgb | null)[] = wall.slice();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) merged[(y + MARGIN) * fw + x + MARGIN] = floor[y * W + x]!;
  fs.writeFileSync(previewPath, toPng(merged, fw, fh));
}
