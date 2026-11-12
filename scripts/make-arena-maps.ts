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

// --- ホウオウ: スズのとうの最上階（暗い板張りの床に、金の象嵌で尾羽の紋。まわりは朱の欄干と屋根瓦、その向こうに夕暮れの空。07 の209章） ---

/** 炎の色（赤・橙・青白・虹）と重ならないよう、床は暗く、色の薄い古い木の茶にする */
const PLANK = ['#231a1a', '#2c2120', '#352928', '#3f3130', '#4a3a37'].map(hex);
const SEAM = hex('#150f15');
const SEAM_LIGHT = hex('#443532');
const INLAY = ['#574528', '#766036', '#967c45'].map(hex);

/** 紋の半径（ドット）。縦のマップに収まる */
const DISC_R = 180;
const PLANK_H = 14;
const PLANK_LEN = 96;

/** 床の金の線か（0 ではない。1 = 暗い線・2 = ふつう・3 = 明るい） */
function hoohInlay(x: number, y: number): number {
  const dx = x - W / 2 + 0.5;
  const dy = y - H / 2 + 0.5;
  const r = Math.hypot(dx, dy);
  const a = Math.atan2(dy, dx);
  // 外の輪と内の輪
  if (Math.abs(r - DISC_R) < 1.1) return 3;
  if (Math.abs(r - (DISC_R - 5)) < 0.7) return 1;
  if (Math.abs(r - 134) < 1) return 2;
  if (Math.abs(r - 126) < 0.7) return 1;
  // 輪の間の菱形（30 度ごと）
  const sec30 = Math.PI / 6;
  const a30 = a - Math.round(a / sec30) * sec30;
  if (Math.abs(a30 * 130) + Math.abs(r - 130) < 3.6) return 3;
  // 尾羽 12 枚（真ん中から外へ）
  const t = (r - 34) / 88;
  if (t >= 0 && t <= 1) {
    const sec = Math.PI / 6;
    // 同じ向きへ曲げる（花びらでなく、回る尾羽に見せる）
    const ang = a - sec / 2 - (t * t * 0.42);
    const k = Math.round(ang / sec);
    const off = (ang - k * sec) * r;
    const half = 13 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.75);
    if (Math.abs(Math.abs(off) - half) < 0.9) return 2;
    if (Math.abs(off) < 0.6 && t < 0.68) return 1;
    // 羽枝（軸から斜め外へ流れる細い線）
    if (Math.abs(off) < half - 1.5 && t < 0.66 && Math.abs(off) > 1.5 && Math.sin(t * 88 * 0.62 - Math.abs(off) * 0.62) > 0.94) return 1;
    // 羽の先の目
    const e = Math.abs(off) / 4.6 + Math.abs(t - 0.78) * 88 / 6.5;
    if (Math.abs(e - 1) < 0.2) return 3;
  }
  // 真ん中の丸
  if (Math.abs(r - 30) < 1) return 3;
  if (Math.abs(r - 24) < 0.7) return 1;
  if (r < 11) return r < 8 ? 2 : 0;
  // 床のふちの細い線と、四隅の菱形（歩ける端を見やすくする）
  const bx = Math.min(x - 14, W - 1 - 14 - x);
  const by = Math.min(y - 24, H - 1 - 14 - y);
  if (bx >= 0 && by >= 0 && Math.min(bx, by) < 1) return 1;
  const cx = Math.min(x, W - 1 - x) - 14;
  const cy = y < H / 2 ? y - 24 : H - 1 - 14 - y;
  if (Math.abs(cx) + Math.abs(cy) < 7 && Math.abs(cx) + Math.abs(cy) > 4.5) return 3;
  return 0;
}

function hoohFloor(): { floor: Rgb[]; shimmerA: (Rgb | null)[]; shimmerB: (Rgb | null)[] } {
  const floor: Rgb[] = [];
  const shimmerA: (Rgb | null)[] = [];
  const shimmerB: (Rgb | null)[] = [];
  const glintA = hex('#d9b868');
  const glintB = hex('#f4e0a0');
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - W / 2 + 0.5;
    const dy = y - H / 2 + 0.5;
    const r = Math.hypot(dx, dy);
    const out = Math.hypot(dx / (W / 2), dy / (H / 2));
    let t: number;
    let seam = 0;
    if (r < DISC_R) {
      // 紋の中は、外へ向かう放射状の板
      const a = Math.atan2(dy, dx);
      const n = r < 126 ? 24 : 36;
      const k = (a + Math.PI) / (Math.PI * 2) * n;
      const board = Math.floor(k);
      const f = k - board;
      const px = (Math.min(f, 1 - f) * Math.PI * 2 * r) / n;
      if (px < 0.55 && r > 30) seam = 1;
      t = 0.4 + (hash2(board, r < 126 ? 3 : 5, 201) - 0.5) * 0.24 + (fbm(r / 12, k * 3, 203) - 0.5) * 0.45;
    } else {
      // 外は横に長い床板（継ぎ目は段ごとにずらす）
      const row = Math.floor(y / PLANK_H);
      const ox = x + Math.floor(hash2(row, 1, 205) * PLANK_LEN);
      const col = Math.floor(ox / PLANK_LEN);
      if (y % PLANK_H === 0) seam = 1;
      else if (y % PLANK_H === 1) seam = 2;
      else if (ox % PLANK_LEN === 0) seam = 1;
      t = 0.42 + (hash2(col, row, 207) - 0.5) * 0.3 + (fbm((x + col * 53) / 46, y / 2.4, 209) - 0.5) * 0.62;
    }
    // 古い木のむら。真ん中は上から光が入って少し明るい
    t += (fbm(x / 80, y / 80, 211) - 0.5) * 0.3 + 0.16 * Math.max(0, 1 - out * 1.1) - 0.12 * Math.max(0, out - 0.8);
    let col = ramp(PLANK, t, x, y);
    if (seam === 1) col = SEAM;
    else if (seam === 2) col = SEAM_LIGHT;
    const ink = hoohInlay(x, y);
    let glint = 0;
    if (ink > 0) {
      col = INLAY[ink - 1]!;
      // 金のきらめき: 線の所々を短く
      if (ink >= 2) {
        const v = valueNoise(x / 5, y / 5, 213);
        if (v > 0.8) glint = 1;
        else if (v < 0.16) glint = 2;
      }
    }
    // 壁ぎわの影（上の欄干の影を長く）
    const edgeD = Math.min(x, W - 1 - x);
    const shade = Math.max(0, 1 - y / 22) * 0.7 + Math.max(0, 1 - edgeD / 12) * 0.5 + Math.max(0, 1 - (H - 1 - y) / 7) * 0.4;
    if (shade > (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16) col = [Math.round(col[0] * 0.66), Math.round(col[1] * 0.62), Math.round(col[2] * 0.68)];
    floor.push(col);
    shimmerA.push(glint === 1 ? glintA : null);
    shimmerB.push(glint === 2 ? glintB : null);
  }
  return { floor, shimmerA, shimmerB };
}

const LACQUER = ['#4a1a1c', '#6d2422', '#8f3129', '#ad4432'].map(hex);
const GOLD = ['#7a5c2a', '#b08c45', '#dcc074'].map(hex);
const TILE = ['#171c26', '#212835', '#2e3644', '#3e4856'].map(hex);
const SKY = ['#110d22', '#1a122d', '#281735', '#3c1f39', '#58293e'].map(hex);

/** 屋根瓦（d は欄干からの距離、along は端に沿った位置）。下へ重なる丸瓦の列 */
function roofTile(d: number, along: number, x: number, y: number): Rgb {
  const row = Math.floor(d / 13);
  const fd = d - row * 13;
  const a = along + (row % 2 ? 6 : 0);
  const fa = ((a % 12) + 12) % 12 - 6;
  // 瓦の先の丸み
  const edge = 13 - Math.sqrt(Math.max(0, 36 - fa * fa)) * 0.55;
  if (fd > edge) return TILE[0]!;
  const t = 0.68 - fd / 22 - Math.abs(fa) / 14 + (hash2(Math.floor(a / 12), row, 221) - 0.5) * 0.22 - d * 0.009;
  return ramp(TILE, t, x, y, 0.5);
}

