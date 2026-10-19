import type { z } from 'zod';
import simulationJson from '../../data/game/simulation.json';
import playerJson from '../../data/game/player.json';
import placeholderJson from '../../data/render/placeholder.json';
import { placeholderRenderSchema, playerConfigSchema, simulationConfigSchema } from './schema';

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
