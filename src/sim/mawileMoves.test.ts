import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import derivations from '../../data/game/derivations.json';
import learnsets from '../../data/game/learnsets.json';
import { Simulation } from './simulation';

/** クチートの系統の見直し: ★じゃれつく（ホウエンの版。07 の280章） */
function setup() {
  const rules = buildSimRules('hoenn');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const m = moveIndexOf(rules, 'play-rough-hoenn');
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, moves: [{ move: m, level: 1 }] });
  p.facingX = 1;
  p.facingY = 0;
  const pr = sim.world.projectiles;
  return { rules, sim, p, m, pr };
}

describe('じゃれつく（ホウエン）', () => {
  it('前の一番強い敵へ飛びかかり、そこに土けむりが残って何度も当たる', () => {
    const t = setup();
    const e = t.sim.world.enemies;
    e.add(1, 0, 180, 0, 1e6, 0, 30);
    const hp0 = e.hp[e.id.indexOf(1)]!;
    let cloud = false;
    const hits: number[] = [];
    for (let k = 0; k < 30; k++) {
      t.sim.step([]);
      for (let i = 0; i < t.pr.count; i++) if (t.pr.move[i] === t.m && t.pr.stage[i] === 1) cloud = true;
      hits.push(e.hp[e.id.indexOf(1)]!);
    }
    expect(cloud).toBe(true);
    // 相手の所まで跳んだ
    expect(t.p.x).toBeGreaterThan(140);
    // 何度かに分けて減る
    const drops = hits.filter((h, i) => i > 0 && h < hits[i - 1]!).length;
    expect(drops).toBeGreaterThanOrEqual(3);
    expect(hits[hits.length - 1]!).toBeLessThan(hp0);
  });

  it('クチートの アイアンヘッド から進化する。メタルバースト は覚えない', () => {
    const d = [...derivations.derivations, ...derivations.unique].find((x) => x.to === 'play-rough-hoenn') as { from: string; line?: string } | undefined;
    expect(d?.from).toBe('iron-head');
    expect(d?.line).toBe('mawile');
    const line = learnsets.lines.mawile as unknown[];
    expect(line).toContain('play-rough-hoenn');
    expect(line).not.toContain('metal-burst');
  });
});
