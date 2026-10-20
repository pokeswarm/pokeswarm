import { describe, expect, it } from 'vitest';
import type { SimRules } from './rules';
import { Simulation } from './simulation';
import { testRules } from './testRules';

function rules(potion = 0, magnet = 0, maxLevel = 100): SimRules {
  const r = testRules({
    move: { range: 1 },
    leveling: { maxLevel },
    extraKinds: [{ id: 'mid', rank: 'midboss', hp: 100, moveSpeed: 0, radius: 20, contactDamage: 0, xp: 0, drop: 'rare-candy', types: [0] }],
  });
  r.pickups.items.potion.dropChance = potion;
  r.pickups.items.magnet.dropChance = magnet;
  return r;
}

function kill(sim: Simulation, kind: number, x: number): void {
  const id = sim.world.nextEnemyId++;
  sim.world.enemies.add(id, kind, x, 0, 10, 0, 10);
  sim.step([{ type: 'damageEnemy', id, amount: 999, by: 1, kbx: 0, kby: 0, kbTicks: 0, status: -1, statusTicks: 0 }]);
}

describe('マップに落ちる道具', () => {
  it('きずぐすり: 雑魚がまれに落とし、拾うと最大HPの30%回復する', () => {
    const sim = new Simulation({ tickRate: 30, seed: 1, rules: rules(1) });
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 200 });
    kill(sim, 0, 200);
    expect(sim.world.items).toEqual([expect.objectContaining({ kind: 'potion' })]);
    p.hp = 10;
    p.x = 200;
    sim.step([]);
    expect(sim.world.items).toHaveLength(0);
    expect(p.hp).toBe(40);
  });

  it('マグネット: 拾うと、遠くの玉もすべて一気に吸い寄せる', () => {
    // レベルアップの選択で止まらないよう、レベルは上がらないようにする
    const sim = new Simulation({ tickRate: 30, seed: 1, rules: rules(0, 1, 1) });
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, pickupRange: 0 });
    for (let k = 0; k < 5; k++) sim.world.gems.add(100 + k, 1500 + k * 100, 800, 1, 6);
    kill(sim, 0, 300);
    p.x = 300;
    sim.step([]);
    expect(sim.world.items).toHaveLength(0);
    for (let t = 0; t < 90; t++) sim.step([]);
    // 落とした玉（1）と遠くの玉（5）をすべて拾った
    expect(sim.world.gems.count).toBe(0);
    expect(sim.world.xp).toBe(6);
  });

  it('ふしぎなアメ: 中ボスが経験値の代わりに落とし、拾って少し待つと確定でレベルが上がる', () => {
    const sim = new Simulation({ tickRate: 30, seed: 1, rules: rules() });
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0 });
    kill(sim, 1, 200);
    expect(sim.world.gems.count).toBe(0);
    expect(sim.world.items).toEqual([expect.objectContaining({ kind: 'rare-candy' })]);
    p.x = 200;
    sim.step([]);
    const collected = sim.world.events.find((e) => e.type === 'itemCollected');
    expect(collected).toMatchObject({ kind: 'rare-candy', levels: 3 });
    // 抽選の演出（1秒）の間はまだ上がらない
    expect(sim.world.level).toBe(1);
    for (let t = 0; t < 30 && !sim.world.levelUp; t++) sim.step([]);
    expect(sim.world.level).toBe(4);
    // 選択は3回続けて出る
    expect(sim.world.levelUp).not.toBeNull();
    expect(sim.world.pendingLevelUps).toBe(3);
  });
});
