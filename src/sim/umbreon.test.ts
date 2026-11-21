import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { answerEvolution } from './systems/evolution';
import { canLearnNewMove, makeOffers, recomputeModifiers } from './systems/leveling';

/** 07 の336章: ブラッキーの作り直し（バークアウト・かみつく・★イカサマ・つきのひかり） */
function setup(form = 'umbreon') {
  const rules = buildSimRules('johto');
  const sim = new Simulation({ tickRate: 30, seed: 4, rules });
  for (const wave of sim.world.waves) Object.assign(wave, { spawnPerSecond: 0, minimum: 0 });
  const lo = playableLoadout(rules, 'eevee');
  const p = sim.addPlayer({
    id: sim.world.localPlayerId, x: 0, y: 0, radius: 12, moveSpeed: 180, types: lo.types, moveTypes: lo.moveTypes, fixedMoves: lo.fixedMoves, line: lo.line,
    species: rules.species.findIndex((s) => s.key === form), moves: [],
  });
  const item = (k: string): number => rules.items.findIndex((x) => x.key === k);
  const pm = (k: string, level = 8) => ({ move: moveIndexOf(rules, k), level, cooldown: 0, burstLeft: 0, burstTimer: 0 });
  return { rules, sim, w: sim.world, p, item, pm };
}

describe('ブラッキー（07 の336章）', () => {
  it('進化すると たいあたり が バークアウト になり、かみつく を覚え、つきのひかり を覚えられる', () => {
    const t = setup('eevee');
    t.p.moves = [t.pm('tackle', 3)];
    t.p.evolveAsk = t.rules.species.findIndex((x) => x.key === 'umbreon');
    answerEvolution(t.w, t.p, true);
    expect(t.p.moves.map((m) => t.rules.moves[m.move]!.key)).toEqual(['snarl', 'bite']);
    expect(canLearnNewMove(t.w, t.p, moveIndexOf(t.rules, 'moonlight'))).toBe(true);
  });

  it('かみつく ＋ くろいメガネ → ★イカサマ はブラッキーだけ', () => {
    for (const [form, ok] of [['umbreon', true], ['espeon', false]] as const) {
      const t = setup(form);
      t.p.moves = [t.pm('bite')];
      t.p.items = [{ item: t.item('black-glasses'), level: 1 }];
      recomputeModifiers(t.w, t.p);
      const offers = makeOffers(t.w, t.p);
      expect(offers.some((o) => o.kind === 'derive' && o.to === moveIndexOf(t.rules, 'foul-play-umbreon'))).toBe(ok);
    }
  });

  it('★イカサマ は近くでいちばん HP の高い敵へ駆け込み、続けて同じ向きへしっぽを回して進み、まわりに何度も当たる', () => {
    const t = setup();
    t.p.moves = [t.pm('foul-play-umbreon')];
    recomputeModifiers(t.w, t.p);
    const e = t.w.enemies;
    // 近くの弱い敵（左）と、少し遠くの強い敵（右）
    e.add(1, 0, -80, 0, 50, 0, 10);
    e.add(2, 0, 200, 0, 1e9, 0, 14);
    const m = t.p.moves[0]!.move;
    let started = false;
    let tailHits = 0;
    const xs: number[] = [];
    const hp0 = 1e9;
    for (let k = 0; k < 40; k++) {
      t.sim.step([]);
      started ||= t.w.events.some((ev) => ev.type === 'dashStarted');
      if (started) xs.push(t.p.x);
      for (let i = 0; i < t.w.projectiles.count; i++) if (t.w.projectiles.move[i] === m && t.w.projectiles.stage[i] === 1) tailHits = Math.max(tailHits, 1);
      if (started && !t.p.dashTicks && xs.length > 3) break;
    }
    expect(started).toBe(true);
    // 右の強い敵の方へ進み、その先（敵を越えた所）まで続けて進む
    expect(Math.max(...xs)).toBeGreaterThan(200);
    expect(tailHits).toBe(1);
    const j = [...Array(e.count).keys()].find((i) => e.id[i] === 2)!;
    expect(e.hp[j]!).toBeLessThan(hp0);
  });

  it('★イカサマ の 2 段目の当たりは、駆け込みの後に出て、しっぽを回している間に同じ敵へ 2 回以上当たる', () => {
    const t = setup();
    t.p.moves = [t.pm('foul-play-umbreon')];
    recomputeModifiers(t.w, t.p);
    const e = t.w.enemies;
    e.add(2, 0, 150, 0, 1e9, 0, 14);
    const m = t.p.moves[0]!.move;
    const hits: number[] = [];
    let last = 1e9;
    for (let k = 0; k < 40; k++) {
      t.sim.step([]);
      const j = [...Array(e.count).keys()].find((i) => e.id[i] === 2)!;
      if (e.hp[j]! < last) hits.push(k);
      last = e.hp[j]!;
      if (t.p.moves[0]!.cooldown > 1 && k > 25) break;
    }
    void m;
    // 駆け込みの 1 回 ＋ しっぽの 2 回以上
    expect(hits.length).toBeGreaterThanOrEqual(3);
  });
});
