import { describe, expect, it } from 'vitest';
import type { AchievementsConfig, UnlocksConfig } from '../data/schema';
import { applyProgress, isPlayableUnlocked, isUnlocked, meets, progressOf, refreshDerivedStats } from './progress';
import { emptySave } from './saveData';

const achievements: AchievementsConfig = {
  initialPokemon: ['charmander'],
  initialItems: ['x-attack'],
  startItem: { clears: 1 },
  achievements: [
    { id: 'a', hidden: false, condition: { stat: 'kills', atLeast: 10 } },
    { id: 'b', hidden: true, condition: { all: [{ stat: 'x', atLeast: 1 }, { stat: 'y', atLeast: 1 }] } },
    { id: 'c', hidden: false, condition: { any: [{ stat: 'x', atLeast: 5 }, { stat: 'z', atLeast: 1 }] } },
  ],
};
const unlocks: UnlocksConfig = { initial: ['charmander'], unlocks: [{ pokemon: 'onix', condition: { stat: 'defeated.onix', atLeast: 20 } }] };

describe('実績と解放', () => {
  it('条件の組み合わせ（すべて・どれか）', () => {
    expect(meets({ x: 1, y: 1 }, achievements.achievements[1]!.condition)).toBe(true);
    expect(meets({ x: 1 }, achievements.achievements[1]!.condition)).toBe(false);
    expect(meets({ z: 1 }, achievements.achievements[2]!.condition)).toBe(true);
    expect(progressOf({ kills: 4 }, achievements.achievements[0]!.condition)).toEqual({ current: 4, target: 10 });
    expect(progressOf({}, achievements.achievements[1]!.condition)).toBeNull();
  });

  it('新しく満たしたものだけを足し、2回目は足さない', () => {
    const save = emptySave();
    save.stats = { kills: 12, 'defeated.onix': 20 };
    expect(applyProgress(save, achievements, unlocks)).toEqual({ achievements: ['a'], unlocks: ['onix'] });
    expect(applyProgress(save, achievements, unlocks)).toEqual({ achievements: [], unlocks: [] });
    expect(save.achievements).toEqual(['a']);
    expect(isUnlocked(save, unlocks, 'onix')).toBe(true);
    expect(isUnlocked(save, unlocks, 'charmander')).toBe(true);
    expect(isUnlocked(emptySave(), unlocks, 'onix')).toBe(false);
    // 進化前から始めるポケモンは、解放の名前（進化後）で判定する
    save.unlocked.push('starmie');
    expect(isPlayableUnlocked(save, unlocks, 'staryu', 'starmie')).toBe(true);
    expect(isPlayableUnlocked(emptySave(), unlocks, 'staryu', 'starmie')).toBe(false);
  });

  it('クリアしたポケモンの種類・出した固有技の種類は、ほかの記録から数え直す', () => {
    const stats: Record<string, number> = { 'clears.charmander': 2, 'clears.squirtle': 1, 'clears.solo': 3, 'derived.blast-burn': 1, 'derived.flamethrower': 4 };
    refreshDerivedStats(stats, { playables: ['charmander', 'squirtle', 'bulbasaur'], uniqueMoves: ['blast-burn', 'hydro-cannon'] });
    expect(stats.distinctClears).toBe(2);
    expect(stats.uniqueKinds).toBe(1);
  });
});
