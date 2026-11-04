import type Phaser from 'phaser';
import type { SpriteAnims } from '../../data/schema';
import type { EnemyStore } from '../../sim/entities/enemies';
import { animKey, atlasKey } from './PokemonSprite';

interface Slot {
  sprite: Phaser.GameObjects.Sprite;
  dir: number;
  /** この描画で使ったか（使わなかった枠はプールへ戻す） */
  seen: boolean;
  /** 今の浮いている高さ（見た目だけ） */
  lift?: number;
  /** 体の見た目を変えている間 */
  bodied?: boolean;
}

/**
 * 雑魚敵をポケモンのスプライトで描く。
 * 敵の id ごとにスプライトを割り当て（並び順が変わってもアニメーションが途切れないように）、
 * 画面外や倒れた敵の分はプールへ戻して使い回す。
 */
export class EnemySprites {
  private readonly slots = new Map<number, Slot>();
  private readonly free: Phaser.GameObjects.Sprite[] = [];
  /** 浮いている敵の足元の影 */
  private shadows: Phaser.GameObjects.Graphics | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    /** 敵の種類（data/game/enemies.json の並び）ごとのスプライト。まだ読み込んでいなければ null */
    private readonly manifestOf: (kind: number, hpRatio: number) => SpriteAnims | null,
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
    /** ふつうと違う動き（ドット絵の動作の名前。spin なら向きをくるくる回す）。ふつうなら null（伝説のカメックスの甲羅・ため） */
    poseOf: (index: number) => { anim: string; spin: boolean } | null = () => null,
    /** 濃さ（1 がふつう。消えているボスは 0、かげぶんしん の偽物は薄く。07 の167章） */
    alphaOf: (index: number) => number = () => 1,
    /** 状態異常による体の見た目（07 の177章。浮く・跳ねる・ふるえる・つぶれる・回る）。ふつうなら null */
    bodyOf: (index: number) => { lift: number; hop: number; shake: number; squash: number; spin: boolean } | null = () => null,
  ): number {
    this.shadows?.clear();
    for (const slot of this.slots.values()) slot.seen = false;
    let drawn = 0;
    for (let i = 0; i < e.count; i++) {
      // 先に消して見せている敵（ゲストが倒したと見込んだもの）は描かない
      if (e.hp[i]! <= 0) continue;
      const manifest = this.manifestOf(e.kind[i]!, e.hp[i]! / (e.maxHp[i]! || 1));
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
      const pose = poseOf(i);
      const anim = pose && manifest.animations[pose.anim] ? pose.anim : this.resolve(manifest);
      // くるくる回る（甲羅）: 8 つの向きを速く回す
      const body = bodyOf(i);
      const dir = pose?.spin || body?.spin ? Math.floor(this.scene.time.now / 45) % 8 : slot.dir;
      const key = animKey(manifest.key, anim, dir);
      if (slot.sprite.anims.currentAnim?.key !== key) {
        // コマ数の違う動作へ切り替えるので、新しい動作のコマ数を超えないようにする（超えると Phaser が止まる）
        const frame = slot.sprite.anims.currentFrame?.index ?? 1;
        const frames = manifest.animations[anim]?.durations.length ?? 1;
        slot.sprite.play({ key, startFrame: Math.min(frame - 1, frames - 1) });
      }
      // 浮く高さは少しずつ寄せる（ふわっと上がり、ふわっと降りる）
      slot.lift = (slot.lift ?? 0) + ((body?.lift ?? 0) - (slot.lift ?? 0)) * 0.25;
      if (slot.lift < 0.5) slot.lift = 0;
      if (body || slot.lift > 0) {
        const now = this.scene.time.now;
        const hop = body?.hop ? Math.abs(Math.sin(now / 70 + id)) * body.hop : 0;
        const shake = body?.shake ? Math.sin(now / 25 + id) * body.shake : 0;
        slot.sprite.setPosition(x + shake, y - slot.lift - hop);
        // 足元に影を残す（浮いている・跳ねている間）
        if (slot.lift + hop > 2) {
          this.shadows ??= this.scene.add.graphics().setDepth(this.depth - 0.05);
          this.shadows.fillStyle(0x000000, 0.3).fillEllipse(x, y + e.radius[i]! * 0.7, e.radius[i]! * 1.6, e.radius[i]! * 0.6);
        }
        const base = this.scale * this.scaleOfKind(e.kind[i]!);
        const sq = body?.squash ?? 1;
        slot.sprite.setScale(base * (sq < 1 ? 1 + (1 - sq) * 0.5 : 1), base * sq);
        slot.bodied = true;
      } else {
        slot.sprite.setPosition(x, y);
        if (slot.bodied) {
          slot.sprite.setScale(this.scale * this.scaleOfKind(e.kind[i]!));
          slot.bodied = false;
        }
      }
      slot.sprite.setAlpha(alphaOf(i));
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
