import { describe, expect, it } from 'vitest';
import type { InputCommand } from '../sim/commands';
import { Simulation } from '../sim/simulation';
import { testRules } from '../sim/testRules';
import type { SimRole } from '../sim/world';
import { decode, encode, type NetMessage } from './protocol';
import { SyncSession } from './sync';

const rate = { playerStateIntervalTicks: 1, correctionIntervalTicks: 30 };

function makePeer(role: SimRole, localId: number, remoteId: number) {
  const rules = testRules({ spawn: { spawnPerSecond: 30, capGlobal: 200, capPerPlayer: 100 }, attack: { range: 300 } });
  const sim = new Simulation({ tickRate: 30, seed: 7, rules, role, localPlayerId: localId });
  sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 150, remote: localId !== 1 });
  sim.addPlayer({ id: 2, x: 60, y: 0, radius: 12, moveSpeed: 150, remote: localId !== 2 });
  const session = new SyncSession(remoteId, rate, 30, () => 0);
  return { sim, session, inbox: [] as InputCommand[] };
}

/** 2つのシミュレーションを、遅延のある通信路（文字列にして送る）でつないで進める */
function runPair(ticks: number, delayTicks: number) {
  const host = makePeer('host', 1, 2);
  const guest = makePeer('guest', 2, 1);
  const wire: { at: number; to: 'host' | 'guest'; text: string }[] = [];
  for (let t = 0; t < ticks; t++) {
    // 両者とも動き回る
    const hostMove: InputCommand = { type: 'move', playerId: 1, dx: t % 120 < 60 ? 1 : -1, dy: 0 };
    const guestMove: InputCommand = { type: 'move', playerId: 2, dx: 0, dy: t % 90 < 45 ? 1 : -1 };
    for (const msg of wire.filter((w) => w.at <= t)) {
      const peer = msg.to === 'host' ? host : guest;
      peer.inbox.push(...peer.session.incoming(peer.sim.world, decode(msg.text)));
    }
    wire.splice(0, wire.length, ...wire.filter((w) => w.at > t));
    host.sim.step([hostMove, ...host.inbox.splice(0)]);
    guest.sim.step([guestMove, ...guest.inbox.splice(0)]);
    const toGuest: NetMessage[] = host.session.outgoing(host.sim.world);
    const toHost: NetMessage[] = guest.session.outgoing(guest.sim.world);
    if (toGuest.length) wire.push({ at: t + delayTicks, to: 'guest', text: encode(toGuest) });
    if (toHost.length) wire.push({ at: t + delayTicks, to: 'host', text: encode(toHost) });
  }
  // 通信路に残ったものを届けきる。ゲストは止まり、ホストの最後の更新の結果もゲストへ届ける
  for (const msg of wire) {
    const peer = msg.to === 'host' ? host : guest;
    peer.inbox.push(...peer.session.incoming(peer.sim.world, decode(msg.text)));
  }
  guest.sim.step([{ type: 'move', playerId: 2, dx: 0, dy: 0 }, ...guest.inbox.splice(0)]);
  host.sim.step(host.inbox.splice(0));
  guest.inbox.push(...guest.session.incoming(guest.sim.world, host.session.outgoing(host.sim.world)));
  guest.sim.step(guest.inbox.splice(0));
  return { host: host.sim.world, guest: guest.sim.world };
}

function idsOf(w: Simulation['world']): number[] {
  return Array.from(w.enemies.id.subarray(0, w.enemies.count)).sort((a, b) => a - b);
}

describe('協力プレイの同期', () => {
  it('ゲストは敵を自分で出さず、ホストと同じ敵の集まりになる', () => {
    const { host, guest } = runPair(600, 3);
    expect(host.enemies.count).toBeGreaterThan(0);
    expect(idsOf(guest)).toEqual(idsOf(host));
  });

  it('ゲストの攻撃はホストが集計し、撃破が両方に反映される', () => {
    const { host, guest } = runPair(900, 3);
    expect(host.stats.kills).toBeGreaterThan(0);
    expect(guest.stats.kills).toBe(host.stats.kills);
  });

  it('相手のプレイヤーの位置が届く', () => {
    const { host, guest } = runPair(300, 3);
    const guestOnHost = host.players.find((p) => p.id === 2)!;
    const guestSelf = guest.players.find((p) => p.id === 2)!;
    expect(Math.hypot(guestOnHost.x - guestSelf.x, guestOnHost.y - guestSelf.y)).toBeLessThan(1);
  });

  it('敵の位置のずれは補正で小さく保たれる', () => {
    const { host, guest } = runPair(901, 3);
    const pos = new Map<number, [number, number]>();
    for (let i = 0; i < host.enemies.count; i++) pos.set(host.enemies.id[i]!, [host.enemies.x[i]!, host.enemies.y[i]!]);
    let worst = 0;
    for (let i = 0; i < guest.enemies.count; i++) {
      const p = pos.get(guest.enemies.id[i]!);
      if (!p) continue;
      worst = Math.max(worst, Math.hypot(p[0] - guest.enemies.x[i]!, p[1] - guest.enemies.y[i]!));
    }
    // 補正の間隔（1秒）の間に、敵の速さ（60/秒）程度まではずれうる
    expect(worst).toBeLessThan(80);
  });
});
