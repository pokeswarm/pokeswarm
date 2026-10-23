import type { ShopConfig } from '../data/schema';
import type { SaveData } from './saveData';

/** 1ランの成果（コインの計算に使う） */
export interface RunResult {
  seconds: number;
  /** 自分が倒した数 */
  kills: number;
  /** 中ボス・四天王を倒した数（協力プレイでは参加者全員に数える） */
  midbosses: number;
  bosses: number;
  clear: boolean;
  /** 伝説を倒した */
  legendaryWon: boolean;
}

/** ラン終了時のコイン（01_game_design.md 8.3。失敗でももらえる） */
export function coinsForRun(cfg: ShopConfig, r: RunResult): number {
  const c = cfg.coins;
  return (
    Math.floor(r.seconds / c.perSecondsSurvived) +
    Math.floor(r.kills / c.perKills) +
    r.midbosses * c.midboss +
    r.bosses * c.boss +
    (r.clear ? c.clear : 0) +
    (r.legendaryWon ? c.legendary : 0)
  );
}

type UpgradeDef = ShopConfig['upgrades'][number];

export function upgradeLevel(save: Readonly<SaveData>, id: string): number {
  return save.upgrades[id] ?? 0;
}

/** 次のレベルの費用（基本の費用 × 次のレベル）。最大なら null */
export function nextCost(def: UpgradeDef, level: number): number | null {
  return level >= def.maxLevel ? null : def.baseCost * (level + 1);
}

/** 強化を1レベル買う。コインが足りない・最大なら false */
export function buyUpgrade(save: SaveData, cfg: ShopConfig, id: string): boolean {
  const def = cfg.upgrades.find((u) => u.id === id);
  if (!def) return false;
  const level = upgradeLevel(save, id);
  const cost = nextCost(def, level);
  if (cost === null || save.coins < cost) return false;
  save.coins -= cost;
  save.upgrades[id] = level + 1;
  return true;
}

/**
 * ポケモンを買う（解放の名前をセーブの解放済みに足す）。もう解放している・コインが足りない・売っていないなら false。
 * unlockName は playables.json の unlock（省略時はキー）
 */
export function buyPokemon(save: SaveData, cfg: ShopConfig, key: string, unlockName: string): boolean {
  const item = cfg.pokemon.find((p) => p.key === key);
  if (!item || save.unlocked.includes(unlockName) || save.coins < item.cost) return false;
  save.coins -= item.cost;
  save.unlocked.push(unlockName);
  return true;
}

/** すべての強化を戻し、使ったコインを全額返す。返したコインの数 */
export function refundAll(save: SaveData, cfg: ShopConfig): number {
  let total = 0;
  for (const def of cfg.upgrades) {
    const level = upgradeLevel(save, def.id);
    for (let l = 1; l <= level; l++) total += def.baseCost * l;
  }
  save.coins += total;
  save.upgrades = {};
  return total;
}

/** 強化をランに当てはめるための値（レベルごとの効果・増える回数） */
export interface PermanentBonus {
  /** 強化の id → レベル（効果 perLevel の強化だけ） */
  readonly levels: Readonly<Record<string, number>>;
  readonly revives: number;
  readonly rerolls: number;
  readonly bans: number;
  /** もらえるコインの増加（%） */
  readonly coinPct: number;
}

export function permanentBonus(save: Readonly<SaveData>, cfg: ShopConfig): PermanentBonus {
  const levels: Record<string, number> = {};
  let revives = 0;
  let rerolls = 0;
  let bans = 0;
  let coinPct = 0;
  for (const def of cfg.upgrades) {
    const level = Math.min(upgradeLevel(save, def.id), def.maxLevel);
    if (level <= 0) continue;
    const n = level * (def.amount ?? 1);
    if (def.grants === 'revives') revives += n;
    else if (def.grants === 'rerolls') rerolls += n;
    else if (def.grants === 'bans') bans += n;
    else if (def.grants === 'coinPct') coinPct += n;
    else levels[def.id] = level;
  }
  return { levels, revives, rerolls, bans, coinPct };
}

/** 前の版の強化（今の一覧に無いもの）を戻し、使ったコインを全額返す。返したコインの数 */
export function refundLegacy(save: SaveData, cfg: ShopConfig): number {
  let total = 0;
  for (const [id, level] of Object.entries(save.upgrades)) {
    if (cfg.upgrades.some((u) => u.id === id)) continue;
    const base = cfg.legacyBaseCosts[id] ?? 0;
    for (let l = 1; l <= level; l++) total += base * l;
    delete save.upgrades[id];
  }
  save.coins += total;
  return total;
}
