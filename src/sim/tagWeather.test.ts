import { describe, expect, it } from 'vitest';
import type { BossMove } from '../data/schema';
import type { SimRules } from './rules';
import { Simulation } from './simulation';
import { activeField, currentWeather } from './systems/stage';
import { testRules } from './testRules';

/** ホウエンのタッグバトルと天気（07 の89.2・89.5） */

const NOVA: BossMove = { id: 'nova', effect: 'test', shape: 'circle', target: 'self', telegraphSeconds: 0.5, radius: 200, damage: 20, count: 1, spread: 0 };
const DASH: BossMove = { id: 'dash', effect: 'test', shape: 'line', target: 'player', telegraphSeconds: 0.5, radius: 20, length: 300, damage: 25, count: 1, spread: 0, dashSpeed: 600 };
const ENRAGE = { hpRatio: 0.5, moveIntervalSeconds: 0.5, doubleChance: 0 };

/** 敵の種類: 0 雑魚・1 中ボスA・2 中ボスB・3 四天王A・4 四天王B */
function tagRules(stage: Partial<SimRules['stage']> = {}, extra: Partial<SimRules> = {}): SimRules {
  const base = testRules({
    move: { range: 1 },
    extraKinds: [
      { id: 'mida', rank: 'midboss', hp: 1000, moveSpeed: 0, radius: 20, contactDamage: 0, xp: 0, types: [0] },
      { id: 'midb', rank: 'midboss', hp: 1000, moveSpeed: 0, radius: 20, contactDamage: 0, xp: 0, types: [0] },
      { id: 'e4a', rank: 'boss', hp: 1000, moveSpeed: 0, radius: 30, contactDamage: 0, xp: 0, types: [0] },
      { id: 'e4b', rank: 'boss', hp: 1000, moveSpeed: 0, radius: 30, contactDamage: 0, xp: 0, types: [0] },
    ],
    stage: {
      durationSeconds: 600,
      bosses: [
        { wave: 0, afterSeconds: 1, gate: true, tag: true, kind: 'mida', moves: [], required: false },
        { wave: 0, afterSeconds: 1, gate: true, tag: true, kind: 'midb', moves: [], required: false },
      ],
      moves: [NOVA, DASH],
      ...stage,
    },
  });
  base.stage.bossRules = { ...base.stage.bossRules, tagHpMultiplier: 0.7 };
  base.spawn.waves = [base.spawn.waves[0]!, { ...base.spawn.waves[0]! }];
  return { ...base, ...extra };
}

function solo(rules: SimRules, players = 1) {
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  for (let k = 0; k < players; k++) sim.addPlayer({ id: k + 1, x: k * 10, y: 0, radius: 12, moveSpeed: 0 });
  return sim;
}

function steps(sim: Simulation, n: number): void {
  for (let t = 0; t < n; t++) sim.step([]);
}

function bossesOf(sim: Simulation, kind: number): number[] {
  const e = sim.world.enemies;
  const out: number[] = [];
  for (let i = 0; i < e.count; i++) if (e.kind[i] === kind && e.hp[i]! > 0) out.push(i);
  return out;
}

function kill(sim: Simulation, kind: number): void {
  const i = bossesOf(sim, kind)[0]!;
  sim.step([{ type: 'damageEnemy', id: sim.world.enemies.id[i]!, amount: 1e9, by: 1, kbx: 0, kby: 0, kbTicks: 0, status: -1, statusTicks: 0 }]);
}