function hoohWall(): (Rgb | null)[] {
  const fw = W + MARGIN * 2;
  const fh = H + MARGIN * 2;
  const out: (Rgb | null)[] = [];
  const dark = hex('#090711');
  // 奥の欄干は低く（上の帯の残りは暗い空。HP バーとタイマーの後ろに赤を置かない）
  const RAIL = 13;
  const SIDE = 9;
  const POST = 64;
  const gold = (k: number) => GOLD[Math.max(0, Math.min(2, k))]!;
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
    const ix = x - MARGIN, iy = y - MARGIN;
    if (ix >= 0 && ix < W && iy >= 0 && iy < H) {
      out.push(null);
      continue;
    }
    let col: Rgb;
    const insideX = ix >= -SIDE && ix < W + SIDE;
    if (iy < 0) {
      // 奥: 夕暮れの空と遠くの山。手前に朱の欄干の内側
      const k = (iy + MARGIN) / (MARGIN - 4);
      col = ramp(SKY, k * 0.92 + (fbm(x / 90, y / 7, 225) - 0.5) * 0.3, x, y);
      const ridge = -14 - fbm(x / 60, 3, 227) * 18 - fbm(x / 17, 5, 229) * 5;
      if (iy > ridge) col = hex('#150f22');
      if (insideX && iy >= -RAIL - 4) {
        // 手すりの段
        const pix = ((ix % POST) + POST) % POST;
        const isPost = pix < 7 && iy >= -RAIL - 3;
        const baluster = iy >= -RAIL && ((ix + 400) % 9) < 2;
        if (isPost) {
          const f = pix < 2 ? 3 : pix < 5 ? 2 : 1;
          col = LACQUER[f]!;
          if (iy < -RAIL) col = iy === -RAIL - 3 ? gold(2) : gold(pix < 3 ? 1 : 0);
        } else if (iy >= -RAIL && iy < -RAIL + 3) {
          col = iy === -RAIL ? LACQUER[3]! : iy < -RAIL + 2 ? LACQUER[2]! : LACQUER[0]!;
        } else if (iy >= -4) {
          col = iy === -4 ? LACQUER[2]! : LACQUER[iy < -2 ? 1 : 0]!;
        } else if (baluster) {
          col = LACQUER[(ix + 400) % 9 === 0 ? 2 : 1]!;
        }
      }
    } else if (iy >= H && insideX || !insideX || ix < 0 || ix >= W) {
      // 横と手前: 上から見た欄干と、その外の屋根瓦
      const dSide = ix < 0 ? -1 - ix : ix >= W ? ix - W : -1;
      const dBottom = iy >= H ? iy - H : -1;
      const d = Math.max(dSide, dBottom);
      const isBottom = dBottom >= dSide;
      const along = isBottom ? ix : iy;
      if (d < SIDE) {
        const k = 1 - Math.abs(d - (SIDE - 1) / 2) / ((SIDE - 1) / 2);
        col = LACQUER[Math.min(3, Math.floor(k * 3.4))]!;
        // 柱の頭（金）
        const pa = ((along % POST) + POST) % POST;
        if (pa < 8 && d >= 1 && d < SIDE - 1) col = gold(pa === 0 || d === 1 ? 2 : pa < 4 ? 1 : 0);
      } else {
        col = roofTile(d - SIDE, along, x, y);
      }
    } else {
      col = dark;
    }
    // 外ほど暗い（引きのカメラの外へつなぐ）
    const far = Math.max(-iy - MARGIN + 12, iy - H - MARGIN + 12 + 0, -ix - MARGIN + 12, ix - W - MARGIN + 12);
    if (far > 0 && (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16 < far / 12) col = dark;
    out.push(col);
  }
  return out;
}

// --- ライコウ: 雷雲の下の夜の草原（風になびく草に、落雷の焦げ跡が枝分かれして残る。07 の213章） ---

/** 黄色い稲妻・赤い予告・暗い雲の影が見えるよう、床は中くらいの暗さの、青みの緑にする */
const GRASS = ['#1d3626', '#24412c', '#2c4d32', '#355938', '#40653f'].map(hex);
const SOIL = ['#141c18', '#1a241d', '#212c22'].map(hex);

/** 落雷の焦げ跡（0〜1。1 が焦げの真ん中）。真ん中の大きな跡と、四隅の小さな跡 */
function raikouBurn(): Float32Array {
  const burn = new Float32Array(W * H);
  let n = 0;
  const rand = () => hash2(n++, 3, 301);
  const stamp = (cx: number, cy: number, r: number) => {
    const R = Math.ceil(r);
    for (let y = Math.max(0, Math.floor(cy) - R); y <= Math.min(H - 1, Math.floor(cy) + R); y++) {
      for (let x = Math.max(0, Math.floor(cx) - R); x <= Math.min(W - 1, Math.floor(cx) + R); x++) {
        const v = 1 - Math.hypot(x - cx, y - cy) / r;
        if (v > 0 && v > burn[y * W + x]!) burn[y * W + x] = v;
      }
    }
  };
  const branch = (x0: number, y0: number, a0: number, len: number, w0: number): void => {
    let x = x0, y = y0, a = a0;
    for (let s = 0; s < len; s++) {
      x += Math.cos(a) * 2;
      y += Math.sin(a) * 2;
      a += (rand() - 0.5) * 0.46;
      const w = Math.max(0.9, w0 * (1 - s / len));
      stamp(x, y, w);
      if (w0 > 1.3 && s > 6 && rand() < 0.055) branch(x, y, a + (rand() < 0.5 ? -1 : 1) * (0.45 + rand() * 0.6), Math.max(8, (len - s) * 0.62), w * 0.72);
    }
  };
  const star = (cx: number, cy: number, arms: number, len: number, w: number, disk: number) => {
    stamp(cx, cy, disk);
    for (let k = 0; k < arms; k++) branch(cx, cy, ((k + rand() * 0.6) / arms) * Math.PI * 2, len * (0.7 + rand() * 0.4), w);
  };
  star(W / 2, H / 2 + 6, 9, 95, 4.5, 15);
  star(112, 96, 5, 30, 2.6, 7);
  star(690, 92, 5, 34, 2.6, 7);
  star(92, 352, 5, 30, 2.6, 7);
  star(706, 340, 5, 34, 2.6, 7);
  return burn;
}

function raikouFloor(): { floor: Rgb[]; shimmerA: (Rgb | null)[]; shimmerB: (Rgb | null)[] } {
  const burn = raikouBurn();
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H ? burn[y * W + x]! : 0);
  const floor: Rgb[] = [];
  const shimmerA: (Rgb | null)[] = [];
  const shimmerB: (Rgb | null)[] = [];
  const glintA = hex('#7fb2c8');
  const glintB = hex('#bfe2ee');
  const blade = hex('#3f6b46');
  const bladeDark = hex('#1a3323');
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const b = at(x, y);
    // 風になびく草の帯（斜めの大きな波）
    const wind = Math.sin(x * 0.016 + y * 0.042 + fbm(x / 90, y / 60, 303) * 5.5);
    let t = 0.42 + wind * 0.27 + (fbm(x / 22, y / 14, 305) - 0.5) * 0.34;
    const out = Math.hypot((x - W / 2) / (W / 2), (y - H / 2) / (H / 2));
    t -= 0.12 * Math.max(0, out - 0.8);
    let col = ramp(GRASS, t, x, y);
    // 草の葉（短い縦の線。なびく向きに少しずれる）
    const lean = wind > 0 ? 1 : 0;
    const h0 = hash2(x, Math.floor(y / 3), 307);
    if (h0 > 0.965) col = blade;
    else if (hash2(x - lean, Math.floor((y - 1) / 3), 307) > 0.965) col = bladeDark;
    let glint = 0;
    if (b > 0) {
      // 焦げ跡: 真ん中は黒い土、ふちは焼けて枯れた草。ふちは崩す
      const rough = (hash2(x, y, 309) - 0.5) * 0.14;
      const v = b + rough;
      if (v > 0.5) col = ramp(SOIL, 0.25 + (v - 0.5) * 1.1 + (fbm(x / 7, y / 7, 311) - 0.5) * 0.7, x, y);
      else if (v > 0.16) col = hash2(x, y, 313) > 0.5 ? SOIL[2]! : hex('#2a3528');
      else if (v > 0.03 && hash2(x, y, 315) > 0.45) col = hex('#2e3b2b');
      // 焦げの真ん中に残る、弱い静電気（所々）
      if (b > 0.45) {
        const n = valueNoise(x / 4, y / 4, 317);
        if (n > 0.8) glint = 1;
        else if (n < 0.14) glint = 2;
      }
    }
    // 小さな白い花（まばら。焦げの上には咲かない）
    if (b === 0 && hash2(Math.floor(x / 7), Math.floor(y / 7), 319) > 0.985 && x % 7 === 3 && y % 7 === 3) col = hex('#8fa9a2');
    // 壁ぎわの影
    const edgeD = Math.min(x, W - 1 - x);
    const shade = Math.max(0, 1 - y / 18) * 0.65 + Math.max(0, 1 - edgeD / 12) * 0.5 + Math.max(0, 1 - (H - 1 - y) / 8) * 0.45;
    if (shade > (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16) col = [Math.round(col[0] * 0.62), Math.round(col[1] * 0.66), Math.round(col[2] * 0.7)];
    floor.push(col);
    shimmerA.push(glint === 1 ? glintA : null);
    shimmerB.push(glint === 2 ? glintB : null);
  }
  return { floor, shimmerA, shimmerB };
}

