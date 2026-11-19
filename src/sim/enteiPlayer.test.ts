import { describe, expect, it } from 'vitest';
import { buildSimRules, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';

/** 遊べるエンテイ（07 の313章）: ふんか（SPACE）・ふんえん（Q）・オーバーヒート（E）はキーで使い、せいなるほのお は自動 */
function setup(moves?: { key: string; level: number }[]) {
  const rules = buildSimRules('johto');
  const lo = playableLoadout(rules, 'entei');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const ids = moves ? moves.map((m) => ({ move: rules.moves.findIndex((x) => x.key === m.key), level: m.level })) : lo.moves;
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 180, types: lo.types, species: lo.species, moves: ids, line: 'entei', fixedMoves: lo.fixedMoves });
  return { rules, sim, p };
}

const all = [
  { key: 'eruption-entei', level: 1 },
  { key: 'lava-plume-entei', level: 1 },
  { key: 'overheat-entei', level: 1 },
];

describe('遊べるエンテイ', () => {
  it('最初の技は ふんか・ふんえん・オーバーヒート・せいなるほのお。キーは SPACE・Q・E。ルートは無い', () => {
    const { rules, p } = setup();
    expect(p.moves.map((m) => rules.moves[m.move]!.key)).toEqual(['eruption-entei', 'lava-plume-entei', 'overheat-entei', 'sacred-fire-entei']);
    expect(p.skills!.map((s) => rules.activeSkills!.defs[s.skill]!.kind)).toEqual(['eruption', 'lavaPlume', 'overheat']);
    expect(rules.derivations.filter((d) => d.line === 'entei')).toEqual([]);
  });

  it('キーで使う技は自動では出ない', () => {
    const { rules, sim } = setup(all);
    sim.world.enemies.add(1, 0, 150, 0, 1e6, 0, 12, 0, 0, 0);
    for (let k = 0; k < 120; k++) sim.step([]);
    const keys = new Set(all.map((m) => rules.moves.findIndex((x) => x.key === m.key)));
    for (let i = 0; i < sim.world.projectiles.count; i++) expect(keys.has(sim.world.projectiles.move[i]!)).toBe(false);
  });

  it('ふんか: HP が多いほど火山弾が多い。前の区画に落ちて当たる', () => {
    const count = (hpPct: number) => {
      const { rules, sim, p } = setup(all);
      p.hp = (p.maxHp * hpPct) / 100;
      sim.step([{ type: 'useSkill', playerId: 1, slot: 0 }]);
      const er = rules.moves.findIndex((m) => m.key === 'eruption-entei');
      let n = 0;
      for (let i = 0; i < sim.world.projectiles.count; i++) if (sim.world.projectiles.move[i] === er) n++;
      return n;
    };
    expect(count(100)).toBeGreaterThan(count(20));
    const { sim, p } = setup(all);
    const e = sim.world.enemies;
    p.facingX = 1;
    p.facingY = 0;
    e.add(1, 0, 240, 0, 1e7, 0, 120, 0, 0, 0);
    sim.step([]);
    sim.step([{ type: 'useSkill', playerId: 1, slot: 0 }]);
    for (let k = 0; k < 45; k++) sim.step([]);
    expect(e.hp[0]!).toBeLessThan(1e7);
  });

  it('ふんえん: 向きへ 3 本の地割れ。根元から順に溶岩が噴いて当たり、割れ目が残る', () => {
    const { rules, sim, p } = setup(all);
    const lp = rules.moves.findIndex((m) => m.key === 'lava-plume-entei');
    const e = sim.world.enemies;
    p.facingX = 1;
    p.facingY = 0;
    e.add(1, 0, 200, 0, 1e7, 0, 12, 0, 0, 0);
    sim.step([]);
    sim.step([{ type: 'useSkill', playerId: 1, slot: 1 }]);
    for (let k = 0; k < 20; k++) sim.step([]);
    expect(e.hp[0]!).toBeLessThan(1e7);
    const pr = sim.world.projectiles;
    let cracks = 0;
    for (let i = 0; i < pr.count; i++) if (pr.move[i] === lp && pr.stage[i] === 1 && pr.length[i]! > 0) cracks++;
    expect(cracks).toBe(3);
  });

  it('ふんか は ふんえん の割れ目が残っていれば全部そこへ落ちて噴火する（コンボ）', () => {
    const { rules, sim, p } = setup(all);
    const er = rules.moves.findIndex((m) => m.key === 'eruption-entei');
    p.facingX = 1;
    p.facingY = 0;
    sim.step([]);
    sim.step([{ type: 'useSkill', playerId: 1, slot: 1 }]);
    for (let k = 0; k < 5; k++) sim.step([]);
    // 向きを変えても割れ目へ落ちる
    p.facingX = -1;
    sim.step([{ type: 'useSkill', playerId: 1, slot: 0 }]);
    const pr = sim.world.projectiles;
    let combo = 0;
    let other = 0;
    for (let i = 0; i < pr.count; i++) {
      if (pr.move[i] !== er) continue;
      if (pr.armStage[i] === 1 && pr.x[i]! > 0) combo++;
      else other++;
    }
    expect(combo).toBeGreaterThan(0);
    expect(other).toBe(0);
  });

  it('オーバーヒート: 少し後に前へ巨大な炎が当たり、そのあと ほのおの技が弱まる', () => {
    const { sim, p } = setup(all);
    const e = sim.world.enemies;
    p.facingX = 1;
    p.facingY = 0;
    e.add(1, 0, 300, 0, 1e7, 0, 12, 0, 0, 0);
    sim.step([]);
    sim.step([{ type: 'useSkill', playerId: 1, slot: 2 }]);
    expect(p.overheat).toBeDefined();
    expect(e.hp[0]).toBe(1e7);
    for (let k = 0; k < 30; k++) sim.step([]);
    expect(e.hp[0]!).toBeLessThan(1e7);
    for (let k = 0; k < 200; k++) sim.step([]);
    expect(p.overheat).toBeUndefined();
  });
});
