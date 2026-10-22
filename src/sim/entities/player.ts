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
  /** spin（回転）: 使った回数（扇形を出す向きを、回数ごとに時計回りへずらす） */
  spinStep?: number;
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
  /** 最新の位置が届いてからの更新回数（その間は押している方向へ進んだと予測する） */
  netAge: number;
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
  /** 持っている持ち物（最大 leveling.maxItemSlots）。番号は SimRules.items の並び */
  items: { item: number; level: number }[];
  /** 系統（playables.json のキー。固有技の判定に使う） */
  line: string;
  /** 持ち物・パッシブの効果の合計（変わるたびに作り直す） */
  mods: Modifiers;
  /** 持ち物・パッシブを掛ける前の値 */
  baseMoveSpeed: number;
  basePickupRange: number;
  /** 残りの無敵時間（更新回数） */
  invincibleTicks: number;
  /** 範囲技が残した床で遅くなっている割合（%。毎回の更新で決め直す） */
  zoneSlowPct?: number;
  /** 燃える床のダメージまでの残り（更新回数） */
  zoneHurtTicks?: number;
  /** ポケモンの種類（SimRules.species の番号）。進化で変わる */
  species: number;
  hp: number;
  maxHp: number;
  /** 物理・特殊の技のダメージに掛ける倍率（種族値のランクとレベル） */
  physicalPower: number;
  specialPower: number;
  /** 防御（受けるダメージ = ダメージ × 100 / (100 + 防御)） */
  defense: number;
  /** 倒れていて、復活を待っている（ソロでは復活可能数が無ければランの失敗） */
  down: boolean;
  /** リロール権 */
  rerolls: number;
  /** フレンドリィショップの永続強化の効果（ランの間は変わらない。持ち物・パッシブと一緒に足す） */
  readonly permanent: Modifiers | null;
  /** 候補の除外（BAN）の残り回数と、除外したもの（"move:番号" など。そのランでは二度と候補に出ない） */
  bans: number;
  /** 候補に出る持ち物（SimRules.items の番号）。null ならすべて（実績の報酬。07 24章） */
  readonly unlockedItems: ReadonlySet<number> | null;
  /** 持ち物の枠の追加（実績の報酬） */
  readonly extraItemSlots: number;
  /** レベルアップの「コイン」で、このランの間にもらったコイン（ラン終了時に足す） */
  bonusCoins?: number;
  /** ふしぎなアメの +3・+5 の重みに足す（実績の報酬） */
  readonly candyWeight: number;
  readonly banned: Set<string>;
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
  /** ポケモンの種類（SimRules.species の番号。省略時は 0） */
  species?: number;
  /** 効果の合計の初期値（タイプの数に合わせた空のもの） */
  mods: Modifiers;
  /** 永続強化の効果（無ければ null） */
  permanent?: Modifiers | null;
  /** 候補の除外の回数 */
  bans?: number;
  unlockedItems?: ReadonlySet<number> | null;
  extraItemSlots?: number;
  candyWeight?: number;
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
    netAge: 0,
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
    line: init.line ?? '',
    mods: init.mods,
    baseMoveSpeed: init.moveSpeed,
    basePickupRange: init.pickupRange ?? 0,
    invincibleTicks: 0,
    rerolls: init.rerolls ?? 0,
    species: init.species ?? 0,
    hp: 1,
    maxHp: 1,
    physicalPower: 1,
    specialPower: 1,
    defense: 0,
    down: false,
    permanent: init.permanent ?? null,
    bans: init.bans ?? 0,
    unlockedItems: init.unlockedItems ?? null,
    extraItemSlots: init.extraItemSlots ?? 0,
    candyWeight: init.candyWeight ?? 0,
    banned: new Set(),
  };
}
