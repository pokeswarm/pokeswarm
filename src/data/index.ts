import type { z } from 'zod';
import simulationJson from '../../data/game/simulation.json';
import playerJson from '../../data/game/player.json';
import placeholderJson from '../../data/render/placeholder.json';
import enemiesJson from '../../data/game/enemies.json';
import spawnJson from '../../data/game/spawn.json';
import attackJson from '../../data/game/attack.json';
import spriteRenderJson from '../../data/render/sprites.json';
import networkJson from '../../data/game/network.json';
import statusJson from '../../data/game/status.json';
import effectRecipesJson from '../../data/effects/recipes.json';
import { resolveEffectRecipes } from './effects';
import {
  attackConfigSchema,
  networkConfigSchema,
  enemiesConfigSchema,
  placeholderRenderSchema,
  playerConfigSchema,
  simulationConfigSchema,
  spawnConfigSchema,
  statusConfigSchema,
  spriteRenderSchema,
} from './schema';

function load<T extends z.ZodType>(name: string, schema: T, raw: unknown): z.infer<T> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error(`data/${name} の検証に失敗しました:\n${result.error.message}`);
  }
  return result.data;
}

export const simulationConfig = load('game/simulation.json', simulationConfigSchema, simulationJson);
export const playerConfig = load('game/player.json', playerConfigSchema, playerJson);
export const placeholderRender = load('render/placeholder.json', placeholderRenderSchema, placeholderJson);
export const enemiesConfig = load('game/enemies.json', enemiesConfigSchema, enemiesJson);
export const spawnConfig = load('game/spawn.json', spawnConfigSchema, spawnJson);
export const attackConfig = load('game/attack.json', attackConfigSchema, attackJson);
export const statusConfig = load('game/status.json', statusConfigSchema, statusJson);

// ファイルをまたぐ参照の検証
if (attackConfig.status && !statusConfig.kinds.some((k) => k.id === attackConfig.status!.id)) {
  throw new Error(`data/game/attack.json の status "${attackConfig.status.id}" が data/game/status.json にありません`);
}
for (const wave of spawnConfig.waves) {
  for (const kind of wave.kinds) {
    if (!enemiesConfig.kinds.some((k) => k.id === kind)) {
      throw new Error(`data/game/spawn.json の waves にある敵 "${kind}" が data/game/enemies.json にありません`);
    }
  }
}
export const spriteRender = load('render/sprites.json', spriteRenderSchema, spriteRenderJson);
export const effectRecipes = resolveEffectRecipes(effectRecipesJson);
if (!effectRecipes[attackConfig.effect]) throw new Error(`data/game/attack.json の effect "${attackConfig.effect}" のレシピがありません`);
export const networkConfig = load('game/network.json', networkConfigSchema, networkJson);
