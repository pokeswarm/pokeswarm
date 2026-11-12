import { describe, expect, it } from 'vitest';
import type { MoveEffect } from '../data/schema';
import { MOTION_LOB, MOTION_SNAKE } from './entities/projectiles';
import type { SimMoveDef } from './moves';
import { Simulation } from './simulation';
import { testRules } from './testRules';

/**
 * 作者の感想で見直した技（2026年10月25日）の出し方。1つの技だけを持つプレイヤーと、動かない敵で数回進める。
 * extra は技の定義に足す項目（落とす場所・蛇行・効き方など）
 */
function setup(pattern: SimMoveDef['pattern'], stats: Record<string, number>, enemies: [number, number][], extra: Partial<SimMoveDef> = {}): Simulation {
  const rules = testRules({ move: { power: 10, cooldownSeconds: 100, pierce: Infinity, durationSeconds: 0.5, ...stats } });
  rules.moves[0] = { ...rules.moves[0]!, pattern, ...extra };
  const sim = new Simulation({ tickRate: 30, seed: 3, rules });
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 200 });
  p.facingX = 1;
  p.facingY = 0;
  enemies.forEach(([x, y], k) => sim.world.enemies.add(k + 1, 0, x, y, 1000, 0, 10));
  return sim;
}

/** 敵ごとの受けたダメージ（置いた順） */
function damage(sim: Simulation, n: number): number[] {
  const e = sim.world.enemies;
  const ids = Array.from(e.id.subarray(0, e.count));
  return Array.from({ length: n }, (_, k) => 1000 - e.hp[ids.indexOf(k + 1)]!);
}

const steps = (sim: Simulation, n: number): void => {
  for (let t = 0; t < n; t++) sim.step([]);
};

