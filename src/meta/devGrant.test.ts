import { describe, expect, it } from 'vitest';
import { achievementsConfig } from '../data';
import { grantDevProgress } from './devGrant';
import { emptySave } from './saveData';

describe('開発版の ?restore（進んだ状態に戻す）', () => {
  it('伝説以外の実績を全部達成にし、報酬のポケモンを解放し、コインをそろえる', () => {
    const save = emptySave(0, 500);
    const r = grantDevProgress(save, 50000);
    expect(save.coins).toBe(50000);
    expect(r.achievements).toBeGreaterThan(20);
    // 伝説の実績・解放は入れない
    for (const id of ['first-legendary', 'unlock-mewtwo', 'unlock-mew', 'unlock-articuno', 'shiny-charmander']) expect(save.achievements).not.toContain(id);
    for (const p of ['mewtwo', 'mew', 'articuno', 'zapdos', 'moltres']) expect(save.unlocked).not.toContain(p);
    // ジムリーダーの相棒などは解放
    expect(save.unlocked).toEqual(expect.arrayContaining(['onix', 'starmie', 'dragonite', 'eevee']));
    const legendFree = achievementsConfig.achievements.filter((a) => !save.achievements.includes(a.id));
    expect(legendFree.length).toBeLessThanOrEqual(9);
  });

  it('何度開いても同じ（実績は重ならず、コインは減らない）', () => {
    const save = emptySave(0, 500);
    save.coins = 80000;
    grantDevProgress(save, 50000);
    const n = save.achievements.length;
    grantDevProgress(save, 50000);
    expect(save.achievements.length).toBe(n);
    expect(save.coins).toBe(80000);
  });
});
