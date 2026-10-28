import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { checkEvolution } from './systems/evolution';
import { applyOffer, makeOffers, moveMaxLevel } from './systems/leveling';

/**
 * ワンリキーのパンチ（作者の決定 2026年10月25日）: 最初はマッハパンチだけで、ほかの技は覚えない。
 * ほのおのいし・かみなりのいしを持つと ほのおのパンチ・かみなりパンチ を覚え、パンチは順番に出る。
 * カイリキーの姿で きあいパンチ が最大になると ばくれつパンチ に進化し、ほのおのパンチ・かみなりパンチ は消費される（作者の決定 2026年10月25日）
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

  it('つながりのヒモは、ゴーリキーになってから候補に出る', () => {
    const { rules, sim, p, item } = setup();
    const cord = item('linking-cord');
    const offered = () => Array.from({ length: 30 }, () => makeOffers(sim.world, p)).some((list) => list.some((o) => o.kind === 'itemNew' && o.item === cord));
    expect(offered()).toBe(false);
    p.species = rules.species.findIndex((s) => s.key === 'machoke');
    expect(offered()).toBe(true);
  });

  it('カイリキーの姿で きあいパンチ が最大なら ばくれつパンチ へ。ほのおのパンチ・かみなりパンチは消費され、石を持っていても覚え直さない', () => {
    const { rules, sim, p, item, move } = setup();
    applyOffer(sim.world, p, { kind: 'itemNew', item: item('fire-stone') });
    applyOffer(sim.world, p, { kind: 'itemNew', item: item('thunder-stone') });
    applyOffer(sim.world, p, { kind: 'itemNew', item: item('dire-hit') });
    const max = (key: string) => rules.moves[move(key)]!.levels.length;
    // マッハパンチ（最大）＋クリティカット → きあいパンチ。マッハパンチはもう候補に出ない
    p.moves[0]!.level = max('mach-punch');
    const focus = makeOffers(sim.world, p).find((o) => o.kind === 'derive')!;
    expect(focus).toMatchObject({ to: move('focus-punch') });
    applyOffer(sim.world, p, focus);
    expect(p.consumedMoves).toContain(move('mach-punch'));
    const derives = () => makeOffers(sim.world, p).filter((o) => o.kind === 'derive' && o.to === move('dynamic-punch'));
    p.moves[0]!.level = max('focus-punch');
    // ゴーリキーではまだ
    p.species = rules.species.findIndex((s) => s.key === 'machoke');
    expect(derives()).toEqual([]);
    p.species = rules.species.findIndex((s) => s.key === 'machamp');
    const offer = derives()[0]!;
    expect(offer).toMatchObject({ kind: 'derive', item: -1, unique: true });
    applyOffer(sim.world, p, offer);
    expect(p.moves.map((m) => m.move)).toEqual([move('dynamic-punch')]);
    // 材料の強化分（きあいパンチ 最大 − 1、ほのお・かみなりのパンチ Lv1 は 0）を受け継ぐ
    expect(p.moves[0]!.level).toBe(max('focus-punch'));
    // 石を持ったまま次の持ち物を取っても、消費したパンチは戻らない
    applyOffer(sim.world, p, { kind: 'itemUp', slot: p.items.findIndex((it) => it.item === item('dire-hit')) });
    expect(p.moves.map((m) => m.move)).toEqual([move('dynamic-punch')]);
  });

  it('きあいパンチをためている間はマッハパンチが出て、きあいパンチを出している間は止まる', () => {
    const { rules, sim, p, move } = setup();
    p.moves[0] = { move: move('focus-punch'), level: 1, cooldown: 0, burstLeft: 0, burstTimer: 0 };
    for (let k = 0; k < 6; k++) sim.world.enemies.add(k + 1, 0, 60 + k * 10, 0, 1e6, 0, 10);
    const used: { t: number; m: number }[] = [];
    for (let t = 0; t < 150; t++) {
      sim.step([]);
      for (const e of sim.world.events) if (e.type === 'moveUsed') used.push({ t, m: e.move });
    }
    const focusAt = used.filter((u) => u.m === move('focus-punch')).map((u) => u.t);
    const machAt = used.filter((u) => u.m === move('mach-punch')).map((u) => u.t);
    expect(focusAt.length).toBeGreaterThanOrEqual(2);
    expect(machAt.length).toBeGreaterThanOrEqual(3);
    // きあいパンチを出してから pauseSeconds の間は、マッハパンチが出ない
    const pause = Math.round(rules.moves[move('focus-punch')]!.chargeMove!.pauseSeconds * 30);
    for (const f of focusAt) expect(machAt.some((m) => m > f && m < f + pause)).toBe(false);
  });

  it('ばくれつパンチは、材料にした3つのパンチの強化分をすべて受け継ぐ（最大 Lv24 まで）', () => {
    const { rules, sim, p, item, move } = setup();
    applyOffer(sim.world, p, { kind: 'itemNew', item: item('fire-stone') });
    applyOffer(sim.world, p, { kind: 'itemNew', item: item('thunder-stone') });
    const max = (key: string) => rules.moves[move(key)]!.levels.length;
    expect(max('dynamic-punch')).toBe(24);
    expect(max('focus-punch') + max('fire-punch') + max('thunder-punch')).toBe(24);
    p.moves[0] = { move: move('focus-punch'), level: max('focus-punch'), cooldown: 0, burstLeft: 0, burstTimer: 0 };
    p.moves[1]!.level = 3;
    p.moves[2]!.level = 2;
    p.species = rules.species.findIndex((s) => s.key === 'machamp');
    applyOffer(sim.world, p, { kind: 'derive', slot: 0, to: move('dynamic-punch'), item: -1, unique: true });
    expect(p.moves).toHaveLength(1);
    expect(p.moves[0]!.level).toBe(1 + (max('focus-punch') - 1) + 2 + 1);
  });

  it('ばくれつパンチの最大レベルは、消費したパンチの数で決まる（なし Lv8・1つ Lv16・2つ Lv24。07 の105章）', () => {
    for (const [stones, cap] of [[[], 8], [['fire-stone'], 16], [['fire-stone', 'thunder-stone'], 24]] as const) {
      const { rules, sim, p, item, move } = setup();
      for (const st of stones) applyOffer(sim.world, p, { kind: 'itemNew', item: item(st) });
      p.moves[0] = { move: move('focus-punch'), level: rules.moves[move('focus-punch')]!.levels.length, cooldown: 0, burstLeft: 0, burstTimer: 0 };
      p.species = rules.species.findIndex((x) => x.key === 'machamp');
      applyOffer(sim.world, p, { kind: 'derive', slot: 0, to: move('dynamic-punch'), item: -1, unique: true });
      const dp = p.moves.find((m) => m.move === move('dynamic-punch'))!;
      expect(moveMaxLevel(rules, dp)).toBe(cap);
      // 最大まで上げたら、もう強化の候補に出ない
      dp.level = cap;
      expect(makeOffers(sim.world, p).some((o) => o.kind === 'moveUp')).toBe(false);
    }
  });

  it('ニョロボンが覚える ばくれつパンチ は最大 Lv8', () => {
    const rules = buildSimRules('johto');
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    const lo = playableLoadout(rules, 'poliwag');
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, types: lo.types, moveTypes: lo.moveTypes, fixedMoves: lo.fixedMoves, moves: lo.moves, line: lo.line, species: lo.species });
    p.species = rules.species.findIndex((x) => x.key === 'poliwhirl');
    p.items = [{ item: rules.items.findIndex((it) => it.key === 'water-stone'), level: 1 }];
    checkEvolution(sim.world, p);
    const dp = p.moves.find((m) => m.move === moveIndexOf(rules, 'dynamic-punch'))!;
    expect(moveMaxLevel(rules, dp)).toBe(8);
  });
});
