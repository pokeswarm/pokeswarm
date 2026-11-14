/**
 * 技のアイコンの絵を書き出す（07 の264・265章）。
 *   npm run move-icons                       data/render/move-icons.json を書き出す
 *   npm run move-icons -- --preview out.png  前の絵（白い絵柄）と新しい絵を並べた確認用の画像も書く
 *
 * 作者の決まり（2026年11月15日）: アイコンのドット絵に黒の輪郭線を使わない。技ごとに「何を発生させたか」から考えて 1 つのアイコンにする。
 * そこで、ゲームの中でその技が出すもの（src/render/moveArt.ts の技の絵: 火の玉・爪あと・水の流れ など）を、
 * アイコンの細かさで描き直して並べる（大きさ・向き・数をアイコンに合わせる）。形は絵の色の濃淡で出し、輪郭は足さない。
 * 絵は 32 × 32。外側の 2 ドットは枠なので、3〜28 の中に置く。背景はタイプの色を暗くした四角（描かない所）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { iconPixels, type IconTier } from '../src/render/iconPixels.ts';
import { drawMoveArt } from '../src/render/moveArt.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const N = 32;

/** アイコンに置く技の絵 1 つ */
interface Layer {
  /** 技の絵の名前（moveArt.ts） */
  art: string;
  /** 部品（main。線の絵は line で start・middle・end をつなぐ） */
  part?: string;
  /** 線の絵: middle をいくつ並べるか */
  line?: number;
  /** コマ（省略で真ん中のコマ） */
  frame?: number;
  /** 細かさ（1 がゲームの基準のマス数） */
  k: number;
  /** 置く中心 */
  x: number;
  y: number;
  /** 回す角度（度。右回り） */
  rot?: number;
  flip?: boolean;
}

/** 技の名前ごとのアイコン（作者に見せる見本から。07 の265章） */
const ICONS: Record<string, Layer[]> = {
  // ひのこ: 火の玉が 2 つ、右上へ飛ぶ
  ember: [
    { art: 'ember', k: 1.2, x: 9.5, y: 22.5, rot: -35 },
    { art: 'ember', k: 1.55, x: 18.5, y: 13, rot: -35 },
  ],
  // かえんほうしゃ: 炎の流れ
  flamethrower: [{ art: 'flame-cone', k: 0.95, x: 16, y: 16, rot: -40 }],
  // ほのおのキバ: 炎をまとったキバが閉じる
  'fire-fang': [{ art: 'fang-front-fire', part: 'front', frame: 0, k: 1.1, x: 16, y: 16.5 }],
  // ひっかく: 爪あと
  scratch: [{ art: 'claw', k: 2.1, x: 16, y: 16 }],
  // つるのムチ: しなるつる
  'vine-whip': [{ art: 'vine-line', line: 2, k: 1.05, x: 16, y: 16, rot: -40 }],
  // ハイドロポンプ: 水の激流
  'hydro-pump': [{ art: 'water-stream', line: 2, k: 0.78, x: 16, y: 16, rot: -40 }],
  // あわ: 大小の泡
  bubble: [
    { art: 'bubble', k: 1.25, x: 12.5, y: 18.5 },
    { art: 'bubble', k: 0.8, x: 22.5, y: 9.5 },
    { art: 'bubble', k: 0.6, x: 23.5, y: 23 },
  ],
  // 10まんボルト: 当たった所で弾ける雷
  thunderbolt: [{ art: 'burst-thunder', k: 1.05, x: 16, y: 16 }],
};

type Grid = { w: number; h: number; px: (string | null)[] };

/** 黒に近い色（ゲームの絵のふちの暗い色）。アイコンでは黒の輪郭線を使わない（作者の決まり 2026年11月15日）ので描かない */
function nearBlack(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const l = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return l < 0.2;
}

