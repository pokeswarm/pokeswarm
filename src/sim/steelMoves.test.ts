import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import { SHAPE_BOX } from './entities/projectiles';
import { Simulation } from './simulation';
import { hurtPlayer } from './systems/health';

/** ホウエンの技の作り直し（4）はがね（作者の指摘 2026年11月1日。07 の155章） */
function setup(move: string) {
  const rules = buildSimRules('hoenn');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const m = moveIndexOf(rules, move);
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, moves: [{ move: m, level: 1 }] });
  p.facingX = 1;
  p.facingY = 0;
  const pr = sim.world.projectiles;
  const find = (pred: (i: number) => boolean): number[] => [...Array(pr.count).keys()].filter(pred);
  return { rules, sim, p, m, pr, find };
}

describe('はがね', () => {
  it('メタルクロー・アイアンヘッド は前の長方形。アイアンヘッド は踏み込みが大きい', () => {
    const c = setup('metal-claw');
    c.sim.step([]);
    expect(c.find((i) => c.pr.move[i] === c.m && c.pr.shape[i] === SHAPE_BOX)).toHaveLength(1);
    const h = setup('iron-head');
    expect(h.rules.moves[h.m]!.body?.lungeDistance).toBe(36);
    h.sim.step([]);
    expect(h.find((i) => h.pr.move[i] === h.m && h.pr.shape[i] === SHAPE_BOX)).toHaveLength(1);
  });
  it('コメットパンチ は一番近い敵へ飛び、当たると 3 倍の大きさで弾ける', () => {
    const t = setup('meteor-mash');
    const def = t.rules.moves[t.m]!;
    expect(def.pattern).toBe('nearest');
    expect(def.effects[0]!.explode?.sizeMultiplier).toBe(3);
    t.sim.world.enemies.add(1, 0, 60, 0, 1e6, 0, 10);
    t.sim.step([]);
    expect(t.find((i) => t.pr.move[i] === t.m)).toHaveLength(1);
    for (let k = 0; k < 6; k++) t.sim.step([]);
    expect(t.find((i) => t.pr.move[i] === t.m && t.pr.stage[i] === 1)).toHaveLength(1);
  });
  it('メタルバースト: 鋼の破片が全方向へ飛ぶ。ダメージを受けるとすぐ、強く数の多い 1 回を返す（07 の184章）', () => {
    const t = setup('metal-burst');
    const shards = (): number[] => t.find((i) => t.pr.move[i] === t.m && t.pr.stage[i] === 0);
    t.sim.step([]);
    const first = shards();
    const count = first.length;
    const power = t.pr.damage[first[0]!]!;
    expect(count).toBe(8);
    // 破片は全方向へ
    expect(first.some((i) => t.pr.vx[i]! > 0)).toBe(true);
    expect(first.some((i) => t.pr.vx[i]! < 0)).toBe(true);
    for (let k = 0; k < 30; k++) t.sim.step([]);
    expect(t.p.moves[0]!.cooldown).toBeGreaterThan(0);
    const before = t.pr.count;
    hurtPlayer(t.sim.world, t.p, 40);
    t.sim.step([]);
    const added = shards().slice(-16);
    expect(t.pr.count - before).toBe(16);
    expect(t.pr.damage[added[0]!]).toBeCloseTo(power * 2.5, 3);
    // 次はふつうの強さに戻る
    expect(t.p.moves[0]!.hurtCharge).toBe(false);
  });
  it('クチートの固有技は アイアンヘッド → メタルバースト（ぶつり のまま。てっていこうせん は 161章でしまった）', () => {
    const t = setup('metal-burst');
    const d = t.rules.derivations.filter((x) => x.to === t.m && x.line === 'mawile');
    expect(d).toHaveLength(1);
    expect(d[0]!.from).toBe(moveIndexOf(t.rules, 'iron-head'));
  });
});
