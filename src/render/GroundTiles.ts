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
  /** 今、地面に掛けている色（赤・緑・青。白 = そのまま）。夜・天気の色へ fadeSeconds かけて近づける */
  private readonly tint: [number, number, number];

  constructor(
    scene: Phaser.Scene,
    private readonly ground: GroundConfig,
    wave: number,
    /** 地面に掛ける色（夜の色・ホウエンの天気の色。#rrggbb）。null はそのまま。無ければずっとそのまま */
    private readonly tintAt: (wave: number) => string | null = () => null,
  ) {
    this.current = groundTileAt(ground, wave);
    this.tint = this.targetTint(wave);
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
    this.applyTint();
    const onResize = (size: Phaser.Structs.Size): void => this.sprites.forEach((s) => s.setSize(size.width, size.height));
    scene.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    // ランを始め直したとき（もう一度）に、前のランのタイルへ届き続けないよう外す
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.scale.off(Phaser.Scale.Events.RESIZE, onResize));
  }

  /**
   * カメラの描く範囲をちょうど覆うように、大きさと位置を合わせる（拡大率が 1 未満でも隙間ができないように。
   * 画面に固定した物は、カメラの真ん中を基準に拡大されるので、その分を戻す）
   */
  private fit(camera: Phaser.Cameras.Scene2D.Camera): void {
    const z = camera.zoom || 1;
    const w = Math.ceil(camera.width / z) + 2;
    const h = Math.ceil(camera.height / z) + 2;
    const x = (camera.width / 2) * (1 - 1 / z) - 1;
    const y = (camera.height / 2) * (1 - 1 / z) - 1;
    for (const s of this.sprites) {
      if (s.width !== w || s.height !== h) s.setSize(w, h);
      s.setPosition(x, y);
    }
  }

  update(camera: Phaser.Cameras.Scene2D.Camera, wave: number, deltaMs: number): void {
    // タイトル画面は本物のカメラではなく、模様の位置だけを渡す（そのときは画面の大きさのまま）
    if (camera instanceof Phaser.Cameras.Scene2D.BaseCamera) this.fit(camera);
    const wanted = groundTileAt(this.ground, wave);
    if (wanted !== this.current) this.switchTo(wanted);
    if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + deltaMs / 1000 / this.ground.fadeSeconds);
      this.sprites[this.front]!.setAlpha(this.fade);
      if (this.fade >= 1) this.sprites[1 - this.front]!.setVisible(false);
    }
    // 夜・天気の区間へ入ったら、地面の切り替えと同じ秒数でその色にする（出たら戻す）
    const target = this.targetTint(wave);
    if (target.some((c, k) => c !== this.tint[k])) {
      const step = this.ground.fadeSeconds > 0 ? (255 * deltaMs) / 1000 / this.ground.fadeSeconds : 255;
      for (let k = 0; k < 3; k++) {
        const d = target[k]! - this.tint[k]!;
        this.tint[k] = Math.abs(d) <= step ? target[k]! : this.tint[k]! + Math.sign(d) * step;
      }
      this.applyTint();
    }
    // タイル画像の1ドットが tileScale 倍で描かれるので、ワールドの移動量を tileScale で割って模様をずらす
    for (const s of this.sprites) s.setTilePosition(camera.scrollX / this.ground.tileScale, camera.scrollY / this.ground.tileScale);
  }

  private targetTint(wave: number): [number, number, number] {
    const hex = this.tintAt(wave);
    if (!hex) return [255, 255, 255];
    const c = Phaser.Display.Color.HexStringToColor(hex);
    return [c.red, c.green, c.blue];
  }

  private applyTint(): void {
    const tint = Phaser.Display.Color.GetColor(Math.round(this.tint[0]), Math.round(this.tint[1]), Math.round(this.tint[2]));
    for (const s of this.sprites) s.setTint(tint);
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
