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

describe('技ごとの急所と一撃', () => {
  it('技の急所の確率が 100% なら、持ち物が無くても急所（1.5倍）になる', () => {
    const rules = testRules({ move: { pierce: 1, cooldownSeconds: 100, power: 10, critChancePct: 100 } });
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    sim.addPlayer({ id: 1, x: 100, y: 0, radius: 12, moveSpeed: 150 });
    sim.world.enemies.add(1, 0, 300, 0, 1000, 0, 10);
    for (let t = 0; t < 40; t++) sim.step([]);
    expect(1000 - sim.world.enemies.hp[0]!).toBe(10 * rules.combat.critMultiplier);
  });

  it('一撃: 雑魚は倒れ、中ボスには効かない', () => {
    const rules = testRules({
      move: { pierce: 2, cooldownSeconds: 100, power: 10, instakillChance: 1 },
      extraKinds: [{ id: 'mid', rank: 'midboss', hp: 1000, moveSpeed: 0, radius: 10, contactDamage: 0, xp: 0, types: [0] }],
    });
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    sim.addPlayer({ id: 1, x: 100, y: 0, radius: 12, moveSpeed: 150 });
    sim.world.enemies.add(1, 0, 300, 0, 1000, 0, 10);
    sim.world.enemies.add(2, 1, 340, 0, 1000, 0, 10);
    for (let t = 0; t < 40; t++) sim.step([]);
    const e = sim.world.enemies;
    expect(Array.from(e.id.subarray(0, e.count))).toEqual([2]);
    expect(e.hp[0]).toBe(990);
    expect(sim.world.stats.kills).toBe(1);
  });
});

describe('扇形の当たり判定（自分の体で攻撃する技）', () => {
  it('向いている方向の扇の中の敵にだけ当たり、後ろには当たらない', () => {
    const rules = testRules({ move: { range: 20, size: 40, arcDegrees: 90, cooldownSeconds: 100, power: 10, pierce: Infinity, durationSeconds: 0.2 } });
    rules.moves[0] = { ...rules.moves[0]!, pattern: 'melee', body: { lungeDistance: 10, afterimages: 0 } };
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 150 });
    p.facingX = 1;
    p.facingY = 0;
    sim.world.enemies.add(1, 0, 40, 0, 1000, 0, 10); // 前
    sim.world.enemies.add(2, 0, -40, 0, 1000, 0, 10); // 後ろ
    sim.world.enemies.add(3, 0, 0, 55, 1000, 0, 10); // 真横（扇の外）
    sim.step([]);
    expect(sim.world.events.some((e) => e.type === 'bodyAttack')).toBe(true);
    for (let t = 0; t < 5; t++) sim.step([]);
    const e = sim.world.enemies;
    const hpOf = (id: number): number => e.hp[Array.from(e.id.subarray(0, e.count)).indexOf(id)]!;
    expect(hpOf(1)).toBe(990);
    expect(hpOf(2)).toBe(1000);
    expect(hpOf(3)).toBe(1000);
  });
});

describe('画面じゅうの敵へ・たたりめ・ゆびをふる', () => {
  it('screen: 範囲の中の近い敵 count 体の足元に同時に当たり判定を置く', () => {
    const rules = testRules({ move: { range: 600, count: 2, size: 10, cooldownSeconds: 100, power: 10, pierce: Infinity, durationSeconds: 0.2 } });
    rules.moves[0] = { ...rules.moves[0]!, pattern: 'screen' };
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 150 });
    sim.world.enemies.add(1, 0, 100, 0, 1000, 0, 10);
    sim.world.enemies.add(2, 0, -200, 0, 1000, 0, 10);
    sim.world.enemies.add(3, 0, 0, 400, 1000, 0, 10); // 3番目に近いので当たらない
    for (let t = 0; t < 3; t++) sim.step([]);
    const e = sim.world.enemies;
    const hpOf = (id: number): number => e.hp[Array.from(e.id.subarray(0, e.count)).indexOf(id)]!;
    expect([hpOf(1), hpOf(2), hpOf(3)]).toEqual([990, 990, 1000]);
  });

  it('たたりめ: 状態異常の敵へのダメージが上がる', () => {
    const rules = testRules({ move: { range: 600, count: 2, size: 10, cooldownSeconds: 100, power: 10, pierce: Infinity, durationSeconds: 0.2, statusBonusPct: 100 } });
    rules.moves[0] = { ...rules.moves[0]!, pattern: 'screen' };
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 150 });
    sim.world.enemies.add(1, 0, 100, 0, 1000, 0, 10);
    sim.world.enemies.add(2, 0, -100, 0, 1000, 0, 10);
    sim.world.enemies.statusTicks[1 * sim.world.enemies.statusCount] = 300; // 2体目だけ状態異常
    for (let t = 0; t < 3; t++) sim.step([]);
    const e = sim.world.enemies;
    const hpOf = (id: number): number => e.hp[Array.from(e.id.subarray(0, e.count)).indexOf(id)]!;
    expect(hpOf(1)).toBe(990);
    expect(hpOf(2)).toBeLessThan(990);
  });

  it('ゆびをふる: ほかの技のどれかを出す', () => {
    const rules = testRules({ move: { range: 600, size: 30, cooldownSeconds: 100, power: 10, pierce: Infinity, durationSeconds: 0.5 } });
    rules.moves[0] = { ...rules.moves[0]!, pattern: 'nova' };
    rules.moves.push({ ...rules.moves[0]!, key: 'metronome', pattern: 'metronome' });
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 150, moves: [{ move: 1, level: 1 }] });
    sim.step([]);
    expect(sim.world.projectiles.count).toBeGreaterThan(0);
    expect(sim.world.projectiles.move[0]).toBe(0);
  });
});
