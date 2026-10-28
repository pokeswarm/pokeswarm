import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import { Simulation } from './simulation';
import { recomputeModifiers } from './systems/leveling';
import { moveStatsOf, playerMoveStats } from './systems/attack';

/** 太い追従レーザーは、ポイントマックスで増えた本数を威力に変える（作者の依頼 2026年10月29日。07 の122章） */
describe('ポイントマックスと太い追従レーザー', () => {
  it('ハイドロカノン（2本）は +1 で本数はそのまま・威力 1.5 倍、ハイドロポンプ（1本）は +2 で威力 3 倍。ほかの技は本数が増える', () => {
    const rules = buildSimRules();
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0 });
    const ppMax = rules.items.findIndex((it) => it.key === 'pp-max');
    const at = (key: string, level: number) => {
      const pm = { move: moveIndexOf(rules, key), level };
      return { base: moveStatsOf(sim.world, pm), with: playerMoveStats(sim.world, p, pm) };
    };
    p.items = [{ item: ppMax, level: 1 }];
    recomputeModifiers(sim.world, p);
    const cannon = at('hydro-cannon', 1);
    expect(cannon.with.count).toBe(cannon.base.count);
    expect(cannon.with.power).toBeCloseTo((cannon.base.power * 3) / 2);
    p.items = [{ item: ppMax, level: 2 }];
    recomputeModifiers(sim.world, p);
    const pump = at('hydro-pump', 1);
    expect(pump.with.count).toBe(1);
    expect(pump.with.power).toBeCloseTo(pump.base.power * 3);
    for (const key of ['hyper-beam', 'solar-beam']) expect(at(key, 1).with.count).toBe(1);
    // ふつうの技は本数が増える
    const ember = at('ember', 1);
    expect(ember.with.count).toBe(ember.base.count + 2);
    expect(ember.with.power).toBe(ember.base.power);
  });
});
