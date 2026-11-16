import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import { Simulation } from './simulation';

/** ミズゴロウの系統の見直し: だくりゅう（ホウエン）は前へ進む泥の大波（07 の274章） */
describe('だくりゅう（ホウエン）', () => {
  function setup() {
    const rules = buildSimRules('hoenn');
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    const m = moveIndexOf(rules, 'muddy-water-hoenn');
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, moves: [{ move: m, level: 1 }] });
    p.facingX = 1;
    p.facingY = 0;
    const pr = sim.world.projectiles;
    const find = (stage: number): number[] => [...Array(pr.count).keys()].filter((i) => pr.move[i] === m && pr.stage[i] === stage);
    return { rules, sim, m, p, pr, find };
  }

  it('雑魚は前へ押し流して進み続け、ボスに当たった所で砕けて弾ける', () => {
    const t = setup();
    const e = t.sim.world.enemies;
    const kinds = t.rules.enemies.kinds;
    const normal = kinds.findIndex((k) => (k.rank ?? 'normal') === 'normal');
    const boss = kinds.findIndex((k) => k.rank === 'boss');
    expect(boss).toBeGreaterThanOrEqual(0);
    e.add(1, normal, 80, 0, 1e6, 0, 10);
    e.add(2, boss, 260, 0, 1e9, 0, 30);
    const x0 = 80;
    let wave = -1;
    let crashed = false;
    for (let k = 0; k < 60 && !crashed; k++) {
      t.sim.step([]);
      const w = t.find(0);
      if (w.length > 0) wave = w[0]!;
      crashed = t.find(1).length > 0;
    }
    expect(wave).toBeGreaterThanOrEqual(0);
    // 雑魚は波の向きへ押された
    expect(e.x[e.id.indexOf(1)]!).toBeGreaterThan(x0);
    // 届ききる前に、ボスの手前で砕けた
    expect(crashed).toBe(true);
    const at = t.find(1)[0]!;
    expect(Math.abs(t.pr.x[at]! - 260)).toBeLessThan(80);
    expect(t.find(0)).toHaveLength(0);
  });

  it('当たった敵は どろまみれ（遅くなり、ぶつかったときのダメージが減る）', () => {
    const t = setup();
    const w = t.sim.world;
    w.enemies.add(1, 0, 80, 0, 1e6, 0, 10);
    for (let k = 0; k < 15; k++) t.sim.step([]);
    const muddied = w.statusKinds.findIndex((k) => k.id === 'muddied');
    expect(muddied).toBeGreaterThanOrEqual(0);
    expect(w.statusKinds[muddied]!.speedMultiplier).toBeLessThan(1);
    expect(w.enemies.hasStatus(w.enemies.id.indexOf(1), muddied)).toBe(true);
  });
});
