import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import { Simulation } from './simulation';
import { boxOf, knockbackFatigue } from './systems/attack';

/** 自分中心の押し出し技の放置対策（作者の決定 2026年11月3日。07 の162章） */
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

describe('C: 押し出しの踏ん張り', () => {
  it('押し出された敵は、少しの間 次の押し出しが弱い（時間が過ぎると戻る）', () => {
    const t = setup('surf');
    const w = t.sim.world;
    w.enemies.add(1, 0, 50, 0, 1e6, 0, 10);
    const fx = { kbx: 100, kby: 0, kbTicks: 5, status: -1, statusTicks: 0 };
    expect(knockbackFatigue(w, 0, fx).kbx).toBe(100);
    const f = w.rules.combat.knockbackFatigue;
    expect(knockbackFatigue(w, 0, fx).kbx).toBeCloseTo(100 * f.multiplier);
    for (let k = 0; k < Math.round(f.seconds * 30) + 1; k++) t.sim.step([]);
    expect(knockbackFatigue(w, 0, fx).kbx).toBe(100);
  });
});

describe('A: なみのり・だくりゅう は波に乗る', () => {
  it('止まっていると波が小さい（動くと戻る）', () => {
    for (const key of ['surf', 'muddy-water']) {
      const t = setup(key);
      t.p.inputX = 1;
      t.sim.step([]);
      const wave = t.find((i) => t.pr.move[i] === t.m && t.pr.stage[i] === 0)[0]!;
      const moving = boxOf(t.sim.world, wave);
      t.p.inputX = 0;
      const idle = boxOf(t.sim.world, wave);
      const k = t.rules.moves[t.m]!.idleScale!.size;
      expect(idle.half).toBeCloseTo(moving.half * k);
      expect(idle.to).toBeCloseTo(moving.to * k);
    }
  });
  it('動いているときは、自分の後ろの敵も向いている方向へ押す。止まっていると押さない', () => {
    const t = setup('surf');
    const w = t.sim.world;
    t.p.inputX = 1;
    w.enemies.add(1, 0, -40, 0, 1e6, 0, 10);
    t.sim.step([]);
    t.sim.step([]);
    expect(w.enemies.kbVx[0]!).toBeGreaterThan(0);
    const u = setup('surf');
    u.p.inputX = 0;
    u.sim.world.enemies.add(1, 0, 20, 0, 1e6, 0, 10);
    u.sim.step([]);
    u.sim.step([]);
    expect(u.sim.world.enemies.kbTicks[0]!).toBe(0);
  });
});

describe('B: サイコキネシス は向いている方向へ投げ飛ばす', () => {
  it('動いているとき、前の扇の敵を向いている方へ飛ばし、飛ばされた敵から前へ衝撃が出る（後ろは前の扇の外。07 の176章）', () => {
    const t = setup('psychic');
    const w = t.sim.world;
    expect(t.rules.moves[t.m]!.knockbackAlongFacing).toBe(true);
    // 動いているときだけ投げ飛ばす（止まっていると念が弱まり、押し出さない）
    t.p.inputX = 1;
    w.enemies.add(1, 0, 90, 30, 1e6, 0, 10);
    let pushed = false;
    let flung = false;
    for (let k = 0; k < 20; k++) {
      t.sim.step([]);
      if (w.enemies.kbTicks[0]! > 0 && w.enemies.kbVx[0]! > 0) pushed = true;
      if (t.find((i) => t.pr.move[i] === t.m && t.pr.stage[i] === 1 && t.pr.vx[i]! > 100).length > 0) flung = true;
    }
    expect(pushed).toBe(true);
    expect(flung).toBe(true);
  });
});

describe('B: サイコキネシス は止まっていると押し出さない', () => {
  it('止まっていると、敵は押し出されない', () => {
    const t = setup('psychic');
    const w = t.sim.world;
    t.p.inputX = 0;
    w.enemies.add(1, 0, 60, 0, 1e6, 0, 10);
    let pushedOut = false;
    for (let k = 0; k < 20; k++) {
      t.sim.step([]);
      if (w.enemies.kbTicks[0]! > 0 && w.enemies.kbVx[0]! > 0) pushedOut = true;
    }
    expect(pushedOut).toBe(false);
  });
});
