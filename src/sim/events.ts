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
}

/** ホスト: 雑魚敵を出した（ゲストへ送る） */
export interface EnemySpawnedEvent {
  readonly type: 'enemySpawned';
  readonly id: number;
  readonly kind: number;
  readonly x: number;
  readonly y: number;
}

/** ホスト: 敵を強化した（ゲストへ送る） */
export interface EnemyEmpoweredEvent {
  readonly type: 'enemyEmpowered';
  readonly id: number;
  readonly level: number;
}

/** ゲスト: 自分の攻撃が敵に当たった（ホストへ送り、ホストが HP を集計する） */
export interface DamageDealtEvent {
  readonly type: 'damageDealt';
  readonly enemyId: number;
  readonly amount: number;
  readonly by: PlayerId;
}

export type SimEvent = EnemyKilledEvent | ProjectileHitEvent | EnemySpawnedEvent | EnemyEmpoweredEvent | DamageDealtEvent;
