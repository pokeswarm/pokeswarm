import { describe, expect, it } from 'vitest';
import { derivationsConfig, movesConfig } from '.';
import { moveStrengthRange } from './moveStrength';

describe('派生の強さの決まり（作者の決定）', () => {
  it('派生技は Lv1 でも元の技の最大より強く、固有技は派生技の最大より強い', () => {
    for (const d of [...derivationsConfig.derivations, ...derivationsConfig.unique]) {
      const from = moveStrengthRange(movesConfig.moves[d.from]!);
      const to = moveStrengthRange(movesConfig.moves[d.to]!);
      expect(to.first, `${d.from} → ${d.to}`).toBeGreaterThan(from.max);
    }
  });
});
