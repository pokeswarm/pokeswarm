import { describe, expect, it } from 'vitest';
import type { InputCommand } from '../sim/commands';
import { Simulation } from '../sim/simulation';
import { testRules } from '../sim/testRules';
import type { MoveStats } from '../sim/moves';
import type { SimRole, World } from '../sim/world';
import { decode, encode } from './protocol';
import { SyncSession } from './sync';

const rate = { playerStateIntervalTicks: 1, correctionIntervalTicks: 30 };

interface Peer {
  id: number;
  sim: Simulation;
  session: SyncSession;
  inbox: InputCommand[];
}

function makePeer(role: SimRole, localId: number, count: number, move: Partial<MoveStats> = {}): Peer {
  const rules = testRules({ spawn: { spawnPerSecond: 30, capGlobal: 200, capPerPlayer: 100 }, move: { range: 300, ...move } });
  const sim = new Simulation({ tickRate: 30, seed: 7, rules, role, localPlayerId: localId });
  for (let id = 1; id <= count; id++) sim.addPlayer({ id, x: (id - 1) * 60, y: 0, radius: 12, moveSpeed: 150, remote: localId !== id, pickupRange: 80 });
  return { id: localId, sim, session: new SyncSession(rate, 1000, () => 0), inbox: [] };
}

/**
 * ホスト（番号1）と count - 1 人のゲストを、遅延のある通信路（文字列にして送る）でつないで進める。
 * つなぎ方はホストを中心にした形で、ゲストどうしの状態はホストが中継する。
 * レベルアップの選択では、全員が最初の候補を選ぶ（ゲストはホストへ頼む）。
 */
function runGroup(
  count: number,
  ticks: number,
  delayTicks: number,
  move: Partial<MoveStats> = {},
  inspect?: (host: World, guests: World[]) => void,
) {
  const peers = Array.from({ length: count }, (_, k) => makePeer(k === 0 ? 'host' : 'guest', k + 1, count, move));
  const host = peers[0]!;
  const wire: { at: number; from: number; to: number; text: string }[] = [];
  const deliver = (msg: { from: number; to: number; text: string }): void => {
    const peer = peers[msg.to - 1]!;
    peer.inbox.push(...peer.session.incoming(peer.sim.world, decode(msg.text), msg.from));
  };
  const exchange = (t: number): void => {
    const toGuests = host.session.outgoing(host.sim.world);
    const forwards = host.session.takeForwards();
    for (const g of peers.slice(1)) {
      const msgs = [...toGuests, ...forwards.filter((f) => f.from !== g.id).flatMap((f) => f.messages)];
      if (msgs.length) wire.push({ at: t + delayTicks, from: 1, to: g.id, text: encode(msgs) });
      const up = g.session.outgoing(g.sim.world);
      if (up.length) wire.push({ at: t + delayTicks, from: g.id, to: 1, text: encode(up) });
    }
  };
  const busy = (): boolean => wire.length > 0 || peers.some((p) => p.sim.world.levelUp !== null);
  // 決めた回数だけ動き回った後、レベルアップの選択が終わって通信路が空くまで、止まったまま進める
  for (let t = 0; t < ticks || (busy() && t < ticks + 3000); t++) {
    for (const msg of wire.filter((w) => w.at <= t)) deliver(msg);
    wire.splice(0, wire.length, ...wire.filter((w) => w.at > t));
    for (const peer of peers) {
      // 全員が動き回る
      const dir: -1 | 0 | 1 = t >= ticks ? 0 : (t + peer.id * 37) % 120 < 60 ? 1 : -1;
      const cmds: InputCommand[] = [{ type: 'move', playerId: peer.id, dx: peer.id % 2 ? dir : 0, dy: peer.id % 2 ? 0 : dir }];
      const lu = peer.sim.world.levelUp;
      if (lu && !lu.done.has(peer.id)) {
        if (peer === host) cmds.push({ type: 'chooseUpgrade', playerId: 1, index: 0 });
        else if (!(peer as Peer & { asked?: number }).asked || (peer as Peer & { asked?: number }).asked !== lu.level) {
          (peer as Peer & { asked?: number }).asked = lu.level;
          peer.session.requestUpgrade('c', 0);
        }
      }
      peer.sim.step([...cmds, ...peer.inbox.splice(0)]);
    }
    exchange(t);
    inspect?.(host.sim.world, peers.slice(1).map((g) => g.sim.world));
  }
  // 通信路に残ったものを届けきる。ゲストは止まり、ホストの最後の更新の結果もゲストへ届ける
  for (const msg of wire) deliver(msg);
  wire.length = 0;
  for (const g of peers.slice(1)) g.sim.step([{ type: 'move', playerId: g.id, dx: 0, dy: 0 }, ...g.inbox.splice(0)]);
  host.sim.step(host.inbox.splice(0));
  exchange(0);
  for (const msg of wire) deliver(msg);
  for (const g of peers.slice(1)) g.sim.step(g.inbox.splice(0));
  return { host: host.sim.world, guests: peers.slice(1).map((g) => g.sim.world) };
}

