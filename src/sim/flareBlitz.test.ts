import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { makeOffers } from './systems/leveling';

/** フレアドライブのリワーク（作者の依頼 2026年10月28日。07 の115章） */
function setup() {
  const rules = buildSimRules();
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const lo = playableLoadout(rules, 'charmander');
  const move = (key: string): number => moveIndexOf(rules, key);
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, types: lo.types, moveTypes: lo.moveTypes, moves: [], line: lo.line, species: lo.species });
  return { rules, sim, p, move, w: sim.world };
}

describe('フレアドライブ', () => {
  it('ほのおのキバ（最大）＋ プラスパワーで、レベル 50 から候補に出る', () => {
    const s = setup();
    const fang = s.move('fire-fang');
    s.p.moves = [{ move: fang, level: s.rules.moves[fang]!.levels.length, cooldown: 99, burstLeft: 0, burstTimer: 0 }];
    s.p.items = [{ item: s.rules.items.findIndex((it) => it.key === 'x-attack'), level: 1 }];
    const offered = () => makeOffers(s.w, s.p).some((o) => o.kind === 'derive' && o.to === s.move('flare-blitz'));
    s.w.level = 49;
    expect(offered()).toBe(false);
    s.w.level = 50;
    expect(offered()).toBe(true);
    s.p.items = [{ item: s.rules.items.findIndex((it) => it.key === 'charcoal'), level: 1 }];
    expect(offered()).toBe(false);
  });

  it('使うと最大 HP の 2% を使い、5 秒の間 両方の攻撃力と素早さが上がる', () => {
    const s = setup();
    s.p.moves = [{ move: s.move('flare-blitz'), level: 1, cooldown: 0, burstLeft: 0, burstTimer: 0 }];
    const hp = s.p.hp;
    const before = { ...s.p.mods };
    s.sim.step([]);
    expect(s.p.hp).toBeLessThan(hp);
    expect(s.p.mods.physicalPowerPct).toBe(before.physicalPowerPct + 20);
    expect(s.p.mods.specialPowerPct).toBe(before.specialPowerPct + 20);
    expect(s.p.mods.moveSpeedPct).toBe(before.moveSpeedPct + 15);
    // 獄炎の地面が自分に付いて出ている
    expect(s.w.projectiles.count).toBeGreaterThan(0);
    // 5 秒で切れる（次に使えるのは 7 秒後なので、その間は元に戻る）
    for (let t = 0; t < 5 * 30 + 2; t++) s.sim.step([]);
    expect(s.p.mods.physicalPowerPct).toBe(before.physicalPowerPct);
    expect(s.p.mods.moveSpeedPct).toBe(before.moveSpeedPct);
  });
});
