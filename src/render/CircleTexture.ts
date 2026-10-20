import type Phaser from 'phaser';

/** 白い円のテクスチャを作る（色は tint で付ける）。仮表示用 */
export function ensureCircleTexture(scene: Phaser.Scene, key: string, radius: number): void {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({}, false);
  g.fillStyle(0xffffff);
  g.fillCircle(radius, radius, radius);
  g.generateTexture(key, radius * 2, radius * 2);
  g.destroy();
}
