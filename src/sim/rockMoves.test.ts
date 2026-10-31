import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { MOTION_LOB } from './entities/projectiles';

/** いわの技の追加: ステルスロック・ロックブラスト（作者の依頼 2026年10月31日。07 の146章） */
function setup(pokemon: string, move: string, region: string, level = 1) {
  const rules = buildSimRules(region);
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const lo = playableLoadout(rules, pokemon);
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, types: lo.types, moveTypes: lo.moveTypes, moves: [{ ...lo.moves[0]!, move: moveIndexOf(rules, move), level }], line: lo.line, species: lo.species });
  return { rules, sim, p };
}

describe('ステルスロック', () => {
  it('自分の周りのランダムな場所へ投げ（放物線・落ちた所でだけ当たる）、落ちた所に岩の範囲が残る', () => {
    const { rules, sim } = setup('onix', 'stealth-rock', 'johto');
    const def = rules.moves[moveIndexOf(rules, 'stealth-rock')]!;
    expect(def.pattern).toBe('lob');
    expect(def.lobTarget).toBe('random');
    expect(def.landOnly).toBe(true);
    // 原作は変化技だが、岩を投げるので物理
    expect(def.damageClass).toBe('physical');
    sim.step([]);
    const pr = sim.world.projectiles;
    // Lv1 は 2 個
    expect(pr.count).toBe(2);
    expect(pr.motion[0]).toBe(MOTION_LOB);
    expect(pr.motion[1]).toBe(MOTION_LOB);
    const lifeTicks = Math.round(def.levels[0]!.durationSeconds * 30);
    for (let t = 0; t < lifeTicks + 2; t++) sim.step([]);
    // 落ちた後、残る範囲（効き方から出たもの stage 1）が置かれる。半径は 18 × 2.0
    let puddles = 0;
    for (let i = 0; i < pr.count; i++) if (pr.stage[i] === 1 && pr.linger[i] === 1) { puddles++; expect(pr.radius[i]).toBeCloseTo(18 * 2, 5); }
    expect(puddles).toBeGreaterThanOrEqual(1);
  });

  it('ポイントマックスで ロックブラスト に派生する', () => {
    const rules = buildSimRules('johto');
    const item = rules.items.findIndex((i) => i.key === 'pp-max');
    expect(rules.derivations.some((d) => d.from === moveIndexOf(rules, 'stealth-rock') && d.item === item && d.to === moveIndexOf(rules, 'rock-blast') && d.line === null)).toBe(true);
  });
});

describe('ロックブラスト', () => {
  it('一番近い敵へ一定間隔で岩を撃ち、当たると周りに小さな破片の範囲が 3 つ残る', () => {
    const { rules, sim } = setup('onix', 'rock-blast', 'johto');
    const def = rules.moves[moveIndexOf(rules, 'rock-blast')]!;
    expect(def.pattern).toBe('nearest');
    expect(def.levels[0]!.count).toBe(3);
    expect(def.levels[0]!.intervalSeconds).toBe(0.25);
    sim.step([{ type: 'spawnEnemy', id: 1, kind: 0, x: 120, y: 0 }]);
    const pr = sim.world.projectiles;
    let shards = 0;
    for (let t = 0; t < 30; t++) {
      sim.step([]);
      shards = 0;
      for (let i = 0; i < pr.count; i++) if (pr.stage[i] === 1 && pr.motion[i] === 0 && pr.vx[i] === 0 && pr.vy[i] === 0) shards++;
      if (shards >= 3) break;
    }
    expect(shards).toBeGreaterThanOrEqual(3);
    // 破片の範囲は当たった所から 45 の中
    for (let i = 0; i < pr.count; i++) if (pr.stage[i] === 1 && pr.motion[i] === 0 && pr.vx[i] === 0 && pr.vy[i] === 0) expect(Math.hypot(pr.x[i]! - 120, pr.y[i]!)).toBeLessThanOrEqual(45 + 16);
  });
});
