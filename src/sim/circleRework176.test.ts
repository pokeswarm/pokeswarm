import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import { Simulation } from './simulation';

/** 07 の176章: 自分から円が出る技の作り直し その1。どれも自分のまわり全部には当たらない */
function setup(move: string, level = 1) {
  const rules = buildSimRules('kanto');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const m = moveIndexOf(rules, move);
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, moves: [{ move: m, level }] });
  p.facingX = 1;
  p.facingY = 0;
  const pr = sim.world.projectiles;
  const mine = (): number[] => [...Array(pr.count).keys()].filter((i) => pr.move[i] === m);
  return { rules, sim, p, m, pr, mine, e: sim.world.enemies };
}

describe('円の技の作り直し その1', () => {
  it('あくのはどう: 一番近い敵へ玉が飛び、当たると弾ける', () => {
    const t = setup('dark-pulse');
    t.e.add(1, 0, 0, 150, 1e6, 0, 10);
    t.e.add(2, 0, 30, 170, 1e6, 0, 10);
    let burst = false;
    for (let k = 0; k < 40; k++) {
      t.sim.step([]);
      if (t.mine().some((i) => t.pr.stage[i] === 1)) burst = true;
    }
    expect(t.e.hp[0]!).toBeLessThan(1e6);
    expect(t.e.hp[1]!).toBeLessThan(1e6);
    expect(burst).toBe(true);
  });
});
