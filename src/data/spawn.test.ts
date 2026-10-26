import { describe, expect, it } from 'vitest';
import spawnJson from '../../data/game/spawn.json';
import { findReappearingKind, spawnConfigSchema } from './schema';
import { regionStages } from './index';

describe('時間帯ごとの出現の定義', () => {
  it('data/game/spawn.json と地方のステージ（data/regions/<地方>.json）の区間を合わせると検証を通る', () => {
    for (const rs of Object.values(regionStages)) expect(spawnConfigSchema.safeParse({ ...spawnJson, waves: rs.spawn.waves }).success).toBe(true);
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
