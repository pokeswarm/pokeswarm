import { describe, expect, it } from 'vitest';
import type { InputCommand } from '../sim/commands';
import { MOTION_LINEAR, SHAPE_CIRCLE } from '../sim/entities/projectiles';
import { Simulation } from '../sim/simulation';
import { addBox } from '../sim/systems/boxes';
import { testRules } from '../sim/testRules';
import type { SimRole } from '../sim/world';
import { decode, encode } from './protocol';
import { SyncSession } from './sync';

/** 協力プレイの箱と箱の強化（作者の報告 2026年10月25日: マルチで取るとおかしくなることがある） */
const rate = { playerStateIntervalTicks: 1, correctionIntervalTicks: 30 };

function rules() {
  return testRules({
    move: { range: 1 },
    pickups: {
      boxes: { max: 0, hits: 1, radius: 14, spawnSeconds: 999, firstSpawnSeconds: 999, distanceMin: 300, distanceMax: 400, despawnDistance: 5000 },
      items: {
        potion: { dropChance: 0, healPct: 30 },
        magnet: { dropChance: 0, speed: 1400 },
        'rare-candy': { revealSeconds: 1, holdSeconds: 1, levels: [{ levels: 1, weight: 1 }] },
        buff: { buffs: [{ item: 'x-speed', seconds: 10, mods: { moveSpeedPct: 50 }, weight: 1 }] },
      },
    },
  });
}

function peer(role: SimRole, localId: number) {
  const sim = new Simulation({ tickRate: 30, seed: 3, rules: rules(), role, localPlayerId: localId });
  sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 150, remote: localId !== 1 });
  sim.addPlayer({ id: 2, x: 200, y: 0, radius: 12, moveSpeed: 150, remote: localId !== 2 });
  return { sim, session: new SyncSession(rate, 1000, () => 0), inbox: [] as InputCommand[] };
}

function setup() {
  const host = peer('host', 1);
  const guest = peer('guest', 2);
  // hostHook: ホストの更新の後、送る前に呼ぶ（箱を出すなど。更新の始めに出来事が消えるため）
  const step = (hostHook?: () => void): void => {
    host.sim.step(host.inbox.splice(0));
    hostHook?.();
    guest.sim.step(guest.inbox.splice(0));
    const down = host.session.outgoing(host.sim.world);
    const up = guest.session.outgoing(guest.sim.world);
    if (down.length) guest.inbox.push(...guest.session.incoming(guest.sim.world, decode(encode(down)), 1));
    if (up.length) host.inbox.push(...host.session.incoming(host.sim.world, decode(encode(up)), 2));
  };
  // world の当たり判定に、owner の攻撃を置く（既定はホストの画面にホストの攻撃）
  const shoot = (x: number, y: number, world = host.sim.world, owner = 1): void => {
    world.projectiles.add({
      owner, move: 0, level: 1, motion: MOTION_LINEAR, x, y, vx: 0, vy: 0, ox: 0, oy: 0, angle: 0, angularSpeed: 0, orbitRadius: 0,
      life: 0.1, damage: 1, radius: 10, pierce: Infinity, hitIntervalTicks: 0, shape: SHAPE_CIRCLE, length: 0, dirX: 1, dirY: 0, growth: 0, stage: 0,
    });
  };
  return { host, guest, step, shoot };
}

describe('協力プレイの箱', () => {
  it('ホストが出した箱はゲストにも出て、開くと両方から消え、強化の道具が両方に出る', () => {
    const { host, guest, step, shoot } = setup();
    step(() => addBox(host.sim.world, 7, 600, 0));
    step();
    expect(guest.sim.world.boxes.map((b) => b.id)).toEqual([7]);
    shoot(600, 0);
    step();
    step();
    expect(host.sim.world.boxes).toHaveLength(0);
    expect(guest.sim.world.boxes).toHaveLength(0);
    expect(host.sim.world.items.map((i) => i.kind)).toEqual(['buff']);
    expect(guest.sim.world.items.map((i) => i.kind)).toEqual(['buff']);
  });

  it('ゲストが拾った強化は、両方のブラウザでゲストだけに効き、時間で切れる', () => {
    const { host, guest, step, shoot } = setup();
    step(() => addBox(host.sim.world, 7, 600, 0));
    step();
    shoot(600, 0);
    step();
    step();
    // ゲストが道具の上へ（ゲストの位置はゲストのブラウザが決めて送る）
    const me = guest.sim.world.players.find((p) => p.id === 2)!;
    me.x = 600;
    me.y = 0;
    for (let t = 0; t < 10; t++) step();
    for (const w of [host.sim.world, guest.sim.world]) {
      expect(w.items).toHaveLength(0);
      expect(w.players.find((p) => p.id === 2)!.buffs?.length).toBe(1);
      expect(w.players.find((p) => p.id === 1)!.buffs?.length ?? 0).toBe(0);
    }
    for (let t = 0; t < 10 * 30 + 30; t++) step();
    for (const w of [host.sim.world, guest.sim.world]) expect(w.players.find((p) => p.id === 2)!.buffs?.length ?? 0).toBe(0);
  });

  it('ゲストの攻撃は、ゲストのブラウザで当たりを判定してホストへ伝え、箱が開く', () => {
    const { host, guest, step, shoot } = setup();
    step(() => addBox(host.sim.world, 7, 600, 0));
    step();
    shoot(600, 0, guest.sim.world, 2);
    for (let t = 0; t < 4; t++) step();
    expect(host.sim.world.boxes).toHaveLength(0);
    expect(guest.sim.world.boxes).toHaveLength(0);
    expect(guest.sim.world.items.map((i) => i.kind)).toEqual(['buff']);
  });

  it('ホストの画面にあるゲストの攻撃（見た目だけの写し）では、箱を開けない', () => {
    const { host, guest, step, shoot } = setup();
    step(() => addBox(host.sim.world, 7, 600, 0));
    step();
    shoot(600, 0, host.sim.world, 2);
    for (let t = 0; t < 4; t++) step();
    expect(host.sim.world.boxes).toHaveLength(1);
    expect(guest.sim.world.boxes).toHaveLength(1);
  });
});
