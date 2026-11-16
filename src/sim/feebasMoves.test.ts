import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import derivations from '../../data/game/derivations.json';
import { MOTION_STREAM, SHAPE_LINE } from './entities/projectiles';
import { Simulation } from './simulation';

/** ヒンバスの系統の見直し: ★ハイドロポンプ（ホウエンの版。07 の275章） */
function setup(level = 1) {
  const rules = buildSimRules('hoenn');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const m = moveIndexOf(rules, 'hydro-pump-hoenn');
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, moves: [{ move: m, level }] });
  p.facingX = 1;
  p.facingY = 0;
  const pr = sim.world.projectiles;
  const find = (pred: (i: number) => boolean): number[] => [...Array(pr.count).keys()].filter(pred);
  return { rules, sim, p, m, pr, find };
}

describe('ハイドロポンプ（ホウエン）', () => {
  it('溜めてから、向いている方へ太い流れを出す', () => {
    const t = setup();
    t.sim.step([]);
    expect(t.find((i) => t.pr.move[i] === t.m)).toHaveLength(0);
    for (let k = 0; k < 16; k++) t.sim.step([]);
    const jet = t.find((i) => t.pr.move[i] === t.m && t.pr.stage[i] === 0);
    expect(jet).toHaveLength(1);
    expect(t.pr.motion[jet[0]!]).toBe(MOTION_STREAM);
    expect(t.pr.shape[jet[0]!]).toBe(SHAPE_LINE);
    expect(t.pr.dirX[jet[0]!]).toBeCloseTo(1);
  });

  it('流れは雑魚を奥へ押し、最初に当たった敵の所で水圧のしぶきが弾ける', () => {
    const t = setup();
    const e = t.sim.world.enemies;
    e.add(1, 0, 120, 0, 1e6, 0, 10);
    for (let k = 0; k < 30; k++) t.sim.step([]);
    expect(e.x[e.id.indexOf(1)]!).toBeGreaterThan(130);
    expect(t.find((i) => t.pr.move[i] === t.m && t.pr.stage[i] === 1).length).toBeGreaterThan(0);
  });

  it('ミロカロスの みずのはどう から、たつまき Lv8 と あめ で進化する（みずでっぽう と取り合わない）', () => {
    const d = [...derivations.derivations, ...derivations.unique].find((x) => x.to === 'hydro-pump-hoenn') as { from: string; needsMoves?: { move: string }[]; weather?: string[] } | undefined;
    expect(d?.from).toBe('water-pulse');
    expect(d?.needsMoves?.[0]?.move).toBe('twister');
    expect(d?.weather).toEqual(['rain']);
  });
});
