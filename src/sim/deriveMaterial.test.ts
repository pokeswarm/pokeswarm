import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { itemFits } from './systems/leveling';

/** 覚えている技の派生の材料は、タイプが違っても候補に出る（07 の231章） */
describe('派生の材料が候補に出る', () => {
  const fits = (region: string, pokemon: string, item: string, moves: string[]): boolean => {
    const rules = buildSimRules(region);
    const lo = playableLoadout(rules, pokemon);
    const i = rules.items.findIndex((x) => x.key === item);
    return itemFits(rules, { unlockedItems: null, line: lo.line, species: lo.species, items: [], types: lo.types, moveTypes: lo.moveTypes, moves: moves.map((m) => ({ move: moveIndexOf(rules, m) })) }, i);
  };

  it.each([
    ['totodile', 'black-glasses', 'scratch'],
    ['swinub', 'hard-stone', 'ice-fang'],
    ['miltank', 'hard-stone', 'body-slam'],
  ])('%s は %s を、元の技（%s）を覚えているときだけ候補に出す', (pokemon, item, from) => {
    expect(fits('johto', pokemon, item, [from])).toBe(true);
    expect(fits('johto', pokemon, item, [])).toBe(false);
  });

  it('ほかの系統の派生の材料は出さない', () => {
    // のしかかり → ころがる はミルタンクの派生。同じ のしかかり を覚えていても、ほかの系統に かたいいし は出ない
    expect(fits('johto', 'chikorita', 'hard-stone', ['body-slam'])).toBe(false);
  });

  it.each(['kanto', 'johto', 'hoenn'])('%s: 系統の派生の材料は、元の技を覚えていればどの系統にも出る', (region) => {
    const rules = buildSimRules(region);
    const stuck: string[] = [];
    for (const d of rules.derivations) {
      if (d.line === null || d.item === -1) continue;
      const lo = rules.lines?.[d.line];
      if (!lo) continue;
      const types = [...(lo.types ?? [])];
      const ok = rules.species.some((_, species) =>
        itemFits(rules, { unlockedItems: null, line: d.line!, species, items: [], types, moveTypes: [...lo.moveTypes], moves: [{ move: d.from }] }, d.item),
      );
      if (!ok) stuck.push(`${d.line}: ${rules.moves[d.from]!.key} → ${rules.moves[d.to]!.key}（${rules.items[d.item]!.key}）`);
    }
    expect(stuck).toEqual([]);
  });
});
