import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import { Simulation } from './simulation';

/** キモリ・ナックラーの系統の見直し（07 の278章）: 自分から円が出る固有技を作り直す */
function setup(key: string) {
  const rules = buildSimRules('hoenn');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const m = moveIndexOf(rules, key);
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, moves: [{ move: m, level: 1 }] });
  p.facingX = 1;
  p.facingY = 0;
  const pr = sim.world.projectiles;
  const mine = (): number[] => [...Array(pr.count).keys()].filter((i) => pr.move[i] === m && pr.stage[i] === 0);
  return { rules, sim, p, m, pr, mine };
}

describe('リーフブレード（ジュカイン）', () => {
  it('溜めてから、向いている方へ遠くまで一閃する。後ろの敵には当たらない', () => {
    const t = setup('leaf-blade');
    const e = t.sim.world.enemies;
    e.add(1, 0, 500, 0, 1e6, 0, 10);
    e.add(2, 0, -150, 0, 1e6, 0, 10);
    const front = e.hp[e.id.indexOf(1)]!;
    const back = e.hp[e.id.indexOf(2)]!;
    for (let k = 0; k < 30; k++) t.sim.step([]);
    expect(e.hp[e.id.indexOf(1)]!).toBeLessThan(front);
    expect(e.hp[e.id.indexOf(2)]!).toBe(back);
    expect(t.rules.moves[t.m]!.pattern).toBe('beam');
  });
});

describe('じしん（フライゴン）', () => {
  it('震源はボス（いなければ敵が一番多い所）。輪はそこに残り、自分には付いていかない', () => {
    const t = setup('earthquake-hoenn');
    const e = t.sim.world.enemies;
    e.add(1, 0, 200, 50, 1e6, 0, 10);
    e.add(2, 0, 210, 60, 1e6, 0, 10);
    e.add(3, 0, -100, 0, 1e6, 0, 10);
    let ring = -1;
    for (let k = 0; k < 10 && ring === -1; k++) {
      t.sim.step([]);
      ring = t.mine()[0] ?? -1;
    }
    expect(ring).not.toBe(-1);
    // 2 体が集まっている所が震源
    expect(Math.hypot(t.pr.x[ring]! - 200, t.pr.y[ring]! - 50)).toBeLessThan(20);
  });

  it('届く範囲に敵がいなければ出さない', () => {
    const t = setup('earthquake-hoenn');
    for (let k = 0; k < 60; k++) t.sim.step([]);
    expect(t.mine()).toHaveLength(0);
  });
});
