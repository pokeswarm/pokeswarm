import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { testRules } from './testRules';
import { enemyHpScale } from './world';

/** 協力プレイの人数に応じた雑魚の強さ（作者の指摘「人数に応じた難易度調整が簡単すぎる」。2026年10月21日） */
describe('人数に応じた雑魚の強さ', () => {
  function sim(players: number) {
    const rules = testRules({
      spawn: { spawnPerSecond: 3, fillPerSecond: 0, capGlobal: 1000, capPerPlayer: 1000, perExtraPlayer: { spawnPct: 100, hpPct: 20, xpSharePct: 75 } },
    });
    rules.spawn.waves[0] = { ...rules.spawn.waves[0]!, spawnPerSecond: 3 };
    const s = new Simulation({ tickRate: 30, seed: 1, rules });
    for (let id = 1; id <= players; id++) s.addPlayer({ id, x: id * 50, y: 0, radius: 12, moveSpeed: 0, moves: [] });
    return s;
  }

  it('2人目以降1人につき、出現の速さと雑魚の HP が上がる', () => {
    const solo = sim(1);
    const four = sim(4);
    for (let t = 0; t < 300; t++) {
      solo.step([]);
      four.step([]);
    }
    // 4人なら出現の速さは 1 + 1.0 × 3 = 4倍
    expect(four.world.enemies.count / solo.world.enemies.count).toBeCloseTo(4, 0);
    expect(enemyHpScale(four.world) / enemyHpScale(solo.world)).toBeCloseTo(1.6);
  });
});
