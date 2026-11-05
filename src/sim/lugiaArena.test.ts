import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSimRules } from '../data/simRules';
import { Simulation } from './simulation';
import { absorbBarrier, startLegendary } from './systems/stage';

/** ルギアの固定マップと技（07 の203・204章） */
function setup(): { sim: Simulation; step: (seconds: number) => void; force: (...ids: string[]) => void } {
  const rules = buildSimRules('johto');
  const sim = new Simulation({ tickRate: 30, seed: 7, rules });
  sim.addPlayer({ id: 1, x: 500, y: 500, radius: 12, moveSpeed: 180 });
  sim.world.players[0]!.maxHp = sim.world.players[0]!.hp = 1e9;
  startLegendary(sim.world, rules.enemies.kinds.findIndex((k) => k.id === 'legend-lugia'));
  const step = (seconds: number): void => {
    for (let t = 0; t < seconds * 30; t++) sim.step([]);
  };
  step(3.2);
  return {
    sim,
    step,
    force: (...ids) => {
      const boss = sim.world.bosses[0]!;
      boss.moves = ids.map((id) => rules.stage.moves.findIndex((m) => m.id === id));
      boss.next = 0;
      boss.cooldown = 1;
    },
  };
}

describe('固定マップ（07 の203章）', () => {
  it('プレイヤーはマップの中へ移り、ルギアは奥に出る', () => {
    const { sim } = setup();
    const a = sim.world.arena!;
    const p = sim.world.players[0]!;
    expect(Math.abs(p.x - a.x)).toBeLessThan(a.halfWidth);
    expect(Math.abs(p.y - a.y)).toBeLessThan(a.halfHeight);
    expect(sim.world.enemies.x[0]).toBeCloseTo(a.x);
    expect(sim.world.enemies.y[0]!).toBeLessThan(a.y);
  });

  it('プレイヤーは壁の外へ出られない', () => {
    const { sim, step } = setup();
    const a = sim.world.arena!;
    const p = sim.world.players[0]!;
    p.inputX = 1;
    p.inputY = 1;
    step(15);
    expect(p.x).toBeLessThanOrEqual(a.x + a.halfWidth);
    expect(p.y).toBeLessThanOrEqual(a.y + a.halfHeight);
  });
});

