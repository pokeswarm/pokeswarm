import Phaser from 'phaser';

/**
 * 伝説の技の絵の共通の道具（07 の294・297章）: 1 ドットずつ計算したドット絵のテクスチャを作り、使い回しの画像で並べる。
 * 色はすべて不透明。薄さ・消え際はディザ（市松の点の密度）で出す。半透明の塗りは使わない（07 の141章）
 */

/** 絵の 1 ドット（ワールドの単位） */
export const DOT = 2;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** ディザのしきい値（0〜1） */
export const th = (x: number, y: number): number => (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16;
/** 密度 d（0〜1）のとき、この点を描くか */
export const on = (d: number, x: number, y: number): boolean => d > th(x, y);
/** 不透明の色（0xRRGGBB → 画像の 1 点） */
export const c = (hex: number): number => ((255 << 24) | ((hex & 0xff) << 16) | (hex & 0xff00) | ((hex >> 16) & 0xff)) >>> 0;
/** 色の段（暗い → 明るい）から t（0〜1）の色。段の境はディザで混ぜる */
export const shade = (cols: readonly number[], t: number, x: number, y: number): number => {
  const n = cols.length - 1;
  const v = Math.max(0, Math.min(0.999, t)) * n + (th(x, y) - 0.5) * 0.6;
  return c(cols[Math.max(0, Math.min(n, Math.round(v)))]!);
};

/** 決まった乱数（0〜1） */
export function rnd(a: number, b: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/** テクスチャを作る（px が 0 を返した点は透明） */
export function makeTexture(scene: Phaser.Scene, key: string, w: number, h: number, px: (x: number, y: number) => number): void {
  const tx = scene.textures;
  if (tx.exists(key)) tx.remove(key);
  const cv = tx.createCanvas(key, w, h)!;
  const ctx = cv.getContext();
  const img = ctx.createImageData(w, h);
  const out = new Uint32Array(img.data.buffer);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = px(x, y);
  ctx.putImageData(img, 0, 0);
  cv.refresh();
}

/** 使い回しの画像と、小さな不透明の点（火花・粒） */
export class DotPool {
  private readonly pool: Phaser.GameObjects.Image[] = [];
  private used = 0;
  private readonly dots: Phaser.GameObjects.Graphics;

  constructor(
    private readonly scene: Phaser.Scene,
    dotsDepth: number,
  ) {
    this.dots = scene.add.graphics().setDepth(dotsDepth);
  }

  begin(): void {
    this.used = 0;
    this.dots.clear();
  }

  end(): void {
    for (let k = this.used; k < this.pool.length; k++) this.pool[k]!.setVisible(false);
  }

  image(key: string, depth: number): Phaser.GameObjects.Image {
    let img = this.pool[this.used];
    if (!img) {
      img = this.scene.add.image(0, 0, key);
      this.pool.push(img);
    }
    this.used++;
    return img.setCrop().setTexture(key).setVisible(true).setAlpha(1).setRotation(0).setScale(DOT).setOrigin(0.5, 0.5).setDepth(depth).setFlipX(false);
  }

  /** 小さな不透明の四角の点（大きさで消え際を出す） */
  dot(x: number, y: number, s: number, col: number): void {
    if (s < 1) return;
    this.dots.fillStyle(col, 1).fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
  }
}
