import { describe, expect, it } from 'vitest';
import { buildSimRules, playableLoadout } from '../data/simRules';
import type { InputCommand } from '../sim/commands';
import { Simulation } from '../sim/simulation';
import type { SimRole } from '../sim/world';
import { decode, encode } from './protocol';
import { SyncSession } from './sync';

/** 本番のデータで箱を早く出し、4人で長く回して、ホストとゲストの箱・道具・強化がずれないか（協力プレイの箱の不具合の調査で作った。2026年10月26日） */
const rate = { playerStateIntervalTicks: 1, correctionIntervalTicks: 10 };

function makePeer(role: SimRole, localId: number, count: number) {
  const rules = buildSimRules();
  (rules as { pickups: typeof rules.pickups }).pickups = { ...rules.pickups, boxes: { ...rules.pickups.boxes!, max: 6, spawnSeconds: 2, firstSpawnSeconds: 1, hits: 1, distanceMin: 60, distanceMax: 160 } };
  const sim = new Simulation({ tickRate: 30, seed: 11, rules, role, localPlayerId: localId });
  const lo = playableLoadout(rules, 'charmander');
  for (let id = 1; id <= count; id++) {
    sim.addPlayer({ id, x: (id - 1) * 50, y: 0, radius: 12, moveSpeed: 180, remote: localId !== id, types: lo.types, moveTypes: lo.moveTypes, moves: lo.moves.map((m) => ({ ...m, level: 8 })), line: lo.line, species: lo.species, pickupRange: 50 });
  }
  return { id: localId, sim, session: new SyncSession(rate, 1000, () => 0), inbox: [] as InputCommand[], asked: -1 };
}

describe('協力プレイの箱（長く回す）', () => {
  it('4人で長く回しても、箱・道具・強化がずれない', () => {
    const count = 4;
    const delay = 4;
    const peers = Array.from({ length: count }, (_, k) => makePeer(k === 0 ? 'host' : 'guest', k + 1, count));
    const host = peers[0]!;
    const wire: { at: number; from: number; to: number; text: string }[] = [];
    const problems: string[] = [];
    const picked: Record<number, number> = {};
    const history = new Map<number, { boxes: string; items: string[]; buffs: { index: number; ticksLeft: number }[][] }>();
    for (let t = 0; t < 30 * 90; t++) {
      for (const msg of wire.filter((w) => w.at <= t)) {
        const p = peers[msg.to - 1]!;
        p.inbox.push(...p.session.incoming(p.sim.world, decode(msg.text), msg.from));
      }
      wire.splice(0, wire.length, ...wire.filter((w) => w.at > t));
      for (const peer of peers) {
        const a = ((t / 40 + peer.id) | 0) % 4;
        const dir = [[1, 0], [0, 1], [-1, 0], [0, -1]][a]!;
        const cmds: InputCommand[] = [{ type: 'move', playerId: peer.id, dx: dir[0] as -1 | 0 | 1, dy: dir[1] as -1 | 0 | 1 }];
        const lu = peer.sim.world.levelUp;
        if (lu && !lu.done.has(peer.id)) {
          if (peer === host) cmds.push({ type: 'chooseUpgrade', playerId: 1, index: 0 });
          else if (peer.asked !== lu.serial) {
            peer.asked = lu.serial;
            peer.session.requestUpgrade('c', 0);
          }
        }
        peer.sim.step([...cmds, ...peer.inbox.splice(0)]);
      }
      for (const ev of host.sim.world.events) if (ev.type === 'itemCollected' && ev.kind === 'buff') picked[ev.by] = (picked[ev.by] ?? 0) + 1;
      const down = host.session.outgoing(host.sim.world);
      const forwards = host.session.takeForwards();
      for (const g of peers.slice(1)) {
        const msgs = [...down, ...forwards.filter((f) => f.from !== g.id).flatMap((f) => f.messages)];
        if (msgs.length) wire.push({ at: t + delay, from: 1, to: g.id, text: encode(msgs) });
        const up = g.session.outgoing(g.sim.world);
        if (up.length) wire.push({ at: t + delay, from: g.id, to: 1, text: encode(up) });
      }
      // ホストの状態を覚えておき、遅れ（delay）の分だけ後のゲストと比べる（ゲストは t + delay の更新で、ホストの t までを受け取っている）
      const hw = host.sim.world;
      history.set(t, {
        boxes: hw.boxes.map((b) => b.id).sort().join(','),
        items: hw.items.map((i) => String(i.id)),
        buffs: hw.players.map((p) => (p.buffs ?? []).map((x) => ({ index: x.index, ticksLeft: x.ticksLeft }))),
      });
      const then = history.get(t - delay);
      if (!then) continue;
      for (const g of peers.slice(1)) {
        const gw = g.sim.world;
        const gb = gw.boxes.map((b) => b.id).sort().join(',');
        if (then.boxes !== gb) problems.push('t' + t + ' boxes host[' + then.boxes + '] guest' + g.id + '[' + gb + ']');
        // ゲストが拾おうとしている（返事待ちの）道具は数えない
        const pending = new Set(gw.items.filter((i) => i.pending).map((i) => String(i.id)));
        const hi = then.items.filter((id) => !pending.has(id)).sort().join(',');
        const gi = gw.items.filter((i) => !i.pending).map((i) => String(i.id)).sort().join(',');
        if (hi !== gi) problems.push('t' + t + ' items host[' + hi + '] guest' + g.id + '[' + gi + ']');
        gw.players.forEach((q, k) => {
          // ゲストはレベルアップで止まる長さがホストと1更新ずれることがあり、強化の残りが1更新だけ違う。切れる直前の1更新の強化は、片方に無くてもよい（2026年10月28日）
          const hb = then.buffs[k]!;
          const gb2 = q.buffs ?? [];
          const missing = (a: typeof hb, b: typeof hb) => a.filter((x) => x.ticksLeft > 1 && !b.some((y) => y.index === x.index)).map((x) => x.index);
          const diff = [...missing(hb, gb2), ...missing(gb2, hb)];
          if (diff.length) problems.push('t' + t + ' buffs of ' + q.id + ' host[' + hb.map((x) => x.index).sort().join(',') + '] guest' + g.id + '[' + gb2.map((x) => x.index).sort().join(',') + ']');
        });
      }
    }
    console.log('picked', JSON.stringify(picked), 'boxes', host.sim.world.nextBoxId, 'items', host.sim.world.nextItemId, 'problems', problems.length, '\n' + problems.slice(0, 20).join('\n'));
    expect(problems).toEqual([]);
  });
});
