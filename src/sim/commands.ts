import type { HitEffect } from './events';
import type { ItemKind, LegendaryResult, RunOutcome, UpgradeOffer } from './world';

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
  /** HP と倒れているか（各自が自分の分を管理して送る） */
  readonly hp?: number;
  readonly maxHp?: number;
  readonly down?: boolean;
}

/** ゲスト: ホストが決めた雑魚敵の出現 */
export interface SpawnEnemyCommand {
  readonly type: 'spawnEnemy';
  readonly id: number;
  readonly kind: number;
  readonly x: number;
  readonly y: number;
  /** まっすぐ進む敵（スウォームの突進）の速度 */
  readonly vx?: number;
  readonly vy?: number;
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

/** レベルアップの候補を選ぶ（index は候補の並び） */
export interface ChooseUpgradeCommand {
  readonly type: 'chooseUpgrade';
  readonly playerId: PlayerId;
  readonly index: number;
}

/** リロール権を使って候補を引き直す */
export interface RerollUpgradesCommand {
  readonly type: 'rerollUpgrades';
  readonly playerId: PlayerId;
}

/** 候補を除外する（BAN。index は候補の並び） */
export interface BanUpgradeCommand {
  readonly type: 'banUpgrade';
  readonly playerId: PlayerId;
  readonly index: number;
}

/** 見送る（リロール権 +1） */
export interface SkipUpgradeCommand {
  readonly type: 'skipUpgrade';
  readonly playerId: PlayerId;
}

/** レベルアップの選択の状態（ホストが作って全員へ送る。null なら選択中でない） */
export interface LevelUpSnapshot {
  readonly level: number;
  readonly ticksLeft: number;
  readonly offers: readonly (readonly [PlayerId, readonly UpgradeOffer[]])[];
  readonly done: readonly PlayerId[];
  /** プレイヤーごとのリロール権・除外の回数 */
  readonly rerolls: readonly (readonly [PlayerId, number])[];
  readonly bans: readonly (readonly [PlayerId, number])[];
}

/** ゲスト: ホストのレベルアップの選択の状態に合わせる */
export interface LevelUpStateCommand {
  readonly type: 'levelUpState';
  readonly state: LevelUpSnapshot | null;
  /** プレイヤーごとのリロール権（選択していないときも送る） */
  readonly rerolls?: readonly (readonly [PlayerId, number])[];
}

/** ゲスト: ホストが確定した、あるプレイヤーの選択（全員のブラウザで同じ強化を当てはめる） */
export interface ApplyUpgradeCommand {
  readonly type: 'applyUpgrade';
  readonly playerId: PlayerId;
  readonly offer: UpgradeOffer;
}

/** ゲスト: ホストが作ったボスの範囲技の予告 */
export interface AddHazardCommand {
  readonly type: 'addHazard';
  /** stage.moves の番号 */
  readonly move: number;
  readonly x: number;
  readonly y: number;
  readonly dirX: number;
  readonly dirY: number;
  readonly dasher: number;
}

/** ゲスト: 中ボス・ボスの HP（ホストが集計したもの） */
export interface BossHpCommand {
  readonly type: 'bossHp';
  readonly id: number;
  readonly hp: number;
  readonly maxHp: number;
  /** 位置（突進などで大きく動くので、補正より短い間隔で送る） */
  readonly x?: number;
  readonly y?: number;
}

/** ゲスト: 伝説の乱入（「DANGER」） */
export interface LegendaryWarningCommand {
  readonly type: 'legendaryWarning';
  readonly kind: number;
}

/** ゲスト: ホストが決めたランの終わり */
export interface EndRunCommand {
  readonly type: 'endRun';
  readonly outcome: RunOutcome;
  /** 伝説戦の結果（ゲスト） */
  readonly legendary?: { readonly kind: number; readonly result: LegendaryResult | null } | null;
}

/** ゲスト: ホストが味方を復活させた（revives は残りの復活可能数） */
export interface RevivePlayerCommand {
  readonly type: 'revivePlayer';
  readonly playerId: PlayerId;
  readonly revives: number;
}

/** ゲスト: ホストが落とした道具 */
export interface SpawnItemCommand {
  readonly type: 'spawnItem';
  readonly id: number;
  readonly kind: ItemKind;
  readonly x: number;
  readonly y: number;
}

/** ホスト: ゲストが道具に触れた */
export interface RequestItemCommand {
  readonly type: 'requestItem';
  readonly id: number;
  readonly by: PlayerId;
}

/** ゲスト: ホストが確定した道具の取得 */
export interface CollectItemCommand {
  readonly type: 'collectItem';
  readonly id: number;
  readonly by: PlayerId;
  readonly kind: ItemKind;
  readonly levels: number;
}

/** プレイヤーが抜けた（切断） */
export interface RemovePlayerCommand {
  readonly type: 'removePlayer';
  readonly playerId: PlayerId;
}

/** ゲスト: ホストによる敵の位置の補正。[id, x, y, id, x, y, ...] */
export interface CorrectEnemiesCommand {
  readonly type: 'correctEnemies';
  readonly data: readonly number[];
  /** ホストの更新回数（ゲストの経過時間をそろえる。タブが裏にあって遅れた場合など） */
  readonly tick?: number;
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
  | ChooseUpgradeCommand
  | RerollUpgradesCommand
  | SkipUpgradeCommand
  | BanUpgradeCommand
  | RetireEnemyCommand
  | CorrectEnemiesCommand
  | LevelUpStateCommand
  | ApplyUpgradeCommand
  | AddHazardCommand
  | BossHpCommand
  | EndRunCommand
  | RemovePlayerCommand
  | RevivePlayerCommand
  | LegendaryWarningCommand
  | SpawnItemCommand
  | RequestItemCommand
  | CollectItemCommand;
