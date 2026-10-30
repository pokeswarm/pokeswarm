import { describe, expect, it } from 'vitest';
import { derivationsConfig, moveBalanceConfig, movesConfig } from '.';
import { moveMaxLevel, moveStatsAt, moveTotalRange, moveTotalStrength } from './moveStrength';

const tierOf = (key: string): 'base' | 'derived' | 'unique' =>
  moveBalanceConfig.tierOverrides[key] ??
  (derivationsConfig.unique.some((d) => d.to === key) ? 'unique' : derivationsConfig.derivations.some((d) => d.to === key) ? 'derived' : 'base');
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
      const want =
        moveBalanceConfig.tiers[tierOf(key)].max *
        (def.region && tierOf(key) === 'unique' ? (moveBalanceConfig.regionTierScale[def.region] ?? 1) : 1) *
        (moveBalanceConfig.strengthScale[key] ?? 1);
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

describe('進化しても見た目の量が減らない（作者の決定。07 22.3）', () => {
  it('同じ出し方に進化するとき、進化した技の Lv1 は、元の技の最大より 射程・大きさ・貫通・数・持続 が下がらず再使用も延びない', () => {
    for (const d of [...derivationsConfig.derivations, ...derivationsConfig.unique]) {
      if (exempt(d.to) || exempt(d.from)) continue;
      const fromDef = movesConfig.moves[d.from]!;
      const toDef = movesConfig.moves[d.to]!;
      const a = moveStatsAt(fromDef, moveMaxLevel(fromDef));
      const b = moveStatsAt(toDef, 1);
      const num = (v: unknown): number => (v === 'infinite' ? Infinity : (v as number));
      const label = `${d.from} → ${d.to}`;
      // 出し方が変わるもの（連射 → 流れ、ひのこ → かえんほうしゃ など）は、射程・大きさ・数の意味が違うので比べない
      // （作者の決定 2026年10月23日: 射程も同じ出し方のときだけ。ばらまく弾の射程に、前へ噴き出す炎の長さをそろえると長すぎた）
      if (fromDef.pattern === toDef.pattern) {
        expect(num(b.range), `${label} の射程`).toBeGreaterThanOrEqual(num(a.range));
        expect(num(b.size), `${label} の大きさ`).toBeGreaterThanOrEqual(num(a.size));
        expect(num(b.pierce), `${label} の貫通`).toBeGreaterThanOrEqual(num(a.pierce));
        expect(num(b.count), `${label} の数`).toBeGreaterThanOrEqual(num(a.count));
        expect(num(b.durationSeconds), `${label} の持続`).toBeGreaterThanOrEqual(num(a.durationSeconds));
        // 重い一撃（ギガインパクト）は、威力が高い代わりに再使用が長くてよい（作者の決定 2026年10月23日）
        if (!moveBalanceConfig.heavyHitters.includes(d.to)) expect(num(b.cooldownSeconds), `${label} の再使用`).toBeLessThanOrEqual(num(a.cooldownSeconds));
      }
    }
  });
});