describe('タッグバトル', () => {
  it('2体が同時に出て、HP は tagHpMultiplier 倍（ソロ: 1000 × 0.7）。人数の増加はその後に掛ける', () => {
    const sim = solo(tagRules());
    steps(sim, 31);
    expect(sim.world.enemies.maxHp[bossesOf(sim, 1)[0]!]).toBeCloseTo(700);
    expect(sim.world.enemies.maxHp[bossesOf(sim, 2)[0]!]).toBeCloseTo(700);
    const duo = solo(tagRules(), 2);
    steps(duo, 31);
    expect(duo.world.enemies.maxHp[bossesOf(duo, 1)[0]!]).toBeCloseTo(700 * (1 + duo.world.rules.stage.bossRules.hpPerExtraPlayerPct / 100));
  });

  it('2体とも倒すと区間が進む（片方だけでは進まない）', () => {
    const sim = solo(tagRules());
    steps(sim, 31);
    kill(sim, 1);
    steps(sim, 5);
    expect(sim.world.section).toBe(0);
    kill(sim, 2);
    steps(sim, 2);
    expect(sim.world.section).toBe(1);
  });

  it('片方が倒れると、残ったほうはすぐ第2段階になる', () => {
    const sim = solo(
      tagRules({
        bosses: [
          { wave: 0, afterSeconds: 1, gate: false, tag: true, kind: 'e4a', moves: ['nova'], moveIntervalSeconds: 3, required: true, enrage: ENRAGE },
          { wave: 0, afterSeconds: 1, gate: false, tag: true, kind: 'e4b', moves: ['nova'], moveIntervalSeconds: 3, required: true, enrage: ENRAGE },
        ],
      }),
    );
    steps(sim, 31);
    const idB = sim.world.enemies.id[bossesOf(sim, 4)[0]!]!;
    expect(sim.world.bosses.find((b) => b.id === idB)?.enraged).toBeFalsy();
    kill(sim, 3);
    steps(sim, 1);
    const b = sim.world.bosses.find((x) => x.id === idB)!;
    expect(b.enraged).toBe(true);
    expect(b.interval).toBe(15);
  });

  it('突進する技は、組の相手が突進している間は使わない（2体が同時に突っ込まない）', () => {
    const sim = solo(
      tagRules({
        bosses: [
          { wave: 0, afterSeconds: 1, gate: false, tag: true, kind: 'e4a', moves: ['dash'], moveIntervalSeconds: 0.3, required: true },
          { wave: 0, afterSeconds: 1, gate: false, tag: true, kind: 'e4b', moves: ['dash'], moveIntervalSeconds: 0.3, required: true },
        ],
      }),
    );
    steps(sim, 31);
    const ids = [3, 4].map((k) => sim.world.enemies.id[bossesOf(sim, k)[0]!]!);
    let both = 0;
    let any = 0;
    for (let t = 0; t < 300; t++) {
      sim.step([]);
      const dashing = ids.map((id) => sim.world.hazards.some((h) => h.dasher === id));
      if (dashing.every(Boolean)) both++;
      if (dashing.some(Boolean)) any++;
    }
    expect(any).toBeGreaterThan(0);
    expect(both).toBe(0);
  });
});

describe('天気（区間ごと）', () => {
  const rain = { typePowerPct: { water: 50, fire: -50 }, groundTint: '#a0b4d8' };
  const sun = { typePowerPct: { fire: 50, water: -50 } };
  const sand = { damagePctPerSecond: 1, immuneTypes: ['normal'] };

  it('区間の天気が効き、巡らせる区間は everySeconds ごとに次の天気へ', () => {
    const sim = solo(
      tagRules({}, {
        weatherSections: [
          { kinds: ['rain'], fields: [rain], everySeconds: 0 },
          { kinds: ['sun', 'rain'], fields: [sun, rain], everySeconds: 2 },
        ],
      }),
    );
    steps(sim, 2);
    expect(currentWeather(sim.world)?.id).toBe('rain');
    expect(activeField(sim.world)?.field.typePowerPct?.water).toBe(50);
    sim.world.section = 1;
    sim.world.sectionStartTick = sim.world.tick;
    expect(currentWeather(sim.world)?.id).toBe('sun');
    steps(sim, 61);
    expect(currentWeather(sim.world)?.id).toBe('rain');
  });

  it('削る天気はプレイヤーだけ。無効のタイプは削られない', () => {
    // ボスのいない区間はすぐ次へ進むので、どちらの区間もすなあらしにする
    const rules = tagRules({ bosses: [] }, { weatherSections: [0, 1].map(() => ({ kinds: ['sandstorm'], fields: [sand], everySeconds: 0 })) });
    const hurt = solo(rules);
    const p = hurt.world.players[0]!;
    p.types = [1];
    steps(hurt, 60);
    expect(p.hp).toBeLessThan(p.maxHp);
    const safe = solo(rules);
    const q = safe.world.players[0]!;
    q.types = [0];
    steps(safe, 60);
    expect(q.hp).toBe(q.maxHp);
  });

  it('天気の無い地方は null', () => {
    const sim = solo(tagRules());
    expect(currentWeather(sim.world)).toBeNull();
  });
});
