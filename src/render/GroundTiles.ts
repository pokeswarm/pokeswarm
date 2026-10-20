import Phaser from 'phaser';
import { groundTileAt, type GroundConfig } from '../data/schema';

const textureKey = (id: string) => `ground-${id}`;

/** タイル画像を Phaser のローダーに登録する（preload の中で呼ぶ） */
export function preloadGroundTiles(scene: Phaser.Scene, ground: GroundConfig): void {
  for (const [id, tile] of Object.entries(ground.tiles)) {
    if (!scene.textures.exists(textureKey(id))) scene.load.image(textureKey(id), tile.file);
  }
}

/**
 * マップの地面。繰り返しタイルを敷き、時間帯ごとのタイルに切り替える。
 * 切り替えは、新しいタイルを重ねて徐々に濃くする（fadeSeconds）。カメラに合わせて模様をずらす
 */
export class GroundTiles {
  private readonly sprites: Phaser.GameObjects.TileSprite[];
  private current: string;
  /** 0 のとき sprites[0] だけ、1 のとき sprites[1] だけが見える */
  private front = 0;
  private fade = 1;

  constructor(
    scene: Phaser.Scene,
    private readonly ground: GroundConfig,
    seconds: number,
  ) {
    this.current = groundTileAt(ground, seconds);
    const { width, height } = scene.scale;
    this.sprites = [0, 1].map((i) =>
      scene.add
        .tileSprite(0, 0, width, height, textureKey(this.current))
        .setOrigin(0)
        .setScrollFactor(0)
        .setDepth(-1000 + i)
        .setTileScale(ground.tileScale)
        .setVisible(i === 0),
    );
    scene.scale.on(Phaser.Scale.Events.RESIZE, (size: Phaser.Structs.Size) => this.sprites.forEach((s) => s.setSize(size.width, size.height)));
  }

  update(camera: Phaser.Cameras.Scene2D.Camera, seconds: number, deltaMs: number): void {
    const wanted = groundTileAt(this.ground, seconds);
    if (wanted !== this.current) this.switchTo(wanted);
    if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + deltaMs / 1000 / this.ground.fadeSeconds);
      this.sprites[this.front]!.setAlpha(this.fade);
      if (this.fade >= 1) this.sprites[1 - this.front]!.setVisible(false);
    }
    // タイル画像の1ドットが tileScale 倍で描かれるので、ワールドの移動量を tileScale で割って模様をずらす
    for (const s of this.sprites) s.setTilePosition(camera.scrollX / this.ground.tileScale, camera.scrollY / this.ground.tileScale);
  }

  private switchTo(id: string): void {
    this.current = id;
    // フェードの途中で次の切り替えが来たら、そこまでの切り替えを完了させてから重ねる
    this.sprites[this.front]!.setAlpha(1);
    this.sprites[1 - this.front]!.setVisible(false);
    if (this.ground.fadeSeconds <= 0) {
      this.sprites[this.front]!.setTexture(textureKey(id));
      return;
    }
    const old = this.sprites[this.front]!;
    this.front = 1 - this.front;
    const next = this.sprites[this.front]!;
    next.setTexture(textureKey(id)).setAlpha(0).setVisible(true).setDepth(-999);
    old.setDepth(-1000);
    this.fade = 0;
  }
}
