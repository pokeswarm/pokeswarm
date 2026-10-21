import type Phaser from 'phaser';
import { ensureCircleTexture } from './CircleTexture';

const TEXTURE_KEY = 'placeholder-circle';
const TEXTURE_RADIUS = 16;

/** 型付き配列で持つ集まり（敵・発射体）を描くのに必要な項目 */
export interface CircleSource {
  readonly count: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly prevX: Float64Array;
  readonly prevY: Float64Array;
  readonly radius: Float64Array;
}

/**
 * 大量の円をスプライトの使い回し（プール）で描く。
 * 画面外のものは描かない。色は呼び出し側が index ごとに決める。
 */
export class PooledCircles {
  private readonly pool: Phaser.GameObjects.Image[] = [];
  private visibleCount = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
  ) {
    ensureCircleTexture(scene, TEXTURE_KEY, TEXTURE_RADIUS);
  }

  /** 描いた数を返す */
  update(
    src: CircleSource,
    alpha: number,
    view: { left: number; top: number; right: number; bottom: number },
    colorOf: (index: number) => number,
    include: (index: number) => boolean = () => true,
  ): number {
    let used = 0;
    for (let i = 0; i < src.count; i++) {
      if (!include(i)) continue;
      const r = src.radius[i]!;
      const x = src.prevX[i]! + (src.x[i]! - src.prevX[i]!) * alpha;
      const y = src.prevY[i]! + (src.y[i]! - src.prevY[i]!) * alpha;
      if (x + r < view.left || x - r > view.right || y + r < view.top || y - r > view.bottom) continue;
      let img = this.pool[used];
      if (!img) {
        img = this.scene.add.image(0, 0, TEXTURE_KEY).setDepth(this.depth);
        this.pool.push(img);
      }
      img.setPosition(x, y).setScale(r / TEXTURE_RADIUS).setTint(colorOf(i)).setVisible(true);
      used++;
    }
    for (let k = used; k < this.visibleCount; k++) this.pool[k]!.setVisible(false);
    this.visibleCount = used;
    return used;
  }
}

/**
 * 大量の小さなドット絵を、スプライトの使い回し（プール）で描く（経験値の玉。作者の決定: 画面の中のものはすべてドット絵）。
 * テクスチャは呼び出し側が index ごとに決める。大きさは scale で固定（当たり判定の大きさでは伸ばさない）
 */
export class PooledSprites {
  private readonly pool: Phaser.GameObjects.Image[] = [];
  private visibleCount = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
    private readonly scale: number,
  ) {}

  update(
    src: CircleSource,
    alpha: number,
    view: { left: number; top: number; right: number; bottom: number },
    textureOf: (index: number) => string,
    include: (index: number) => boolean = () => true,
  ): number {
    let used = 0;
    for (let i = 0; i < src.count; i++) {
      if (!include(i)) continue;
      const x = src.prevX[i]! + (src.x[i]! - src.prevX[i]!) * alpha;
      const y = src.prevY[i]! + (src.y[i]! - src.prevY[i]!) * alpha;
      if (x + 16 < view.left || x - 16 > view.right || y + 16 < view.top || y - 16 > view.bottom) continue;
      let img = this.pool[used];
      if (!img) {
        img = this.scene.add.image(0, 0, textureOf(i)).setDepth(this.depth).setScale(this.scale);
        this.pool.push(img);
      }
      const key = textureOf(i);
      if (img.texture.key !== key) img.setTexture(key);
      // ドットがにじまないよう、整数の位置に置く
      img.setPosition(Math.round(x), Math.round(y)).setVisible(true);
      used++;
    }
    for (let k = used; k < this.visibleCount; k++) this.pool[k]!.setVisible(false);
    this.visibleCount = used;
    return used;
  }
}
