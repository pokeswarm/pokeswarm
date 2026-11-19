import { describe, expect, it } from 'vitest';
import { buildSimRules, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';

/** 遊べるファイヤー（07 の315章）: ゴッドバード（SPACE）・ねっぷう（Q）・もえつきる（E）はキーで使い、ひのこ は自動 */
function setup(moves?: { key: string; level: number }[]) {
  const rules = buildSimRules('kanto');
  const lo = playableLoadout(rules, 'moltres');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const ids = moves ? moves.map((m) => ({ move: rules.moves.findIndex((x) => x.key === m.key), level: m.level })) : lo.moves;
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 180, types: lo.types, species: lo.species, moves: ids, line: 'moltres', fixedMoves: lo.fixedMoves });
  return { rules, sim, p };
}

const all = [
  { key: 'sky-attack-moltres', level: 1 },
  { key: 'heat-wave-moltres', level: 1 },
  { key: 'burn-up-moltres', level: 1 },
];

describe('遊べるファイヤー', () => {
  it('最初の技は ゴッドバード・ねっぷう・もえつきる・ひのこ。キーは SPACE・Q・E。ルートは無い', () => {
    const { rules, p } = setup();
    expect(p.moves.map((m) => rules.moves[m.move]!.key)).toEqual(['sky-attack-moltres', 'heat-wave-moltres', 'burn-up-moltres', 'ember-moltres']);
    expect(p.skills!.map((s) => rules.activeSkills!.defs[s.skill]!.kind)).toEqual(['skyAttack', 'heatWave', 'burnUp']);
    expect(rules.derivations.filter((d) => d.line === 'moltres')).toEqual([]);
  });

  it('キーで使う技は自動では出ない', () => {
    const { rules, sim } = setup(all);
    sim.world.enemies.add(1, 0, 150, 0, 1e6, 0, 12, 0, 0, 0);
    for (let k = 0; k < 120; k++) sim.step([]);
    const keys = new Set(all.map((m) => rules.moves.findIndex((x) => x.key === m.key)));
    for (let i = 0; i < sim.world.projectiles.count; i++) expect(keys.has(sim.world.projectiles.move[i]!)).toBe(false);
  });

  it('ゴッドバード: ためている間は止まり、そのあと向きへ突き抜けて通り道の敵に当たる。燃える羽が残る', () => {
    const { rules, sim, p } = setup(all);
    const sa = rules.moves.findIndex((m) => m.key === 'sky-attack-moltres');
    const e = sim.world.enemies;
    p.facingX = 1;
    p.facingY = 0;
    e.add(1, 0, 300, 0, 1e7, 0, 12, 0, 0, 0);
    sim.step([]);
    sim.step([{ type: 'useSkill', playerId: 1, slot: 0 }]);
    for (let k = 0; k < 12; k++) sim.step([]);
    expect(p.x).toBeLessThan(5);
    expect(e.hp[0]).toBe(1e7);
    for (let k = 0; k < 30; k++) sim.step([]);
    expect(p.x).toBeGreaterThan(500);
    expect(e.hp[0]!).toBeLessThan(1e7);
    const pr = sim.world.projectiles;
    let feathers = 0;
    for (let i = 0; i < pr.count; i++) if (pr.move[i] === sa && pr.stage[i] === 1) feathers++;
    expect(feathers).toBeGreaterThan(5);
  });

  it('ねっぷう: 外へ広がる熱波が 3 回、前の敵に当たる', () => {
    const { rules, sim, p } = setup(all);
    const hw = rules.moves.findIndex((m) => m.key === 'heat-wave-moltres');
    const e = sim.world.enemies;
    p.facingX = 1;
    p.facingY = 0;
    e.add(1, 0, 200, 0, 1e7, 0, 12, 0, 0, 0);
    sim.step([]);
    sim.step([{ type: 'useSkill', playerId: 1, slot: 1 }]);
    const pr = sim.world.projectiles;
    let waves = 0;
    for (let i = 0; i < pr.count; i++) if (pr.move[i] === hw) waves++;
    expect(waves).toBe(3);
    const hp: number[] = [];
    for (let k = 0; k < 40; k++) {
      sim.step([]);
      hp.push(e.hp[0]!);
    }
    const drops = hp.filter((v, k) => k > 0 && v < hp[k - 1]!).length;
    expect(drops).toBeGreaterThanOrEqual(3);
  });

  it('もえつきる: 炎の玉が落ちて当たり、そのあと ほのおタイプを失って速くなる。時間が来ると戻る', () => {
    const { rules, sim, p } = setup(all);
    const fire = rules.moves.find((m) => m.key === 'burn-up-moltres')!.type;
    const e = sim.world.enemies;
    p.facingX = 1;
    p.facingY = 0;
    e.add(1, 0, 250, 0, 1e7, 0, 12, 0, 0, 0);
    expect(p.types).toContain(fire);
    sim.step([]);
    sim.step([{ type: 'useSkill', playerId: 1, slot: 2 }]);
    expect(p.burnedOut).toBeDefined();
    // 玉が落ちるまでは ほのおタイプのまま
    for (let k = 0; k < 20; k++) sim.step([]);
    expect(p.types).toContain(fire);
    for (let k = 0; k < 12; k++) sim.step([]);
    expect(e.hp[0]!).toBeLessThan(1e7);
    expect(p.types).not.toContain(fire);
    // 速く動く
    const x0 = p.x;
    for (let k = 0; k < 30; k++) sim.step([{ type: 'move', playerId: 1, dx: -1, dy: 0 }]);
    expect(x0 - p.x).toBeGreaterThan(180 * 1.2);
    for (let k = 0; k < 300; k++) sim.step([]);
    expect(p.burnedOut).toBeUndefined();
    expect(p.types).toContain(fire);
  });
});
