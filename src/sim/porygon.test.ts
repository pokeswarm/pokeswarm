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

  it('新しい技は覚えない。スピードスターが最大 ＋ Lv45 でトライアタックへ。アップグレードは使わない（07 の181章）', () => {
    const { rules, sim, p } = setup();
    const swift = moveIndexOf(rules, 'swift');
    const tri = moveIndexOf(rules, 'tri-attack');
    p.moves[0]!.level = rules.moves[swift]!.levels.length;
    const derives = () => makeOffers(sim.world, p).filter((o) => o.kind === 'derive');
    for (let k = 0; k < 10; k++) expect(makeOffers(sim.world, p).some((o) => o.kind === 'moveNew')).toBe(false);
    expect(derives()).toEqual([]);
    const upGrade = rules.items.findIndex((i) => i.key === 'up-grade');
    p.items.push({ item: upGrade, level: 1 });
    sim.world.level = 44;
    expect(derives()).toEqual([]);
    p.items.length = 0;
    sim.world.level = 45;
    const offer = derives()[0]!;
    expect(offer).toMatchObject({ kind: 'derive', to: tri, item: -1, unique: true });
    applyOffer(sim.world, p, offer);
    expect(p.moves[0]!.move).toBe(tri);
  });
});

describe('ロックオン（07 の249章）', () => {
  it('最初から持っていて、ボス・中ボスがいる間はそのうち HP の一番高い敵にロックオンし、その敵へのダメージが上がる', () => {
    const { rules, sim, p } = setup();
    expect(p.moves.map((m) => rules.moves[m.move]!.key)).toContain('lock-on');
    recomputeModifiers(sim.world, p);
    expect(p.mods.lockOnPct).toBe(20);
    const e = sim.world.enemies;
    const boss = rules.enemies.kinds.findIndex((k) => (k.rank ?? 'normal') !== 'normal');
    const normal = rules.enemies.kinds.findIndex((k) => (k.rank ?? 'normal') === 'normal');
    e.add(1, normal, 80, 0, 1e6, 0, 10);
    sim.step([]);
    expect(p.lockOn ?? 0).toBe(0);
    e.add(2, boss, 200, 0, 1e6, 0, 30);
    sim.step([]);
    expect(p.lockOn).toBe(3);
  });

  it('追う弾は、近い雑魚より先にロックオンした相手を狙い、貫通して当たった後は雑魚へ向かう', () => {
    const { rules, sim, p } = setup();
    const tri = moveIndexOf(rules, 'tri-attack');
    p.moves[0] = { move: tri, level: 8, cooldown: 0, burstLeft: 0, burstTimer: 0 };
    p.moves[2]!.level = 3; // テクスチャー Lv3: 貫通 +1
    recomputeModifiers(sim.world, p);
    const e = sim.world.enemies;
    const boss = rules.enemies.kinds.findIndex((k) => (k.rank ?? 'normal') !== 'normal');
    const normal = rules.enemies.kinds.findIndex((k) => (k.rank ?? 'normal') === 'normal');
    e.add(1, normal, 60, 80, 1e6, 0, 10);
    e.add(2, boss, 180, 0, 1e6, 0, 30);
    let firstTarget = 0;
    let retargeted = false;
    for (let t = 0; t < 60; t++) {
      sim.step([]);
      const pr = sim.world.projectiles;
      for (let i = 0; i < pr.count; i++) {
        if (pr.move[i] !== tri || pr.stage[i] !== 0) continue;
        if (!firstTarget && pr.target[i]! > 0) firstTarget = pr.target[i]! - 1;
        if (pr.isBlocked(i, 2, sim.world.tick) && pr.target[i] === 2) retargeted = true;
      }
    }
    expect(firstTarget).toBe(2);
    expect(retargeted).toBe(true);
    expect(e.hp[0]!).toBeLessThan(1e6);
  });
});
