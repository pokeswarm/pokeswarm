import { describe, expect, it } from 'vitest';
import type { SimMoveDef } from './moves';
import { Simulation } from './simulation';
import { testRules } from './testRules';

/** 1つの技だけを持つプレイヤーと、置いた敵で数回進める。受けたダメージを id ごとに返す */
function run(pattern: SimMoveDef['pattern'], stats: Record<string, number>, enemies: [number, number][], ticks = 10, move: [number, number] = [0, 0]): { hit: number[]; sim: Simulation } {
  const rules = testRules({ move: { power: 10, cooldownSeconds: 100, pierce: Infinity, durationSeconds: 0.5, ...stats } });
  rules.moves[0] = { ...rules.moves[0]!, pattern };
  const sim = new Simulation({ tickRate: 30, seed: 3, rules });
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 200 });
  p.facingX = 1;
  p.facingY = 0;
  enemies.forEach(([x, y], k) => sim.world.enemies.add(k + 1, 0, x, y, 1000, 0, 10));
  if (move[0] || move[1]) sim.step([{ type: 'move', playerId: 1, dx: move[0] as -1 | 0 | 1, dy: move[1] as -1 | 0 | 1 }]);
  for (let t = 0; t < ticks; t++) sim.step([]);
  const e = sim.world.enemies;
  const ids = Array.from(e.id.subarray(0, e.count));
  return { hit: enemies.map((_, k) => 1000 - e.hp[ids.indexOf(k + 1)]!), sim };
}

describe('技の型（作者の決定。07 18章）', () => {
  it('横なぎ: 左右に長く当たり、上下には当たらない', () => {
    const { hit } = run('whip', { range: 200, size: 10, count: 2 }, [[150, 0], [-150, 0], [0, 150]], 3);
    expect(hit[0]).toBeGreaterThan(0);
    expect(hit[1]).toBeGreaterThan(0);
    expect(hit[2]).toBe(0);
  });

  it('放物線: 上へ投げて落ちてくる（すぐ横の敵には当たりにくく、落ちる先に当たる）', () => {
    const { sim } = run('lob', { speed: 400, size: 6, count: 1, durationSeconds: 2 }, [], 6);
    const pr = sim.world.projectiles;
    expect(pr.count).toBe(1);
    expect(pr.y[0]).toBeLessThan(0);
    const y1 = pr.y[0]!;
    for (let t = 0; t < 30; t++) sim.step([]);
    expect(pr.y[0]).toBeGreaterThan(y1);
  });

  it('落雷: 範囲の中の敵の足元に、数の分だけ落ちる', () => {
    const { hit } = run('strike', { range: 500, size: 10, count: 2 }, [[100, 0], [-300, 100], [0, -200], [2000, 0]], 2);
    expect(hit.filter((h) => h > 0)).toHaveLength(2);
    expect(hit[3]).toBe(0);
  });

  it('連鎖: 一番近い敵から近くの敵へ飛び移る', () => {
    const { hit } = run('chain', { range: 300, size: 4, count: 3 }, [[100, 0], [180, 0], [260, 0], [900, 0]], 2);
    expect(hit.slice(0, 3).every((h) => h > 0)).toBe(true);
    expect(hit[3]).toBe(0);
  });

  it('跳ね返り: 枠の端で向きが変わる', () => {
    const { sim } = run('bounce', { range: 100, speed: 600, size: 5, count: 1, durationSeconds: 3 }, [], 1);
    const pr = sim.world.projectiles;
    let flipped = false;
    let vx = pr.vx[0]!;
    let vy = pr.vy[0]!;
    for (let t = 0; t < 30; t++) {
      sim.step([]);
      if (Math.sign(pr.vx[0]!) !== Math.sign(vx) || Math.sign(pr.vy[0]!) !== Math.sign(vy)) flipped = true;
      vx = pr.vx[0]!;
      vy = pr.vy[0]!;
    }
    expect(flipped).toBe(true);
    expect(Math.abs(pr.x[0]!)).toBeLessThan(140);
  });

  it('足あと: 止まっていると出ず、歩くと足元に残る', () => {
    const still = run('trail', { size: 10, cooldownSeconds: 0.1, durationSeconds: 2 }, [], 6);
    expect(still.sim.world.projectiles.count).toBe(0);
    const moving = run('trail', { size: 10, cooldownSeconds: 0.1, durationSeconds: 2 }, [], 12, [1, 0]);
    expect(moving.sim.world.projectiles.count).toBeGreaterThan(1);
  });

  it('十字: 4方向へ同時に撃つ', () => {
    const { hit } = run('cross', { speed: 600, size: 6, count: 4, range: 400 }, [[150, 0], [-150, 0], [0, 150], [0, -150], [110, 110]], 10);
    expect(hit.slice(0, 4).every((h) => h > 0)).toBe(true);
    expect(hit[4]).toBe(0);
  });

  it('水たまり: 自分のまわりに置き、しばらく残る', () => {
    const { sim } = run('scatter', { range: 200, size: 20, count: 3, durationSeconds: 2 }, [], 3);
    const pr = sim.world.projectiles;
    expect(pr.count).toBe(3);
    for (let i = 0; i < pr.count; i++) expect(Math.hypot(pr.x[i]!, pr.y[i]!)).toBeLessThanOrEqual(200);
  });
});

