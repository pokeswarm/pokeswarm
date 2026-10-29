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
  /** 向きをランダムに選ぶ技（にどげり・まわしげり）が、今回選んだ向き（ラジアン） */
  aimAngle?: number;
  /** ためている間に出す技（きあいパンチのマッハパンチ）の状態と、止めておく残りの秒数 */
  sub?: PlayerMove;
  subPause?: number;
  /** 一緒に出し続ける技（インファイト）の状態。レベルはこの技と同じ */
  combo?: PlayerMove[];
  /** なまけ: 次の1回は休む（技が出るのは2回に1回。07 の133章） */
  truantRest?: boolean;
  /** 溜める技の、出すまでの残りの秒数（溜めていなければ無し。07 の130章） */
  windup?: number;
  /** この技の最大レベル（技の定義より低くするとき。ばくれつパンチ: 消費したパンチの数で 8・16・24。07 の105章） */
  maxLevel?: number;
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
  /** ランで歩いた距離（ワールドの単位。なつきの進化。07 の66.2）。別のブラウザのプレイヤーは本人から届いた値 */
  walked: number;
  /** 時間帯のなつきの進化（イーブイ）で、本人に聞いている進化先の姿（07 の81章）と、キャンセルした区間（その区間の間は聞かない） */
  evolveAsk?: number;
  evolveDeclinedSection?: number;
  /** あまごい: この更新の回数まで、そのタイプの技の威力を上げる */
  rain?: { type: number; pct: number; untilTick: number };
  /** 泣くまでの歩いた距離（トゲピー）と、泣いて止まっている残り（更新回数） */
  cryWalked?: number;
  cryTicks?: number;
  /** 凍っている残り（更新回数。伝説戦のぜったいれいど）と、次に凍るまでの間 */
  frozenTicks?: number;
  freezeCooldown?: number;
  /** 伝説戦のマップの効果（ふぶき・ほのおのうず）で削られるまでの数え */
  fieldHurtTicks?: number;
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
  /** 自分のタイプのほかに、候補に出る技のタイプ（コダック: エスパー） */
  moveTypes: readonly number[];
  /** 新しい技を覚えない（プリン: 最初の2つだけ）。ベイビィポケモンは進化で変わる */
  fixedMoves: boolean;
  /** どの技も覚えられる（ミュウ。技の learners に関係なく候補に出る） */
  readonly learnsAll: boolean;
  /** ドわすれ: この更新の回数まで、受けるダメージを guardPct % 減らす */
  guardUntilTick?: number;
  guardPct?: number;
  readonly banned: Set<string>;
  /** ねむる（カビゴン）: 歩いていない更新の回数・眠っているか・起きる動きの残りの更新回数 */
  sleep?: { stillTicks: number; asleep: boolean; wakeTicks: number };
  /** 性格（SimRules.natures の番号。性格の無い地方は無し。07 の89.3） */
  nature?: number;
  /** 特性（本人のブラウザ）: がんじょうを使った区間・しぜんかいふくで見た区間・じしんかじょうの重ね（07 の133章） */
  sturdySection?: number;
  abilitySection?: number;
  killStack?: { pct: number; untilTick: number };
  /** ランの記録（本人から届いた値。固有技の条件。runStats.ts） */
  runStats?: Record<string, number>;
  /** 本人のブラウザで数えている記録（自分のプレイヤーだけ） */
  localStats?: Record<string, number>;
  /** 進化で消費された技（持ち物で覚え直さない） */
  consumedMoves?: number[];
  /** 箱から拾った一時的な強化（index は pickups.json の items.buff.buffs の番号） */
  buffs?: { index: number; ticksLeft: number; totalTicks: number }[];
  /** 技で付いた一時的な強化（move は技の番号。フレアドライブ。07 の115章） */
  moveBuffs?: { move: number; ticksLeft: number }[];
  /** 順番に出す技（group）ごとの、次に出せるまでの秒数と、次に出す番 */
  groupTimers?: Record<string, number>;
  groupCursor?: Record<string, number>;
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
  moveTypes?: number[];
  fixedMoves?: boolean;
  learnsAll?: boolean;
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
    walked: 0,
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
    moveTypes: init.moveTypes ?? [],
    fixedMoves: init.fixedMoves ?? false,
    learnsAll: init.learnsAll ?? false,
    banned: new Set(),
  };
}
