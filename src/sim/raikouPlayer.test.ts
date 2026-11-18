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
  it('最初の技は しんそく・じゅうでん・ライジングボルト・エレキフィールド。キーは SPACE・Q・E', () => {
    const { rules, p } = setup();
    expect(p.moves.map((m) => rules.moves[m.move]!.key)).toEqual(['extreme-speed-raikou', 'charge-raikou', 'rising-voltage-raikou', 'electric-terrain-raikou']);
    expect(p.skills!.map((s) => rules.activeSkills!.defs[s.skill]!.kind)).toEqual(['extremeSpeed', 'charge', 'risingVoltage']);
    expect(rules.derivations.filter((d) => d.line === 'raikou')).toEqual([]);
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

  it('エレキフィールド: 中の敵に びりびり が重なり、当たらないと消える', () => {
    const { sim } = setup([{ key: 'electric-terrain-raikou', level: 1 }]);
    const e = sim.world.enemies;
    e.add(1, 0, 60, 0, 1e6, 0, 12, 0, 0, 0);
    for (let k = 0; k < 90; k++) sim.step([]);
    expect(e.shock[0]).toBe(5);
    e.x[0] = 2000;
    for (let k = 0; k < 120; k++) sim.step([]);
    expect(e.shock[0]).toBe(0);
  });

  it('ライジングボルト: 重ねきった敵がいなければ HP の一番高い敵に 1 本、いれば全員にコンボ（重ねは消える）。じゅうでん で強くなり使い切る', () => {
    const { rules, sim, p } = setup([
      { key: 'charge-raikou', level: 1 },
      { key: 'rising-voltage-raikou', level: 1 },
    ]);
    // スキルは系統の 3 つ（しんそく の技は持っていないので枠 0 は使えない）
    const rv = rules.moves.findIndex((m) => m.key === 'rising-voltage-raikou');
    const e = sim.world.enemies;
    e.add(1, 0, 200, 0, 1e7, 0, 12, 0, 0, 0);
    e.add(2, 0, -200, 0, 1e7, 0, 12, 0, 0, 0);
    e.add(3, 0, 0, 200, 5e6, 0, 12, 0, 0, 0);
    sim.step([]);
    const count = () => {
      let n = 0;
      let combo = 0;
      for (let i = 0; i < sim.world.projectiles.count; i++) if (sim.world.projectiles.move[i] === rv) (sim.world.projectiles.armStage[i] === 1 ? combo++ : n++);
      return { n, combo };
    };
    sim.step([{ type: 'useSkill', playerId: 1, slot: 2 }]);
    expect(count()).toEqual({ n: 1, combo: 0 });
    for (let k = 0; k < 30; k++) sim.step([]);
    // 2 体を重ねきった状態にして、じゅうでん を 2 回
    e.shock[0] = 5;
    e.shockTicks[0] = 999;
    e.shockBy[0] = 1;
    e.shock[1] = 5;
    e.shockTicks[1] = 999;
    e.shockBy[1] = 1;
    sim.step([{ type: 'useSkill', playerId: 1, slot: 1 }]);
    expect(p.charged?.stacks).toBe(1);
    for (let k = 0; k < 300; k++) sim.step([]);
    sim.step([{ type: 'useSkill', playerId: 1, slot: 2 }]);
    expect(count()).toEqual({ n: 0, combo: 2 });
    expect(p.charged).toBeUndefined();
    expect(e.shock[0]).toBe(0);
    const before = e.hp[0]!;
    for (let k = 0; k < 30; k++) sim.step([]);
    expect(e.hp[0]!).toBeLessThan(before);
  });
});
