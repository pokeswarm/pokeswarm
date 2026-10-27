import { describe, expect, it } from 'vitest';
import { achievementsConfig, shopConfig, unlocksConfig } from '../data';
import { achievementPerks, regionAchieved } from './achievementPerks';
import type { AchievementsConfig, UnlocksConfig } from '../data/schema';
import { applyProgress, isPlayableUnlocked } from './progress';
import { regionStatKey, regionStats, regionUpgradesOf } from './regionScope';
import { emptySave, parseSave } from './saveData';
import { backfillShopSpent, buyPokemon, buyUpgrade, permanentBonus, refundAll, refundableCoins, shopRegionOpen, upgradeLevel } from './shop';

const ORDER = ['kanto', 'johto', 'hoenn'];
const might = shopConfig.upgrades.find((u) => u.id === 'might')!;

describe('地方ごとの記録・強化・ショップ（02 の17章）', () => {
  it('前の形のセーブ（regionUpgrades が無い）も、ほかの値を変えずに読める', () => {
    const old = { version: 1, updatedAt: 5, coins: 1234, upgrades: { might: 3 }, unlocked: ['onix'], stats: { kills: 99, clears: 2 }, achievements: ['first-clear'], discoveries: ['flamethrower'] };
    const save = parseSave(old)!;
    expect(save).not.toBeNull();
    expect(save.regionUpgrades).toEqual({});
    expect({ ...save, regionUpgrades: undefined }).toEqual({ ...old, regionUpgrades: undefined });
  });

  it('記録の名前: カントーはそのまま、ほかの地方は頭に "<地方>:"。コインの合計だけは共通', () => {
    expect(regionStatKey('kanto', 'kills')).toBe('kills');
    expect(regionStatKey('johto', 'kills')).toBe('johto:kills');
    expect(regionStatKey('johto', 'coinsEarned')).toBe('coinsEarned');
    const stats = { kills: 10, 'johto:kills': 3, 'johto:clears.cyndaquil': 1, coinsEarned: 500 };
    expect(regionStats(stats, 'johto')).toEqual({ kills: 3, 'clears.cyndaquil': 1, coinsEarned: 500 });
    expect(regionStats(stats, 'kanto').kills).toBe(10);
  });

  it('ジョウトのショップは、カントーのショップで 50000 コイン使うまで開かない（使った合計。払い戻しでは減らない）', () => {
    const save = emptySave(0, 10_000_000);
    expect(shopRegionOpen(save, shopConfig, 'johto')).toBe(false);
    expect(buyUpgrade(save, shopConfig, 'might', 'johto')).toBe(false);
    while (save.stats.shopSpent === undefined || save.stats.shopSpent < 50000) {
      const id = shopConfig.upgrades.find((u) => upgradeLevel(save, u.id) < u.maxLevel)!.id;
      expect(buyUpgrade(save, shopConfig, id)).toBe(true);
    }
    expect(shopRegionOpen(save, shopConfig, 'johto')).toBe(true);
    refundAll(save, shopConfig, 'kanto', ORDER);
    expect(shopRegionOpen(save, shopConfig, 'johto')).toBe(true);
  });

  it('ジョウトの強化はカントーの強化と別。ランにはその地方の強化だけを使う', () => {
    const save = emptySave(0, 1_000_000);
    save.stats.shopSpent = 50000;
    expect(buyUpgrade(save, shopConfig, 'might', 'johto')).toBe(true);
    expect(buyUpgrade(save, shopConfig, 'might', 'johto')).toBe(true);
    expect(upgradeLevel(save, 'might', 'johto')).toBe(2);
    expect(upgradeLevel(save, 'might')).toBe(0);
    expect(save.upgrades).toEqual({});
    expect(regionUpgradesOf(save, 'johto')).toEqual({ might: 2 });
    expect(permanentBonus(save, shopConfig, 'johto').levels).toEqual({ might: 2 });
    expect(permanentBonus(save, shopConfig).levels).toEqual({});
    expect(save.stats['johto:shopSpent']).toBe(might.baseCost * 3);
  });

  it('カントーで払い戻すとジョウトも戻る。ジョウトで払い戻してもカントーは戻らない', () => {
    const save = emptySave(0, 1_000_000);
    save.stats.shopSpent = 50000;
    buyUpgrade(save, shopConfig, 'might');
    buyUpgrade(save, shopConfig, 'might', 'johto');
    expect(refundableCoins(save, shopConfig, 'johto', ORDER)).toBe(might.baseCost);
    expect(refundAll(save, shopConfig, 'johto', ORDER)).toBe(might.baseCost);
    expect(upgradeLevel(save, 'might')).toBe(1);
    buyUpgrade(save, shopConfig, 'might', 'johto');
    expect(refundableCoins(save, shopConfig, 'kanto', ORDER)).toBe(might.baseCost * 2);
    refundAll(save, shopConfig, 'kanto', ORDER);
    expect(upgradeLevel(save, 'might')).toBe(0);
    expect(upgradeLevel(save, 'might', 'johto')).toBe(0);
    // 全部払い戻したので、使ったコインは全部戻る
    expect(save.coins).toBe(1_000_000);
  });

  it('前のセーブのショップで使ったコインは、今の強化と買ったポケモンから数える。0 なら書かない', () => {
    const blank = emptySave();
    expect(backfillShopSpent(blank, shopConfig, (k) => k)).toBe(false);
    expect(blank.stats).toEqual({});
    const save = emptySave();
    save.upgrades = { might: 2 };
    const sale = shopConfig.pokemon.find((p) => p.region === 'kanto');
    if (sale) save.unlocked.push(sale.key);
    expect(backfillShopSpent(save, shopConfig, (k) => k)).toBe(true);
    expect(save.stats.shopSpent).toBe(might.baseCost * 3 + (sale?.cost ?? 0));
    expect(backfillShopSpent(save, shopConfig, (k) => k)).toBe(false);
  });

  it('ジョウトで派生技を作る・ジムリーダー8人で、ジョウトのランにポイントマックス・メトロノームが出る（カントーの実績では出ない。07 の76章）', () => {
    const unlocks: UnlocksConfig = { initial: [], unlocks: [] };
    const kantoOnly = emptySave();
    kantoOnly.stats.derivations = 1;
    kantoOnly.stats.bestMidbosses = 8;
    applyProgress(kantoOnly, achievementsConfig, unlocks);
    const kantoItems = achievementPerks(achievementsConfig, regionAchieved(achievementsConfig, kantoOnly.achievements, 'johto')).items;
    expect([kantoItems.has('pp-max'), kantoItems.has('metronome')]).toEqual([false, false]);
    const save = emptySave();
    save.stats['johto:derivations'] = 1;
    save.stats['johto:bestMidbosses'] = 8;
    expect(applyProgress(save, achievementsConfig, unlocks).achievements).toEqual(['johto-first-derivation', 'johto-reach-elite-four']);
    const items = achievementPerks(achievementsConfig, regionAchieved(achievementsConfig, save.achievements, 'johto')).items;
    expect([items.has('pp-max'), items.has('metronome')]).toEqual([true, true]);
  });

  it('解放は地方ごと: カントーで解放したポケモンはジョウトでは解放していない。ジョウトのショップの買い物はジョウトの解放（07 の66.1）', () => {
    const save = emptySave(0, 1_000_000);
    save.unlocked.push('onix');
    expect(isPlayableUnlocked(save, unlocksConfig, 'onix', undefined)).toBe(true);
    expect(isPlayableUnlocked(save, unlocksConfig, 'onix', undefined, 'johto')).toBe(false);
    save.stats.shopSpent = 50000;
    expect(buyPokemon(save, shopConfig, 'egg', 'egg')).toBe(true);
    expect(save.unlocked).toContain('johto:egg');
    expect(isPlayableUnlocked(save, unlocksConfig, 'egg', undefined, 'johto')).toBe(true);
    expect(isPlayableUnlocked(save, unlocksConfig, 'egg', undefined)).toBe(false);
    // 最初から遊べるポケモンはどの地方でも
    expect(isPlayableUnlocked(save, unlocksConfig, 'cyndaquil', undefined, 'johto')).toBe(true);
  });

  it('実績はその地方のランの記録だけで判定する', () => {
    const cfg: AchievementsConfig = {
      initialPokemon: ['charmander'],
      initialItems: ['x-attack'],
      startItem: { clears: 1 },
      achievements: [
        { id: 'kanto-clear', region: 'kanto', hidden: false, condition: { stat: 'clears', atLeast: 1 } },
        { id: 'johto-clear', region: 'johto', hidden: false, condition: { stat: 'clears', atLeast: 1 } },
      ],
    };
    const unlocks: UnlocksConfig = { initial: ['charmander'], unlocks: [] };
    const save = emptySave();
    save.stats['johto:clears'] = 1;
    expect(applyProgress(save, cfg, unlocks).achievements).toEqual(['johto-clear']);
    save.stats.clears = 1;
    expect(applyProgress(save, cfg, unlocks).achievements).toEqual(['kanto-clear']);
  });
});
