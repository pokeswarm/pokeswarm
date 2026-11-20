import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { answerEvolution, checkEvolution } from './systems/evolution';
import { canLearnNewMove, makeOffers, recomputeModifiers } from './systems/leveling';

/** イーブイの進化で たいあたり などが固有技に変わる（作者の依頼 2026年10月28日。07 の103章） */
function setup(region = 'kanto') {
  const rules = buildSimRules(region);
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const lo = playableLoadout(rules, 'eevee');
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 180, types: lo.types, moveTypes: lo.moveTypes, fixedMoves: lo.fixedMoves, moves: lo.moves, line: lo.line, species: lo.species });
  const move = (key: string): number => moveIndexOf(rules, key);
  const keys = (): string[] => p.moves.map((m) => rules.moves[m.move]!.key);
  const stone = (key: string) => [{ item: rules.items.findIndex((it) => it.key === key), level: 1 }];
  const has = (key: string) => ({ move: move(key), level: 5, cooldown: 0, burstLeft: 0, burstTimer: 0 });
  return { rules, sim, w: sim.world, p, move, keys, stone, has };
}

describe('イーブイの進化で技が変わる', () => {
  it('石で進化すると たいあたり が だくりゅう・ニトロチャージ・ミサイルばり になり、強化の段階は受け継ぐ（ブースターは 07 の328章）', () => {
    for (const [item, to] of [
      ['water-stone', 'muddy-water'],
      ['fire-stone', 'flame-charge'],
      ['thunder-stone', 'pin-missile'],
    ] as const) {
      const s = setup();
      s.p.moves = [s.has('swift'), s.has('tackle')];
      s.p.items = s.stone(item);
      checkEvolution(s.w, s.p);
      expect(s.keys()).toEqual(['swift', to]);
      expect(s.p.moves[1]!.level).toBe(5);
      // 元の技は、もう候補に出ない
      expect(s.p.consumedMoves).toContain(s.move('tackle'));
      expect(makeOffers(s.w, s.p).some((o) => o.kind === 'moveNew' && o.move === s.move('tackle'))).toBe(false);
    }
  });

  it('たいあたり が無ければ何も変わらない', () => {
    const s = setup();
    s.p.moves = [s.has('swift')];
    s.p.items = s.stone('water-stone');
    checkEvolution(s.w, s.p);
    expect(s.keys()).toEqual(['swift']);
  });

  it('サンダースは のしかかり でも ミサイルばり になり、こうそくいどう を覚えられる（段階ごとに移動速度 +4%。07 の325章）', () => {
    const s = setup();
    s.p.moves = [s.has('body-slam')];
    s.p.items = s.stone('thunder-stone');
    checkEvolution(s.w, s.p);
    expect(s.keys()).toEqual(['pin-missile']);
    expect(canLearnNewMove(s.w, s.p, s.move('agility'))).toBe(true);
    s.p.moves.push(s.has('agility'));
    recomputeModifiers(s.w, s.p);
    expect(s.p.mods.moveSpeedPct).toBeCloseTo(4 * 5);
  });

  it('エーフィ・ブラッキーは のしかかり でも あさのひざし・つきのひかり になる（たいあたり が先）', () => {
    const s = setup('johto');
    const espeon = s.rules.species.findIndex((x) => x.key === 'espeon');
    s.p.moves = [s.has('body-slam'), s.has('tackle')];
    // 進化の聞き方は 81章（babies.test.ts）。ここでは姿を直接変えて、変わり方だけを見る
    s.p.evolveAsk = espeon;
    answerEvolution(s.w, s.p, true);
    expect(s.keys()).toEqual(['body-slam', 'morning-sun', 'psychic']);
  });
});
