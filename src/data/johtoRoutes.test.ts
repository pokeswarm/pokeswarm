import { describe, expect, it } from 'vitest';
import { derivationsConfig, regionsConfig } from './index';
import { buildSimRules } from './simRules';
import { itemEvolvesNow } from '../sim/systems/evolution';

/** ジョウトの固有技はカントーの形（初期技 ＋ 持ち物 → 派生技 ＋ 持ち物 → 固有技。07 の168・169章） */
describe('カントー・ジョウトの技の進化の形', () => {
  it('カントー・ジョウトの系統に、ホウエンの仕掛け（支えの技・天気・ランの記録）を使わない', () => {
    const hoenn = new Set(regionsConfig.regions.find((r) => r.id === 'hoenn')!.playables);
    const lines = new Set(regionsConfig.regions.filter((r) => r.id !== 'hoenn').flatMap((r) => r.playables).filter((l) => !hoenn.has(l)));
    const bad = [...derivationsConfig.derivations, ...derivationsConfig.unique].filter((d) => d.line && lines.has(d.line) && (d.needsMoves || d.weather || d.runStat || d.itemLevel));
    expect(bad.map((d) => `${d.line}: ${d.to}`)).toEqual([]);
  });

  it('作り直したルート（07 の169章）', () => {
    const routes: [string, string, string, string][] = [
      ['pidgey', 'air-slash', 'x-speed', 'hurricane'],
      ['mareep', 'thunderbolt', 'x-sp-atk', 'zap-cannon'],
      ['heracross', 'horn-attack', 'silver-powder', 'fury-cutter'],
      ['heracross', 'fury-cutter', 'x-attack', 'megahorn'],
      ['miltank', 'body-slam', 'hard-stone', 'rollout'],
      ['larvitar', 'rock-slide', 'soft-sand', 'stone-edge'],
      ['raikou', 'thunderbolt', 'thunder-stone', 'thunder'],
      ['entei', 'flamethrower', 'fire-stone', 'eruption'],
      ['suicune', 'aurora-beam', 'never-melt-ice', 'ice-beam'],
      ['suicune', 'ice-beam', 'water-stone', 'sheer-cold'],
      ['slowpoke', 'psychic', 'kings-rock', 'future-sight-alakazam'],
      ['porygon', 'swift', 'up-grade', 'tri-attack'],
    ];
    const all = [...derivationsConfig.derivations, ...derivationsConfig.unique];
    for (const [line, from, item, to] of routes) expect(all.some((d) => d.line === line && d.from === from && d.item === item && d.to === to), `${line}: ${from} ＋ ${item} → ${to}`).toBe(true);
  });

  it('取ると今の姿が進化する持ち物が分かる（選択画面の「おや……？」）', () => {
    const rules = buildSimRules('johto');
    const sp = (k: string): number => rules.species.findIndex((s) => s.key === k);
    const it = (k: string): number => rules.items.findIndex((i) => i.key === k);
    expect(itemEvolvesNow(rules, sp('onix'), it('metal-coat'))).toBe(true);
    expect(itemEvolvesNow(rules, sp('scyther'), it('metal-coat'))).toBe(true);
    expect(itemEvolvesNow(rules, sp('steelix'), it('metal-coat'))).toBe(false);
    expect(itemEvolvesNow(rules, sp('clefairy'), it('moon-stone'))).toBe(true);
    expect(itemEvolvesNow(rules, sp('cleffa'), it('moon-stone'))).toBe(false);
    expect(itemEvolvesNow(rules, sp('cyndaquil'), it('fire-stone'))).toBe(false);
  });
});
