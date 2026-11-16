import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import derivations from '../../data/game/derivations.json';
import learnsets from '../../data/game/learnsets.json';
import { Simulation } from './simulation';

/** ラクライの系統の見直し: ★ワイルドボルト（ホウエンの版。07 の276章） */
function setup() {
  const rules = buildSimRules('hoenn');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const m = moveIndexOf(rules, 'wild-charge-hoenn');
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, moves: [{ move: m, level: 1 }] });
  p.facingX = 1;
  p.facingY = 0;
  const pr = sim.world.projectiles;
  const find = (pred: (i: number) => boolean): number[] => [...Array(pr.count).keys()].filter(pred);
  return { rules, sim, p, m, pr, find };
}

describe('ワイルドボルト（ホウエン）', () => {
  it('前の一番強い敵へ突っ込み、手前で止まって放電する。途中の雑魚にも当たる', () => {
    const t = setup();
    const e = t.sim.world.enemies;
    e.add(1, 0, 60, 0, 50, 0, 10);
    e.add(2, 0, 200, 0, 1e6, 0, 30);
    const hp0 = e.hp[e.id.indexOf(1)]!;
    const big0 = e.hp[e.id.indexOf(2)]!;
    let discharged = false;
    for (let k = 0; k < 14; k++) {
      t.sim.step([]);
      if (t.find((i) => t.pr.move[i] === t.m && t.pr.stage[i] === 1).length > 0) discharged = true;
    }
    expect(discharged).toBe(true);
    // 敵の手前（200 − 30 − 12）まで進んだ
    expect(t.p.x).toBeGreaterThan(140);
    expect(t.p.x).toBeLessThan(200);
    const small = e.id.indexOf(1);
    expect(small === -1 || e.hp[small]! < hp0).toBe(true);
    expect(e.hp[e.id.indexOf(2)]!).toBeLessThan(big0);
  });

  it('当てると反動で HP が減る', () => {
    const t = setup();
    t.sim.world.enemies.add(2, 0, 150, 0, 1e6, 0, 30);
    const hp0 = t.p.hp;
    for (let k = 0; k < 14; k++) t.sim.step([]);
    expect(t.p.hp).toBeLessThan(hp0);
  });

  it('ライボルトの かみなりのキバ から、すてみタックル Lv8 で進化する。ボルトチェンジ は覚えない', () => {
    const d = [...derivations.derivations, ...derivations.unique].find((x) => x.to === 'wild-charge-hoenn') as { from: string; forms?: string[]; needsMoves?: { move: string }[] } | undefined;
    expect(d?.from).toBe('thunder-fang');
    expect(d?.forms).toEqual(['manectric']);
    expect(d?.needsMoves?.[0]?.move).toBe('double-edge');
    const line = learnsets.lines.electrike as unknown[];
    expect(line).toContain('wild-charge-hoenn');
    expect(line).not.toContain('volt-switch');
    expect(line).not.toContain('wild-charge');
  });
});
