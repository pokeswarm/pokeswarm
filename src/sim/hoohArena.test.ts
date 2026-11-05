import { describe, expect, it } from 'vitest';
import { buildSimRules } from '../data/simRules';
import { glyphPoints } from './glyph';
import { Simulation } from './simulation';
import { startLegendary } from './systems/stage';

/** ホウオウの固定マップと技（07 の207章） */
function setup(): { sim: Simulation; step: (seconds: number) => void; force: (...ids: string[]) => void; bossIndex: () => number; ids: () => (string | undefined)[] } {
  const rules = buildSimRules('johto');
  const sim = new Simulation({ tickRate: 30, seed: 7, rules });
  sim.addPlayer({ id: 1, x: 500, y: 500, radius: 12, moveSpeed: 180 });
  sim.world.players[0]!.maxHp = sim.world.players[0]!.hp = 1e9;
  startLegendary(sim.world, rules.enemies.kinds.findIndex((k) => k.id === 'legend-ho-oh'));
  const step = (seconds: number): void => {
    for (let t = 0; t < seconds * 30; t++) sim.step([]);
  };
  step(3.2);
  const bossIndex = (): number => {
    const e = sim.world.enemies;
    for (let i = 0; i < e.count; i++) if (e.id[i] === sim.world.bosses[0]?.id) return i;
    return -1;
  };
  return {
    sim,
    step,
    bossIndex,
    ids: () => sim.world.hazards.map((h) => rules.stage.moves[h.move]?.id),
    force: (...ids) => {
      const boss = sim.world.bosses[0]!;
      boss.moves = ids.map((id) => rules.stage.moves.findIndex((m) => m.id === id));
      boss.next = 0;
      boss.cooldown = 1;
    },
  };
}