describe('ルギアの技（07 の204章）', () => {
  it('エアロブラスト: ためた後に玉を撃ち、着弾した所に竜巻が広がる', () => {
    const { sim, step, force } = setup();
    force('lugia-aeroblast');
    const id = (h: (typeof sim.world.hazards)[number]) => sim.world.rules.stage.moves[h.move]?.id;
    step(1.7);
    expect(sim.world.hazards.filter((h) => id(h) === 'lugia-aeroblast-shot').length).toBe(6);
    sim.world.bosses[0]!.cooldown = 1e6;
    step(2);
    const twisters = sim.world.hazards.filter((h) => id(h) === 'lugia-aero-tornado');
    expect(twisters.length).toBe(6);
    const last = twisters[twisters.length - 1]!;
    const small = last.radius;
    step(1.2);
    expect(last.radius).toBeGreaterThan(small);
    expect(last.radius).toBe(90);
  });

  it('エアロブラスト: 狙わず、マップ全体へ満遍なく落とす', () => {
    const { sim, step, force } = setup();
    const a = sim.world.arena!;
    const p = sim.world.players[0]!;
    p.x = a.x - 700;
    p.y = a.y + 400;
    force('lugia-aeroblast');
    step(1.7);
    const shots = sim.world.hazards.filter((h) => sim.world.rules.stage.moves[h.move]?.id === 'lugia-aeroblast-shot');
    // 6 発は横 3・縦 2 の区画に 1 発ずつ
    const cells = new Set(shots.map((h) => `${Math.floor((h.x - (a.x - a.halfWidth)) / ((a.halfWidth * 2) / 3))},${Math.floor((h.y - (a.y - a.halfHeight)) / a.halfHeight)}`));
    expect(cells.size).toBe(6);
  });

  it('エアロブラスト: HP が半分を切ると玉が増える', () => {
    const { sim, step, force } = setup();
    sim.world.bosses[0]!.hpMoves = [];
    sim.world.enemies.hp[0] = sim.world.enemies.maxHp[0]! * 0.4;
    force('lugia-aeroblast');
    step(1.7);
    expect(sim.world.hazards.filter((h) => sim.world.rules.stage.moves[h.move]?.id === 'lugia-aeroblast-shot').length).toBe(9);
  });

  it('ハイドロポンプ: 左右の端へ飛び、中央の方へなぎ払い、奥へ戻る', () => {
    const { sim, step, force } = setup();
    const a = sim.world.arena!;
    force('lugia-fly-side', 'lugia-fly-top');
    step(2.3);
    expect(Math.abs(sim.world.enemies.x[0]! - a.x)).toBeCloseTo(640, 0);
    const beam = sim.world.hazards.find((h) => sim.world.rules.stage.moves[h.move]?.id === 'lugia-hydro-sweep')!;
    expect(beam).toBeTruthy();
    // 壁で止めず、画面の外まで伸びる
    expect(beam.length).toBeGreaterThan(a.halfWidth * 2);
    expect(beam.dirX).toBe(Math.sign(a.x - sim.world.enemies.x[0]!));
    step(2.4);
    expect(beam.activeTicks).toBeDefined();
    expect(Math.abs(beam.dirY)).toBeGreaterThan(0.1);
    step(5.4);
    expect(sim.world.enemies.y[0]!).toBeCloseTo(a.y - 240, 0);
  });

  it('ふきとばし: 奥の定位置で寄られたら押し返す', () => {
    const { sim, step, force } = setup();
    force('lugia-aeroblast');
    sim.world.bosses[0]!.cooldown = 1e6;
    const p = sim.world.players[0]!;
    p.x = sim.world.enemies.x[0]!;
    p.y = sim.world.enemies.y[0]! + 150;
    const y0 = p.y;
    step(1.2);
    expect(p.y).toBeGreaterThan(y0 + 100);
  });

  it('じこさいせい: HP が半分を切ると 1 回だけ降りてきて、ためきると回復する', () => {
    const { sim, step } = setup();
    const e = sim.world.enemies;
    sim.world.bosses[0]!.reactive = undefined;
    e.hp[0] = e.maxHp[0]! * 0.45;
    step(4);
    const a = sim.world.arena!;
    expect(sim.world.bosses[0]!.interrupt).toBeDefined();
    expect(e.y[0]!).toBeCloseTo(a.y - 20, 0);
    step(9);
    expect(e.hp[0]!).toBeCloseTo(e.maxHp[0]! * 0.7, -1);
    expect(sim.world.bosses[0]!.hpMoves).toEqual([]);
  });

  it('じこさいせい: ため中に決まった量のダメージを受けると、回復せずに動けなくなる', () => {
    const { sim, step } = setup();
    const e = sim.world.enemies;
    sim.world.bosses[0]!.reactive = undefined;
    e.hp[0] = e.maxHp[0]! * 0.45;
    step(4);
    const hp = e.hp[0]!;
    const hit = e.maxHp[0]! * 0.06;
    e.hp[0]! -= absorbBarrier(sim.world, 0, hit);
    step(0.5);
    const id = (h: (typeof sim.world.hazards)[number]) => sim.world.rules.stage.moves[h.move]?.id;
    expect(sim.world.hazards.some((h) => id(h) === 'lugia-down')).toBe(true);
    expect(sim.world.hazards.some((h) => id(h) === 'lugia-roost')).toBe(false);
    step(8);
    expect(e.hp[0]!).toBeLessThanOrEqual(hp - hit + 1);
  });

  it('技の流れを通しで回せる', () => {
    const { sim } = setup();
    const used = new Set<string>();
    for (let t = 0; t < 60 * 30; t++) {
      sim.step([]);
      for (const h of sim.world.hazards) used.add(sim.world.rules.stage.moves[h.move]?.id ?? '');
    }
    for (const id of ['lugia-aeroblast', 'lugia-aeroblast-shot', 'lugia-aero-tornado', 'lugia-fly-side', 'lugia-hydro-sweep', 'lugia-fly-top']) expect(used).toContain(id);
  });
});

describe('固定マップの絵（07 の205章）', () => {
  it('マップへ移ると絵の指定が渡り、その画像が public にある', () => {
    const { sim } = setup();
    const map = sim.world.arena!.map!;
    expect(map).toBeTruthy();
    for (const file of [map.floor, map.wall, ...(map.shimmer ?? [])]) expect(fs.existsSync(path.join('public', file))).toBe(true);
  });
});

