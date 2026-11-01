import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import { SHAPE_BOX, SHAPE_LINE } from './entities/projectiles';
import { Simulation } from './simulation';
import { hurtPlayer } from './systems/health';

/** ホウエンの技の作り直し（4）はがね（作者の指摘 2026年11月1日。07 の155章） */
function setup(move: string) {
  const rules = buildSimRules('hoenn');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const m = moveIndexOf(rules, move);
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, moves: [{ move: m, level: 1 }] });
  p.facingX = 1;
  p.facingY = 0;
  const pr = sim.world.projectiles;
  const find = (pred: (i: number) => boolean): number[] => [...Array(pr.count).keys()].filter(pred);
  return { rules, sim, p, m, pr, find };
}

describe('はがね', () => {
  it('メタルクロー・アイアンヘッド は前の長方形。アイアンヘッド は踏み込みが大きい', () => {
    const c = setup('metal-claw');
    c.sim.step([]);
    expect(c.find((i) => c.pr.move[i] === c.m && c.pr.shape[i] === SHAPE_BOX)).toHaveLength(1);
    const h = setup('iron-head');
    expect(h.rules.moves[h.m]!.body?.lungeDistance).toBe(36);
    h.sim.step([]);
    expect(h.find((i) => h.pr.move[i] === h.m && h.pr.shape[i] === SHAPE_BOX)).toHaveLength(1);
  });
  it('コメットパンチ は一番近い敵へ飛び、当たると 3 倍の大きさで弾ける', () => {
    const t = setup('meteor-mash');
    const def = t.rules.moves[t.m]!;
    expect(def.pattern).toBe('nearest');
    expect(def.effects[0]!.explode?.sizeMultiplier).toBe(3);
    t.sim.world.enemies.add(1, 0, 60, 0, 1e6, 0, 10);
    t.sim.step([]);
    expect(t.find((i) => t.pr.move[i] === t.m)).toHaveLength(1);
    for (let k = 0; k < 6; k++) t.sim.step([]);
    expect(t.find((i) => t.pr.move[i] === t.m && t.pr.stage[i] === 1)).toHaveLength(1);
  });
  it('メタルバースト は鋼の輪をまとい、受けたダメージの 2.5 倍を返す', () => {
    const t = setup('metal-burst');
    t.sim.step([]);
    const hp0 = t.p.hp;
    hurtPlayer(t.sim.world, t.p, 40);
    const taken = hp0 - t.p.hp;
    t.sim.step([]);
    const rings = t.find((i) => t.pr.move[i] === t.m && t.pr.stage[i] === 1 && t.pr.band[i]! > 0);
    expect(rings).toHaveLength(1);
    expect(t.pr.damage[rings[0]!]).toBeCloseTo(taken * 2.5, 3);
  });
  it('てっていこうせん は 0.35 秒ためてから太い線を出す', () => {
    const t = setup('steel-beam');
    expect(t.rules.moves[t.m]!.windupSeconds).toBe(0.35);
    t.sim.world.enemies.add(1, 0, 200, 0, 1e6, 0, 10);
    t.sim.step([]);
    expect(t.find((i) => t.pr.move[i] === t.m)).toHaveLength(0);
    for (let k = 0; k < Math.round(0.35 * 30) + 2; k++) t.sim.step([]);
    const beams = t.find((i) => t.pr.move[i] === t.m && t.pr.shape[i] === SHAPE_LINE);
    expect(beams).toHaveLength(1);
    expect(t.pr.radius[beams[0]!]).toBe(22);
  });
});
