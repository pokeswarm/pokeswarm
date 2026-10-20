import { buildTypeChart, resolveMoveLevels, type SimMoveDef } from '../sim/moves';
import type { SimRules } from '../sim/rules';
import {
  combatConfig,
  enemiesConfig,
  generated,
  movesConfig,
  pickupConfig,
  playablesConfig,
  spawnConfig,
  statusConfig,
} from './index';
import type { LocalizedNames } from './schema';

/**
 * data/ の定義と PokeAPI から生成したデータを組み合わせて、シミュレーションが使う定義一式を作る。
 * 技・タイプは番号（並び順）で指すので、その対応もここで作る。
 */
export function buildSimRules(): SimRules {
  const types = buildTypeChart(generated.types);
  const typeIndex = (key: string): number => {
    const i = types.names.indexOf(key);
    if (i === -1) throw new Error(`タイプ ${key} がありません`);
    return i;
  };
  const statusIndexOf = (id: string): number => statusConfig.kinds.findIndex((k) => k.id === id);
  const moves: SimMoveDef[] = Object.entries(movesConfig.moves).map(([key, def]) => {
    const g = generated.moves[key]!;
    return {
      key,
      pattern: def.pattern,
      type: typeIndex(g.type),
      // 原作で変化技（status）のものは、特殊の威力を使う
      damageClass: g.damageClass === 'physical' ? 'physical' : 'special',
      levels: resolveMoveLevels(def, statusIndexOf),
      effect: def.effect,
    };
  });
  return {
    enemies: { kinds: enemiesConfig.kinds.map((k) => ({ ...k, types: generated.pokemon[k.id]!.types.map(typeIndex) })) },
    spawn: spawnConfig,
    status: statusConfig,
    pickups: pickupConfig,
    combat: combatConfig,
    moves,
    types,
  };
}

export function moveIndexOf(rules: SimRules, key: string): number {
  const i = rules.moves.findIndex((m) => m.key === key);
  if (i === -1) throw new Error(`技 ${key} がありません`);
  return i;
}

/** プレイアブルのポケモンの、シミュレーションでの初期値（タイプと最初の技） */
export function playableLoadout(rules: SimRules, pokemon: string): { types: number[]; moves: { move: number; level: number }[] } {
  const p = playablesConfig.pokemon[pokemon] ?? playablesConfig.pokemon[playablesConfig.default]!;
  const species = generated.pokemon[pokemon] ?? generated.pokemon[playablesConfig.default]!;
  return {
    types: species.types.map((t) => rules.types.names.indexOf(t)),
    moves: p.startingMoves.map((m) => ({ move: moveIndexOf(rules, m), level: 1 })),
  };
}

/** PokeAPI 由来の名前を、今の言語で取り出す */
export function localName(names: LocalizedNames | undefined, locale: 'ja' | 'en', fallback: string): string {
  return names ? names[locale] : fallback;
}
