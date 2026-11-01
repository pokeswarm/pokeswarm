import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import { MOTION_FOLLOW, SHAPE_BOX, SHAPE_LINE, SHAPE_SECTOR } from './entities/projectiles';
import { Simulation } from './simulation';
import { contactDamageMultiplier } from './systems/status';

/** みずの技の組み直し（作者の依頼 2026年11月1日。07 の149章） */
function setup(move: string, level = 1) {
  const rules = buildSimRules('hoenn');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const m = moveIndexOf(rules, move);
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, moves: [{ move: m, level }] });
  const pr = sim.world.projectiles;
  const statusIndex = (id: string): number => rules.status.kinds.findIndex((k) => k.id === id);
  const find = (pred: (i: number) => boolean): number[] => [...Array(pr.count).keys()].filter(pred);
  return { rules, sim, p, m, pr, statusIndex, find };
}

describe('なみのり・だくりゅう: 自分を中心にした正方形の波', () => {
  it('なみのり: 自分を含む正方形（frontBox −1〜1）が自分に付いてきて、出ている間は少し速く動ける', () => {
    const t = setup('surf');
    const def = t.rules.moves[t.m]!;
    expect(def.frontBox).toEqual({ start: -1, end: 1, halfWidth: 1 });
    const before = t.p.moveSpeed;
    t.sim.step([{ type: 'spawnEnemy', id: 1, kind: 0, x: 60, y: 0 }]);
    const boxes = t.find((i) => t.pr.move[i] === t.m && t.pr.shape[i] === SHAPE_BOX);
    expect(boxes).toHaveLength(1);
    const i = boxes[0]!;
    expect(t.pr.motion[i]).toBe(MOTION_FOLLOW);
    // 正方形: 届く距離（range + size）を半分の辺として、横幅も同じ
    expect(t.pr.length[i]).toBeCloseTo(t.pr.radius[i]!);
    t.p.x += 50;
    t.p.y -= 30;
    t.sim.step([]);
    expect(t.pr.x[i]).toBeCloseTo(t.p.x);
    expect(t.pr.y[i]).toBeCloseTo(t.p.y);
    // 移動速度の強化（selfBuff）
    expect(t.p.moveBuffs?.some((b) => b.move === t.m)).toBe(true);
    expect(t.p.moveSpeed).toBeCloseTo(before * 1.2);
  });

  it('だくりゅう: 速くならず、当たった敵は必ず みずびたし（遅くなる）', () => {
    for (const key of ['muddy-water', 'muddy-water-hoenn']) {
      const t = setup(key);
      expect(t.rules.moves[t.m]!.levels[0]!.statusChance).toBe(1);
      const before = t.p.moveSpeed;
      // 倒れないよう HP の多い敵
      t.sim.world.enemies.add(1, 0, 40, 0, 1e6, 0, 10);
      for (let k = 0; k < 3; k++) t.sim.step([]);
      expect(t.sim.world.enemies.hasStatus(0, t.statusIndex('soaked'))).toBe(true);
      expect(t.p.moveBuffs ?? []).toHaveLength(0);
      expect(t.p.moveSpeed).toBeCloseTo(before);
    }
  });
});

describe('バブルこうせん・みずのはどう', () => {
  it('バブルこうせん: 近い敵へ飛ぶ線（オーロラビームと同じ出し方）', () => {
    for (const key of ['bubble-beam', 'bubble-beam-hoenn']) {
      const t = setup(key);
      expect(t.rules.moves[t.m]!.pattern).toBe('beam');
      t.sim.step([{ type: 'spawnEnemy', id: 1, kind: 0, x: 200, y: 0 }]);
      const lines = t.find((i) => t.pr.move[i] === t.m && t.pr.shape[i] === SHAPE_LINE);
      expect(lines).toHaveLength(1);
      expect(t.pr.dirX[lines[0]!]).toBeCloseTo(1);
    }
  });

  it('みずのはどう: りゅうのはどうと同じ数・速さ・間隔で、一番近い敵へ輪を続けて飛ばす', () => {
    const rules = buildSimRules('hoenn');
    const wp = rules.moves[moveIndexOf(rules, 'water-pulse')]!;
    const dp = rules.moves[moveIndexOf(rules, 'dragon-pulse-hoenn')]!;
    expect(wp.pattern).toBe('nearest');
    for (const k of ['count', 'speed', 'intervalSeconds', 'size', 'range', 'durationSeconds', 'cooldownSeconds'] as const) expect(wp.levels[0]![k]).toBe(dp.levels[0]![k]);
    expect(wp.effects).toHaveLength(0);
  });
});

describe('アクアテール: 往復のなぎ払いの後に、前方長方形の叩きつけ', () => {
  it('叩きつけは 0.4 秒遅れて出る（comboOffsetSeconds）', () => {
    for (const [key, slamKey] of [
      ['aqua-tail', 'aqua-tail-slam'],
      ['aqua-tail-azumarill', 'aqua-tail-slam-azumarill'],
    ] as const) {
      const t = setup(key);
      const slam = moveIndexOf(t.rules, slamKey);
      expect(t.rules.moves[t.m]!.comboMoves).toEqual([slam]);
      expect(t.rules.moves[slam]!.comboOffsetSeconds).toBe(0.4);
      t.sim.step([{ type: 'spawnEnemy', id: 1, kind: 0, x: 60, y: 0 }]);
      expect(t.find((i) => t.pr.move[i] === t.m && t.pr.shape[i] === SHAPE_SECTOR)).toHaveLength(1);
      expect(t.find((i) => t.pr.move[i] === slam)).toHaveLength(0);
      for (let k = 0; k < Math.round(0.4 * 30) + 1; k++) t.sim.step([]);
      const boxes = t.find((i) => t.pr.move[i] === slam && t.pr.shape[i] === SHAPE_BOX);
      expect(boxes).toHaveLength(1);
    }
  });
});

describe('ウェーブタックル・ねっとう', () => {
  it('ウェーブタックル: 当たった敵それぞれから、しぶきの範囲ダメージが出る（eachHit）', () => {
    const t = setup('wave-crash');
    t.p.facingX = 1;
    t.p.facingY = 0;
    t.sim.step([
      { type: 'spawnEnemy', id: 1, kind: 0, x: 100, y: 0 },
      { type: 'spawnEnemy', id: 2, kind: 0, x: 160, y: 0 },
      { type: 'spawnEnemy', id: 3, kind: 0, x: 220, y: 0 },
    ]);
    for (let k = 0; k < 3; k++) t.sim.step([]);
    const splashes = t.find((i) => t.pr.move[i] === t.m && t.pr.stage[i] === 1);
    expect(splashes).toHaveLength(3);
  });

  it('ねっとう: 前へ細長い扇で、当たった敵は やけど になり、ぶつかる攻撃の力が半分になる', () => {
    const t = setup('scald');
    expect(t.rules.moves[t.m]!.pattern).toBe('melee');
    expect(t.rules.moves[t.m]!.countWidens).toBe(12);
    t.p.facingX = 1;
    t.p.facingY = 0;
    t.sim.world.enemies.add(1, 0, 60, 0, 1e6, 0, 10);
    for (let k = 0; k < 3; k++) t.sim.step([]);
    const burn = t.statusIndex('burn');
    expect(t.sim.world.enemies.hasStatus(0, burn)).toBe(true);
    expect(contactDamageMultiplier(t.sim.world, 0)).toBeCloseTo(0.5);
  });
});
