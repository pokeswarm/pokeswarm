import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import { SHAPE_LINE } from './entities/projectiles';
import { Simulation } from './simulation';
import recipesConfig from '../../data/effects/recipes.json';

/** でんきの技の組み直し（作者の依頼 2026年11月1日。07 の150章） */
function setup(move: string, level = 1) {
  const rules = buildSimRules('hoenn');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const m = moveIndexOf(rules, move);
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, moves: [{ move: m, level }] });
  const pr = sim.world.projectiles;
  const find = (pred: (i: number) => boolean): number[] => [...Array(pr.count).keys()].filter(pred);
  return { rules, sim, p, m, pr, find };
}

describe('かみなりのキバ', () => {
  it('かみつく・ほのおのキバと同じキバの攻撃（前の長方形。向きで描き分ける口の絵）', () => {
    const rules = buildSimRules('hoenn');
    const fang = rules.moves[moveIndexOf(rules, 'thunder-fang')]!;
    const fire = rules.moves[moveIndexOf(rules, 'fire-fang')]!;
    expect(fang.pattern).toBe('melee');
    expect(fang.frontBox).toEqual(fire.frontBox);
    const sprite = (recipesConfig as { recipes: Record<string, { sprite?: { id: string; directional?: boolean } }> }).recipes['thunder-fang']!.sprite!;
    expect(sprite.id).toBe('fang-front-electric');
    expect(sprite.directional).toBe(true);
  });
});

describe('ボルトチェンジ: 残像が敵から敵へ飛び、最後は自分の所へ帰ってくる', () => {
  it('跳んだ数だけ線が出て、最後の線は現れるときの自分の位置へ向く。帰ってくるまで次を出さない', () => {
    const t = setup('volt-switch');
    const def = t.rules.moves[t.m]!;
    expect(def.pattern).toBe('chain');
    expect(def.chainReturn).toBe(true);
    expect(def.waitForEnd).toBe(true);
    t.sim.step([
      { type: 'spawnEnemy', id: 1, kind: 0, x: 120, y: 0 },
      { type: 'spawnEnemy', id: 2, kind: 0, x: 240, y: 90 },
    ]);
    t.sim.step([]);
    const lines = t.find((i) => t.pr.move[i] === t.m && t.pr.shape[i] === SHAPE_LINE);
    // 敵 2 体 ＋ 戻る線
    expect(lines).toHaveLength(3);
    const back = lines.find((i) => t.pr.orbitRadius[i] === -1)!;
    expect(back).toBeDefined();
    expect(t.pr.stage[back]).toBe(3);
    // 帰ってくる前に自分が動くと、戻る線は現れるときの自分の位置へ向く
    t.p.x = 60;
    t.p.y = -80;
    const hop = def.chainHopSeconds;
    for (let k = 0; k < Math.round(hop * 2 * 30) + 2; k++) t.sim.step([]);
    expect(t.pr.stage[back]).toBe(0);
    const ex = t.pr.x[back]! + t.pr.dirX[back]! * t.pr.length[back]!;
    const ey = t.pr.y[back]! + t.pr.dirY[back]! * t.pr.length[back]!;
    expect(ex).toBeCloseTo(60, 0);
    expect(ey).toBeCloseTo(-80, 0);
    // 再使用は、戻る線が消えるまでより短くならない
    const pm = t.p.moves[0]!;
    expect(pm.cooldown + (Math.round(hop * 2 * 30) + 2 + 1) / 30).toBeGreaterThanOrEqual(hop * 2 + def.levels[0]!.durationSeconds - 1e-9);
  });

  it('しんそく も同じく、戻る線が出て、帰ってくるまで次を出さない（作者の依頼 2026年11月1日）', () => {
    const t = setup('extreme-speed');
    const def = t.rules.moves[t.m]!;
    expect(def.chainReturn).toBe(true);
    expect(def.waitForEnd).toBe(true);
    t.sim.step([{ type: 'spawnEnemy', id: 1, kind: 0, x: 150, y: 0 }]);
    t.sim.step([]);
    const lines = t.find((i) => t.pr.move[i] === t.m && t.pr.shape[i] === SHAPE_LINE);
    expect(lines).toHaveLength(2);
    expect(lines.some((i) => t.pr.orbitRadius[i] === -1)).toBe(true);
  });

  it('敵が 1 体なら、その敵へ 1 本と戻る線 1 本', () => {
    const t = setup('volt-switch');
    t.sim.step([{ type: 'spawnEnemy', id: 1, kind: 0, x: 150, y: 0 }]);
    t.sim.step([]);
    const lines = t.find((i) => t.pr.move[i] === t.m && t.pr.shape[i] === SHAPE_LINE);
    expect(lines).toHaveLength(2);
  });
});
