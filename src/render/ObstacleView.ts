import type Phaser from 'phaser';
import type { PixelSpritesConfig } from '../data/schema';
import { forEachObstacleIn } from '../sim/obstacles';
import { currentWaveIndex, type World } from '../sim/world';
import { ensurePixelTextures, pixelTextureKey } from './PixelArt';

/** 見た目を当たり判定より少し上にずらす（木の幹・岩の下の方が当たり判定に重なるように） */
const LIFT = 6;

/**
 * マップの障害物を、自作のドット絵（data/render/obstacles.json）で描く。
 * 画面に見えるマスの障害物だけに画像を割り当て、見えなくなったら使い回す。見た目は今の区間の種類から選ぶ
 */
export class ObstacleView {
  private readonly shown = new Map<string, Phaser.GameObjects.Image>();
  private readonly free: Phaser.GameObjects.Image[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly sprites: PixelSpritesConfig,
    private readonly depth: number,
  ) {
    ensurePixelTextures(scene, sprites);
  }

  update(world: World, view: { left: number; top: number; right: number; bottom: number }): void {
    const kinds = world.rules.obstacles.sections[currentWaveIndex(world)] ?? world.rules.obstacles.sections[0] ?? [];
    if (kinds.length === 0) return;
    const margin = 64;
    const seen = new Set<string>();
    forEachObstacleIn(world, view.left - margin, view.top - margin, view.right + margin, view.bottom + margin, (o) => {
      const key = `${o.x},${o.y}`;
      seen.add(key);
      const texture = pixelTextureKey(kinds[o.variant % kinds.length]!);
      let img = this.shown.get(key);
      if (!img) {
        img = this.free.pop() ?? this.scene.add.image(0, 0, texture).setScale(this.sprites.dot).setDepth(this.depth);
        img.setVisible(true).setPosition(o.x, o.y - LIFT);
        this.shown.set(key, img);
      }
      if (img.texture.key !== texture) img.setTexture(texture);
    });
    for (const [key, img] of this.shown) {
      if (seen.has(key)) continue;
      img.setVisible(false);
      this.free.push(img);
      this.shown.delete(key);
    }
  }
}
