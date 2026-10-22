/**
 * ホーム画面に追加したときのアイコンを作る（作者の決定 2026年10月22日: スマホはホーム画面に追加して全画面で遊んでもらう）。
 *
 *   node scripts/make-app-icon.ts
 *
 * 入力: data/render/items.json の自作のドット絵（ふしぎなアメ）。公式の画像は使わない
 * 出力: public/icons/icon-180.png・icon-192.png・icon-512.png（黒い地に、ドット絵をニアレストネイバーで拡大）
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const art = JSON.parse(readFileSync(join(ROOT, 'data', 'render', 'items.json'), 'utf8')) as { palette: Record<string, string>; sprites: Record<string, string[]> };
const rows = art.sprites['rare-candy']!;
const h = rows.length;
const w = rows[0]!.length;

mkdirSync(join(ROOT, 'public', 'icons'), { recursive: true });
for (const size of [180, 192, 512]) {
  const png = new PNG({ width: size, height: size });
  // 黒い地
  for (let i = 0; i < size * size; i++) png.data.set([0, 0, 0, 255], i * 4);
  // ドット絵を、縁を少し空けて整数倍で真ん中に置く
  const scale = Math.floor((size * 0.8) / Math.max(w, h));
  const ox = Math.floor((size - w * scale) / 2);
  const oy = Math.floor((size - h * scale) / 2);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const hex = art.palette[ch];
      if (ch === '.' || !hex) return;
      const rgb = [1, 3, 5].map((p) => parseInt(hex.slice(p, p + 2), 16));
      const a = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) : 255;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = ((oy + y * scale + dy) * size + ox + x * scale + dx) * 4;
          png.data.set([...rgb.map((c) => Math.round((c * a) / 255)), 255], i);
        }
      }
    });
  });
  writeFileSync(join(ROOT, 'public', 'icons', `icon-${size}.png`), PNG.sync.write(png));
}
console.log('public/icons/ にアイコンを出力しました。');
