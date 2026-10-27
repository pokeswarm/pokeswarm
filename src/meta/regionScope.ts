import type { SaveData } from './saveData';

/**
 * 地方ごとの記録・永続強化（02 の17章。ジョウトの J3）。
 * カントーは今までどおりの記録の名前とセーブの upgrades。ほかの地方は記録の名前の頭に "<地方>:" を付け、強化は regionUpgrades.<地方>。
 */
export const HOME_REGION = 'kanto';

/** 地方に関わらず1つの記録（コインは全地方で共通なので、コインの合計も1つ） */
const GLOBAL_STATS = ['coinsEarned'] as const;

/** その地方のランの記録の名前の頭（カントーは無し） */
export function statPrefix(region: string): string {
  return region === HOME_REGION ? '' : `${region}:`;
}

/** その地方の記録の名前 */
export function regionStatKey(region: string, key: string): string {
  return (GLOBAL_STATS as readonly string[]).includes(key) ? key : statPrefix(region) + key;
}

/**
 * その地方のランの記録だけの表（頭の "<地方>:" を外す）。実績の条件をどの地方でも同じ名前で書けるようにする。
 * カントーは記録をそのまま返す（ほかの地方の記録は名前が違うので条件に当たらない）
 */
export function regionStats(stats: Readonly<Record<string, number>>, region: string): Readonly<Record<string, number>> {
  if (region === HOME_REGION) return stats;
  const prefix = statPrefix(region);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(stats)) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  for (const k of GLOBAL_STATS) if (stats[k] !== undefined) out[k] = stats[k];
  return out;
}

/**
 * その地方の解放の名前（セーブの unlocked に入れる名前。07 の66.1: 解放は地方ごと）。カントーはそのまま、ほかの地方は頭に "<地方>:"。
 * カントーで解放したイワークは、ジョウトでは改めて解放する
 */
export function regionUnlockKey(region: string, name: string): string {
  return statPrefix(region) + name;
}

/** その地方の永続強化のレベル（強化の id → レベル） */
export function regionUpgradesOf(save: Readonly<SaveData>, region: string): Readonly<Record<string, number>> {
  return region === HOME_REGION ? save.upgrades : (save.regionUpgrades[region] ?? {});
}

/** その地方の永続強化のレベルを書き換えられる表（無ければ作る） */
export function mutableRegionUpgrades(save: SaveData, region: string): Record<string, number> {
  if (region === HOME_REGION) return save.upgrades;
  return (save.regionUpgrades[region] ??= {});
}
