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

/** ホスト: 敵を出した（ゲストへ送る）。vx・vy はまっすぐ進む敵（スウォームの突進）の速度 */
export interface EnemySpawnedEvent {
  readonly type: 'enemySpawned';
  readonly id: number;
  readonly kind: number;
  readonly x: number;
  readonly y: number;
  readonly vx?: number;
  readonly vy?: number;
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
  /** stage.moves の番号 */
  readonly move: number;
  readonly x: number;
  readonly y: number;
  readonly dirX: number;
  readonly dirY: number;
  /** 突進する敵の id（無ければ -1） */
  readonly dasher: number;
}

/** ボスの範囲技が落ちた（演出用） */
export interface HazardStruckEvent {
  readonly type: 'hazardStruck';
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly effect: string;
  readonly shape: 'circle' | 'line';
  readonly dirX: number;
  readonly dirY: number;
  readonly length: number;
}

/** スウォームイベントが始まった（swarm は stage.swarms の番号） */
export interface SwarmStartedEvent {
  readonly type: 'swarmStarted';
  readonly swarm: number;
}

/** 四天王を全員倒し、伝説が乱入してくる（「DANGER」） */
export interface LegendaryWarningEvent {
  readonly type: 'legendaryWarning';
  readonly kind: number;
}

/** 次の区間へ進んだ（中ボスを倒した、または区間の時間がたった） */
export interface SectionAdvancedEvent {
  readonly type: 'sectionAdvanced';
  readonly section: number;
}

/** ホスト: 道具を落とした（ゲストへ送る） */
export interface ItemSpawnedEvent {
  readonly type: 'itemSpawned';
  readonly id: number;
  readonly kind: 'potion' | 'magnet' | 'rare-candy';
  readonly x: number;
  readonly y: number;
}

/** ゲスト: 道具に触れた（ホストへ送り、ホストが先着で確定する） */
export interface ItemRequestedEvent {
  readonly type: 'itemRequested';
  readonly id: number;
  readonly by: PlayerId;
}

/** 道具の取得が確定した（levels はふしぎなアメで上がるレベルの数） */
export interface ItemCollectedEvent {
  readonly type: 'itemCollected';
  readonly id: number;
  readonly by: PlayerId;
  readonly kind: 'potion' | 'magnet' | 'rare-candy';
  readonly levels: number;
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
  /** 伝説戦があれば、その伝説（敵の種類の番号）と結果 */
  readonly legendary: { readonly kind: number; readonly result: 'won' | 'lost' | 'timeUp' | null } | null;
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
  | PlayerLeftEvent
  | SwarmStartedEvent
  | SectionAdvancedEvent
  | ItemSpawnedEvent
  | ItemRequestedEvent
  | ItemCollectedEvent
  | LegendaryWarningEvent;
