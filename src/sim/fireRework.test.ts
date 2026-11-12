import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { SHAPE_LINE } from './entities/projectiles';
import { fireCasterMove } from './systems/attack';

/** ほのおの技の調整（作者の依頼 2026年10月31日。07 の145章） */
function setup(pokemon: string, move: string, region: string, level = 1) {
  const rules = buildSimRules(region);
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const lo = playableLoadout(rules, pokemon);
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, types: lo.types, moveTypes: lo.moveTypes, moves: [{ ...lo.moves[0]!, move: moveIndexOf(rules, move), level }], line: lo.line, species: lo.species });
  return { rules, sim, p };
}

describe('ブレイズキック', () => {
  it('自分を含む前に長い長方形（届く距離の −0.3〜1.0 倍、片側の幅 0.3 倍）で、溜めてから出す', () => {
    const { rules, sim, p } = setup('torchic', 'blaze-kick', 'hoenn');
    const def = rules.moves[moveIndexOf(rules, 'blaze-kick')]!;
    expect(def.pattern).toBe('melee');
    expect(def.frontBox).toEqual({ start: -0.3, end: 1, halfWidth: 0.3 });
    p.facingX = 1;
    p.facingY = 0;
    // 溜め（0.5 秒）の間は当たり判定が出ない
    for (let t = 0; t < 10; t++) sim.step([]);
    expect(sim.world.projectiles.count).toBe(0);
    for (let t = 0; t < 8; t++) sim.step([]);
    const pr = sim.world.projectiles;
    expect(pr.count).toBeGreaterThanOrEqual(1);
    // 届く距離 = range 90 + size 30
    expect(pr.radius[0]).toBe(120);
    expect(pr.length[0]).toBeCloseTo(36, 5);
  });

  it('燃える道は、長方形に内接する向きに沿った線（太さは長方形の幅）になる', () => {
    const { sim, p } = setup('torchic', 'blaze-kick', 'hoenn');
    p.facingX = 1;
    p.facingY = 0;
    for (let t = 0; t < 18; t++) sim.step([]);
    const pr = sim.world.projectiles;
    let line = -1;
    for (let i = 0; i < pr.count; i++) if (pr.shape[i] === SHAPE_LINE && pr.linger[i] === 1) line = i;
    expect(line).not.toBe(-1);
    // 長方形: 向き x で −36〜120、横 ±36。線は x = 0 から x 方向に走り、半径 36・長さ 156 − 72 = 84
    expect(pr.radius[line]).toBeCloseTo(36, 5);
    expect(pr.length[line]).toBeCloseTo(84, 5);
    expect(pr.x[line]).toBeCloseTo(0, 5);
    expect(pr.y[line]).toBeCloseTo(0, 5);
    expect(pr.dirX[line]).toBeCloseTo(1, 5);
  });
});

describe('ブラストバーン（07 の234章）', () => {
  it('プレイヤーの技は 4 方向 × 3 段で、一番近い柱は距離 100。足元に寄った敵にも届く', () => {
    const { rules, sim } = setup('charmander', 'blast-burn', 'kanto');
    const def = rules.moves[moveIndexOf(rules, 'blast-burn')]!;
    expect(def.levels[def.levels.length - 1]!.range).toBe(300);
    sim.step([]);
    const pr = sim.world.projectiles;
    // 爆炎の柱は段の数だけ先に出す（遅れて現れる段も数える）
    const pillars = Array.from({ length: pr.count }, (_, i) => i).filter((i) => pr.stage[i] === 0 || pr.stage[i] === 3);
    expect(pillars).toHaveLength(12);
    expect(Math.min(...pillars.map((i) => Math.hypot(pr.x[i]!, pr.y[i]!)))).toBeCloseTo(100, 5);
  });

  it('一番近い敵の足元にも柱が立ち、重なっていても離れていても、その敵にはその 1 本だけが当たる', () => {
    const dealt: number[] = [];
    for (const x of [0, 40, 100, 250]) {
      const { sim, p } = setup('charmander', 'blast-burn', 'kanto');
      p.facingX = 1;
      p.facingY = 0;
      sim.world.enemies.add(1, 0, x, 0, 1e7, 0, 60);
      sim.step([]);
      const pr = sim.world.projectiles;
      const pillars = Array.from({ length: pr.count }, (_, i) => i).filter((i) => pr.stage[i] === 0 || pr.stage[i] === 3);
      expect(pillars).toHaveLength(13);
      // 足元の柱だけが、その敵を避けない
      const free = pillars.filter((i) => pr.avoid[i] === 0);
      expect(free).toHaveLength(1);
      expect(pr.x[free[0]!]).toBeCloseTo(x, 5);
      for (let t = 0; t < 24; t++) sim.step([]);
      dealt.push(1e7 - sim.world.enemies.hp[0]!);
    }
    // どの距離でも、ほぼ同じだけ当たる（十字の柱が重ならない）
    expect(Math.min(...dealt)).toBeGreaterThan(0);
    expect(Math.max(...dealt) / Math.min(...dealt)).toBeLessThan(1.3);
  });

  it('届く範囲に敵がいなければ、足元の柱は立たない', () => {
    const { sim, p } = setup('charmander', 'blast-burn', 'kanto');
    p.facingX = 1;
    p.facingY = 0;
    sim.world.enemies.add(1, 0, 900, 0, 1e7, 0, 10);
    sim.step([]);
    const pr = sim.world.projectiles;
    expect(Array.from({ length: pr.count }, (_, i) => i).filter((i) => pr.stage[i] === 0 || pr.stage[i] === 3)).toHaveLength(12);
  });

  it('色違いのリザードンの ブラストバーン は、プレイヤーの技を変えても 8 方向・距離 460・威力 68.8 のまま', () => {
    const rules = buildSimRules('kanto');
    const pm = rules.stage.moves.find((m) => m.id === 'charizard-blast-burn')!.playerMove!;
    expect(pm).toMatchObject({ move: 'blast-burn', level: 8, count: 8, range: 460, power: 68.8 });
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    const caster = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, moves: [] });
    fireCasterMove(sim.world, caster, moveIndexOf(rules, 'blast-burn'), pm.level, pm);
    const pr = sim.world.projectiles;
    const pillars = Array.from({ length: pr.count }, (_, i) => i).filter((i) => pr.stage[i] === 0 || pr.stage[i] === 3);
    expect(pillars).toHaveLength(24);
    expect(Math.max(...pillars.map((i) => Math.hypot(pr.x[i]!, pr.y[i]!)))).toBeCloseTo(460, 5);
  });
});

describe('ふんか', () => {
  it('使ったときの足元の爆発は、ふんえんと同じ外へ広がる輪（帯）になる', () => {
    const { sim } = setup('cyndaquil', 'eruption', 'johto');
    sim.step([]);
    const pr = sim.world.projectiles;
    let ring = -1;
    for (let i = 0; i < pr.count; i++) if (pr.stage[i] === 1 && pr.band[i]! > 0) ring = i;
    expect(ring).not.toBe(-1);
    // 大きさ 24 × 4.5 = 108 の円を、厚さ 0.45 の帯が 0.5 秒で広がる
    expect(pr.band[ring]).toBeCloseTo(108 * 0.45, 5);
    expect(pr.growth[ring]).toBeCloseTo((108 - 108 * 0.45) / 0.5, 5);
    expect(pr.maxLife[ring]).toBeCloseTo(0.5, 5);
  });
});

