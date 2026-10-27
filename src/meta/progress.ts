import type { AchievementsConfig, StatCondition, UnlocksConfig } from '../data/schema';
import type { SaveData } from './saveData';
import { HOME_REGION, regionStatKey, regionStats, regionUnlockKey } from './regionScope';

/**
 * 実績とポケモンの解放の判定（01_game_design.md 8.1・8.2）。条件は data/game/achievements.json（解放は reward.pokemon）に
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

/** 数え直す記録のもと: 遊べるポケモンのキーと、固有技（derivations.json の unique の先） */
export interface DerivedStatSources {
  readonly playables: readonly string[];
  readonly uniqueMoves: readonly string[];
}

/**
 * ほかの記録から数え直す記録（クリアしたポケモンの種類・出した固有技の種類）。前のセーブデータでも正しい数になる。
 * region の記録（02 の17章。省略時はカントー）から数え、その地方の記録に書く
 */
export function refreshDerivedStats(stats: Record<string, number>, src: DerivedStatSources, region = 'kanto'): void {
  const view = regionStats(stats, region);
  stats[regionStatKey(region, 'distinctClears')] = src.playables.filter((k) => (view[`clears.${k}`] ?? 0) > 0).length;
  stats[regionStatKey(region, 'uniqueKinds')] = src.uniqueMoves.filter((m) => (view[`derived.${m}`] ?? 0) > 0).length;
}

/** その地方で解放済みか（最初から遊べるポケモンはどの地方でも。解放は地方ごと。07 の66.1） */
export function isUnlocked(save: Readonly<SaveData>, unlocks: UnlocksConfig, pokemon: string, region: string = HOME_REGION): boolean {
  return unlocks.initial.includes(pokemon) || save.unlocked.includes(regionUnlockKey(region, pokemon));
}

/** 遊べるポケモン（playables.json のキーと、その解放の名前）が、その地方で解放済みか */
export function isPlayableUnlocked(save: Readonly<SaveData>, unlocks: UnlocksConfig, key: string, unlock: string | undefined, region: string = HOME_REGION): boolean {
  return isUnlocked(save, unlocks, unlock ?? key, region);
}

/**
 * まだ当てていないリセット（achievements.json の resets）を当てる: 実績・解放・記録を取り消し、記録 reset.<tag> で覚える。
 * 変えたら true（作者の依頼 2026年10月27日: 伝説のリワークに合わせて、伝説を倒した実績と解放をリセット）
 */
export function applyResets(save: SaveData, resets: AchievementsConfig['resets']): boolean {
  let changed = false;
  for (const r of resets ?? []) {
    const mark = `reset.${r.tag}`;
    if (save.stats[mark]) continue;
    save.achievements = save.achievements.filter((a) => !r.achievements.includes(a));
    save.unlocked = save.unlocked.filter((u) => !r.unlocked.includes(u));
    for (const k of r.stats) delete save.stats[k];
    save.stats[mark] = 1;
    changed = true;
  }
  return changed;
}

/** 新しく条件を満たした実績と解放を、セーブデータに足して返す */
export function applyProgress(save: SaveData, achievements: AchievementsConfig, unlocks: UnlocksConfig): { achievements: string[]; unlocks: string[] } {
  const newAchievements: string[] = [];
  for (const a of achievements.achievements) {
    // その実績の地方のランの記録だけで判定する（02 の17章）
    if (save.achievements.includes(a.id) || !meets(regionStats(save.stats, a.region), a.condition)) continue;
    save.achievements.push(a.id);
    newAchievements.push(a.id);
    // 報酬のコイン（作者の決定 07 23章）
    if (a.reward?.coins) save.coins += a.reward.coins;
  }
  const newUnlocks: string[] = [];
  for (const u of unlocks.unlocks) {
    if (isUnlocked(save, unlocks, u.pokemon, u.region) || !meets(regionStats(save.stats, u.region), u.condition)) continue;
    save.unlocked.push(regionUnlockKey(u.region, u.pokemon));
    newUnlocks.push(u.pokemon);
  }
  return { achievements: newAchievements, unlocks: newUnlocks };
}
