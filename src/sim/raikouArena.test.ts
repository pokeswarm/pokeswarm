import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSimRules } from '../data/simRules';
import { Simulation } from './simulation';
import { startIntruder } from './systems/stage';
import { elapsedSeconds } from './world';

/** 乱入の固定マップとライコウ（07 の211章） */
function setup(players = 1, section = 3, kindId = 'legend-raikou') {
  const rules = buildSimRules('johto');
  const sim = new Simulation({ tickRate: 30, seed: 11, rules });
  for (let p = 1; p <= players; p++) sim.addPlayer({ id: p, x: 300 + p * 50, y: 400, radius: 12, moveSpeed: 180 });
  for (const p of sim.world.players) p.maxHp = p.hp = 1e9;
  sim.world.section = section;
  const kind = rules.enemies.kinds.findIndex((k) => k.id === kindId);
  const step = (seconds: number): void => {
    for (let t = 0; t < seconds * 30; t++) {
      if (sim.world.levelUp) (sim.world as { levelUp: unknown }).levelUp = null;
      sim.step([]);
    }
  };
  const bossIndex = (): number => {
    const e = sim.world.enemies;
    for (let i = 0; i < e.count; i++) if (e.id[i] === sim.world.bosses[0]?.id) return i;
    return -1;
  };
  const ids = (): (string | undefined)[] => sim.world.hazards.map((h) => rules.stage.moves[h.move]?.id);
  const force = (...names: string[]): void => {
    const boss = sim.world.bosses[0]!;
    sim.world.hazards.length = 0;
    boss.moves = names.map((id) => rules.stage.moves.findIndex((m) => m.id === id));
    boss.next = 0;
    boss.cooldown = 1;
    boss.holdUntil = undefined;
  };
  return { sim, rules, kind, step, bossIndex, ids, force };
}

