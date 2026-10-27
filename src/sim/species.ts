import type { StatsConfig } from '../data/schema';

/** ポケモンの種族値 */
export interface BaseStats {
  hp: number;
  attack: number;
  defense: number;
  specialAttack: number;
  specialDefense: number;
  speed: number;
}

/** シミュレーションが使うポケモンの種類 */
export interface SimSpecies {
  /** PokeAPI のポケモンの名前 */
  readonly key: string;
  /** タイプの番号 */
  readonly types: readonly number[];
  readonly baseStats: BaseStats;
  /** 次の進化。to は SimRules.species の番号、item は SimRules.items の番号 */
  readonly evolutions: readonly SimEvolution[];
}

export type SimEvolution =
  | { readonly to: number; readonly trigger: 'level'; readonly level: number }
  | { readonly to: number; readonly trigger: 'item'; readonly item: number }
  | { readonly to: number; readonly trigger: 'trade'; readonly item: number }
  /** なつき: ランで歩いた距離が SimRules.player の friendshipDistance を超えたら（07 の66.2） */
  | { readonly to: number; readonly trigger: 'friendship' };

/** 種族値のランクによる倍率（01_game_design.md 5.1） */
export function rankMultiplier(cfg: StatsConfig, baseStat: number): number {
  let rank = 0;
  while (rank < cfg.rankThresholds.length && baseStat >= cfg.rankThresholds[rank]!) rank++;
  return cfg.rankMultipliers[rank]!;
}

export interface DerivedStats {
  maxHp: number;
  /** 物理・特殊の技のダメージに掛ける倍率 */
  physicalPower: number;
  specialPower: number;
  defense: number;
  /** 移動速度に掛ける倍率 */
  speed: number;
}

/** 種族値・レベルから、持ち物・パッシブを掛ける前のステータスを作る */
export function deriveStats(cfg: StatsConfig, species: SimSpecies, level: number): DerivedStats {
  const b = species.baseStats;
  const growth = (pct: number): number => 1 + (pct * (level - 1)) / 100;
  return {
    maxHp: cfg.base.maxHp * rankMultiplier(cfg, b.hp) * growth(cfg.perLevelPct.maxHp),
    physicalPower: cfg.base.power * rankMultiplier(cfg, b.attack) * growth(cfg.perLevelPct.power),
    specialPower: cfg.base.power * rankMultiplier(cfg, b.specialAttack) * growth(cfg.perLevelPct.power),
    // 防御は ぼうぎょ と とくぼう の高い方（雑魚の攻撃は接触だけなので1つにする）
    defense: cfg.base.defense * rankMultiplier(cfg, Math.max(b.defense, b.specialDefense)) * growth(cfg.perLevelPct.defense),
    speed: rankMultiplier(cfg, b.speed),
  };
}
