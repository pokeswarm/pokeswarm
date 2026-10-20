import type { AchievementsConfig, StatCondition, UnlocksConfig } from '../data/schema';
import type { SaveData } from './saveData';

/**
 * 実績とポケモンの解放の判定（01_game_design.md 8.1・8.2）。条件は data/game/achievements.json・unlocks.json に
 * 「記録の名前 ≧ 数」の形で書き、all（すべて）・any（どれか）で組み合わせられる。記録の名前は runRecorder.ts を参照。
 */
export function meets(stats: Readonly<Record<string, number>>, c: StatCondition): boolean {
  if ('stat' in c) return (stats[c.stat] ?? 0) >= c.atLeast;
  if ('all' in c) return c.all.every((x) => meets(stats, x));
  return c.any.some((x) => meets(stats, x));
}

/** 1つの記録だけの条件なら、今の数と目標（一覧で進み具合を出す）。組み合わせなら null */
export function progressOf(stats: Readonly<Record<string, number>>, c: StatCondition): { current: number; target: number } | null {
  return 'stat' in c ? { current: Math.min(stats[c.stat] ?? 0, c.atLeast), target: c.atLeast } : null;
}

export function isUnlocked(save: Readonly<SaveData>, unlocks: UnlocksConfig, pokemon: string): boolean {
  return unlocks.initial.includes(pokemon) || save.unlocked.includes(pokemon);
}

/** 新しく条件を満たした実績と解放を、セーブデータに足して返す */
export function applyProgress(save: SaveData, achievements: AchievementsConfig, unlocks: UnlocksConfig): { achievements: string[]; unlocks: string[] } {
  const newAchievements: string[] = [];
  for (const a of achievements.achievements) {
    if (save.achievements.includes(a.id) || !meets(save.stats, a.condition)) continue;
    save.achievements.push(a.id);
    newAchievements.push(a.id);
  }
  const newUnlocks: string[] = [];
  for (const u of unlocks.unlocks) {
    if (isUnlocked(save, unlocks, u.pokemon) || !meets(save.stats, u.condition)) continue;
    save.unlocked.push(u.pokemon);
    newUnlocks.push(u.pokemon);
  }
  return { achievements: newAchievements, unlocks: newUnlocks };
}