describe('作者の感想で見直した技（2026年10月25日）', () => {
  it('広がって縮む輪（pulse）: range まで広がってから縮み、広がるときと縮むときに同じ敵へ当たる', () => {
    const sim = setup('pulse', { range: 100, size: 16, durationSeconds: 0.6, hitIntervalSeconds: 0.3 }, [[70, 0]]);
    sim.step([]);
    const pr = sim.world.projectiles;
    const r0 = pr.radius[0]!;
    steps(sim, 8);
    const mid = pr.radius[0]!;
    steps(sim, 8);
    expect(mid).toBeGreaterThan(90);
    expect(pr.radius[0]!).toBeLessThan(mid - 30);
    expect(r0).toBeLessThan(40);
    expect(damage(sim, 1)[0]).toBe(20);
  });

  it('天気（weather）: 画面くらいの範囲の敵すべてに、当たり直しの間隔ごとに当たる', () => {
    const sim = setup('weather', { size: 500, durationSeconds: 1, hitIntervalSeconds: 0.25 }, [[400, 0], [-300, 200], [700, 0]]);
    steps(sim, 31);
    const [a, b, far] = damage(sim, 3);
    expect(a).toBe(40);
    expect(b).toBe(40);
    expect(far).toBe(0);
  });

  it('横なぎ: 2本目は interval だけ遅れて反対側を払う', () => {
    const sim = setup('whip', { range: 200, size: 10, count: 2, intervalSeconds: 0.2 }, [[150, 0], [-150, 0]]);
    steps(sim, 2);
    expect(damage(sim, 2)).toEqual([10, 0]);
    steps(sim, 6);
    expect(damage(sim, 2)).toEqual([10, 10]);
  });

  it('放物線で狙った場所へ（lobTarget）: 真上寄りに投げ上げ、持続の秒数でちょうど狙った敵の所に落ちる', () => {
    const sim = setup('lob', { range: 400, size: 10, speed: 400, durationSeconds: 1, pierce: Infinity }, [[200, 100]], { lobTarget: 'nearest' });
    sim.step([]);
    const pr = sim.world.projectiles;
    expect(pr.motion[0]).toBe(MOTION_LOB);
    // 最初は上へ向かう
    expect(pr.vy[0]!).toBeLessThan(0);
    let last: [number, number] = [0, 0];
    for (let t = 0; t < 40 && pr.count > 0; t++) {
      last = [pr.x[0]!, pr.y[0]!];
      sim.step([]);
    }
    expect(Math.hypot(last[0] - 200, last[1] - 100)).toBeLessThan(15);
  });

  it('蛇行（snake）: 決まった方向へ進みながら、横へ揺れる', () => {
    const sim = setup('cross', { count: 1, speed: 200, size: 8, durationSeconds: 1 }, [], { snake: { amplitude: 20, wavelength: 100 } });
    sim.step([]);
    const pr = sim.world.projectiles;
    expect(pr.motion[0]).toBe(MOTION_SNAKE);
    let maxSide = 0;
    for (let t = 0; t < 15; t++) {
      sim.step([]);
      maxSide = Math.max(maxSide, Math.abs(pr.y[0]!));
    }
    expect(pr.x[0]!).toBeGreaterThan(90);
    expect(maxSide).toBeGreaterThan(15);
    expect(maxSide).toBeLessThan(25);
  });

  it('出した技が消えるまで次を出さない（waitForEnd）: 再使用は少なくとも持続の長さ', () => {
    const sim = setup('bounce', { cooldownSeconds: 0.5, durationSeconds: 2, speed: 300, range: 300 }, [], { waitForEnd: true });
    sim.step([]);
    expect(sim.world.players[0]!.moves[0]!.cooldown).toBeGreaterThanOrEqual(2 - 1e-9);
  });

  it('跳ね返る技は spreadDegrees があれば向きがランダムになる', () => {
    const angles = new Set<number>();
    for (const seed of [1, 2, 3]) {
      const rules = testRules({ move: { power: 10, cooldownSeconds: 100, durationSeconds: 1, speed: 300, range: 300, spreadDegrees: 360 } });
      rules.moves[0] = { ...rules.moves[0]!, pattern: 'bounce' };
      const sim = new Simulation({ tickRate: 30, seed, rules });
      sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 200 });
      sim.step([]);
      angles.add(Math.round(Math.atan2(sim.world.projectiles.vy[0]!, sim.world.projectiles.vx[0]!) * 100));
    }
    expect(angles.size).toBeGreaterThan(1);
  });

  it('片道のなぎ払い（sweepOnce）: 同じ敵には1回だけ当たる', () => {
    const sim = setup('sweep', { range: 60, size: 20, arcDegrees: 40, spreadDegrees: 180, durationSeconds: 0.4 }, [[60, 0]], { sweepOnce: true });
    steps(sim, 14);
    expect(damage(sim, 1)[0]).toBe(10);
  });

  it('置く数と大きさのばらつき（scatterJitter）: 数は countMin〜count、半径は size × sizeMin〜sizeMax', () => {
    const counts = new Set<number>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const rules = testRules({ move: { power: 10, cooldownSeconds: 100, durationSeconds: 1, size: 40, range: 200, count: 4 } });
      rules.moves[0] = { ...rules.moves[0]!, pattern: 'scatter', scatterJitter: { countMin: 1, sizeMin: 0.5, sizeMax: 1.5 } };
      const sim = new Simulation({ tickRate: 30, seed, rules });
      sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 200 });
      sim.step([]);
      const pr = sim.world.projectiles;
      counts.add(pr.count);
      for (let i = 0; i < pr.count; i++) {
        expect(pr.radius[i]!).toBeGreaterThanOrEqual(20);
        expect(pr.radius[i]!).toBeLessThanOrEqual(60);
      }
    }
    for (const c of counts) expect(c).toBeGreaterThanOrEqual(1);
    for (const c of counts) expect(c).toBeLessThanOrEqual(4);
    expect(counts.size).toBeGreaterThan(1);
  });

  it('置いてから待つ（scatterDelaySeconds）: 待つ間は出番待ち（stage 3）で、時間が来たら当たり判定になる（つららおとし）', () => {
    const rules = testRules({ move: { power: 10, cooldownSeconds: 100, durationSeconds: 0.5, size: 20, range: 100, count: 3 } });
    rules.moves[0] = { ...rules.moves[0]!, pattern: 'scatter', scatterDelaySeconds: 0.5 };
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 200 });
    sim.step([]);
    const pr = sim.world.projectiles;
    expect(pr.count).toBe(3);
    for (let i = 0; i < pr.count; i++) expect(pr.stage[i]).toBe(3);
    for (let k = 0; k < 16; k++) sim.step([]);
    for (let i = 0; i < pr.count; i++) expect(pr.stage[i]).toBe(0);
  });

  it('キバの技（frontBox）: 前方の長方形の角には当たり、後ろと横の外には当たらない', () => {
    // 届く距離 100（range 0 + size 100）の 0.25〜0.95、片側の幅 35。右を向いている。[根元の手前・先の角・後ろ・横の外]
    const sim = setup('melee', { range: 0, size: 100, durationSeconds: 0.2 }, [[95, 40], [-40, 0], [50, 60], [5, 0]], { frontBox: { start: 0.25, end: 0.95, halfWidth: 0.35 } });
    sim.step([]);
    const [corner, behind, outside, near] = damage(sim, 4);
    expect(corner).toBeGreaterThan(0);
    expect(behind).toBe(0);
    expect(outside).toBe(0);
    // 根元（自分のすぐ前 15 より手前）は口の絵の外なので当たらない
    expect(near).toBe(0);
  });

  it('ほうでん（chainRadial）: 跳ばずに、自分からまわりの別々の敵へまっすぐ出す', () => {
    const sim = setup('chain', { range: 200, size: 6, count: 3, durationSeconds: 0.2 }, [[100, 0], [-100, 0], [0, 100], [0, -100], [500, 0]], { chainRadial: true });
    sim.step([]);
    const pr = sim.world.projectiles;
    expect(pr.count).toBe(3);
    const targets = new Set<string>();
    for (let i = 0; i < pr.count; i++) {
      // どれも自分（0, 0）から出て、届く範囲の敵まで
      expect(pr.x[i]).toBe(0);
      expect(pr.y[i]).toBe(0);
      expect(pr.length[i]).toBeCloseTo(100, 0);
      targets.add(`${Math.round(pr.dirX[i]!)},${Math.round(pr.dirY[i]!)}`);
    }
    expect(targets.size).toBe(3);
  });

  it('現れたとき（spawn）の効き方: 遅れて現れる爆炎の柱は、現れたときに火の粉を出す', () => {
    const sparks: MoveEffect = { trigger: 'spawn', split: { sizeMultiplier: 0.2, powerMultiplier: 0.3, count: 3, speed: 200, durationSeconds: 0.4, spreadDegrees: 360, boomerang: false, jitter: 1 } };
    const sim = setup('eruption', { range: 300, size: 20, count: 8, intervalSeconds: 0.2, durationSeconds: 1 }, [], { effects: [sparks] });
    sim.step([]);
    const pr = sim.world.projectiles;
    const fx = (): number => Array.from({ length: pr.count }, (_, i) => i).filter((i) => pr.stage[i] === 1).length;
    // 内側の段の 8 本から 3 つずつ
    expect(fx()).toBe(24);
    steps(sim, 7);
    // 2段目の 8 本が現れて、さらに 24（最初の火の粉は 0.4 秒で消える）
    expect(fx()).toBeGreaterThanOrEqual(24);
  });

  it('分裂の部品: lob なら放り上げて落ち、snake なら蛇行して進む', () => {
    const lob: MoveEffect = { trigger: 'cast', split: { sizeMultiplier: 0.5, powerMultiplier: 0.5, count: 3, speed: 300, durationSeconds: 0.7, spreadDegrees: 360, boomerang: false, lob: true } };
    const sim = setup('nova', { range: 50, size: 10, durationSeconds: 0.2 }, [], { effects: [lob] });
    sim.step([]);
    const pr = sim.world.projectiles;
    const kids = Array.from({ length: pr.count }, (_, i) => i).filter((i) => pr.stage[i] === 1);
    expect(kids).toHaveLength(3);
    for (const i of kids) {
      expect(pr.motion[i]).toBe(MOTION_LOB);
      expect(pr.vy[i]!).toBeLessThan(0);
    }
    const snake: MoveEffect = { trigger: 'cast', split: { sizeMultiplier: 0.5, powerMultiplier: 0.5, count: 2, speed: 200, durationSeconds: 1, spreadDegrees: 360, boomerang: false, snake: { amplitude: 10, wavelength: 80 } } };
    const sim2 = setup('nova', { range: 50, size: 10, durationSeconds: 0.2 }, [], { effects: [snake] });
    sim2.step([]);
    const pr2 = sim2.world.projectiles;
    expect(Array.from({ length: pr2.count }, (_, i) => i).filter((i) => pr2.stage[i] === 1 && pr2.motion[i] === MOTION_SNAKE)).toHaveLength(2);
  });

  it('岩の群れ（cluster）: 当たった所のまわりに、動かない残る当たり判定を count 個置く', () => {
    const rocks: MoveEffect = { trigger: 'cast', cluster: { sizeMultiplier: 1, powerMultiplier: 0.5, count: 5, radius: 50, durationSeconds: 1, hitIntervalSeconds: 0.4 } };
    const sim = setup('nova', { range: 50, size: 10, durationSeconds: 0.2 }, [], { effects: [rocks] });
    sim.step([]);
    const pr = sim.world.projectiles;
    const kids = Array.from({ length: pr.count }, (_, i) => i).filter((i) => pr.stage[i] === 1);
    expect(kids).toHaveLength(5);
    for (const i of kids) expect(Math.hypot(pr.x[i]!, pr.y[i]!)).toBeLessThanOrEqual(50);
  });

  it('伸びる亀裂（crack）: 線をつないで外へ伸び、遅れて現れる線は効き方から出たもの（stage 1）として現れる', () => {
    const cracks: MoveEffect = { trigger: 'cast', crack: { sizeMultiplier: 0.5, powerMultiplier: 0.5, count: 3, steps: 4, segment: 30, turnDegrees: 40, segmentSeconds: 0.1, durationSeconds: 1, hitIntervalSeconds: 0.5 } };
    const sim = setup('nova', { range: 50, size: 10, durationSeconds: 0.2 }, [], { effects: [cracks] });
    sim.step([]);
    const pr = sim.world.projectiles;
    const of = (st: number): number[] => Array.from({ length: pr.count }, (_, i) => i).filter((i) => pr.stage[i] === st);
    expect(of(1)).toHaveLength(3);
    expect(of(3)).toHaveLength(9);
    steps(sim, 12);
    expect(of(3)).toHaveLength(0);
    expect(of(0).filter((i) => pr.shape[i] === 1)).toHaveLength(0);
    // つないだ線の先は、どれも出した所から遠ざかる
    const far = Math.max(...of(1).map((i) => Math.hypot(pr.x[i]! + pr.dirX[i]! * pr.length[i]!, pr.y[i]! + pr.dirY[i]! * pr.length[i]!)));
    expect(far).toBeGreaterThan(80);
  });

  it('連打（barrage）: 向いている方向の開きと距離の中に、外へ押し出す当たり判定を interval ごとに count 発出す', () => {
    const sim = setup('barrage', { count: 6, intervalSeconds: 0.03, range: 80, arcDegrees: 90, size: 10, speed: 200, durationSeconds: 0.2 }, []);
    sim.step([]);
    const pr = sim.world.projectiles;
    expect(pr.count).toBeLessThan(6);
    steps(sim, 5);
    expect(pr.count).toBe(6);
    for (let i = 0; i < pr.count; i++) {
      // 右（向いている方向）の ±45° の中で、外へ進む
      expect(Math.abs(Math.atan2(pr.vy[i]!, pr.vx[i]!))).toBeLessThanOrEqual(Math.PI / 4 + 1e-9);
      expect(Math.hypot(pr.x[i]!, pr.y[i]!)).toBeLessThan(80 + 200 * 0.25);
    }
  });

  it('向きをランダムに選ぶ（randomAim）: 連打は1回ごとに1つの向きを選び、その向きへ出す', () => {
    const angles = new Set<number>();
    for (const seed of [1, 2, 3]) {
      const rules = testRules({ move: { power: 10, cooldownSeconds: 100, count: 2, intervalSeconds: 0.1, range: 40, arcDegrees: 1, size: 10, speed: 200, durationSeconds: 0.3 } });
      rules.moves[0] = { ...rules.moves[0]!, pattern: 'barrage', randomAim: true };
      const sim = new Simulation({ tickRate: 30, seed, rules });
      sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 200 });
      steps(sim, 5);
      const pr = sim.world.projectiles;
      expect(pr.count).toBe(2);
      const a0 = Math.atan2(pr.vy[0]!, pr.vx[0]!);
      const a1 = Math.atan2(pr.vy[1]!, pr.vx[1]!);
      expect(Math.abs(a0 - a1)).toBeLessThan(0.05);
      angles.add(Math.round(a0 * 10));
    }
    expect(angles.size).toBeGreaterThan(1);
  });

  it('消えてから数える再使用（restAfterEnd）: 次に出るのは 持続 + 再使用 の後', () => {
    const sim = setup('weather', { size: 300, durationSeconds: 2, cooldownSeconds: 5, hitIntervalSeconds: 0.5 }, [], { restAfterEnd: true });
    sim.step([]);
    expect(sim.world.players[0]!.moves[0]!.cooldown).toBeCloseTo(7);
  });

  it('長方形の連打（barrageWidth）: 自分を通る横の辺から、向いている方向へまっすぐ拳を出す（真横の敵にも当たる）', () => {
    const sim = setup('barrage', { count: 30, intervalSeconds: 0.01, range: 100, size: 10, speed: 400, durationSeconds: 1 }, [[5, 60], [5, -60], [-40, 0]], { barrageWidth: 140 });
    sim.step([]);
    const pr = sim.world.projectiles;
    for (let i = 0; i < pr.count; i++) {
      expect(pr.vy[i]).toBe(0);
      expect(pr.vx[i]!).toBeGreaterThan(0);
      expect(Math.abs(pr.y[i]!)).toBeLessThanOrEqual(70);
    }
    steps(sim, 10);
    const [left, right, behind] = damage(sim, 3);
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
    expect(behind).toBe(0);
  });

  it('長方形の連打で噛みにいく（barrageSeek）: 長方形の中の敵の正面から出す。だれもいなければ横の線のランダムな所', () => {
    const shot = { count: 20, intervalSeconds: 0.01, range: 100, size: 8, speed: 400, durationSeconds: 1 };
    const sim = setup('barrage', shot, [[60, 70]], { barrageWidth: 200, barrageSeek: true });
    steps(sim, 8);
    const pr = sim.world.projectiles;
    expect(pr.count).toBeGreaterThan(5);
    // 敵（横に 70 の所。半径 10）の正面だけから出る
    for (let i = 0; i < pr.count; i++) expect(Math.abs(pr.y[i]! - 70)).toBeLessThanOrEqual(5);

    const empty = setup('barrage', shot, [], { barrageWidth: 200, barrageSeek: true });
    steps(empty, 8);
    const pe = empty.world.projectiles;
    const ys = Array.from({ length: pe.count }, (_, i) => pe.y[i]!);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(40);
  });

  it('長方形の連打で噛みにいく（barrageSeek）: 敵が長方形の外なら寄せない。群れなら幅いっぱいに広がる', () => {
    const shot = { count: 30, intervalSeconds: 0.01, range: 100, size: 8, speed: 400, durationSeconds: 1 };
    const behind = setup('barrage', shot, [[-80, 0]], { barrageWidth: 200, barrageSeek: true });
    steps(behind, 8);
    const pb = behind.world.projectiles;
    const yb = Array.from({ length: pb.count }, (_, i) => pb.y[i]!);
    expect(Math.max(...yb) - Math.min(...yb)).toBeGreaterThan(40);

    const crowd = setup('barrage', shot, [[50, -80], [50, -30], [50, 30], [50, 80]], { barrageWidth: 200, barrageSeek: true });
    steps(crowd, 15);
    expect(damage(crowd, 4).every((d) => d > 0)).toBe(true);
  });
});

