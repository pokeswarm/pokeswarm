import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { moveStatsOf, scaledMoveStats } from './systems/attack';
import { checkEvolution } from './systems/evolution';
import { canLearnNewMove, makeOffers, recomputeModifiers } from './systems/leveling';

/** 07 の329章: シャワーズの作り直し（みずのはどう・★だくりゅう・アクアリング） */
function setup(form = 'vaporeon') {
  const rules = buildSimRules('kanto');
  const sim = new Simulation({ tickRate: 30, seed: 3, rules });
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

describe('シャワーズ（07 の329章）', () => {
  it('みずのいし で進化すると のしかかり も みずのはどう になり、アクアリング を覚えられる', () => {
    const t = setup('eevee');
    t.p.moves = [t.pm('body-slam', 3)];
    t.p.items = [{ item: t.item('water-stone'), level: 1 }];
    checkEvolution(t.w, t.p);
    expect(t.p.moves.map((m) => t.rules.moves[m.move]!.key)).toEqual(['water-pulse-vaporeon']);
    expect(canLearnNewMove(t.w, t.p, moveIndexOf(t.rules, 'aqua-ring'))).toBe(true);
  });

  it('★だくりゅう は HP が多いほど強く・大きい: マックスアップ で上がる', () => {
    const t = setup();
    const mw = t.pm('muddy-water');
    const at = (hpUp: number) => {
      t.p.moves = [mw];
      t.p.items = hpUp ? [{ item: t.item('hp-up'), level: hpUp }] : [];
      recomputeModifiers(t.w, t.p);
      return scaledMoveStats(t.w, t.p, mw, moveStatsOf(t.w, mw));
    };
    const def = t.rules.moves[mw.move]!.hpScale!;
    // シャワーズは HP の種族値 130（ランクの倍率 1.45）
    const base = at(0);
    expect(t.p.hpFactor).toBeCloseTo(1.45, 5);
    const big = at(5);
    expect(t.p.hpFactor).toBeCloseTo(1.45 * 2, 5);
    expect(big.power / base.power).toBeCloseTo((1 + def.power * 1.9) / (1 + def.power * 0.45), 5);
    expect(big.size / base.size).toBeCloseTo((1 + def.size * 1.9) / (1 + def.size * 0.45), 5);
  });

  it('バブルこうせん ＋ マックスアップ → ★だくりゅう はシャワーズだけ', () => {
    for (const [form, ok] of [['vaporeon', true], ['eevee', false], ['flareon', false]] as const) {
      const t = setup(form);
      t.p.moves = [t.pm('bubble-beam')];
      t.p.items = [{ item: t.item('hp-up'), level: 1 }];
      recomputeModifiers(t.w, t.p);
      const offers = makeOffers(t.w, t.p);
      expect(offers.some((o) => o.kind === 'derive' && o.to === moveIndexOf(t.rules, 'muddy-water'))).toBe(ok);
    }
  });

  it('アクアリング: 自分に付いて動く回復の円。歩いても回復し続ける', () => {
    const t = setup();
    t.p.moves = [t.pm('aqua-ring')];
    recomputeModifiers(t.w, t.p);
    t.p.hp = t.p.maxHp * 0.5;
    t.p.inputX = 1;
    t.sim.step([]);
    const hp0 = t.p.hp;
    for (let k = 0; k < 30 * 3; k++) t.sim.step([]);
    // 3 秒で 90 以上歩いても、円は付いてくるので回復が続く
    expect(t.p.x).toBeGreaterThan(90);
    const per = t.rules.moves[moveIndexOf(t.rules, 'aqua-ring')]!;
    expect(per.healFollow).toBe(true);
    expect(t.p.hp - hp0).toBeGreaterThan(t.p.maxHp * 0.03);
  });
});
