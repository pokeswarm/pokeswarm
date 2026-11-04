import { describe, expect, it } from 'vitest';
import { movesConfig } from '../data';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import { Simulation } from './simulation';
import { hurtPlayer } from './systems/health';
import { recomputeModifiers } from './systems/leveling';

/** 07 の175章: マジカルシャイン（トゲチック）・エアロブラスト・リベンジ・せいなるほのお の作り直しと、どくばり・どくづき の廃止 */
function setup(move: string, level = 1) {
  const rules = buildSimRules('johto');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const m = moveIndexOf(rules, move);
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, moves: [{ move: m, level }] });
  p.facingX = 1;
  p.facingY = 0;
  const pr = sim.world.projectiles;
  const mine = (): number[] => [...Array(pr.count).keys()].filter((i) => pr.move[i] === m);
  return { rules, sim, p, m, pr, mine, e: sim.world.enemies };
}

describe('175章の作り直し', () => {
  it('エアロブラスト: はかいこうせん と同じ、向いている方へ出し続ける光線。真後ろには当たらない', () => {
    for (const move of ['aeroblast']) {
      const t = setup(move);
      expect(t.rules.moves[t.m]!.pattern, move).toBe('stream');
      t.e.add(1, 0, 150, 0, 1e6, 0, 10);
      t.e.add(2, 0, -150, 0, 1e6, 0, 10);
      for (let k = 0; k < 30; k++) t.sim.step([]);
      expect(t.e.hp[0]!, `${move} の前`).toBeLessThan(1e6);
      expect(t.e.hp[1]!, `${move} の後ろ`).toBe(1e6);
    }
  });

  it('リベンジ: 後ろの敵に当たり、前の敵には当たらない。ダメージを受けてから 3 秒は ぶつり の技が強くなる', () => {
    const t = setup('revenge');
    t.e.add(1, 0, 60, 0, 1e6, 0, 10);
    t.e.add(2, 0, -60, 0, 1e6, 0, 10);
    for (let k = 0; k < 20; k++) t.sim.step([]);
    expect(t.e.hp[0]!).toBe(1e6);
    expect(t.e.hp[1]!).toBeLessThan(1e6);
    recomputeModifiers(t.sim.world, t.p);
    expect(t.p.mods.physicalPowerPct).toBe(0);
    hurtPlayer(t.sim.world, t.p, 1);
    expect(t.p.mods.physicalPowerPct).toBe(30);
    for (let k = 0; k < 95; k++) t.sim.step([]);
    expect(t.p.mods.physicalPowerPct).toBe(0);
  });

  it('せいなるほのお: 近くの雑魚ではなく HP の一番高い敵を追いかけ、当たると青白い炎が 8 つ飛び出る', () => {
    const t = setup('sacred-fire');
    t.e.add(1, 0, 60, 0, 100, 0, 10);
    t.e.add(2, 0, -250, 0, 1e6, 0, 10);
    let split = 0;
    for (let k = 0; k < 60 && split === 0; k++) {
      t.sim.step([]);
      split = t.mine().filter((i) => t.pr.stage[i] === 1).length;
    }
    expect(t.e.hp[1]!).toBeLessThan(1e6);
    expect(t.e.hp[0]!).toBe(100);
    expect(split).toBe(8);
  });

  it('せいなるほのお: 技の数を増やしても塊は 1 つのまま、飛び出る炎が増える', () => {
    const t = setup('sacred-fire');
    t.p.mods.amountBonus = 1;
    t.e.add(1, 0, 200, 0, 1e6, 0, 10);
    let main = 0;
    let split = 0;
    for (let k = 0; k < 60 && split === 0; k++) {
      t.sim.step([]);
      t.p.mods.amountBonus = 1;
      main = Math.max(main, t.mine().filter((i) => t.pr.stage[i] === 0).length);
      split = t.mine().filter((i) => t.pr.stage[i] === 1).length;
    }
    expect(main).toBe(1);
    expect(split).toBe(10);
  });

  it('どくばり・どくづき は無くなった', () => {
    expect(movesConfig.moves['poison-sting']).toBeUndefined();
    expect(movesConfig.moves['poison-jab']).toBeUndefined();
  });
});
