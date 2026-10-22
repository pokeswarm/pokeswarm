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

/** 報酬（無ければ null）。ポケモン・持ち物・コイン・特殊なバフ */
export function achievementReward(a: Achievement, playable: boolean): string | null {
  const r = a.reward;
  if (!r) return null;
  if (r.pokemon) return t(playable ? 'achievement.reward.pokemon' : 'achievement.reward.pokemonLater', { name: pokemonName(r.pokemon) });
  if (r.item) return t('achievement.reward.item', { name: localName(generated.items[r.item]?.names, getLocale(), r.item) });
  if (r.coins) return t('achievement.reward.coins', { coins: r.coins });
  const b = r.buff;
  if (!b) return null;
  if (b.startMoveLevel) return t('achievement.reward.startMoveLevel', { name: pokemonName(b.startMoveLevel.line), level: b.startMoveLevel.level });
  if (b.coopXpPct) return t('achievement.reward.coopXp', { pct: b.coopXpPct });
  if (b.candyWeight) return t('achievement.reward.candy');
  if (b.itemSlots) return t('achievement.reward.itemSlots', { n: b.itemSlots });
  if (b.startStatItem) return t('achievement.reward.startItem');
  if (b.mods?.xpPct) return t('achievement.reward.xp', { pct: b.mods.xpPct });
  if (b.mods?.pickupRangePct) return t('achievement.reward.pickup', { pct: b.mods.pickupRangePct });
  return null;
}

/** 達成した実績の報酬を、id から（ラン中のお知らせ・結果画面） */
export function achievementRewardById(id: string): string | null {
  const a = find(id);
  return a ? achievementReward(a, true) : null;
}
