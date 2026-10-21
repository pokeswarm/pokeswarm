import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { testRules } from './testRules';

/** 協力プレイで届いた位置をなめらかに見せる（作者の指摘「ゲストで敵も味方もワープする」。03_network.md 6.4） */
describe('届いた位置をなめらかに見せる', () => {
  it('相手のプレイヤーの位置がまとまって届いても、1回の更新で大きく跳ばない', () => {
    const sim = new Simulation({ tickRate: 30, seed: 1, rules: testRules(), role: 'guest', localPlayerId: 2 });
    sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 150, remote: true });
    sim.addPlayer({ id: 2, x: 0, y: 200, radius: 12, moveSpeed: 150 });
    const remote = sim.world.players.find((p) => p.id === 1)!;
    const step = 150 / 30;
    let worst = 0;
    let trueX = 0;
    for (let t = 0; t < 240; t++) {
      trueX += step;
      // 位置は 6 回に1回だけ、まとめて届く
      const cmds =
        t % 6 === 0 ? [{ type: 'remotePlayer' as const, playerId: 1, x: trueX, y: 0, facingX: 1 as const, facingY: 0 as const, inputX: 1 as const, inputY: 0 as const }] : [];
      const before = remote.x;
      sim.step(cmds);
      if (t > 30) worst = Math.max(worst, Math.abs(remote.x - before));
    }
    // 本人の速さ（1回あたり 5）の2倍より大きく跳ばない
    expect(worst).toBeLessThan(step * 2);
    // 本人の位置から大きく遅れない
    expect(Math.abs(remote.x - trueX)).toBeLessThan(step * 8);
  });

  it('敵の位置の補正は少しずつ寄せ、大きくずれたときだけ一度に合わせる', () => {
    const sim = new Simulation({ tickRate: 30, seed: 1, rules: testRules({ spawn: { spawnPerSecond: 0 } }), role: 'guest', localPlayerId: 1 });
    sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0 });
    const e = sim.world.enemies;
    e.add(10, 0, 300, 0, 100, 0, 10);
    e.add(11, 0, -300, 0, 100, 0, 10);
    sim.step([{ type: 'correctEnemies', data: [10, 300, 60, 11, -300, 600] }]);
    // 小さなずれ（60）は、最初の更新では一部だけ寄る
    expect(e.y[0]!).toBeGreaterThan(0);
    expect(e.y[0]!).toBeLessThan(30);
    // 大きなずれ（600）は一度に合わせる
    expect(e.y[1]!).toBe(600);
    for (let t = 0; t < 60; t++) sim.step([]);
    expect(e.y[0]!).toBeCloseTo(60, 0);
  });
});
