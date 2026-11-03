import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import { Simulation } from './simulation';

/** ジョウトの新しい技（07 の169章） */
function setup(move: string, level = 1) {
  const rules = buildSimRules('johto');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const m = moveIndexOf(rules, move);
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, moves: [{ move: m, level }] });
  p.facingX = 1;
  p.facingY = 0;
  const pr = sim.world.projectiles;
  const mine = (): number[] => [...Array(pr.count).keys()].filter((i) => pr.move[i] === m);
  const e = sim.world.enemies;
  return { rules, sim, p, m, pr, mine, e };
}

describe('ジョウトの新しい技', () => {
  it('だいもんじ: 火の玉が消えた所に、画面に対して「大」の字の 5 本の炎が残る', () => {
    const t = setup('fire-blast');
    t.e.add(1, 0, 120, 0, 1e6, 0, 10);
    const seen = new Set<number>();
    for (let k = 0; k < 60; k++) {
      t.sim.step([]);
      for (const i of t.mine()) if (t.pr.stage[i] !== 0) seen.add(Math.round((Math.atan2(t.pr.dirY[i]!, t.pr.dirX[i]!) * 180) / Math.PI));
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([-90, 0, 60, 120, 180]);
  });

  it('ムーンフォース・マジカルシャイン・こおりのキバ・どくどくのキバ・せいなるほのお: 前の敵に当たり、真後ろの敵には当たらない', () => {
    for (const move of ['moonblast', 'dazzling-gleam', 'ice-fang', 'poison-fang', 'sacred-fire']) {
      const t = setup(move);
      t.e.add(1, 0, 90, 0, 1e6, 0, 10);
      t.e.add(2, 0, -90, 0, 1e6, 0, 10);
      for (let k = 0; k < 45; k++) t.sim.step([]);
      expect(t.e.hp[0]!, `${move} の前`).toBeLessThan(1e6);
      expect(t.e.hp[1]!, `${move} の後ろ`).toBe(1e6);
    }
  });

  it('どくどくのキバ: かんだ所に毒のたまりが残る', () => {
    const t = setup('poison-fang');
    t.e.add(1, 0, 60, 0, 1e6, 0, 10);
    let pool = false;
    for (let k = 0; k < 30; k++) {
      t.sim.step([]);
      if (t.mine().some((i) => t.pr.stage[i] !== 0)) pool = true;
    }
    expect(pool).toBe(true);
  });

  it('りゅうせいぐん: 流星は少し遅れて落ちる（出した直後はまだ当たらない）', () => {
    const t = setup('draco-meteor');
    const wait = t.rules.moves[t.m]!.scatterDelaySeconds!;
    t.sim.step([]);
    const placed = t.mine().length;
    expect(placed).toBeGreaterThan(0);
    // 待っている間の流星は当たり判定ではない
    for (let k = 0; k < Math.floor(wait * 30) - 2; k++) t.sim.step([]);
    expect(t.mine().every((i) => t.pr.stage[i] === 3)).toBe(true);
  });
});
