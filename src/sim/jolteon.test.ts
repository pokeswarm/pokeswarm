import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { moveStatsOf, scaledMoveStats } from './systems/attack';
import { makeOffers, recomputeModifiers } from './systems/leveling';

/** 07 の325章: サンダースの作り直し（ミサイルばり・エレキボール・こうそくいどう） */
function setup(form = 'jolteon') {
  const rules = buildSimRules('kanto');
  const sim = new Simulation({ tickRate: 30, seed: 3, rules });
  const lo = playableLoadout(rules, 'eevee');
  const p = sim.addPlayer({
    id: 1, x: 0, y: 0, radius: 12, moveSpeed: 180, types: lo.types, moveTypes: lo.moveTypes, fixedMoves: lo.fixedMoves, line: lo.line,
    species: rules.species.findIndex((s) => s.key === form), moves: [],
  });
  const item = (k: string): number => rules.items.findIndex((x) => x.key === k);
  const pm = (k: string, level = 8) => ({ move: moveIndexOf(rules, k), level, cooldown: 0, burstLeft: 0, burstTimer: 0 });
  return { rules, sim, w: sim.world, p, item, pm };
}

describe('サンダース（07 の325章）', () => {
  it('エレキボール は速いほど強く・大きい: こうそくいどう と スピーダー で上がる', () => {
    const t = setup();
    const ball = t.pm('electro-ball');
    const at = (moves: ReturnType<typeof t.pm>[], items: [string, number][]) => {
      t.p.moves = [ball, ...moves];
      t.p.items = items.map(([k, level]) => ({ item: t.item(k), level }));
      recomputeModifiers(t.w, t.p);
      return scaledMoveStats(t.w, t.p, ball, moveStatsOf(t.w, ball));
    };
    const def = t.rules.moves[ball.move]!.speedScale!;
    // サンダースは速さの種族値 130（ランクの倍率 1.45）
    const base = at([], []);
    expect(t.p.speedFactor).toBeCloseTo(1.45, 5);
    const fast = at([t.pm('agility')], [['x-speed', 5]]);
    const f = 1.45 * (1 + (32 + 50) / 100);
    expect(t.p.speedFactor).toBeCloseTo(f, 5);
    expect(fast.power / base.power).toBeCloseTo((1 + def.power * (f - 1)) / (1 + def.power * 0.45), 5);
    expect(fast.size / base.size).toBeCloseTo((1 + def.size * (f - 1)) / (1 + def.size * 0.45), 5);
  });

  it('ミサイルばり の数は使うたびに 2〜最大のどれか', () => {
    const t = setup();
    const pin = t.pm('pin-missile', 1);
    t.p.moves = [pin];
    recomputeModifiers(t.w, t.p);
    const max = moveStatsOf(t.w, pin).count;
    const seen = new Set<number>();
    for (let k = 0; k < 900; k++) {
      t.sim.step([]);
      // 出した回の 1 発目の後に残っている数 + 1 が、その回の数（1 回の更新で 1 発ずつ出る）
      if (t.w.events.some((e) => e.type === 'moveUsed' && e.move === pin.move)) seen.add(pin.burstLeft + 1);
    }
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...seen)).toBeLessThanOrEqual(max);
    expect(seen.size).toBeGreaterThan(1);
  });

  it('10まんボルト ＋ スピーダー → エレキボール はサンダースだけ', () => {
    for (const [form, ok] of [['jolteon', true], ['eevee', false]] as const) {
      const t = setup(form);
      t.p.moves = [t.pm('thunderbolt')];
      t.p.items = [{ item: t.item('x-speed'), level: 1 }];
      recomputeModifiers(t.w, t.p);
      const offers = makeOffers(t.w, t.p);
      expect(offers.some((o) => o.kind === 'derive' && o.to === moveIndexOf(t.rules, 'electro-ball'))).toBe(ok);
    }
  });
});
