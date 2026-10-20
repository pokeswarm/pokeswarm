import { describe, expect, it } from 'vitest';
import type { InputCommand } from './commands';
import { FixedStepClock } from './fixedStep';
import { Simulation } from './simulation';
import { testRules } from './testRules';

function makeSim(): Simulation {
  const sim = new Simulation({ tickRate: 30, seed: 1, rules: testRules() });
  sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 150 });
  return sim;
}

describe('Simulation', () => {
  it('入力コマンドで移動し、コマンドが変わるまで同じ入力が続く', () => {
    const sim = makeSim();
    sim.step([{ type: 'move', playerId: 1, dx: 1, dy: 0 }]);
    for (let i = 0; i < 29; i++) sim.step([]);
    const p = sim.world.players[0]!;
    expect(sim.world.tick).toBe(30);
    expect(p.x).toBeCloseTo(150);
    expect(p.y).toBe(0);
  });

  it('斜め移動は速さが同じになる', () => {
    const sim = makeSim();
    sim.step([{ type: 'move', playerId: 1, dx: 1, dy: 1 }]);
    const p = sim.world.players[0]!;
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(5);
  });

  it('同じコマンド列なら同じ結果になる（再現性）', () => {
    const script: InputCommand[][] = [];
    for (let i = 0; i < 300; i++) {
      script.push(i % 17 === 0 ? [{ type: 'move', playerId: 1, dx: ((i % 3) - 1) as -1 | 0 | 1, dy: ((i % 5) % 3 - 1) as -1 | 0 | 1 }] : []);
    }
    const a = makeSim();
    const b = makeSim();
    for (const cmds of script) {
      a.step(cmds);
      b.step(cmds);
    }
    expect(b.world.players).toEqual(a.world.players);
    expect(b.world.rng.getState()).toEqual(a.world.rng.getState());
  });
});

describe('FixedStepClock', () => {
  it('経過時間に応じた回数と補間率を返す', () => {
    const clock = new FixedStepClock(30, 5);
    expect(clock.advance(10)).toBe(0);
    expect(clock.alpha).toBeCloseTo(0.3);
    expect(clock.advance(30)).toBe(1);
    expect(clock.alpha).toBeCloseTo(0.2);
  });

  it('大きく遅れたら上限回数で打ち切る', () => {
    const clock = new FixedStepClock(30, 5);
    expect(clock.advance(5000)).toBe(5);
    expect(clock.alpha).toBe(0);
  });
});
