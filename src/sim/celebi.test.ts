import { describe, expect, it } from 'vitest';
import { buildSimRules, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';

/** セレビィの技（07 の87章） */
describe('セレビィ', () => {
  it('最初の技は マジカルリーフ・ねんりき・やどりぎのタネ・いやしのねがい で、決めた技だけ覚える（07 の306章）', () => {
    const rules = buildSimRules('johto');
    const lo = playableLoadout(rules, 'celebi');
    expect(lo.moves.map((m) => rules.moves[m.move]!.key)).toEqual(['magical-leaf', 'confusion', 'leech-seed', 'healing-wish']);
    expect(lo.fixedMoves).toBe(true);
  });

  it('派生: マジカルリーフ → エナジーボール → リーフストーム、ねんりき → みらいよち（セレビィの版）', () => {
    const rules = buildSimRules('johto');
    const key = (i: number) => rules.moves[i]!.key;
    const item = (i: number) => rules.items[i]!.key;
    const routes = rules.derivations.filter((d) => d.line === 'celebi').map((d) => `${key(d.from)}+${item(d.item)}>${key(d.to)}`);
    expect(routes).toEqual(expect.arrayContaining(['magical-leaf+miracle-seed>energy-ball', 'energy-ball+x-sp-atk>leaf-storm-celebi', 'confusion+twisted-spoon>future-sight-celebi']));
  });

  it('リーフストーム: HP の一番高い敵へ進み、着くとその場で嵐が渦巻き続ける', () => {
    const rules = buildSimRules('johto');
    const ls = rules.moves.findIndex((m) => m.key === 'leaf-storm-celebi');
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, moves: [{ move: ls, level: 8 }] });
    const e = sim.world.enemies;
    e.add(1, 0, 120, 60, 50, 0, 12, 0, 0, 0);
    e.add(2, 0, 300, 0, 1e7, 0, 12, 0, 0, 0);
    let lingering = false;
    for (let k = 0; k < 120 && !lingering; k++) {
      sim.step([]);
      const pr = sim.world.projectiles;
      for (let i = 0; i < pr.count; i++) if (pr.move[i] === ls && pr.stage[i]! > 0 && Math.abs(pr.x[i]! - 300) < 40) lingering = true;
    }
    expect(lingering).toBe(true);
  });

  it('みらいよち（セレビィ）: 敵とボスの上に印を置き、時間をおいて当たる', () => {
    const rules = buildSimRules('johto');
    const fs = rules.moves.findIndex((m) => m.key === 'future-sight-celebi');
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, moves: [{ move: fs, level: 1 }] });
    const e = sim.world.enemies;
    e.add(1, 0, 150, 0, 1e7, 0, 12, 0, 0, 0);
    sim.step([]);
    const pr = sim.world.projectiles;
    let waiting = 0;
    for (let i = 0; i < pr.count; i++) if (pr.move[i] === fs && pr.stage[i] === 3) waiting++;
    expect(waiting).toBeGreaterThan(0);
    const hp0 = e.hp[0]!;
    for (let k = 0; k < 60; k++) sim.step([]);
    expect(e.hp[0]!).toBeLessThan(hp0);
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
