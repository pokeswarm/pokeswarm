import type { CombatConfig, EnemyKind, PickupConfig, SpawnConfig, StageConfig, StatsConfig, StatusConfig, NetSmoothing } from '../data/schema';
import type { SimSpecies } from './species';
import type { ObstacleRules } from './obstacles';
import type { SimMoveDef, TypeChart } from './moves';
import type { SimDerivation, SimLeveling, SimUpgradeDef } from './upgrades';

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
  readonly formMoves: readonly { readonly form: number; readonly move: number }[];
  readonly becomes: readonly { readonly form: number; readonly line: string }[];
  readonly fixedForms: readonly number[];
  readonly hpCost: { readonly forms: readonly number[]; readonly move: number; readonly pct: number; readonly minHpPct: number } | null;
  readonly cry: { readonly forms: readonly number[]; readonly everyDistance: number; readonly seconds: number } | null;
}

/** シミュレーションが使う data/ の定義一式（型だけを参照し、読み込みと組み立ては呼び出し側で行う） */
export interface SimRules {
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
  /** なつきの進化に要る、ランで歩いた距離（data/game/player.json） */
  friendshipDistance: number;
  /** 協力プレイで届いた位置をなめらかに見せる */
  netSmoothing: NetSmoothing;
}