describe('乱入の固定マップ（07 の211章）', () => {
  it('移ると雑魚がいなくなり、HP は区間の中ボスの 6 倍で、元の場所を覚える', () => {
    const { sim, kind, step, bossIndex } = setup();
    step(3);
    const before = sim.world.players[0]!;
    const px = before.x;
    const py = before.y;
    startIntruder(sim.world, kind);
    expect(sim.world.arena).toBeTruthy();
    expect(sim.world.intruder!.arena!.back[0]).toEqual({ id: 1, x: px, y: py });
    step(3.5);
    const e = sim.world.enemies;
    expect(e.maxHp[bossIndex()]).toBeCloseTo(2700 * 6, 3);
    for (let i = 0; i < e.count; i++) if (e.hp[i]! > 0) expect(sim.world.rules.enemies.kinds[e.kind[i]!]!.id).toBe('legend-raikou');
  });

  it('固定マップの間は雑魚が湧かず、ランの時計は止まる', () => {
    const { sim, kind, step } = setup();
    step(3);
    const clock = elapsedSeconds(sim.world);
    const start = sim.world.sectionStartTick;
    startIntruder(sim.world, kind);
    step(20);
    expect(sim.world.enemies.count).toBeLessThanOrEqual(1);
    step(50);
    expect(sim.world.arena).toBeNull();
    // 入っていた分だけ、区間の始まりが後ろへずれ、時計は戦いの前のまま（戻ってからの少しだけ進む）
    expect(sim.world.sectionStartTick).toBeGreaterThan(start + 60 * 30);
    expect(elapsedSeconds(sim.world)).toBeLessThan(clock + 10);
  });

  it('1 分で走り去って、元の場所へ戻る。戻った直後は無敵', () => {
    const { sim, kind, step, bossIndex } = setup();
    step(2);
    const p = sim.world.players[0]!;
    const px = p.x;
    const py = p.y;
    startIntruder(sim.world, kind);
    const types: string[] = [];
    let backed = false;
    for (let t = 0; t < 30 * 70 && !backed; t++) {
      sim.step([]);
      types.push(...sim.world.events.map((ev) => ev.type));
      backed = sim.world.arena === null;
    }
    expect(types).toContain('intruderLeft');
    expect(backed).toBe(true);
    expect(sim.world.intruder?.done).toBe(true);
    expect(p.x).toBeCloseTo(px, 1);
    expect(p.y).toBeCloseTo(py, 1);
    expect(p.invincibleTicks).toBeGreaterThan(0);
    expect(bossIndex()).toBe(-1);
  });

  it('倒すと、走り去らずに元のマップへ戻る', () => {
    const { sim, kind, step, bossIndex } = setup();
    step(1);
    startIntruder(sim.world, kind);
    step(4);
    sim.world.enemies.hp[bossIndex()] = 0;
    sim.world.events.length = 0;
    const types: string[] = [];
    for (let t = 0; t < 30 * 4; t++) {
      sim.step([]);
      types.push(...sim.world.events.map((ev) => ev.type));
    }
    expect(types).not.toContain('intruderLeft');
    expect(sim.world.arena).toBeNull();
  });

  it('中ボスが出ている間は、乱入の判定を待つ', () => {
    const { sim, rules, step } = setup();
    const cfg = sim.world.rules.stage.legendary!.intruders as { chance: number };
    cfg.chance = 1;
    sim.world.tick = 5 * 60 * 30 - 1;
    sim.world.sectionStartTick = sim.world.tick - 100 * 30;
    step(1);
    // 中ボスが出ている
    expect(sim.world.enemies.count).toBeGreaterThan(0);
    expect(sim.world.intruder).toBeNull();
    const e = sim.world.enemies;
    for (let i = 0; i < e.count; i++) if ((rules.enemies.kinds[e.kind[i]!]!.rank ?? 'normal') !== 'normal') e.hp[i] = 0;
    step(0.5);
    expect(sim.world.intruder).toBeTruthy();
  });

  it('エンテイとスイクンも固定マップで戦い、1 分で元のマップへ戻る', () => {
    for (const id of ['legend-entei', 'legend-suicune']) {
      const { sim, kind } = setup(1, 3, id);
      startIntruder(sim.world, kind);
      // スイクンは凍てつく登場の後に移る
      for (let t = 0; t < 30 * 4 && !sim.world.arena; t++) sim.step([]);
      expect(sim.world.arena).toBeTruthy();
      for (let t = 0; t < 30 * 70 && sim.world.arena; t++) sim.step([]);
      expect(sim.world.arena).toBeNull();
    }
  });

  it('2 人なら HP は人数倍のまま', () => {
    const { sim, kind, step, bossIndex } = setup(2);
    startIntruder(sim.world, kind);
    step(3.5);
    expect(sim.world.enemies.maxHp[bossIndex()]).toBeCloseTo(2700 * 6 * 2, 3);
  });
});