describe('ホウオウ（07 の207章）', () => {
  it('固定マップへ移り、データの HP は 80000（実際の戦いは 5 倍）', () => {
    const { sim, bossIndex } = setup();
    expect(sim.world.arena).toBeTruthy();
    expect(sim.world.enemies.maxHp[bossIndex()]).toBe(400000);
  });

  it('だいもんじ: 玉が落ちた所に、字の点の数だけ炎が交わる所から外へ順に立つ', () => {
    const { sim, step, force, ids } = setup();
    const a = sim.world.arena!;
    const p = sim.world.players[0]!;
    p.x = a.x;
    p.y = a.y;
    force('hooh-fire-blast');
    step(2.15);
    const def = sim.world.rules.stage.moves.find((m) => m.id === 'hooh-fire-blast-flames')!;
    const flames = sim.world.hazards.filter((h) => sim.world.rules.stage.moves[h.move]?.id === 'hooh-fire-blast-flames');
    expect(flames.length).toBe(glyphPoints(def.glyph!).length);
    expect(ids()).toContain('hooh-fire-blast-scorch');
    // 交わる所が先に立つ
    const center = flames.reduce((m, h) => (Math.hypot(h.x - a.x, h.y - a.y) < Math.hypot(m.x - a.x, m.y - a.y) ? h : m));
    const far = flames.reduce((m, h) => (Math.hypot(h.x - a.x, h.y - a.y) > Math.hypot(m.x - a.x, m.y - a.y) ? h : m));
    expect(center.activeTicks !== undefined || center.ticksLeft < far.ticksLeft).toBe(true);
  });

  it('だいもんじ: マップの外になる炎は立てない', () => {
    const { sim, step, force } = setup();
    const a = sim.world.arena!;
    const p = sim.world.players[0]!;
    p.x = a.x - a.halfWidth + 30;
    p.y = a.y + a.halfHeight - 30;
    force('hooh-fire-blast');
    step(2.15);
    const flames = sim.world.hazards.filter((h) => sim.world.rules.stage.moves[h.move]?.id === 'hooh-fire-blast-flames');
    expect(flames.length).toBeGreaterThan(0);
    for (const h of flames) {
      expect(Math.abs(h.x - a.x)).toBeLessThanOrEqual(a.halfWidth);
      expect(Math.abs(h.y - a.y)).toBeLessThanOrEqual(a.halfHeight);
    }
  });

  it('だいもんじ: 炎に当たるのは 1 回だけ', () => {
    const { sim, force } = setup();
    const a = sim.world.arena!;
    const p = sim.world.players[0]!;
    p.x = a.x;
    p.y = a.y;
    p.invincibleTicks = 0;
    const hp = p.hp;
    force('hooh-fire-blast');
    for (let t = 0; t < 30 * 4; t++) {
      p.invincibleTicks = 0;
      p.x = a.x;
      p.y = a.y;
      sim.step([]);
    }
    const lost = hp - p.hp;
    expect(lost).toBeGreaterThan(0);
    expect(lost).toBeLessThan(sim.world.rules.stage.moves.find((m) => m.id === 'hooh-fire-blast-flames')!.damage * 2);
  });

  it('せいなるほのお: 段ごとに切れ目があり、奥の段から順に立つ', () => {
    const { sim, step, force } = setup();
    force('hooh-sacred-fire');
    step(0.2);
    const pr = sim.world.rules.stage.moves.find((m) => m.id === 'hooh-sacred-fire')!.pillarRows!;
    const pillars = sim.world.hazards.filter((h) => sim.world.rules.stage.moves[h.move]?.id === 'hooh-sacred-fire');
    expect(pillars.length).toBe(pr.rows * (pr.cols - pr.gapCols));
    const rows = new Map<number, typeof pillars>();
    for (const h of pillars) rows.set(h.y, [...(rows.get(h.y) ?? []), h]);
    expect(rows.size).toBe(pr.rows);
    const ys = [...rows.keys()].sort((p, q) => p - q);
    for (let k = 1; k < ys.length; k++) expect(rows.get(ys[k]!)![0]!.ticksLeft).toBeGreaterThan(rows.get(ys[k - 1]!)![0]!.ticksLeft);
  });

  it('ブレイブバード: 端へ飛んで 3 回突進し、マップの外へ出ず、通った跡に炎が残る', () => {
    const { sim, step, force, bossIndex, ids } = setup();
    const a = sim.world.arena!;
    force('hooh-fly-side');
    // 次の技へ進まない
    sim.world.bosses[0]!.interval = 30 * 100;
    let dashes = 0;
    let trails = false;
    const seen = new Set<unknown>();
    for (let t = 0; t < 30 * 12; t++) {
      step(1 / 30);
      for (const h of sim.world.hazards) {
        if (sim.world.rules.stage.moves[h.move]?.id === 'hooh-brave-bird' && !seen.has(h)) {
          seen.add(h);
          dashes++;
        }
      }
      if (ids().includes('hooh-brave-trail')) trails = true;
      const i = bossIndex();
      // 体の半分くらいまでのはみ出しは許す
      expect(Math.abs(sim.world.enemies.x[i]! - a.x)).toBeLessThan(a.halfWidth + 46);
      expect(Math.abs(sim.world.enemies.y[i]! - a.y)).toBeLessThan(a.halfHeight + 46);
    }
    expect(dashes).toBe(3);
    expect(trails).toBe(true);
  });

  it('にほんばれ: 技が残っている間だけ、日差しの効果が効き、せいなるほのおが強くなる', () => {
    const { step, force, ids } = setup();
    const hasSun = (): boolean => ids().includes('hooh-sun');
    expect(hasSun()).toBe(false);
    force('hooh-sunny-day');
    step(1.8);
    expect(hasSun()).toBe(true);
    force('hooh-sacred-fire');
    step(0.3);
    expect(ids()).toContain('hooh-sacred-fire-sun');
    expect(ids()).not.toContain('hooh-sacred-fire');
    step(31);
    expect(hasSun()).toBe(false);
  });

  it('HP が半分を切ると にほんばれ、10% を切ると 復活の虹炎（どちらも 1 回だけ）', () => {
    const { sim, step, bossIndex, ids } = setup();
    const e = sim.world.enemies;
    const i = bossIndex();
    e.hp[i] = e.maxHp[i]! * 0.45;
    let sunny = 0;
    const seen = new Set<unknown>();
    for (let t = 0; t < 30 * 30; t++) {
      step(1 / 30);
      for (const h of sim.world.hazards) {
        if (sim.world.rules.stage.moves[h.move]?.id === 'hooh-sunny-day' && !seen.has(h)) {
          seen.add(h);
          sunny++;
        }
      }
    }
    expect(sunny).toBe(1);
    e.hp[bossIndex()] = e.maxHp[bossIndex()]! * 0.09;
    let found = false;
    for (let t = 0; t < 30 * 40 && !found; t++) {
      step(1 / 30);
      found = ids().includes('hooh-rekindling-flame');
    }
    expect(found).toBe(true);
  });

  it('復活の虹炎: 灰の間に削られなければ HP が 20% 戻り、削られた分だけ戻りが減る', () => {
    const { sim, step, force, bossIndex, ids } = setup();
    const e = sim.world.enemies;
    sim.world.bosses[0]!.hpMoves = [];
    e.hp[bossIndex()] = e.maxHp[bossIndex()]! * 0.1;
    force('hooh-rekindling-flame');
    step(4);
    // 灰の間に 5% 削る
    e.hp[bossIndex()] = e.maxHp[bossIndex()]! * 0.05;
    expect(ids()).toContain('hooh-rekindling-flame');
    step(4.5);
    expect(e.hp[bossIndex()]! / e.maxHp[bossIndex()]!).toBeCloseTo(0.25, 3);
  });

  it('突進の途中で HP が切れても、復活の虹炎を捨てない', () => {
    const { sim, step, force, bossIndex, ids } = setup();
    const e = sim.world.enemies;
    sim.world.bosses[0]!.hpMoves = [{ belowRatio: 0.1, moves: [sim.world.rules.stage.moves.findIndex((m) => m.id === 'hooh-rekindling-flame')] }];
    force('hooh-fly-side');
    step(3.2);
    expect(ids()).toContain('hooh-brave-bird');
    e.hp[bossIndex()] = e.maxHp[bossIndex()]! * 0.05;
    let found = false;
    for (let t = 0; t < 30 * 25 && !found; t++) {
      step(1 / 30);
      found = ids().includes('hooh-rekindling-flame');
    }
    expect(found).toBe(true);
  });
});
