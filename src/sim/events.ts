import type { PlayerId } from './commands';

/** 1回の更新の中で起きた出来事。描画・通信・実績の判定が読む */
export interface EnemyKilledEvent {
  readonly type: 'enemyKilled';
  readonly enemyId: number;
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
  | EnemyRetiredEvent;
