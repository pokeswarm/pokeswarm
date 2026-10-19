/**
 * 入力コマンド。シミュレーションはこれだけを受け取って進む。
 * ソロでも協力プレイでも同じ形で扱う（協力プレイではこれがそのまま通信に乗る）。
 */
export type PlayerId = number;

/** 移動方向の各軸。キー入力をそのまま表す整数にして、浮動小数の誤差を持ち込まない */
export type Axis = -1 | 0 | 1;

/** 押している移動キーの状態を設定する。次に変わるまで有効 */
export interface MoveCommand {
  readonly type: 'move';
  readonly playerId: PlayerId;
  readonly dx: Axis;
  readonly dy: Axis;
}

export type InputCommand = MoveCommand;
