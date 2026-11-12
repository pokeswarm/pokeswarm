import { describe, expect, it } from 'vitest';
import { buildSimRules } from '../data/simRules';
import { Simulation } from './simulation';
import { activeLegendField, startLegendary } from './systems/stage';
import { damageTakenMultiplier } from './systems/status';

/** ファイヤーの固定マップの戦い（07 の〔ファイヤー〕章） */
function setup(seed = 3) {
  const rules = buildSimRules();
  const sim = new Simulation({ tickRate: 30, seed, rules });
  sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 180 });
  const p = sim.world.players[0]!;
  sim.world.cleared = true;
  startLegendary(sim.world, rules.enemies.kinds.findIndex((k) => k.id === 'legend-moltres'));
  const w = sim.world;
  const step = (seconds: number): void => {
    for (let t = 0; t < Math.round(seconds * 30); t++) {
      p.hp = p.maxHp = 1e9;
      p.invincibleTicks = 0;
      p.burnTicks = 0;
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

describe('ファイヤー（07 の〔ファイヤー〕章）', () => {
  it('固定マップで戦い、炎のまとい・防御が下がるマップの効果は無い。ゴッドバードは追わない', () => {
    const { w, rules } = setup();
    expect(w.arena).not.toBeNull();
    expect(activeLegendField(w)).toBeNull();
    const sky = rules.stage.moves.find((m) => m.id === 'moltres-sky-attack')!;
    expect(sky.homing).toBeFalsy();
    expect(sky.follow).toBeUndefined();
  });

  it('ねっぷう: 狙った人の向きの弧が 3 回続けて広がり、当たると やけど', () => {
    const { w, p, i, force, of, step } = setup();
    p.x = w.enemies.x[i()]! + 300;
    p.y = w.enemies.y[i()]!;
    force('moltres-heat-wave');
    const waves = new Set<object>();
    let hitInside = false;
    for (let t = 0; t < 30 * 1.5; t++) {
      step(1 / 30);
      for (const h of of('moltres-heat-wave')) waves.add(h);
      hitInside ||= (p.burnTicks ?? 0) > 0;
    }
    expect(waves.size).toBe(3);
    expect(hitInside).toBe(true);
  });

  it('HP 66% で オーバーヒート: 3 重の炎の輪の後、10 秒は炎が弱まる（ねっぷうは 1 つ・ゴッドバードは エアスラッシュ に替わる）', () => {
    const { w, i, step, of, boss, idx } = setup();
    w.enemies.hp[i()] = w.enemies.maxHp[i()]! * 0.65;
    let rings = 0;
    for (let t = 0; t < 30 * 4 && !of('moltres-cooled').length; t++) {
      step(1 / 30);
      rings = Math.max(rings, of('moltres-overheat').length);
    }
    expect(rings).toBe(3);
    expect(of('moltres-cooled').length).toBe(1);
    // 弱まった間の技
    boss.moves = [idx('moltres-sky-attack'), idx('moltres-heat-wave')];
    boss.next = 0;
    const seen = new Set<string>();
    for (let t = 0; t < 30 * 6; t++) {
      step(1 / 30);
      for (const h of w.hazards) seen.add(w.rules.stage.moves[h.move]!.id);
    }
    expect(seen.has('moltres-air-slash')).toBe(true);
    expect(seen.has('moltres-sky-attack')).toBe(false);
    expect(seen.has('moltres-heat-wave-weak')).toBe(true);
    expect(seen.has('moltres-heat-wave')).toBe(false);
  });

  it('HP 33% で もえつきる: 真ん中へ降り、台風の目（すぐそば）の外が炎の海。その後 8 秒は受けるダメージが 1.5 倍', () => {
    const { w, i, step, of } = setup();
    w.enemies.hp[i()] = w.enemies.maxHp[i()]! * 0.32;
    let sea: (typeof w.hazards)[number] | undefined;
    let mult = 1;
    for (let t = 0; t < 30 * 20; t++) {
      step(1 / 30);
      sea ??= of('moltres-burn-up')[0];
      mult = Math.max(mult, damageTakenMultiplier(w, i()));
    }
    expect(sea).toBeDefined();
    expect(Math.hypot(sea!.x - w.arena!.x, sea!.y - w.arena!.y)).toBeLessThan(10);
    expect(sea!.innerRadius).toBeGreaterThan(80);
    expect(sea!.innerRadius).toBeLessThan(160);
    expect(mult).toBeCloseTo(1.5, 5);
  });

  it('ミュウの ゆびをふる が使う昔の炎の突進は残っている', () => {
    const { rules } = setup();
    expect(rules.stage.legendary!.moveSets['legend-mew']!.pool).toContain('moltres-flamedash');
    expect(rules.stage.moves.some((m) => m.id === 'moltres-flamedash')).toBe(true);
  });
});
