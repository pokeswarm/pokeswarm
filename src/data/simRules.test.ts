import { describe, expect, it } from 'vitest';
import { derivationsConfig, generated, movesConfig, playablesConfig } from './index';
import { buildSimRules, playableLoadout } from './simRules';

describe('data/ から組み立てたシミュレーションの定義', () => {
  const rules = buildSimRules();

  it('技はすべて PokeAPI のタイプ・分類と結び付き、レベルの表がそろう', () => {
    expect(rules.moves.map((m) => m.key).sort()).toEqual(Object.keys(movesConfig.moves).sort());
    const ember = rules.moves.find((m) => m.key === 'ember')!;
    expect(rules.types.names[ember.type]).toBe('fire');
    expect(ember.damageClass).toBe('special');
    expect(ember.levels).toHaveLength(movesConfig.moves.ember!.levels.length + 1);
    const vineWhip = rules.moves.find((m) => m.key === 'vine-whip')!;
    expect(vineWhip.damageClass).toBe('physical');
    expect(vineWhip.levels[0]!.pierce).toBe(Infinity);
  });

  it('敵の種類に PokeAPI のタイプが付く（ポッポ: ノーマル・ひこう）', () => {
    const pidgey = rules.enemies.kinds.find((k) => k.id === 'pidgey')!;
    expect(pidgey.types.map((t) => rules.types.names[t])).toEqual(['normal', 'flying']);
  });

  it('原作の相性表になっている（ほのお → くさ ×2、ノーマル → ゴースト ×0）', () => {
    const i = (n: string) => rules.types.names.indexOf(n);
    expect(rules.types.chart[i('fire')]![i('grass')]).toBe(2);
    expect(rules.types.chart[i('normal')]![i('ghost')]).toBe(0);
  });

  it('ものまね は遊べるポケモンの最初の技、ゆびをふる は固有技から選ぶ（作者の決定 2026年10月23日）', () => {
    const keysOf = (key: string) => rules.moves.find((m) => m.key === key)!.randomPool.map((i) => rules.moves[i]!.key);
    const mimic = keysOf('mimic');
    expect(mimic).toContain('ember');
    expect(mimic).toContain('tackle');
    expect(mimic).not.toContain('blast-burn');
    expect(mimic).not.toContain('mimic');
    const metronome = keysOf('metronome');
    expect(metronome).toContain('blast-burn');
    expect(metronome).toContain('volt-tackle');
    expect(metronome).not.toContain('ember');
    expect(metronome).not.toContain('metronome');
  });

  it('ミュウはどのタイプの技も覚えられる', () => {
    expect(playableLoadout(rules, 'mew').moveTypes).toHaveLength(rules.types.names.length);
  });

  it('どの遊べるポケモンも、自分の固有技の元になる技を覚えられる（覚えられる系統を絞っても、固有技にたどり着ける）', () => {
    const all = [...derivationsConfig.derivations.map((d) => ({ ...d, line: null as string | null })), ...derivationsConfig.unique];
    // 元をたどって、派生でない技（最初に覚える技）にする
    const baseOf = (key: string): string => {
      const d = all.find((x) => x.to === key);
      return d ? baseOf(d.from) : key;
    };
    // 進化した姿のタイプも含める
    const typesOf = (line: string): Set<string> => {
      const out = new Set<string>();
      const stack = [line];
      while (stack.length) {
        const k = stack.pop()!;
        const forced = playablesConfig.pokemon[line]!.types;
        for (const t of forced ?? generated.pokemon[k]?.types ?? []) out.add(t);
        if (playablesConfig.pokemon[line]!.evolves !== false) for (const e of generated.pokemon[k]?.evolvesTo ?? []) stack.push(e.to);
      }
      return out;
    };
    for (const u of derivationsConfig.unique) {
      const pl = playablesConfig.pokemon[u.line]!;
      const base = baseOf(u.from);
      const def = movesConfig.moves[base]!;
      const type = generated.moves[base]!.type;
      const ok =
        pl.startingMoves.includes(base) ||
        pl.allMoveTypes ||
        (def.learners ? def.learners.includes(u.line) : type === 'normal' || typesOf(u.line).has(type) || (pl.moveTypes ?? []).includes(type));
      expect(ok, `${u.line} が ${u.to} の元 ${base} を覚えられない`).toBe(true);
    }
  });

  it('御三家の最初の技とタイプ', () => {
    // タマゴは選ぶとベイビィポケモンになるので、ポケモンとしての決まりは無い
    for (const key of Object.keys(playablesConfig.pokemon).filter((k) => !playablesConfig.pokemon[k]!.hatch)) {
      const l = playableLoadout(rules, key);
      // タイプの指定（プリン: ノーマルだけ）があれば、それ
      expect(l.types.map((t) => rules.types.names[t])).toEqual(playablesConfig.pokemon[key]!.types ?? generated.pokemon[key]!.types);
      expect(l.moves.map((m) => rules.moves[m.move]!.key)).toEqual(playablesConfig.pokemon[key]!.startingMoves);
    }
  });
});
