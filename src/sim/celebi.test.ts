import { describe, expect, it } from 'vitest';
import { buildSimRules, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';

/** セレビィの技（07 の87章） */
describe('セレビィ', () => {
  it('最初の技は マジカルリーフ・じこさいせい・いやしのねがい・みらいよち', () => {
    const rules = buildSimRules('johto');
    const lo = playableLoadout(rules, 'celebi');
    expect(lo.moves.map((m) => rules.moves[m.move]!.key)).toEqual(['magical-leaf', 'recover', 'healing-wish', 'future-sight']);
  });

  it('いやしのねがい: 再使用は じこさいせい の2倍。使った人は HP が減り、味方は最大 HP の 10% 回復する', () => {
    const rules = buildSimRules('johto');
    const hw = rules.moves.findIndex((m) => m.key === 'healing-wish');
    const rc = rules.moves.findIndex((m) => m.key === 'recover');
    expect(rules.moves[hw]!.levels[0]!.cooldownSeconds).toBeCloseTo(rules.moves[rc]!.levels[0]!.cooldownSeconds * 2);
    expect(rules.moves[hw]!.levels.at(-1)!.cooldownSeconds).toBeCloseTo(rules.moves[rc]!.levels.at(-1)!.cooldownSeconds * 2);
    // 味方（id 2）のブラウザで見る: セレビィ（id 1）が使うと、自分（id 2）が回復する
    const sim = new Simulation({ tickRate: 30, seed: 1, rules, role: 'guest', localPlayerId: 2 });
    sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, moves: [{ move: hw, level: 1 }], remote: true });
    const ally = sim.addPlayer({ id: 2, x: 0, y: 0, radius: 12, moveSpeed: 0, moves: [] });
    ally.hp = ally.maxHp * 0.5;
    sim.step([]);
    expect(ally.hp).toBeCloseTo(ally.maxHp * 0.6);
    // 使った人（自分のブラウザ）: HP が減る
    const solo = new Simulation({ tickRate: 30, seed: 1, rules });
    const me = solo.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, moves: [{ move: hw, level: 1 }] });
    solo.step([]);
    expect(me.hp).toBeLessThan(me.maxHp);
  });
});
