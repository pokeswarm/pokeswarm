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
  /** 夜の暗さ（0 = 昼、1 = 夜の色をそのまま掛ける） */
  private nightLevel: number;
  private readonly nightColor: Phaser.Display.Color;

  constructor(
    scene: Phaser.Scene,
    private readonly ground: GroundConfig,
    wave: number,
    /** 区間ごとの、夜か（地方のステージ。無ければずっと昼） */
    private readonly night: readonly boolean[] = [],
  ) {
    this.current = groundTileAt(ground, wave);
    this.nightLevel = this.isNight(wave) ? 1 : 0;
    this.nightColor = Phaser.Display.Color.HexStringToColor(ground.nightTint);
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
    this.applyNight();
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
    // 夜の区間へ入ったら、地面の切り替えと同じ秒数で暗くする（出たら明るくする）
    const target = this.isNight(wave) ? 1 : 0;
    if (this.nightLevel !== target) {
      const step = this.ground.fadeSeconds > 0 ? deltaMs / 1000 / this.ground.fadeSeconds : 1;
      this.nightLevel = target > this.nightLevel ? Math.min(target, this.nightLevel + step) : Math.max(target, this.nightLevel - step);
      this.applyNight();
    }
    // タイル画像の1ドットが tileScale 倍で描かれるので、ワールドの移動量を tileScale で割って模様をずらす
    for (const s of this.sprites) s.setTilePosition(camera.scrollX / this.ground.tileScale, camera.scrollY / this.ground.tileScale);
  }

  private isNight(wave: number): boolean {
    return this.night.length > 0 && !!this.night[Math.min(wave, this.night.length - 1)];
  }

  /** 白（そのまま）と夜の色の間を nightLevel で混ぜて、地面に掛ける */
  private applyNight(): void {
    const mix = (c: number) => Math.round(255 + (c - 255) * this.nightLevel);
    const tint = Phaser.Display.Color.GetColor(mix(this.nightColor.red), mix(this.nightColor.green), mix(this.nightColor.blue));
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