describe('進化で増える効き方（作者の決定。07 22章）', () => {
  it('出し続ける流れ: 向いている方向へ伸び、向きを変えると回ってついてくる。次に使うまで途切れない', () => {
    const { hit, sim } = run('stream', { range: 300, size: 10, count: 1, cooldownSeconds: 1, hitIntervalSeconds: 0.2, speed: 360 }, [[200, 0], [0, 200]], 10);
    expect(hit[0]).toBeGreaterThan(0);
    expect(hit[1]).toBe(0);
    const p = sim.world.players[0]!;
    // 下を向くと、流れが下へ回る（1秒に 360°）
    sim.step([{ type: 'move', playerId: 1, dx: 0, dy: 1 }]);
    for (let t = 0; t < 12; t++) sim.step([]);
    const pr = sim.world.projectiles;
    expect(pr.count).toBe(1);
    expect(pr.dirY[0]!).toBeGreaterThan(0.9);
    expect(p.y).toBeGreaterThan(0);
  });

  it('流れの先の爆発: 流れの先で弾け、水たまりが残る', () => {
    const rules = testRules({ move: { power: 10, cooldownSeconds: 1, pierce: Infinity, range: 300, size: 10, count: 1, hitIntervalSeconds: 0.2, speed: 360 } });
    rules.moves[0] = {
      ...rules.moves[0]!,
      pattern: 'stream',
      effects: [{ trigger: 'every', everySeconds: 0.5, explode: { sizeMultiplier: 3, powerMultiplier: 3 }, puddle: { sizeMultiplier: 2, powerMultiplier: 0.5, durationSeconds: 2, hitIntervalSeconds: 0.5 } }],
    };
    const sim = new Simulation({ tickRate: 30, seed: 3, rules });
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0 });
    p.facingX = 1;
    p.facingY = 0;
    for (let t = 0; t < 20; t++) sim.step([]);
    const pr = sim.world.projectiles;
    // 流れ1本・爆発（短い）・水たまり
    const puddles = [];
    for (let i = 0; i < pr.count; i++) if (pr.shape[i] === 0 && pr.life[i]! > 1) puddles.push(i);
    expect(puddles.length).toBe(1);
    expect(pr.x[puddles[0]!]!).toBeCloseTo(300, 0);
    expect(pr.radius[puddles[0]!]!).toBeCloseTo(20);
  });
});

