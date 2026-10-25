import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import { Simulation } from './simulation';
import { playerMoveStats } from './systems/attack';

/**
 * 作者の指摘（2026年10月25日）:
 * - だいばくはつは HP を使う大技: 最大 HP の 10% を使い、HP 50 以下では出さない。残る範囲は作らない
 * - ポイントマックスで増えた分は、2段目以降の技（効き方）を起こさない（みらいよち）
 * - 自分を中心に円状に広がる技の半径は、射程の強化ではなく範囲の強化で広がる
 * - ねんりきの射程の強化は半分だけ効く
 */
function setup(move: string, level = 1) {
  const rules = buildSimRules();
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const m = moveIndexOf(rules, move);
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, moves: [{ move: m, level }] });
  return { rules, sim, p, m };
}

describe('だいばくはつ', () => {
  it('使うたびに最大 HP の 10% を使い、残る範囲は作らない', () => {
    const { sim, p, m } = setup('explosion');
    const before = p.hp;
    let used = 0;
    for (let t = 0; t < 10 && used === 0; t++) {
      sim.step([]);
      used = sim.world.events.filter((e) => e.type === 'moveUsed' && e.move === m).length;
    }
    expect(used).toBe(1);
    expect(p.hp).toBeCloseTo(before - p.maxHp * 0.1);
    for (let t = 0; t < 30; t++) sim.step([]);
    const pr = sim.world.projectiles;
    for (let i = 0; i < pr.count; i++) expect(pr.stage[i]).not.toBe(1);
  });

  it('HP が 50 以下では出さない', () => {
    const { sim, p, m } = setup('explosion');
    p.hp = 50;
    for (let t = 0; t < 30; t++) {
      sim.step([]);
      expect(sim.world.events.some((e) => e.type === 'moveUsed' && e.move === m)).toBe(false);
    }
    expect(p.hp).toBe(50);
  });
});

describe('持ち物の効き方', () => {
  it('ポイントマックスで増えた落雷は、後から来る爆発を起こさない（みらいよち）', () => {
    const { sim, p, m } = setup('future-sight');
    p.mods.amountBonus = 2;
    for (let k = 0; k < 40; k++) sim.world.enemies.add(k + 1, 0, (k % 8) * 40 - 160, Math.floor(k / 8) * 40 - 80, 1e9, 0, 10);
    const st = playerMoveStats(sim.world, p, p.moves[0]!);
    sim.step([]);
    const pr = sim.world.projectiles;
    const main = [...Array(pr.count).keys()].filter((i) => pr.move[i] === m && pr.stage[i] === 0);
    expect(main.length).toBe(st.count);
    expect(main.filter((i) => pr.noFx[i]).length).toBe(2);
  });

  it('自分を中心に広がる技の半径は、範囲の強化で広がり、射程の強化は効かない（だいばくはつ）', () => {
    const { sim, p } = setup('explosion');
    const base = playerMoveStats(sim.world, p, p.moves[0]!).range;
    p.mods.rangePct = 50;
    expect(playerMoveStats(sim.world, p, p.moves[0]!).range).toBeCloseTo(base);
    p.mods.areaPct = 20;
    expect(playerMoveStats(sim.world, p, p.moves[0]!).range).toBeCloseTo(base * 1.2);
  });

  it('ねんりきは射程の強化が半分だけ効く', () => {
    const { sim, p } = setup('confusion');
    const base = playerMoveStats(sim.world, p, p.moves[0]!).range;
    p.mods.rangePct = 40;
    expect(playerMoveStats(sim.world, p, p.moves[0]!).range).toBeCloseTo(base * 1.2);
  });
});
