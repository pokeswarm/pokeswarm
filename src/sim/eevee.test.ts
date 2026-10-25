import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { applyOffer, derivationCompletedBy, makeOffers } from './systems/leveling';

/**
 * イーブイの とっておき（作者の決定 2026年10月25日）: かわらずのいし ＋ スピードスター・のしかかり・でんこうせっか が全部最大（Lv8）。
 * 進化すると のしかかり・でんこうせっか は消費される（なくなる。作者の決定 2026年10月25日）
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

describe('イーブイの とっておき', () => {
  it('かわらずのいし ＋ 3つの技が全部最大のときだけ候補に出る', () => {
    const s = setup();
    s.p.items = [{ item: s.everstone, level: 1 }];
    s.p.moves = [s.maxed('swift'), s.maxed('body-slam')];
    expect(offersLastResort(s)).toBe(false);
    s.p.moves.push({ ...s.maxed('quick-attack'), level: 1 });
    expect(offersLastResort(s)).toBe(false);
    s.p.moves[2] = s.maxed('quick-attack');
    expect(offersLastResort(s)).toBe(true);
    s.p.items = [];
    expect(offersLastResort(s)).toBe(false);
  });

  it('最後にかわらずのいしを取る候補で「おや？」になる', () => {
    const s = setup();
    s.p.moves = [s.maxed('swift'), s.maxed('body-slam'), s.maxed('quick-attack')];
    expect(derivationCompletedBy(s.sim.world, s.p, { kind: 'itemNew', item: s.everstone })?.to).toBe(s.move('last-resort'));
  });

  it('進化すると のしかかり・でんこうせっか は消費され、もう候補に出ない', () => {
    const s = setup();
    s.p.items = [{ item: s.everstone, level: 1 }];
    s.p.moves = [s.maxed('swift'), s.maxed('body-slam'), s.maxed('quick-attack')];
    applyOffer(s.sim.world, s.p, { kind: 'derive', slot: 0, to: s.move('last-resort'), item: s.everstone, unique: true });
    expect(s.p.moves.map((m) => m.move)).toEqual([s.move('last-resort')]);
    expect(s.p.consumedMoves).toEqual(expect.arrayContaining([s.move('body-slam'), s.move('quick-attack')]));
  });
});
