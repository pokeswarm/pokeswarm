import { describe, expect, it } from 'vitest';
import { decode, encode } from '../net/protocol';
import { SyncSession } from '../net/sync';
import { Simulation } from './simulation';
import { testRules } from './testRules';
import type { SimRole } from './world';

describe('経験値の玉（ソロ）', () => {
  it('倒した場所に玉が落ち、取得範囲に入ると吸い寄せられて拾える', () => {
    const sim = new Simulation({ tickRate: 30, seed: 1, rules: testRules({ move: { power: 100, cooldownSeconds: 100 } }) });
    sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 150, pickupRange: 80 });
    sim.world.enemies.add(1, 0, 60, 0, 20, 0, 10);
    let dropped = false;
    for (let t = 0; t < 30; t++) {
      sim.step([]);
      dropped ||= sim.world.events.some((ev) => ev.type === 'gemSpawned');
    }
    expect(dropped).toBe(true);
    expect(sim.world.gems.count).toBe(0);
    expect(sim.world.xp).toBe(1);
  });

  it('玉が上限に達したら、新しい経験値は一番古い玉にまとめる', () => {
    const sim = new Simulation({
      tickRate: 30,
      seed: 1,
      rules: testRules({ move: { power: 100, cooldownSeconds: 0.05, range: 400 }, pickups: { maxGems: 2 } }),
    });
    sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 150, pickupRange: 0 });
    for (let k = 0; k < 5; k++) sim.world.enemies.add(k + 1, 0, 200 + k * 30, 0, 20, 0, 10);
    for (let t = 0; t < 60; t++) sim.step([]);
    const g = sim.world.gems;
    expect(sim.world.stats.kills).toBe(5);
    expect(g.count).toBe(2);
    expect(g.value[0]! + g.value[1]!).toBe(5);
  });
});

function peer(role: SimRole, localId: number, remoteId: number) {
  const sim = new Simulation({ tickRate: 30, seed: 1, rules: testRules({ move: { range: 1 } }), role, localPlayerId: localId });
  // 2人とも同じ場所に立つ
  sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 150, remote: localId !== 1, pickupRange: 80 });
  sim.addPlayer({ id: 2, x: 0, y: 0, radius: 12, moveSpeed: 150, remote: localId !== 2, pickupRange: 80 });
  return { sim, session: new SyncSession(remoteId, { playerStateIntervalTicks: 1, correctionIntervalTicks: 30 }, 30, () => 0) };
}

describe('経験値の玉（協力プレイ）', () => {
  it('2人が同じ玉に同時に触れても、経験値は1回だけ数える', () => {
    const host = peer('host', 1, 2);
    const guest = peer('guest', 2, 1);
    // 同じ玉が両方にある状態（ホストが作ってゲストへ届いた後）
    host.sim.world.gems.add(7, 0, 0, 5, 6);
    guest.sim.world.gems.add(7, 0, 0, 5, 6);
    host.sim.step([]);
    guest.sim.step([]);
    // ホストは自分で拾って確定、ゲストは確定待ち
    expect(host.sim.world.xp).toBe(5);
    expect(guest.sim.world.gems.pending[0]).toBe(1);
    // メッセージを交換する
    const toGuest = encode(host.session.outgoing(host.sim.world));
    const toHost = encode(guest.session.outgoing(guest.sim.world));
    const hostCmds = host.session.incoming(host.sim.world, decode(toHost));
    const guestCmds = guest.session.incoming(guest.sim.world, decode(toGuest));
    host.sim.step(hostCmds);
    guest.sim.step(guestCmds);
    expect(host.sim.world.xp).toBe(5);
    expect(guest.sim.world.xp).toBe(5);
    expect(guest.sim.world.gems.count).toBe(0);
  });
});
