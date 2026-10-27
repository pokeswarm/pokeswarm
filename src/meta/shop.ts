import type { ShopConfig } from '../data/schema';
import { addStat, type SaveData } from './saveData';
import { meets } from './progress';
import { HOME_REGION, mutableRegionUpgrades, regionStatKey, regionUnlockKey, regionUpgradesOf } from './regionScope';

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

/** その地方の強化のレベル（省略時はカントー） */
export function upgradeLevel(save: Readonly<SaveData>, id: string, region = HOME_REGION): number {
  return regionUpgradesOf(save, region)[id] ?? 0;
}

/** その地方のショップが開いているか（shop.json の regions の解放の条件。書いていない地方は開いている） */
export function shopRegionOpen(save: Readonly<SaveData>, cfg: ShopConfig, region: string): boolean {
  const unlock = cfg.regions[region]?.unlock;
  return !unlock || meets(save.stats, unlock);
}

/** その地方のショップで使ったコインの合計（記録 shopSpent。払い戻しでは減らさない）を足す */
function addSpent(save: SaveData, region: string, coins: number): void {
  addStat(save, regionStatKey(region, 'shopSpent'), coins);
}

/** 強化に今使っているコイン（払い戻すと返る数） */
function investedIn(upgrades: Readonly<Record<string, number>>, cfg: ShopConfig): number {
  let total = 0;
  for (const def of cfg.upgrades) {
    const level = upgrades[def.id] ?? 0;
    for (let l = 1; l <= level; l++) total += def.baseCost * l;
  }
  return total;
}

/** 次のレベルの費用（基本の費用 × 次のレベル）。最大なら null */
export function nextCost(def: UpgradeDef, level: number): number | null {
  return level >= def.maxLevel ? null : def.baseCost * (level + 1);
}

/** その地方の強化を1レベル買う（省略時はカントー）。コインが足りない・最大・ショップが開いていないなら false */
export function buyUpgrade(save: SaveData, cfg: ShopConfig, id: string, region = HOME_REGION): boolean {
  const def = cfg.upgrades.find((u) => u.id === id);
  if (!def || !shopRegionOpen(save, cfg, region)) return false;
  const level = upgradeLevel(save, id, region);
  const cost = nextCost(def, level);
  if (cost === null || save.coins < cost) return false;
  save.coins -= cost;
  mutableRegionUpgrades(save, region)[id] = level + 1;
  addSpent(save, region, cost);
  return true;
}

/**
 * ポケモンを買う（解放の名前をセーブの解放済みに足す）。もう解放している・コインが足りない・売っていないなら false。
 * unlockName は playables.json の unlock（省略時はキー）
 */
export function buyPokemon(save: SaveData, cfg: ShopConfig, key: string, unlockName: string): boolean {
  const item = cfg.pokemon.find((p) => p.key === key);
  // 解放はその地方のもの（07 の66.1）
  const name = regionUnlockKey(item?.region ?? HOME_REGION, unlockName);
  if (!item || save.unlocked.includes(name) || save.coins < item.cost || !shopRegionOpen(save, cfg, item.region)) return false;
  save.coins -= item.cost;
  save.unlocked.push(name);
  addSpent(save, item.region, item.cost);
  return true;
}

/** 払い戻す地方: その地方と、order（regions.json の並び）でそれより後の地方（作者の決定 07 の48.4） */
function refundRegions(region: string, order: readonly string[]): string[] {
  const i = order.indexOf(region);
  return i < 0 ? [region] : order.slice(i);
}

/** 払い戻すと返るコイン（その地方と、後の地方の強化） */
export function refundableCoins(save: Readonly<SaveData>, cfg: ShopConfig, region = HOME_REGION, order: readonly string[] = [HOME_REGION]): number {
  return refundRegions(region, order).reduce((sum, r) => sum + investedIn(regionUpgradesOf(save, r), cfg), 0);
}

/**
 * 前のセーブ（ショップで使ったコインの合計 shopSpent を数える前）: 今のカントーの強化と、買ったポケモンの値段から数える。
 * 0 のときは書かない（何も進んでいない空のセーブを、進み具合のあるデータに見せないため）。unlockOf はポケモンの解放の名前
 */
export function backfillShopSpent(save: SaveData, cfg: ShopConfig, unlockOf: (key: string) => string): boolean {
  if (save.stats.shopSpent !== undefined) return false;
  const pokemon = cfg.pokemon.filter((p) => p.region === HOME_REGION && save.unlocked.includes(unlockOf(p.key))).reduce((sum, p) => sum + p.cost, 0);
  const total = investedIn(save.upgrades, cfg) + pokemon;
  if (total <= 0) return false;
  save.stats.shopSpent = total;
  return true;
}

/**
 * その地方（省略時はカントー）と、order でそれより後の地方の強化を全部戻し、使ったコインを全額返す。返したコインの数。
 * カントーで払い戻すと、ジョウト以降の地方も払い戻す（作者の決定 07 の48.4）
 */
export function refundAll(save: SaveData, cfg: ShopConfig, region = HOME_REGION, order: readonly string[] = [HOME_REGION]): number {
  let total = 0;
  for (const r of refundRegions(region, order)) {
    total += investedIn(regionUpgradesOf(save, r), cfg);
    if (r === HOME_REGION) save.upgrades = {};
    else delete save.regionUpgrades[r];
  }
  save.coins += total;
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

/** その地方（省略時はカントー）の強化をランに当てはめる値 */
export function permanentBonus(save: Readonly<SaveData>, cfg: ShopConfig, region = HOME_REGION): PermanentBonus {
  const levels: Record<string, number> = {};
  let revives = 0;
  let rerolls = 0;
  let bans = 0;
  let coinPct = 0;
  for (const def of cfg.upgrades) {
    const level = Math.min(upgradeLevel(save, def.id, region), def.maxLevel);
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
  // 値段を変えた強化は、前の値段で返してレベルを戻す（tag ごとに1回だけ）
  const rp = cfg.repriced;
  if (rp && !save.stats[`shopRepriced.${rp.tag}`]) {
    for (const [id, base] of Object.entries(rp.baseCosts)) {
      const level = save.upgrades[id] ?? 0;
      for (let l = 1; l <= level; l++) total += base * l;
      delete save.upgrades[id];
    }
    save.stats[`shopRepriced.${rp.tag}`] = 1;
  }
  for (const [id, level] of Object.entries(save.upgrades)) {
    if (cfg.upgrades.some((u) => u.id === id)) continue;
    const base = cfg.legacyBaseCosts[id] ?? 0;
    for (let l = 1; l <= level; l++) total += base * l;
    delete save.upgrades[id];
  }
  save.coins += total;
  return total;
}
