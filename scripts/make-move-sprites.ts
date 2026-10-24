/**
 * 技のドット絵の基準（細かさ k = 1）を書き出す。絵の描き方は src/render/moveArt.ts（ゲームの中でも同じ関数で、必要な細かさに描き直す）。
 *
 *   npm run move-sprites
 *
 * 出力: data/render/move-sprites.json（コミットする。技の指定の検証と、基準の大きさに使う）
 * 確認用: --preview=<フォルダ> で、各コマを拡大した PNG を書き出す。--k=<倍率> でその細かさで描いた PNG にする
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { drawMoveArt, MOVE_ART_CREDIT, moveArtIds, type SpriteOut } from '../src/render/moveArt.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]));

const draw = (k: number): Record<string, SpriteOut> => Object.fromEntries(moveArtIds().map((id) => [id, drawMoveArt(id, k)!]));
const out = { credit: MOVE_ART_CREDIT, sprites: draw(1) };
writeFileSync(join(ROOT, 'data/render/move-sprites.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`技のドット絵 ${Object.keys(out.sprites).length} 種類を data/render/move-sprites.json に出力しました。`);

// 確認用: 部品ごとにコマを横に並べ、拡大した PNG を書き出す
const previewDir = args.get('preview');
if (previewDir) {
  mkdirSync(previewDir, { recursive: true });
  const k = Number(args.get('k') ?? 1);
  const SCALE = Math.max(2, Math.round(8 / k));
  for (const [id, sp] of Object.entries(k === 1 ? out.sprites : draw(k))) {
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
            const rgb = [1, 3, 5].map((c) => parseInt(hex.slice(c, c + 2), 16));
            for (let yy = 0; yy < SCALE; yy++) for (let xx = 0; xx < SCALE; xx++) png.data.set([...rgb, 255], (((oy + y) * SCALE + yy) * png.width + (ox + x) * SCALE + xx) * 4);
          }),
        );
        ox += f[0]!.length + 2;
      }
      oy += frames[0]!.length + 2;
    }
    writeFileSync(join(previewDir, `${id}.png`), PNG.sync.write(png));
  }
  console.log(`確認用の PNG（細かさ ${k}）を ${previewDir} に出力しました。`);
}
