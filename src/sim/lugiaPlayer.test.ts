import { describe, expect, it } from 'vitest';
import { buildSimRules, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';

/** 遊べるルギア（07 の317章）: エアロブラスト（SPACE）・じんつうりき（Q）・ハイドロポンプ（E）はキーで使い、かぜおこし は自動 */
function setup(moves?: { key: string; level: number }[]) {
  const rules = buildSimRules('johto');
  const lo = playableLoadout(rules, 'lugia');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const ids = moves ? moves.map((m) => ({ move: rules.moves.findIndex((x) => x.key === m.key), level: m.level })) : lo.moves;
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 180, types: lo.types, species: lo.species, moves: ids, line: 'lugia', fixedMoves: lo.fixedMoves });
  return { rules, sim, p };
}

const all = [
  { key: 'aeroblast-lugia', level: 1 },
  { key: 'extrasensory-lugia', level: 1 },
  { key: 'hydro-pump-lugia', level: 1 },
];

/** 自然に出る敵と番号が重ならない敵を置いて、その HP を返す関数 */
function target(sim: Simulation, id: number, x: number, y: number, speed = 0): () => number {
  sim.world.enemies.add(id, 0, x, y, 1e7, speed, 12, 0, 0, 0);
  return () => {
    const e = sim.world.enemies;
    for (let i = 0; i < e.count; i++) if (e.id[i] === id) return e.hp[i]!;
    return 0;
  };
}

describe('遊べるルギア', () => {
  it('最初の技は エアロブラスト・じんつうりき・ハイドロポンプ・かぜおこし。キーは SPACE・Q・E。ルートは無い', () => {
    const { rules, p } = setup();
    expect(p.moves.map((m) => rules.moves[m.move]!.key)).toEqual(['aeroblast-lugia', 'extrasensory-lugia', 'hydro-pump-lugia', 'gust-lugia']);
    expect(p.skills!.map((s) => rules.activeSkills!.defs[s.skill]!.kind)).toEqual(['aeroblast', 'extrasensory', 'hydroPump']);
    expect(rules.derivations.filter((d) => d.line === 'lugia')).toEqual([]);
  });

  it('キーで使う技は自動では出ない', () => {
    const { rules, sim } = setup(all);
    sim.world.enemies.add(9001, 0, 150, 0, 1e6, 0, 12, 0, 0, 0);
    for (let k = 0; k < 120; k++) sim.step([]);
    const keys = new Set(all.map((m) => rules.moves.findIndex((x) => x.key === m.key)));
    for (let i = 0; i < sim.world.projectiles.count; i++) expect(keys.has(sim.world.projectiles.move[i]!)).toBe(false);
  });

  it('エアロブラスト: ためて撃った玉が前の敵の所で爆ぜ、竜巻が残る', () => {
    const { rules, sim, p } = setup(all);
    const ab = rules.moves.findIndex((m) => m.key === 'aeroblast-lugia');
    p.facingX = 1;
    p.facingY = 0;
    const hp = target(sim, 9001, 250, 0);
    sim.step([]);
    sim.step([{ type: 'useSkill', playerId: 1, slot: 0 }]);
    for (let k = 0; k < 20; k++) sim.step([]);
    expect(hp()).toBe(1e7);
    for (let k = 0; k < 15; k++) sim.step([]);
    expect(hp()).toBeLessThan(1e7);
    const pr = sim.world.projectiles;
    let tornado = 0;
    for (let i = 0; i < pr.count; i++) if (pr.move[i] === ab && pr.stage[i] === 1) tornado++;
    expect(tornado).toBe(1);
  });

  it('じんつうりき: 前の近い敵の所で少し後にはじける', () => {
    const { sim, p } = setup(all);
    p.facingX = 1;
    p.facingY = 0;
    const a = target(sim, 9001, 150, 0);
    const b = target(sim, 9002, 200, 60);
    const behind = target(sim, 9003, -150, 0);
    sim.step([]);
    sim.step([{ type: 'useSkill', playerId: 1, slot: 1 }]);
    for (let k = 0; k < 15; k++) sim.step([]);
    expect(a()).toBeLessThan(1e7);
    expect(b()).toBeLessThan(1e7);
    expect(behind()).toBe(1e7);
  });

  it('ハイドロポンプ: ためてから扇をなぎ払う。竜巻に当たると水を吸って大きく強くなる', () => {
    const { rules, sim, p } = setup(all);
    const ab = rules.moves.findIndex((m) => m.key === 'aeroblast-lugia');
    p.facingX = 1;
    p.facingY = 0;
    const side = target(sim, 9001, 200, 150);
    sim.step([]);
    sim.step([{ type: 'useSkill', playerId: 1, slot: 0 }]);
    for (let k = 0; k < 30; k++) sim.step([]);
    const pr = sim.world.projectiles;
    let t = -1;
    for (let i = 0; i < pr.count; i++) if (pr.move[i] === ab && pr.stage[i] === 1) t = i;
    expect(t).not.toBe(-1);
    const r0 = pr.radius[t]!;
    sim.step([{ type: 'useSkill', playerId: 1, slot: 2 }]);
    for (let k = 0; k < 50; k++) sim.step([]);
    expect(side()).toBeLessThan(1e7);
    let wet = -1;
    for (let i = 0; i < pr.count; i++) if (pr.move[i] === ab && pr.stage[i] === 1) wet = i;
    expect(wet).not.toBe(-1);
    expect(pr.angle[wet]).toBe(1);
    expect(pr.radius[wet]!).toBeGreaterThan(r0 * 1.4);
  });
});
