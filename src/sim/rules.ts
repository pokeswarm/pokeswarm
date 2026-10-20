import type { CombatConfig, EnemyKind, PickupConfig, SpawnConfig, StatusConfig } from '../data/schema';
import type { SimMoveDef, TypeChart } from './moves';

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
}
