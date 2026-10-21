import { describe, expect, it } from 'vitest';
import { forEachObstacleIn, insideObstacle, obstacleInCell, rayLengthToObstacle, type Obstacle } from './obstacles';
import { Simulation } from './simulation';
import { testRules } from './testRules';

function rules(chance = 1) {
  const r = testRules({ move: { range: 1 } });
  r.obstacles = { cellSize: 400, chance, margin: 50, radius: 20, safeRadius: 100, sections: [['test']] };
  return r;
}

/** プレイヤーの近くの障害物を1つ探す */
function firstObstacle(sim: Simulation): Obstacle {
  let found: Obstacle | null = null;
  forEachObstacleIn(sim.world, -2000, -2000, 2000, 2000, (o) => {
    if (!found || o.x * o.x + o.y * o.y < found.x * found.x + found.y * found.y) found = o;
  });
  if (!found) throw new Error('障害物がありません');
  return found;
}

describe('マップの障害物', () => {
  it('同じシードなら同じ場所。最初の場所の近くには置かない', () => {
    const a = new Simulation({ tickRate: 30, seed: 7, rules: rules() });
    const b = new Simulation({ tickRate: 30, seed: 7, rules: rules() });
    for (let cx = -3; cx <= 3; cx++) for (let cy = -3; cy <= 3; cy++) expect(obstacleInCell(a.world, cx, cy)).toEqual(obstacleInCell(b.world, cx, cy));
    forEachObstacleIn(a.world, -3000, -3000, 3000, 3000, (o) => expect(Math.hypot(o.x, o.y)).toBeGreaterThan(100));
  });

  it('置く確率 0 なら置かない', () => {
    const sim = new Simulation({ tickRate: 30, seed: 7, rules: rules(0) });
    let n = 0;
    forEachObstacleIn(sim.world, -3000, -3000, 3000, 3000, () => n++);
    expect(n).toBe(0);
  });

  it('プレイヤーは通り抜けられない', () => {
    const sim = new Simulation({ tickRate: 30, seed: 7, rules: rules() });
    const o = firstObstacle(sim);
    const p = sim.addPlayer({ id: 1, x: o.x - 60, y: o.y, radius: 12, moveSpeed: 300 });
    sim.step([{ type: 'move', playerId: 1, dx: 1, dy: 0 }]);
    for (let t = 0; t < 30; t++) sim.step([]);
    expect(Math.hypot(p.x - o.x, p.y - o.y)).toBeGreaterThanOrEqual(12 + 20 - 1e-6);
  });

  it('敵も障害物の外へ押し出される', () => {
    const sim = new Simulation({ tickRate: 30, seed: 7, rules: rules() });
    const o = firstObstacle(sim);
    sim.addPlayer({ id: 1, x: o.x + 300, y: o.y, radius: 12, moveSpeed: 0 });
    sim.world.enemies.add(1, 0, o.x + 2, o.y, 1000, 0, 10);
    sim.step([]);
    const e = sim.world.enemies;
    expect(Math.hypot(e.x[0]! - o.x, e.y[0]! - o.y)).toBeGreaterThanOrEqual(10 + 20 - 1e-6);
  });

  it('飛ぶ技は障害物に当たると消え、ビームは障害物の手前まで', () => {
    const sim = new Simulation({ tickRate: 30, seed: 7, rules: rules() });
    const o = firstObstacle(sim);
    expect(insideObstacle(sim.world, o.x + 5, o.y)).toBe(true);
    expect(insideObstacle(sim.world, o.x + 30, o.y)).toBe(false);
    expect(rayLengthToObstacle(sim.world, o.x - 100, o.y, 1, 0, 300)).toBeCloseTo(80);
    // 横を通り過ぎる線は遮らない（ほかの障害物に届かない長さで）
    expect(rayLengthToObstacle(sim.world, o.x - 40, o.y + 30, 1, 0, 80)).toBe(80);
  });
});
