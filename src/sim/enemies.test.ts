import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { testRules } from './testRules';
import type { SimRules } from './rules';
import { enemyCap } from './world';

function makeSim(rules: SimRules, players = 1): Simulation {
  const sim = new Simulation({ tickRate: 30, seed: 9, rules });
  for (let id = 1; id <= players; id++) sim.addPlayer({ id, x: id * 100, y: 0, radius: 12, moveSpeed: 150 });
  return sim;
}

describe('雑魚敵', () => {
  it('出現数が上限で止まり、超えた分は既存の敵の強化になる', () => {
    const sim = makeSim(testRules({ spawn: { spawnPerSecond: 300, capGlobal: 50, capPerPlayer: 50 }, attack: { damage: 0.0001 } }));
    for (let i = 0; i < 60; i++) sim.step([]);
    expect(sim.world.enemies.count).toBe(50);
    expect(sim.world.stats.empowered).toBeGreaterThan(0);
  });

  it('実際の上限は min(全体, 1人あたり × 人数)', () => {
    const rules = testRules({ spawn: { capGlobal: 100, capPerPlayer: 30 } });
    expect(enemyCap(makeSim(rules, 1).world)).toBe(30);
    expect(enemyCap(makeSim(rules, 4).world)).toBe(100);
  });

  it('一番近いプレイヤーに近づく', () => {
    const sim = makeSim(testRules({ attack: { range: 1 } }));
    const e = sim.world.enemies;
    e.add(1, 0, 400, 0, 20, 60, 10);
    sim.step([]);
    // プレイヤーは (100, 0)。60/30 = 2 だけ近づく
    expect(e.x[0]).toBeCloseTo(398);
  });

  it('離れすぎた敵はプレイヤーの進行方向側へ移し替える', () => {
    const sim = makeSim(testRules({ attack: { range: 1 } }));
    const e = sim.world.enemies;
    e.add(1, 0, -5000, 0, 20, 60, 10);
    sim.step([{ type: 'move', playerId: 1, dx: 1, dy: 0 }]);
    const p = sim.world.players[0]!;
    const dx = e.x[0]! - p.x;
    expect(dx).toBeGreaterThan(400);
    expect(Math.abs(e.y[0]! - p.y)).toBeLessThanOrEqual(400);
  });

  it('自動攻撃で敵を倒すと撃破の出来事が出る', () => {
    const sim = makeSim(testRules());
    sim.world.enemies.add(77, 0, 300, 0, 20, 0, 10);
    const kills: number[] = [];
    for (let i = 0; i < 60; i++) {
      sim.step([]);
      for (const ev of sim.world.events) if (ev.type === 'enemyKilled') kills.push(ev.enemyId);
    }
    expect(kills).toEqual([77]);
    expect(sim.world.enemies.count).toBe(0);
  });

  it('同じシード・同じコマンドなら敵を含めて同じ結果になる', () => {
    const rules = testRules({ spawn: { spawnPerSecond: 60, capGlobal: 300, capPerPlayer: 300 } });
    const run = (): Simulation => {
      const sim = makeSim(rules, 2);
      for (let i = 0; i < 600; i++) {
        const dx = (((i / 40) | 0) % 3) - 1;
        sim.step(i % 40 === 0 ? [{ type: 'move', playerId: 1, dx: dx as -1 | 0 | 1, dy: 1 }] : []);
      }
      return sim;
    };
    const a = run().world;
    const b = run().world;
    expect(b.stats).toEqual(a.stats);
    expect(b.enemies.count).toBe(a.enemies.count);
    expect(Array.from(b.enemies.x.subarray(0, b.enemies.count))).toEqual(Array.from(a.enemies.x.subarray(0, a.enemies.count)));
    expect(b.rng.getState()).toEqual(a.rng.getState());
  });
});
