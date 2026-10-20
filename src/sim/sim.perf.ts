import { describe, it } from 'vitest';
import { Simulation } from './simulation';
import { testRules } from './testRules';

/**
 * 敵の数ごとに、シミュレーション1回分の処理時間を測る（npm run bench）。
 * 1秒30回の更新なら、1回あたり 33ms の中に描画も含めて収める必要がある。
 */
function filled(count: number): Simulation {
  const rules = testRules({ spawn: { spawnPerSecond: 3000, capGlobal: count, capPerPlayer: count } });
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 150 });
  sim.step([{ type: 'move', playerId: 1, dx: 1, dy: 1 }]);
  while (sim.world.enemies.count < count) sim.step([]);
  // 敵が詰まった状態になるまで進める
  for (let i = 0; i < 300; i++) sim.step([]);
  return sim;
}

describe('Simulation.step の処理時間', () => {
  for (const n of [300, 600, 1000, 2000, 4000]) {
    it(`敵 ${n} 体`, () => {
      const sim = filled(n);
      const steps = 600;
      const t0 = performance.now();
      for (let i = 0; i < steps; i++) sim.step([]);
      const ms = (performance.now() - t0) / steps;
      console.log(`敵 ${String(sim.world.enemies.count).padStart(4)} 体: ${ms.toFixed(3)} ms/回`);
    });
  }
});
