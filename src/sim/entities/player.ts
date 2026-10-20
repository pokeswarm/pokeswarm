import type { Axis, PlayerId } from '../commands';

export interface Player {
  readonly id: PlayerId;
  /** 別のブラウザが操作するプレイヤー（位置は通信で届いたものを使う） */
  readonly remote: boolean;
  x: number;
  y: number;
  /** 直前の更新時点の位置（描画の補間用） */
  prevX: number;
  prevY: number;
  /** 別のブラウザから届いた最新の位置（remote のときだけ使う） */
  netX: number;
  netY: number;
  /** 現在押されている移動方向 */
  inputX: Axis;
  inputY: Axis;
  /** 最後に動いた向き（スプライトの向きに使う） */
  facingX: Axis;
  facingY: Axis;
  radius: number;
  moveSpeed: number;
  /** 仮の自動攻撃の残り待ち時間（秒） */
  attackCooldown: number;
  /** 経験値の玉を吸い寄せ始める距離 */
  pickupRange: number;
}

export function createPlayer(
  id: PlayerId,
  x: number,
  y: number,
  radius: number,
  moveSpeed: number,
  remote = false,
  pickupRange = 0,
): Player {
  return {
    id,
    remote,
    x,
    y,
    prevX: x,
    prevY: y,
    netX: x,
    netY: y,
    inputX: 0,
    inputY: 0,
    facingX: 0,
    facingY: 1,
    radius,
    moveSpeed,
    attackCooldown: 0,
    pickupRange,
  };
}
