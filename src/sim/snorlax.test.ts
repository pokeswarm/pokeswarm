import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { makeOffers } from './systems/leveling';

/** カビゴン（作者の決定 2026年10月25日）: たいあたり と ねむる だけ。止まっていると眠って回復し、眠っている間はほかの技を出さない */
function setup() {
  const rules = buildSimRules();
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const lo = playableLoadout(rules, 'snorlax');
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 150, types: lo.types, moveTypes: lo.moveTypes, fixedMoves: lo.fixedMoves, moves: lo.moves, line: lo.line, species: lo.species });
  return { rules, sim, p };
}

describe('カビゴンの ねむる', () => {
  it('たいあたり と ねむる だけで、新しい技は候補に出ない', () => {
    const { rules, sim, p } = setup();
    expect(p.moves.map((m) => m.move)).toEqual([moveIndexOf(rules, 'tackle'), moveIndexOf(rules, 'rest')]);
    for (let k = 0; k < 10; k++) expect(makeOffers(sim.world, p).some((o) => o.kind === 'moveNew')).toBe(false);
  });

  it('3 秒止まると眠り、毎秒 1% 回復し、技を出さない。動くと 0.5 秒の起きる動き（動けない）を挟む', () => {
    const { sim, p } = setup();
    for (let k = 0; k < 4; k++) sim.world.enemies.add(k + 1, 0, 40, k * 5, 1e9, 0, 10);
    p.hp = p.maxHp / 2;
    for (let t = 0; t < 89; t++) sim.step([]);
    expect(p.sleep?.asleep).toBe(false);
    sim.step([]);
    expect(p.sleep?.asleep).toBe(true);
    const hp = p.hp;
    const used: string[] = [];
    for (let t = 0; t < 30; t++) {
      sim.step([]);
      for (const e of sim.world.events) if (e.type === 'moveUsed') used.push('used');
    }
    expect(used).toEqual([]);
    expect(p.hp - hp).toBeCloseTo(p.maxHp * 0.01, 1);
    // 動くと起きる動き: 0.5 秒は動けない
    const x = p.x;
    for (let t = 0; t < 10; t++) sim.step([{ type: 'move', playerId: 1, dx: 1, dy: 0 }]);
    expect(p.sleep?.asleep).toBe(false);
    expect(p.x).toBe(x);
    for (let t = 0; t < 12; t++) sim.step([]);
    sim.step([{ type: 'move', playerId: 1, dx: 1, dy: 0 }]);
    sim.step([]);
    expect(p.x).toBeGreaterThan(x);
  });
});
