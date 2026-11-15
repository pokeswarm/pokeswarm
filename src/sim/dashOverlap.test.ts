import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { applyOffer, moveMaxLevel } from './systems/leveling';

/** 07 の268章: 体が動く技は重ねて出さない・カビゴンのギガインパクトはヘビーボンバーを消費して最大レベルを上げる */
function setup(moves: string[], line?: string) {
  const rules = buildSimRules();
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const lo = line ? playableLoadout(rules, line) : null;
  const p = sim.addPlayer({
    id: 1,
    x: 0,
    y: 0,
    radius: 12,
    moveSpeed: 100,
    moves: moves.map((k) => ({ move: moveIndexOf(rules, k), level: 1 })),
    ...(lo ? { types: lo.types, moveTypes: lo.moveTypes, fixedMoves: lo.fixedMoves, line: lo.line, species: lo.species } : {}),
  });
  p.facingX = 1;
  p.facingY = 0;
  const move = (key: string): number => moveIndexOf(rules, key);
  const boss = rules.enemies.kinds.findIndex((k) => (k.rank ?? 'normal') !== 'normal');
  return { rules, sim, p, move, boss, e: sim.world.enemies };
}

/** 体が動き始めた時刻を順に記録し、前の動きが終わる前に次が始まっていないかを見る */
function runDashes(t: ReturnType<typeof setup>, ticks: number): { starts: number; overlaps: number } {
  let busyUntil = -1;
  let starts = 0;
  let overlaps = 0;
  for (let k = 0; k < ticks; k++) {
    t.sim.step([]);
    for (const ev of t.sim.world.events) {
      if (ev.type !== 'dashStarted') continue;
      starts++;
      if (k < busyUntil) overlaps++;
      busyUntil = Math.max(busyUntil, k + Math.max(1, Math.round(ev.seconds * 30)));
    }
  }
  return { starts, overlaps };
}

describe('体が動く技を重ねて出さない（07 の268章）', () => {
  it('のしかかり・すてみタックル・ヘビーボンバー を一緒に持っても、進んでいる間にほかの技で動き出さない', () => {
    const t = setup(['body-slam', 'double-edge', 'heavy-slam']);
    t.e.add(1, t.boss, 90, 0, 1e9, 0, 20);
    const r = runDashes(t, 300);
    expect(r.starts).toBeGreaterThanOrEqual(3);
    expect(r.overlaps).toBe(0);
  });

  it('同じときに出せるようになっても、1 つずつ順に出る（待った技は終わったらすぐ出る）', () => {
    const t = setup(['body-slam', 'double-edge']);
    t.e.add(1, t.boss, 90, 0, 1e9, 0, 20);
    t.sim.step([]);
    expect(t.sim.world.events.filter((ev) => ev.type === 'dashStarted').length).toBe(1);
    let second = -1;
    for (let k = 1; k < 30 && second === -1; k++) {
      t.sim.step([]);
      if (t.sim.world.events.some((ev) => ev.type === 'dashStarted')) second = k;
    }
    expect(second).toBeGreaterThan(0);
    expect(second).toBeLessThan(12);
  });

  it('ギガインパクトを溜めている間・連続技の途中は、ほかの体が動く技を出さない', () => {
    const t = setup(['giga-impact', 'double-edge']);
    t.e.add(1, t.boss, 120, 0, 1e9, 0, 20);
    const giga = t.p.moves[0]!;
    const edge = t.p.moves[1]!;
    let firedWhileGiga = 0;
    for (let k = 0; k < 300; k++) {
      const busy = giga.windup !== undefined || giga.seq !== undefined;
      const before = edge.cooldown;
      t.sim.step([]);
      // すてみタックルを出すと再使用が戻る
      if (busy && edge.cooldown > before + 0.5) firedWhileGiga++;
    }
    expect(firedWhileGiga).toBe(0);
  });
});

describe('カビゴンのギガインパクト: ヘビーボンバーを消費して最大レベルを上げる（07 の268章）', () => {
  const evolve = (heavy: number | null) => {
    const t = setup(['body-slam'], 'snorlax');
    t.p.moves = [
      { move: t.move('body-slam'), level: t.rules.moves[t.move('body-slam')]!.levels.length, cooldown: 0, burstLeft: 0, burstTimer: 0 },
      ...(heavy ? [{ move: t.move('heavy-slam'), level: heavy, cooldown: 0, burstLeft: 0, burstTimer: 0 }] : []),
    ];
    const hpUp = t.rules.items.findIndex((it) => it.key === 'hp-up');
    t.p.items = [{ item: hpUp, level: 1 }];
    applyOffer(t.sim.world, t.p, { kind: 'derive', slot: 0, to: t.move('giga-impact'), item: hpUp, unique: true });
    return t;
  };

  it('ヘビーボンバーを持っていれば消え、ギガインパクトの最大が Lv16 になり、ヘビーボンバーの強化分を受け継ぐ', () => {
    const t = evolve(5);
    expect(t.p.moves.map((m) => m.move)).toEqual([t.move('giga-impact')]);
    expect(t.p.consumedMoves).toContain(t.move('heavy-slam'));
    expect(moveMaxLevel(t.rules, t.p.moves[0]!)).toBe(16);
    // のしかかりの強化分は受け継がない（今までどおり）。ヘビーボンバー Lv5 の 4 だけ
    expect(t.p.moves[0]!.level).toBe(5);
  });

  it('ヘビーボンバーを持っていなければ、今までどおり Lv1 から Lv8 まで', () => {
    const t = evolve(null);
    expect(moveMaxLevel(t.rules, t.p.moves[0]!)).toBe(8);
    expect(t.p.moves[0]!.level).toBe(1);
  });

  it('消費したヘビーボンバーは、ギガインパクトの中で飛び込む段として出る', () => {
    const t = evolve(8);
    t.e.add(1, t.boss, 200, 20, 1e9, 0, 30);
    const r = runDashes(t, 90);
    // 飛び込み・のしかかり・突進
    expect(r.starts).toBeGreaterThanOrEqual(3);
    expect(r.overlaps).toBe(0);
  });

  it('ケッキングのギガインパクトは今までどおり Lv8 まで', () => {
    const rules = buildSimRules();
    const d = rules.derivations.find((x) => x.to === moveIndexOf(rules, 'giga-impact') && x.line === 'slakoth')!;
    expect(d.levelCap).toEqual({ base: 8, perConsumed: 0 });
  });
});
