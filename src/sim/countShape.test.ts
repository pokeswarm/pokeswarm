import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import { SHAPE_BOX, SHAPE_SECTOR } from './entities/projectiles';
import { Simulation } from './simulation';
import { playerMoveStats } from './systems/attack';

/** 技の数が増えたときの出方（作者の指摘 2026年11月3日。07 の163章） */
function setup(move: string, amountBonus: number) {
  const rules = buildSimRules('johto');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const m = moveIndexOf(rules, move);
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, moves: [{ move: m, level: 1 }] });
  p.facingX = 1;
  p.facingY = 0;
  p.mods.amountBonus = amountBonus;
  const pr = sim.world.projectiles;
  const find = (pred: (i: number) => boolean): number[] => [...Array(pr.count).keys()].filter(pred);
  return { rules, sim, p, m, pr, find };
}

describe('技の数が増えたとき', () => {
  it('扇（たいあたり・ふきとばし）は反対側に出さず、角度が広がる', () => {
    for (const key of ['tackle', 'whirlwind']) {
      const a = setup(key, 0);
      a.sim.step([]);
      const one = a.find((i) => a.pr.move[i] === a.m && a.pr.shape[i] === SHAPE_SECTOR);
      const b = setup(key, 1);
      b.sim.step([]);
      const two = b.find((i) => b.pr.move[i] === b.m && b.pr.shape[i] === SHAPE_SECTOR);
      expect(two).toHaveLength(1);
      expect(b.pr.dirX[two[0]!]).toBeCloseTo(1);
      expect(b.pr.length[two[0]!]!).toBeGreaterThan(a.pr.length[one[0]!]!);
    }
  });
  it('前の長方形（ひっかく）は、届く距離と幅が大きくなる', () => {
    const a = setup('scratch', 0);
    a.sim.step([]);
    const b = setup('scratch', 2);
    b.sim.step([]);
    const ia = a.find((i) => a.pr.move[i] === a.m && a.pr.shape[i] === SHAPE_BOX)[0]!;
    const ib = b.find((i) => b.pr.move[i] === b.m && b.pr.shape[i] === SHAPE_BOX);
    expect(ib).toHaveLength(1);
    expect(b.pr.radius[ib[0]!]!).toBeCloseTo(a.pr.radius[ia]! * (1 + (2 * b.rules.combat.boxCountGrowthPct) / 100));
  });
  it('自分の周り全部（のしかかり）は、数を増やさず威力が上がる', () => {
    const b = setup('body-slam', 1);
    const pm = b.p.moves[0]!;
    const st = playerMoveStats(b.sim.world, b.p, pm);
    const base = setup('body-slam', 0);
    const st0 = playerMoveStats(base.sim.world, base.p, base.p.moves[0]!);
    expect(st.count).toBe(st0.count);
    expect(st.power).toBeGreaterThan(st0.power);
  });
});
