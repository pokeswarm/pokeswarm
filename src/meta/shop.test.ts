import { describe, expect, it } from 'vitest';
import { shopConfig } from '../data';
import type { ShopConfig } from '../data/schema';
import { Simulation } from '../sim/simulation';
import { testRules } from '../sim/testRules';
import { emptyModifiers } from '../sim/upgrades';
import { banUpgrade } from '../sim/systems/leveling';
import { emptySave } from './saveData';
import { buyUpgrade, coinsForRun, nextCost, permanentBonus, refundAll, refundLegacy } from './shop';

const shop: ShopConfig = {
  coins: { perSecondsSurvived: 30, perKills: 100, midboss: 10, boss: 20, clear: 100, legendary: 150 },
  upgrades: [
    { id: 'max-hp', maxLevel: 5, baseCost: 100, perLevel: { maxHpPct: 4 } },
    { id: 'revive', maxLevel: 2, baseCost: 1000, grants: 'revives' },
    { id: 'ban', maxLevel: 5, baseCost: 200, grants: 'bans' },
    { id: 'greed', maxLevel: 5, baseCost: 200, grants: 'coinPct', amount: 10 },
  ],
  legacyBaseCosts: { attack: 150 },
};

describe('コイン', () => {
  it('生きていた時間・倒した数・中ボス・四天王・クリア・伝説で入る', () => {
    expect(coinsForRun(shop, { seconds: 1200, kills: 8000, midbosses: 8, bosses: 4, clear: true, legendaryWon: false })).toBe(40 + 80 + 80 + 80 + 100);
    expect(coinsForRun(shop, { seconds: 600, kills: 3000, midbosses: 4, bosses: 0, clear: false, legendaryWon: false })).toBe(20 + 30 + 40);
    // data/game/shop.json の値での目安: クリアで約1700、10分で失敗して約550
    expect(coinsForRun(shopConfig, { seconds: 1200, kills: 8000, midbosses: 8, bosses: 4, clear: true, legendaryWon: false })).toBe(600 + 400 + 200 + 200 + 300);
    expect(coinsForRun(shopConfig, { seconds: 600, kills: 3000, midbosses: 4, bosses: 0, clear: false, legendaryWon: false })).toBe(300 + 150 + 100);
  });
});

describe('フレンドリィショップ', () => {
  it('費用は 基本の費用 × 次のレベル。足りないと買えず、最大なら買えない', () => {
    const save = emptySave();
    save.coins = 250;
    expect(buyUpgrade(save, shop, 'max-hp')).toBe(true);
    expect(save.coins).toBe(150);
    expect(nextCost(shop.upgrades[0]!, 1)).toBe(200);
    expect(buyUpgrade(save, shop, 'max-hp')).toBe(false);
    save.coins = 10000;
    while (buyUpgrade(save, shop, 'max-hp'));
    expect(save.upgrades['max-hp']).toBe(5);
    expect(nextCost(shop.upgrades[0]!, 5)).toBeNull();
  });

  it('払い戻しは、使ったコインを全額返して強化を戻す', () => {
    const save = emptySave();
    save.coins = 100 + 200 + 1000;
    buyUpgrade(save, shop, 'max-hp');
    buyUpgrade(save, shop, 'max-hp');
    buyUpgrade(save, shop, 'revive');
    expect(save.coins).toBe(0);
    expect(refundAll(save, shop)).toBe(1300);
    expect(save.coins).toBe(1300);
    expect(save.upgrades).toEqual({});
  });

  it('強化の効果と、増える回数（復活・除外）', () => {
    const save = emptySave();
    save.upgrades = { 'max-hp': 2, revive: 1, ban: 3, greed: 2 };
    expect(permanentBonus(save, shop)).toEqual({ levels: { 'max-hp': 2 }, revives: 1, rerolls: 0, bans: 3, coinPct: 20 });
  });

  it('前の版の強化（今の一覧に無いもの）は、使ったコインを全額返して消す', () => {
    const save = emptySave();
    save.upgrades = { attack: 2, 'max-hp': 1 };
    expect(refundLegacy(save, shop)).toBe(150 + 300);
    expect(save.coins).toBe(450);
    expect(save.upgrades).toEqual({ 'max-hp': 1 });
  });

  it('永続強化の効果は、持ち物・パッシブと一緒にステータスに足す', () => {
    const sim = new Simulation({ tickRate: 30, seed: 1, rules: testRules() });
    const permanent = emptyModifiers(4);
    permanent.maxHpPct = 8;
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, permanent });
    expect(p.maxHp).toBe(108);
    expect(p.hp).toBe(108);
  });
});

describe('候補の除外（BAN）', () => {
  it('除外すると回数を1つ使い、その候補だけ引き直し、そのランでは二度と出ない', () => {
    const rules = testRules({
      leveling: { offerCount: 3 },
      passives: ['a', 'b', 'c', 'd', 'e'].map((key) => ({ key, maxLevel: 5, consumable: false, perLevel: emptyModifiers(4) })),
    });
    const sim = new Simulation({ tickRate: 30, seed: 3, rules });
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, bans: 1 });
    sim.world.pendingLevelUps = 1;
    sim.step([]);
    const before = [...sim.world.levelUp!.offers.get(1)!];
    const target = before[0]!;
    banUpgrade(sim.world, 1, 0);
    const after = sim.world.levelUp!.offers.get(1)!;
    expect(p.bans).toBe(0);
    expect(after[0]).not.toEqual(target);
    expect(after.slice(1)).toEqual(before.slice(1));
    // 回数が無ければ除外できない
    banUpgrade(sim.world, 1, 1);
    expect(sim.world.levelUp!.offers.get(1)!).toEqual(after);
    // 何度引き直しても、除外したものは出ない
    for (let k = 0; k < 30; k++) {
      p.rerolls = 1;
      sim.step([{ type: 'rerollUpgrades', playerId: 1 }]);
      expect(sim.world.levelUp!.offers.get(1)!).not.toContainEqual(target);
    }
  });
});
