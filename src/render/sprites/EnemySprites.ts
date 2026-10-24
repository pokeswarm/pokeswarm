import type Phaser from 'phaser';
import type { SpriteAnims } from '../../data/schema';
import type { EnemyStore } from '../../sim/entities/enemies';
import { animKey, atlasKey } from './PokemonSprite';

interface Slot {
  sprite: Phaser.GameObjects.Sprite;
  dir: number;
  /** この描画で使ったか（使わなかった枠はプールへ戻す） */
  seen: boolean;
}

/**
 * 雑魚敵をポケモンのスプライトで描く。
 * 敵の id ごとにスプライトを割り当て（並び順が変わってもアニメーションが途切れないように）、
 * 画面外や倒れた敵の分はプールへ戻して使い回す。
 */
export class EnemySprites {
  private readonly slots = new Map<number, Slot>();
  private readonly free: Phaser.GameObjects.Sprite[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    /** 敵の種類（data/game/enemies.json の並び）ごとのスプライト。まだ読み込んでいなければ null */
    private readonly manifestOf: (kind: number) => SpriteAnims | null,
    private readonly scale: number,
    private readonly animation: string,
    private readonly depth: number,
    /** 種類ごとの大きさの倍率（中ボス・ボスを大きく描く） */
    private readonly scaleOfKind: (kind: number) => number = () => 1,
    /** 種類ごとの、重なったときに手前に出す順（大きいほど手前。depth に 0.1 ずつ足す） */
    private readonly layerOfKind: (kind: number) => number = () => 0,
    /** 種類ごとに別の重なりの順にするとき（中ボス・ボス）。null ならふつう */
    private readonly depthOfKind: (kind: number) => number | null = () => null,
  ) {}

  /** 描いた数を返す */
  update(
    e: EnemyStore,
    alpha: number,
    view: { left: number; top: number; right: number; bottom: number },
    /** 色を付けるなら色、付けないなら null（状態異常の表示） */
    tintOf: (index: number) => number | null = () => null,
  ): number {
    for (const slot of this.slots.values()) slot.seen = false;
    let drawn = 0;
    for (let i = 0; i < e.count; i++) {
      // 先に消して見せている敵（ゲストが倒したと見込んだもの）は描かない
      if (e.hp[i]! <= 0) continue;
      const manifest = this.manifestOf(e.kind[i]!);
      if (!manifest) continue;
      const x = e.prevX[i]! + (e.x[i]! - e.prevX[i]!) * alpha;
      const y = e.prevY[i]! + (e.y[i]! - e.prevY[i]!) * alpha;
      const margin = e.radius[i]! * 4;
      if (x + margin < view.left || x - margin > view.right || y + margin < view.top || y - margin > view.bottom) continue;

      const id = e.id[i]!;
      let slot = this.slots.get(id);
      if (!slot) {
        const sprite = this.free.pop() ?? this.scene.add.sprite(0, 0, atlasKey(manifest.key)).setDepth(this.depth);
        // 使い回すスプライトは前の種類の大きさのままなので、毎回合わせる
        sprite.setScale(this.scale * this.scaleOfKind(e.kind[i]!));
        sprite.setDepth(this.depthOfKind(e.kind[i]!) ?? this.depth + this.layerOfKind(e.kind[i]!) * 0.1);
        slot = { sprite, dir: 0, seen: false };
        this.slots.set(id, slot);
        sprite.setVisible(true);
        // 全員が同じコマで動かないよう、id でずらして始める
        const frames = manifest.animations[this.animation]?.durations.length ?? 1;
        sprite.play({ key: animKey(manifest.key, this.resolve(manifest), 0), startFrame: id % frames });
      }
      slot.seen = true;
      const dx = e.x[i]! - e.prevX[i]!;
      const dy = e.y[i]! - e.prevY[i]!;
      if (dx !== 0 || dy !== 0) slot.dir = directionFromVector(dx, dy);
      const key = animKey(manifest.key, this.resolve(manifest), slot.dir);
      if (slot.sprite.anims.currentAnim?.key !== key) {
        const frame = slot.sprite.anims.currentFrame?.index ?? 1;
        slot.sprite.play({ key, startFrame: frame - 1 });
      }
      slot.sprite.setPosition(x, y);
      const tint = tintOf(i);
      if (tint === null) slot.sprite.clearTint();
      else slot.sprite.setTint(tint);
      drawn++;
    }
    for (const [id, slot] of this.slots) {
      if (slot.seen) continue;
      slot.sprite.setVisible(false).stop();
      this.free.push(slot.sprite);
      this.slots.delete(id);
    }
    return drawn;
  }

  private resolve(manifest: SpriteAnims): string {
    return manifest.animations[this.animation] ? this.animation : Object.keys(manifest.animations)[0]!;
  }
}

/** 移動の向き（ベクトル）を SpriteCollab の行番号（下, 右下, 右, 右上, 上, 左上, 左, 左下）にする */
export function directionFromVector(dx: number, dy: number): number {
  // y は下が正。右を 0 として 45° ごとの区切りを数える
  const k = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return (((2 - k) % 8) + 8) % 8;
}