describe('効き方の部品（07 22.4）', () => {
  /** 技0 に効き方を付けて進める */
  function withEffects(pattern: SimMoveDef['pattern'], stats: Record<string, number>, effects: SimMoveDef['effects'], enemies: [number, number][], ticks: number, curve = 0) {
    const rules = testRules({ move: { power: 10, cooldownSeconds: 100, pierce: Infinity, durationSeconds: 0.5, ...stats } });
    rules.moves[0] = { ...rules.moves[0]!, pattern, effects, curve };
    const sim = new Simulation({ tickRate: 30, seed: 3, rules });
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0 });
    p.facingX = 1;
    p.facingY = 0;
    enemies.forEach(([x, y], k) => sim.world.enemies.add(k + 1, 0, x, y, 1000, 0, 10));
    for (let t = 0; t < ticks; t++) sim.step([]);
    return sim;
  }
  const stageCount = (sim: Simulation, stage: number) => {
    let n = 0;
    for (let i = 0; i < sim.world.projectiles.count; i++) if (sim.world.projectiles.stage[i] === stage) n++;
    return n;
  };

  it('分裂: 当たると小さな弾が飛び散る', () => {
    const sim = withEffects('facing', { speed: 600, size: 6, count: 1, range: 400, durationSeconds: 1 }, [{ trigger: 'hit', split: { sizeMultiplier: 0.5, powerMultiplier: 0.5, count: 5, speed: 200, durationSeconds: 1, spreadDegrees: 360, boomerang: false } }], [[100, 0]], 8);
    expect(stageCount(sim, 1)).toBe(5);
  });

  it('連鎖: 当たった敵から近くの敵へ飛び移る', () => {
    const sim = withEffects('facing', { speed: 600, size: 6, count: 1, range: 400, durationSeconds: 1 }, [{ trigger: 'hit', chain: { sizeMultiplier: 1, powerMultiplier: 1, count: 2, range: 200 } }], [[100, 0], [100, 120], [100, 240]], 8);
    const e = sim.world.enemies;
    // 弾の通り道にいない 2体にも当たる
    expect(1000 - e.hp[1]!).toBeGreaterThan(0);
    expect(1000 - e.hp[2]!).toBeGreaterThan(0);
  });

  it('周回・突き出す・波: 技を使ったときに出る', () => {
    const sim = withEffects(
      'melee',
      { size: 20, count: 1, range: 0 },
      [{ trigger: 'cast', orbit: { sizeMultiplier: 0.5, powerMultiplier: 1, count: 3, radius: 60, speed: 360, durationSeconds: 1, hitIntervalSeconds: 0.2 }, spikes: { sizeMultiplier: 0.5, powerMultiplier: 1, count: 4, length: 200, durationSeconds: 1, hitIntervalSeconds: 0.3 }, wave: { powerMultiplier: 1, radius: 200, durationSeconds: 0.5 } }],
      [[0, 150]],
      2,
    );
    expect(stageCount(sim, 1)).toBe(3 + 4 + 1);
    // 下へ突き出した線が当たる
    expect(1000 - sim.world.enemies.hp[0]!).toBeGreaterThan(0);
  });

  it('遅れて弾ける印: 印は当たらず、少し後に弾ける', () => {
    const sim = withEffects('strike', { size: 20, count: 1, range: 300, durationSeconds: 0.1 }, [{ trigger: 'end', explode: { sizeMultiplier: 2, powerMultiplier: 5, delaySeconds: 0.5 } }], [[100, 0]], 6);
    const hpAfterStrike = sim.world.enemies.hp[0]!;
    expect(stageCount(sim, 2)).toBe(1);
    for (let t = 0; t < 20; t++) sim.step([]);
    expect(sim.world.enemies.hp[0]!).toBeLessThan(hpAfterStrike - 40);
  });

  it('引き寄せ: 爆発の中心へ敵を引き寄せる', () => {
    const sim = withEffects('strike', { size: 20, count: 1, range: 300, durationSeconds: 0.1, knockbackSeconds: 0.2 }, [{ trigger: 'end', explode: { sizeMultiplier: 5, powerMultiplier: 0, pull: 300 } }], [[100, 0], [160, 0]], 12);
    // 2体目（中心から右にいる）は中心（1体目の位置）のほうへ動く
    expect(sim.world.enemies.x[1]!).toBeLessThan(160);
  });

  it('曲がる弾: 十字の弾が渦を巻くように回る', () => {
    const sim = withEffects('cross', { speed: 300, size: 6, count: 4, range: 400, durationSeconds: 2 }, [], [], 10, Math.PI);
    const pr = sim.world.projectiles;
    // 右へ撃った弾は、まっすぐなら y = 0 のまま。曲がると下へずれる
    let moved = false;
    for (let i = 0; i < pr.count; i++) if (pr.x[i]! > 50 && Math.abs(pr.y[i]!) > 10) moved = true;
    expect(moved).toBe(true);
  });
});
