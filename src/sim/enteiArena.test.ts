import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSimRules } from '../data/simRules';
import { Simulation } from './simulation';
import { startIntruder } from './systems/stage';

/** エンテイの技（07 の214章） */
function setup() {
  const rules = buildSimRules('johto');
  const sim = new Simulation({ tickRate: 30, seed: 5, rules });
  sim.addPlayer({ id: 1, x: 300, y: 300, radius: 12, moveSpeed: 180 });
  const p = sim.world.players[0]!;
  p.maxHp = p.hp = 1e9;
  sim.world.section = 3;
  const kind = rules.enemies.kinds.findIndex((k) => k.id === 'legend-entei');
  startIntruder(sim.world, kind);
  const step = (seconds: number): void => {
    for (let t = 0; t < seconds * 30; t++) sim.step([]);
  };
  step(3.2);
  const bossIndex = (): number => {
    const e = sim.world.enemies;
    for (let i = 0; i < e.count; i++) if (e.id[i] === sim.world.bosses[0]?.id) return i;
    return -1;
  };
  const of = (id: string) => sim.world.hazards.filter((h) => rules.stage.moves[h.move]?.id === id);
  const force = (...names: string[]): void => {
    const boss = sim.world.bosses[0]!;
    sim.world.hazards.length = 0;
    boss.moves = names.map((id) => rules.stage.moves.findIndex((m) => m.id === id));
    boss.next = 0;
    boss.cooldown = 1;
    boss.holdUntil = undefined;
  };
  return { sim, rules, step, bossIndex, of, force, p };
}

