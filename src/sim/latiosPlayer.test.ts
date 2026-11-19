import { describe, expect, it } from 'vitest';
import { buildSimRules, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { skillPowerPct } from './activeSkills';

/** 遊べるラティオス（07 の320章）: ラスターパージ（SPACE）・りゅうのまい（Q）・りゅうせいぐん（E）はキーで使い、りゅうのいぶき は自動 */
function setup(moves?: { key: string; level: number }[]) {
  const rules = buildSimRules('hoenn');
  const lo = playableLoadout(rules, 'latios');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const ids = moves ? moves.map((m) => ({ move: rules.moves.findIndex((x) => x.key === m.key), level: m.level })) : lo.moves;
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 180, types: lo.types, species: lo.species, moves: ids, line: 'latios', fixedMoves: lo.fixedMoves });
  return { rules, sim, p };
}

const all = [
  { key: 'luster-purge-latios', level: 1 },
  { key: 'dragon-dance-latios', level: 1 },
  { key: 'draco-meteor-latios', level: 1 },
];

/** 自然に出る敵と番号が重ならない敵を置いて、その HP を返す関数 */
function target(sim: Simulation, id: number, x: number, y: number): () => number {
  sim.world.enemies.add(id, 0, x, y, 1e7, 0, 12, 0, 0, 0);
  return () => {
    const e = sim.world.enemies;
    for (let i = 0; i < e.count; i++) if (e.id[i] === id) return e.hp[i]!;
    return 0;
  };
}

describe('遊べるラティオス', () => {
  it('最初の技は ラスターパージ・りゅうのまい・りゅうせいぐん・りゅうのいぶき。キーは SPACE・Q・E。ルートは無い', () => {
    const { rules, p } = setup();
    expect(p.moves.map((m) => rules.moves[m.move]!.key)).toEqual(['luster-purge-latios', 'dragon-dance-latios', 'draco-meteor-latios', 'dragon-breath-latios']);
    expect(p.skills!.map((s) => rules.activeSkills!.defs[s.skill]!.kind)).toEqual(['lusterPurge', 'dragonDance', 'dracoMeteor']);
    expect(rules.derivations.filter((d) => d.line === 'latios')).toEqual([]);
  });

  it('キーで使う技は自動では出ない', () => {
    const { rules, sim } = setup(all);
    sim.world.enemies.add(9001, 0, 150, 0, 1e6, 0, 12, 0, 0, 0);
    for (let k = 0; k < 120; k++) sim.step([]);
    const keys = new Set(all.map((m) => rules.moves.findIndex((x) => x.key === m.key)));
    for (let i = 0; i < sim.world.projectiles.count; i++) expect(keys.has(sim.world.projectiles.move[i]!)).toBe(false);
  });

  it('ラスターパージ: 光の玉が着いた所から、前へ光の爆発が順に走って当たる', () => {
    const { rules, sim, p } = setup(all);
    const lp = rules.moves.findIndex((m) => m.key === 'luster-purge-latios');
    p.facingX = 1;
    p.facingY = 0;
    const near = target(sim, 9001, 220, 0);
    const far = target(sim, 9002, 220 + 72 * 4, 0);
    sim.step([]);
    sim.step([{ type: 'useSkill', playerId: 1, slot: 0 }]);
    const pr = sim.world.projectiles;
    let n = 0;
    for (let i = 0; i < pr.count; i++) if (pr.move[i] === lp) n++;
    expect(n).toBe(5);
    for (let k = 0; k < 30; k++) sim.step([]);
    expect(near()).toBeLessThan(1e7);
    expect(far()).toBeLessThan(1e7);
  });

  it('りゅうのまい: 重ねるほど技の威力が上がり、速くなる（3 つまで）', () => {
    const { sim, p } = setup(all);
    for (let k = 0; k < 4; k++) {
      p.skills![1]!.charges = 1;
      sim.step([{ type: 'useSkill', playerId: 1, slot: 1 }]);
    }
    expect(p.dance!.stacks).toBe(3);
    expect(skillPowerPct(sim.world, p)).toBe(36);
    const x0 = p.x;
    for (let k = 0; k < 30; k++) sim.step([{ type: 'move', playerId: 1, dx: 1, dy: 0 }]);
    expect(p.x - x0).toBeGreaterThan(180 * 1.15);
  });

  it('りゅうせいぐん: 前の区画に流星が降る。りゅうのまい を重ねた分だけ増え、重ねは消える', () => {
    const count = (stacks: number) => {
      const { rules, sim, p } = setup(all);
      const dm = rules.moves.findIndex((m) => m.key === 'draco-meteor-latios');
      p.facingX = 1;
      p.facingY = 0;
      for (let k = 0; k < stacks; k++) {
        p.skills![1]!.charges = 1;
        sim.step([{ type: 'useSkill', playerId: 1, slot: 1 }]);
      }
      sim.step([{ type: 'useSkill', playerId: 1, slot: 2 }]);
      let n = 0;
      for (let i = 0; i < sim.world.projectiles.count; i++) if (sim.world.projectiles.move[i] === dm) n++;
      return { n, dance: p.dance };
    };
    const a = count(0);
    const b = count(2);
    expect(b.n).toBe(a.n + 6);
    expect(b.dance).toBeUndefined();
    const { sim, p } = setup(all);
    p.facingX = 1;
    p.facingY = 0;
    const hp = target(sim, 9001, 280, 0);
    sim.step([]);
    sim.step([{ type: 'useSkill', playerId: 1, slot: 2 }]);
    for (let k = 0; k < 45; k++) sim.step([]);
    expect(hp()).toBeLessThan(1e7);
  });
});
