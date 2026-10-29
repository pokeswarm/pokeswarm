import type { AchievementsConfig, ModifierData } from '../data/schema';

/**
 * 達成した実績の報酬のうち、ランに効くもの（作者の決定。07 23・24章）。
 * 達成した実績の id の一覧から計算するので、協力プレイでは待合室で一覧を受け取れば、どのブラウザでも同じになる
 */
export interface AchievementPerks {
  /** 候補に出る持ち物（最初から使えるもの ＋ 実績で解放したもの） */
  readonly items: ReadonlySet<string>;
  /** 系統ごとの、最初の技のレベル */
  readonly startMoveLevel: Readonly<Record<string, number>>;
  /** 協力プレイで、部屋の全員の経験値 +% */
  readonly coopXpPct: number;
  /** ふしぎなアメの +3・+5 の重みに足す */
  readonly candyWeight: number;
  /** 持ち物の枠を増やす */
  readonly itemSlots: number;
  /** 持ち物と同じ形の効果（足し合わせたもの） */
  readonly mods: ModifierData;
  /** 色違いで遊べる系統（playables.json のキー） */
  readonly shiny: ReadonlySet<string>;
}

/** 達成した実績のうち、その地方の実績だけ（報酬はその地方のランだけに効く。02 の17章） */
export function regionAchieved(cfg: AchievementsConfig, achieved: readonly string[], region: string): string[] {
  const ids = new Set(cfg.achievements.filter((a) => a.region === region).map((a) => a.id));
  return achieved.filter((id) => ids.has(id));
}

/** region: その地方だけ最初から出る持ち物（regionInitialItems）も足す */
export function achievementPerks(cfg: AchievementsConfig, achieved: readonly string[], region?: string): AchievementPerks {
  const items = new Set([...cfg.initialItems, ...(region ? (cfg.regionInitialItems[region] ?? []) : [])]);
  const startMoveLevel: Record<string, number> = {};
  const mods: Record<string, number> = {};
  let coopXpPct = 0;
  let candyWeight = 0;
  let itemSlots = 0;
  const shiny = new Set<string>();
  for (const a of cfg.achievements) {
    if (!achieved.includes(a.id) || !a.reward) continue;
    const r = a.reward;
    if (r.item) items.add(r.item);
    if (r.shiny) shiny.add(r.shiny);
    const b = r.buff;
    if (!b) continue;
    if (b.startMoveLevel) startMoveLevel[b.startMoveLevel.line] = Math.max(startMoveLevel[b.startMoveLevel.line] ?? 1, b.startMoveLevel.level);
    coopXpPct += b.coopXpPct ?? 0;
    candyWeight += b.candyWeight ?? 0;
    itemSlots += b.itemSlots ?? 0;
    for (const [k, v] of Object.entries(b.mods ?? {})) if (typeof v === 'number') mods[k] = (mods[k] ?? 0) + v;
  }
  return { items, startMoveLevel, coopXpPct, candyWeight, itemSlots, mods: mods as ModifierData, shiny };
}
