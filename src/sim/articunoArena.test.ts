import { describe, expect, it } from 'vitest';
import { buildSimRules } from '../data/simRules';
import { Simulation } from './simulation';
import { activeLegendField, startLegendary } from './systems/stage';

/** フリーザーの固定マップの戦い（07 の〔フリーザー〕章） */
function setup(seed = 3) {
  const rules = buildSimRules();
  const sim = new Simulation({ tickRate: 30, seed, rules });
  sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 180 });
  const p = sim.world.players[0]!;
  sim.world.cleared = true;
  const kind = rules.enemies.kinds.findIndex((k) => k.id === 'legend-articuno');
  startLegendary(sim.world, kind);
  const w = sim.world;
  const step = (seconds: number): void => {
    for (let t = 0; t < Math.round(seconds * 30); t++) {
      p.hp = p.maxHp = 1e9;
      sim.step([]);
    }
  };
  step(3.5);
  const boss = w.bosses[0]!;
  const i = (): number => {
    for (let k = 0; k < w.enemies.count; k++) if (w.enemies.id[k] === boss.id) return k;
    return -1;
  };
  const idx = (id: string): number => rules.stage.moves.findIndex((m) => m.id === id);
  const force = (...ids: string[]): void => {
    w.hazards.length = 0;
    boss.moves = ids.map(idx);
    boss.next = 0;
    boss.cooldown = 1;
    boss.hpMoves = [];
  };
  const of = (id: string) => w.hazards.filter((h) => rules.stage.moves[h.move]?.id === id);
  return { rules, sim, w, p, boss, i, idx, force, of, step };
}

describe('フリーザー（07 の〔フリーザー〕章）', () => {
  it('固定マップで戦い、マップの効果（毎秒削られる・遅くなる）は無い', () => {
    const { w } = setup();
    expect(w.arena).not.toBeNull();
    expect(activeLegendField(w)).toBeNull();
  });

  it('こおりのつぶて: 狙い直しながら 3 回、予告の線の根元から速い氷の弾をまっすぐ撃つ', () => {
    const { w, p, force, of, step } = setup();
    force('articuno-ice-shard');
    const shots = new Set<object>();
    for (let t = 0; t < 30 * 2; t++) {
      step(1 / 30);
      for (const h of of('articuno-ice-shard-bullet')) shots.add(h);
    }
    expect(shots.size).toBe(3);
    // 追わない: 撃った後に動いても向きは変わらない
    const b = of('articuno-ice-shard-bullet')[0];
    if (b) {
      const dir = [b.dirX, b.dirY];
      p.x += 300;
      step(0.1);
      expect([b.dirX, b.dirY]).toEqual(dir);
    }
    void w;
  });

  it('こごえるかぜ: 当たると冷えが溜まり、押し流される', () => {
    const { w, p, i, force, step } = setup();
    // フリーザーの正面に立つ
    p.x = w.enemies.x[i()]!;
    p.y = w.enemies.y[i()]! + 200;
    force('articuno-icy-wind');
    const x0 = p.x;
    const y0 = p.y;
    let chilled = false;
    for (let t = 0; t < 30 * 2; t++) {
      step(1 / 30);
      chilled ||= (p.chill ?? 0) > 0;
    }
    expect(chilled).toBe(true);
    expect(Math.hypot(p.x - x0, p.y - y0)).toBeGreaterThan(40);
  });

  it('フリーズドライ: マップの決まった場所（海水の流れ）が一斉に凍る', () => {
    const { w, rules, force, of, step } = setup();
    force('articuno-freeze-dry');
    step(0.2);
    const spots = rules.stage.moves.find((m) => m.id === 'articuno-freeze-dry')!.arenaSpots!;
    const hz = of('articuno-freeze-dry');
    expect(hz.length).toBe(spots.length);
    for (const [k, [sx, sy, r]] of spots.entries()) {
      expect(hz[k]!.x).toBeCloseTo(w.arena!.x + sx, 0);
      expect(hz[k]!.y).toBeCloseTo(w.arena!.y + sy, 0);
      expect(hz[k]!.radius).toBe(r);
    }
    // 全部で 1 回の技（当たるのは 1 回）
    expect(new Set(hz.map((h) => h.group)).size).toBe(1);
  });

  it('HP 66% で あられ: 20 秒、マップ全体に雹が落ち続ける（その間も技は続く）', () => {
    const { w, i, step, of } = setup();
    w.enemies.hp[i()] = w.enemies.maxHp[i()]! * 0.65;
    step(2);
    const stones = new Set<object>();
    let xs = Infinity;
    let xe = -Infinity;
    const other = new Set<string>();
    for (let t = 0; t < 30 * 10; t++) {
      step(1 / 30);
      for (const h of of('articuno-hailstone')) {
        stones.add(h);
        xs = Math.min(xs, h.x - w.arena!.x);
        xe = Math.max(xe, h.x - w.arena!.x);
      }
      for (const h of w.hazards) other.add(w.rules.stage.moves[h.move]!.id);
    }
    expect(of('articuno-hail').length).toBe(1);
    expect(stones.size).toBeGreaterThan(80);
    expect(xs).toBeLessThan(-500);
    expect(xe).toBeGreaterThan(500);
    expect(other.has('articuno-glide')).toBe(true);
  });

  it('HP 33% で マインドリーダー: 照準が 2.5 秒追ってから止まり、その場所が ぜったいれいど で凍る。当たると 2 秒凍り、その後フリーザーは疲れる', () => {
    const { w, p, i, step, of } = setup();
    w.enemies.hp[i()] = w.enemies.maxHp[i()]! * 0.32;
    let mark: { x: number; y: number } | null = null;
    let cold: { x: number; y: number } | null = null;
    const seen = new Set<string>();
    let frozen = 0;
    for (let t = 0; t < 30 * 16; t++) {
      // 照準が止まるまでは歩き、その後は止まって当たる
      const m = of('articuno-mind-reader')[0];
      if (m && (m.totalTicks - m.ticksLeft) * w.dt < 2.4) p.x += 3;
      // あられの雹に当たった後の無敵で外れないように
      p.invincibleTicks = 0;
      step(1 / 30);
      const m2 = of('articuno-mind-reader')[0];
      if (m2) mark = { x: m2.x, y: m2.y };
      const c = of('articuno-sheer-cold')[0];
      if (c && !cold) cold = { x: c.x, y: c.y };
      frozen = Math.max(frozen, p.frozenTicks ?? 0);
      for (const h of w.hazards) seen.add(w.rules.stage.moves[h.move]!.id);
    }
    expect(mark).not.toBeNull();
    expect(cold).not.toBeNull();
    expect(cold!.x).toBeCloseTo(mark!.x, 0);
    expect(cold!.y).toBeCloseTo(mark!.y, 0);
    expect(frozen).toBeGreaterThanOrEqual(Math.round(2 / w.dt) - 1);
    for (const id of ['articuno-to-top', 'articuno-tired']) expect(seen).toContain(id);
  });

  it('ミュウの ゆびをふる が使う昔の ふぶき は残っている', () => {
    const { rules } = setup();
    expect(rules.stage.legendary!.moveSets['legend-mew']!.pool).toContain('articuno-blizzard');
    expect(rules.stage.moves.some((m) => m.id === 'articuno-blizzard')).toBe(true);
  });
});
