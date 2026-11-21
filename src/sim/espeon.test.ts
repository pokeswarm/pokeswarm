import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { boostCountOf } from './systems/attack';
import { answerEvolution } from './systems/evolution';
import { canLearnNewMove, makeOffers, recomputeModifiers } from './systems/leveling';

/** 07 の331章: エーフィの作り直し（みらいよち・めいそう・★アシストパワー） */
function setup(form = 'espeon') {
  const rules = buildSimRules('johto');
  const sim = new Simulation({ tickRate: 30, seed: 3, rules });
  for (const wave of sim.world.waves) Object.assign(wave, { spawnPerSecond: 0, minimum: 0 });
  const lo = playableLoadout(rules, 'eevee');
  const p = sim.addPlayer({
    id: sim.world.localPlayerId, x: 0, y: 0, radius: 12, moveSpeed: 180, types: lo.types, moveTypes: lo.moveTypes, fixedMoves: lo.fixedMoves, line: lo.line,
    species: rules.species.findIndex((s) => s.key === form), moves: [],
  });
  const item = (k: string): number => rules.items.findIndex((x) => x.key === k);
  const pm = (k: string, level = 8) => ({ move: moveIndexOf(rules, k), level, cooldown: 0, burstLeft: 0, burstTimer: 0 });
  return { rules, sim, w: sim.world, p, item, pm };
}

describe('エーフィ（07 の331章）', () => {
  it('進化すると のしかかり が みらいよち になり、めいそう・あさのひざし を覚えられる', () => {
    const t = setup('eevee');
    t.p.moves = [t.pm('body-slam', 3)];
    // 進化の聞き方は 81章（babies.test.ts）。ここでは姿を直接変えて、変わり方だけを見る
    t.p.evolveAsk = t.rules.species.findIndex((x) => x.key === 'espeon');
    answerEvolution(t.w, t.p, true);
    expect(t.p.moves.map((m) => t.rules.moves[m.move]!.key)).toEqual(['future-sight', 'psychic']);
    expect(canLearnNewMove(t.w, t.p, moveIndexOf(t.rules, 'calm-mind'))).toBe(true);
    expect(canLearnNewMove(t.w, t.p, moveIndexOf(t.rules, 'morning-sun'))).toBe(true);
  });

  it('★アシストパワー は強化 1 つにつき念の玉が 2 つ増える（めいそう の重ね。07 の332章）', () => {
    const shots = (stacks: number): number => {
      const t = setup();
      t.p.moves = [t.pm('stored-power')];
      recomputeModifiers(t.w, t.p);
      if (stacks) t.p.calm = { stacks, untilTick: 1e9 };
      expect(boostCountOf(t.w, t.p)).toBe(stacks);
      t.w.enemies.add(1, 0, 200, 0, 1e9, 0, 10);
      const m = t.p.moves[0]!.move;
      let n = 0;
      for (let k = 0; k < 20; k++) {
        const before = new Set([...Array(t.w.projectiles.count).keys()].map((i) => t.w.projectiles.serial[i]));
        t.sim.step([]);
        for (let i = 0; i < t.w.projectiles.count; i++) if (t.w.projectiles.move[i] === m && !before.has(t.w.projectiles.serial[i])) n++;
        if (t.p.moves[0]!.cooldown > 0.5 && t.p.moves[0]!.burstLeft === 0) break;
      }
      return n;
    };
    const base = shots(0);
    expect(base).toBeGreaterThanOrEqual(1);
    expect(base).toBe(4 + 2);
    expect(shots(3) - base).toBe(6);
  });

  it('★アシストパワー を撃つと 1 秒だけ少し速くなる（体は回さない。舞いはスプライトの Hop。07 の333章）。自分の加速は玉の数に数えない', () => {
    const t = setup();
    t.p.moves = [t.pm('stored-power')];
    recomputeModifiers(t.w, t.p);
    const before = t.p.moveSpeed;
    t.w.enemies.add(1, 0, 200, 0, 1e9, 0, 10);
    let used = false;
    let spun = false;
    for (let k = 0; k < 3 && !used; k++) {
      t.sim.step([]);
      used = t.w.events.some((ev) => ev.type === 'moveUsed');
      spun ||= t.w.events.some((ev) => ev.type === 'bodyAttack');
    }
    expect(used).toBe(true);
    expect(spun).toBe(false);
    expect(t.p.moveSpeed).toBeCloseTo(before * 1.25);
    expect(boostCountOf(t.w, t.p, t.p.moves[0]!.move)).toBe(0);
  });

  it('★アシストパワー が自分の みらいよち の印に当たると、その場で 1.5 倍の爆発', () => {
    const t = setup();
    const sp = t.pm('stored-power');
    t.p.moves = [sp];
    recomputeModifiers(t.w, t.p);
    const fs = moveIndexOf(t.rules, 'future-sight');
    const e = t.w.enemies;
    e.add(1, 0, 120, 0, 1e9, 0, 10);
    e.markTicks[0] = 60;
    e.markDamage[0] = 100;
    e.markSize[0] = 40;
    e.markMove[0] = fs;
    e.markBy[0] = t.p.id;
    let blasted = false;
    for (let k = 0; k < 40 && !blasted; k++) {
      t.sim.step([]);
      for (let i = 0; i < t.w.projectiles.count; i++) if (t.w.projectiles.move[i] === fs && t.w.projectiles.stage[i] === 1) blasted = true;
    }
    expect(blasted).toBe(true);
    // 60 回の更新を待たずに弾けた（印は消えている）
    expect(e.markTicks[0]).toBe(0);
  });

  it('サイコキネシス ＋ スペシャルアップ → ★アシストパワー はエーフィだけ', () => {
    for (const [form, ok] of [['espeon', true], ['umbreon', false]] as const) {
      const t = setup(form);
      t.p.moves = [t.pm('psychic')];
      t.p.items = [{ item: t.item('x-sp-atk'), level: 1 }];
      recomputeModifiers(t.w, t.p);
      const offers = makeOffers(t.w, t.p);
      expect(offers.some((o) => o.kind === 'derive' && o.to === moveIndexOf(t.rules, 'stored-power'))).toBe(ok);
    }
  });
});