describe('エンテイ（07 の214章）', () => {
  it('固定マップの絵があり、その画像が public にある', () => {
    const { sim } = setup();
    const map = sim.world.arena!.map!;
    expect(map.floor).toBe('map/johto/arena-entei-floor.png');
    for (const file of [map.floor, map.wall, ...(map.shimmer ?? [])]) expect(fs.existsSync(path.join('public', file))).toBe(true);
  });

  it('歩く速さはプレイヤーより遅く、体のまわりの炎はない', () => {
    const { sim, rules, bossIndex } = setup();
    expect(sim.world.enemies.speed[bossIndex()]).toBeDefined();
    const k = rules.enemies.kinds.find((x) => x.id === 'legend-entei')!;
    expect(k.moveSpeed * (rules.stage.bossRules.legendSpeedMultiplier ?? 1)).toBeLessThan(180);
    expect(rules.stage.legendary!.moveSets['legend-entei']!.field!.aura).toBeUndefined();
  });

  it('ふみつけ: 3 本の割れ目に、根元から順に炎が立つ。2 回続ける', () => {
    const { step, of, force, sim, rules } = setup();
    force('entei-stomp');
    step(0.1);
    expect(of('entei-crack').length).toBe(3);
    const flames = of('entei-fissure-flame');
    expect(flames.length).toBeGreaterThan(9);
    const bx = sim.world.hazards.find((h) => rules.stage.moves[h.move]?.id === 'entei-crack')!.x;
    const by = sim.world.hazards.find((h) => rules.stage.moves[h.move]?.id === 'entei-crack')!.y;
    const near = flames.reduce((m, h) => (Math.hypot(h.x - bx, h.y - by) < Math.hypot(m.x - bx, m.y - by) ? h : m));
    const far = flames.reduce((m, h) => (Math.hypot(h.x - bx, h.y - by) > Math.hypot(m.x - bx, m.y - by) ? h : m));
    expect(near.ticksLeft).toBeLessThan(far.ticksLeft);
    const firstCracks = new Set(of('entei-crack'));
    step(2.2);
    expect(of('entei-crack').some((h) => !firstCracks.has(h))).toBe(true);
  });

  it('ほのおのうず: 輪に切れ目があり、狙った人へ狭まる。切れ目は壁を向かない', () => {
    const { step, of, force, sim, p } = setup();
    const a = sim.world.arena!;
    p.x = a.x + a.halfWidth - 100;
    p.y = a.y;
    force('entei-fire-spin');
    step(0.1);
    const flames = of('entei-ring-flame');
    expect(flames.length).toBeGreaterThan(0);
    expect(flames.length).toBeLessThan(25);
    // マップの真ん中の側に炎がない
    const towardCenter = flames.filter((h) => h.x < p.x - 240 && Math.abs(h.y - p.y) < 60);
    expect(towardCenter.length).toBe(0);
    const d0 = Math.hypot(flames[0]!.x - p.x, flames[0]!.y - p.y);
    step(1.5);
    expect(Math.hypot(flames[0]!.x - p.x, flames[0]!.y - p.y)).toBeLessThan(d0);
  });

  it('ほのおのうず: 輪の真ん中に立ち続けても、狭まりきると当たる', () => {
    const { step, force, sim, p } = setup();
    const a = sim.world.arena!;
    p.x = a.x;
    p.y = a.y + 100;
    const e = sim.world.enemies;
    force('entei-fire-spin');
    step(0.1);
    const ring = sim.world.hazards.filter((h) => sim.world.rules.stage.moves[h.move]?.id === 'entei-ring-flame');
    expect(ring.length).toBeGreaterThan(0);
    let tick = 0;
    const closest: number[] = [];
    for (; tick < 30 * 4.2; tick++) {
      step(1 / 30);
      if (ring[0] && ring[0].activeTicks !== undefined) closest.push(Math.hypot(ring[0].x - a.x, ring[0].y - (a.y + 100)));
    }
    void e;
    // 真ん中まで炎が届く距離（炎の半径 30 ＋ プレイヤーの半径 12）まで狭まる
    expect(Math.min(...closest)).toBeLessThanOrEqual(42);
  });

  it('ふんか: HP が高いほど火山弾が多く、そのあと止まる', () => {
    const { step, of, force, sim, bossIndex, rules } = setup();
    const e = sim.world.enemies;
    force('entei-eruption');
    step(1.4);
    const full = of('entei-eruption-bombs').length;
    expect(full).toBe(24);
    step(5);
    expect(of('entei-rest').length + of('entei-eruption-hold').length).toBeGreaterThan(0);
    const low = setup();
    low.sim.world.enemies.hp[low.bossIndex()] = low.sim.world.enemies.maxHp[low.bossIndex()]! * 0.25;
    low.sim.world.bosses[0]!.hpMoves = [];
    low.force('entei-eruption');
    low.step(1.4);
    expect(low.of('entei-eruption-bombs').length).toBe(6);
    void e;
    void bossIndex;
    void rules;
  });

  it('ふんえん: HP 50% で 1 回。中央へ跳び、島の場所を変えて 2 回あふれ、そのあと止まる', () => {
    const { step, of, sim, bossIndex, rules } = setup();
    const e = sim.world.enemies;
    const a = sim.world.arena!;
    e.hp[bossIndex()] = e.maxHp[bossIndex()]! * 0.49;
    const seen: string[] = [];
    const layouts: string[] = [];
    for (let t = 0; t < 30 * 20; t++) {
      step(1 / 30);
      for (const h of sim.world.hazards) {
        const id = rules.stage.moves[h.move]?.id ?? '';
        if (!seen.includes(id)) seen.push(id);
      }
      const isl = of('entei-island').map((h) => Math.round(h.x - a.x) + ',' + Math.round(h.y - a.y)).sort().join(' ');
      if (isl && !layouts.includes(isl)) layouts.push(isl);
    }
    for (const id of ['entei-to-center', 'entei-lava-1', 'entei-lava-2', 'entei-lava-sea', 'entei-tired']) expect(seen).toContain(id);
    expect(layouts.length).toBeGreaterThanOrEqual(2);
  });

  it('溶岩: 壁ぎわから満ちる。溶岩より速く逃げられ、島の上なら当たらず、外なら当たる', () => {
    const { step, sim, rules, force, p, of } = setup();
    const a = sim.world.arena!;
    const sea = rules.stage.moves.find((m) => m.id === 'entei-lava-sea')!.lavaSea!;
    // 溶岩の先端はプレイヤーより遅い
    expect((a.halfHeight + 40) / sea.fillSeconds).toBeLessThan(180);
    const hurt = (x: number, y: number): number => {
      force('entei-lava-1');
      step(0.1);
      p.x = a.x + x;
      p.y = a.y + y;
      const hp = p.hp;
      for (let t = 0; t < 30 * 5.5; t++) {
        p.x = a.x + x;
        p.y = a.y + y;
        p.invincibleTicks = 0;
        step(1 / 30);
      }
      return hp - p.hp;
    };
    expect(hurt(336, 198)).toBe(0);
    sim.world.hazards.length = 0;
    expect(hurt(700, 0)).toBeGreaterThan(0);
    void of;
  });

  it('溶岩: 端にいても、中央にはまだ届かない時間がある', () => {
    const { step, sim, force, p } = setup();
    const a = sim.world.arena!;
    force('entei-lava-1');
    step(1.5);
    p.x = a.x + 200;
    p.y = a.y + 80;
    const hp = p.hp;
    p.invincibleTicks = 0;
    step(0.5);
    expect(p.hp).toBe(hp);
  });

  it('1 分の中で、全部の技を使い、走り去って戻る', () => {
    const { sim, rules, of } = setup();
    void of;
    const seen = new Set<string>();
    for (let t = 0; t < 30 * 70 && sim.world.arena; t++) {
      sim.step([]);
      for (const h of sim.world.hazards) seen.add(rules.stage.moves[h.move]?.id ?? '');
    }
    for (const id of ['entei-roar', 'entei-stomp', 'entei-fire-spin', 'entei-eruption', 'entei-rest', 'entei-flee']) expect(seen).toContain(id);
    expect(sim.world.arena).toBeNull();
  });
});
