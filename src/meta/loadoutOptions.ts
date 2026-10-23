import { achievementsConfig } from '../data';
import { buildSimRules, playableLoadout } from '../data/simRules';
import type { SimRules } from '../sim/rules';
import { itemFits } from '../sim/systems/leveling';
import { achievementPerks } from './achievementPerks';
import type { SaveData } from './saveData';

/**
 * ラン開始時に選ぶもの（作者の決定 2026年10月24日）:
 * - 最初の持ち物: そのポケモンで achievements.json の startItem.clears 回クリアすると、解放済みの持ち物を1つ選んで持っていける
 * - 色違い: 色違いの御三家（伝説戦）を倒すと、その系統を色違いで遊べる（見た目だけ）
 */

/** 色違いのスプライトのキー（data/sprites/pokemon.json の <キー>-shiny） */
export function shinySpriteKey(key: string): string {
  return `${key}-shiny`;
}

/** そのポケモンで最初の持ち物を選べるか */
export function canChooseStartItem(save: Readonly<SaveData>, pokemon: string): boolean {
  return (save.stats[`clears.${pokemon}`] ?? 0) >= achievementsConfig.startItem.clears;
}

/** そのポケモンを色違いで遊べるか */
export function canUseShiny(save: Readonly<SaveData>, pokemon: string): boolean {
  return achievementPerks(achievementsConfig, save.achievements).shiny.has(pokemon);
}

let rulesCache: SimRules | null = null;

/** 最初に持っていける持ち物のキー（解放済みで、そのポケモンの候補に出るもの。持ち物の一覧の順） */
export function startItemChoices(save: Readonly<SaveData>, pokemon: string): string[] {
  rulesCache ??= buildSimRules();
  const rules = rulesCache;
  const perks = achievementPerks(achievementsConfig, save.achievements);
  const loadout = playableLoadout(rules, pokemon);
  const unlockedItems = new Set(rules.items.flatMap((it, i) => (perks.items.has(it.key) ? [i] : [])));
  const p = { unlockedItems, line: loadout.line, species: loadout.species, items: [], types: loadout.types, moveTypes: loadout.moveTypes };
  return rules.items.flatMap((it, i) => (itemFits(rules, p, i) ? [it.key] : []));
}

const STORAGE_KEY = 'pokeswarm.loadoutOptions';

/** 前回選んだもの（ポケモンごと。このブラウザだけに覚える。読めなければ空） */
export function rememberedOptions(pokemon: string): { startItem: string | null; shiny: boolean } {
  try {
    const all = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, { startItem?: string | null; shiny?: boolean }>;
    const v = all[pokemon];
    return { startItem: v?.startItem ?? null, shiny: !!v?.shiny };
  } catch {
    return { startItem: null, shiny: false };
  }
}

export function rememberOptions(pokemon: string, options: { startItem: string | null; shiny: boolean }): void {
  try {
    const all = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    all[pokemon] = options;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // 覚えられなくても遊べる
  }
}
