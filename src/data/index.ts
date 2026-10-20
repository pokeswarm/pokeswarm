import type { z } from 'zod';
import simulationJson from '../../data/game/simulation.json';
import playerJson from '../../data/game/player.json';
import placeholderJson from '../../data/render/placeholder.json';
import enemiesJson from '../../data/game/enemies.json';
import spawnJson from '../../data/game/spawn.json';
import combatJson from '../../data/game/combat.json';
import movesJson from '../../data/game/moves.json';
import playablesJson from '../../data/game/playables.json';
import spriteRenderJson from '../../data/render/sprites.json';
import networkJson from '../../data/game/network.json';
import statusJson from '../../data/game/status.json';
import pickupsJson from '../../data/game/pickups.json';
import effectRecipesJson from '../../data/effects/recipes.json';
import generatedPokemonJson from '../../data/generated/pokemon.json';
import generatedMovesJson from '../../data/generated/moves.json';
import generatedItemsJson from '../../data/generated/items.json';
import generatedTypesJson from '../../data/generated/types.json';
import { resolveEffectRecipes } from './effects';
import {
  combatConfigSchema,
  enemiesConfigSchema,
  generatedItemsSchema,
  generatedMovesSchema,
  generatedPokemonSchema,
  generatedTypesSchema,
  movesConfigSchema,
  networkConfigSchema,
  pickupConfigSchema,
  placeholderRenderSchema,
  playablesConfigSchema,
  playerConfigSchema,
  simulationConfigSchema,
  spawnConfigSchema,
  spriteRenderSchema,
  statusConfigSchema,
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
export const combatConfig = load('game/combat.json', combatConfigSchema, combatJson);
export const movesConfig = load('game/moves.json', movesConfigSchema, movesJson);
export const playablesConfig = load('game/playables.json', playablesConfigSchema, playablesJson);
export const statusConfig = load('game/status.json', statusConfigSchema, statusJson);
export const pickupConfig = load('game/pickups.json', pickupConfigSchema, pickupsJson);
export const spriteRender = load('render/sprites.json', spriteRenderSchema, spriteRenderJson);
export const effectRecipes = resolveEffectRecipes(effectRecipesJson);
export const networkConfig = load('game/network.json', networkConfigSchema, networkJson);

/** PokeAPI から生成したデータ（npm run pokeapi） */
export const generated = {
  pokemon: load('generated/pokemon.json', generatedPokemonSchema, generatedPokemonJson),
  moves: load('generated/moves.json', generatedMovesSchema, generatedMovesJson),
  items: load('generated/items.json', generatedItemsSchema, generatedItemsJson),
  types: load('generated/types.json', generatedTypesSchema, generatedTypesJson),
};

// ---- ファイルをまたぐ参照の検証 ----
function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
}
for (const wave of spawnConfig.waves) {
  for (const kind of wave.kinds) {
    check(
      enemiesConfig.kinds.some((k) => k.id === kind),
      `data/game/spawn.json の waves にある敵 "${kind}" が data/game/enemies.json にありません`,
    );
  }
}
for (const kind of enemiesConfig.kinds) {
  check(!!generated.pokemon[kind.id], `data/game/enemies.json の "${kind.id}" が data/generated/pokemon.json にありません（data/pokeapi/targets.json に足して npm run pokeapi）`);
}
for (const [key, def] of Object.entries(movesConfig.moves)) {
  check(!!generated.moves[key], `data/game/moves.json の "${key}" が data/generated/moves.json にありません（data/pokeapi/targets.json に足して npm run pokeapi）`);
  check(!!effectRecipes[def.effect], `data/game/moves.json の "${key}" の effect "${def.effect}" のレシピがありません`);
  const status = def.base.statusId;
  check(!status || statusConfig.kinds.some((k) => k.id === status), `data/game/moves.json の "${key}" の statusId "${status}" が data/game/status.json にありません`);
}
for (const [key, p] of Object.entries(playablesConfig.pokemon)) {
  check(!!generated.pokemon[key], `data/game/playables.json の "${key}" が data/generated/pokemon.json にありません`);
  for (const m of p.startingMoves) check(!!movesConfig.moves[m], `data/game/playables.json の "${key}" の最初の技 "${m}" が data/game/moves.json にありません`);
}
check(!!playablesConfig.pokemon[playablesConfig.default], `data/game/playables.json の default "${playablesConfig.default}" がありません`);
