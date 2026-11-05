import { describe, expect, it } from 'vitest';
import { buildSimRules } from '../data/simRules';
import { Simulation } from './simulation';
import { startLegendary } from './systems/stage';

/** ルギアの固定マップ（07 の203章）: マップへ移る・壁の中で動く・技が壁までで止まる・吸い込み・飛んでいく */
function setup(): { sim: Simulation; step: (seconds: number) => void; moveIdx: (id: string) => number } {
  const rules = buildSimRules('johto');
  const sim = new Simulation({ tickRate: 30, seed: 7, rules });
  sim.addPlayer({ id: 1, x: 500, y: 500, radius: 12, moveSpeed: 180 });
  const kind = rules.enemies.kinds.findIndex((k) => k.id === 'legend-lugia');
  startLegendary(sim.world, kind);
  return {
    sim,
    step: (seconds) => {
      for (let t = 0; t < seconds * 30; t++) sim.step([]);
    },
    moveIdx: (id) => rules.stage.moves.findIndex((m) => m.id === id),
  };
}

describe('ルギアの固定マップ（07 の203章）', () => {
  it('伝説戦が始まると、プレイヤーはマップの中へ移り、ルギアは奥に出る', () => {
    const { sim, step } = setup();
    const a = sim.world.arena!;
    expect(a).not.toBeNull();
    const p = sim.world.players[0]!;
    expect(Math.abs(p.x - a.x)).toBeLessThan(a.halfWidth);
    expect(Math.abs(p.y - a.y)).toBeLessThan(a.halfHeight);
    step(3.2);
    expect(sim.world.enemies.count).toBe(1);
    expect(sim.world.enemies.x[0]).toBeCloseTo(a.x);
    expect(sim.world.enemies.y[0]!).toBeLessThan(a.y);
  });

  it('プレイヤーは壁の外へ出られない', () => {
    const { sim, step } = setup();
    const a = sim.world.arena!;
    const p = sim.world.players[0]!;
    p.inputX = 1;
    p.inputY = 1;
    step(15);
    expect(p.x).toBeLessThanOrEqual(a.x + a.halfWidth);
    expect(p.y).toBeLessThanOrEqual(a.y + a.halfHeight);
  });

  it('直線の技は壁までで止まる', () => {
    const { sim, step } = setup();
    step(3.2);
    const a = sim.world.arena!;
    const hz = sim.world.hazards;
    hz.length = 0;
    const boss = sim.world.bosses[0]!;
    boss.moves = [sim.world.rules.stage.moves.findIndex((m) => m.id === 'lugia-aeroblast-full')];
    boss.next = 0;
    boss.cooldown = 1;
    step(0.2);
    const beam = hz.find((h) => h.shape === 'line')!;
    expect(beam).toBeTruthy();
    expect(beam.y + beam.length).toBeCloseTo(a.y + a.halfHeight);
  });

  it('大技の予告の間はルギアの方へ引き寄せられ、歩けば逃げられる', () => {
    const { sim, step, moveIdx } = setup();
    step(3.2);
    const boss = sim.world.bosses[0]!;
    boss.moves = [moveIdx('lugia-aeroblast-full')];
    boss.next = 0;
    boss.cooldown = 1;
    const p = sim.world.players[0]!;
    const by = sim.world.enemies.y[0]!;
    const before = p.y - by;
    step(1);
    expect(p.y - by).toBeLessThan(before);
    // 真下へ歩くと、引かれる力より速いので遠ざかる
    const mid = p.y - by;
    p.inputY = 1;
    step(1);
    expect(p.y - by).toBeGreaterThan(mid);
  });

  it('たつまきは壁で跳ね返り、マップの外へ出ない', () => {
    const { sim, step, moveIdx } = setup();
    step(3.2);
    const a = sim.world.arena!;
    const boss = sim.world.bosses[0]!;
    boss.moves = [moveIdx('lugia-twister')];
    boss.next = 0;
    boss.cooldown = 1;
    step(1);
    expect(sim.world.hazards.length).toBeGreaterThan(0);
    for (let t = 0; t < 8 * 30; t++) {
      sim.step([]);
      for (const h of sim.world.hazards) {
        if (h.activeTicks === undefined || sim.world.rules.stage.moves[h.move]?.id !== 'lugia-twister') continue;
        expect(Math.abs(h.x - a.x)).toBeLessThanOrEqual(a.halfWidth + 10);
        expect(Math.abs(h.y - a.y)).toBeLessThanOrEqual(a.halfHeight + 10);
      }
    }
  });

  it('疲れると降りてきて、起きると奥へ戻る', () => {
    const { sim, step, moveIdx } = setup();
    step(3.2);
    const a = sim.world.arena!;
    const boss = sim.world.bosses[0]!;
    const home = sim.world.enemies.y[0]!;
    boss.moves = [moveIdx('lugia-tired'), moveIdx('lugia-rise')];
    boss.next = 0;
    boss.cooldown = 1;
    step(4);
    expect(sim.world.enemies.y[0]!).toBeCloseTo(a.y - 40, 0);
    step(5);
    expect(sim.world.enemies.y[0]!).toBeCloseTo(home, 0);
  });

  it('技の流れを通しで回すと、大技の後に降りてきて、また奥へ戻る', () => {
    const { sim } = setup();
    const p = sim.world.players[0]!;
    p.maxHp = p.hp = 1e9;
    const a = sim.world.arena!;
    const used = new Set<string>();
    let lowest = -Infinity;
    for (let t = 0; t < 60 * 30; t++) {
      sim.step([]);
      for (const h of sim.world.hazards) used.add(sim.world.rules.stage.moves[h.move]?.id ?? '');
      if (sim.world.enemies.count > 0) lowest = Math.max(lowest, sim.world.enemies.y[0]!);
    }
    for (const id of ['lugia-twister', 'lugia-aeroblast-aim', 'lugia-aeroblast-full', 'lugia-tired', 'lugia-rise']) expect(used).toContain(id);
    expect(lowest).toBeCloseTo(a.y - 40, 0);
  });
});
