import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { hurtPlayer } from './systems/health';

/** ノーマルの技の調整（作者の依頼 2026年10月31日。07 の141章） */
function setup(move: string, region = 'hoenn') {
  const rules = buildSimRules(region);
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const lo = playableLoadout(rules, 'makuhita');
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, types: lo.types, moveTypes: lo.moveTypes, moves: [{ ...lo.moves[0]!, move: moveIndexOf(rules, move), level: 1 }], line: lo.line, species: lo.species });
  return { rules, sim, p };
}

describe('からげんき', () => {
  it('ダメージを受けてから5秒の間だけ、物理の技の威力が上がる（受け直すと時間が戻る）', () => {
    const { sim, p } = setup('facade');
    sim.step([]);
    expect(p.mods.physicalPowerPct).toBe(0);
    hurtPlayer(sim.world, p, 1);
    expect(p.mods.physicalPowerPct).toBe(20);
    for (let t = 0; t < 4 * 30; t++) sim.step([]);
    expect(p.mods.physicalPowerPct).toBe(20);
    for (let t = 0; t < 2 * 30; t++) sim.step([]);
    expect(p.mods.physicalPowerPct).toBe(0);
  });
});

describe('ねこだまし', () => {
  it('左右の両端から1つずつ払い、最後は2つとも正面を向く', () => {
    const { sim, p } = setup('fake-out');
    p.facingX = 1;
    p.facingY = 0;
    sim.step([]);
    const pr = sim.world.projectiles;
    expect(pr.count).toBe(2);
    const startY = [pr.dirY[0]!, pr.dirY[1]!].sort((a, b) => a - b);
    expect(startY[0]).toBeLessThan(-0.5);
    expect(startY[1]).toBeGreaterThan(0.5);
    while (pr.count === 2 && pr.life[0]! > sim.world.dt * 1.01) sim.step([]);
    expect(Math.abs(pr.dirY[0]!)).toBeLessThan(0.25);
    expect(Math.abs(pr.dirY[1]!)).toBeLessThan(0.25);
  });
});

describe('ハイパーボイス', () => {
  it('出ている間、扇の向きが決まった速さで回る', () => {
    const { sim, p } = setup('hyper-voice', 'kanto');
    p.facingX = 1;
    p.facingY = 0;
    sim.step([]);
    const pr = sim.world.projectiles;
    const a0 = Math.atan2(pr.dirY[0]!, pr.dirX[0]!);
    for (let t = 0; t < 15; t++) sim.step([]);
    const a1 = Math.atan2(pr.dirY[0]!, pr.dirX[0]!);
    let d = a1 - a0;
    while (d < 0) d += Math.PI * 2;
    // 140 度/秒 × 0.5 秒
    expect((d * 180) / Math.PI).toBeCloseTo(70, -1);
  });
});
