import type { PlayerId } from './commands';

/** 1回の更新の中で起きた出来事。描画・通信・実績の判定が読む */
export interface EnemyKilledEvent {
  readonly type: 'enemyKilled';
  readonly enemyId: number;
  /** とどめを刺したプレイヤー */
  readonly by: PlayerId;
}

export type SimEvent = EnemyKilledEvent;
