import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import { Simulation } from './simulation';

/** ラルトスの系統の見直し: ★みらいよち（サーナイト）を一番強い敵へ重ねる技に（07 の277章） */
function setup(level = 1) {
  const rules = buildSimRules('hoenn');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const m = moveIndexOf(rules, 'future-sight-gardevoir');
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, moves: [{ move: m, level }] });
  return { rules, sim, p, m };
}

describe('みらいよち（サーナイト）', () => {
  it('一番強い敵に印を重ね、まとめて大きく弾ける', () => {
    const t = setup();
    const e = t.sim.world.enemies;
    e.add(1, 0, 120, 0, 1e6, 0, 30);
    for (let k = 0; k < 6; k++) e.add(10 + k, 0, -150, -60 + k * 25, 1e6, 0, 10);
    const big = e.id.indexOf(1);
    const pr = t.sim.world.projectiles;
    let one = 0;
    let marks = 0;
    for (let k = 0; k < 25 && !one; k++) {
      t.sim.step([]);
      for (let i = 0; i < pr.count; i++) if (pr.move[i] === t.m && pr.stage[i] === 0) {
        marks++;
        one = pr.damage[i]! * t.rules.moves[t.m]!.delayedBlast!.powerMultiplier;
      }
    }
    // 6 発がすべてその敵に重なっている（時間は最初の印のまま）
    expect(marks).toBe(6);
    expect(e.markDamage[big]!).toBeCloseTo(one * 6);
    // 雑魚には付けない
    for (let k = 0; k < 6; k++) expect(e.markTicks[e.id.indexOf(10 + k)]).toBe(0);
  });
});

describe('アブソルは みらいよち を覚えない（07 の277章）', () => {
  it('イカサマ の条件は きりさく Lv8', async () => {
    const { derivationsConfig, learnsetsConfig } = await import('../data');
    const all = [...derivationsConfig.derivations, ...derivationsConfig.unique] as { from: string; to: string; line?: string; needsMoves?: { move: string }[] }[];
    expect(all.some((d) => d.line === 'absol' && d.to === 'future-sight')).toBe(false);
    expect(learnsetsConfig.lines.absol).not.toContain('future-sight');
    expect(all.find((d) => d.to === 'foul-play')?.needsMoves?.[0]?.move).toBe('slash');
  });
});
