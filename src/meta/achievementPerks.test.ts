import { describe, expect, it } from 'vitest';
import { achievementsConfig, unlocksConfig } from '../data';
import { applyOffer, makeOffers } from '../sim/systems/leveling';
import { Simulation } from '../sim/simulation';
import { testRules } from '../sim/testRules';
import { emptyModifiers } from '../sim/upgrades';
import { achievementPerks } from './achievementPerks';
import { applyProgress } from './progress';
import { startItemChoices } from './loadoutOptions';
import { emptySave } from './saveData';

/** 実績の報酬（作者の決定。07 23・24章） */
describe('実績の報酬', () => {
  it('最初はタイプのアイテムと基本のステータスだけ。石で進化するポケモンの実績で進化の石が解放される', () => {
    const start = achievementPerks(achievementsConfig, []);
    expect(start.items.has('charcoal')).toBe(true);
    expect(start.items.has('fire-stone')).toBe(false);
    expect(start.items.has('lucky-egg')).toBe(false);
    const after = achievementPerks(achievementsConfig, ['stone-fire', 'first-clear']);
    expect(after.items.has('fire-stone')).toBe(true);
    expect(after.items.has('lucky-egg')).toBe(true);
  });

  it('つながりのヒモは、協力プレイで遊ぶか、1ランで中ボスを8体倒すと解放される', () => {
    for (const stats of [{ 'runs.coop': 1 }, { bestMidbosses: 8 }] as Record<string, number>[]) {
      const save = emptySave();
      save.stats = stats;
      applyProgress(save, achievementsConfig, unlocksConfig);
      expect(save.achievements).toContain('linking-cord');
    }
  });

  it('コインの報酬は、達成したときにもらえる', () => {
    const save = emptySave();
    save.stats = { uniqueMoves: 1 };
    const before = save.coins;
    applyProgress(save, achievementsConfig, unlocksConfig);
    expect(save.coins - before).toBe(1000);
  });

  it('解放していない持ち物は候補に出ず、持ち物の枠を増やすと7つ目も出る', () => {
    const item = (key: string) => ({ key, category: 'stat' as const, maxLevel: 5, consumable: false, perLevel: emptyModifiers(4) });
    const rules = testRules({ items: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(item), leveling: { offerCount: 8, maxItemSlots: 6 } });
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    const locked = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, moves: [], unlockedItems: new Set([0, 1]) });
    for (let k = 0; k < 20; k++) for (const o of makeOffers(sim.world, locked)) if (o.kind === 'itemNew') expect([0, 1]).toContain(o.item);
    const wide = sim.addPlayer({ id: 2, x: 0, y: 0, radius: 12, moveSpeed: 0, moves: [], extraItemSlots: 1 });
    for (let i = 0; i < 6; i++) applyOffer(sim.world, wide, { kind: 'itemNew', item: i });
    expect(makeOffers(sim.world, wide).some((o) => o.kind === 'itemNew')).toBe(true);
  });

  it('色違いの御三家を倒すと、その系統を色違いで遊べる', () => {
    const save = emptySave();
    save.stats = { 'bossDefeated.charizard': 1 };
    applyProgress(save, achievementsConfig, unlocksConfig);
    expect(achievementPerks(achievementsConfig, save.achievements).shiny.has('charmander')).toBe(true);
    expect(achievementPerks(achievementsConfig, save.achievements).shiny.has('squirtle')).toBe(false);
  });

  it('最初の持ち物の候補は、解放済みで、そのポケモンの候補に出るものだけ', () => {
    const save = emptySave();
    const fire = startItemChoices(save, 'charmander');
    expect(fire).toContain('charcoal');
    expect(fire).not.toContain('mystic-water');
    expect(fire).not.toContain('fire-stone');
    save.achievements = ['stone-thunder', 'pikachu-light-ball'];
    expect(startItemChoices(save, 'pikachu')).toEqual(expect.arrayContaining(['thunder-stone', 'light-ball']));
    expect(startItemChoices(save, 'charmander')).not.toContain('light-ball');
  });
});
