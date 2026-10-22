/**
 * PokéSwarm のロゴのアイコン（SNS のプロフィール・ファビコン。作者の案 2026年10月22日）を、ドット絵で作る。
 *
 *   node scripts/make-brand-icon.ts
 *
 * 出力（作者の決定 2026年10月22日: 案A＝赤を右上へずらす・真ん中のボタンは抜く）:
 * - public/icons/favicon-32.png・favicon-64.png（ファビコン。地は透明）
 * - public/icons/icon-180.png・icon-192.png・icon-512.png（ホーム画面に追加したときのアイコン。暗い地）
 * - assets/brand/profile-1024.png（SNS のプロフィール。暗い地。丸く切り抜かれても収まるよう広めに空ける）・logo-400-transparent.png
 * 確認用: --slide=down（赤を左下へ）・--out=<フォルダ>（全部そのフォルダへ）
 *
 * 形: モンスターボールを反時計回りに 45° 回し、真ん中の線で上下に分け、線に沿ってずらす（Swarm の S）。
 * ずらす長さは、2つのかけらの間で半径の半分（作者の指定。それぞれ反対向きに 1/4 ずつ動かす）。
 * 公式の画像は使わず、円と線だけから計算で描く。1ドット = 1マス の小さな絵（GRID × GRID）を作り、ニアレストネイバーで拡大して書き出す。
 * --slide: 赤い側（もとの上半分）を線に沿ってどちらへずらすか（up = 右上、down = 左下）
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]));
const slide = args.get('slide') === 'down' ? -1 : 1;
const outArg = args.get('out');
const iconDir = outArg ?? join(ROOT, 'public', 'icons');
const brandDir = outArg ?? join(ROOT, 'assets', 'brand');

/** 小さな絵の大きさ（ドットの数） */
const GRID = 32;
type Rgba = [number, number, number, number];
const COLORS: Record<string, Rgba> = {
  none: [0, 0, 0, 0],
  outline: [24, 20, 37, 255],
  red: [232, 48, 48, 255],
  redDark: [168, 24, 40, 255],
  redLight: [255, 136, 120, 255],
  white: [240, 240, 244, 255],
  whiteDark: [184, 188, 200, 255],
};

// 向き（画面は y が下）。u: 回した後の真ん中の線の向き（右上へ）、n: 赤い側（もとの上半分。左上へ）
const s2 = Math.SQRT1_2;
const u = { x: s2, y: -s2 };
const n = { x: -s2, y: -s2 };

/** 半径 r のボールで、点 (x, y)（ボールの中心が原点）の色。どちらのかけらにも入らなければ none */
function shade(x: number, y: number, r: number): string {
  const band = Math.max(1, r * 0.12); // 真ん中の黒い線の半分の太さ
  const edge = Math.max(1, r * 0.1); // 外側の縁
  const buttonOuter = r * 0.36;
  const buttonInner = r * 0.22;
  for (const side of [1, -1] as const) {
    // side 1: 赤いかけら、-1: 白いかけら。赤は slide の向きへ、白は反対へ、半径の 1/4 ずつ（かけらの間で半径の半分）ずらす
    const cx = side * slide * (r / 4) * u.x;
    const cy = side * slide * (r / 4) * u.y;
    const qx = x - cx;
    const qy = y - cy;
    const t = (qx * n.x + qy * n.y) * side; // かけらの内側ほど大きい（線からの距離）
    const d = Math.hypot(qx, qy);
    if (t < 0 || d > r) continue;
    if (d > r - edge) return 'outline';
    // 真ん中のボタンの内側は抜く（地の色が見える。作者の指摘: 白いと違和感がある）
    if (d < buttonInner) return 'none';
    if (d < buttonOuter) return 'outline';
    if (t < band) return 'outline';
    // 光は左上から: 左上へ向かうほど明るく、右下ほど暗く
    const light = (qx * -s2 + qy * -s2) / r;
    if (side === 1) {
      if (light > 0.55 && d < r - edge * 2.2 && d > r * 0.55) return 'redLight';
      return light < -0.35 ? 'redDark' : 'red';
    }
    return light < -0.45 ? 'whiteDark' : 'white';
  }
  return 'none';
}

/** 小さな絵を作る（大きさが GRID に収まる、いちばん大きい半径を探す） */
function makeGrid(): string[][] {
  for (let r = GRID; r > 2; r -= 0.25) {
    const grid: string[][] = [];
    let fits = true;
    for (let gy = 0; gy < GRID && fits; gy++) {
      const row: string[] = [];
      for (let gx = 0; gx < GRID; gx++) {
        const c = shade(gx + 0.5 - GRID / 2, gy + 0.5 - GRID / 2, r);
        // 端の1ドットは空けておく（縁が切れないように）
        if (c !== 'none' && (gx === 0 || gy === 0 || gx === GRID - 1 || gy === GRID - 1)) fits = false;
        row.push(c);
      }
      grid.push(row);
    }
    if (fits) return grid;
  }
  throw new Error('収まりませんでした');
}

/** pad: 絵のまわりに空けるドットの数（SNS は丸く切り抜かれるので広めに空ける） */
function write(grid: string[][], size: number, background: Rgba | null, file: string, pad = 0): void {
  const png = new PNG({ width: size, height: size });
  const scale = Math.floor(size / (GRID + pad * 2));
  const off = Math.floor((size - GRID * scale) / 2);
  for (let i = 0; i < size * size; i++) png.data.set(background ?? COLORS.none!, i * 4);
  grid.forEach((row, gy) =>
    row.forEach((c, gx) => {
      if (c === 'none') return;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) png.data.set(COLORS[c]!, ((off + gy * scale + dy) * size + off + gx * scale + dx) * 4);
      }
    }),
  );
  writeFileSync(file, PNG.sync.write(png));
}

const grid = makeGrid();
mkdirSync(iconDir, { recursive: true });
mkdirSync(brandDir, { recursive: true });
const back: Rgba = [32, 28, 56, 255];
// ファビコン（透明な地）
write(grid, 32, null, join(iconDir, 'favicon-32.png'));
write(grid, 64, null, join(iconDir, 'favicon-64.png'));
// ホーム画面のアイコン（暗い地。端が丸く切られるので少し空ける）
for (const size of [180, 192, 512]) write(grid, size, back, join(iconDir, `icon-${size}.png`), 3);
// SNS のプロフィール（暗い地。丸く切り抜かれても上から下まで収まるよう、まわりを広めに空ける）
write(grid, 1024, back, join(brandDir, 'profile-1024.png'), 5);
write(grid, 400, null, join(brandDir, 'logo-400-transparent.png'));
console.log(`${iconDir} と ${brandDir} に書き出しました（slide=${slide === 1 ? 'up' : 'down'}）`);
