import type { NatureStat } from '../data/schema';
import { hash01 } from './math';
import type { SimRules } from './rules';
import type { SimSpecies } from './species';
import type { World } from './world';

/** 性格の抽選の塩（ほかの hash01 の使い方と値が重ならないように） */
const NATURE_SALT = 0x6e617475;

/**
 * 性格を抽選する（ホウエン。07 の89.3: ランを始めるたびに一人ずつ）。性格の無い地方は undefined。
 * ランのシードとプレイヤーの番号から決めるので、協力プレイのどのブラウザでも同じ性格になる（送らなくてよい）
 */
export function drawNature(world: World, playerId: number): number | undefined {
  const list = world.rules.natures;
  if (!list || list.length === 0) return undefined;
  return Math.min(list.length - 1, Math.floor(hash01(world.seed, playerId, 0, NATURE_SALT) * list.length));
}

/** その能力に掛ける性格の倍率（上がる 1 + naturePct%・下がる 1 − naturePct%・ほかは 1） */
export function natureFactor(rules: SimRules, nature: number | undefined, stat: NatureStat): number {
  const n = nature === undefined ? undefined : rules.natures?.[nature];
  if (!n) return 1;
  const pct = rules.stats.naturePct / 100;
  return n.up === stat ? 1 + pct : n.down === stat ? 1 - pct : 1;
}

/** 防御に使う能力（ぼうぎょ と とくぼう の高い方。同じなら ぼうぎょ。species.ts の deriveStats と同じ選び方） */
export function defenseStatOf(species: SimSpecies): NatureStat {
  return species.baseStats.specialDefense > species.baseStats.defense ? 'special-defense' : 'defense';
}
