import { describe, expect, it } from 'vitest';
import type { SimRules } from './rules';
import { Simulation } from './simulation';
import { testRules } from './testRules';

const BOSS_MOVE = { move: 'blizzard', effect: 'test', intervalSeconds: 1, telegraphSeconds: 0.5, radius: 50, damage: 30, count: 1, spread: 0 };

/** 番号1が中ボス、番号2がボス。中ボスは1秒、ボスは2秒で出る */
function stageRules(overrides: Partial<SimRules['stage']> = {}): SimRules {
  return testRules({
    move: { range: 1 },
    extraKinds: [
      { id: 'mid', rank: 'midboss', hp: 500, moveSpeed: 0, radius: 20, contactDamage: 0, xp: 50, types: [0] },
      { id: 'boss', rank: 'boss', hp: 1000, moveSpeed: 0, radius: 30, contactDamage: 0, xp: 0, types: [0] },
    ],
    stage: { durationSeconds: 2, midbosses: [{ atSeconds: 1, kind: 'mid' }], boss: { kind: 'boss', move: BOSS_MOVE }, ...overrides },
  });
}

function run(sim: Simulation, ticks: number): string[] {
  const types: string[] = [];
  for (let t = 0; t < ticks; t++) {
    sim.step([]);
    types.push(...sim.world.events.map((e) => e.type));
  }
  return types;
}

describe('中ボス・ボスの出現', () => {
  it('予定の時間に中ボス、ランの長さでボスが出る', () => {
    const sim = new Simulation({ tickRate: 30, seed: 1, rules: stageRules() });
    sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0 });
    run(sim, 30);
    expect(sim.world.enemies.count).toBe(0);
    expect(run(sim, 1)).toContain('bossAppeared');
    expect(sim.world.enemies.kind[0]).toBe(1);
    run(sim, 30);
    expect(sim.world.enemies.count).toBe(2);
    expect(sim.world.bosses).toHaveLength(1);
  });

  it('HP は参加人数に応じて上がる', () => {
    const sim = new Simulation({ tickRate: 30, seed: 1, rules: stageRules() });
    sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0 });
    sim.addPlayer({ id: 2, x: 0, y: 0, radius: 12, moveSpeed: 0 });
    run(sim, 31);
    // hpPerExtraPlayerPct 50 → 2人で 1.5倍
    expect(sim.world.enemies.hp[0]).toBe(750);
  });

  it('前の時間帯の種類でも、中ボスは離れすぎても消さない', () => {
    const rules = stageRules({ boss: null });
    rules.spawn.waves = [
      { startSeconds: 0, hpMultiplier: 1, damageMultiplier: 1, kinds: ['test'] },
      { startSeconds: 0.5, hpMultiplier: 1, damageMultiplier: 1, kinds: ['test'] },
    ];
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0 });
    run(sim, 31);
    p.x = 5000;
    expect(run(sim, 2)).not.toContain('enemyRetired');
    expect(sim.world.enemies.count).toBe(1);
  });

  it('中ボスはノックバックされず、こおりの時間が短い', () => {
    const sim = new Simulation({ tickRate: 30, seed: 1, rules: stageRules({ boss: null, midbosses: [] }) });
    sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0 });
    sim.world.enemies.add(1, 1, 100, 0, 500, 0, 20);
    sim.step([{ type: 'damageEnemy', id: 1, amount: 1, by: 1, kbx: 100, kby: 0, kbTicks: 10, status: 1, statusTicks: 40 }]);
    expect(sim.world.enemies.kbTicks[0]).toBe(0);
    // こおりは stopStatusMultiplier 0.25 で 40 → 10（この更新で1つ減る）
    expect(sim.world.enemies.statusTicks[0 * sim.world.statusKinds.length + 1]).toBe(9);
  });
});

describe('ボスの範囲技', () => {
  function bossSim() {
    const sim = new Simulation({ tickRate: 30, seed: 1, rules: stageRules({ midbosses: [], durationSeconds: 0 }) });
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 200 });
    return { sim, p };
  }

  it('足元に予告し、動かなければ当たる', () => {
    const { sim, p } = bossSim();
    const events = run(sim, 31);
    expect(events).toContain('hazardTelegraphed');
    expect(sim.world.hazards).toHaveLength(1);
    run(sim, 15);
    expect(p.hp).toBe(70);
  });

  it('予告の間に範囲の外へ出れば当たらない', () => {
    const { sim, p } = bossSim();
    run(sim, 31);
    sim.step([{ type: 'move', playerId: 1, dx: 1, dy: 0 }]);
    run(sim, 14);
    expect(p.x).toBeGreaterThan(62);
    expect(p.hp).toBe(100);
  });
});

describe('ランの終わり', () => {
  it('ボスを倒すとクリアになり、シミュレーションが止まる', () => {
    const sim = new Simulation({ tickRate: 30, seed: 1, rules: stageRules({ midbosses: [], durationSeconds: 0 }) });
    sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0 });
    sim.step([]);
    const id = sim.world.enemies.id[0]!;
    sim.step([{ type: 'damageEnemy', id, amount: 5000, by: 1, kbx: 0, kby: 0, kbTicks: 0, status: -1, statusTicks: 0 }]);
    expect(sim.world.events.map((e) => e.type)).toContain('runEnded');
    expect(sim.world.outcome).toBe('clear');
    const tick = sim.world.tick;
    run(sim, 10);
    expect(sim.world.tick).toBe(tick);
  });

  it('中ボスを倒してもクリアにならず、経験値を落とす', () => {
    const sim = new Simulation({ tickRate: 30, seed: 1, rules: stageRules({ boss: null, midbosses: [] }) });
    sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0 });
    sim.world.enemies.add(1, 1, 300, 0, 500, 0, 20);
    sim.step([{ type: 'damageEnemy', id: 1, amount: 5000, by: 1, kbx: 0, kby: 0, kbTicks: 0, status: -1, statusTicks: 0 }]);
    expect(sim.world.outcome).toBeNull();
    expect(sim.world.gems.value[0]).toBe(50);
  });

  it('全員が倒れると失敗', () => {
    const sim = new Simulation({ tickRate: 30, seed: 1, rules: stageRules({ boss: null, midbosses: [] }) });
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0 });
    sim.world.enemies.add(1, 0, 0, 0, 1000, 0, 10, 1000);
    sim.step([]);
    expect(p.down).toBe(true);
    expect(sim.world.outcome).toBe('fail');
  });

  it('雑魚の経験値に時間帯の倍率を掛ける', () => {
    const rules = stageRules({ boss: null, midbosses: [] });
    rules.spawn.waves = [{ startSeconds: 0, hpMultiplier: 1, damageMultiplier: 1, xpMultiplier: 3, kinds: ['test'] }];
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0 });
    sim.world.enemies.add(1, 0, 300, 0, 10, 0, 10);
    sim.step([{ type: 'damageEnemy', id: 1, amount: 50, by: 1, kbx: 0, kby: 0, kbTicks: 0, status: -1, statusTicks: 0 }]);
    expect(sim.world.gems.value[0]).toBe(3);
  });
});
