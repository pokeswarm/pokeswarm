import type { Axis, PlayerId } from '../commands';
import type { Modifiers } from '../upgrades';

/** 覚えている技1つ分の状態 */
export interface PlayerMove {
  /** 技の番号（SimRules.moves の並び） */
  move: number;
  level: number;
  /** 次に使えるまでの残り時間（秒） */
  cooldown: number;
  /** まとめて出す分の残り数と、次を出すまでの時間（秒） */
  burstLeft: number;
  burstTimer: number;
}

export interface Player {
  readonly id: PlayerId;
  /** 別のブラウザが操作するプレイヤー（位置は通信で届いたものを使う） */
  readonly remote: boolean;
  x: number;
  y: number;
  /** 直前の更新時点の位置（描画の補間用） */
  prevX: number;
  prevY: number;
  /** 別のブラウザから届いた最新の位置（remote のときだけ使う） */
  netX: number;
  netY: number;
  /** 現在押されている移動方向 */
  inputX: Axis;
  inputY: Axis;
  /** 最後に動いた向き（スプライトの向き・向いている方向への技に使う） */
  facingX: Axis;
  facingY: Axis;
  radius: number;
  moveSpeed: number;
  /** 経験値の玉を吸い寄せ始める距離 */
  pickupRange: number;
  /** タイプの番号（タイプ一致の判定に使う） */
  types: number[];
  /** 覚えている技（最大 combat.maxMoveSlots） */
  moves: PlayerMove[];
  /** 持っている持ち物（最大 leveling.maxItemSlots）とパッシブ。番号は SimRules.items / passives の並び */
  items: { item: number; level: number }[];
  passives: { passive: number; level: number }[];
  /** 系統（playables.json のキー。固有技の判定に使う） */
  line: string;
  /** 持ち物・パッシブの効果の合計（変わるたびに作り直す） */
  mods: Modifiers;
  /** 持ち物・パッシブを掛ける前の値 */
  baseMoveSpeed: number;
  basePickupRange: number;
  /** 残りの無敵時間（更新回数） */
  invincibleTicks: number;
  /** リロール権 */
  rerolls: number;
}

export interface PlayerInit {
  id: PlayerId;
  x: number;
  y: number;
  radius: number;
  moveSpeed: number;
  remote?: boolean;
  pickupRange?: number;
  types?: number[];
  moves?: { move: number; level: number }[];
  line?: string;
  rerolls?: number;
  /** 効果の合計の初期値（タイプの数に合わせた空のもの） */
  mods: Modifiers;
}

export function createPlayer(init: PlayerInit): Player {
  return {
    id: init.id,
    remote: init.remote ?? false,
    x: init.x,
    y: init.y,
    prevX: init.x,
    prevY: init.y,
    netX: init.x,
    netY: init.y,
    inputX: 0,
    inputY: 0,
    facingX: 0,
    facingY: 1,
    radius: init.radius,
    moveSpeed: init.moveSpeed,
    pickupRange: init.pickupRange ?? 0,
    types: init.types ?? [],
    moves: (init.moves ?? []).map((m) => ({ move: m.move, level: m.level, cooldown: 0, burstLeft: 0, burstTimer: 0 })),
    items: [],
    passives: [],
    line: init.line ?? '',
    mods: init.mods,
    baseMoveSpeed: init.moveSpeed,
    basePickupRange: init.pickupRange ?? 0,
    invincibleTicks: 0,
    rerolls: init.rerolls ?? 0,
  };
}
