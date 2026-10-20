import type Phaser from 'phaser';
import type { SpriteAnims, SpriteRenderConfig } from '../../data/schema';
import { PokemonSpriteView } from './PokemonSprite';

/**
 * 確認用: 待機・歩きを8方向すべて並べて表示する（URL に ?gallery を付けたとき）。
 * 行は動作（待機, 歩き）、列は SpriteCollab の行の並び（下, 右下, 右, 右上, 上, 左上, 左, 左下）。
 */
export function addSpriteGallery(scene: Phaser.Scene, manifest: SpriteAnims, style: SpriteRenderConfig, originX: number, originY: number): void {
  const animations = [style.idleAnimation, style.walkAnimation];
  animations.forEach((anim, row) => {
    for (let dir = 0; dir < manifest.directions.length; dir++) {
      const view = new PokemonSpriteView(scene, manifest, style.playerScale);
      view.sprite.setPosition(originX + (dir - 3.5) * style.gallerySpacing, originY + row * style.gallerySpacing);
      view.play(anim, dir);
    }
  });
}
