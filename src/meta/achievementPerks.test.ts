import { describe, expect, it } from 'vitest';
import { achievementsConfig, playablesConfig, shopConfig, unlocksConfig } from '../data';
import { applyOffer, makeOffers } from '../sim/systems/leveling';
import { buildSimRules, playableLoadout } from '../data/simRules';
import { Simulation } from '../sim/simulation';
import { testRules } from '../sim/testRules';
import { emptyModifiers } from '../sim/upgrades';
import { achievementPerks, regionAchieved } from './achievementPerks';
import { applyProgress } from './progress';
import { startItemChoices } from './loadoutOptions';
import { emptySave } from './saveData';
import { backfillBought, buyPokemon } from './shop';

/** 実績の報酬（作者の決定。07 23・24章） */
describe('実績の報酬', () => {
  it('最初はタイプのアイテムと基本のステータスだけ。石で進化するポケモンの実績で進化の石が解放される', () => {
    const start = achievementPerks(achievementsConfig, []);
    expect(start.items.has('charcoal')).toBe(true);
    expect(start.items.has('fire-stone')).toBe(false);
    expect(start.items.has('lucky-egg')).toBe(false);
    const after = achievementPerks(achievementsConfig, ['unlock-arcanine', 'first-clear']);
    expect(after.items.has('fire-stone')).toBe(true);
    expect(after.items.has('lucky-egg')).toBe(true);
  });

  it('カントーで解放するガーディ・ピカチュウ・ナゾノクサ・ヒトデマン・イワークは、進化の石も一緒に解放する（07 の178章）', () => {
    for (const [stat, id, item] of [
      ['bossDefeated.arcanine', 'unlock-arcanine', 'fire-stone'],
      ['bossDefeated.raichu', 'unlock-raichu', 'thunder-stone'],
      ['bossDefeated.vileplume', 'unlock-vileplume', 'leaf-stone'],
      ['bossDefeated.starmie', 'unlock-starmie', 'water-stone'],
      ['bossDefeated.onix', 'unlock-onix', 'moon-stone'],
    ] as const) {
      const a = achievementsConfig.achievements.find((x) => x.id === id)!;
      expect(a.reward?.pokemon, id).toBeDefined();
      expect(a.reward?.item, id).toBe(item);
      const save = emptySave();
      save.stats = { [stat]: 99 };
      applyProgress(save, achievementsConfig, unlocksConfig);
      expect(save.achievements).toContain(id);
      expect(achievementPerks(achievementsConfig, save.achievements).items.has(item), id).toBe(true);
    }
  });

  it('でんきだま は、ピカチュウでクリアすると解放される（レベル30では出ない。07 の178章）', () => {
    const save = emptySave();
    save.stats = { 'bestLevel.pikachu': 60 };
    applyProgress(save, achievementsConfig, unlocksConfig);
    expect(save.achievements).not.toContain('pikachu-light-ball');
    save.stats['clears.pikachu'] = 1;
    applyProgress(save, achievementsConfig, unlocksConfig);
    expect(save.achievements).toContain('pikachu-light-ball');
  });

  it('ジョウトは ショップでタマゴを買うと進化の道具が解放され、ゴーストが進化できる（前のセーブも。07 の178章）', () => {
    const owned = (save: ReturnType<typeof emptySave>) => achievementPerks(achievementsConfig, regionAchieved(achievementsConfig, save.achievements, 'johto'), 'johto').items;
    const save = emptySave();
    save.coins = 5000;
    save.stats.shopSpent = 50000;
    applyProgress(save, achievementsConfig, unlocksConfig);
    expect(owned(save).has('linking-cord')).toBe(false);
    expect(buyPokemon(save, shopConfig, 'egg', 'egg', 'johto')).toBe(true);
    applyProgress(save, achievementsConfig, unlocksConfig);
    for (const it of ['linking-cord', 'thunder-stone', 'moon-stone', 'water-stone', 'fire-stone']) expect(owned(save).has(it), it).toBe(true);
    // ほかの地方には効かない
    expect(achievementPerks(achievementsConfig, regionAchieved(achievementsConfig, save.achievements, 'hoenn'), 'hoenn').items.has('linking-cord')).toBe(false);
    // タマゴを買った記録が無い前のセーブ
    const old = emptySave();
    old.unlocked = ['johto:egg'];
    const unlockOf = (key: string): string => playablesConfig.pokemon[key]?.unlock ?? key;
    expect(backfillBought(old, shopConfig, unlockOf)).toBe(true);
    applyProgress(old, achievementsConfig, unlocksConfig);
    expect(owned(old).has('linking-cord')).toBe(true);
  });

  it('ジョウトの でんきだま は、ピチューで でんどういりすると解放され、ピカチュウの姿でだけ候補に出て、持つと かみなりのいし は出ない（07 の180.5章）', () => {
    const save = emptySave();
    save.stats = { 'johto:bestLevel.pichu': 60 };
    applyProgress(save, achievementsConfig, unlocksConfig);
    expect(save.achievements).not.toContain('johto-light-ball');
    save.stats['johto:clears.pichu'] = 1;
    applyProgress(save, achievementsConfig, unlocksConfig);
    const johto = regionAchieved(achievementsConfig, [...save.achievements, 'johto-stones'], 'johto');
    const perks = achievementPerks(achievementsConfig, johto, 'johto');
    expect(perks.items.has('light-ball')).toBe(true);
    // カントーの でんきだま には効かない
    expect(achievementPerks(achievementsConfig, regionAchieved(achievementsConfig, save.achievements, 'kanto')).items.has('light-ball')).toBe(false);

    const rules = buildSimRules('johto');
    const item = (key: string): number => rules.items.findIndex((it) => it.key === key);
    const unlockedItems = new Set(rules.items.flatMap((it, i) => (perks.items.has(it.key) ? [i] : [])));
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    const lo = playableLoadout(rules, 'pichu');
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, types: lo.types, moveTypes: lo.moveTypes, moves: lo.moves, line: lo.line, species: lo.species, unlockedItems });
    const offered = (key: string): boolean => Array.from({ length: 200 }, () => makeOffers(sim.world, p)).flat().some((o) => o.kind === 'itemNew' && o.item === item(key));
    expect(offered('light-ball')).toBe(false);
    p.species = rules.species.findIndex((x) => x.key === 'pikachu');
    p.line = 'pikachu';
    expect(offered('light-ball')).toBe(true);
    p.items.push({ item: item('light-ball'), level: 1 });
    expect(offered('thunder-stone')).toBe(false);
  });

  it('カントーのヤドンは ヤドキングに進化しない（おうじゃのしるし はカントーで出ない。07 の180.5章）', () => {
    const ids = achievementsConfig.achievements.filter((a) => a.region === 'kanto').map((a) => a.id);
    expect(achievementPerks(achievementsConfig, ids, 'kanto').items.has('kings-rock')).toBe(false);
    const johto = achievementsConfig.achievements.filter((a) => a.region === 'johto').map((a) => a.id);
    expect(achievementPerks(achievementsConfig, johto, 'johto').items.has('kings-rock')).toBe(true);
  });

  it('つながりのヒモは、協力プレイで遊ぶか、1ランで中ボスを8体倒すと解放される', () => {
    for (const stats of [{ 'runs.coop': 1 }, { bestMidbosses: 8 }] as Record<string, number>[]) {
      const save = emptySave();
      save.stats = stats;
      applyProgress(save, achievementsConfig, unlocksConfig);
      expect(save.achievements).toContain('linking-cord');
    }
  });

  it('コインの報酬は、達成したときにもらえる', () => {
    const save = emptySave();
    save.stats = { uniqueMoves: 1 };
    const before = save.coins;
    applyProgress(save, achievementsConfig, unlocksConfig);
    expect(save.coins - before).toBe(1000);
  });

  it('解放していない持ち物は候補に出ず、持ち物の枠を増やすと7つ目も出る', () => {
    const item = (key: string) => ({ key, category: 'stat' as const, maxLevel: 5, consumable: false, perLevel: emptyModifiers(4) });
    const rules = testRules({ items: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(item), leveling: { offerCount: 8, maxItemSlots: 6 } });
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    const locked = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, moves: [], unlockedItems: new Set([0, 1]) });
    for (let k = 0; k < 20; k++) for (const o of makeOffers(sim.world, locked)) if (o.kind === 'itemNew') expect([0, 1]).toContain(o.item);
    const wide = sim.addPlayer({ id: 2, x: 0, y: 0, radius: 12, moveSpeed: 0, moves: [], extraItemSlots: 1 });
    for (let i = 0; i < 6; i++) applyOffer(sim.world, wide, { kind: 'itemNew', item: i });
    expect(makeOffers(sim.world, wide).some((o) => o.kind === 'itemNew')).toBe(true);
  });

  it('色違いの御三家を倒すと、その系統を色違いで遊べる', () => {
    const save = emptySave();
    save.stats = { 'bossDefeated.charizard': 1 };
    applyProgress(save, achievementsConfig, unlocksConfig);
    expect(achievementPerks(achievementsConfig, save.achievements).shiny.has('charmander')).toBe(true);
    expect(achievementPerks(achievementsConfig, save.achievements).shiny.has('squirtle')).toBe(false);
  });

  it('最初の持ち物の候補は、解放済みで、そのポケモンの候補に出るものだけ', () => {
    const save = emptySave();
    const fire = startItemChoices(save, 'charmander');
    expect(fire).toContain('charcoal');
    expect(fire).not.toContain('mystic-water');
    expect(fire).not.toContain('fire-stone');
    save.achievements = ['unlock-raichu', 'pikachu-light-ball'];
    expect(startItemChoices(save, 'pikachu')).toEqual(expect.arrayContaining(['thunder-stone', 'light-ball']));
    expect(startItemChoices(save, 'charmander')).not.toContain('light-ball');
  });
});
