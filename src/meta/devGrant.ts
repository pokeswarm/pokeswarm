import { achievementsConfig, enemiesConfig } from '../data';
import { regionUnlockKey } from './regionScope';
import type { SaveData } from './saveData';

/**
 * 開発版だけ（作者の依頼 2026年10月27日: テストでセーブが消えたので、進んだ状態に戻したい）: ?restore=50000 で開くと、
 * 伝説以外の実績を全部達成にし（報酬で解放されるポケモンも解放）、コインを少なくともその数にする。公開版では呼ばない（main.ts）。
 * 伝説の実績 = 伝説を倒す・色違いの御三家（伝説として倒す）・伝説のポケモン（ミュウツー・ミュウ・三鳥）の解放。
 * 実績の報酬のコインは足さない（コインは指定の数にそろえる）
 */
export function grantDevProgress(save: SaveData, coins: number): { achievements: number; unlocked: number } {
  const legends = new Set(enemiesConfig.kinds.filter((k) => k.rank === 'legendary').map((k) => k.species ?? k.id.replace(/^legend-|^shiny-/, '')));
  const isLegend = (a: (typeof achievementsConfig.achievements)[number]): boolean => {
    const cond = JSON.stringify(a.condition);
    if (cond.includes('"legendaryKills"')) return true;
    if ([...legends].some((s) => cond.includes(`"bossDefeated.${s}"`))) return true;
    return !!a.reward?.shiny || (!!a.reward?.pokemon && legends.has(a.reward.pokemon));
  };
  let achievements = 0;
  let unlocked = 0;
  for (const a of achievementsConfig.achievements) {
    if (isLegend(a) || save.achievements.includes(a.id)) continue;
    save.achievements.push(a.id);
    achievements++;
    const p = a.reward?.pokemon ? regionUnlockKey(a.region, a.reward.pokemon) : undefined;
    if (p && !save.unlocked.includes(p)) {
      save.unlocked.push(p);
      unlocked++;
    }
  }
  save.coins = Math.max(save.coins, Math.floor(coins));
  return { achievements, unlocked };
}
