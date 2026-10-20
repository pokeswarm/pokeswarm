import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim/simulation';
import { testRules } from '../sim/testRules';
import { RunRecorder } from './runRecorder';
import { SaveStore } from './saveStore';

describe('ランの記録', () => {
  it('途中の記録と終了時の記録を、同じ分を2回足さずにまとめる', () => {
    const store = new SaveStore(null, null);
    const sim = new Simulation({ tickRate: 30, seed: 1, rules: testRules() });
    sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0 });
    const rec = new RunRecorder(store, 'charmander');
    sim.world.stats.kills = 10;
    for (let t = 0; t < 60; t++) sim.step([]);
    rec.commit(sim.world);
    rec.commit(sim.world);
    expect(store.current.stats.kills).toBe(10);
    expect(store.current.stats.playSeconds).toBe(2);
    sim.world.stats.kills = 25;
    sim.world.outcome = 'clear';
    rec.finish(sim.world);
    rec.finish(sim.world);
    const s = store.current.stats;
    expect(s.kills).toBe(25);
    expect(s.runs).toBe(1);
    expect(s.clears).toBe(1);
    expect(s['clears.charmander']).toBe(1);
    expect(s.bestKills).toBe(25);
  });
});
