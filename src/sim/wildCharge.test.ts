import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { makeOffers, recomputeModifiers } from './systems/leveling';

/** 07 の326章: ワイルドボルト（カントー・ジョウト）を、歩いている間に稲妻の形に折れて走る技に作り直した */
function setup(line = 'pikachu', form = 'pikachu') {
  const rules = buildSimRules('kanto');
  const sim = new Simulation({ tickRate: 30, seed: 5, rules });
  const lo = playableLoadout(rules, line);
  const p = sim.addPlayer({
    id: sim.world.localPlayerId, x: 0, y: 0, radius: 12, moveSpeed: 180, types: lo.types, moveTypes: lo.moveTypes, fixedMoves: lo.fixedMoves, line: lo.line,
    species: rules.species.findIndex((s) => s.key === form), moves: [],
  });
  const pm = (k: string, level = 8) => ({ move: moveIndexOf(rules, k), level, cooldown: 0, burstLeft: 0, burstTimer: 0 });
  const item = (k: string): number => rules.items.findIndex((x) => x.key === k);
  return { rules, sim, w: sim.world, p, pm, item };
}

describe('ワイルドボルト（07 の326章）', () => {
  it('止まっている間は出ない', () => {
    const t = setup();
    t.p.moves = [t.pm('wild-charge')];
    recomputeModifiers(t.w, t.p);
    for (let k = 0; k < 90; k++) {
      t.sim.step([]);
      expect(t.p.dashTicks ?? 0).toBe(0);
    }
    expect(t.p.x).toBe(0);
  });

  it('歩くと、敵がいなくても、押している方へ左右に折れながら走る', () => {
    const t = setup();
    t.p.moves = [t.pm('wild-charge')];
    recomputeModifiers(t.w, t.p);
    t.p.inputX = 1;
    const ys: number[] = [];
    let started = false;
    for (let k = 0; k < 20; k++) {
      t.sim.step([]);
      if (t.p.dashTicks) started = true;
      if (started) ys.push(t.p.y);
      if (started && !t.p.dashTicks) break;
    }
    expect(started).toBe(true);
    // 横へのずれが、増える → 減る → 増える（またはその逆）に 2 回以上向きを変える
    const steps = ys.slice(1).map((y, i) => Math.sign(y - ys[i]!)).filter((s) => s !== 0);
    const turns = steps.slice(1).filter((s, i) => s !== steps[i]).length;
    expect(turns).toBeGreaterThanOrEqual(2);
  });

  it('速くなっても、走っている間に前へ進む速さは歩く速さの 1.5 倍より遅くならない', () => {
    for (const fast of [false, true]) {
      const t = setup();
      t.p.moves = [t.pm('wild-charge')];
      t.p.baseMoveSpeed = fast ? 600 : 180;
      recomputeModifiers(t.w, t.p);
      t.p.inputX = 1;
      let x0: number | undefined;
      let ticks = 0;
      for (let k = 0; k < 30; k++) {
        t.sim.step([]);
        if (t.p.dashTicks !== undefined && t.p.dashTicks > 0 && x0 === undefined) x0 = t.p.x;
        else if (x0 !== undefined) {
          ticks++;
          if (!t.p.dashTicks) break;
        }
      }
      const forward = (t.p.x - x0!) / (ticks * t.w.dt);
      expect(forward).toBeGreaterThanOrEqual(t.p.moveSpeed * 1.5 - 1e-6);
    }
  });

  it('走っている間だけ無敵（07 の327章）', () => {
    const t = setup();
    t.p.moves = [t.pm('wild-charge')];
    recomputeModifiers(t.w, t.p);
    t.p.inputX = 1;
    let ran = false;
    for (let k = 0; k < 20; k++) {
      t.sim.step([]);
      if (t.p.dashTicks) {
        ran = true;
        expect(t.p.invincibleTicks).toBeGreaterThan(0);
      }
      if (ran && !t.p.dashTicks) break;
    }
    expect(ran).toBe(true);
    // 走り終わったら、すぐに無敵が切れる（長く残さない）
    t.sim.step([]);
    t.sim.step([]);
    expect(t.p.invincibleTicks).toBe(0);
  });

  it('でんこうせっか ＋ じしゃく → ワイルドボルト はサンダースだけ', () => {
    for (const [form, ok] of [['jolteon', true], ['eevee', false]] as const) {
      const t = setup('eevee', form);
      t.p.moves = [t.pm('quick-attack')];
      t.p.items = [{ item: t.item('magnet'), level: 1 }];
      recomputeModifiers(t.w, t.p);
      const offers = makeOffers(t.w, t.p);
      expect(offers.some((o) => o.kind === 'derive' && o.to === moveIndexOf(t.rules, 'wild-charge'))).toBe(ok);
    }
  });
});
