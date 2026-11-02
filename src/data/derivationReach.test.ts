import { describe, expect, it } from 'vitest';
import { derivationsConfig, movesConfig } from './index';
import { moveMaxLevel, moveStatsAt } from './moveStrength';
import type { MoveDefData } from './schema';

/**
 * 技進化で届く距離が大きく縮まない（作者の指摘 2026年11月3日: 進化というより退化になる。07 の163章）。
 * 派生の Lv1 の届く距離が、元の技の最大の 6 割を下回らない。自分を中心に広がる技（周り全部・自分を中心にした四角）への派生は、
 * 届く距離ではなく広さで比べるので見ない（飛ぶ技 → 周りに広がる技 は、距離の代わりに周り全部に当たる）
 */
function reach(def: MoveDefData, s: Record<string, unknown>): number {
  const n = (k: string): number => (typeof s[k] === 'number' ? (s[k] as number) : 0);
  const p = def.pattern;
  if (p === 'melee') return def.frontBox ? (n('range') + n('size')) * def.frontBox.end : n('range') === 0 ? n('size') : n('range') + n('size');
  if (['sweep', 'spin', 'whip'].includes(p)) return n('range') + n('size');
  if (p === 'aura') return n('size');
  if (['nearest', 'facing', 'homing', 'cross', 'boomerang', 'bounce'].includes(p)) return n('speed') > 0 ? Math.min(n('range') || 9999, n('speed') * n('durationSeconds')) : n('range');
  return n('range');
}
const selfCentered = (def: MoveDefData): boolean => ['nova', 'pulse', 'weather', 'heal', 'rest', 'passive'].includes(def.pattern) || (!!def.frontBox && def.frontBox.start <= -0.9);

describe('技進化で届く距離が大きく縮まない', () => {
  it('派生の Lv1 の届く距離 ≥ 元の最大の 6 割', () => {
    const bad: string[] = [];
    for (const d of [...derivationsConfig.derivations, ...derivationsConfig.unique]) {
      const a = movesConfig.moves[d.from]!;
      const b = movesConfig.moves[d.to]!;
      if (selfCentered(b) || ['heal', 'rest', 'passive', 'weather'].includes(a.pattern)) continue;
      const ra = reach(a, moveStatsAt(a, moveMaxLevel(a)) as Record<string, unknown>);
      const rb = reach(b, moveStatsAt(b, 1) as Record<string, unknown>);
      if (rb < ra * 0.6) bad.push(`${d.from}（${Math.round(ra)}）→ ${d.to}（${Math.round(rb)}）`);
    }
    expect(bad).toEqual([]);
  });
});
