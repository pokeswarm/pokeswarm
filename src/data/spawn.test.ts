import { describe, expect, it } from 'vitest';
import spawnJson from '../../data/game/spawn.json';
import { findReappearingKind, spawnConfigSchema } from './schema';

describe('時間帯ごとの出現の定義', () => {
  it('data/game/spawn.json が検証を通る', () => {
    expect(spawnConfigSchema.safeParse(spawnJson).success).toBe(true);
  });

  it('続いた時間帯に同じ種類が出るのはよい', () => {
    expect(findReappearingKind([{ kinds: ['pidgey', 'rattata'] }, { kinds: ['pidgey', 'caterpie'] }, { kinds: ['zubat'] }])).toBeNull();
  });

  it('一度いなくなった種類が後で再び出るのはエラーにする', () => {
    const waves = [{ kinds: ['pidgey'] }, { kinds: ['zubat'] }, { kinds: ['pidgey'] }];
    expect(findReappearingKind(waves)).toEqual({ kind: 'pidgey', leftAt: 1, backAt: 2 });
    const bad = { ...spawnJson, waves: waves.map((w, i) => ({ startSeconds: i * 10, hpMultiplier: 1, damageMultiplier: 1, kinds: w.kinds })) };
    expect(spawnConfigSchema.safeParse(bad).success).toBe(false);
  });
});
