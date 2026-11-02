import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import { Simulation } from './simulation';

/** 周りの敵をすぐ倒しきって放置できる技の調整（作者の決定 2026年11月3日。07 の164章） */
function setup(move: string, level = 1) {
  const rules = buildSimRules('hoenn');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const m = moveIndexOf(rules, move);
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, moves: [{ move: m, level }] });
  p.facingX = 1;
  p.facingY = 0;
  const pr = sim.world.projectiles;
  const mine = (): number[] => [...Array(pr.count).keys()].filter((i) => pr.move[i] === m);
  return { rules, sim, p, m, pr, mine };
}

describe('10まんボルト は向いている方へ跳ぶ', () => {
  it('後ろの敵だけなら撃たない。前に敵がいれば前へ跳ぶ', () => {
    const t = setup('thunderbolt');
    t.sim.world.enemies.add(1, 0, -120, 0, 1e6, 0, 10);
    for (let k = 0; k < 10; k++) t.sim.step([]);
    expect(t.mine().filter((i) => t.pr.stage[i] === 0).length).toBe(0);
    t.sim.world.enemies.add(2, 0, 150, 20, 1e6, 0, 10);
    let forward = false;
    for (let k = 0; k < 60; k++) {
      t.sim.step([]);
      if (t.mine().some((i) => t.pr.stage[i] === 0 && t.pr.dirX[i]! > 0.5)) forward = true;
      expect(t.mine().some((i) => t.pr.stage[i] === 0 && t.pr.dirX[i]! < -0.5)).toBe(false);
    }
    expect(forward).toBe(true);
  });
});

describe('はなびらのまい の渦は向いている方へ進む', () => {
  it('花びらの真ん中が、出したときに向いていた方へ動いていく', () => {
    const t = setup('petal-dance');
    t.sim.world.enemies.add(1, 0, 400, 0, 1e6, 0, 10);
    let seen = false;
    for (let k = 0; k < 40; k++) {
      t.sim.step([]);
      // いちばん古い渦の花びらだけ（次に出した渦と混ぜない）
      const all = t.mine();
      const oldest = Math.min(...all.map((i) => t.pr.life[i]!));
      const ps = all.filter((i) => Math.abs(t.pr.life[i]! - oldest) < 1e-6);
      if (ps.length < 4) continue;
      const cx = ps.reduce((s, i) => s + t.pr.x[i]!, 0) / ps.length;
      const age = t.pr.maxLife[ps[0]!]! - t.pr.life[ps[0]!]!;
      if (age > 0.5) {
        expect(cx).toBeGreaterThan(t.rules.moves[t.m]!.spiralDrift! * age * 0.8);
        seen = true;
      }
    }
    expect(seen).toBe(true);
  });
});

describe('バークアウト は前へ吠える', () => {
  it('前の敵には当たり、真後ろの敵には当たらない', () => {
    const t = setup('snarl');
    const e = t.sim.world.enemies;
    e.add(1, 0, 100, 0, 1e6, 0, 10);
    e.add(2, 0, -100, 0, 1e6, 0, 10);
    for (let k = 0; k < 30; k++) t.sim.step([]);
    expect(e.hp[0]!).toBeLessThan(1e6);
    expect(e.hp[1]!).toBe(1e6);
  });
});
