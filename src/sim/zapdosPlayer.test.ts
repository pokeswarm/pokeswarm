import { describe, expect, it } from 'vitest';
import { buildSimRules, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { zapNetwork } from './systems/attack';

/** 遊べるサンダー（07 の316章）: ドリルくちばし（SPACE）・でんじほう（Q）・10まんボルト（E）はキーで使い、でんきショック は自動 */
function setup(moves?: { key: string; level: number }[]) {
  const rules = buildSimRules('kanto');
  const lo = playableLoadout(rules, 'zapdos');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const ids = moves ? moves.map((m) => ({ move: rules.moves.findIndex((x) => x.key === m.key), level: m.level })) : lo.moves;
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 180, types: lo.types, species: lo.species, moves: ids, line: 'zapdos', fixedMoves: lo.fixedMoves });
  return { rules, sim, p };
}

const all = [
  { key: 'drill-peck-zapdos', level: 1 },
  { key: 'zap-cannon-zapdos', level: 1 },
  { key: 'thunderbolt-zapdos', level: 1 },
];

describe('遊べるサンダー', () => {
  it('最初の技は ドリルくちばし・でんじほう・10まんボルト・でんきショック。キーは SPACE・Q・E。ルートは無い', () => {
    const { rules, p } = setup();
    expect(p.moves.map((m) => rules.moves[m.move]!.key)).toEqual(['drill-peck-zapdos', 'zap-cannon-zapdos', 'thunderbolt-zapdos', 'thunder-shock-zapdos']);
    expect(p.skills!.map((s) => rules.activeSkills!.defs[s.skill]!.kind)).toEqual(['drillPeck', 'zapCannon', 'thunderbolt']);
    expect(p.skills![1]!.charges).toBe(3);
    expect(rules.derivations.filter((d) => d.line === 'zapdos')).toEqual([]);
  });

  it('キーで使う技は自動では出ない', () => {
    const { rules, sim } = setup(all);
    sim.world.enemies.add(1, 0, 150, 0, 1e6, 0, 12, 0, 0, 0);
    for (let k = 0; k < 120; k++) sim.step([]);
    const keys = new Set(all.map((m) => rules.moves.findIndex((x) => x.key === m.key)));
    for (let i = 0; i < sim.world.projectiles.count; i++) expect(keys.has(sim.world.projectiles.move[i]!)).toBe(false);
  });

  it('ドリルくちばし: 向きへ突き抜けて通り道の敵に当たる', () => {
    const { sim, p } = setup(all);
    const e = sim.world.enemies;
    p.facingX = 1;
    p.facingY = 0;
    e.add(1, 0, 200, 0, 1e7, 0, 12, 0, 0, 0);
    sim.step([]);
    sim.step([{ type: 'useSkill', playerId: 1, slot: 0 }]);
    for (let k = 0; k < 20; k++) sim.step([]);
    expect(p.x).toBeGreaterThan(350);
    expect(e.hp[0]!).toBeLessThan(1e7);
  });

  it('でんじほう: ゆっくり進む球。2 つ撃つと帯でつながり、帯の上の敵に当たる', () => {
    const { sim, p } = setup(all);
    const e = sim.world.enemies;
    p.facingX = 1;
    p.facingY = 0;
    sim.step([]);
    sim.step([{ type: 'useSkill', playerId: 1, slot: 1 }]);
    p.facingX = 0;
    p.facingY = 1;
    sim.step([{ type: 'useSkill', playerId: 1, slot: 1 }]);
    const net = zapNetwork(sim.world, 1);
    expect(net.spheres.length).toBe(2);
    expect(net.links.length).toBe(1);
    // 帯の真ん中あたりに敵を置く
    for (let k = 0; k < 15; k++) sim.step([]);
    const n2 = zapNetwork(sim.world, 1);
    const A = n2.spheres[0]!;
    const B = n2.spheres[1]!;
    e.add(1, 0, (A.x + B.x) / 2, (A.y + B.y) / 2, 1e7, 0, 12, 0, 0, 0);
    for (let k = 0; k < 20; k++) sim.step([]);
    expect(e.hp[0]!).toBeLessThan(1e7);
  });

  it('10まんボルト が でんじほう の網に当たると、つながった球が全部はじけて大きなダメージ', () => {
    const run = (withNet: boolean) => {
      const { sim, p } = setup(all);
      const e = sim.world.enemies;
      p.facingX = 0;
      p.facingY = 1;
      sim.step([]);
      if (withNet) {
        sim.step([{ type: 'useSkill', playerId: 1, slot: 1 }]);
        p.facingX = 1;
        p.facingY = 0;
        sim.step([{ type: 'useSkill', playerId: 1, slot: 1 }]);
        for (let k = 0; k < 10; k++) sim.step([]);
      }
      // 右の球のそばに敵（自然に出る敵と番号が重ならないように）
      e.add(9001, 0, 90, 0, 1e7, 0, 12, 0, 0, 0);
      const hpOf = (): number => {
        for (let i = 0; i < e.count; i++) if (e.id[i] === 9001) return e.hp[i]!;
        return 0;
      };
      p.facingX = 1;
      p.facingY = 0;
      sim.step([{ type: 'useSkill', playerId: 1, slot: 2 }]);
      for (let k = 0; k < 15; k++) sim.step([]);
      return { dmg: 1e7 - hpOf(), left: zapNetwork(sim.world, 1).spheres.length };
    };
    const plain = run(false);
    const combo = run(true);
    expect(combo.left).toBe(0);
    expect(combo.dmg).toBeGreaterThan(plain.dmg * 2);
  });
});
