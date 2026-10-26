import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import { SHAPE_SECTOR } from './entities/projectiles';
import { Simulation } from './simulation';

/**
 * かえんほうしゃ・バブルこうせん（作者の指摘 2026年10月27日）: 数が増えると扇の角度が広がる（2本・3本にならない）。
 * かえんほうしゃは前の扇の絵で、出ている間は向いている方向を追う
 */
function fire(move: string, level: number, amountBonus = 0) {
  const rules = buildSimRules();
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const m = moveIndexOf(rules, move);
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, moves: [{ move: m, level }] });
  p.mods.amountBonus = amountBonus;
  sim.step([]);
  const pr = sim.world.projectiles;
  const cones = [...Array(pr.count).keys()].filter((i) => pr.move[i] === m && pr.shape[i] === SHAPE_SECTOR);
  return { sim, p, m, cones, halfOf: (i: number) => pr.length[i]! };
}

describe('かえんほうしゃ・バブルこうせん', () => {
  it('数が増えると、扇は1つのまま角度が広がる', () => {
    const lv1 = fire('flamethrower', 1);
    const lv8 = fire('flamethrower', 8);
    expect(lv1.cones).toHaveLength(1);
    expect(lv8.cones).toHaveLength(1);
    expect(lv8.halfOf(lv8.cones[0]!)).toBeGreaterThan(lv1.halfOf(lv1.cones[0]!));
    const bubble = fire('bubble-beam', 1, 2);
    const bubble0 = fire('bubble-beam', 1);
    expect(bubble.cones).toHaveLength(1);
    expect(bubble.halfOf(bubble.cones[0]!)).toBeGreaterThan(bubble0.halfOf(bubble0.cones[0]!));
  });

  it('かえんほうしゃは、出ている間に向いている方向を追う', () => {
    const { sim, p, cones } = fire('flamethrower', 1);
    const pr = sim.world.projectiles;
    const i = cones[0]!;
    const before = Math.atan2(pr.dirY[i]!, pr.dirX[i]!);
    p.facingX = -1;
    p.facingY = 0;
    for (let t = 0; t < 10; t++) sim.step([]);
    const k = [...Array(pr.count).keys()].find((j) => pr.shape[j] === SHAPE_SECTOR)!;
    const after = Math.atan2(pr.dirY[k]!, pr.dirX[k]!);
    expect(Math.abs(after - before)).toBeGreaterThan(0.5);
  });
});
