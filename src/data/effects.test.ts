import { describe, expect, it } from 'vitest';
import recipes from '../../data/effects/recipes.json';
import { resolveEffectRecipes } from './effects';

describe('エフェクトのレシピ', () => {
  it('data/effects/recipes.json がすべて検証を通る', () => {
    expect(Object.keys(resolveEffectRecipes(recipes))).toContain('ember');
  });

  it('extends の元を引き継ぎ、書いた項目だけ上書きする', () => {
    const r = resolveEffectRecipes(recipes);
    expect(r.ember!.impact!.burst!.count).toBe(10);
    expect(r.ember!.impact!.burst!.colors).toEqual(r['fire.base']!.impact!.burst!.colors);
    expect(r.ember!.trail).toEqual(r['fire.base']!.trail);
  });

  it('循環した extends はエラーにする', () => {
    expect(() => resolveEffectRecipes({ recipes: { a: { extends: 'b' }, b: { extends: 'a' } } })).toThrow(/循環/);
  });
});
