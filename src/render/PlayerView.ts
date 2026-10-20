import Phaser from 'phaser';
import type { PlaceholderRenderConfig, SpriteAnims, SpriteRenderConfig } from '../data/schema';
import type { Player } from '../sim/entities/player';
import { hexColor } from './color';
import { directionIndex, PokemonSpriteView } from './sprites/PokemonSprite';

/**
 * プレイヤーの表示。位置は前回と今回の更新の間を補間する。
 * スプライトがあればポケモンのドット絵、無ければ仮の円と向きの印で描く。
 */
export class PlayerView {
  readonly container: Phaser.GameObjects.Container;
  private readonly facing: Phaser.GameObjects.Arc | null = null;
  private readonly pokemon: PokemonSpriteView | null = null;
  private readonly radius: number;

  constructor(
    scene: Phaser.Scene,
    player: Player,
    style: PlaceholderRenderConfig,
    private readonly spriteStyle: SpriteRenderConfig,
    manifest: SpriteAnims | null,
  ) {
    this.radius = player.radius;
    if (manifest) {
      this.pokemon = new PokemonSpriteView(scene, manifest, spriteStyle.playerScale);
      this.container = scene.add.container(player.x, player.y, [this.pokemon.sprite]);
    } else {
      const body = scene.add.circle(0, 0, player.radius, hexColor(style.playerColor));
      this.facing = scene.add.circle(0, 0, Math.max(2, player.radius / 4), hexColor(style.playerFacingColor));
      this.container = scene.add.container(player.x, player.y, [body, this.facing]);
    }
  }

  update(player: Player, alpha: number): void {
    this.container.setPosition(
      player.prevX + (player.x - player.prevX) * alpha,
      player.prevY + (player.y - player.prevY) * alpha,
    );
    if (this.pokemon) {
      const moving = player.inputX !== 0 || player.inputY !== 0;
      const anim = moving ? this.spriteStyle.walkAnimation : this.spriteStyle.idleAnimation;
      this.pokemon.play(anim, directionIndex(player.facingX, player.facingY));
    }
    if (this.facing) {
      const len = Math.hypot(player.facingX, player.facingY) || 1;
      const offset = this.radius * 0.6;
      this.facing.setPosition((player.facingX / len) * offset, (player.facingY / len) * offset);
    }
  }
}
