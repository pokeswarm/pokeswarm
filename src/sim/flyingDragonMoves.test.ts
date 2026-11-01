import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import { MOTION_BOOMERANG, SHAPE_LINE, SHAPE_SECTOR } from './entities/projectiles';
import { Simulation } from './simulation';

/** ホウエンの技の作り直し（2）ひこう・ドラゴン（作者の指摘 2026年11月1日。07 の153章） */
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

describe('ひこう', () => {
  it('エアカッター は前へ吹く扇、つばさでうつ は往復のなぎ払い（ジョウトの技）、つばめがえし はまっすぐ飛ぶ 1 枚の刃', () => {
    const g = setup('air-cutter');
    g.sim.step([]);
    expect(g.find((i) => g.pr.move[i] === g.m && g.pr.shape[i] === SHAPE_SECTOR)).toHaveLength(1);
    const w = setup('wing-attack');
    w.sim.step([]);
    expect(w.find((i) => w.pr.move[i] === w.m && w.pr.shape[i] === SHAPE_SECTOR)).toHaveLength(1);
    const a = setup('aerial-ace');
    a.sim.step([]);
    const blades = a.find((i) => a.pr.move[i] === a.m);
    expect(blades).toHaveLength(1);
    expect(a.pr.vx[blades[0]!]).toBeGreaterThan(0);
  });
  it('ブレイブバード は前へ飛んで戻る残像（boomerang）。戻るまで次を出さず、HP を少し使う', () => {
    const t = setup('brave-bird');
    const def = t.rules.moves[t.m]!;
    expect(def.pattern).toBe('boomerang');
    expect(def.waitForEnd).toBe(true);
    expect(def.hpCost?.pct).toBe(4);
    t.sim.step([]);
    const birds = t.find((i) => t.pr.move[i] === t.m);
    expect(birds).toHaveLength(1);
    expect(t.pr.motion[birds[0]!]).toBe(MOTION_BOOMERANG);
  });
});

describe('ドラゴン', () => {
  it('りゅうのいぶき は扇、ドラゴンクロー は片道のなぎ払い、りゅうのはどう は線', () => {
    const b = setup('dragon-breath');
    b.sim.step([]);
    expect(b.find((i) => b.pr.move[i] === b.m && b.pr.shape[i] === SHAPE_SECTOR)).toHaveLength(1);
    const c = setup('dragon-claw');
    expect(c.rules.moves[c.m]!.pattern).toBe('sweep');
    expect(c.rules.moves[c.m]!.sweepOnce).toBe(true);
    c.sim.step([]);
    expect(c.find((i) => c.pr.move[i] === c.m && c.pr.shape[i] === SHAPE_SECTOR)).toHaveLength(1);
    const p = setup('dragon-pulse');
    p.sim.world.enemies.add(1, 0, 150, 0, 1e6, 0, 10);
    p.sim.step([]);
    expect(p.find((i) => p.pr.move[i] === p.m && p.pr.shape[i] === SHAPE_LINE)).toHaveLength(1);
  });
  it('たつまき はゆっくり前へ進み、0.3 秒ごとに周りを巻き込む。げきりん は周り全部へ乱れ打つ', () => {
    const t = setup('twister');
    const def = t.rules.moves[t.m]!;
    expect(def.pattern).toBe('facing');
    expect(def.effects[0]!.explode?.pull).toBe(180);
    t.sim.step([]);
    const tw = t.find((i) => t.pr.move[i] === t.m);
    expect(tw).toHaveLength(1);
    expect(Math.hypot(t.pr.vx[tw[0]!]!, t.pr.vy[tw[0]!]!)).toBeCloseTo(90, 0);
    const o = setup('outrage');
    expect(o.rules.moves[o.m]!.levels[0]!.arcDegrees).toBe(360);
    expect(o.rules.moves[o.m]!.barrageWidth).toBeUndefined();
  });
});
