import type Phaser from 'phaser';
import type { PixelSpritesConfig } from '../data/schema';

/** ドット絵（data/render/items.json）のテクスチャのキー */
export function pixelTextureKey(name: string): string {
  return `pixel:${name}`;
}

/**
 * 自作のドット絵（文字の表。1文字が1ドット、"." は透明）からテクスチャを作る（一度だけ）。
 * 公式の画像は使わない（ポケモンのドット絵は SpriteCollab、道具は自作）
 */
export function ensurePixelTextures(scene: Phaser.Scene, data: PixelSpritesConfig): void {
  for (const [name, rows] of Object.entries(data.sprites)) {
    const key = pixelTextureKey(name);
    if (scene.textures.exists(key)) continue;
    const h = rows.length;
    const w = rows[0]!.length;
    const tex = scene.textures.createCanvas(key, w, h);
    if (!tex) continue;
    const ctx = tex.getContext();
    rows.forEach((row, y) => {
      for (let x = 0; x < w; x++) {
        const color = data.palette[row[x]!];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      }
    });
    tex.refresh();
  }
}