/** 技の絵の 1 コマを、色のマス（hex か null）にする */
function artGrid(l: Layer): Grid {
  const sp = drawMoveArt(l.art, l.k);
  if (!sp) throw new Error(`技の絵 ${l.art} がありません`);
  const pick = (part: string): string[] => {
    const frames = sp.parts[part];
    if (!frames) throw new Error(`技の絵 ${l.art} に部品 ${part} がありません（${Object.keys(sp.parts).join(', ')}）`);
    return frames[l.frame ?? Math.floor(frames.length / 2)] ?? frames[0]!;
  };
  const pieces: string[][] = l.line !== undefined ? [pick('start'), ...Array.from({ length: l.line }, () => pick('middle')), pick('end')] : [pick(l.part ?? 'main')];
  const h = Math.max(...pieces.map((p) => p.length));
  const w = pieces.reduce((a, p) => a + (p[0]?.length ?? 0), 0);
  const px: (string | null)[] = Array(w * h).fill(null);
  let ox = 0;
  for (const p of pieces) {
    const pw = p[0]?.length ?? 0;
    const oy = Math.floor((h - p.length) / 2);
    p.forEach((row, y) => [...row].forEach((ch, x) => {
      const c = ch === '.' ? undefined : sp.palette[parseInt(ch, 36)];
      if (c && !nearBlack(c)) px[(oy + y) * w + ox + x] = c;
    }));
    ox += pw;
  }
  return { w, h, px };
}

/** アイコンを描く: 絵を順に重ねる（回すときはゲームと同じく近いマスを取る） */
function drawIcon(layers: Layer[]): (string | null)[] {
  const out: (string | null)[] = Array(N * N).fill(null);
  for (const l of layers) {
    const g = artGrid(l);
    const a = ((l.rot ?? 0) * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (let y = 2; y < N - 2; y++) {
      for (let x = 2; x < N - 2; x++) {
        const dx = x + 0.5 - l.x;
        const dy = y + 0.5 - l.y;
        // 逆に回して絵の中の位置へ
        let u = dx * c + dy * s + g.w / 2;
        const v = -dx * s + dy * c + g.h / 2;
        if (l.flip) u = g.w - u;
        const sx = Math.floor(u);
        const sy = Math.floor(v);
        if (sx < 0 || sy < 0 || sx >= g.w || sy >= g.h) continue;
        const col = g.px[sy * g.w + sx];
        if (col) out[y * N + x] = col;
      }
    }
  }
  return out;
}

function toArt(px: (string | null)[]): { palette: string[]; rows: string[] } {
  const palette: string[] = [];
  const rows: string[] = [];
  for (let y = 0; y < N; y++) {
    let row = '';
    for (let x = 0; x < N; x++) {
      const c = px[y * N + x];
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
const moves = (read('data/game/moves.json') as { moves: Record<string, { pattern: string }> }).moves;
const out: Record<string, { palette: string[]; rows: string[] }> = {};
for (const [key, layers] of Object.entries(ICONS)) {
  if (!moves[key]) throw new Error(`技 ${key} が data/game/moves.json にありません`);
  out[key] = toArt(drawIcon(layers));
}
const file = path.join(ROOT, 'data/render/move-icons.json');
fs.writeFileSync(file, JSON.stringify({ credit: '自作（scripts/make-move-icons.ts が src/render/moveArt.ts の技の絵から作る）', size: N, icons: out }, null, 2) + '\n');
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
  for (let i = 0; i < png.data.length; i += 4) png.data.set([42, 44, 56, 255], i);
  const blit = (px: Uint8ClampedArray, ox: number, oy: number, s: number): void => {
    for (let y = 0; y < N * s; y++) {
      for (let x = 0; x < N * s; x++) {
        const si = (Math.floor(y / s) * N + Math.floor(x / s)) * 4;
        if (!px[si + 3]) continue;
        png.data.set([px[si]!, px[si + 1]!, px[si + 2]!, 255], ((oy + y) * png.width + ox + x) * 4);
      }
    }
  };
  keys.forEach((k, i) => {
    const color = icons.typeColors[gen[k]?.type ?? 'normal'] ?? '#888888';
    const glyph = icons.moveGlyphs[k] ?? icons.moves[moves[k]!.pattern] ?? 'nearest';
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
