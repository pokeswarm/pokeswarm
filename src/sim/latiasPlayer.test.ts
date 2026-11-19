import { describe, expect, it } from 'vitest';
import { buildSimRules, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';

/** 遊べるラティアス（07 の319章）: ミストボール（SPACE）・りゅうのはどう（Q）・いやしのはどう（E）はキーで使い、ねんりき は自動 */
function setup(moves?: { key: string; level: number }[]) {
  const rules = buildSimRules('hoenn');
  const lo = playableLoadout(rules, 'latias');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const ids = moves ? moves.map((m) => ({ move: rules.moves.findIndex((x) => x.key === m.key), level: m.level })) : lo.moves;
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 180, types: lo.types, species: lo.species, moves: ids, line: 'latias', fixedMoves: lo.fixedMoves });
  return { rules, sim, p };
}

const all = [
  { key: 'mist-ball-latias', level: 1 },
  { key: 'dragon-pulse-latias', level: 1 },
  { key: 'heal-pulse-latias', level: 1 },
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

describe('遊べるラティアス', () => {
  it('最初の技は ミストボール・りゅうのはどう・いやしのはどう・ねんりき。キーは SPACE・Q・E。ルートは無い', () => {
    const { rules, p } = setup();
    expect(p.moves.map((m) => rules.moves[m.move]!.key)).toEqual(['mist-ball-latias', 'dragon-pulse-latias', 'heal-pulse-latias', 'confusion-latias']);
    expect(p.skills!.map((s) => rules.activeSkills!.defs[s.skill]!.kind)).toEqual(['mistBall', 'dragonPulse', 'healPulse']);
    expect(rules.derivations.filter((d) => d.line === 'latias')).toEqual([]);
  });

  it('キーで使う技は自動では出ない', () => {
    const { rules, sim } = setup(all);
    sim.world.enemies.add(9001, 0, 150, 0, 1e6, 0, 12, 0, 0, 0);
    for (let k = 0; k < 120; k++) sim.step([]);
    const keys = new Set(all.map((m) => rules.moves.findIndex((x) => x.key === m.key)));
    for (let i = 0; i < sim.world.projectiles.count; i++) expect(keys.has(sim.world.projectiles.move[i]!)).toBe(false);
  });

  it('ミストボール: 前の敵に当たって弾け、そこに霧が残る（霧の中は こうげきダウン）', () => {
    const { rules, sim, p } = setup(all);
    const mb = rules.moves.findIndex((m) => m.key === 'mist-ball-latias');
    p.facingX = 1;
    p.facingY = 0;
    const hp = target(sim, 9001, 200, 0);
    sim.step([]);
    sim.step([{ type: 'useSkill', playerId: 1, slot: 0 }]);
    for (let k = 0; k < 32; k++) sim.step([]);
    expect(hp()).toBeLessThan(1e7);
    const pr = sim.world.projectiles;
    let mists = 0;
    for (let i = 0; i < pr.count; i++) if (pr.move[i] === mb && pr.stage[i] === 1) mists++;
    expect(mists).toBe(5);
    const down = rules.status.kinds.findIndex((s) => s.id === 'attackDown');
    const e = sim.world.enemies;
    let i9001 = -1;
    for (let i = 0; i < e.count; i++) if (e.id[i] === 9001) i9001 = i;
    expect(e.hasStatus(i9001, down)).toBe(true);
  });

  it('りゅうのはどう: 少しためてから、前へ太い波動が当たる', () => {
    const { sim, p } = setup(all);
    p.facingX = 1;
    p.facingY = 0;
    const hp = target(sim, 9001, 300, 0);
    sim.step([]);
    sim.step([{ type: 'useSkill', playerId: 1, slot: 1 }]);
    expect(hp()).toBe(1e7);
    for (let k = 0; k < 15; k++) sim.step([]);
    expect(hp()).toBeLessThan(1e7);
  });

  it('いやしのはどう: HP が戻り、残っている霧が光って弾ける（霧は消える）', () => {
    const { rules, sim, p } = setup(all);
    const mb = rules.moves.findIndex((m) => m.key === 'mist-ball-latias');
    p.facingX = 1;
    p.facingY = 0;
    sim.step([]);
    sim.step([{ type: 'useSkill', playerId: 1, slot: 0 }]);
    for (let k = 0; k < 30; k++) sim.step([]);
    const pr = sim.world.projectiles;
    let t = -1;
    for (let i = 0; i < pr.count; i++) if (pr.move[i] === mb && pr.stage[i] === 1) t = i;
    expect(t).not.toBe(-1);
    const hp = target(sim, 9002, pr.x[t]!, pr.y[t]!);
    p.hp = p.maxHp * 0.5;
    sim.step([]);
    const before = hp();
    sim.step([{ type: 'useSkill', playerId: 1, slot: 2 }]);
    expect(p.hp).toBeGreaterThan(p.maxHp * 0.6);
    for (let k = 0; k < 20; k++) sim.step([]);
    expect(before - hp()).toBeGreaterThan(900);
    let left = 0;
    for (let i = 0; i < pr.count; i++) if (pr.move[i] === mb && pr.stage[i] === 1) left++;
    expect(left).toBe(0);
  });
});
