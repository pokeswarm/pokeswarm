import { describe, expect, it } from 'vitest';
import { resolveMoveLevels, typeMultiplier } from './moves';
import { Simulation } from './simulation';
import { testMove, testRules } from './testRules';

const M = { stab: 1.1, superEffective: 1.2, notVeryEffective: 0.8 };
const NORMAL = 0;
const FIRE = 1;
const GRASS = 2;
const WATER = 3;

describe('技のレベルごとの性能', () => {
  const def = {
    pattern: 'nearest' as const,
    effect: 'x',
    base: {
      power: 10, cooldownSeconds: 0.3, count: 1, intervalSeconds: 0, speed: 100, size: 5, range: 100, durationSeconds: 1,
      pierce: 'infinite' as const, hitIntervalSeconds: 0, knockback: 0, knockbackSeconds: 0, statusId: 'burn', statusChance: 0.9, statusSeconds: 1, spreadDegrees: 0, lifestealPct: 0, critChancePct: 0, instakillChance: 0,
    },
    levels: [{ power: 5 }, { count: 1, cooldownSeconds: -0.5 }, { statusChance: 0.5 }],
  };
  const levels = resolveMoveLevels(def, (id) => (id === 'burn' ? 7 : -1));

  it('レベル1の性能に増分を順に足し、最大レベルは増分の数 + 1', () => {
    expect(levels).toHaveLength(4);
    expect(levels.map((l) => l.power)).toEqual([10, 15, 15, 15]);
    expect(levels[2]!.count).toBe(2);
  });

  it('下限で止まる（クールダウンが 0 以下にならない）・確率は 1 まで', () => {
    expect(levels[2]!.cooldownSeconds).toBe(0.1);
    expect(levels[3]!.statusChance).toBe(1);
  });

  it('貫通無限は Infinity、状態異常は番号になる', () => {
    expect(levels[0]!.pierce).toBe(Infinity);
    expect(levels[0]!.status).toBe(7);
  });
});

describe('タイプ相性', () => {
  const { types } = testRules();
  it('ばつぐん ×1.2・いまひとつ ×0.8・タイプ一致 ×1.1', () => {
    expect(typeMultiplier(types, M, FIRE, [], [GRASS])).toBe(1.2);
    expect(typeMultiplier(types, M, FIRE, [], [WATER])).toBe(0.8);
    expect(typeMultiplier(types, M, FIRE, [FIRE], [NORMAL])).toBeCloseTo(1.1);
    expect(typeMultiplier(types, M, FIRE, [FIRE], [GRASS])).toBeCloseTo(1.32);
  });

  it('2タイプは掛け合わせて判定する（ばつぐん × いまひとつ = 等倍）', () => {
    expect(typeMultiplier(types, M, FIRE, [], [GRASS, WATER])).toBe(1);
    expect(typeMultiplier(types, M, WATER, [], [FIRE, FIRE])).toBe(1.2);
  });

  it('効果がない相性は、いまひとつと同じ ×0.8（倒せない敵を作らない）', () => {
    const noEffect = { names: ['a', 'b'], chart: [[0, 1], [1, 1]] };
    expect(typeMultiplier(noEffect, M, 0, [], [0])).toBe(0.8);
  });
});

/** プレイヤー (0,0) が右を向いている状態で、1つの技だけを持たせる */
function simWith(move: ReturnType<typeof testMove>, playerTypes: number[] = []): Simulation {
  const rules = testRules({ extraMoves: [move] });
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 150, types: playerTypes, moves: [{ move: 1, level: 1 }] });
  // 右を向かせてから止める
  sim.step([{ type: 'move', playerId: 1, dx: 1, dy: 0 }]);
  sim.step([{ type: 'move', playerId: 1, dx: 0, dy: 0 }]);
  return sim;
}

