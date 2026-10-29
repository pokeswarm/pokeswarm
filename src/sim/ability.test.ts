import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { scaledMoveStats } from './systems/attack';
import { pinchMods } from './ability';

/** 特性（作者の決定 2026年10月29日。07 の133章） */
function setup(line: string, region: string) {
  const rules = buildSimRules(region);
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const lo = playableLoadout(rules, line);
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, types: lo.types, moveTypes: lo.moveTypes, fixedMoves: lo.fixedMoves, moves: lo.moves, line: lo.line, species: lo.species });
  const power = (key: string): number => {
    const pm = { move: moveIndexOf(rules, key), level: 1, cooldown: 0, burstLeft: 0, burstTimer: 0 };
    return scaledMoveStats(sim.world, p, pm, rules.moves[pm.move]!.levels[0]!).power;
  };
  return { rules, sim, p, power };
}

describe('特性', () => {
  it('特性はホウエンのランだけ（カントー・ジョウトには無い）。御三家は しんりょく・もうか・げきりゅう', () => {
    expect(buildSimRules('kanto').abilities).toBeUndefined();
    expect(buildSimRules('johto').abilities).toBeUndefined();
    const a = buildSimRules('hoenn').abilities!;
    expect([a.treecko?.key, a.torchic?.key, a.mudkip?.key]).toEqual(['overgrow', 'blaze', 'torrent']);
  });

  it('しんりょく: HP が 1/3 以下の間だけ、くさの技の威力が 1.5 倍に近く上がる。ほかのタイプの技は変わらない', () => {
    const { p, sim, power } = setup('treecko', 'hoenn');
    const leaf = power('leafage');
    const scratch = power('scratch');
    expect(pinchMods(sim.world, p)).toBeNull();
    p.hp = p.maxHp * 0.3;
    expect(pinchMods(sim.world, p)).not.toBeNull();
    expect(power('leafage')).toBeCloseTo(leaf * 1.5);
    expect(power('scratch')).toBeCloseTo(scratch);
    p.hp = p.maxHp * 0.5;
    expect(power('leafage')).toBeCloseTo(leaf);
  });
});
