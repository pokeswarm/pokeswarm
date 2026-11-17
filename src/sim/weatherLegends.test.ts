import { describe, expect, it } from 'vitest';
import { buildSimRules, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { activeLegendField, isAloneLegend, startLegendary } from './systems/stage';

/** グラードン ＋ カイオーガの作り直し（07 の282章）: 固定マップ・天気で技が変わる・片方を倒すとゲンシカイキ */
function setup() {
  const rules = buildSimRules('hoenn');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const lo = playableLoadout(rules, 'treecko');
  sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, types: lo.types, moves: [], line: lo.line, species: lo.species });
  const w = sim.world;
  const kind = (id: string): number => rules.enemies.kinds.findIndex((k) => k.id === id);
  const idx = (id: string): number => {
    for (let i = 0; i < w.enemies.count; i++) if (w.enemies.hp[i]! > 0 && w.enemies.kind[i] === kind(id)) return i;
    return -1;
  };
  startLegendary(w, kind('legend-groudon'), 1);
  for (let k = 0; k < 200 && !w.legendary!.spawned; k++) sim.step([]);
  return { rules, sim, w, kind, idx };
}

describe('グラードン ＋ カイオーガ', () => {
  it('固定マップに移り、2 体が出る', () => {
    const t = setup();
    expect(t.w.arena).not.toBeNull();
    expect(t.idx('legend-groudon')).not.toBe(-1);
    expect(t.idx('legend-kyogre')).not.toBe(-1);
    expect(isAloneLegend(t.w, t.idx('legend-groudon'))).toBe(false);
  });

  it('ソーラービームは、ひざしの間は溜めが短く、あめの間は長い', () => {
    const t = setup();
    const moves = t.rules.stage.moves;
    const sb = moves.find((m) => m.id === 'groudon-solar-beam')!;
    const sun = moves.find((m) => m.id === 'groudon-solar-beam-sun')!;
    const rain = moves.find((m) => m.id === 'groudon-solar-beam-rain')!;
    expect(sb.whenWeather?.map((w) => w.fieldWeather)).toEqual(['sun-weather', 'rain-dance']);
    expect(sun.telegraphSeconds).toBeLessThan(sb.telegraphSeconds);
    expect(rain.telegraphSeconds).toBeGreaterThan(sb.telegraphSeconds);
  });

  it('カイオーガを倒すと、グラードンは 1 体だけの姿（おおひでり: みずの技が効かない）', () => {
    const t = setup();
    const k = t.idx('legend-kyogre');
    t.sim.step([{ type: 'damageEnemy', id: t.w.enemies.id[k]!, amount: 1e9, by: 1, kbx: 0, kby: 0, kbTicks: 0, status: -1, statusTicks: 0 }]);
    for (let s = 0; s < 3; s++) t.sim.step([]);
    const g = t.idx('legend-groudon');
    expect(isAloneLegend(t.w, g)).toBe(true);
    expect(activeLegendField(t.w)?.field.typePowerPct?.water).toBe(-100);
    const boss = t.w.bosses.find((b) => b.id === t.w.enemies.id[g]);
    expect(boss?.alone).toBe(true);
    expect(t.rules.stage.moves[boss!.moves[0]!]!.id).toBe('groudon-precipice-blades-primal');
  });
});
