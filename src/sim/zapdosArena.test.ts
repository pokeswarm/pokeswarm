import { describe, expect, it } from 'vitest';
import { buildSimRules } from '../data/simRules';
import { Simulation } from './simulation';
import { absorbBarrier, activeLegendField, startLegendary } from './systems/stage';

/** サンダーの固定マップの戦い（07 の252章） */
function setup(seed = 3) {
  const rules = buildSimRules();
  const sim = new Simulation({ tickRate: 30, seed, rules });
  sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 180 });
  const p = sim.world.players[0]!;
  sim.world.cleared = true;
  startLegendary(sim.world, rules.enemies.kinds.findIndex((k) => k.id === 'legend-zapdos'));
  const w = sim.world;
  const step = (seconds: number): void => {
    for (let t = 0; t < Math.round(seconds * 30); t++) {
      p.hp = p.maxHp = 1e9;
      p.invincibleTicks = 0;
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

describe('サンダー（07 の252章）', () => {
  it('固定マップで戦い、画面が暗くなって光るマップの効果は無い', () => {
    const { w } = setup();
    expect(w.arena).not.toBeNull();
    expect(activeLegendField(w)).toBeNull();
  });

  it('10まんボルト: 壁ぎわの発電機どうしを 4 組、壁から壁まで結ぶ', () => {
    const { w, rules, force, of, step } = setup();
    force('zapdos-thunderbolt');
    step(0.2);
    const links = of('zapdos-thunderbolt');
    expect(links.length).toBe(4);
    const nodes = rules.stage.moves.find((m) => m.id === 'zapdos-thunderbolt')!.arenaLinks!.nodes;
    for (const h of links) {
      const start = nodes.some(([x, y]) => Math.hypot(h.x - (w.arena!.x + x), h.y - (w.arena!.y + y)) < 1);
      const end = nodes.some(([x, y]) => Math.hypot(h.x + h.dirX * h.length - (w.arena!.x + x), h.y + h.dirY * h.length - (w.arena!.y + y)) < 1);
      expect(start && end).toBe(true);
    }
  });

  it('でんじは: 当たると まひ して足が遅くなる', () => {
    const { w, p, i, force, step } = setup();
    p.x = w.enemies.x[i()]! + 150;
    p.y = w.enemies.y[i()]!;
    force('zapdos-thunder-wave');
    let paralyzed = false;
    for (let t = 0; t < 30 * 3 && !paralyzed; t++) {
      step(1 / 30);
      paralyzed = (p.paralyzeTicks ?? 0) > 0;
    }
    // 切れ目に立っていなければ当たる（切れ目の向きはランダムなので、当たらなければ反対側でもう一度）
    if (!paralyzed) {
      p.x = w.enemies.x[i()]! - 150;
      force('zapdos-thunder-wave');
      for (let t = 0; t < 30 * 3 && !paralyzed; t++) {
        step(1 / 30);
        paralyzed = (p.paralyzeTicks ?? 0) > 0;
      }
    }
    expect(paralyzed).toBe(true);
  });

  it('HP 66% で あまごい と蓄電。決まった時間に決まったダメージを与えると止まり、しびれる', () => {
    const { w, i, boss, step, of } = setup();
    w.enemies.hp[i()] = w.enemies.maxHp[i()]! * 0.65;
    step(1);
    expect(of('zapdos-rain-dance').length).toBe(1);
    expect(of('zapdos-storm-charge').length).toBe(1);
    // 最大 HP の 10% を与える
    const need = w.enemies.maxHp[i()]! * 0.1;
    for (let t = 0; t < 30 * 3; t++) {
      const a = absorbBarrier(w, i(), need / 60);
      w.enemies.hp[i()] = w.enemies.hp[i()]! - a;
      step(1 / 30);
    }
    expect(of('zapdos-storm-charge').length).toBe(0);
    expect(of('zapdos-overload').length).toBe(1);
    expect(of('zapdos-thunder-all').length).toBe(0);
    step(0.5);
    expect(of('zapdos-rain-dance').length).toBe(0);
    void boss;
  });

  it('蓄電を止められないと、雨の中の かみなり がプレイヤー全員に当たる（必中）', () => {
    const rules = buildSimRules();
    const sim = new Simulation({ tickRate: 30, seed: 3, rules });
    sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 180 });
    const p = sim.world.players[0]!;
    sim.world.cleared = true;
    startLegendary(sim.world, rules.enemies.kinds.findIndex((k) => k.id === 'legend-zapdos'));
    const w = sim.world;
    for (let t = 0; t < 100; t++) sim.step([]);
    const b = w.bosses[0]!;
    for (let k = 0; k < w.enemies.count; k++) if (w.enemies.id[k] === b.id) w.enemies.hp[k] = w.enemies.maxHp[k]! * 0.65;
    let thunder = false;
    let hpBefore = 0;
    for (let t = 0; t < 30 * 15 && !thunder; t++) {
      p.hp = p.maxHp = 1e6;
      p.invincibleTicks = 0;
      // 遠くの角へ逃げても当たる
      p.x = w.arena ? w.arena.x - w.arena.halfWidth + 20 : 0;
      p.y = w.arena ? w.arena.y + w.arena.halfHeight - 20 : 0;
      hpBefore = p.hp;
      sim.step([]);
      thunder = w.hazards.some((h) => rules.stage.moves[h.move]?.id === 'zapdos-thunder-all' && h.activeTicks !== undefined) && p.hp < hpBefore;
    }
    expect(thunder).toBe(true);
    expect(p.paralyzeTicks).toBeGreaterThan(0);
  });

  it('HP 33% で真ん中に降りて でんじほう をため、太い光線の直後に発電機が一度に放電する。その後疲れる', () => {
    const { w, i, step, of } = setup();
    w.enemies.hp[i()] = w.enemies.maxHp[i()]! * 0.32;
    // あまごい の蓄電は止めておく
    const seen = new Set<string>();
    let cannonAt = -1;
    let latticeAt = -1;
    for (let t = 0; t < 30 * 30; t++) {
      if (of('zapdos-storm-charge').length) {
        // 蓄電を止める分だけ（倒してしまわないように）
        const a = absorbBarrier(w, i(), w.enemies.maxHp[i()]! * 0.004);
        w.enemies.hp[i()] = w.enemies.hp[i()]! - a;
      }
      step(1 / 30);
      for (const h of w.hazards) seen.add(w.rules.stage.moves[h.move]!.id);
      if (cannonAt < 0 && of('zapdos-zap-cannon').some((h) => h.activeTicks !== undefined)) cannonAt = t;
      if (latticeAt < 0 && of('zapdos-lattice').some((h) => h.activeTicks !== undefined)) latticeAt = t;
    }
    for (const id of ['zapdos-to-center', 'zapdos-zap-cannon-charge', 'zapdos-zap-cannon', 'zapdos-lattice', 'zapdos-tired']) expect(seen).toContain(id);
    expect(latticeAt).toBeGreaterThan(cannonAt);
  });
});

describe('まひ（07 の252章）', () => {
  it('まひの間は、足が bossRules.paralyzeSlowPct だけ遅い', () => {
    const rules = buildSimRules();
    const run = (paralyzed: boolean): number => {
      const sim = new Simulation({ tickRate: 30, seed: 1, rules });
      sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 180 });
      const p = sim.world.players[0]!;
      sim.step([{ type: 'move', playerId: 1, dx: 1, dy: 0 }]);
      const x0 = p.x;
      for (let t = 0; t < 30; t++) {
        if (paralyzed) p.paralyzeTicks = 10;
        sim.step([]);
      }
      return p.x - x0;
    };
    const slow = run(true);
    const fast = run(false);
    expect(slow / fast).toBeCloseTo(1 - (rules.stage.bossRules.paralyzeSlowPct ?? 50) / 100, 1);
  });
});
