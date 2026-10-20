import { describe, expect, it } from 'vitest';
import groundJson from '../../data/render/ground.json';
import { groundConfig, spawnConfig } from './index';
import { groundConfigSchema, groundTileAt } from './schema';

describe('マップの地面の定義', () => {
  it('data/render/ground.json が検証を通る', () => {
    expect(groundConfigSchema.safeParse(groundJson).success).toBe(true);
  });

  it('時間帯の境目でタイルが切り替わり、書いていない時間帯は前のタイルが続く', () => {
    expect(groundTileAt(groundConfig, 0)).toBe('meadow');
    expect(groundTileAt(groundConfig, 119.9)).toBe('meadow');
    expect(groundTileAt(groundConfig, 120)).toBe('cave');
    expect(groundTileAt(groundConfig, 750)).toBe('beach');
    expect(groundTileAt(groundConfig, 1020)).toBe('elite_hall');
  });

  it('切り替えの時刻は spawn.json の時間帯の境目と一致している', () => {
    for (const w of groundConfig.waves) expect(spawnConfig.waves.some((s) => s.startSeconds === w.startSeconds)).toBe(true);
  });

  it('tiles にないタイル ID はエラーにする', () => {
    const bad = { ...groundJson, waves: [{ startSeconds: 0, tile: 'nowhere' }] };
    expect(groundConfigSchema.safeParse(bad).success).toBe(false);
  });
});