const STORM_SKY = ['#0a0c1c', '#0e1226', '#141a33', '#1b2340', '#262f50'].map(hex);
const STONE = ['#11181c', '#1a2428', '#253236', '#324146', '#465a5c'].map(hex);

function raikouWall(): (Rgb | null)[] {
  const fw = W + MARGIN * 2;
  const fh = H + MARGIN * 2;
  const out: (Rgb | null)[] = [];
  const dark = hex('#070913');
  const rimLight = hex('#55716a');
  const rimDark = hex('#121a1c');
  const hill = hex('#0e1720');
  const hillFar = hex('#141d2c');
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
    const ix = x - MARGIN, iy = y - MARGIN;
    const fromLeft = inset(iy, 11) - ix;
    const fromRight = ix - (W - 1 - inset(iy, 12));
    const fromTop = inset(ix, 13) - iy;
    const fromBottom = iy - (H - 1 - inset(ix, 14));
    const dist = Math.max(fromLeft, fromRight, fromTop, fromBottom);
    if (dist <= 0) {
      out.push(null);
      continue;
    }
    let col: Rgb;
    const ridgeTop = 13 + fbm(x / 26, 7, 321) * 7;
    if (iy < 0 && -iy > ridgeTop) {
      // 奥: 嵐の夜空。雲の帯と、遠くの丘（HP バーとタイマーの後ろは暗くする）
      const k = (iy + MARGIN) / MARGIN;
      const cloud = fbm(x / 70, y / 9, 323);
      col = ramp(STORM_SKY, k * 0.55 + (cloud - 0.45) * 0.8, x, y);
      if (-iy < 30 + fbm(x / 80, 3, 325) * 14) col = hillFar;
      if (-iy < 22 + fbm(x / 45, 5, 327) * 9) col = hill;
    } else {
      // 手前の岩と土手（左上が明るい丸い塊）
      const stone = worley(x, y, 22, 329);
      const round = (stone.dx + stone.dy) / 22;
      let t = 0.5 + round * 0.42 + (hash2(stone.id, 2, 331) - 0.5) * 0.25 + (fbm(x / 30, y / 30, 333) - 0.5) * 0.3 - Math.max(0, dist - 8) * 0.012;
      col = ramp(STONE, t, x, y);
      if (stone.edge < 0.8) col = STONE[0]!;
      // 岩にかぶさる長い草（上から垂れる）
      if (hash2(x, Math.floor(y / 5), 335) > 0.86) col = hex('#20403a');
      if (dist > MARGIN - 14 && (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16 < (dist - (MARGIN - 14)) / 14) col = dark;
    }
    // 歩ける端: 雨にぬれて明るい岩のふち（途切れないよう 3 ドット）
    if (dist <= 1) col = rimDark;
    else if (dist <= 4) col = rimLight;
    out.push(col);
  }
  return out;
}

// --- エンテイ: 冷えて固まった溶岩の台地（玄武岩の六角の柱に灰が積もる。真ん中に古い火口の跡。07 の217章） ---

/** 炎の赤と橙が映えるよう、床は赤くせず、青みのある暗い灰色にする（溶岩の海も床の上に出る） */
const BASALT = ['#201f27', '#28272f', '#312f37', '#3a3840', '#45424a'].map(hex);
const ASH = ['#3b3a40', '#47454b', '#535056'].map(hex);

