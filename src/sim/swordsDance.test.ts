import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { moveStatsOf, scaledMoveStats } from './systems/attack';
import { recomputeModifiers } from './systems/leveling';

/** 07 の324章: つるぎのまい は ほかの強化と別に掛ける。シルクのスカーフ（ノーマル）で上げ幅が増える */
function setup() {
  const rules = buildSimRules('johto');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const lo = playableLoadout(rules, 'scyther');
  const p = sim.addPlayer({
    id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, types: lo.types, moveTypes: lo.moveTypes, fixedMoves: lo.fixedMoves, line: lo.line,
    species: rules.species.findIndex((s) => s.key === 'scizor'), moves: [],
  });
  const item = (k: string): number => rules.items.findIndex((x) => x.key === k);
  const bullet = { move: moveIndexOf(rules, 'bullet-punch'), level: 8, cooldown: 0, burstLeft: 0, burstTimer: 0 };
  const sd = { move: moveIndexOf(rules, 'swords-dance'), level: 8, cooldown: 0, burstLeft: 0, burstTimer: 0 };
  const power = (withSd: boolean, items: [string, number][]): number => {
    p.moves = withSd ? [bullet, sd] : [bullet];
    p.items = items.map(([k, level]) => ({ item: item(k), level }));
    recomputeModifiers(sim.world, p);
    return scaledMoveStats(sim.world, p, bullet, moveStatsOf(sim.world, bullet)).power;
  };
  return { rules, power };
}

describe('つるぎのまい（07 の324章）', () => {
  it('最大で物理の技 ×1.48。プラスパワーと足し合わせず、別に掛ける', () => {
    const t = setup();
    expect(t.power(true, []) / t.power(false, [])).toBeCloseTo(1.48, 5);
    // プラスパワー 5（+50%）を持っていても、上がる割合は同じ
    expect(t.power(true, [['x-attack', 5]]) / t.power(false, [['x-attack', 5]])).toBeCloseTo(1.48, 5);
  });

  it('シルクのスカーフ（ノーマル +75%）を持つと、つるぎのまい の上げ幅が 1.75 倍（×1.84）', () => {
    const t = setup();
    expect(t.power(true, [['silk-scarf', 5]]) / t.power(false, [['silk-scarf', 5]])).toBeCloseTo(1 + 0.48 * 1.75, 5);
    // 途中のレベルでも割合で掛かる（Lv2 = +30% → 上げ幅 1.3 倍）
    expect(t.power(true, [['silk-scarf', 2]]) / t.power(false, [['silk-scarf', 2]])).toBeCloseTo(1 + 0.48 * 1.3, 5);
  });

  it('とくしゅ の技には掛からない', () => {
    const rules = buildSimRules('johto');
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, moves: [] });
    const swift = { move: moveIndexOf(rules, 'swift'), level: 8, cooldown: 0, burstLeft: 0, burstTimer: 0 };
    expect(rules.moves[swift.move]!.damageClass).toBe('special');
    p.moves = [swift];
    recomputeModifiers(sim.world, p);
    const base = scaledMoveStats(sim.world, p, swift, moveStatsOf(sim.world, swift)).power;
    p.moves = [swift, { move: moveIndexOf(rules, 'swords-dance'), level: 8, cooldown: 0, burstLeft: 0, burstTimer: 0 }];
    recomputeModifiers(sim.world, p);
    expect(scaledMoveStats(sim.world, p, swift, moveStatsOf(sim.world, swift)).power).toBeCloseTo(base, 5);
  });
});
