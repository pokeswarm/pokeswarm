import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { testRules } from './testRules';

/** プレイヤー (100, 0) の右に、動かない敵を一列に並べて1発だけ撃つ */
function shootLine(pierce: number, enemyCount: number): number[] {
  const rules = testRules({ move: { pierce, cooldownSeconds: 100, power: 10 } });
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  sim.addPlayer({ id: 1, x: 100, y: 0, radius: 12, moveSpeed: 150 });
  for (let k = 0; k < enemyCount; k++) sim.world.enemies.add(k + 1, 0, 300 + k * 40, 0, 1000, 0, 10);
  for (let t = 0; t < 40; t++) sim.step([]);
  const e = sim.world.enemies;
  // id 順に受けたダメージを返す
  return Array.from({ length: enemyCount }, (_, k) => {
    const i = Array.from(e.id.subarray(0, e.count)).indexOf(k + 1);
    return 1000 - e.hp[i]!;
  });
}

describe('貫通可能数', () => {
  it('貫通1なら最初の敵だけに当たって消える', () => {
    expect(shootLine(1, 3)).toEqual([10, 0, 0]);
  });

  it('貫通2なら2体まで当たる', () => {
    expect(shootLine(2, 3)).toEqual([10, 10, 0]);
  });

  it('貫通無限なら全員に当たり、同じ敵には1回だけ当たる', () => {
    expect(shootLine(Infinity, 5)).toEqual([10, 10, 10, 10, 10]);
  });

  it('同じ更新で複数の敵に重なったら、貫通可能数の分だけ当たる', () => {
    const rules = testRules({ move: { pierce: 2, cooldownSeconds: 100, power: 10, size: 30 } });
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 150 });
    // 発射位置に3体重ねて置く（押し合いで少しずれても全員が弾の範囲に入る）
    for (let k = 0; k < 3; k++) sim.world.enemies.add(k + 1, 0, 20, 0, 1000, 0, 10);
    sim.step([]);
    const e = sim.world.enemies;
    const damaged = Array.from(e.hp.subarray(0, e.count)).filter((hp) => hp < 1000).length;
    expect(damaged).toBe(2);
  });
});
