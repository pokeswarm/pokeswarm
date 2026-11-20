import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { moveStatsOf, scaledMoveStats } from './systems/attack';
import { checkEvolution } from './systems/evolution';
import { hurtPlayer } from './systems/health';
import { canLearnNewMove, makeOffers, recomputeModifiers } from './systems/leveling';

/** 07 の328章: ブースターの作り直し（ニトロチャージ・★やけっぱち） */
function setup(form = 'flareon') {
  const rules = buildSimRules('kanto');
  const sim = new Simulation({ tickRate: 30, seed: 3, rules });
  const lo = playableLoadout(rules, 'eevee');
  const p = sim.addPlayer({
    id: sim.world.localPlayerId, x: 0, y: 0, radius: 12, moveSpeed: 180, types: lo.types, moveTypes: lo.moveTypes, fixedMoves: lo.fixedMoves, line: lo.line,
    species: rules.species.findIndex((s) => s.key === form), moves: [],
  });
  // 敵が湧かないように
  for (const wave of sim.world.waves) Object.assign(wave, { spawnPerSecond: 0, minimum: 0 });
  const item = (k: string): number => rules.items.findIndex((x) => x.key === k);
  const pm = (k: string, level = 8) => ({ move: moveIndexOf(rules, k), level, cooldown: 0, burstLeft: 0, burstTimer: 0 });
  return { rules, sim, w: sim.world, p, item, pm };
}

describe('ブースター（07 の328章）', () => {
  it('ほのおのいし で進化すると のしかかり も ニトロチャージ になる', () => {
    const t = setup('eevee');
    t.p.moves = [t.pm('body-slam', 3)];
    t.p.items = [{ item: t.item('fire-stone'), level: 1 }];
    checkEvolution(t.w, t.p);
    expect(t.p.moves.map((m) => t.rules.moves[m.move]!.key)).toEqual(['flame-charge']);
    expect(canLearnNewMove(t.w, t.p, moveIndexOf(t.rules, 'fire-fang'))).toBe(true);
  });

  it('ニトロチャージ は当てるたびに速くなる（1 回 +8%・3 回まで）。当てないまま 4 秒で消える', () => {
    const t = setup();
    t.p.moves = [t.pm('flame-charge')];
    recomputeModifiers(t.w, t.p);
    const base = t.p.mods.moveSpeedPct;
    t.p.facingX = 1;
    // 前に倒れない敵を置いて、体当たりを 4 回当てる（敵は毎回前へ置き直す）
    t.w.enemies.add(1, 0, 60, 0, 1e9, 0, 10);
    const stacks: number[] = [];
    for (let k = 0; k < 30 * 8 && stacks.length < 4; k++) {
      const before = t.p.moveBuffs?.[0]?.stacks ?? 0;
      t.sim.step([]);
      t.w.enemies.x[0] = t.p.x + 60;
      t.w.enemies.y[0] = t.p.y;
      const now = t.p.moveBuffs?.[0]?.stacks ?? 0;
      if (now !== before || (t.p.dashTicks === 1 && now === 3)) stacks.push(now);
    }
    expect(stacks.slice(0, 3)).toEqual([1, 2, 3]);
    expect(t.p.mods.moveSpeedPct).toBeCloseTo(base + 24, 5);
    // 敵を遠くへ離すと、4 秒で消える
    t.w.enemies.x[0] = 1e5;
    for (let k = 0; k < 30 * 4.2; k++) t.sim.step([]);
    expect(t.p.moveBuffs?.length ?? 0).toBe(0);
    expect(t.p.mods.moveSpeedPct).toBeCloseTo(base, 5);
  });

  it('★やけっぱち はダメージを受けてから 4 秒の間、威力 2 倍・大きさ 1.25 倍', () => {
    const t = setup();
    const tf = t.pm('temper-flare');
    t.p.moves = [tf];
    recomputeModifiers(t.w, t.p);
    const calm = scaledMoveStats(t.w, t.p, tf, moveStatsOf(t.w, tf));
    hurtPlayer(t.w, t.p, 1);
    const angry = scaledMoveStats(t.w, t.p, tf, moveStatsOf(t.w, tf));
    expect(angry.power / calm.power).toBeCloseTo(2, 5);
    expect(angry.size / calm.size).toBeCloseTo(1.25, 5);
    for (let k = 0; k < 30 * 4.1; k++) t.sim.step([]);
    expect(scaledMoveStats(t.w, t.p, tf, moveStatsOf(t.w, tf)).power).toBeCloseTo(calm.power, 5);
  });

  it('ほのおのキバ ＋ もくたん → ★やけっぱち はブースターだけ（ほかの姿は フレアドライブ の道だけ）', () => {
    for (const [form, ok] of [['flareon', true], ['eevee', false], ['jolteon', false]] as const) {
      const t = setup(form);
      t.p.moves = [t.pm('fire-fang')];
      t.p.items = [{ item: t.item('charcoal'), level: 1 }];
      recomputeModifiers(t.w, t.p);
      const offers = makeOffers(t.w, t.p);
      expect(offers.some((o) => o.kind === 'derive' && o.to === moveIndexOf(t.rules, 'temper-flare'))).toBe(ok);
    }
  });
});
