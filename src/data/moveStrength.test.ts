import { describe, expect, it } from 'vitest';
import { derivationsConfig, moveBalanceConfig, movesConfig } from '.';
import { moveMaxLevel, moveStatsAt, moveTotalRange, moveTotalStrength } from './moveStrength';

const tierOf = (key: string): 'base' | 'derived' | 'unique' =>
  derivationsConfig.unique.some((d) => d.to === key) ? 'unique' : derivationsConfig.derivations.some((d) => d.to === key) ? 'derived' : 'base';
const exempt = (key: string): boolean => moveBalanceConfig.exempt.includes(key);

describe('技の強さのそろえ方（作者の決定。07 16.2）', () => {
  it('派生技は Lv1 でも元の技の最大より強く、固有技は派生技の最大より強い（総合の強さで比べる）', () => {
    for (const d of [...derivationsConfig.derivations, ...derivationsConfig.unique]) {
      if (exempt(d.to) || exempt(d.from)) continue;
      const from = moveTotalRange(movesConfig.moves[d.from]!);
      const to = moveTotalRange(movesConfig.moves[d.to]!);
      expect(to.first, `${d.from} → ${d.to}`).toBeGreaterThan(from.max);
    }
  });

  it('最大レベルの総合の強さは、段階ごとの目安の幅に入る', () => {
    const tol = moveBalanceConfig.tolerancePct / 100;
    for (const [key, def] of Object.entries(movesConfig.moves)) {
      if (exempt(key)) continue;
      const want = moveBalanceConfig.tiers[tierOf(key)].max;
      const got = moveTotalRange(def).max;
      expect(got, key).toBeGreaterThanOrEqual(want * (1 - tol));
      expect(got, key).toBeLessThanOrEqual(want * (1 + tol));
    }
  });

  it('どのレベルでも、前のレベルより強くなる', () => {
    for (const [key, def] of Object.entries(movesConfig.moves)) {
      if (exempt(key)) continue;
      let prev = 0;
      for (let level = 1; level <= moveMaxLevel(def); level++) {
        const s = moveStatsAt(def, level);
        expect(s.power as number, `${key} Lv${level} の威力`).toBeGreaterThan(0);
        const v = moveTotalStrength(def, s);
        expect(v, `${key} Lv${level}`).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }
  });
});