describe('炎の技の作り直し（07 の234章）', () => {
  it('落とす場所の一部を敵へ（lobSeekShare）: 12 個のうち 3 個が敵のいる所へ落ち、残りはランダムな地面', () => {
    const lobs = (enemies: [number, number][]): number => {
      const sim = setup('lob', { count: 12, speed: 500, range: 300, size: 8, durationSeconds: 1 }, enemies, { lobTarget: 'random', lobSeekShare: 0.25 });
      sim.step([]);
      const pr = sim.world.projectiles;
      let onEnemy = 0;
      // 横の速さ × 持続 = 落ちる場所までの横の距離
      for (let i = 0; i < pr.count; i++) if (Math.abs(pr.vx[i]! * 1 - 200) < 1) onEnemy++;
      expect(pr.count).toBe(12);
      return onEnemy;
    };
    expect(lobs([[200, 0]])).toBe(3);
    expect(lobs([])).toBeLessThanOrEqual(1);
  });

  it('切り返し（chainTurnBack）: 敵が 1 体なら 行く・突き抜ける・戻る で 3 回当たり、走らなかった分は待たない', () => {
    const chain = { count: 9, range: 300, size: 10, durationSeconds: 0.2, cooldownSeconds: 0.1, pierce: Infinity };
    const extra = { chainHopSeconds: 0.08, chainMinHop: 70, chainReturn: true, waitForEnd: true };
    const sim = setup('chain', chain, [[100, 0]], { ...extra, chainTurnBack: true });
    sim.step([]);
    // 行く + 突き抜ける の 2 回ぶん: 0.2 + 0.08 × 2。切り返しが無いと 0.2 + 0.08 × 9 待つ
    expect(sim.world.players[0]!.moves[0]!.cooldown).toBeLessThan(0.4);
    steps(sim, 8);
    expect(damage(sim, 1)[0]).toBe(30);

    const plain = setup('chain', chain, [[100, 0]], extra);
    plain.step([]);
    expect(plain.world.players[0]!.moves[0]!.cooldown).toBeGreaterThan(0.85);
    steps(plain, 8);
    expect(damage(plain, 1)[0]).toBe(20);
  });

  it('切り返し（chainTurnBack）: 敵が足りていれば切り返さず、数だけ敵へ跳ぶ', () => {
    const chain = { count: 3, range: 300, size: 10, durationSeconds: 0.2, cooldownSeconds: 0.1, pierce: Infinity };
    const sim = setup('chain', chain, [[100, 0], [190, 0], [280, 0], [370, 0]], { chainHopSeconds: 0.08, chainMinHop: 70, chainReturn: true, waitForEnd: true, chainTurnBack: true });
    sim.step([]);
    // 3 本 + 戻る線 1 本
    expect(sim.world.projectiles.count).toBe(4);
  });
});

