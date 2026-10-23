import Phaser from 'phaser';
import type { PlaceholderRenderConfig, SpriteAnims, SpriteRenderConfig } from '../data/schema';
import type { Player } from '../sim/entities/player';
import { hexColor } from './color';
import { directionIndex, PokemonSpriteView } from './sprites/PokemonSprite';

const HP_BAR_WIDTH = 36;
const HP_BAR_HEIGHT = 4;
/** 体を前後させる動きの長さ（ミリ秒） */
const LUNGE_MS = 140;

/**
 * プレイヤーの表示。位置は前回と今回の更新の間を補間する。
 * スプライトがあればポケモンのドット絵、無ければ仮の円と向きの印で描く。
 * 足元に HP のバーを出し、無敵時間の間は点滅させる。
 */
export class PlayerView {
  readonly container: Phaser.GameObjects.Container;
  private readonly facing: Phaser.GameObjects.Arc | null = null;
  private pokemon: PokemonSpriteView | null = null;
  private readonly radius: number;
  private readonly hpBar: Phaser.GameObjects.Graphics;
  /** ためる光（ギガインパクトを出す前に体を光らせる） */
  private readonly charge: Phaser.GameObjects.Graphics;
  /** ためる光で、体の形をその色で光らせる重ね絵（スプライトがあるときだけ。使うときに作る） */
  private chargeBody: Phaser.GameObjects.Image | null = null;
  /** 自分の体で攻撃する技の、体を前後させる動き（始まった時刻・向き・距離） */
  private lungeStart = -1;
  private lungeX = 0;
  private lungeY = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    player: Player,
    style: PlaceholderRenderConfig,
    private readonly spriteStyle: SpriteRenderConfig,
    manifest: SpriteAnims | null,
    /** HP のバーを出すか（自分の HP は自分のブラウザでしか分からないので、相手のプレイヤーには出さない） */
    private readonly showHp: boolean,
  ) {
    this.radius = player.radius;
    this.hpBar = scene.add.graphics();
    this.charge = scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
    if (manifest) {
      this.pokemon = new PokemonSpriteView(scene, manifest, spriteStyle.playerScale);
      this.container = scene.add.container(player.x, player.y, [this.charge, this.pokemon.sprite, this.hpBar]);
    } else {
      const body = scene.add.circle(0, 0, player.radius, hexColor(style.playerColor));
      this.facing = scene.add.circle(0, 0, Math.max(2, player.radius / 4), hexColor(style.playerFacingColor));
      this.container = scene.add.container(player.x, player.y, [this.charge, body, this.facing, this.hpBar]);
    }
  }

  /** 進化などで見た目を差し替える */
  setSprite(manifest: SpriteAnims): void {
    this.pokemon?.sprite.destroy();
    this.pokemon = new PokemonSpriteView(this.scene, manifest, this.spriteStyle.playerScale);
    this.container.addAt(this.pokemon.sprite, 0);
  }

  /**
   * 自分の体で攻撃する技を使った: 向いている方向へ一瞬体を出して戻す。afterimages があれば前方に残像を残す
   * （でんこうせっか）。見た目だけで、位置（当たり判定）は動かさない
   */
  lunge(dirX: number, dirY: number, distance: number, afterimages: number): void {
    this.lungeStart = this.scene.time.now;
    this.lungeX = dirX * distance;
    this.lungeY = dirY * distance;
    const sprite = this.pokemon?.sprite;
    if (!sprite || afterimages <= 0) return;
    for (let k = 1; k <= afterimages; k++) {
      const t = k / afterimages;
      const ghost = this.scene.add
        .image(this.container.x + this.lungeX * 1.6 * t, this.container.y + this.lungeY * 1.6 * t, sprite.texture.key, sprite.frame.name)
        .setScale(sprite.scaleX, sprite.scaleY)
        .setFlipX(sprite.flipX)
        .setTint(0xfff8e1)
        .setAlpha(0.55 * (1 - t * 0.5))
        .setDepth(this.container.depth - 0.01);
      this.scene.tweens.add({ targets: ghost, alpha: 0, duration: 260, delay: k * 25, onComplete: () => ghost.destroy() });
    }
  }

  /**
   * ためる光: t（0〜1。1 で出す直前）に合わせて、体の後ろの光を濃く大きくし、細かく明滅させる。null なら消す
   */
  setCharge(glow: { color: number; radius: number; alpha: number; t: number } | null): void {
    const g = this.charge;
    g.clear();
    const sprite = this.pokemon?.sprite;
    if (!glow || !sprite) {
      this.chargeBody?.setVisible(false);
      if (!glow) return;
    }
    const flicker = 0.85 + 0.15 * Math.sin(this.scene.time.now / 30);
    if (sprite) {
      if (!this.chargeBody) {
        this.chargeBody = this.scene.add.image(0, 0, sprite.texture.key, sprite.frame.name).setTintMode(Phaser.TintModes.FILL).setBlendMode(Phaser.BlendModes.ADD);
        this.container.addAt(this.chargeBody, this.container.getIndex(sprite) + 1);
      }
      this.chargeBody
        .setTexture(sprite.texture.key, sprite.frame.name)
        .setPosition(sprite.x, sprite.y)
        .setScale(sprite.scaleX, sprite.scaleY)
        .setFlipX(sprite.flipX)
        .setOrigin(sprite.originX, sprite.originY)
        .setTint(glow.color)
        .setAlpha(0.9 * glow.t * flicker)
        .setVisible(true);
    }
    for (let k = 3; k >= 1; k--) {
      g.fillStyle(glow.color, glow.alpha * glow.t * flicker * (k === 1 ? 1 : 0.45 / k));
      g.fillCircle(0, 0, glow.radius * (0.5 + 0.5 * glow.t) * (k / 2));
    }
  }

  /** 残像に使う、今のドット絵の絵（スプライトが無ければ null） */
  ghostFrame(): { key: string; frame: string | number; scaleX: number; scaleY: number; flipX: boolean } | null {
    const s = this.pokemon?.sprite;
    return s ? { key: s.texture.key, frame: s.frame.name, scaleX: s.scaleX, scaleY: s.scaleY, flipX: s.flipX } : null;
  }

  /** reviveRatio: 倒れているとき、味方が触れて復活するまでの進み具合（0〜1。触れていなければ 0） */
  update(player: Player, alpha: number, reviveRatio = 0): void {
    this.container.setPosition(
      player.prevX + (player.x - player.prevX) * alpha,
      player.prevY + (player.y - player.prevY) * alpha,
    );
    if (this.pokemon) {
      // 体を前後させる（行って戻る。LUNGE_MS で1往復）
      const t = this.lungeStart < 0 ? 1 : (this.scene.time.now - this.lungeStart) / LUNGE_MS;
      const k = t >= 1 ? 0 : Math.sin(Math.PI * t);
      this.pokemon.sprite.setPosition(this.lungeX * k, this.lungeY * k);
    }
    if (this.pokemon) {
      const moving = player.inputX !== 0 || player.inputY !== 0;
      const anim = moving ? this.spriteStyle.walkAnimation : this.spriteStyle.idleAnimation;
      this.pokemon.play(anim, directionIndex(player.facingX, player.facingY));
      // 倒れていたら暗く、無敵時間の間は点滅
      this.pokemon.sprite.setAlpha(player.down ? 0.35 : player.invincibleTicks > 0 && Math.floor(player.invincibleTicks / 3) % 2 === 0 ? 0.4 : 1);
    }
    if (this.facing) {
      const len = Math.hypot(player.facingX, player.facingY) || 1;
      const offset = this.radius * 0.6;
      this.facing.setPosition((player.facingX / len) * offset, (player.facingY / len) * offset);
    }
    this.hpBar.clear();
    if (this.showHp && player.maxHp > 0) {
      const ratio = Math.max(0, player.hp / player.maxHp);
      const y = this.radius + 10;
      this.hpBar.fillStyle(0x000000, 0.6).fillRect(-HP_BAR_WIDTH / 2 - 1, y - 1, HP_BAR_WIDTH + 2, HP_BAR_HEIGHT + 2);
      this.hpBar.fillStyle(ratio > 0.5 ? 0x66bb6a : ratio > 0.2 ? 0xffca28 : 0xef5350).fillRect(-HP_BAR_WIDTH / 2, y, HP_BAR_WIDTH * ratio, HP_BAR_HEIGHT);
    }
    // 倒れている味方の周りに、復活までの進み具合を円で出す
    if (player.down) {
      const r = this.radius + 14;
      this.hpBar.lineStyle(3, 0x000000, 0.5).strokeCircle(0, 0, r);
      if (reviveRatio > 0) {
        this.hpBar.lineStyle(3, 0x81c784, 1).beginPath();
        this.hpBar.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * reviveRatio, false).strokePath();
      }
    }
  }
}