function enteiFloor(): { floor: Rgb[]; shimmerA: (Rgb | null)[]; shimmerB: (Rgb | null)[] } {
  const floor: Rgb[] = [];
  const shimmerA: (Rgb | null)[] = [];
  const shimmerB: (Rgb | null)[] = [];
  const seam = hex('#15141b');
  const seamLight = hex('#514e56');
  const glintA = hex('#a8532a');
  const glintB = hex('#d98a4c');
  const rimLit = hex('#5b5760');
  const rimDark = hex('#1b1a21');
  const CALDERA = 150;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - W / 2 + 0.5;
    const dy = y - H / 2 + 0.5;
    const r = Math.hypot(dx, dy) + (fbm(x / 16, y / 16, 401) - 0.5) * 16;
    const out = Math.hypot(dx / (W / 2), dy / (H / 2));
    // 不揃いな玄武岩の柱（揃った六角形は機械のパネルに見えた）。柱ごとの高さで明るさが変わる
    const cell = worley(x, y, 15, 403);
    let t = 0.42 + (hash2(cell.id, 1, 403) - 0.5) * 0.5 + (fbm(x / 70, y / 70, 405) - 0.5) * 0.3 - 0.14 * Math.max(0, out - 0.8);
    // 火口の中は一段低く暗い
    if (r < CALDERA) t -= 0.18;
    let col = ramp(BASALT, t, x, y);
    // 継ぎ目は所々だけ（どこでも引くと石畳に見える）
    const seamed = fbm(x / 40, y / 40, 406) > 0.44 || r < CALDERA;
    if (seamed && cell.edge < 0.9) col = seam;
    else if (seamed && cell.edge < 2 && cell.dy > 0) col = seamLight;
    // 灰が筋になって積もる（継ぎ目を隠す）
    const ash = fbm(x / 58 + y / 120, y / 26, 407);
    if (ash > 0.6 && r > CALDERA + 12) {
      const k = (ash - 0.6) * 4;
      if (hash2(x, y, 409) < k + 0.25) col = ramp(ASH, k + (fbm(x / 7, y / 7, 411) - 0.5) * 0.7, x, y);
    }
    // 火口のふち: 外へ傾いた砕けた岩
    const ring = r - CALDERA;
    const rimW = 8 + 6 * fbm(Math.atan2(dy, dx) * 5 + 9, 3, 412);
    if (ring > -2 && ring < rimW) {
      const a = Math.atan2(dy, dx);
      // 左上から光が当たる: 外側の斜面は上と左が明るく、内側の斜面は下と右が明るい
      const lit = (-Math.sin(a) * 0.55 - Math.cos(a) * 0.3) * (ring > rimW / 2 ? 1 : -1) + 0.5;
      const rock = worley(x, y, 7, 413);
      const v = (hash2(rock.id, 3, 414) - 0.5) * 0.5 + lit;
      col = rock.edge < 0.7 ? rimDark : v > 0.62 ? rimLit : v > 0.36 ? BASALT[3]! : BASALT[1]!;
    } else if (ring > -22 && ring <= -2) {
      // 内側に落ちる影（上の縁の影が深い）
      const a = Math.atan2(dy, dx);
      if (-Math.sin(a) * 0.7 + (ring + 22) / 22 > 0.95 && (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16 < 0.6) col = rimDark;
    }
    // 火口の底から外へ走る古いひび
    const a2 = Math.atan2(dy, dx);
    const crack = Math.abs(Math.sin(a2 * 7 + (fbm(r / 22, 3, 415) - 0.5) * 3.2));
    if (r > 26 && r < CALDERA - 6 && crack < 0.022 + 0.4 / Math.max(30, r)) col = seam;
    // 残り火: 継ぎ目の所々（まばら・弱く）
    let glint = 0;
    if (seamed && cell.edge < 1.2) {
      const n = valueNoise(x / 6, y / 6, r < CALDERA ? 417 : 419);
      const th = r < CALDERA ? 0.72 : 0.86;
      if (n > th) glint = hash2(cell.id, 5, 421) > 0.5 ? 1 : 2;
    }
    // 壁ぎわの影
    const edgeD = Math.min(x, W - 1 - x);
    const shade = Math.max(0, 1 - y / 20) * 0.65 + Math.max(0, 1 - edgeD / 12) * 0.5 + Math.max(0, 1 - (H - 1 - y) / 8) * 0.45;
    if (shade > (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16) col = [Math.round(col[0] * 0.62), Math.round(col[1] * 0.62), Math.round(col[2] * 0.68)];
    floor.push(col);
    shimmerA.push(glint === 1 ? glintA : null);
    shimmerB.push(glint === 2 ? glintB : null);
  }
  return { floor, shimmerA, shimmerB };
}

const ASH_SKY = ['#0d0b12', '#141118', '#1c171f', '#251d26'].map(hex);

function enteiWall(): (Rgb | null)[] {
  const fw = W + MARGIN * 2;
  const fh = H + MARGIN * 2;
  const out: (Rgb | null)[] = [];
  const dark = hex('#08070c');
  const rimLight = hex('#5e5a63');
  const rimDark = hex('#111016');
  const mountain = hex('#0f0d14');
  const mountainFar = hex('#17141c');
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
    const ix = x - MARGIN, iy = y - MARGIN;
    const fromLeft = inset(iy, 21) - ix;
    const fromRight = ix - (W - 1 - inset(iy, 22));
    const fromTop = inset(ix, 23) - iy;
    const fromBottom = iy - (H - 1 - inset(ix, 24));
    const dist = Math.max(fromLeft, fromRight, fromTop, fromBottom);
    if (dist <= 0) {
      out.push(null);
      continue;
    }
    let col: Rgb;
    const ridgeTop = 13 + fbm(x / 22, 7, 431) * 6;
    if (iy < 0 && -iy > ridgeTop) {
      // 奥: 灰の空と遠くの山の影（タイマーの後ろは暗いまま）
      const smoke = fbm(x / 60, y / 11, 433);
      col = ramp(ASH_SKY, (iy + MARGIN) / MARGIN * 0.5 + (smoke - 0.45) * 0.8, x, y);
      if (-iy < 26 + fbm(x / 70, 3, 435) * 18) col = mountainFar;
      if (-iy < 20 + fbm(x / 40, 5, 437) * 8) col = mountain;
    } else {
      // 手前の崖: ごつごつした黒い岩（左上が明るい丸い塊）
      const stone = worley(x, y, 20, 439);
      const round2 = (stone.dx + stone.dy) / 20;
      const t = 0.46 + round2 * 0.42 + (hash2(stone.id, 2, 440) - 0.5) * 0.3 + (fbm(x / 34, y / 34, 441) - 0.5) * 0.28 - Math.max(0, dist - 8) * 0.012;
      col = ramp(BASALT, t, x, y);
      if (stone.edge < 0.8) col = hex('#111016');
      if (dist > MARGIN - 14 && (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16 < (dist - (MARGIN - 14)) / 14) col = dark;
    }
    // 歩ける端: 灰をかぶった岩のふち
    if (dist <= 1) col = rimDark;
    else if (dist <= 4) col = rimLight;
    out.push(col);
  }
  return out;
}

// --- スイクン: 夜明け前の澄んだ湖（透き通った浅い水の底に小石が透ける。水面の筋と、揺れる光。岸は小石と岩と葦。07 の227章） ---

/** 波の青・白い雪・オーロラの光が映えるよう、水は暗く、鮮やかにしない */
const LAKE = ['#0f2a3b', '#123242', '#163b4a', '#1a4552', '#1f4f5b', '#255a64'].map(hex);
const SHORE_ROCK = ['#141d26', '#1c2833', '#263541', '#334552', '#465b67'].map(hex);
const PEBBLE = ['#27343c', '#37474e', '#4a5b60', '#627477', '#83949a'].map(hex);

const mix = (a: Rgb, b: Rgb, k: number): Rgb => [Math.round(a[0] + (b[0] - a[0]) * k), Math.round(a[1] + (b[1] - a[1]) * k), Math.round(a[2] + (b[2] - a[2]) * k)];

function suicuneFloor(): { floor: Rgb[]; shimmerA: (Rgb | null)[]; shimmerB: (Rgb | null)[] } {
  const floor: Rgb[] = [];
  const shimmerA: (Rgb | null)[] = [];
  const shimmerB: (Rgb | null)[] = [];
  const glintA = hex('#5f9fae');
  const glintB = hex('#93c9d3');
  const stoneLine = hex('#0d2433');
  const stoneLight = hex('#2e6370');
  const gloss = hex('#3b7f8c');
  const weed = hex('#1c4a44');
  const weedDark = hex('#123a39');
  const moon = hex('#5d9aa8');
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - W / 2 + 0.5;
    // 岸からの距離（むらを付けて、浅瀬の形を自然にする）
    const shore = Math.min(x, W - 1 - x, y * 1.2, (H - 1 - y) * 1.2) + (fbm(x / 46, y / 46, 501) - 0.5) * 70;
    const deep = Math.max(0, Math.min(1, shore / 130));
    // 底の小石: 深いほど見えにくい
    const stone = worley(x, y, 8, 503);
    const big = worley(x, y, 30, 505);
    const stoneLit = (hash2(stone.id, 1, 507) - 0.5) * 0.42 + (hash2(big.id, 2, 509) - 0.5) * 0.3;
    let t = 0.62 - deep * 0.42 + stoneLit * (1 - deep * 0.72) + (fbm(x / 80, y / 80, 511) - 0.5) * 0.28;
    let col = ramp(LAKE, t, x, y, 0.5);
    // 底の小石: 網に見えないよう、一部の石だけ丸く浮かせる（線で囲まない）。浅い所に多い
    if (hash2(stone.id, 3, 515) > 0.5 + deep * 0.42 && fbm(x / 30, y / 30, 513) > 0.4) {
      const r = Math.hypot(stone.dx, stone.dy);
      const size = 2.2 + hash2(stone.id, 4, 516) * 2.2;
      if (r < size) col = stone.dy > 0.4 ? mix(col, stoneLight, 0.5) : stone.dy < -0.8 ? stoneLine : mix(col, stoneLight, 0.2);
    }
    // 水底に揺れる光の網（水の透明さ）: 所々だけ
    const net = Math.abs(fbm(x / 22 + fbm(x / 60, y / 60, 517) * 2, y / 22, 519) - 0.5);
    if (net < 0.009 && fbm(x / 70, y / 70, 521) > 0.52) col = mix(col, stoneLight, 0.26);
    // 浅瀬の水草（避ける物に見えないよう、低いコントラストで）
    const patch = fbm(x / 34, y / 34, 523);
    if (shore < 96 && patch > 0.56) {
      const k = (patch - 0.56) * 5;
      const h0 = hash2(x, Math.floor(y / 4), 525);
      if (h0 < k * 0.5) col = weed;
      else if (hash2(x, Math.floor((y - 1) / 4), 525) < k * 0.5) col = weedDark;
    }
    // 水面の筋（風で横に長くそろう）
    const band = fbm(x / 74, y / 5.5, 527);
    if (band > 0.635) col = mix(col, gloss, Math.min(0.42, (band - 0.635) * 3.4));
    // 月の映り込み: 奥の真ん中に、切れた横の線が縦に並ぶ（ごく薄く）
    const moonY = y / H;
    const moonW = (46 - moonY * 34) * (0.6 + fbm(y / 7, 3, 529) * 0.9);
    const onMoon = moonY < 0.62 && Math.abs(dx + (fbm(y / 9, 5, 530) - 0.5) * 34) < moonW && valueNoise(x / 16, y / 1.6, 531) > 0.56 + moonY * 0.3;
    if (onMoon) col = mix(col, moon, 0.34 * (1 - moonY));
    // きらめき: 水面の短い横線をまばらに。月の所は多く
    let glint = 0;
    if (y % 3 === 0) {
      const lane = Math.floor(y / 3);
      const v1 = valueNoise(x / 9 + lane * 7.3, lane * 3.1, 533);
      const v2 = valueNoise(x / 9 + lane * 5.1, lane * 2.3, 535);
      const th = onMoon ? 0.66 : 0.9;
      if (v1 > th) glint = 1;
      else if (v2 > th) glint = 2;
    }
    // 壁ぎわの影（水に落ちる岸の影）
    const edgeD = Math.min(x, W - 1 - x);
    const shade = Math.max(0, 1 - y / 20) * 0.62 + Math.max(0, 1 - edgeD / 12) * 0.5 + Math.max(0, 1 - (H - 1 - y) / 8) * 0.45;
    if (shade > (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16) col = [Math.round(col[0] * 0.6), Math.round(col[1] * 0.66), Math.round(col[2] * 0.74)];
    floor.push(col);
    shimmerA.push(glint === 1 ? glintA : null);
    shimmerB.push(glint === 2 ? glintB : null);
  }
  // 浮き草（小さく少なく。岸の近くだけ）
  const pad = hex('#2f6b57');
  const padDark = hex('#1e4c42');
  const flower = hex('#c9d8dc');
  let n = 0;
  const rand = () => hash2(n++, 11, 541);
  for (let c = 0; c < 14; c++) {
    const side = rand();
    const gx = side < 0.5 ? 16 + rand() * (W - 32) : side < 0.75 ? 18 + rand() * 60 : W - 78 + rand() * 60;
    const gy = side < 0.25 ? 28 + rand() * 40 : side < 0.5 ? H - 60 + rand() * 40 : 40 + rand() * (H - 80);
    const count = 2 + Math.floor(rand() * 4);
    for (let k = 0; k < count; k++) {
      const cx = gx + (rand() - 0.5) * 26;
      const cy = gy + (rand() - 0.5) * 14;
      const rx = 3 + rand() * 2.5;
      const cut = rand() * Math.PI * 2;
      const hasFlower = rand() > 0.82;
      for (let py = Math.floor(cy - rx); py <= cy + rx; py++) for (let px = Math.floor(cx - rx - 1); px <= cx + rx + 1; px++) {
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const ex = (px - cx) / rx;
        const ey = (py - cy) / (rx * 0.62);
        if (ex * ex + ey * ey > 1) continue;
        // 切れ込み
        const a = Math.atan2(ey, ex) - cut;
        if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.28) continue;
        floor[py * W + px] = ey > 0.45 ? padDark : pad;
      }
      if (hasFlower) {
        const fx = Math.round(cx);
        const fy = Math.round(cy);
        if (fx > 0 && fy > 0 && fx < W - 1 && fy < H - 1) {
          floor[fy * W + fx] = flower;
          floor[fy * W + fx - 1] = flower;
          floor[(fy - 1) * W + fx] = flower;
        }
      }
    }
  }
  return { floor, shimmerA, shimmerB };
}

