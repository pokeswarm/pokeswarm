import { describe, expect, it } from 'vitest';
import { buildSimRules, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { FROST_ENCASED, frostFull } from './systems/attack';
import { speedMultiplier } from './systems/status';

/** 遊べるフリーザー（07 の314章）: フリーズドライ（SPACE）・こごえるかぜ（Q）・ふぶき（E）はキーで使い、こおりのつぶて は自動 */
function setup(moves?: { key: string; level: number }[]) {
  const rules = buildSimRules('kanto');
  const lo = playableLoadout(rules, 'articuno');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const ids = moves ? moves.map((m) => ({ move: rules.moves.findIndex((x) => x.key === m.key), level: m.level })) : lo.moves;
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 180, types: lo.types, species: lo.species, moves: ids, line: 'articuno', fixedMoves: lo.fixedMoves });
  return { rules, sim, p };
}

const all = [
  { key: 'freeze-dry-articuno', level: 1 },
  { key: 'icy-wind-articuno', level: 1 },
  { key: 'blizzard-articuno', level: 1 },
];

describe('遊べるフリーザー', () => {
  it('最初の技は フリーズドライ・こごえるかぜ・ふぶき・こおりのつぶて。キーは SPACE・Q・E。ルートは無い', () => {
    const { rules, p } = setup();
    expect(p.moves.map((m) => rules.moves[m.move]!.key)).toEqual(['freeze-dry-articuno', 'icy-wind-articuno', 'blizzard-articuno', 'ice-shard-articuno']);
    expect(p.skills!.map((s) => rules.activeSkills!.defs[s.skill]!.kind)).toEqual(['freezeDry', 'icyWind', 'blizzard']);
    expect(rules.derivations.filter((d) => d.line === 'articuno')).toEqual([]);
  });

  it('キーで使う技は自動では出ない', () => {
    const { rules, sim } = setup(all);
    sim.world.enemies.add(1, 0, 150, 0, 1e6, 0, 12, 0, 0, 0);
    for (let k = 0; k < 120; k++) sim.step([]);
    const keys = new Set(all.map((m) => rules.moves.findIndex((x) => x.key === m.key)));
    for (let i = 0; i < sim.world.projectiles.count; i++) expect(keys.has(sim.world.projectiles.move[i]!)).toBe(false);
  });

  it('こごえるかぜ: 前の扇の敵に当たり、しもやけ を重ねて遅くする', () => {
    const { sim, p } = setup(all);
    const e = sim.world.enemies;
    p.facingX = 1;
    p.facingY = 0;
    e.add(1, 0, 200, 0, 1e7, 0, 12, 0, 0, 0);
    sim.step([]);
    sim.step([{ type: 'useSkill', playerId: 1, slot: 1 }]);
    for (let k = 0; k < 24; k++) sim.step([]);
    expect(e.hp[0]!).toBeLessThan(1e7);
    expect(e.frost[0]!).toBeGreaterThanOrEqual(3);
    expect(speedMultiplier(sim.world, 0)).toBeLessThan(0.8);
  });

  it('ふぶき: 前へ進む帯が、中の敵に何度も当たって しもやけ を重ねる', () => {
    const { sim, p } = setup(all);
    const e = sim.world.enemies;
    p.facingX = 1;
    p.facingY = 0;
    e.add(1, 0, 180, 0, 1e7, 0, 12, 0, 0, 0);
    sim.step([]);
    sim.step([{ type: 'useSkill', playerId: 1, slot: 2 }]);
    for (let k = 0; k < 60; k++) sim.step([]);
    expect(e.hp[0]!).toBeLessThan(1e7);
    expect(e.frost[0]!).toBeGreaterThanOrEqual(3);
  });

  it('フリーズドライ: 向きへ 2 本の霜の線。少し後に氷のとげが当たり、霜の線が残る', () => {
    const { rules, sim, p } = setup(all);
    const fd = rules.moves.findIndex((m) => m.key === 'freeze-dry-articuno');
    const e = sim.world.enemies;
    p.facingX = 1;
    p.facingY = 0;
    e.add(1, 0, 200, 0, 1e7, 0, 12, 0, 0, 0);
    sim.step([]);
    sim.step([{ type: 'useSkill', playerId: 1, slot: 0 }]);
    expect(e.hp[0]).toBe(1e7);
    for (let k = 0; k < 20; k++) sim.step([]);
    expect(e.hp[0]!).toBeLessThan(1e7);
    const pr = sim.world.projectiles;
    let lines = 0;
    for (let i = 0; i < pr.count; i++) if (pr.move[i] === fd && pr.stage[i] === 1 && pr.length[i]! > 0) lines++;
    expect(lines).toBe(2);
  });

  it('しもやけ を重ねきった敵に とげ が当たると氷漬け（こおり）になり、ダメージが大きい', () => {
    const hit = (stacks: number) => {
      const { rules, sim, p } = setup(all);
      const e = sim.world.enemies;
      p.facingX = 1;
      p.facingY = 0;
      e.add(1, 0, 200, 0, 1e7, 0, 12, 0, 0, 0);
      e.frost[0] = stacks;
      e.frostTicks[0] = 999;
      e.frostBy[0] = 1;
      sim.step([]);
      sim.step([{ type: 'useSkill', playerId: 1, slot: 0 }]);
      for (let k = 0; k < 20; k++) sim.step([]);
      const freeze = rules.status.kinds.findIndex((s) => s.id === 'freeze');
      return { dmg: 1e7 - e.hp[0]!, encased: e.frost[0] === FROST_ENCASED, frozen: e.hasStatus(0, freeze) };
    };
    const { sim } = setup(all);
    const full = frostFull(sim.world);
    expect(full).toBe(5);
    const plain = hit(1);
    const combo = hit(full - 1);
    expect(plain.encased).toBe(false);
    expect(combo.encased).toBe(true);
    expect(combo.frozen).toBe(true);
    expect(combo.dmg).toBeGreaterThan(plain.dmg * 1.8);
  });
});
