import type { PlayerId } from './commands';
import type { ItemKind, UpgradeOffer } from './world';

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

/** ダメージの数字の印（ビットで重ねる） */
export const DMG_SUPER = 1;
export const DMG_NOT_VERY = 2;
export const DMG_STAB = 4;
export const DMG_CRIT = 8;

/**
 * 自分の攻撃が敵に当たったときの、画面に出すダメージの数字（見た目だけ。world.damageNumbers が立っているときだけ出す。07 の102章）。
 * amount は敵の受けるダメージの倍率まで掛けた量。flags は DMG_SUPER など
 */
export interface DamageNumberEvent {
  readonly type: 'damageNumber';
  readonly enemyId: number;
  readonly x: number;
  readonly y: number;
  readonly amount: number;
  readonly flags: number;
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

/** 持ち物を持って技を覚えた（ワンリキーの ほのおのパンチ・かみなりパンチ） */
export interface MoveTaughtEvent {
  readonly type: 'moveTaught';
  readonly playerId: PlayerId;
  readonly move: number;
}

/** 歩きすぎて泣き出した（トゲピー。07 の66.4。見た目と音） */
export interface CriedEvent {
  readonly type: 'cried';
  readonly playerId: PlayerId;
}

/** ねむる（カビゴン）で眠った・起きた（効果音と見た目に使う） */
export interface RestChangedEvent {
  readonly type: 'restChanged';
  readonly playerId: PlayerId;
  readonly asleep: boolean;
}

/** 自分のプレイヤーが凍った（伝説戦のぜったいれいど。見た目と音） */
export interface PlayerFrozenEvent {
  readonly type: 'playerFrozen';
  readonly playerId: number;
}

/** マップの箱が出た（ソロ・ホスト。ゲストへ送る） */
export interface BoxSpawnedEvent {
  readonly type: 'boxSpawned';
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

/** マップの箱がなくなった（opened: 攻撃で開いた。false は遠くなって消えた） */
export interface BoxRemovedEvent {
  readonly type: 'boxRemoved';
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly opened: boolean;
}

/** ゲスト: 自分の攻撃が箱に当たった（ホストへ伝える。key は攻撃の区別） */
export interface BoxHitRequestedEvent {
  readonly type: 'boxHitRequested';
  readonly id: number;
  readonly key: number;
}

/** マップの箱に攻撃が当たった（見た目だけ。ソロ・ホスト） */
export interface BoxHitEvent {
  readonly type: 'boxHit';
  readonly id: number;
}

/** ポーズした・再開した（協力プレイではホストが全員へ送る） */
export interface PauseChangedEvent {
  readonly type: 'pauseChanged';
  readonly paused: boolean;
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
  /** 聞いてから進化した（イーブイ。演出は聞いたときに見せたので、もう出さない） */
  readonly asked?: boolean;
}

/** 時間帯のなつきの進化（イーブイ）で、進化してよいか本人に聞く（「おや……？」の演出。← → を交互に押すとキャンセル。07 の81章） */
export interface EvolveAskEvent {
  readonly type: 'evolveAsk';
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
  /** 予告に足す遅れ（更新回数）・範囲の半径の上書き・輪の内側の半径（無ければ 0） */
  readonly delay: number;
  readonly radius: number;
  readonly inner: number;
  /** 予告が追いかけるプレイヤー（-1 なら追わない） */
  readonly follow: number;
}

/** ボスの範囲技が落ちた（演出用） */
export interface HazardStruckEvent {
  readonly type: 'hazardStruck';
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly effect: string;
  readonly shape: 'circle' | 'line' | 'ring';
  /** 輪の内側の半径（輪でなければ 0） */
  readonly innerRadius: number;
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
  /** 第2段階に入った（もう一度「DANGER」を出す） */
  readonly enraged?: boolean;
}

/** 伝説が乱入してくる（三犬。「DANGER」の後に出る） */
export interface IntruderWarningEvent {
  readonly type: 'intruderWarning';
  readonly kind: number;
}

/** 乱入した伝説が、倒されずに逃げた */
export interface IntruderLeftEvent {
  readonly type: 'intruderLeft';
  readonly kind: number;
}

/** 技を使った（効果音のため） */
export interface MoveUsedEvent {
  readonly type: 'moveUsed';
  readonly playerId: PlayerId;
  readonly move: number;
}

/** 自分の体で攻撃する技を使った（見た目: 体を前後させる・残像） */
export interface BodyAttackEvent {
  readonly type: 'bodyAttack';
  readonly playerId: PlayerId;
  readonly dirX: number;
  readonly dirY: number;
  readonly distance: number;
  readonly afterimages: number;
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
  readonly kind: ItemKind;
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
  readonly kind: ItemKind;
  readonly levels: number;
}

/** プレイヤーが抜けた（切断） */
export interface PlayerLeftEvent {
  readonly type: 'playerLeft';
  readonly playerId: PlayerId;
}

/** ホスト: 伝説が追う相手を変えた（ゲストへ送る。07 の125章） */
export interface LegendTargetEvent {
  readonly type: 'legendTarget';
  readonly enemyId: number;
  readonly playerId: number;
}

/** ランが終わった */
export interface RunEndedEvent {
  readonly type: 'runEnded';
  readonly outcome: 'clear' | 'fail' | 'disconnected';
  /** 伝説戦があれば、その伝説（敵の種類の番号）と結果 */
  readonly legendary: { readonly kind: number; readonly result: 'won' | 'lost' | 'timeUp' | null } | null;
  /** 中ボスを制限時間で倒せずに失敗した: その中ボス（敵の種類の番号。07 の106章） */
  readonly gateTimeUp?: number;
}

export type SimEvent =
  | EnemyKilledEvent
  | ProjectileHitEvent
  | EnemySpawnedEvent
  | DamageDealtEvent
  | DamageNumberEvent
  | EnemyAffectedEvent
  | GemSpawnedEvent
  | GemMergedEvent
  | GemCollectedEvent
  | PickupRequestedEvent
  | LevelUpEvent
  | UpgradeChosenEvent
  | MoveTaughtEvent
  | RestChangedEvent
  | CriedEvent
  | EvolveAskEvent
  | BoxSpawnedEvent
  | PlayerFrozenEvent
  | BoxRemovedEvent
  | BoxHitEvent
  | BoxHitRequestedEvent
  | PauseChangedEvent
  | PlayerDamagedEvent
  | PlayerRevivedEvent
  | PlayerDownEvent
  | EvolvedEvent
  | EnemyRetiredEvent
  | BossAppearedEvent
  | HazardTelegraphedEvent
  | HazardStruckEvent
  | RunEndedEvent
  | LegendTargetEvent
  | PlayerLeftEvent
  | SwarmStartedEvent
  | SectionAdvancedEvent
  | BodyAttackEvent
  | MoveUsedEvent
  | ItemSpawnedEvent
  | ItemRequestedEvent
  | ItemCollectedEvent
  | LegendaryWarningEvent
  | IntruderWarningEvent
  | IntruderLeftEvent;
