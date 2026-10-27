import { generated, playablesConfig } from '../data';
import { localName } from '../data/simRules';
import { getLocale, t } from '../i18n';
import { Rng } from '../sim/rng';

/**
 * タマゴ（07 の57章・66.4）: 選んだポケモンがタマゴなら、かえるベイビィポケモンをシード付きの乱数で1匹選ぶ（タマゴでなければそのまま）。
 * ソロは選ぶたび・もう一度のたびに新しいシード、協力プレイは部屋のシードと人の番号から作るので、どのブラウザでも同じになる
 */
export function hatchedPokemon(key: string, seed: number): string {
  const hatch = playablesConfig.pokemon[key]?.hatch;
  if (!hatch?.length) return key;
  return hatch[new Rng(seed).int(hatch.length)]!;
}

/** ソロのタマゴのシード（ランを始めるたびに引き直す） */
export function freshHatchSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

/** 協力プレイのタマゴのシード（部屋のシードと人の番号から。一人ずつ違うベイビィポケモンになりうる） */
export function coopHatchSeed(roomSeed: number, playerId: number): number {
  return (roomSeed ^ Math.imul(playerId + 1, 0x9e3779b1)) >>> 0;
}

/** タマゴか */
export function isEgg(key: string): boolean {
  return !!playablesConfig.pokemon[key]?.hatch;
}

/** 遊べるポケモンの名前（タマゴは「タマゴ」。ほかは PokeAPI の名前） */
export function playableName(key: string): string {
  return isEgg(key) ? t('egg.name') : localName(generated.pokemon[key]?.names, getLocale(), key);
}
