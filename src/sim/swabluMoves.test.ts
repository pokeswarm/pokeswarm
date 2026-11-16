import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import derivations from '../../data/game/derivations.json';
import learnsets from '../../data/game/learnsets.json';
import { Simulation } from './simulation';

/** チルットの系統の見直し: ★ゴッドバード（ホウエンの版。07 の277章） */
function setup() {
  const rules = buildSimRules('hoenn');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const m = moveIndexOf(rules, 'sky-attack-hoenn');
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, moves: [{ move: m, level: 1 }] });
  p.facingX = 1;
  p.facingY = 0;
  return { rules, sim, p, m };
}

describe('ゴッドバード（ホウエン）', () => {
  it('溜めてから、前へまっすぐ飛び抜けて、通り道の敵すべてに当たる', () => {
    const t = setup();
    const e = t.sim.world.enemies;
    e.add(1, 0, 100, 0, 1e6, 0, 10);
    e.add(2, 0, 200, 0, 1e6, 0, 30);
    const hp1 = e.hp[e.id.indexOf(1)]!;
    const hp2 = e.hp[e.id.indexOf(2)]!;
    // 溜めている間は動かない
    for (let k = 0; k < 10; k++) t.sim.step([]);
    expect(t.p.x).toBeCloseTo(0);
    for (let k = 0; k < 20; k++) t.sim.step([]);
    // 一番強い敵（200）の手前で止まらず、抜けていく
    expect(t.p.x).toBeGreaterThan(230);
    expect(e.hp[e.id.indexOf(2)]!).toBeLessThan(hp2);
    const small = e.id.indexOf(1);
    expect(small === -1 || e.hp[small]! < hp1).toBe(true);
  });

  it('チルタリスの つばめがえし から、りゅうのはどう Lv8 で進化する。ブレイブバード は覚えない', () => {
    const d = [...derivations.derivations, ...derivations.unique].find((x) => x.to === 'sky-attack-hoenn') as { from: string; forms?: string[]; needsMoves?: { move: string }[] } | undefined;
    expect(d?.from).toBe('aerial-ace');
    expect(d?.forms).toEqual(['altaria']);
    expect(d?.needsMoves?.[0]?.move).toBe('dragon-pulse');
    const line = learnsets.lines.swablu as unknown[];
    expect(line).toContain('sky-attack-hoenn');
    expect(line).not.toContain('brave-bird');
  });
});
