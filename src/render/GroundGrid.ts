import Phaser from 'phaser';
import type { PlaceholderRenderConfig } from '../data/schema';
import { hexColor } from './color';

const TEXTURE_KEY = 'placeholder-grid';

/** 仮の地面（格子）。移動していることが分かるように、カメラに合わせて模様をずらす */
export class GroundGrid {
  private readonly sprite: Phaser.GameObjects.TileSprite;

  constructor(scene: Phaser.Scene, style: PlaceholderRenderConfig) {
    const size = style.gridSize;
    if (!scene.textures.exists(TEXTURE_KEY)) {
      const g = scene.make.graphics({}, false);
      g.fillStyle(hexColor(style.backgroundColor));
      g.fillRect(0, 0, size, size);
      g.lineStyle(1, hexColor(style.gridColor));
      g.strokeRect(0, 0, size, size);
      g.generateTexture(TEXTURE_KEY, size, size);
      g.destroy();
    }
    const { width, height } = scene.scale;
    this.sprite = scene.add.tileSprite(0, 0, width, height, TEXTURE_KEY).setOrigin(0).setScrollFactor(0).setDepth(-1000);
    scene.scale.on(Phaser.Scale.Events.RESIZE, (size: Phaser.Structs.Size) => this.sprite.setSize(size.width, size.height));
  }

  update(camera: Phaser.Cameras.Scene2D.Camera): void {
    this.sprite.setTilePosition(camera.scrollX, camera.scrollY);
  }
}
