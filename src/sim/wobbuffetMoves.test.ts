import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import { MOTION_ATTACH } from './entities/projectiles';
import { Simulation } from './simulation';
import { hurtPlayer } from './systems/health';

/** ソーナノの系統の見直し: みちづれ・アンコール・しんぴのまもり（07 の272章） */
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

describe('みちづれ', () => {
  it('HP の一番高い敵に貼り付き、その敵と一緒に動く', () => {
    const t = setup('destiny-bond');
    const e = t.sim.world.enemies;
    e.add(1, 0, 100, 0, 50, 0, 10);
    e.add(2, 0, 200, 50, 1e6, 0, 30);
    t.sim.step([]);
    const link = t.find((i) => t.pr.move[i] === t.m && t.pr.stage[i] === 0);
    expect(link).toHaveLength(1);
    expect(t.pr.motion[link[0]!]).toBe(MOTION_ATTACH);
    expect(t.pr.target[link[0]!]).toBe(2 + 1);
    const big = e.id.indexOf(2);
    e.x[big] = 260;
    e.y[big] = 80;
    t.sim.step([]);
    expect(t.pr.x[link[0]!]).toBeCloseTo(e.x[big]!, 0);
    expect(t.pr.y[link[0]!]).toBeCloseTo(e.y[big]!, 0);
  });

  it('結んでいる間に受けた割合（最大 HP の %）× 技の威力を、自分の所ではなく結んだ敵の所で返す', () => {
    const t = setup('destiny-bond');
    t.sim.world.enemies.add(2, 0, 300, 0, 1e6, 0, 30);
    t.sim.step([]);
    const link = t.find((i) => t.pr.move[i] === t.m && t.pr.stage[i] === 0)[0]!;
    const power = t.pr.damage[link]!;
    const hp0 = t.p.hp;
    hurtPlayer(t.sim.world, t.p, 40);
    const taken = hp0 - t.p.hp;
    expect(taken).toBeGreaterThan(0);
    t.sim.step([]);
    const back = t.find((i) => t.pr.move[i] === t.m && t.pr.stage[i] === 1);
    expect(back.length).toBeGreaterThan(0);
    const mult = t.rules.moves[t.m]!.effects.find((fx) => fx.trigger === 'hurt')!.explode!.powerMultiplier;
    expect(t.pr.damage[back[0]!]).toBeCloseTo((taken / t.p.maxHp) * 100 * power * mult, 1);
    expect(Math.abs(t.pr.x[back[0]!]! - 300)).toBeLessThan(5);
  });

  it('結んだ敵が倒れたら糸は切れ、その場で弾ける（end の効き方）', () => {
    const t = setup('destiny-bond');
    const e = t.sim.world.enemies;
    e.add(2, 0, 150, 0, 1e6, 0, 30);
    t.sim.step([]);
    e.hp[e.id.indexOf(2)] = 0;
    t.sim.step([]);
    t.sim.step([]);
    expect(t.find((i) => t.pr.move[i] === t.m && t.pr.stage[i] === 0)).toHaveLength(0);
    expect(t.find((i) => t.pr.move[i] === t.m && t.pr.stage[i] === 1).length).toBeGreaterThan(0);
  });
});

describe('アンコール', () => {
  it('前の扇に当たった敵は、呼んだプレイヤーを追う（ほかのプレイヤーの方が近くても）', () => {
    const t = setup('encore');
    const w = t.sim.world;
    const q = t.sim.addPlayer({ id: 2, x: 200, y: 0, radius: 12, moveSpeed: 100, moves: [] });
    // 敵は 2 人の間で、2 人目のほうが近い。1 人目の前の扇の中
    w.enemies.add(5, 0, 110, 0, 1e6, 60, 10);
    t.sim.step([]);
    const encored = w.statusKinds.findIndex((k) => k.drawnToAttacker);
    const i = w.enemies.id.indexOf(5);
    expect(w.enemies.hasStatus(i, encored)).toBe(true);
    const x0 = w.enemies.x[i]!;
    for (let k = 0; k < 5; k++) t.sim.step([]);
    // 呼んだ 1 人目（左）へ寄る
    expect(w.enemies.x[i]!).toBeLessThan(x0);
    expect(q.id).toBe(2);
  });
});

describe('しんぴのまもり', () => {
  it('自分に付いて動く膜を張る（回復はしない）', () => {
    const t = setup('safeguard');
    const w = t.sim.world;
    t.sim.step([]);
    const z = w.healZones.find((h) => h.guard);
    expect(z).toBeDefined();
    expect(z!.pct).toBe(0);
    t.p.x = 120;
    t.sim.step([]);
    expect(z!.x).toBe(120);
  });
});