const NIGHT_SKY = ['#080d1c', '#0b1324', '#0f192c', '#142136'].map(hex);

function suicuneWall(): (Rgb | null)[] {
  const fw = W + MARGIN * 2;
  const fh = H + MARGIN * 2;
  const out: (Rgb | null)[] = [];
  const dark = hex('#060a14');
  const rimLight = hex('#7c9ba4');
  const rimDark = hex('#101c26');
  const pine = hex('#0a1420');
  const pineFar = hex('#101c2c');
  const reed = hex('#2f5449');
  const reedDark = hex('#1b3a36');
  const reedHead = hex('#574c3a');
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
    const ix = x - MARGIN, iy = y - MARGIN;
    const fromLeft = inset(iy, 31) - ix;
    const fromRight = ix - (W - 1 - inset(iy, 32));
    const fromTop = inset(ix, 33) - iy;
    const fromBottom = iy - (H - 1 - inset(ix, 34));
    const dist = Math.max(fromLeft, fromRight, fromTop, fromBottom);
    if (dist <= 0) {
      out.push(null);
      continue;
    }
    let col: Rgb;
    const ridgeTop = 12 + fbm(x / 22, 7, 551) * 6;
    if (iy < 0 && -iy > ridgeTop) {
      // 奥: 夜明け前の空と星、遠くの森（タイマーの後ろは暗いまま）
      col = ramp(NIGHT_SKY, ((iy + MARGIN) / MARGIN) * 0.7 + (fbm(x / 70, y / 10, 553) - 0.5) * 0.4, x, y, 0.5);
      if (hash2(x, y, 555) > 0.9975) col = hex('#8ea3b8');
      // 遠くの森と、手前の針葉樹（とがった木の列）
      const treeLine = (cell: number, base: number, reach: number, seed: number): number => {
        const c = Math.floor(x / cell);
        let top = 0;
        for (let k = c - 2; k <= c + 2; k++) {
          const cx = (k + hash2(k, 1, seed)) * cell;
          const tall = base + hash2(k, 2, seed) * reach;
          top = Math.max(top, tall - Math.abs(x - cx) * (1.1 + hash2(k, 3, seed) * 0.9));
        }
        return top;
      };
      if (-iy < treeLine(9, 24, 18, 557)) col = pineFar;
      if (-iy < treeLine(13, 20, 16, 559)) col = pine;
    } else {
      // 手前の岸: 岩（左上が明るい丸い塊）
      const stone = worley(x, y, 20, 561);
      const round = (stone.dx + stone.dy) / 20;
      const t = 0.46 + round * 0.42 + (hash2(stone.id, 2, 563) - 0.5) * 0.28 + (fbm(x / 34, y / 34, 565) - 0.5) * 0.28 - Math.max(0, dist - 8) * 0.012;
      col = ramp(SHORE_ROCK, t, x, y);
      if (stone.edge < 0.8) col = SHORE_ROCK[0]!;
      // 葦の茂み（上へ伸びる細い葉。岩にかぶさる）
      const clump = fbm(x / 26, y / 26, 567);
      if (clump > 0.55) {
        const blade = hash2(x, 3, 569);
        const len = 5 + Math.floor(hash2(x, 5, 571) * 7);
        const seg = ((y + Math.floor(blade * 24)) % 24);
        if (blade > 0.5 && seg < len) col = seg === 0 && blade > 0.82 ? reedHead : blade > 0.75 ? reed : reedDark;
      }
      if (dist > MARGIN - 14 && (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16 < (dist - (MARGIN - 14)) / 14) col = dark;
    }
    // 歩ける端: ぬれて明るい小石の水際（途切れないよう帯にする）
    if (dist <= 7) {
      const peb = worley(x, y, 5, 573);
      col = ramp(PEBBLE, 0.3 + (hash2(peb.id, 1, 575) - 0.5) * 0.7 + (peb.dx + peb.dy) * 0.06, x, y, 0.3);
      if (peb.edge < 0.5) col = PEBBLE[0]!;
    }
    if (dist <= 1) col = rimDark;
    else if (dist <= 2.5) col = rimLight;
    out.push(col);
  }
  return out;
}

// --- ミュウツー: ハナダのどうくつの最深部（暗い岩の床に、地底の水がしみ出した大きな水たまり。07 の〔ミュウツー〕章） ---

/** 技の紫・桃色・青と重ならないよう、床は暗い青灰色。線で囲まず、大きな面の明るさの違いで岩の板を見せる */
const CAVE = ['#14141e', '#191a25', '#20212d', '#282a37', '#313343'].map(hex);
const CAVE_WATER = ['#081218', '#0b1820', '#0f2029', '#132833', '#18313d'].map(hex);
const CAVE_WET = hex('#1d2633');
const CAVE_SHORE = hex('#394656');