describe('本体が当たった相手を避ける効き方（avoidTarget。07 の233章）', () => {
  /** 敵 1（本体が当たる）と、すぐ隣の敵 2。hit の効き方つきの弾を 1 発だけ撃つ */
  const fight = (fx: MoveEffect): { hit: number; next: number; kids: number } => {
    const sim = setup('nearest', { speed: 400, size: 8, range: 300, durationSeconds: 1, pierce: 1, count: 1 }, [[60, 0], [75, 0]], { effects: [fx] });
    let kids = 0;
    for (let t = 0; t < 45; t++) {
      sim.step([]);
      const pr = sim.world.projectiles;
      for (let i = 0; i < pr.count; i++) if (pr.stage[i] === 1) kids = Math.max(kids, pr.count);
    }
    const [hit, next] = damage(sim, 2);
    return { hit: hit!, next: next!, kids };
  };
  const rocks = { sizeMultiplier: 2, powerMultiplier: 1, count: 4, radius: 8, durationSeconds: 0.5, hitIntervalSeconds: 0.1 };

  it('岩の群れは、本体が当たった敵には当たらず、隣の敵には当たる', () => {
    const on = fight({ trigger: 'hit', avoidTarget: true, cluster: rocks });
    expect(on.kids).toBeGreaterThan(0);
    expect(on.hit).toBe(10);
    expect(on.next).toBeGreaterThan(0);
    // 付けないと、本体が当たった敵にも岩が重なる
    const off = fight({ trigger: 'hit', cluster: rocks });
    expect(off.hit).toBeGreaterThan(10);
    expect(off.next).toBe(on.next);
  });

  it('破片と、その着地に残る範囲も、本体が当たった敵には当たらない', () => {
    const shards: MoveEffect = {
      trigger: 'hit',
      avoidTarget: true,
      split: { sizeMultiplier: 2, powerMultiplier: 1, count: 3, speed: 20, durationSeconds: 0.2, spreadDegrees: 360, boomerang: false, pierce: 'infinite', land: { sizeMultiplier: 2, powerMultiplier: 1, durationSeconds: 0.5, hitIntervalSeconds: 0.1 } },
    };
    const on = fight(shards);
    expect(on.hit).toBe(10);
    expect(on.next).toBeGreaterThan(0);
    const { avoidTarget: _drop, ...plain } = shards;
    expect(fight(plain).hit).toBeGreaterThan(10);
  });
});

