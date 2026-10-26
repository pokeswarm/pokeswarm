import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { makeOffers } from './systems/leveling';

/**
 * ニャース（作者の決定 2026年10月26日）: 最初の技「ネコにこばん」。毎秒小判を投げ、ランのコインが増える（レベルでさらに増える）。
 * 小判はごく弱く、レベルを上げても大きさ・数・威力は変わらない。技もポケモンも進化しない
 */
function setup(level = 1) {
  const rules = buildSimRules();
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const lo = playableLoadout(rules, 'meowth');
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, types: lo.types, moveTypes: lo.moveTypes, moves: lo.moves.map((m) => ({ ...m, level })), line: lo.line, species: lo.species });
  return { rules, sim, p, move: moveIndexOf(rules, 'pay-day') };
}

describe('ニャースの ネコにこばん', () => {
  it('毎秒1回小判を投げ、そのたびにランのコインが増える（レベルでさらに増える）', () => {
    const lv1 = setup(1);
    for (let t = 0; t < 10 * 30; t++) lv1.sim.step([]);
    const lv8 = setup(8);
    for (let t = 0; t < 10 * 30; t++) lv8.sim.step([]);
    expect(lv1.p.bonusCoins).toBeCloseTo(10 * 0.2, 5);
    expect(lv8.p.bonusCoins).toBeCloseTo(10 * (0.2 + 0.1 * 7), 5);
  });

  it('レベルを上げても、小判の大きさ・数・威力は変わらない', () => {
    const { rules, move } = setup();
    const lv = rules.moves[move]!.levels;
    expect(lv[lv.length - 1]!.power).toBe(lv[0]!.power);
    expect(lv[lv.length - 1]!.size).toBe(lv[0]!.size);
    expect(lv[lv.length - 1]!.count).toBe(lv[0]!.count);
  });

  it('ほかの技を覚えて戦う（ネコにこばんから派生しない）', () => {
    const { sim, p, move } = setup(8);
    const offers = Array.from({ length: 20 }, () => makeOffers(sim.world, p)).flat();
    expect(offers.some((o) => o.kind === 'moveNew')).toBe(true);
    expect(offers.some((o) => o.kind === 'derive')).toBe(false);
    expect(sim.world.rules.derivations.some((d) => d.from === move)).toBe(false);
  });
});
