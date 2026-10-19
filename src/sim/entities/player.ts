import type { Axis, PlayerId } from '../commands';

export interface Player {
  readonly id: PlayerId;
  x: number;
  y: number;
  /** 直前の更新時点の位置（描画の補間用） */
  prevX: number;
  prevY: number;
  /** 現在押されている移動方向 */
  inputX: Axis;
  inputY: Axis;
  /** 最後に動いた向き（スプライトの向きに使う） */
  facingX: Axis;
  facingY: Axis;
  radius: number;
  moveSpeed: number;
}

export function createPlayer(id: PlayerId, x: number, y: number, radius: number, moveSpeed: number): Player {
  return {
    id,
    x,
    y,
    prevX: x,
    prevY: y,
    inputX: 0,
    inputY: 0,
    facingX: 0,
    facingY: 1,
    radius,
    moveSpeed,
  };
}
