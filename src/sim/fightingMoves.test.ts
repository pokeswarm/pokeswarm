import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import { MOTION_FOLLOW, SHAPE_BOX } from './entities/projectiles';
import { Simulation } from './simulation';

/** かくとうの技の作り直し（作者の指摘 2026年11月1日。07 の151章） */
function setup(move: string, level = 1) {
  const rules = buildSimRules('hoenn');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const m = moveIndexOf(rules, move);
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, moves: [{ move: m, level }] });
  p.facingX = 1;
  p.facingY = 0;
  const pr = sim.world.projectiles;
  const find = (pred: (i: number) => boolean): number[] => [...Array(pr.count).keys()].filter(pred);
  return { rules, sim, p, m, pr, find };
}

describe('にどげり', () => {
  it('前の形のまま: 向いている方へ短い蹴りを 2 連で飛ばす（作者 2026年11月1日「前の 2 連撃でよかった」）', () => {
    const t = setup('double-kick');
    const def = t.rules.moves[t.m]!;
    expect(def.pattern).toBe('barrage');
    expect(def.levels[0]!.count).toBe(2);
    expect(def.frontBox).toBeUndefined();
    t.sim.world.enemies.add(1, 0, 30, 0, 1e6, 0, 10);
    const hp0 = t.sim.world.enemies.hp[0]!;
    let first = 0;
    for (let k = 0; k < 3 && first === 0; k++) {
      t.sim.step([]);
      first = hp0 - t.sim.world.enemies.hp[0]!;
    }
    expect(first).toBeGreaterThan(0);
    for (let k = 0; k < 15; k++) t.sim.step([]);
    const lost = hp0 - t.sim.world.enemies.hp[0]!;
    expect(lost).toBeCloseTo(first * 2, 0);
  });
});

describe('きあいパンチ・ばかぢから', () => {
  it('きあいパンチは前の長方形（拳の先の気が範囲）。ためている間はマッハパンチが出る仕組みは変えない', () => {
    const t = setup('focus-punch');
    const def = t.rules.moves[t.m]!;
    expect(def.pattern).toBe('melee');
    expect(def.frontBox?.halfWidth).toBe(0.4);
    expect(def.chargeMove?.move).toBeDefined();
  });

  it('ばかぢからは 0.3 秒溜めてから、前の短く広い長方形の叩きつけと、自分から広がる衝撃波', () => {
    const t = setup('superpower');
    const def = t.rules.moves[t.m]!;
    expect(def.windupSeconds).toBe(0.3);
    expect(def.frontBox?.halfWidth).toBe(0.4);
    t.sim.step([{ type: 'spawnEnemy', id: 1, kind: 0, x: 60, y: 0 }]);
    for (let k = 0; k < Math.round(0.3 * 30) + 2; k++) t.sim.step([]);
    const boxes = t.find((i) => t.pr.move[i] === t.m && t.pr.shape[i] === SHAPE_BOX && t.pr.stage[i] === 0);
    expect(boxes).toHaveLength(1);
    // 自分から広がる輪（効き方の wave。自分に付いてくる）
    const rings = t.find((i) => t.pr.move[i] === t.m && t.pr.stage[i] === 1 && t.pr.band[i]! > 0);
    expect(rings).toHaveLength(1);
    expect(t.pr.motion[rings[0]!]).toBe(MOTION_FOLLOW);
  });
});

describe('インファイト', () => {
  it('突き出す蹴りは前の長方形になった', () => {
    const rules = buildSimRules('hoenn');
    const kick = rules.moves[moveIndexOf(rules, 'close-combat-kick')]!;
    expect(kick.pattern).toBe('melee');
    expect(kick.frontBox).toBeDefined();
  });
});
