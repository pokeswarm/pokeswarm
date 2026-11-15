import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import { Simulation } from './simulation';

/** 07 の269章: 反動の技は、出したときではなく、敵に当たったときに反動を受ける */
function setup(move: string) {
  const rules = buildSimRules();
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, moves: [{ move: moveIndexOf(rules, move), level: 1 }] });
  p.facingX = 1;
  p.facingY = 0;
  const normal = rules.enemies.kinds.findIndex((k) => (k.rank ?? 'normal') === 'normal');
  return { rules, sim, p, normal, e: sim.world.enemies };
}

describe('反動の技は当たったときだけ反動を受ける（07 の269章）', () => {
  it('敵がいなければ、放っておいても HP が減らない（ブレイブバード）', () => {
    for (const move of ['brave-bird']) {
      const t = setup(move);
      const hp = t.p.hp;
      for (let k = 0; k < 300; k++) t.sim.step([]);
      expect(t.p.hp, move).toBe(hp);
    }
  });

  it('すてみタックル: 出ても外れたら反動を受けない', () => {
    const t = setup('double-edge');
    t.e.add(1, t.normal, 80, 0, 1e6, 0, 10);
    const hp = t.p.hp;
    t.sim.step([]);
    expect(t.sim.world.events.some((ev) => ev.type === 'dashStarted')).toBe(true);
    // 突っ込む前に相手がいなくなる
    t.e.hp[0] = 0;
    for (let k = 0; k < 10; k++) t.sim.step([]);
    expect(t.p.hp).toBe(hp);
  });

  it('すてみタックル: 当たれば反動を受ける（1 回の突進で、何匹に当たっても 1 回だけ）', () => {
    const t = setup('double-edge');
    for (let k = 0; k < 4; k++) t.e.add(k + 1, t.normal, 60 + k * 12, 0, 1e6, 0, 10);
    const hp = t.p.hp;
    for (let k = 0; k < 8; k++) t.sim.step([]);
    const lost = hp - t.p.hp;
    expect(lost).toBeGreaterThan(0);
    // 最大 HP の 1.5% を、防御の軽減の後で 1 回分
    expect(lost).toBeLessThanOrEqual((t.p.maxHp * 1.5) / 100 + 1e-6);
  });
});
