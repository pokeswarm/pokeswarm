import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { applyOffer, makeOffers, recomputeModifiers } from './systems/leveling';

/** ポリゴン（作者の決定 2026年10月24日）: 技は最初から3つ（スピードスター・かくばる・テクスチャー）で、ほかは覚えない */
function setup() {
  const rules = buildSimRules();
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const lo = playableLoadout(rules, 'porygon');
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, types: lo.types, moveTypes: lo.moveTypes, fixedMoves: lo.fixedMoves, moves: lo.moves, line: lo.line, species: lo.species });
  return { rules, sim, p };
}

describe('ポリゴン', () => {
  it('かくばる・テクスチャーは使わず、レベルごとの効果がいつも足される', () => {
    const { sim, p } = setup();
    recomputeModifiers(sim.world, p);
    expect(p.mods.powerPct).toBe(6);
    expect(p.mods.cooldownPct).toBe(-5);
    // かくばる Lv3（+18%）、テクスチャー Lv3（クールダウン −5%・数 +1・貫通 +1）
    for (const k of [1, 2]) {
      p.moves[k]!.level = 3;
    }
    recomputeModifiers(sim.world, p);
    expect(p.mods.powerPct).toBe(18);
    expect(p.mods.amountBonus).toBe(1);
    expect(p.mods.pierceBonus).toBe(1);
    // 使っても弾は出ない（スピードスターは敵がいないので待つ）
    for (let t = 0; t < 60; t++) sim.step([]);
    expect(sim.world.projectiles.count).toBe(0);
  });

  it('新しい技は覚えない。レベル42で、スピードスターが最大ならトライアタックへ（持ち物はいらない）', () => {
    const { rules, sim, p } = setup();
    const swift = moveIndexOf(rules, 'swift');
    const tri = moveIndexOf(rules, 'tri-attack');
    p.moves[0]!.level = rules.moves[swift]!.levels.length;
    const derives = () => makeOffers(sim.world, p).filter((o) => o.kind === 'derive');
    for (let k = 0; k < 10; k++) expect(makeOffers(sim.world, p).some((o) => o.kind === 'moveNew')).toBe(false);
    (sim.world as { level: number }).level = 41;
    expect(derives()).toEqual([]);
    (sim.world as { level: number }).level = 42;
    const offer = derives()[0]!;
    expect(offer).toMatchObject({ kind: 'derive', to: tri, item: -1, unique: true });
    applyOffer(sim.world, p, offer);
    expect(p.moves[0]!.move).toBe(tri);
  });
});