/** 地底の水（0 なら床、0〜1 は深さ）: 左下と右上に大きな水たまり、下の右寄りに細い入り江。真ん中は空ける */
function caveWater(x: number, y: number): number {
  const pools = [
    { cx: 70, cy: 380, rx: 190, ry: 120 },
    { cx: 760, cy: 50, rx: 170, ry: 100 },
    { cx: 600, cy: 455, rx: 150, ry: 46 },
    { cx: 20, cy: 40, rx: 70, ry: 60 },
  ];
  let best = 0;
  for (const p of pools) {
    const warp = (fbm(x / 60, y / 60, 701 + p.cx) - 0.5) * 0.7 + (fbm(x / 18, y / 18, 709) - 0.5) * 0.14;
    const d = Math.hypot((x - p.cx) / p.rx, (y - p.cy) / p.ry) + warp;
    if (d < 1) best = Math.max(best, Math.min(1, (1 - d) / 0.35));
  }
  return best;
}

// --- フリーザー: ふたごじまの最深部（凍えた岩の床を、海水の流れが 2 本斜めに横切る。07 の〔フリーザー〕章） ---

/** フリーズドライで凍る帯と同じ折れ線（data/game/stage.json の articuno-freeze-dry の arenaPaths。ワールドの単位で、マップの真ん中から） */
const SEA_PATHS: { radius: number; points: [number, number][] }[] = (() => {
  const stage = JSON.parse(fs.readFileSync(path.join('data', 'game', 'stage.json'), 'utf8')) as { moves: { id: string; arenaPaths?: { radius: number; points: [number, number][] }[] }[] };
  return stage.moves.find((m) => m.id === 'articuno-freeze-dry')?.arenaPaths ?? [];
})();

/** 技の白・水色と重ならないよう、床は暗い青い岩。氷は床の色を少し明るくしたうすい膜だけ */
const SEA_ROCK = ['#121a24', '#17212d', '#1d2836', '#243141', '#2c3a4c'].map(hex);
const SEA = ['#071a26', '#0a2231', '#0d2a3b', '#113346', '#163d52'].map(hex);
const SEA_FOAM = hex('#5f8ea6');
const FROST_RIM = hex('#4c6a80');

/** 海水の流れの中なら、帯の縁からの深さ（ドット。0 以下は外） */
function seaDepth(x: number, y: number): number {
  // ドット → ワールド（マップの真ん中から）
  const wx = x * 2 - W;
  const wy = y * 2 - H;
  let best = -Infinity;
  for (const path of SEA_PATHS) {
    for (let k = 0; k + 1 < path.points.length; k++) {
      const [x0, y0] = path.points[k]!;
      const [x1, y1] = path.points[k + 1]!;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const t = Math.max(0, Math.min(1, ((wx - x0) * dx + (wy - y0) * dy) / (dx * dx + dy * dy)));
      const d = Math.hypot(wx - (x0 + dx * t), wy - (y0 + dy * t));
      best = Math.max(best, (path.radius - d) / 2);
    }
  }
  // 縁は少し内側でゆらす（絵の水は当たる帯からはみ出さない）
  return best - 3 - fbm(x / 14, y / 14, 801) * 4;
}

function articunoFloor(): { floor: Rgb[]; shimmerA: (Rgb | null)[]; shimmerB: (Rgb | null)[] } {
  const floor: Rgb[] = [];
  const shimmerA: (Rgb | null)[] = [];
  const shimmerB: (Rgb | null)[] = [];
  const glintA = hex('#6fa7c0');
  const glintB = hex('#9ccbe0');
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sea = seaDepth(x, y);
    let col: Rgb;
    if (sea > 0) {
      // 流れの真ん中ほど深い。流れに沿ったゆるいむら
      const t = 0.7 - Math.min(1, sea / 30) * 0.5 + (fbm(x / 30 + y / 60, y / 18 - x / 40, 811) - 0.5) * 0.35;
      col = ramp(SEA, t, x, y);
      // 水ぎわの 1 ドットだけ、ところどころ明るく（輪郭の線に見えないように）
      if (sea < 1 && fbm(x / 9, y / 9, 843) > 0.45) col = FROST_RIM;
      // 泡: 流れの向き（斜め）に短く、まばら
      if (sea > 4 && valueNoise((x + y * 0.62) / 3, (y - x * 0.62) / 16, 813) > 0.9 && hash2(x >> 1, y, 815) > 0.65) col = SEA_FOAM;
      const g1 = valueNoise((x + y * 0.62) / 3.5, (y - x * 0.62) / 20, 817);
      shimmerA.push(sea > 6 && g1 > 0.9 && hash2(x >> 2, y, 819) > 0.7 ? glintA : null);
      const g2 = valueNoise((x + y * 0.62) / 3.5 + 9, (y - x * 0.62) / 20 + 4, 821);
      shimmerB.push(sea > 6 && g2 > 0.91 && hash2(x >> 2, y, 823) > 0.72 ? glintB : null);
    } else {
      // 凍えた岩: 大きな明暗の面（線で囲まない）と、うすい氷の膜
      const slab = worley(x, y, 64, 831);
      let t = 0.44 + (fbm(x / 100, y / 100, 833) - 0.5) * 0.45 + (hash2(slab.id, 1, 835) - 0.5) * 0.16 + (fbm(x / 18, y / 18, 837) - 0.5) * 0.14;
      // 水ぎわはしぶきで暗くぬれる
      if (sea > -6) t -= 0.12;
      col = ramp(SEA_ROCK, t, x, y);
      // 氷の膜: 大きなまだらの所だけ、少し明るい青
      const ice = fbm(x / 50, y / 50, 839);
      if (ice > 0.68 && sea < -8) col = ramp(SEA_ROCK, t + 0.14, x, y);
      // 水ぎわの霜（1〜2 ドット）
      if (sea > -1.2 && fbm(x / 9, y / 9, 845) > 0.5) col = FROST_RIM;
      // まばらな雪の粒
      if (hash2(x, y, 841) > 0.997) col = hex('#5d7489');
      shimmerA.push(null);
      shimmerB.push(null);
    }
    floor.push(col);
  }
  return { floor, shimmerA, shimmerB };
}

const ICE_WALL = ['#0a0f17', '#0f1620', '#151f2c', '#1d2a3a', '#283849'].map(hex);

function articunoWall(): (Rgb | null)[] {
  const fw = W + MARGIN * 2;
  const fh = H + MARGIN * 2;
  const out: (Rgb | null)[] = [];
  const dark = hex('#05080d');
  const rimLight = hex('#8fb0c6');
  const rimDark = hex('#0e151e');
  const icicle = ['#3f6178', '#6f97ae', '#a9cadb'].map(hex);
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
    const ix = x - MARGIN, iy = y - MARGIN;
    const fromLeft = inset(iy, 21) - ix;
    const fromRight = ix - (W - 1 - inset(iy, 22));
    const fromTop = inset(ix, 23) - iy;
    const fromBottom = iy - (H - 1 - inset(ix, 24));
    const dist = Math.max(fromLeft, fromRight, fromTop, fromBottom);
    if (dist <= 0) {
      out.push(null);
      continue;
    }
    const isTop = fromTop >= Math.max(fromLeft, fromRight, fromBottom);
    const size = isTop ? 24 : 18;
    const stone = worley(x, y, size, 851);
    const round = (stone.dx + stone.dy) / size;
    let t = 0.48 + round * 0.4 + (hash2(stone.id, 2, 853) - 0.5) * 0.22 + (fbm(x / 28, y / 28, 855) - 0.5) * 0.3;
    t -= Math.max(0, dist - 8) * 0.014;
    let col = ramp(ICE_WALL, t, x, y);
    if (stone.edge < 0.8) col = ICE_WALL[0]!;
    if (dist > MARGIN - 14 && (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16 < (dist - (MARGIN - 14)) / 14) col = dark;
    if (dist <= 1) col = rimDark;
    else if (dist <= 2.5) col = rimLight;
    // 上の壁の下の縁から垂れる、つらら（長さはまちまち。間をあける）
    if (isTop && fromTop > 2 && fromTop < 22) {
      // まばらに、長さも太さもまちまち（くしの歯に見えないように）
      const col4 = Math.floor(x / 9);
      const len = hash2(col4, 1, 857) > 0.72 ? 5 + hash2(col4, 2, 859) * 16 : 0;
      const k = x - col4 * 9 - Math.floor(hash2(col4, 3, 861) * 4);
      const w = (1 - (fromTop - 2) / Math.max(1, len)) * 2.2;
      if (len > 0 && fromTop - 2 < len && Math.abs(k - 2) < w) col = icicle[k < 2 ? 2 : k === 2 ? 1 : 0]!;
    }
    out.push(col);
  }
  return out;
}

