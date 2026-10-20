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
  it('出現数が上限で止まる（上限を超えた分は出さない）', () => {
    const sim = makeSim(testRules({ spawn: { spawnPerSecond: 300, capGlobal: 50, capPerPlayer: 50 }, attack: { damage: 0.0001 } }));
    for (let i = 0; i < 60; i++) sim.step([]);
    expect(sim.world.enemies.count).toBe(50);
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

describe('時間帯ごとの出現', () => {
  it('その時間帯の種類だけが出る', () => {
    const rules = testRules({
      spawn: {
        spawnPerSecond: 30,
        capGlobal: 1000,
        capPerPlayer: 1000,
        waves: [
          { startSeconds: 0, hpMultiplier: 1, kinds: ['a'] },
          { startSeconds: 2, hpMultiplier: 2, kinds: ['b', 'c'] },
        ],
      },
      attack: { range: 1 },
    });
    rules.enemies.kinds = ['a', 'b', 'c'].map((id) => ({ id, hp: 20, moveSpeed: 0, radius: 10 }));
    const sim = makeSim(rules);
    const kindsAt = (from: number): Set<number> => {
      const e = sim.world.enemies;
      const out = new Set<number>();
      for (let i = from; i < e.count; i++) out.add(e.kind[i]!);
      return out;
    };
    for (let t = 0; t < 60; t++) sim.step([]);
    expect(kindsAt(0)).toEqual(new Set([0]));
    const before = sim.world.enemies.count;
    for (let t = 0; t < 60; t++) sim.step([]);
    expect(kindsAt(before)).toEqual(new Set([1, 2]));
    // 後の時間帯の敵ほど HP が多い
    expect(sim.world.enemies.maxHp[0]).toBe(20);
    expect(sim.world.enemies.maxHp[sim.world.enemies.count - 1]).toBe(40);
  });
});

describe('前の時間帯の敵', () => {
  it('離れすぎたら移し替えずに消す（撃破には数えない）', () => {
    const rules = testRules({
      spawn: {
        waves: [
          { startSeconds: 0, hpMultiplier: 1, kinds: ['a'] },
          { startSeconds: 1, hpMultiplier: 1, kinds: ['b'] },
        ],
      },
      attack: { range: 1 },
    });
    rules.enemies.kinds = ['a', 'b'].map((id) => ({ id, hp: 20, moveSpeed: 0, radius: 10 }));
    const sim = makeSim(rules);
    const e = sim.world.enemies;
    e.add(1, 0, 300, 0, 20, 0, 10); // 前の時間帯の種類（a）
    e.add(2, 1, 400, 0, 20, 0, 10); // 次の時間帯の種類（b）
    for (let t = 0; t < 31; t++) sim.step([]);
    // 時間帯が b に切り替わった後で、両方を遠くへ離す
    for (let i = 0; i < e.count; i++) e.x[i] = e.id[i] === 1 ? -5000 : 5000;
    sim.step([]);
    const ids = Array.from(sim.world.enemies.id.subarray(0, sim.world.enemies.count));
    expect(ids).toEqual([2]);
    expect(sim.world.stats.kills).toBe(0);
  });
});
