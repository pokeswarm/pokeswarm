import Phaser from 'phaser';
import type { PlaceholderRenderConfig, SpriteAnims, SpriteRenderConfig } from '../data/schema';
import type { Player } from '../sim/entities/player';
import { hexColor } from './color';
import { directionIndex, PokemonSpriteView } from './sprites/PokemonSprite';

const HP_BAR_WIDTH = 36;
const HP_BAR_HEIGHT = 4;

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
    if (manifest) {
      this.pokemon = new PokemonSpriteView(scene, manifest, spriteStyle.playerScale);
      this.container = scene.add.container(player.x, player.y, [this.pokemon.sprite, this.hpBar]);
    } else {
      const body = scene.add.circle(0, 0, player.radius, hexColor(style.playerColor));
      this.facing = scene.add.circle(0, 0, Math.max(2, player.radius / 4), hexColor(style.playerFacingColor));
      this.container = scene.add.container(player.x, player.y, [body, this.facing, this.hpBar]);
    }
  }

  /** 進化などで見た目を差し替える */
  setSprite(manifest: SpriteAnims): void {
    this.pokemon?.sprite.destroy();
    this.pokemon = new PokemonSpriteView(this.scene, manifest, this.spriteStyle.playerScale);
    this.container.addAt(this.pokemon.sprite, 0);
  }

  /** reviveRatio: 倒れているとき、味方が触れて復活するまでの進み具合（0〜1。触れていなければ 0） */
  update(player: Player, alpha: number, reviveRatio = 0): void {
    this.container.setPosition(
      player.prevX + (player.x - player.prevX) * alpha,
      player.prevY + (player.y - player.prevY) * alpha,
    );
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
