import { describe, expect, it } from 'vitest';
import { derivationsConfig, generated, movesConfig } from './index';

/**
 * 技進化（元 → 先）で ぶつり／とくしゅ を変えない（作者の決定 2026年11月3日。07 の161章）。
 * 原作で変化技（威力なし）の技は原作に分類が無いので、元か先が変化技の組は見ない（作者の決定: 今のまま）
 */
describe('技進化で ぶつり／とくしゅ が変わらない', () => {
  const classOf = (key: string): string => {
    const def = movesConfig.moves[key]!;
    if (def.damageClass) return def.damageClass;
    const name = generated.moves[key] ? key : (def.nameOf ?? key);
    return generated.moves[name]?.damageClass ?? 'status';
  };
  it('派生と固有技', () => {
    const bad: string[] = [];
    for (const d of [...derivationsConfig.derivations, ...derivationsConfig.unique]) {
      const a = classOf(d.from);
      const b = classOf(d.to);
      if (a === 'status' || b === 'status') continue;
      // カイリューは エアスラッシュ から げきりん を覚える（作者の決定。07 の184章）
      if (d.from === 'air-slash' && d.to === 'outrage') continue;
      if (a !== b) bad.push(`${d.from}（${a}）→ ${d.to}（${b}）`);
    }
    expect(bad).toEqual([]);
  });
});