function damageTaken(sim: Simulation, id: number): number {
  const e = sim.world.enemies;
  for (let i = 0; i < e.count; i++) if (e.id[i] === id) return e.maxHp[i]! - e.hp[i]!;
  return NaN;
}

describe('技の出し方', () => {
  it('facing: 向いている方向へ飛ぶ（後ろの敵には当たらない）', () => {
    const sim = simWith(testMove('f', 'facing', { cooldownSeconds: 100, speed: 600, durationSeconds: 1 }));
    const px = sim.world.players[0]!.x;
    sim.world.enemies.add(1, 0, px + 200, 0, 100, 0, 10);
    sim.world.enemies.add(2, 0, px - 200, 0, 100, 0, 10);
    for (let t = 0; t < 30; t++) sim.step([]);
    expect(damageTaken(sim, 1)).toBe(10);
    expect(damageTaken(sim, 2)).toBe(0);
  });

  it('melee: 前に一瞬の当たり判定。count 2 で後ろにも当たる', () => {
    const one = simWith(testMove('m', 'melee', { cooldownSeconds: 100, size: 20, range: 30, durationSeconds: 0.1, pierce: Infinity }));
    const two = simWith(testMove('m', 'melee', { cooldownSeconds: 100, size: 20, range: 30, durationSeconds: 0.1, pierce: Infinity, count: 2 }));
    for (const sim of [one, two]) {
      const px = sim.world.players[0]!.x;
      sim.world.enemies.add(1, 0, px + 30, 0, 100, 0, 10);
      sim.world.enemies.add(2, 0, px - 30, 0, 100, 0, 10);
      for (let t = 0; t < 10; t++) sim.step([]);
    }
    expect([damageTaken(one, 1), damageTaken(one, 2)]).toEqual([10, 0]);
    expect([damageTaken(two, 1), damageTaken(two, 2)]).toEqual([10, 10]);
  });

  it('orbit: 周りを回り、当たり直しの間隔ごとに同じ敵へ何度も当たる', () => {
    const sim = simWith(
      testMove('o', 'orbit', { cooldownSeconds: 100, count: 4, size: 30, range: 50, speed: 0, durationSeconds: 2, pierce: Infinity, hitIntervalSeconds: 0.5 }),
    );
    const p = sim.world.players[0]!;
    // 回る当たり判定（角度 0）の位置に、動かない敵を置く
    sim.world.enemies.add(1, 0, p.x + 50, p.y, 1000, 0, 10);
    for (let t = 0; t < 60; t++) sim.step([]);
    // 2秒間、0.5秒ごとに当たる → 4回
    expect(damageTaken(sim, 1)).toBe(40);
  });

  it('nearest: count 発を間隔を空けて撃つ', () => {
    const sim = simWith(testMove('n', 'nearest', { cooldownSeconds: 100, count: 3, intervalSeconds: 0.1, speed: 600 }));
    const px = sim.world.players[0]!.x;
    sim.world.enemies.add(1, 0, px + 150, 0, 1000, 0, 10);
    for (let t = 0; t < 30; t++) sim.step([]);
    expect(damageTaken(sim, 1)).toBe(30);
  });

  it('タイプ相性とタイプ一致がダメージに掛かる', () => {
    const sim = simWith(testMove('fire', 'nearest', { cooldownSeconds: 100, speed: 600 }, FIRE), [FIRE]);
    sim.world.rules.enemies.kinds.push({ id: 'grass', hp: 100, moveSpeed: 0, radius: 10, contactDamage: 0, types: [GRASS] });
    const px = sim.world.players[0]!.x;
    sim.world.enemies.add(1, 1, px + 150, 0, 100, 0, 10);
    for (let t = 0; t < 30; t++) sim.step([]);
    expect(damageTaken(sim, 1)).toBeCloseTo(10 * 1.2 * 1.1);
  });
});

