import type { AttackConfig, EnemiesConfig, SpawnConfig, StatusConfig } from '../data/schema';

/** シミュレーションが使う data/ の定義一式（型だけを参照し、読み込みは呼び出し側で行う） */
export interface SimRules {
  enemies: EnemiesConfig;
  spawn: SpawnConfig;
  attack: AttackConfig;
  status: StatusConfig;
}