describe('ライコウの技（07 の211章）', () => {
  const inArena = (s: ReturnType<typeof setup>) => {
    s.step(0);
    startIntruder(s.sim.world, s.kind);
    s.step(3.2);
  };

  it('しんそく: 折れ線の角の 1 つは狙った人の場所を通り、線を走って反対側へ着く', () => {
    const s = setup();
    inArena(s);
    const { sim } = s;
    const a = sim.world.arena!;
    const p = sim.world.players[0]!;
    s.force('raikou-extreme-speed');
    s.step(0.1);
    const lines = sim.world.hazards.filter((h) => sim.world.rules.stage.moves[h.move]?.id === 'raikou-extreme-speed');
    expect(lines.length).toBe(4);
    const ends = lines.map((h) => [h.x + h.dirX * h.length, h.y + h.dirY * h.length] as const);
    expect(ends.some(([x, y]) => Math.hypot(x - p.x, y - p.y) < 60)).toBe(true);
    const startX = sim.world.enemies.x[s.bossIndex()]!;
    s.step(1.8);
    const endX = sim.world.enemies.x[s.bossIndex()]!;
    expect(Math.abs(endX - startX)).toBeGreaterThan(200);
    expect(Math.abs(endX - a.x)).toBeLessThanOrEqual(a.halfWidth);
  });

  it('しんそく: 2 回走って、次の技へ進む', () => {
    const s = setup();
    inArena(s);
    s.force('raikou-extreme-speed', 'raikou-charge');
    let casts = 0;
    let prev = false;
    let charged = false;
    for (let t = 0; t < 30 * 8; t++) {
      s.step(1 / 30);
      const now = s.ids().includes('raikou-extreme-speed');
      if (now && !prev) casts++;
      prev = now;
      charged = charged || s.ids().includes('raikou-charge');
    }
    expect(casts).toBeGreaterThanOrEqual(2);
    expect(charged).toBe(true);
  });

  it('ボルトチェンジ: 順につながって戻る 7 本の線が、ずれて落ちる', () => {
    const s = setup();
    inArena(s);
    s.force('raikou-volt-switch');
    s.step(0.1);
    const { sim } = s;
    const lines = sim.world.hazards.filter((h) => sim.world.rules.stage.moves[h.move]?.id === 'raikou-volt-line');
    expect(lines.length).toBe(7);
    for (let k = 1; k < lines.length; k++) {
      expect(lines[k]!.ticksLeft).toBeGreaterThan(lines[k - 1]!.ticksLeft);
      const prev = lines[k - 1]!;
      expect(Math.hypot(prev.x + prev.dirX * prev.length - lines[k]!.x, prev.y + prev.dirY * prev.length - lines[k]!.y)).toBeLessThan(2);
    }
  });

  it('かみなり: 雲はプレイヤーより遅く流れ、下に落雷が続く。雲は当たらない', () => {
    const s = setup();
    inArena(s);
    s.force('raikou-thunder');
    s.step(1.5);
    const { sim } = s;
    const clouds = sim.world.hazards.filter((h) => sim.world.rules.stage.moves[h.move]?.id === 'raikou-cloud');
    expect(clouds.length).toBe(3);
    const cloud = sim.world.rules.stage.moves.find((m) => m.id === 'raikou-cloud')!;
    expect(cloud.bullets!.speed).toBeLessThan(180);
    expect(cloud.damage).toBe(0);
    expect(s.ids()).toContain('raikou-cloud-bolt');
  });

  it('じゅうでん: 3 秒止まる', () => {
    const s = setup();
    inArena(s);
    s.force('raikou-charge');
    s.step(0.5);
    const i = s.bossIndex();
    const x = s.sim.world.enemies.x[i]!;
    s.step(2);
    expect(s.sim.world.enemies.x[s.bossIndex()]).toBe(x);
  });

  it('ほうでん: HP 50% で 1 回、向きをずらして 2 回放ち、そのあと止まる', () => {
    const s = setup();
    inArena(s);
    const { sim } = s;
    sim.world.hazards.length = 0;
    const e = sim.world.enemies;
    e.hp[s.bossIndex()] = e.maxHp[s.bossIndex()]! * 0.49;
    const seen: string[] = [];
    for (let t = 0; t < 30 * 8; t++) {
      s.step(1 / 30);
      for (const id of s.ids()) if (id && !seen.includes(id)) seen.push(id);
    }
    expect(seen).toContain('raikou-discharge');
    expect(seen).toContain('raikou-discharge-2');
    expect(seen).toContain('raikou-tired');
  });

  it('固定マップの絵があり、その画像が public にある', () => {
    const s = setup();
    inArena(s);
    const map = s.sim.world.arena!.map!;
    expect(map.floor).toBe('map/johto/arena-raikou-floor.png');
    for (const file of [map.floor, map.wall, ...(map.shimmer ?? [])]) expect(fs.existsSync(path.join('public', file))).toBe(true);
  });

  it('動いても、走る速さはプレイヤーより遅く、壁の中にいる', () => {
    const s = setup();
    inArena(s);
    const { sim } = s;
    const a = sim.world.arena!;
    expect(sim.world.rules.enemies.kinds[s.kind]!.moveSpeed * (sim.world.rules.stage.bossRules.legendSpeedMultiplier ?? 1)).toBeLessThan(180);
    for (let t = 0; t < 30 * 50; t++) {
      s.step(1 / 30);
      const i = s.bossIndex();
      if (i === -1) break;
      expect(Math.abs(sim.world.enemies.x[i]! - a.x)).toBeLessThanOrEqual(a.halfWidth + 1);
      expect(Math.abs(sim.world.enemies.y[i]! - a.y)).toBeLessThanOrEqual(a.halfHeight + 1);
    }
  });
});
