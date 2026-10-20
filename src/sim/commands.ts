/**
 * 入力コマンド。シミュレーションはこれだけを受け取って進む。
 * ソロでも協力プレイでも同じ形で扱う。協力プレイでは、通信で届いた内容もコマンドに直して渡す。
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

/** 別のブラウザのプレイヤーの状態（本人から届いた位置・向き・入力） */
export interface RemotePlayerCommand {
  readonly type: 'remotePlayer';
  readonly playerId: PlayerId;
  readonly x: number;
  readonly y: number;
  readonly facingX: Axis;
  readonly facingY: Axis;
  readonly inputX: Axis;
  readonly inputY: Axis;
}

/** ゲスト: ホストが決めた雑魚敵の出現 */
export interface SpawnEnemyCommand {
  readonly type: 'spawnEnemy';
  readonly id: number;
  readonly kind: number;
  readonly x: number;
  readonly y: number;
}

/** ゲスト: ホストが決めた敵の強化（上限到達時） */
export interface EmpowerEnemyCommand {
  readonly type: 'empowerEnemy';
  readonly id: number;
  readonly level: number;
}

/** ホスト: ゲストの攻撃が当たった（ゲストのブラウザで判定したもの） */
export interface DamageEnemyCommand {
  readonly type: 'damageEnemy';
  readonly id: number;
  readonly amount: number;
  readonly by: PlayerId;
}

/** ゲスト: ホストが確定した撃破 */
export interface KillEnemyCommand {
  readonly type: 'killEnemy';
  readonly id: number;
  readonly by: PlayerId;
}

/** ゲスト: ホストによる敵の位置の補正。[id, x, y, id, x, y, ...] */
export interface CorrectEnemiesCommand {
  readonly type: 'correctEnemies';
  readonly data: readonly number[];
}

export type InputCommand =
  | MoveCommand
  | RemotePlayerCommand
  | SpawnEnemyCommand
  | EmpowerEnemyCommand
  | DamageEnemyCommand
  | KillEnemyCommand
  | CorrectEnemiesCommand;