function runPair(ticks: number, delayTicks: number, move: Partial<MoveStats> = {}, inspect?: (host: World, guest: World) => void) {
  const r = runGroup(2, ticks, delayTicks, move, inspect && ((h, gs) => inspect(h, gs[0]!)));
  return { host: r.host, guest: r.guests[0]! };
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

describe('ノックバック・状態異常の同期', () => {
  const attack: Partial<MoveStats> = { knockback: 240, knockbackSeconds: 0.12, status: 0, statusChance: 1, statusSeconds: 3 };

  /** 指定したプレイヤーが付けたやけどがかかっている敵がいるか */
  function hasBurnBy(w: World, by: number): boolean {
    const e = w.enemies;
    for (let i = 0; i < e.count; i++) if (e.statusTicks[i * e.statusCount]! > 0 && e.statusBy[i * e.statusCount]! === by) return true;
    return false;
  }

  it('ゲストが付けた状態異常はホストに、ホストが付けた状態異常はゲストに届く', () => {
    let hostSawGuest = false;
    let guestSawHost = false;
    runPair(600, 3, attack, (host, guest) => {
      hostSawGuest ||= hasBurnBy(host, 2);
      guestSawHost ||= hasBurnBy(guest, 1);
    });
    expect(hostSawGuest).toBe(true);
    expect(guestSawHost).toBe(true);
  });

  it('継続ダメージでの撃破もホストが確定し、ゲストと一致する', () => {
    const { host, guest } = runPair(900, 3, attack);
    expect(host.stats.kills).toBeGreaterThan(0);
    expect(guest.stats.kills).toBe(host.stats.kills);
    expect(Array.from(guest.enemies.id.subarray(0, guest.enemies.count)).sort((a, b) => a - b)).toEqual(
      Array.from(host.enemies.id.subarray(0, host.enemies.count)).sort((a, b) => a - b),
    );
  });

  it('ノックバックがあっても敵の位置のずれは補正で小さく保たれる', () => {
    const { host, guest } = runPair(901, 3, attack);
    const pos = new Map<number, [number, number]>();
    for (let i = 0; i < host.enemies.count; i++) pos.set(host.enemies.id[i]!, [host.enemies.x[i]!, host.enemies.y[i]!]);
    let worst = 0;
    for (let i = 0; i < guest.enemies.count; i++) {
      const p = pos.get(guest.enemies.id[i]!);
      if (p) worst = Math.max(worst, Math.hypot(p[0] - guest.enemies.x[i]!, p[1] - guest.enemies.y[i]!));
    }
    expect(worst).toBeLessThan(80);
  });
});

describe('経験値の玉の同期', () => {
  it('経験値の合計がホストとゲストで一致し、玉の集まりも一致する', () => {
    const { host, guest } = runPair(900, 3);
    expect(host.xp).toBeGreaterThan(0);
    expect(guest.xp).toBe(host.xp);
    const ids = (w: World) => Array.from(w.gems.id.subarray(0, w.gems.count)).sort((a, b) => a - b);
    expect(ids(guest)).toEqual(ids(host));
  });
});

describe('3人以上の協力プレイ', () => {
  it('4人でも敵・経験値・レベルがそろい、ゲストどうしの位置も届く', () => {
    const { host, guests } = runGroup(4, 1200, 3);
    expect(host.stats.kills).toBeGreaterThan(0);
    for (const g of guests) {
      expect(idsOf(g)).toEqual(idsOf(host));
      expect(g.xp).toBe(host.xp);
      expect(g.level).toBe(host.level);
    }
    // ゲスト2 の位置が、ホストの中継でゲスト3 に届いている
    const self = guests[0]!.players.find((p) => p.id === 2)!;
    const seen = guests[1]!.players.find((p) => p.id === 2)!;
    expect(Math.hypot(self.x - seen.x, self.y - seen.y)).toBeLessThan(1);
  });

  it('レベルアップの選択は全員同時で、選んだ強化が全員のブラウザでそろう', () => {
    const { host, guests } = runGroup(3, 1500, 3);
    expect(host.level).toBeGreaterThan(1);
    expect(host.levelUp).toBeNull();
    const loadout = (w: World) => w.players.map((p) => ({ id: p.id, moves: p.moves.map((m) => [m.move, m.level]), items: p.items, rerolls: p.rerolls }));
    for (const g of guests) {
      expect(g.levelUp).toBeNull();
      expect(loadout(g)).toEqual(loadout(host));
    }
  });
});
