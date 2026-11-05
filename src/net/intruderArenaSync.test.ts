import { describe, expect, it } from 'vitest';
import { buildSimRules } from '../data/simRules';
import { Simulation } from '../sim/simulation';
import { startIntruder } from '../sim/systems/stage';
import { decode, encode } from './protocol';
import { SyncSession } from './sync';

/** 三犬の固定マップの 1 分戦を、ホストとゲストをつないで通す（07 の228章。実際の 2 人プレイの代わりではない） */
function run(id: string) {
  const rules = buildSimRules('johto');
  const rate = { playerStateIntervalTicks: 1, correctionIntervalTicks: 30 };
  const host = new Simulation({ tickRate: 30, seed: 3, rules, role: 'host', localPlayerId: 1 });
  const guest = new Simulation({ tickRate: 30, seed: 3, rules, role: 'guest', localPlayerId: 2 });
  for (const sim of [host, guest]) {
    sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 180, remote: sim === guest });
    sim.addPlayer({ id: 2, x: 60, y: 0, radius: 12, moveSpeed: 180, remote: sim === host });
    for (const p of sim.world.players) p.maxHp = p.hp = 1e9;
    sim.world.section = 3;
  }
  const hs = new SyncSession(rate, 1000, () => 0);
  const gs = new SyncSession(rate, 1000, () => 0);
  const kind = rules.enemies.kinds.findIndex((k) => k.id === id);
  const boss = (w: Simulation['world']): number => {
    for (let i = 0; i < w.enemies.count; i++) if (w.enemies.kind[i] === kind && w.enemies.hp[i]! > 0) return i;
    return -1;
  };
  const seen = { host: new Set<string>(), guest: new Set<string>(), hostActive: new Set<string>(), guestActive: new Set<string>() };
  const at = { hostIn: -1, guestIn: -1, hostOut: -1, guestOut: -1 };
  let lowered = false;
  let gap = 0;
  let gapCount = 0;
  for (let t = 0; t < 30 * 80; t++) {
    host.step([]);
    if (t === 30) startIntruder(host.world, kind);
    const h = host.world;
    const g = guest.world;
    // HP で出る大技も通す
    if (!lowered && h.arena && t > 400) {
      const i = boss(h);
      if (i !== -1) {
        h.enemies.hp[i] = h.enemies.maxHp[i]! * 0.49;
        lowered = true;
      }
    }
    guest.step(gs.incoming(g, decode(encode(hs.outgoing(h))), 1));
    if (h.arena && at.hostIn < 0) at.hostIn = t;
    if (g.arena && at.guestIn < 0) at.guestIn = t;
    if (!h.arena && at.hostIn >= 0 && at.hostOut < 0) at.hostOut = t;
    if (!g.arena && at.guestIn >= 0 && at.guestOut < 0) at.guestOut = t;
    for (const z of h.hazards) {
      const m = rules.stage.moves[z.move]!.id;
      seen.host.add(m);
      if (z.activeTicks !== undefined) seen.hostActive.add(m);
    }
    for (const z of g.hazards) {
      const m = rules.stage.moves[z.move]!.id;
      seen.guest.add(m);
      if (z.activeTicks !== undefined) seen.guestActive.add(m);
    }
    const a = boss(h);
    const b = boss(g);
    if (a !== -1 && b !== -1 && h.arena && g.arena) {
      gap += Math.hypot(h.enemies.x[a]! - g.enemies.x[b]!, h.enemies.y[a]! - g.enemies.y[b]!);
      gapCount++;
    }
  }
  return { seen, at, avgGap: gap / Math.max(1, gapCount), host, guest };
}

describe('三犬の 1 分戦の同期（07 の228章）', () => {
  it.each(['legend-raikou', 'legend-entei', 'legend-suicune'])('%s: 同じ時に移って戻り、技が全部ゲストへ届き、ボスの位置が揃う', (id) => {
    const { seen, at, avgGap, host, guest } = run(id);
    expect(at.hostIn).toBeGreaterThanOrEqual(0);
    expect(at.guestIn).toBe(at.hostIn);
    expect(at.hostOut).toBeGreaterThan(at.hostIn);
    expect(at.guestOut).toBe(at.hostOut);
    expect([...seen.host].filter((m) => !seen.guest.has(m))).toEqual([]);
    expect([...seen.hostActive].filter((m) => !seen.guestActive.has(m))).toEqual([]);
    expect(avgGap).toBeLessThan(60);
    expect(guest.world.arena).toBeNull();
    expect(host.world.arena).toBeNull();
  });

  it('スイクン: 大技（ふぶき）の氷の塊と吹雪の帯もゲストへ届く', () => {
    const { seen } = run('legend-suicune');
    for (const m of ['suicune-wave', 'suicune-aurora', 'suicune-mirror-coat', 'suicune-shard', 'suicune-ice', 'suicune-front-1', 'suicune-front-2']) expect(seen.guest).toContain(m);
  });
});