describe('続けて当てるほど強くなる（エコーボイス。07 の240章）', () => {
  const echo = { maxStacks: 4, powerPerStack: 0.5, sizePerStack: 0.1, growPerSecond: 0 };
  /** 前の敵へ facing で撃ち続け、出した輪の 1 発目の威力を、出した順に集める（敵がいなければ外れる） */
  const casts = (enemyAt: [number, number][], n: number): { damage: number; rings: number }[] => {
    const sim = setup('facing', { speed: 600, size: 10, range: 200, durationSeconds: 0.3, cooldownSeconds: 0.5, count: 1, intervalSeconds: 0.05 }, enemyAt, { echo });
    const out: { damage: number; rings: number }[] = [];
    const seen = new Set<number>();
    for (let t = 0; t < 15 * n + 5; t++) {
      sim.step([]);
      const pr = sim.world.projectiles;
      for (let i = 0; i < pr.count; i++) {
        if (seen.has(pr.serial[i]!)) continue;
        seen.add(pr.serial[i]!);
        const last = out[out.length - 1];
        // 0.5 秒ごとに出す。同じ回のこだまの輪（0.05 秒あと）は数だけ足す
        if (last && t - (last as { t?: number }).t! < 5) last.rings++;
        else out.push(Object.assign({ damage: pr.damage[i]!, rings: 1 }, { t }));
      }
    }
    return out.slice(0, n);
  };

  it('当たり続けると段が上がって威力が上がり、2 段ごとにこだまの輪が増える。最大で止まる', () => {
    const got = casts([[100, 0]], 6);
    // 段 0・1・2・3・4・4。威力は ×(1 + 0.5 × 段) を輪の数で分けた値
    expect(got.map((g) => g.rings)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(got.map((g) => Math.round(g.damage * 10) / 10)).toEqual([10, 15, 10, 12.5, 10, 10]);
  });

  it('外れたら（前に敵がいない）段は上がらない', () => {
    const got = casts([[-100, 0]], 3);
    expect(got.map((g) => g.damage)).toEqual([10, 10, 10]);
    expect(got.map((g) => g.rings)).toEqual([1, 1, 1]);
  });
});

describe('HP が半分を切った相手に強い（しおみず。07 の247章）', () => {
  /** 前の敵へ 1 発だけ撃ち、受けたダメージを返す（敵の HP は最大 1000 のうち hp） */
  const hitAt = (hp: number, bonus: boolean): number => {
    const sim = setup('nearest', { speed: 600, size: 8, range: 300, durationSeconds: 1, pierce: 1, count: 1 }, [[60, 0]], bonus ? { lowHpBonus: { thresholdPct: 50, powerPct: 100 } } : {});
    sim.world.enemies.hp[0] = hp;
    for (let t = 0; t < 10; t++) sim.step([]);
    return hp - sim.world.enemies.hp[0]!;
  };

  it('半分を切っていれば倍、半分より多ければ同じ', () => {
    expect(hitAt(1000, true)).toBe(10);
    expect(hitAt(600, true)).toBe(10);
    expect(hitAt(500, true)).toBe(20);
    expect(hitAt(300, true)).toBe(20);
    expect(hitAt(300, false)).toBe(10);
  });
});

describe('追う弾は、倒れる見込みの敵を飛ばして狙いを分ける（07 の248章）', () => {
  /** HP の少ない敵 3 体（1 発で倒れる）へ、追う弾を 3 発続けて撃ち、それぞれの弾が狙った敵の id を返す */
  const targets = (hp: number): number[] => {
    const sim = setup('homing', { speed: 200, size: 4, range: 400, durationSeconds: 3, pierce: 1, count: 3, intervalSeconds: 0.03, cooldownSeconds: 100 }, [[120, 0], [120, 60], [120, -60]]);
    for (let k = 0; k < 3; k++) sim.world.enemies.hp[k] = hp;
    const got = new Set<number>();
    for (let t = 0; t < 4; t++) {
      sim.step([]);
      const pr = sim.world.projectiles;
      for (let i = 0; i < pr.count; i++) if (pr.target[i]! > 0) got.add(pr.target[i]! - 1);
    }
    return [...got].sort();
  };

  it('1 発で倒れる敵が 3 体なら、3 発は 3 体に分かれる', () => {
    expect(targets(5)).toEqual([1, 2, 3]);
  });

  it('1 発で倒れない（HP の多い）敵なら、一番近い敵に集まる', () => {
    expect(targets(1000)).toEqual([1]);
  });
});
