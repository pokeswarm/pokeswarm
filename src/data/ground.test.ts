import { describe, expect, it } from 'vitest';
import groundJson from '../../data/render/ground.json';
import { groundConfig, spawnConfig } from './index';
import { groundConfigSchema, groundTileAt } from './schema';

describe('マップの地面の定義', () => {
  it('data/render/ground.json が検証を通る', () => {
    expect(groundConfigSchema.safeParse(groundJson).success).toBe(true);
  });

  it('区間の番号でタイルを選び、区間が足りなければ最後のタイル', () => {
    expect(groundTileAt(groundConfig, 0)).toBe('meadow');
    expect(groundTileAt(groundConfig, 1)).toBe('cave');
    expect(groundTileAt(groundConfig, 6)).toBe('beach');
    expect(groundTileAt(groundConfig, 9)).toBe('elite_hall');
    expect(groundTileAt(groundConfig, 99)).toBe('elite_hall');
  });

  it('区間の数は spawn.json の waves と同じ', () => {
    expect(groundConfig.waves).toHaveLength(spawnConfig.waves.length);
  });

  it('tiles にないタイル ID はエラーにする', () => {
    const bad = { ...groundJson, waves: [{ tile: 'nowhere' }] };
    expect(groundConfigSchema.safeParse(bad).success).toBe(false);
  });
});
