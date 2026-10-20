import type { HitEffect } from './events';

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

/** ホスト: ゲストの攻撃が当たった（ゲストのブラウザで判定したもの。効果も一緒に届く） */
export interface DamageEnemyCommand extends HitEffect {
  readonly type: 'damageEnemy';
  readonly id: number;
  readonly amount: number;
  readonly by: PlayerId;
}

/** ゲスト: ホストが付けた効果（ノックバック・状態異常） */
export interface AffectEnemyCommand extends HitEffect {
  readonly type: 'affectEnemy';
  readonly id: number;
  readonly by: PlayerId;
}

/** ゲスト: ホストが確定した撃破 */
export interface KillEnemyCommand {
  readonly type: 'killEnemy';
  readonly id: number;
  readonly by: PlayerId;
}

/** ゲスト: ホストが前の時間帯の敵を消した（撃破ではない） */
export interface RetireEnemyCommand {
  readonly type: 'retireEnemy';
  readonly id: number;
}

/** ゲスト: ホストが作った経験値の玉 */
export interface SpawnGemCommand {
  readonly type: 'spawnGem';
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly value: number;
}

/** ゲスト: ホストが玉にまとめた（value はまとめた後の値） */
export interface MergeGemCommand {
  readonly type: 'mergeGem';
  readonly id: number;
  readonly value: number;
}

/** ホスト: ゲストが玉に触れた */
export interface RequestPickupCommand {
  readonly type: 'requestPickup';
  readonly id: number;
  readonly by: PlayerId;
}

/** ゲスト: ホストが玉の取得を確定した */
export interface CollectGemCommand {
  readonly type: 'collectGem';
  readonly id: number;
  readonly by: PlayerId;
  readonly value: number;
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
  | DamageEnemyCommand
  | KillEnemyCommand
  | AffectEnemyCommand
  | SpawnGemCommand
  | MergeGemCommand
  | RequestPickupCommand
  | CollectGemCommand
  | RetireEnemyCommand
  | CorrectEnemiesCommand;
