import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import { Simulation } from './simulation';

/** ホウエンの技の作り直し（1）じめん・いわ（作者の指摘 2026年11月1日。07 の152章） */
function setup(move: string, seed = 1) {
  const rules = buildSimRules('hoenn');
  const sim = new Simulation({ tickRate: 30, seed, rules });
  const m = moveIndexOf(rules, move);
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, moves: [{ move: m, level: 1 }] });
  p.facingX = 1;
  p.facingY = 0;
  const pr = sim.world.projectiles;
  const find = (pred: (i: number) => boolean): number[] => [...Array(pr.count).keys()].filter(pred);
  return { rules, sim, p, m, pr, find };
}

describe('マグニチュード', () => {
  it('自分から広がる波で、使うたびに強さ（4〜10）を引いて威力と届く距離が変わる', () => {
    const got = new Set<number>();
    for (let seed = 1; seed <= 6; seed++) {
      const t = setup('magnitude-hoenn', seed);
      const def = t.rules.moves[t.m]!;
      expect(def.pattern).toBe('nova');
      expect(def.magnitude).toEqual({ min: 4, max: 10 });
      t.sim.step([]);
      const ring = t.find((i) => t.pr.move[i] === t.m);
      expect(ring).toHaveLength(1);
      got.add(Math.round(t.pr.growth[ring[0]!]! * 10));
    }
    expect(got.size).toBeGreaterThan(1);
  });
});

describe('いわなだれ', () => {
  it('向いている方向の扇（100°）の中に、空から大岩が 5 つ降る（置いてから 0.5 秒待つ）', () => {
    const t = setup('rock-slide-hoenn');
    const def = t.rules.moves[t.m]!;
    expect(def.scatterArc).toBe(100);
    t.sim.step([]);
    const rocks = t.find((i) => t.pr.move[i] === t.m);
    expect(rocks).toHaveLength(5);
    for (const i of rocks) {
      const a = Math.atan2(t.pr.y[i]!, t.pr.x[i]!);
      expect(Math.abs(a)).toBeLessThanOrEqual((50 * Math.PI) / 180 + 0.01);
      expect(t.pr.stage[i]).toBe(3);
    }
  });
});

describe('すなじごく・だいちのちから', () => {
  it('すなじごくは一番近い敵の所に砂の渦を置き、0.35 秒ごとに引き寄せる爆発を起こす', () => {
    const t = setup('sand-tomb');
    const def = t.rules.moves[t.m]!;
    expect(def.pattern).toBe('ground');
    expect(def.effects[0]!.explode?.pull).toBe(260);
    t.sim.world.enemies.add(1, 0, 120, 0, 1e6, 0, 10);
    t.sim.step([]);
    const pits = t.find((i) => t.pr.move[i] === t.m && t.pr.stage[i] === 0);
    expect(pits).toHaveLength(2);
    expect(Math.hypot(t.pr.x[pits[0]!]! - 120, t.pr.y[pits[0]!]!)).toBeLessThan(1);
  });
  it('だいちのちからは敵の足元に順に柱を出す（strike の sequential）', () => {
    const t = setup('earth-power');
    const def = t.rules.moves[t.m]!;
    expect(def.pattern).toBe('strike');
    expect(def.sequential).toBe(true);
    for (let k = 0; k < 5; k++) t.sim.world.enemies.add(k + 1, 0, 60 + k * 30, 0, 1e6, 0, 10);
    t.sim.step([]);
    expect(t.find((i) => t.pr.move[i] === t.m)).toHaveLength(1);
    for (let k = 0; k < 4; k++) t.sim.step([]);
    expect(t.find((i) => t.pr.move[i] === t.m).length).toBeGreaterThanOrEqual(2);
  });
});
