import { describe, expect, it } from 'vitest';
import { buildSimRules } from '../data/simRules';
import { applyArenaParam } from './debugOverrides';

describe('広さの見比べ（?arena。07 の204.2）', () => {
  it('広さと見える縦を変え、定位置と飛ぶ先を広さの比で動かす', () => {
    const base = buildSimRules('johto');
    const rules = applyArenaParam(base, '?arena=800,440,480');
    const set = rules.stage.legendary!.moveSets['legend-lugia']!;
    expect(set.arena).toMatchObject({ halfWidth: 400, halfHeight: 220, viewHeight: 480 });
    expect(set.anchor!.y).toBeCloseTo(base.stage.legendary!.moveSets['legend-lugia']!.anchor!.y / 2);
    expect(rules.stage.moves.find((m) => m.id === 'lugia-fly-side')!.flyTo!.x).toBe(320);
    // 元のデータは変えない
    expect(base.stage.moves.find((m) => m.id === 'lugia-fly-side')!.flyTo!.x).toBe(640);
  });

  it('指定が無い・おかしいときは、そのまま', () => {
    const base = buildSimRules('johto');
    expect(applyArenaParam(base, '')).toBe(base);
    expect(applyArenaParam(base, '?arena=1,2')).toBe(base);
  });
});