// --- サンダー: 無人発電所（ひび割れたコンクリートの床。壁ぎわに発電機が 6 基。07 の〔サンダー〕章） ---

/** 発電機の場所（data/game/stage.json の zapdos-thunderbolt の arenaLinks.nodes。ワールドの単位で、マップの真ん中から） */
const GENERATORS: [number, number][] = (() => {
  const stage = JSON.parse(fs.readFileSync(path.join('data', 'game', 'stage.json'), 'utf8')) as { moves: { id: string; arenaLinks?: { nodes: [number, number][] } }[] };
  return stage.moves.find((m) => m.id === 'zapdos-thunderbolt')?.arenaLinks?.nodes ?? [];
})();

/** 電撃の黄色と重ならないよう、床は青みの暗い灰色 */
const CONCRETE = ['#15171c', '#1a1d23', '#20232a', '#272a32', '#2f333b'].map(hex);
const STAIN = hex('#111317');
/** 床のひび: 決まった数本だけ、曲がりながら伸びる線（網目に見えないように） */
const CRACKS: Uint8Array = (() => {
  const m = new Uint8Array(W * H);
  for (let k = 0; k < 9; k++) {
    let x = 40 + hash2(k, 1, 931) * (W - 80);
    let y = 40 + hash2(k, 2, 933) * (H - 80);
    let a = hash2(k, 3, 935) * Math.PI * 2;
    const len = 40 + hash2(k, 4, 937) * 70;
    for (let t = 0; t < len; t++) {
      x += Math.cos(a);
      y += Math.sin(a);
      a += (hash2(k * 97 + t, 5, 939) - 0.5) * 0.6;
      const i = Math.round(y) * W + Math.round(x);
      if (x < 1 || y < 1 || x > W - 2 || y > H - 2) break;
      m[i] = 1;
      // 短い枝
      if (t % 23 === 11) {
        let bx = x;
        let by = y;
        const ba = a + (hash2(k, t, 941) > 0.5 ? 1 : -1);
        for (let u = 0; u < 9; u++) {
          bx += Math.cos(ba);
          by += Math.sin(ba);
          const j = Math.round(by) * W + Math.round(bx);
          if (j >= 0 && j < m.length) m[j] = 1;
        }
      }
    }
  }
  return m;
})();

function zapdosFloor(): { floor: Rgb[] } {
  const floor: Rgb[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    // 打ち継ぎの大きな板（境は線で引かず、板ごとの明るさだけ）
    const slab = worley(x, y, 90, 901);
    let t = 0.46 + (fbm(x / 120, y / 120, 903) - 0.5) * 0.4 + (hash2(slab.id, 1, 905) - 0.5) * 0.08 + (fbm(x / 16, y / 16, 907) - 0.5) * 0.18;
    // 発電機のまわりは焦げて暗い
    let near = Infinity;
    for (const [gx, gy] of GENERATORS) near = Math.min(near, Math.hypot(x - (gx + W) / 2, y - (gy + H) / 2));
    t -= Math.max(0, 1 - near / 90) * 0.25;
    let col = ramp(CONCRETE, t, x, y);
    // 油のしみ（大きなまだら）
    if (fbm(x / 46, y / 46, 909) > 0.74) col = mix(col, STAIN, 0.3);
    // 細いひび（数本だけ。網目にしない）
    if (CRACKS[y * W + x]) col = CONCRETE[0]!;
    // まばらな砂粒
    const r = hash2(x, y, 917);
    if (r > 0.994) col = CONCRETE[4]!;
    floor.push(col);
  }
  return { floor };
}

const PLANT_WALL = ['#0b0c10', '#101217', '#16191f', '#1e2229', '#282d35'].map(hex);

function zapdosWall(): (Rgb | null)[] {
  const fw = W + MARGIN * 2;
  const fh = H + MARGIN * 2;
  const out: (Rgb | null)[] = [];
  const dark = hex('#050608');
  const rimLight = hex('#5a606c');
  const rimDark = hex('#0d0f13');
  const metal = ['#2a2f38', '#3a414c', '#525b68', '#76808d'].map(hex);
  const coil = ['#5a3418', '#8a5426', '#c07a38'].map(hex);
  const stripeY = hex('#c9a227');
  const stripeK = hex('#16161a');
  const lamp = ['#7a6a1a', '#ffe066'].map(hex);
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
    const ix = x - MARGIN, iy = y - MARGIN;
    const fromLeft = -ix;
    const fromRight = ix - (W - 1);
    const fromTop = -iy;
    const fromBottom = iy - (H - 1);
    const dist = Math.max(fromLeft, fromRight, fromTop, fromBottom);
    let col: Rgb | null = null;
    if (dist > 0) {
      // 壁: 金属の板（縦の継ぎ目と、ところどころのリベット）
      const isTop = fromTop >= Math.max(fromLeft, fromRight, fromBottom);
      const isBottom = fromBottom >= Math.max(fromLeft, fromRight, fromTop);
      const along = isTop || isBottom ? x : y;
      const panel = Math.floor((along + 7) / 26);
      let t = 0.45 + (hash2(panel, isTop ? 1 : isBottom ? 2 : 3, 921) - 0.5) * 0.25 + (fbm(x / 20, y / 20, 923) - 0.5) * 0.2 - Math.max(0, dist - 8) * 0.012;
      col = ramp(PLANT_WALL, t, x, y);
      if ((along + 7) % 26 === 0) col = PLANT_WALL[0]!;
      if ((along + 7) % 26 === 3 && dist % 9 === 4) col = PLANT_WALL[4]!;
      // 上の壁の 2 本の太い配管
      if (isTop && (Math.abs(fromTop - 14) < 3 || Math.abs(fromTop - 30) < 2)) {
        const k = Math.abs(fromTop - 14) < 3 ? fromTop - 14 : fromTop - 30;
        col = k < -1 ? metal[2]! : k > 1 ? metal[0]! : metal[1]!;
        if (x % 58 === 0) col = metal[3]!;
      }
      if (dist > MARGIN - 14 && (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16 < (dist - (MARGIN - 14)) / 14) col = dark;
      if (dist <= 1) col = rimDark;
      else if (dist <= 2.5) col = rimLight;
    }
    // 発電機: 壁にはまった箱。真ん中に銅のコイル、ふちに黄色と黒の帯、ランプ
    for (const [gx, gy] of GENERATORS) {
      // 壁の方へ少しずらす（体の 3 分の 2 が壁に入る）
      const cx = (gx + W) / 2 + MARGIN + Math.sign(gx) * (Math.abs(gx) >= W - 1 ? 9 : 0);
      const cy = (gy + H) / 2 + MARGIN + Math.sign(gy) * (Math.abs(gy) >= H - 1 ? 9 : 0);
      const dx = x - cx;
      const dy = y - cy;
      const hw = 28;
      const hh = 22;
      if (Math.abs(dx) > hw || Math.abs(dy) > hh) continue;
      const edge = Math.min(hw - Math.abs(dx), hh - Math.abs(dy));
      if (edge < 1) col = PLANT_WALL[0]!;
      else if (edge < 3.5) col = (Math.floor((dx + dy + 40) / 3) % 2 === 0 ? stripeY : stripeK);
      else {
        col = metal[Math.abs(dy) < 2 ? 2 : dy < 0 ? 1 : 0]!;
        // コイル（横に巻いた銅線）
        if (Math.abs(dx) < 16 && Math.abs(dy) < 11) col = coil[Math.abs(dy) < 2 ? 2 : (Math.abs(dy) + (dx & 1)) % 2 ? 1 : 0]!;
        // ランプ（左上）
        if (Math.hypot(dx + 21, dy + 15) < 2.6) col = lamp[1]!;
        else if (Math.hypot(dx + 21, dy + 15) < 3.8) col = lamp[0]!;
      }
    }
    out.push(col);
  }
  return out;
}

