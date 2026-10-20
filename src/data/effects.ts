import { effectRecipeFileSchema, effectRecipeSchema, type EffectRecipe } from './schema';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** オブジェクトは項目ごとに重ね、配列や値は上書きする */
function deepMerge(base: unknown, over: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(over)) return over === undefined ? base : over;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = deepMerge(base[k], v);
  return out;
}

/** extends をたどってレシピを組み立て、型で検証する */
export function resolveEffectRecipes(raw: unknown): Record<string, EffectRecipe> {
  const file = effectRecipeFileSchema.parse(raw);
  const resolved: Record<string, EffectRecipe> = {};
  const resolving = new Set<string>();

  const resolve = (id: string): unknown => {
    const entry = file.recipes[id];
    if (!entry) throw new Error(`エフェクトのレシピ ${id} がありません`);
    if (resolving.has(id)) throw new Error(`エフェクトのレシピ ${id} の extends が循環しています`);
    resolving.add(id);
    const { extends: parent, ...own } = entry;
    const merged = parent ? deepMerge(resolve(parent), own) : own;
    resolving.delete(id);
    return merged;
  };

  for (const id of Object.keys(file.recipes)) {
    const result = effectRecipeSchema.safeParse(resolve(id));
    if (!result.success) throw new Error(`エフェクトのレシピ ${id} の検証に失敗しました:\n${result.error.message}`);
    resolved[id] = result.data;
  }
  return resolved;
}
