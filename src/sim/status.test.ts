import { describe, expect, it } from 'vitest';
import type { SimRules } from './rules';
import { Simulation } from './simulation';
import { testRules } from './testRules';

const BURN = 0;
const FREEZE = 1;

function makeSim(attack: Partial<SimRules['attack']> = {}): Simulation {
  const sim = new Simulation({ tickRate: 30, seed: 3, rules: testRules({ attack }) });
  sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 150 });
  return sim;
}

describe('ノックバック', () => {
  it('当たった敵が攻撃の向きへ押し返される', () => {
    const sim = makeSim({ knockback: { speed: 300, durationSeconds: 0.2 }, cooldownSeconds: 100, damage: 1 });
    const e = sim.world.enemies;
    e.add(1, 0, 200, 0, 1000, 0, 10);
    for (let t = 0; t < 30; t++) sim.step([]);
    // 300/秒 × 0.2秒 = 60 押し返される（動かない敵なので、そのまま離れる）
    expect(e.x[0]).toBeCloseTo(260, 0);
  });
});

describe('状態異常', () => {
  it('やけど: 時間とともに HP が減り、付けたプレイヤーの撃破になる', () => {
    const sim = makeSim({ range: 1 });
    const e = sim.world.enemies;
    e.add(1, 0, 300, 0, 3, 0, 10);
    e.applyStatus(0, BURN, 90, 1);
    const kills: number[] = [];
    for (let t = 0; t < 30; t++) {
      sim.step([]);
      for (const ev of sim.world.events) if (ev.type === 'enemyKilled') kills.push(ev.by);
    }
    // 6/秒なので 0.5 秒で HP 3 がなくなる
    expect(kills).toEqual([1]);
  });

  it('こおり: 止まっている間は近づいてこない。解けたら動く', () => {
    const sim = makeSim({ range: 1 });
    const e = sim.world.enemies;
    e.add(1, 0, 300, 0, 20, 60, 10);
    e.applyStatus(0, FREEZE, 15, 1);
    for (let t = 0; t < 15; t++) sim.step([]);
    expect(e.x[0]).toBe(300);
    for (let t = 0; t < 15; t++) sim.step([]);
    expect(e.x[0]).toBeLessThan(300);
  });

  it('同じ状態異常を重ねても強くならず、残り時間の長いほうになる', () => {
    const sim = makeSim({ range: 1 });
    const e = sim.world.enemies;
    e.add(1, 0, 300, 0, 20, 0, 10);
    e.applyStatus(0, BURN, 30, 1);
    e.applyStatus(0, BURN, 10, 1);
    expect(e.statusTicks[BURN]).toBe(30);
    e.applyStatus(0, BURN, 60, 1);
    expect(e.statusTicks[BURN]).toBe(60);
  });

  it('ぼうぎょダウン: 受けるダメージが増える', () => {
    const sim = makeSim({ cooldownSeconds: 100, damage: 5, status: { id: 'defenseDown', chance: 1, durationSeconds: 5 } });
    const e = sim.world.enemies;
    e.add(1, 0, 200, 0, 100, 0, 10);
    for (let t = 0; t < 30; t++) sim.step([]);
    // 命中と同時にぼうぎょダウンが付き、ダメージが2倍になる
    expect(e.hp[0]).toBe(90);
  });
});
