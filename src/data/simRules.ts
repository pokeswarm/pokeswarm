import { buildTypeChart, resolveMoveLevels, type SimMoveDef } from '../sim/moves';
import { addModifiers, buildXpTable, emptyModifiers, resolveModifiers, type Modifiers, type SimUpgradeDef } from '../sim/upgrades';
import type { SimEvolution, SimSpecies } from '../sim/species';
import type { SimRules } from '../sim/rules';
import {
  combatConfig,
  derivationsConfig,
  enemiesConfig,
  generated,
  itemsConfig,
  levelingConfig,
  movesConfig,
  passivesConfig,
  pickupConfig,
  playablesConfig,
  shopConfig,
  spawnConfig,
  stageConfig,
  statsConfig,
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
      body: def.body ?? null,
    };
  });
  const moveIndex = (key: string): number => moves.findIndex((m) => m.key === key);
  const upgrades = (
    defs: Record<string, { maxLevel: number; consumable: boolean; perLevel: Parameters<typeof resolveModifiers>[0]; lines?: string[]; powerMultiplier?: number }>,
  ): SimUpgradeDef[] =>
    Object.entries(defs).map(([key, d]) => ({
      key,
      maxLevel: d.maxLevel,
      consumable: d.consumable,
      perLevel: resolveModifiers(d.perLevel, types.names),
      ...(d.lines ? { lines: d.lines } : {}),
      ...(d.powerMultiplier ? { powerMultiplier: d.powerMultiplier } : {}),
    }));
  const items = upgrades(itemsConfig.items);
  const itemIndex = (key: string): number => items.findIndex((i) => i.key === key);
  const derivations = [
    ...derivationsConfig.derivations.map((d) => ({ from: moveIndex(d.from), item: itemIndex(d.item), to: moveIndex(d.to), line: null })),
    ...derivationsConfig.unique.map((d) => ({ from: moveIndex(d.from), item: itemIndex(d.item), to: moveIndex(d.to), line: d.line, ...(d.minLevel ? { minLevel: d.minLevel } : {}) })),
  ];
  // ポケモンの種類: PokeAPI から生成したすべて。進化先・進化の道具が無いものは進化の一覧から外す
  const speciesKeys = Object.keys(generated.pokemon);
  const linkingCord = itemIndex('linking-cord');
  const species: SimSpecies[] = speciesKeys.map((key) => {
    const g = generated.pokemon[key]!;
    const evolutions: SimEvolution[] = [];
    // 進化しない遊べるポケモン（ピカチュウ）
    if (playablesConfig.pokemon[key]?.evolves === false) return { key, types: g.types.map(typeIndex), baseStats: g.baseStats, evolutions };
    for (const e of g.evolvesTo) {
      const to = speciesKeys.indexOf(e.to);
      if (to === -1) continue;
      if (e.trigger === 'level' && e.level) evolutions.push({ to, trigger: 'level', level: e.level });
      else if (e.trigger === 'item' && e.item && itemIndex(e.item) !== -1) evolutions.push({ to, trigger: 'item', item: itemIndex(e.item) });
      else if (e.trigger === 'trade' && linkingCord !== -1) evolutions.push({ to, trigger: 'trade', item: linkingCord });
    }
    return { key, types: g.types.map(typeIndex), baseStats: g.baseStats, evolutions };
  });
  return {
    enemies: { kinds: enemiesConfig.kinds.map((k) => ({ ...k, types: generated.pokemon[k.species ?? k.id]!.types.map(typeIndex) })) },
    spawn: spawnConfig,
    status: statusConfig,
    pickups: pickupConfig,
    combat: combatConfig,
    moves,
    types,
    leveling: { ...levelingConfig, xpToNext: buildXpTable(levelingConfig) },
    items,
    passives: upgrades(passivesConfig.passives),
    derivations,
    species,
    stats: statsConfig,
    stage: stageConfig,
  };
}

export function moveIndexOf(rules: SimRules, key: string): number {
  const i = rules.moves.findIndex((m) => m.key === key);
  if (i === -1) throw new Error(`技 ${key} がありません`);
  return i;
}

/** プレイアブルのポケモンの、シミュレーションでの初期値（タイプと最初の技） */
export function playableLoadout(
  rules: SimRules,
  pokemon: string,
): { types: number[]; moves: { move: number; level: number }[]; line: string; species: number } {
  const p = playablesConfig.pokemon[pokemon] ?? playablesConfig.pokemon[playablesConfig.default]!;
  const species = generated.pokemon[pokemon] ?? generated.pokemon[playablesConfig.default]!;
  return {
    types: species.types.map((t) => rules.types.names.indexOf(t)),
    moves: p.startingMoves.map((m) => ({ move: moveIndexOf(rules, m), level: 1 })),
    // 系統はプレイアブルのキー（固有技の判定。進化しても変わらない）
    line: playablesConfig.pokemon[pokemon] ? pokemon : playablesConfig.default,
    species: rules.species.findIndex((s) => s.key === (playablesConfig.pokemon[pokemon] ? pokemon : playablesConfig.default)),
  };
}

/** 永続強化のレベルから、プレイヤーに足す効果を作る（ショップの perLevel × レベル）。何も無ければ null */
export function permanentModifiers(rules: SimRules, levels: Readonly<Record<string, number>>): Modifiers | null {
  let out: Modifiers | null = null;
  for (const def of shopConfig.upgrades) {
    const level = Math.min(levels[def.id] ?? 0, def.maxLevel);
    if (!def.perLevel || level <= 0) continue;
    out ??= emptyModifiers(rules.types.names.length);
    addModifiers(out, resolveModifiers(def.perLevel, rules.types.names), level);
  }
  return out;
}

/** PokeAPI 由来の名前を、今の言語で取り出す */
export function localName(names: LocalizedNames | undefined, locale: 'ja' | 'en', fallback: string): string {
  return names ? names[locale] : fallback;
}
