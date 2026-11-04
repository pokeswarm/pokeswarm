import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { applyOffer, canLearnNewMove, makeOffers, moveMaxLevel } from './systems/leveling';

/**
 * イーブイの とっておき（作者の決定 2026年11月4日。07 の182章）: のしかかり ＋ かわらずのいし で進化し、ほかのノーマルの技を全部消費する
 */
function setup() {
  const rules = buildSimRules();
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const lo = playableLoadout(rules, 'eevee');
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, types: lo.types, moveTypes: lo.moveTypes, fixedMoves: lo.fixedMoves, moves: lo.moves, line: lo.line, species: lo.species });
  const move = (key: string): number => moveIndexOf(rules, key);
  const maxed = (key: string) => ({ move: move(key), level: rules.moves[move(key)]!.levels.length, cooldown: 0, burstLeft: 0, burstTimer: 0 });
  const everstone = rules.items.findIndex((it) => it.key === 'everstone');
  return { rules, sim, p, move, maxed, everstone };
}

const offersLastResort = (s: ReturnType<typeof setup>): boolean =>
  makeOffers(s.sim.world, s.p).some((o) => o.kind === 'derive' && o.to === s.move('last-resort'));

describe('イーブイの とっておき（07 の182章）', () => {
  it('のしかかり（最大）＋ かわらずのいし で候補に出る', () => {
    const s = setup();
    s.p.moves = [s.maxed('body-slam')];
    expect(offersLastResort(s)).toBe(false);
    s.p.items = [{ item: s.everstone, level: 1 }];
    expect(offersLastResort(s)).toBe(true);
  });

  it('ほかのノーマルの技を全部消費し、使った数だけ最大レベルが上がる（0 で Lv8・1 つで Lv16・2 つで Lv24）。強化分も受け継ぐ', () => {
    const cases: [string[], number][] = [[[], 8], [['swift'], 16], [['swift', 'quick-attack'], 24], [['swift', 'double-edge'], 24]];
    for (const [materials, cap] of cases) {
      const s = setup();
      s.p.items = [{ item: s.everstone, level: 1 }];
      s.p.moves = [s.maxed('body-slam'), ...materials.map((k) => s.maxed(k))];
      applyOffer(s.sim.world, s.p, { kind: 'derive', slot: 0, to: s.move('last-resort'), item: s.everstone, unique: true });
      expect(s.p.moves.map((m) => m.move), materials.join()).toEqual([s.move('last-resort')]);
      expect(moveMaxLevel(s.rules, s.p.moves[0]!), materials.join()).toBe(cap);
      expect(s.p.moves[0]!.level).toBeGreaterThan(1);
      for (const k of materials) expect(s.p.consumedMoves).toContain(s.move(k));
      // もう覚え直さない
      for (let n = 0; n < 10; n++) expect(makeOffers(s.sim.world, s.p).some((o) => o.kind === 'moveNew' && materials.map(s.move).includes(o.move))).toBe(false);
    }
  });

  it('進化前はノーマルの技だけ覚える。進化するとその姿のタイプの技を覚える', () => {
    const s = setup();
    for (const k of ['swift', 'quick-attack']) expect(canLearnNewMove(s.sim.world, s.p, s.move(k)), k).toBe(true);
    for (const k of ['ember', 'fire-fang', 'water-gun', 'bubble', 'confusion', 'thunder-shock', 'double-kick']) expect(canLearnNewMove(s.sim.world, s.p, s.move(k)), k).toBe(false);
    s.p.species = s.rules.species.findIndex((x) => x.key === 'flareon');
    expect(canLearnNewMove(s.sim.world, s.p, s.move('ember'))).toBe(true);
    expect(canLearnNewMove(s.sim.world, s.p, s.move('water-gun'))).toBe(false);
  });
});
