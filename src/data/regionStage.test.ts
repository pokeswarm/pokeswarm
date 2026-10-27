import { describe, expect, it } from 'vitest';
import { achievementsConfig, regionStage, regionStages, regionsConfig, spawnConfig } from './index';
import { buildSimRules } from './simRules';

describe('地方のステージ（data/regions/<地方>.json）', () => {
  it('地方を省く・知らない地方はカントー。カントーの組は前の spawnConfig と同じ', () => {
    expect(regionStage(undefined).id).toBe('kanto');
    expect(regionStage('nowhere').id).toBe('kanto');
    expect(regionStage('kanto').spawn).toBe(spawnConfig);
  });

  it('区間ごとの 雑魚・地面・曲・障害物・夜 の数がそろう', () => {
    for (const rs of Object.values(regionStages)) {
      const n = rs.spawn.waves.length;
      expect(rs.ground.waves).toHaveLength(n);
      expect(rs.bgmRun.sections).toHaveLength(n);
      expect(rs.obstacles.sections).toHaveLength(n);
      expect(rs.night).toHaveLength(n);
    }
  });

  it('ステージのある地方は data/game/regions.json にある', () => {
    for (const id of Object.keys(regionStages)) expect(regionsConfig.regions.some((r) => r.id === id)).toBe(true);
  });

  it('ジョウト: 区間6 は いかりのみずうみ（60秒）→ こおりのぬけみち に分け、夜は 2・5・6b・7（07 の61章）', () => {
    const johto = regionStage('johto');
    expect(johto.ground.waves[6]!.tile).toBe('johto_lake_meadow');
    expect(johto.spawn.waves[6]!.durationSeconds).toBe(60);
    expect(johto.ground.waves[7]!.tile).toBe('johto_ice');
    expect(johto.night.flatMap((n, i) => (n ? [i] : []))).toEqual([2, 5, 7, 8]);
    expect(johto.stage.legendary).toBeNull();
  });

  it('カントーのイワークはヒモでハガネールに進化しない（メタルコートで進化し、メタルコートはジョウトの実績でだけ出る。07 の66.2）', () => {
    const rules = buildSimRules();
    const onix = rules.species.find((s) => s.key === 'onix')!;
    const metalCoat = rules.items.findIndex((i) => i.key === 'metal-coat');
    expect(onix.evolutions).toEqual([{ to: rules.species.findIndex((s) => s.key === 'steelix'), trigger: 'item', item: metalCoat }]);
    expect(achievementsConfig.achievements.filter((a) => a.reward?.item === 'metal-coat').map((a) => a.region)).toEqual(['johto']);
    const machoke = rules.species.find((s) => s.key === 'machoke')!;
    expect(machoke.evolutions.length).toBeGreaterThan(0);
  });

  it('buildSimRules(地方) はその地方の区間とボスを使う', () => {
    expect(buildSimRules('johto').spawn.waves).toBe(regionStage('johto').spawn.waves);
    expect(buildSimRules('johto').stage.bosses.some((b) => b.kind === 'johto-midboss-pidgeotto')).toBe(true);
    expect(buildSimRules().stage.bosses.some((b) => b.kind === 'midboss-onix')).toBe(true);
  });
});
