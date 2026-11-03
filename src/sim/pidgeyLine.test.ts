import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { SHAPE_SECTOR } from './entities/projectiles';
import { Simulation } from './simulation';
import { makeOffers, moveMaxLevel } from './systems/leveling';
import type { UpgradeOffer } from './world';

/** ジョウトの技の作り直し（1）ポッポ系統（作者の決定 2026年11月1日。07 の157章） */
function setup() {
  const rules = buildSimRules('johto');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const lo = playableLoadout(rules, 'pidgey');
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, types: lo.types, moveTypes: lo.moveTypes, fixedMoves: lo.fixedMoves, moves: lo.moves, line: lo.line, species: lo.species });
  p.facingX = 1;
  p.facingY = 0;
  const move = (key: string): number => moveIndexOf(rules, key);
  const species = (key: string): number => rules.species.findIndex((s) => s.key === key);
  const give = (key: string, level: number) => p.moves.push({ move: move(key), level, cooldown: 0, burstLeft: 0, burstTimer: 0 });
  const derives = (key: string): UpgradeOffer | undefined => makeOffers(sim.world, p).find((o) => o.kind === 'derive' && o.to === move(key));
  const pr = sim.world.projectiles;
  const find = (pred: (i: number) => boolean): number[] => [...Array(pr.count).keys()].filter(pred);
  return { rules, sim, p, move, species, give, derives, pr, find };
}

describe('ポッポ: ふきとばし → つばさでうつ → ぼうふう', () => {
  it('ふきとばし は前へ吹く扇で、強く押し飛ばす', () => {
    const t = setup();
    expect(t.p.moves.map((m) => t.rules.moves[m.move]!.key)).toEqual(['whirlwind']);
    t.sim.step([]);
    const cone = t.find((i) => t.pr.move[i] === t.move('whirlwind') && t.pr.shape[i] === SHAPE_SECTOR);
    expect(cone).toHaveLength(1);
    expect(t.rules.moves[t.move('whirlwind')]!.levels[0]!.knockback).toBe(320);
  });
  it('ぼうふう は大きな嵐が前へ進み、0.4 秒ごとに巻き込み、消えるとき吹き飛ばす', () => {
    const t = setup();
    const def = t.rules.moves[t.move('hurricane')]!;
    expect(def.pattern).toBe('facing');
    expect(def.effects.map((e) => e.trigger)).toEqual(['every', 'end']);
    expect(def.effects[0]!.explode?.pull).toBe(240);
  });
  it('ぼうふう は ピジョット で、エアスラッシュ が最大 ＋ スピーダー（カントーの形。07 の169章。支えの技は使わない）', () => {
    const t = setup();
    t.p.moves = [];
    t.give('air-slash', 1);
    t.p.moves[0]!.level = moveMaxLevel(t.rules, t.p.moves[0]!);
    t.p.items = [{ item: t.rules.items.findIndex((i) => i.key === 'x-speed'), level: 1 }];
    expect(t.derives('hurricane')).toBeUndefined();
    t.p.species = t.species('pidgeot');
    expect(t.derives('hurricane')).toBeDefined();
    t.p.items = [];
    expect(t.derives('hurricane')).toBeUndefined();
  });
});
