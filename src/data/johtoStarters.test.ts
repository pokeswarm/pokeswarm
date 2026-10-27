import { describe, expect, it } from 'vitest';
import { isUniqueDerivation } from '../sim/upgrades';
import { playerSpriteKeys, regionsConfig } from './index';
import { buildSimRules } from './simRules';

describe('ジョウトの御三家（07 の48.3・66.3）', () => {
  const rules = buildSimRules('johto');
  const move = (key: string): number => rules.moves.findIndex((m) => m.key === key);
  const chains = [
    ['cyndaquil', 'ember', 'charcoal', 'flame-wheel', 'eruption'],
    ['chikorita', 'sleep-powder', 'miracle-seed', 'synthesis', 'solar-beam'],
    ['totodile', 'scratch', 'mystic-water', 'bite', 'crunch'],
  ] as const;

  it('ジョウトで遊べるのは御三家。最後の姿までプレイヤーのドット絵がある', () => {
    expect(regionsConfig.regions.find((r) => r.id === 'johto')!.playables).toEqual(chains.map((c) => c[0]));
    for (const k of ['cyndaquil', 'quilava', 'typhlosion', 'chikorita', 'bayleef', 'meganium', 'totodile', 'croconaw', 'feraligatr']) expect(playerSpriteKeys.has(k)).toBe(true);
  });

  it('最初の技 ＋ タイプの持ち物 → 派生技（その系統だけ）→ 同じ持ち物 → 固有技', () => {
    for (const [line, first, item, derived, unique] of chains) {
      const itemNo = rules.items.findIndex((i) => i.key === item);
      const d1 = rules.derivations.find((d) => d.from === move(first) && d.to === move(derived))!;
      const d2 = rules.derivations.find((d) => d.from === move(derived) && d.to === move(unique))!;
      expect([d1.line, d1.item, isUniqueDerivation(d1)]).toEqual([line, itemNo, false]);
      expect([d2.line, d2.item, isUniqueDerivation(d2)]).toEqual([line, itemNo, true]);
    }
  });
});
