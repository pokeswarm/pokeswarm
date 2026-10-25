import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';

/**
 * しんそくのリワーク（作者の案 2026年10月25日）: 次に跳ぶ敵は少し離れた敵を選んで広く倒す。
 * ウィンディの姿なら、跳んだ道（残像）に小さな炎が残る
 */
function setup(species: string) {
  const rules = buildSimRules();
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const lo = playableLoadout(rules, 'growlithe');
  const move = moveIndexOf(rules, 'extreme-speed');
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, types: lo.types, moveTypes: lo.moveTypes, moves: [{ move, level: 1 }], line: lo.line, species: rules.species.findIndex((s) => s.key === species) });
  // 横一列に、間を詰めて敵を並べる
  for (let k = 0; k < 12; k++) sim.world.enemies.add(k + 1, 0, 60 + k * 20, 0, 1e6, 0, 8);
  return { sim, p, move };
}

function run(species: string): { flames: number; hops: number[] } {
  const { sim, move } = setup(species);
  let flames = 0;
  // 跳んだ線（通し番号ごとの、始まりの x と長さ）
  const hops = new Map<number, [number, number]>();
  for (let t = 0; t < 20; t++) {
    sim.step([]);
    const pr = sim.world.projectiles;
    for (let i = 0; i < pr.count; i++) {
      if (pr.move[i] !== move) continue;
      if (pr.stage[i] === 1) flames++;
      if (pr.stage[i] === 0) hops.set(pr.serial[i]!, [pr.x[i]!, pr.length[i]!]);
    }
  }
  return { flames, hops: [...hops.values()].filter(([x]) => x !== 0).map(([, len]) => len) };
}

describe('しんそく', () => {
  it('ウィンディの姿なら跳んだ道に炎が残り、ガーディでは残らない', () => {
    expect(run('arcanine').flames).toBeGreaterThan(0);
    expect(run('growlithe').flames).toBe(0);
  });

  it('2回目からは、今の場所から少し離れた敵へ跳ぶ（隣の敵へは跳ばない）', () => {
    // プレイヤーから跳ぶ1回目を除いた、敵から敵への線の長さ（敵は 20 ごとに並んでいる）
    const hops = run('growlithe').hops;
    expect(hops.length).toBeGreaterThanOrEqual(3);
    for (const len of hops) expect(len).toBeGreaterThanOrEqual(70);
  });
});
