import { describe, expect, it } from 'vitest';
import { buildSimRules, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';

/** 遊べるライコウ（07 の309章）: しんそく（SPACE）はキーで使い、ほかの 3 つは自動 */
function setup(moves?: { key: string; level: number }[]) {
  const rules = buildSimRules('johto');
  const lo = playableLoadout(rules, 'raikou');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const ids = moves ? moves.map((m) => ({ move: rules.moves.findIndex((x) => x.key === m.key), level: m.level })) : lo.moves;
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 180, types: lo.types, species: lo.species, moves: ids, line: 'raikou', fixedMoves: lo.fixedMoves });
  return { rules, sim, p };
}

describe('遊べるライコウ', () => {
  it('最初の技は でんきショック・しんそく・かみつく・スパーク。しんそく は SPACE のスキル', () => {
    const { rules, p } = setup();
    expect(p.moves.map((m) => rules.moves[m.move]!.key)).toEqual(['thunder-shock', 'extreme-speed-raikou', 'bite', 'spark']);
    expect(p.skills!.map((s) => rules.activeSkills!.defs[s.skill]!.kind)).toEqual(['extremeSpeed']);
  });

  it('派生: 10まんボルト → かみなり（ライコウの版）、かみつく → かみくだく', () => {
    const { rules } = setup();
    const key = (i: number) => rules.moves[i]!.key;
    const item = (i: number) => rules.items[i]!.key;
    const routes = rules.derivations.filter((d) => d.line === 'raikou').map((d) => `${key(d.from)}+${item(d.item)}>${key(d.to)}`);
    expect(routes).toEqual(expect.arrayContaining(['thunderbolt+thunder-stone>thunder-raikou', 'bite+black-glasses>crunch']));
  });

  it('しんそく: 前の敵を角にして駆け抜け、終点へ移る。通り道の敵に当たる', () => {
    const { sim, p } = setup([{ key: 'extreme-speed-raikou', level: 1 }]);
    const e = sim.world.enemies;
    e.add(1, 0, 150, 40, 1e6, 0, 12, 0, 0, 0);
    e.add(2, 0, 280, -30, 1e6, 0, 12, 0, 0, 0);
    sim.step([{ type: 'move', playerId: 1, dx: 1, dy: 0 }]);
    sim.step([{ type: 'move', playerId: 1, dx: 0, dy: 0 }]);
    const hp = [e.hp[0]!, e.hp[1]!];
    sim.step([{ type: 'useSkill', playerId: 1, slot: 0 }]);
    expect(p.x).toBeGreaterThan(250);
    sim.step([]);
    expect(e.hp[0]!).toBeLessThan(hp[0]!);
    expect(e.hp[1]!).toBeLessThan(hp[1]!);
  });

  it('しんそく は自動では出ない', () => {
    const { sim, p } = setup([{ key: 'extreme-speed-raikou', level: 1 }]);
    sim.world.enemies.add(1, 0, 150, 0, 1e6, 0, 12, 0, 0, 0);
    for (let k = 0; k < 90; k++) sim.step([]);
    expect(Math.abs(p.x)).toBeLessThan(1);
  });

  it('かみなり（ライコウ）: 雷雲が HP の一番高い敵へ流れ、その下に雷が落ちて当たる', () => {
    const { rules, sim } = setup([{ key: 'thunder-raikou', level: 8 }]);
    const th = rules.moves.findIndex((m) => m.key === 'thunder-raikou');
    const e = sim.world.enemies;
    e.add(1, 0, 260, 0, 1e7, 0, 12, 0, 0, 0);
    let bolts = 0;
    for (let k = 0; k < 120; k++) {
      sim.step([]);
      const pr = sim.world.projectiles;
      for (let i = 0; i < pr.count; i++) if (pr.move[i] === th && pr.stage[i]! > 0) bolts++;
    }
    expect(bolts).toBeGreaterThan(0);
    expect(e.hp[0]!).toBeLessThan(1e7);
  });
});