function mewtwoFloor(): { floor: Rgb[]; shimmerA: (Rgb | null)[]; shimmerB: (Rgb | null)[] } {
  const floor: Rgb[] = [];
  const shimmerA: (Rgb | null)[] = [];
  const shimmerB: (Rgb | null)[] = [];
  const glintA = hex('#5d8ea3');
  const glintB = hex('#7fb0c2');
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const w = caveWater(x, y);
    let col: Rgb;
    if (w > 0) {
      // 深いほど暗い。水面に天井の暗さが映るむら
      const t = 0.75 - w * 0.6 + (fbm(x / 40, y / 22, 721) - 0.5) * 0.35;
      col = ramp(CAVE_WATER, t, x, y);
      // 岸の 1〜2 ドット: ぬれた岩のふち
      const near = caveWater(x + 2, y) === 0 || caveWater(x - 2, y) === 0 || caveWater(x, y + 2) === 0 || caveWater(x, y - 2) === 0;
      if (near && w < 0.25) col = CAVE_SHORE;
      // 水面の光（ゆっくり交互に）
      // まばらな短い横の光（細かい点を散らすと砂嵐に見えた）
      const ripple = valueNoise(x / 22, y / 2.6, 731);
      shimmerA.push(ripple > 0.9 && hash2(x >> 2, y, 733) > 0.7 && w > 0.4 ? glintA : null);
      const ripple2 = valueNoise(x / 22 + 7, y / 2.6 + 3, 737);
      shimmerB.push(ripple2 > 0.91 && hash2(x >> 2, y, 739) > 0.72 && w > 0.4 ? glintB : null);
    } else {
      // 岩の板: 大きなむらと、板ごとの明るさ（境に線を引かない）
      const slab = worley(x, y, 74, 741);
      const center = Math.hypot((x - W / 2) / (W / 2), (y - H / 2) / (H / 2));
      let t = 0.4 + Math.max(0, 1 - center) * 0.2 + (fbm(x / 110, y / 110, 743) - 0.5) * 0.5 + (hash2(slab.id, 1, 745) - 0.5) * 0.18 + (fbm(x / 20, y / 20, 747) - 0.5) * 0.16;
      // 水の近くはぬれて暗い
      let wet = 0;
      for (const [dx, dy] of [[6, 0], [-6, 0], [0, 6], [0, -6], [12, 0], [-12, 0], [0, 12], [0, -12]] as const) if (caveWater(x + dx, y + dy) > 0) wet++;
      t -= wet * 0.035;
      col = ramp(CAVE, t, x, y);
      if (wet >= 3 && hash2(x, y, 749) > 0.5) col = CAVE_WET;
      // 壁ぎわの砂利（細かい明暗）
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      if (edge < 26 && hash2(x, y, 753) > 0.55 + edge / 60) col = hash2(x, y, 755) > 0.5 ? CAVE[3]! : CAVE[1]!;
      // 小さな水たまり（まばら）
      if (fbm(x / 9, y / 6, 757) > 0.8 && fbm(x / 70, y / 70, 759) > 0.55) col = hash2(x, y, 761) > 0.85 ? CAVE_SHORE : CAVE_WATER[2]!;
      // まばらな小石（明るい点と影の点。囲む線は描かない）
      const r = hash2(x, y, 751);
      if (r > 0.992) col = CAVE[4]!;
      else if (r < 0.006) col = CAVE[0]!;
      shimmerA.push(null);
      shimmerB.push(null);
    }
    floor.push(col);
  }
  return { floor, shimmerA, shimmerB };
}

const CAVE_WALL = ['#0c0c14', '#12121c', '#191a25', '#222331', '#2d2e3f'].map(hex);

function mewtwoWall(): (Rgb | null)[] {
  const fw = W + MARGIN * 2;
  const fh = H + MARGIN * 2;
  const out: (Rgb | null)[] = [];
  const dark = hex('#06060b');
  const rimLight = hex('#4a4c60');
  const rimDark = hex('#101018');
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
    const ix = x - MARGIN, iy = y - MARGIN;
    const fromLeft = inset(iy, 11) - ix;
    const fromRight = ix - (W - 1 - inset(iy, 12));
    const fromTop = inset(ix, 13) - iy;
    const fromBottom = iy - (H - 1 - inset(ix, 14));
    const dist = Math.max(fromLeft, fromRight, fromTop, fromBottom);
    if (dist <= 0) {
      out.push(null);
      continue;
    }
    const isTop = fromTop >= Math.max(fromLeft, fromRight, fromBottom);
    const size = isTop ? 24 : 18;
    const stone = worley(x, y, size, 761);
    const round = (stone.dx + stone.dy) / size;
    let t = 0.48 + round * 0.4 + (hash2(stone.id, 2, 763) - 0.5) * 0.22 + (fbm(x / 28, y / 28, 765) - 0.5) * 0.3;
    // 上の壁: 天井から垂れる鍾乳石の縦のすじ
    if (isTop) t += (fbm(x / 5, y / 40, 767) - 0.5) * 0.35;
    t -= Math.max(0, dist - 8) * 0.014;
    let col = ramp(CAVE_WALL, t, x, y);
    if (stone.edge < 0.8) col = CAVE_WALL[0]!;
    if (dist > MARGIN - 14 && (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16 < (dist - (MARGIN - 14)) / 14) col = dark;
    if (dist <= 1) col = rimDark;
    else if (dist <= 2.5) col = rimLight;
    out.push(col);
  }
  return out;
}

const arenas = [
  { id: 'lugia', ...lugiaFloor(), wall: lugiaWall() },
  { id: 'hooh', ...hoohFloor(), wall: hoohWall() },
  { id: 'raikou', ...raikouFloor(), wall: raikouWall() },
  { id: 'entei', ...enteiFloor(), wall: enteiWall() },
  { id: 'suicune', ...suicuneFloor(), wall: suicuneWall() },
  { id: 'mewtwo', region: 'kanto', ...mewtwoFloor(), wall: mewtwoWall() },
  { id: 'articuno', region: 'kanto', ...articunoFloor(), wall: articunoWall() },
  { id: 'zapdos', region: 'kanto', ...zapdosFloor(), shimmerA: null, shimmerB: null, wall: zapdosWall() },
];
for (const a of arenas) {
  const outDir = path.join('public', 'map', 'region' in a ? a.region : 'johto');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `arena-${a.id}-floor.png`), toPng(a.floor, W, H));
  if (a.shimmerA && a.shimmerB) {
    fs.writeFileSync(path.join(outDir, `arena-${a.id}-shimmer-a.png`), toPng(a.shimmerA, W, H));
    fs.writeFileSync(path.join(outDir, `arena-${a.id}-shimmer-b.png`), toPng(a.shimmerB, W, H));
  }
  fs.writeFileSync(path.join(outDir, `arena-${a.id}-wall.png`), toPng(a.wall, W + MARGIN * 2, H + MARGIN * 2));
  for (const f of a.shimmerA ? ['floor', 'shimmer-a', 'shimmer-b', 'wall'] : ['floor', 'wall']) {
    console.log(`${outDir}/arena-${a.id}-${f}.png ${Math.round(fs.statSync(path.join(outDir, `arena-${a.id}-${f}.png`)).size / 1024)}KB`);
  }
}

// 床と壁を重ねた確認用の絵（第 1 引数のパスの後ろに -<id>.png を付けて出す。リポジトリに入れない）
const previewPath = process.argv[2];
if (previewPath) {
  const fw = W + MARGIN * 2;
  const fh = H + MARGIN * 2;
  for (const a of arenas) {
    const merged: (Rgb | null)[] = a.wall.slice();
    // ゲームでは壁が床より手前（床の上にはみ出した壁の絵＝発電機などは、床の上に見える）
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) merged[(y + MARGIN) * fw + x + MARGIN] ??= a.floor[y * W + x]!;
    fs.writeFileSync(`${previewPath}-${a.id}.png`, toPng(merged, fw, fh));
  }
}
