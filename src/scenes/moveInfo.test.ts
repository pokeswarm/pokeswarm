import { describe, expect, it } from 'vitest';
import { regionsConfig } from '../data';
import { buildSimRules } from '../data/simRules';
import { moveInfoLines, moveStatRows } from './moveInfo';

describe('わざ図鑑の技の説明（07 の263章）', () => {
  it('どの地方のどの技でも、文に埋め残しや NaN が無い', () => {
    const dump = process.env.MOVE_INFO_DUMP === '1';
    for (const region of regionsConfig.regions) {
      const rules = buildSimRules(region.id);
      for (const def of rules.moves) {
        const lines = [...moveInfoLines(rules, def), ...moveStatRows(def).map((r) => r.join(' '))];
        for (const l of lines) expect(l, `${region.id} ${def.key}: ${l}`).not.toMatch(/\{|\}|undefined|NaN|null/);
        if (dump && region.id === 'hoenn') console.log(`${def.key}: ${lines.join(' / ')}`);
      }
    }
  });
});
