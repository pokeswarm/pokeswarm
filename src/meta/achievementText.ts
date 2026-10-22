import { achievementsConfig, generated } from '../data';
import { localName } from '../data/simRules';
import type { AchievementsConfig } from '../data/schema';
import { getLocale, t, tMaybe } from '../i18n';

type Achievement = AchievementsConfig['achievements'][number];

function pokemonName(key: string): string {
  return localName(generated.pokemon[key]?.names, getLocale(), key);
}

function find(id: string): Achievement | undefined {
  return achievementsConfig.achievements.find((a) => a.id === id);
}

/**
 * 実績の名前・条件・報酬の文（作者の決定 2026年10月22日: 一覧では、達成するまで名前と報酬を伏せ、条件だけ見せる）。
 * ポケモンの解放の実績は、翻訳ファイルに無ければ決まった文から作る
 */
export function achievementName(id: string): string {
  const a = find(id);
  const own = tMaybe(`achievement.${id}.name`);
  if (own || !a?.reward?.pokemon) return own;
  return t('achievement.unlock.name', { name: pokemonName(a.reward.pokemon) });
}

/** 達成の条件 */
export function achievementCondition(a: Achievement): string {
  const own = tMaybe(`achievement.${a.id}.desc`);
  if (own) return own;
  // 「（中ボス・ボス・伝説の）〇〇を n 回倒す」
  if ('stat' in a.condition) {
    const m = /^(?:bossDefeated|defeated)\.(.+)$/.exec(a.condition.stat);
    if (m) return t('achievement.cond.defeat', { name: pokemonName(m[1]!), count: a.condition.atLeast });
  }
  return own;
}

/** 報酬（無ければ null） */
export function achievementReward(a: Achievement, playable: boolean): string | null {
  if (a.reward?.pokemon) return t(playable ? 'achievement.reward.pokemon' : 'achievement.reward.pokemonLater', { name: pokemonName(a.reward.pokemon) });
  return null;
}
