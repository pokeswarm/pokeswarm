import Phaser from 'phaser';
import type { PlaceholderRenderConfig } from '../data/schema';
import type { Player } from '../sim/entities/player';
import { hexColor } from './color';

/** プレイヤーの仮表示（円と向きの印）。位置は前回と今回の更新の間を補間する */
export class PlayerView {
  readonly container: Phaser.GameObjects.Container;
  private readonly facing: Phaser.GameObjects.Arc;
  private readonly radius: number;

  constructor(scene: Phaser.Scene, player: Player, style: PlaceholderRenderConfig) {
    this.radius = player.radius;
    const body = scene.add.circle(0, 0, player.radius, hexColor(style.playerColor));
    this.facing = scene.add.circle(0, 0, Math.max(2, player.radius / 4), hexColor(style.playerFacingColor));
    this.container = scene.add.container(player.x, player.y, [body, this.facing]);
  }

  update(player: Player, alpha: number): void {
    this.container.setPosition(
      player.prevX + (player.x - player.prevX) * alpha,
      player.prevY + (player.y - player.prevY) * alpha,
    );
    const len = Math.hypot(player.facingX, player.facingY) || 1;
    const offset = this.radius * 0.6;
    this.facing.setPosition((player.facingX / len) * offset, (player.facingY / len) * offset);
  }
}
