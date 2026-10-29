import { describe, expect, it } from 'vitest';
import { buildSimRules } from '../data/simRules';
import { generated } from '../data';
import { Simulation } from './simulation';
import { testRules } from './testRules';
import { recomputeModifiers } from './systems/leveling';

const NATURES = [
  { key: 'hardy', up: null, down: null },
  { key: 'adamant', up: 'attack', down: 'special-attack' },
  { key: 'timid', up: 'speed', down: 'attack' },
  { key: 'bold', up: 'defense', down: 'attack' },
  { key: 'calm', up: 'special-defense', down: 'attack' },
] as const;

function withNature(nature: number, natures: typeof NATURES | undefined = NATURES) {
  const rules = { ...testRules(), ...(natures ? { natures } : {}) };
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  // 抽選の結果を上書きして、決まった性格で能力を作り直す
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 10, moveSpeed: 100 });
  p.nature = natures ? nature : undefined;
  recomputeModifiers(sim.world, p);
  return { p, sim };
}

describe('性格（ホウエン。07 の89.3）', () => {
  it('性格の無い地方（カントー・ジョウト）では抽選しない。ホウエンでは25種類から抽選する', () => {
    expect(buildSimRules('kanto').natures).toBeUndefined();
    expect(buildSimRules('johto').natures).toBeUndefined();
    const hoenn = buildSimRules('hoenn').natures!;
    expect(hoenn).toHaveLength(Object.keys(generated.natures).length);
    expect(hoenn).toHaveLength(25);
    const sim = new Simulation({ tickRate: 30, seed: 1, rules: testRules() });
    expect(sim.addPlayer({ id: 1, x: 0, y: 0, radius: 10, moveSpeed: 100 }).nature).toBeUndefined();
  });

  it('同じシードと番号なら、どのブラウザでも同じ性格。人ごと・ランごとに変わる', () => {
    const rules = { ...testRules(), natures: NATURES };
    const draw = (seed: number, id: number) => new Simulation({ tickRate: 30, seed, rules }).addPlayer({ id, x: 0, y: 0, radius: 10, moveSpeed: 100 }).nature;
    expect(draw(7, 1)).toBe(draw(7, 1));
    const seen = new Set<number | undefined>();
    for (let seed = 0; seed < 50; seed++) for (let id = 1; id <= 4; id++) seen.add(draw(seed, id));
    expect(seen.size).toBe(NATURES.length);
  });

  it('上がる能力は ×1.1、下がる能力は ×0.9。こうげき → 物理・とくこう → 特殊・すばやさ → 移動速度', () => {
    const { p } = withNature(1);
    expect(p.physicalPower).toBeCloseTo(1.1);
    expect(p.specialPower).toBeCloseTo(0.9);
    const t = withNature(2);
    expect(t.p.moveSpeed).toBeCloseTo(100 * 1.1);
    expect(t.p.physicalPower).toBeCloseTo(0.9);
    const h = withNature(0);
    expect(h.p.physicalPower).toBeCloseTo(1);
    expect(h.p.specialPower).toBeCloseTo(1);
  });

  it('防御は ぼうぎょ と とくぼう の高い方（同じなら ぼうぎょ）の性格で変わる', () => {
    const rules = { ...testRules({ stats: { base: { maxHp: 100, power: 1, defense: 20 } } }), natures: NATURES };
    const make = (nature: number) => {
      const sim = new Simulation({ tickRate: 30, seed: 1, rules });
      const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 10, moveSpeed: 100 });
      p.nature = nature;
      recomputeModifiers(sim.world, p);
      return p.defense;
    };
    // テストのポケモンは ぼうぎょ と とくぼう が同じなので、ぼうぎょ の性格だけが効く
    expect(make(3)).toBeCloseTo(make(0) * 1.1);
    expect(make(4)).toBeCloseTo(make(0));
  });
});
