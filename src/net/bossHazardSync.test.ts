import { describe, expect, it } from 'vitest';
import { buildSimRules } from '../data/simRules';
import { Simulation } from '../sim/simulation';
import { moveIndexOfStage } from '../sim/world';
import { addHazard } from '../sim/systems/stage';
import { decode, encode } from './protocol';
import { SyncSession } from './sync';

/** ボスの技の作り直し（07 の167章）: 予告の知らせに足した 組・威力の上書き・進む速さ・長さ が、ゲストへ届く */
describe('ボスの範囲技の予告の同期（07 の167章）', () => {
  it('なみのり の波の帯（長さ・進む速さ）とカウンターの返し（威力の上書き）が、ゲストの予告に同じく入る', () => {
    const rules = buildSimRules('kanto');
    const rate = { playerStateIntervalTicks: 1, correctionIntervalTicks: 30 };
    const host = new Simulation({ tickRate: 30, seed: 1, rules, role: 'host', localPlayerId: 1 });
    const guest = new Simulation({ tickRate: 30, seed: 1, rules, role: 'guest', localPlayerId: 2 });
    for (const sim of [host, guest]) {
      sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 150, remote: sim === guest });
      sim.addPlayer({ id: 2, x: 60, y: 0, radius: 12, moveSpeed: 150, remote: sim === host });
    }
    const hs = new SyncSession(rate, 1000, () => 0);
    const gs = new SyncSession(rate, 1000, () => 0);
    host.step([]);
    guest.step([]);
    const w = host.world;
    w.events.length = 0;
    addHazard(w, moveIndexOfStage(rules, 'lapras-surf'), -500, -300, 0, 1, -1, undefined, { group: 7, vx: 260, vy: 0, length: 420 });
    addHazard(w, moveIndexOfStage(rules, 'machamp-counter-burst'), 10, 20, 0, 0, -1, undefined, { group: 8, damage: 37.5 });
    const msgs = hs.outgoing(w);
    const cmds = gs.incoming(guest.world, decode(encode(msgs)), 1);
    guest.step(cmds);
    const g = guest.world.hazards;
    const surf = g.find((h) => rules.stage.moves[h.move]!.id === 'lapras-surf')!;
    expect(surf.group).toBe(7);
    expect(surf.length).toBe(420);
    expect(surf.vx).toBe(260);
    expect(surf.vy).toBe(0);
    const burst = g.find((h) => rules.stage.moves[h.move]!.id === 'machamp-counter-burst')!;
    expect(burst.group).toBe(8);
    expect(burst.damageOverride).toBe(37.5);
  });
});
