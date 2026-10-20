import type Phaser from 'phaser';
import type { SpriteAnims } from '../../data/schema';
import { spriteBaseUrl } from './spriteManifest';

export function atlasKey(key: string): string {
  return `sprite:${key}`;
}

export function animKey(key: string, animation: string, dir: number): string {
  return `${key}/${animation}/${dir}`;
}

/** Phaser のローダーにアトラスを登録する（preload の中で呼ぶ） */
export function preloadPokemonAtlas(scene: Phaser.Scene, manifest: SpriteAnims): void {
  const base = spriteBaseUrl(manifest.key);
  scene.load.atlas(atlasKey(manifest.key), `${base}atlas.png`, `${base}atlas.json`);
}

/** 動作 × 8方向のアニメーションを登録する */
export function registerPokemonAnimations(scene: Phaser.Scene, manifest: SpriteAnims): void {
  const texture = atlasKey(manifest.key);
  for (const [name, anim] of Object.entries(manifest.animations)) {
    for (let dir = 0; dir < manifest.directions.length; dir++) {
      const key = animKey(manifest.key, name, dir);
      if (scene.anims.exists(key)) continue;
      scene.anims.create({
        key,
        frames: anim.durations.map((d, f) => ({
          key: texture,
          frame: `${anim.frameKeyPrefix}/${dir}/${f}`,
          duration: d * manifest.durationUnitMs,
        })),
        repeat: -1,
      });
    }
  }
}

/**
 * 向き（各軸 -1/0/1、y は下が正）を SpriteCollab の行番号にする。
 * 行の並び: 下, 右下, 右, 右上, 上, 左上, 左, 左下
 */
export function directionIndex(fx: number, fy: number): number {
  const table: Record<string, number> = {
    '0,1': 0,
    '1,1': 1,
    '1,0': 2,
    '1,-1': 3,
    '0,-1': 4,
    '-1,-1': 5,
    '-1,0': 6,
    '-1,1': 7,
  };
  return table[`${Math.sign(fx)},${Math.sign(fy)}`] ?? 0;
}

/** ポケモン1体の表示。動作と向きを指定すると、対応するアニメーションを再生する */
export class PokemonSpriteView {
  readonly sprite: Phaser.GameObjects.Sprite;
  private current = '';

  constructor(
    scene: Phaser.Scene,
    private readonly manifest: SpriteAnims,
    scale: number,
  ) {
    this.sprite = scene.add.sprite(0, 0, atlasKey(manifest.key)).setScale(scale);
  }

  /** 動作が無ければ最初に定義された動作を使う */
  private resolve(animation: string): string {
    if (this.manifest.animations[animation]) return animation;
    return Object.keys(this.manifest.animations)[0]!;
  }

  play(animation: string, dir: number): void {
    const key = animKey(this.manifest.key, this.resolve(animation), dir);
    if (key === this.current) return;
    const prev = this.current;
    this.current = key;
    // 向きだけが変わったときは、コマの位置を引き継いで動きが途切れないようにする
    const sameAnim = prev.slice(0, prev.lastIndexOf('/')) === key.slice(0, key.lastIndexOf('/'));
    const startFrame = sameAnim ? (this.sprite.anims.currentFrame?.index ?? 1) - 1 : 0;
    this.sprite.play({ key, startFrame });
  }
}
