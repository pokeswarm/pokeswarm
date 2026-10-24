import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { applyOffer, makeOffers } from './systems/leveling';

/**
 * ワンリキーのパンチ（作者の決定 2026年10月25日）: 最初はマッハパンチだけで、ほかの技は覚えない。
 * ほのおのいし・かみなりのいしを持つと ほのおのパンチ・かみなりパンチ を覚え、パンチは順番に出る。
 * きあいパンチ・ほのおのパンチ・かみなりパンチ が全部最大になると、それらを使って ばくれつパンチ に進化する
 */
function setup() {
  const rules = buildSimRules();
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const lo = playableLoadout(rules, 'machop');
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, types: lo.types, moveTypes: lo.moveTypes, fixedMoves: lo.fixedMoves, moves: lo.moves, line: lo.line, species: lo.species });
  const item = (key: string): number => rules.items.findIndex((it) => it.key === key);
  return { rules, sim, p, item, move: (key: string) => moveIndexOf(rules, key) };
}

describe('ワンリキーのパンチ', () => {
  it('最初はマッハパンチだけで、新しい技は候補に出ない。石を持つと、そのパンチを覚える', () => {
    const { sim, p, item, move } = setup();
    expect(p.moves.map((m) => m.move)).toEqual([move('mach-punch')]);
    for (let k = 0; k < 10; k++) expect(makeOffers(sim.world, p).some((o) => o.kind === 'moveNew')).toBe(false);
    applyOffer(sim.world, p, { kind: 'itemNew', item: item('fire-stone') });
    applyOffer(sim.world, p, { kind: 'itemNew', item: item('thunder-stone') });
    expect(p.moves.map((m) => m.move)).toEqual([move('mach-punch'), move('fire-punch'), move('thunder-punch')]);
    expect(sim.world.events.filter((e) => e.type === 'moveTaught')).toHaveLength(2);
  });

  it('パンチは同時に出ず、持っている順に1つずつ出る', () => {
    const { sim, p, item } = setup();
    applyOffer(sim.world, p, { kind: 'itemNew', item: item('fire-stone') });
    applyOffer(sim.world, p, { kind: 'itemNew', item: item('thunder-stone') });
    // 近くに敵を置く（マッハパンチは一番近い敵へ）
    for (let k = 0; k < 6; k++) sim.world.enemies.add(k + 1, 0, 60 + k * 10, 0, 1e6, 0, 10);
    const used: number[] = [];
    for (let t = 0; t < 120; t++) {
      sim.step([]);
      for (const e of sim.world.events) if (e.type === 'moveUsed') used.push(e.move);
    }
    expect(used.length).toBeGreaterThanOrEqual(4);
    // 同じ更新で2つ出ない・順番は持っている順のくり返し
    const order = p.moves.map((m) => m.move);
    used.forEach((m, k) => expect(m).toBe(order[k % order.length]));
  });

  it('きあいパンチ・ほのおのパンチ・かみなりパンチが全部最大で、ばくれつパンチへ。ほかのパンチは消費され、石を持っていても覚え直さない', () => {
    const { rules, sim, p, item, move } = setup();
    applyOffer(sim.world, p, { kind: 'itemNew', item: item('fire-stone') });
    applyOffer(sim.world, p, { kind: 'itemNew', item: item('thunder-stone') });
    applyOffer(sim.world, p, { kind: 'itemNew', item: item('dire-hit') });
    const max = (key: string) => rules.moves[move(key)]!.levels.length;
    // マッハパンチ（最大）＋クリティカット → きあいパンチ
    p.moves[0]!.level = max('mach-punch');
    const focus = makeOffers(sim.world, p).find((o) => o.kind === 'derive')!;
    expect(focus).toMatchObject({ to: move('focus-punch') });
    applyOffer(sim.world, p, focus);
    const derives = () => makeOffers(sim.world, p).filter((o) => o.kind === 'derive' && o.to === move('dynamic-punch'));
    p.moves[0]!.level = max('focus-punch');
    p.moves[1]!.level = max('fire-punch');
    expect(derives()).toEqual([]);
    p.moves[2]!.level = max('thunder-punch');
    const offer = derives()[0]!;
    expect(offer).toMatchObject({ kind: 'derive', item: -1, unique: true });
    applyOffer(sim.world, p, offer);
    expect(p.moves.map((m) => m.move)).toEqual([move('dynamic-punch')]);
    // 石を持ったまま次の持ち物を取っても、消費したパンチは戻らない
    applyOffer(sim.world, p, { kind: 'itemUp', slot: p.items.findIndex((it) => it.item === item('dire-hit')) });
    expect(p.moves.map((m) => m.move)).toEqual([move('dynamic-punch')]);
  });
});
