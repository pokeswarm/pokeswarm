import { itemSprites, spriteRender } from '../data';
import { loadSpriteManifest, spriteBaseUrl } from './sprites/spriteManifest';

/** ポケモンのアイコン（DOM 用の画像）: 待機の動作の下向きの1コマ目を、透明なところを切り詰めて切り出す */
export interface PokemonIcon {
  /** そのままの姿 */
  url: string;
  /** 黒塗り（まだ解放していないポケモン） */
  silhouetteUrl: string;
  width: number;
  height: number;
}

const cache = new Map<string, Promise<PokemonIcon | null>>();

/**
 * スプライトのキー（public/sprites/<key>）からアイコンを作る。スプライトを取得していなければ null。
 * 同じキーは1回だけ読む
 */
export function loadPokemonIcon(spriteKey: string, silhouetteColor: string): Promise<PokemonIcon | null> {
  const id = `${spriteKey}|${silhouetteColor}`;
  let p = cache.get(id);
  if (!p) {
    p = make(spriteKey, silhouetteColor).catch(() => null);
    cache.set(id, p);
  }
  return p;
}

async function make(spriteKey: string, silhouetteColor: string): Promise<PokemonIcon | null> {
  const manifest = await loadSpriteManifest(spriteKey);
  const anim = manifest?.animations[spriteRender.idleAnimation];
  if (!manifest || !anim) return null;
  const base = spriteBaseUrl(spriteKey);
  const [img, atlas] = await Promise.all([
    (async () => {
      const im = new Image();
      im.src = `${base}atlas.png`;
      await im.decode();
      return im;
    })(),
    fetch(`${base}atlas.json`).then((r) => r.json() as Promise<{ frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }> }>),
  ]);
  const f = atlas.frames[`${anim.frameKeyPrefix}/0/0`]?.frame;
  if (!f) return null;
  const src = document.createElement('canvas');
  src.width = f.w;
  src.height = f.h;
  const sctx = src.getContext('2d')!;
  sctx.drawImage(img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
  // 透明なところを切り詰める
  const data = sctx.getImageData(0, 0, f.w, f.h).data;
  let x0 = f.w;
  let y0 = f.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      if (data[(y * f.w + x) * 4 + 3]! === 0) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d')!;
  octx.drawImage(src, x0, y0, w, h, 0, 0, w, h);
  const url = out.toDataURL();
  // 黒塗り: 形だけを残して1色で塗る（元の色は画像に残さない）
  octx.globalCompositeOperation = 'source-in';
  octx.fillStyle = silhouetteColor;
  octx.fillRect(0, 0, w, h);
  return { url, silhouetteUrl: out.toDataURL(), width: w, height: h };
}

/** 自作のドット絵（data/render/items.json）のアイコン。タマゴの一覧のマス・かえる演出で使う */
export function pixelArtIcon(key: string, silhouetteColor: string, frame = key): PokemonIcon | null {
  const rows = itemSprites.sprites[frame];
  if (!rows) return null;
  const w = rows[0]!.length;
  const h = rows.length;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const color = itemSprites.palette[ch];
      if (ch === '.' || !color) return;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  const url = canvas.toDataURL();
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = silhouetteColor;
  ctx.fillRect(0, 0, w, h);
  return { url, silhouetteUrl: canvas.toDataURL(), width: w, height: h };
}
