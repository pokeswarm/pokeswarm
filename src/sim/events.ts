import type { PlayerId } from './commands';
import type { UpgradeOffer } from './world';

/** 1回の更新の中で起きた出来事。描画・通信・実績の判定が読む */
export interface EnemyKilledEvent {
  readonly type: 'enemyKilled';
  readonly enemyId: number;
  /** 敵の種類（SimRules.enemies.kinds の番号。記録に使う。倒れた敵はこの更新の最後に取り除かれるので一緒に持つ） */
  readonly kind: number;
  /** とどめを刺したプレイヤー */
  readonly by: PlayerId;
}

/** 発射体が敵に当たった（見た目の演出用） */
export interface ProjectileHitEvent {
  readonly type: 'projectileHit';
  readonly x: number;
  readonly y: number;
  readonly owner: PlayerId;
  /** 技の番号（命中の演出のレシピを引く） */
  readonly move: number;
}

/** ホスト: 雑魚敵を出した（ゲストへ送る） */
export interface EnemySpawnedEvent {
  readonly type: 'enemySpawned';
  readonly id: number;
  readonly kind: number;
  readonly x: number;
  readonly y: number;
}

/** 命中で付いた効果（ノックバック・状態異常）。status が -1 なら状態異常なし */
export interface HitEffect {
  readonly kbx: number;
  readonly kby: number;
  readonly kbTicks: number;
  readonly status: number;
  readonly statusTicks: number;
}

/** ゲスト: 自分の攻撃が敵に当たった（ホストへ送り、ホストが HP を集計する）。効果は自分の画面ではもう付けてある */
export interface DamageDealtEvent extends HitEffect {
  readonly type: 'damageDealt';
  readonly enemyId: number;
  readonly amount: number;
  readonly by: PlayerId;
}

/** ホスト: 敵に効果（ノックバック・状態異常）を付けた（ゲストへ送る。by のプレイヤーは自分で付け済み） */
export interface EnemyAffectedEvent extends HitEffect {
  readonly type: 'enemyAffected';
  readonly enemyId: number;
  readonly by: PlayerId;
}

/** ホスト: 前の時間帯の敵が離れすぎたので消した（撃破ではない。ゲストへ送る） */
export interface EnemyRetiredEvent {
  readonly type: 'enemyRetired';
  readonly id: number;
}

/** ホスト: 経験値の玉を作った（ゲストへ送る） */
export interface GemSpawnedEvent {
  readonly type: 'gemSpawned';
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly value: number;
}

/** ホスト: 玉が多すぎるので、新しい経験値を古い玉にまとめた（ゲストへ送る） */
export interface GemMergedEvent {
  readonly type: 'gemMerged';
  readonly id: number;
  readonly value: number;
}

/** ホスト: 玉の取得を確定した（ゲストへ送る。経験値は全員で共有） */
export interface GemCollectedEvent {
  readonly type: 'gemCollected';
  readonly id: number;
  readonly by: PlayerId;
  readonly value: number;
}

/** ゲスト: 自分が玉に触れた（ホストへ送り、ホストが先着で確定する） */
export interface PickupRequestedEvent {
  readonly type: 'pickupRequested';
  readonly id: number;
  readonly by: PlayerId;
}

/** レベルが上がった（全員で共有） */
export interface LevelUpEvent {
  readonly type: 'levelUp';
  readonly level: number;
}

/** レベルアップの候補を選んだ */
export interface UpgradeChosenEvent {
  readonly type: 'upgradeChosen';
  readonly playerId: PlayerId;
  readonly offer: UpgradeOffer;
}

/** プレイヤーがダメージを受けた（自分のブラウザで判定） */
export interface PlayerDamagedEvent {
  readonly type: 'playerDamaged';
  readonly playerId: PlayerId;
  readonly amount: number;
}

/** 復活した（ソロは自動、協力プレイは味方が触れて）。revives は残りの復活可能数 */
export interface PlayerRevivedEvent {
  readonly type: 'playerRevived';
  readonly playerId: PlayerId;
  readonly revives: number;
}

/** 倒れた（復活可能数が無い） */
export interface PlayerDownEvent {
  readonly type: 'playerDown';
  readonly playerId: PlayerId;
}

/** 進化した（from・to は SimRules.species の番号） */
export interface EvolvedEvent {
  readonly type: 'evolved';
  readonly playerId: PlayerId;
  readonly from: number;
  readonly to: number;
}

/** 中ボス・ボスが出た */
export interface BossAppearedEvent {
  readonly type: 'bossAppeared';
  readonly id: number;
  readonly kind: number;
}

/** ボスの範囲技の予告が始まった */
export interface HazardTelegraphedEvent {
  readonly type: 'hazardTelegraphed';
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** ボスの範囲技が落ちた（演出用） */
export interface HazardStruckEvent {
  readonly type: 'hazardStruck';
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly effect: string;
}

/** プレイヤーが抜けた（切断） */
export interface PlayerLeftEvent {
  readonly type: 'playerLeft';
  readonly playerId: PlayerId;
}

/** ランが終わった */
export interface RunEndedEvent {
  readonly type: 'runEnded';
  readonly outcome: 'clear' | 'fail' | 'disconnected';
}

export type SimEvent =
  | EnemyKilledEvent
  | ProjectileHitEvent
  | EnemySpawnedEvent
  | DamageDealtEvent
  | EnemyAffectedEvent
  | GemSpawnedEvent
  | GemMergedEvent
  | GemCollectedEvent
  | PickupRequestedEvent
  | LevelUpEvent
  | UpgradeChosenEvent
  | PlayerDamagedEvent
  | PlayerRevivedEvent
  | PlayerDownEvent
  | EvolvedEvent
  | EnemyRetiredEvent
  | BossAppearedEvent
  | HazardTelegraphedEvent
  | HazardStruckEvent
  | RunEndedEvent
  | PlayerLeftEvent;
