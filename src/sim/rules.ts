import type { CombatConfig, EnemyKind, PickupConfig, SpawnConfig, StageConfig, StatsConfig, StatusConfig } from '../data/schema';
import type { SimSpecies } from './species';
import type { ObstacleRules } from './obstacles';
import type { SimMoveDef, TypeChart } from './moves';
import type { SimDerivation, SimLeveling, SimUpgradeDef } from './upgrades';

/** シミュレーションが使う敵の種類（data/game/enemies.json に、PokeAPI のタイプを足したもの） */
export interface SimEnemyKind extends EnemyKind {
  /** タイプの番号（SimRules.types の並び） */
  readonly types: readonly number[];
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
  passives: SimUpgradeDef[];
  /** 派生と固有技 */
  derivations: SimDerivation[];
  /** ポケモンの種類（プレイヤーの種族値・進化）。番号は並び順 */
  species: SimSpecies[];
  stats: StatsConfig;
  /** ランの長さ・中ボス・ボス */
  stage: StageConfig;
  /** マップの障害物 */
  obstacles: ObstacleRules;
}
