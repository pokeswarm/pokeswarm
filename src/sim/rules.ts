import type { CombatConfig, EnemyKind, LegendField, NatureStat, PickupConfig, SpawnConfig, StageConfig, StatsConfig, StatusConfig, NetSmoothing } from '../data/schema';
import type { SimSpecies } from './species';
import type { ObstacleRules } from './obstacles';
import type { SimMoveDef, TypeChart } from './moves';
import type { Modifiers, SimDerivation, SimLeveling, SimUpgradeDef } from './upgrades';

/** シミュレーションが使う敵の種類（data/game/enemies.json に、PokeAPI のタイプを足したもの） */
export interface SimEnemyKind extends EnemyKind {
  /** タイプの番号（SimRules.types の並び） */
  readonly types: readonly number[];
}

/** 遊べるポケモンの系統ごとの決まり（playables.json。ベイビィポケモン: 07 の57章・66.4）。番号は SimRules の並び */
export interface SimLineRule {
  readonly fixedMoves: boolean;
  /** 決めたタイプ（プリン: ノーマルだけ）。無ければ姿のタイプ */
  readonly types: readonly number[] | null;
  readonly moveTypes: readonly number[];
  readonly startingMoves: readonly number[];
  readonly formMoves: readonly { readonly form: number; readonly move: number; readonly maxLevel?: number }[];
  /** この姿に進化したら、from の技（先にあるものを優先）を to に変える（イーブイ。07 の103章） */
  readonly formTransforms: readonly { readonly form: number; readonly from: readonly number[]; readonly to: number }[];
  readonly becomes: readonly { readonly form: number; readonly line: string }[];
  readonly fixedForms: readonly number[];
  /** 新しく覚えないタイプ（ズバット: どく） */
  readonly excludeMoveTypes: readonly number[];
  readonly hpCost: { readonly forms: readonly number[]; readonly move: number; readonly pct: number; readonly minHpPct: number } | null;
  readonly cry: { readonly forms: readonly number[]; readonly everyDistance: number; readonly seconds: number } | null;
}

/** 特性の効き方（abilities.json を番号に直したもの。07 の133章） */
export interface SimAbility {
  readonly key: string;
  readonly mods: Modifiers | null;
  readonly pinch: { readonly hpPct: number; readonly mods: Modifiers } | null;
  readonly contactStatus?: { readonly status: number; readonly chance: number; readonly seconds: number };
  readonly natureScale?: number;
  readonly natureNoDown?: boolean;
  readonly truant?: { readonly powerMultiplier: number };
  readonly sectionHealPct?: number;
  /** タイプの番号 → % */
  readonly typeDamageTakenPct?: Readonly<Record<number, number>>;
  readonly killStack?: { readonly perKillPct: number; readonly maxPct: number; readonly seconds: number };
  readonly weather?: { readonly kinds: readonly string[]; readonly moveSpeedPct: number; readonly regenPctPerSecond: number };
  readonly trace?: readonly string[];
  readonly enemySlow?: { readonly radius: number; readonly pct: number; readonly ranks: 'normal' | 'boss' };
  readonly sturdy?: boolean;
  readonly intimidateRadius?: number;
}

/** シミュレーションが使う data/ の定義一式（型だけを参照し、読み込みと組み立ては呼び出し側で行う） */
export interface SimRules {
  /** 地方（regions.json の id）。技の region と比べて、ほかの地方の技を候補に出さない（07 の130章）。省略はカントー */
  region?: string;
  enemies: { kinds: SimEnemyKind[] };
  spawn: SpawnConfig;
  status: StatusConfig;
  pickups: PickupConfig;
  combat: CombatConfig;
  /** 技の定義。番号は並び順 */
  moves: SimMoveDef[];
  types: TypeChart;
  leveling: SimLeveling;
  /** 持ち物・パッシブ。番号は並び順 */
  items: SimUpgradeDef[];
  /** 派生と固有技 */
  derivations: SimDerivation[];
  /** 持つと技を覚える持ち物（系統ごと。ワンリキーのほのおのパンチ・かみなりパンチ） */
  itemMoves?: { readonly line: string; readonly item: number; readonly move: number }[];
  /** ポケモンの種類（プレイヤーの種族値・進化）。番号は並び順 */
  species: SimSpecies[];
  stats: StatsConfig;
  /** ランの長さ・中ボス・ボス */
  stage: StageConfig;
  /** マップの障害物 */
  obstacles: ObstacleRules;
  /** 遊べるポケモンの系統ごとの決まり（キーは playables.json のキー） */
  lines?: Readonly<Record<string, SimLineRule>>;
  /** 区間ごとの夜（地方のステージ。ジョウト: 2・5・6b・7）。夜のある地方だけ、時間帯のなつきの進化（エーフィ・ブラッキー）をする */
  nightSections?: readonly boolean[];
  /**
   * 区間ごとの天気（ホウエン。07 の89.2）: kinds は weather.json のキー、fields はその中身。everySeconds が 0 でなければ、
   * 区間の頭から everySeconds ごとに次の天気へ巡らせる（区間7: ひざしがつよい ⇄ あめ）。天気の無い地方は無し
   */
  weatherSections?: readonly { readonly kinds: readonly string[]; readonly fields: readonly LegendField[]; readonly everySeconds: number }[];
  /**
   * 性格（ホウエン。07 の89.3）: あればランを始めるたびに一人ずつ抽選する（data/generated/natures.json の全部。並びはキーの順）。
   * 上がる能力 ×(1 + stats.naturePct%)、下がる能力 ×(1 − stats.naturePct%)。性格の無い地方は無し
   */
  natures?: readonly { readonly key: string; readonly up: NatureStat | null; readonly down: NatureStat | null }[];
  /**
   * 特性（ホウエン。07 の133章）: 系統（playables.json のキー）ごと。特性の無い地方は無し。
   * mods はいつも効く。pinch は HP が最大の hpPct % 以下の間だけ、技の威力に効く
   */
  abilities?: {
    /** 系統ごとの特性のキーと、姿（種類の番号）ごとの特性 */
    readonly lines: Readonly<Record<string, { readonly key: string; readonly forms: Readonly<Record<number, string>> }>>;
    readonly defs: Readonly<Record<string, SimAbility>>;
  };
  /** なつきの進化に要る、ランで歩いた距離（data/game/player.json） */
  friendshipDistance: number;
  /** 協力プレイで届いた位置をなめらかに見せる */
  netSmoothing: NetSmoothing;
}