describe('技の出し方（区切り2で追加）', () => {
  it('beam: 一直線上の敵すべてに当たり、線の外の敵には当たらない', () => {
    const sim = simWith(testMove('b', 'beam', { cooldownSeconds: 100, size: 8, range: 400, durationSeconds: 0.2, pierce: Infinity }));
    const p = sim.world.players[0]!;
    sim.world.enemies.add(1, 0, p.x + 100, p.y, 100, 0, 10);
    sim.world.enemies.add(2, 0, p.x + 300, p.y, 100, 0, 10);
    sim.world.enemies.add(3, 0, p.x + 200, p.y + 80, 100, 0, 10);
    for (let t = 0; t < 10; t++) sim.step([]);
    expect([damageTaken(sim, 1), damageTaken(sim, 2), damageTaken(sim, 3)]).toEqual([10, 10, 0]);
  });

  it('boomerang: 行きと帰りで同じ敵に2回当たる', () => {
    const sim = simWith(
      testMove('r', 'boomerang', { cooldownSeconds: 100, speed: 400, size: 8, durationSeconds: 1.4, pierce: Infinity, hitIntervalSeconds: 0.3 }),
    );
    const p = sim.world.players[0]!;
    sim.world.enemies.add(1, 0, p.x + 80, p.y, 1000, 0, 10);
    for (let t = 0; t < 50; t++) sim.step([]);
    expect(damageTaken(sim, 1)).toBe(20);
  });

  it('nova: 広がる輪が、はじめは届かない距離の敵にも当たる', () => {
    const sim = simWith(testMove('n', 'nova', { cooldownSeconds: 100, size: 10, range: 150, durationSeconds: 0.5, pierce: Infinity }));
    const p = sim.world.players[0]!;
    sim.world.enemies.add(1, 0, p.x + 120, p.y, 100, 0, 10);
    sim.step([]);
    expect(damageTaken(sim, 1)).toBe(0);
    for (let t = 0; t < 20; t++) sim.step([]);
    expect(damageTaken(sim, 1)).toBe(10);
  });

  it('ground: 敵の位置に残り、当たり直しの間隔ごとに当たる', () => {
    // 敵がいないと前方に置くので、技を使う前に敵を置く
    const rules = testRules({
      extraMoves: [testMove('g', 'ground', { cooldownSeconds: 100, size: 20, range: 300, durationSeconds: 1.0, pierce: Infinity, hitIntervalSeconds: 0.25 })],
    });
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 150, moves: [{ move: 1, level: 1 }] });
    sim.world.enemies.add(1, 0, 200, 0, 1000, 0, 10);
    for (let t = 0; t < 40; t++) sim.step([]);
    expect(damageTaken(sim, 1)).toBe(40);
  });

  it('homing: 横にいる敵にも曲がって当たる', () => {
    const sim = simWith(testMove('h', 'homing', { cooldownSeconds: 100, speed: 300, durationSeconds: 2 }));
    const p = sim.world.players[0]!;
    sim.world.enemies.add(1, 0, p.x, p.y + 200, 100, 0, 10);
    for (let t = 0; t < 40; t++) sim.step([]);
    expect(damageTaken(sim, 1)).toBe(10);
  });

  it('ねむりはダメージを受けると治る（継続ダメージでは治らない）', () => {
    const r = testRules({ move: { cooldownSeconds: 100, power: 1 } });
    r.status.kinds.push({ id: 'sleep', damagePerSecond: 0, speedMultiplier: 0, damageTakenMultiplier: 1, breaksOnDamage: true, healsAttacker: false, color: '#000000' });
    const sim = new Simulation({ tickRate: 30, seed: 1, rules: r });
    sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 150 });
    const e = sim.world.enemies;
    e.add(1, 0, 150, 0, 100, 0, 10);
    const SLEEP = r.status.kinds.length - 1;
    e.applyStatus(0, SLEEP, 300, 1);
    for (let t = 0; t < 30; t++) sim.step([]);
    expect(e.hasStatus(0, SLEEP)).toBe(false);
  });
});
