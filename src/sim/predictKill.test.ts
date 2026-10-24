import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { testRules } from './testRules';

/** ゲストが倒した敵を先に消して見せる（作者の依頼 2026年10月25日。03_network.md 6.4） */
function guest() {
  const rules = testRules({ spawn: { spawnPerSecond: 0 }, move: { power: 1e6, cooldownSeconds: 100, range: 300, pierce: 1 } });
  const sim = new Simulation({ tickRate: 30, seed: 1, rules, role: 'guest', localPlayerId: 2 });
  sim.addPlayer({ id: 1, x: -500, y: 0, radius: 12, moveSpeed: 0, remote: true });
  sim.addPlayer({ id: 2, x: 0, y: 0, radius: 12, moveSpeed: 0, moves: [{ move: 0, level: 1 }] });
  sim.step([{ type: 'spawnEnemy', id: 1, kind: 0, x: 60, y: 0 }]);
  return sim;
}

const run = (sim: Simulation, n: number): string[] => {
  const types: string[] = [];
  for (let t = 0; t < n; t++) {
    sim.step([]);
    types.push(...sim.world.events.map((e) => e.type));
  }
  return types;
};

describe('ゲストが倒した敵を先に消して見せる', () => {
  it('自分の攻撃で倒したと見込んだら、すぐ見えなくなり（HP 0）、ホストの撃破の知らせで本当に倒れる', () => {
    const sim = guest();
    const e = sim.world.enemies;
    const types = run(sim, 15);
    expect(types).toContain('damageDealt');
    // 入れ物には残したまま、HP 0（描かない・当たらない）で知らせを待つ
    expect(e.count).toBe(1);
    expect(e.hp[0]).toBeLessThanOrEqual(0);
    expect(e.ghostTicks[0]).toBeGreaterThan(0);
    expect(types).not.toContain('enemyKilled');
    sim.step([{ type: 'killEnemy', id: 1, by: 2 }]);
    expect(sim.world.events.filter((ev) => ev.type === 'enemyKilled')).toHaveLength(1);
    expect(e.count).toBe(0);
  });

  it('撃破の知らせが来ないまま時間が切れたら（見込みが外れた）、見せ直す', () => {
    const sim = guest();
    const e = sim.world.enemies;
    run(sim, 15);
    expect(e.hp[0]).toBeLessThanOrEqual(0);
    run(sim, Math.round(sim.world.rules.netSmoothing.predictKillSeconds * 30) + 2);
    expect(e.count).toBe(1);
    expect(e.hp[0]).toBeGreaterThan(0);
    expect(e.ghostTicks[0]).toBe(0);
  });
});
