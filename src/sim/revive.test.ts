import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { testRules } from './testRules';
import type { SimRole } from './world';

/** 協力プレイ: プレイヤー1（ホスト）と、倒れたプレイヤー2。touchSeconds 1秒・touchRange 40 */
function coop(role: SimRole, revives: number, distance: number) {
  const rules = testRules({ move: { range: 1 }, stats: { revive: { initialCount: revives, hpPct: 50, invincibleSeconds: 2, touchSeconds: 1, touchRange: 40 } } });
  const local = role === 'host' ? 1 : 2;
  const sim = new Simulation({ tickRate: 30, seed: 1, rules, role, localPlayerId: local });
  const a = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, remote: local !== 1 });
  const b = sim.addPlayer({ id: 2, x: distance, y: 0, radius: 12, moveSpeed: 0, remote: local !== 2 });
  b.down = true;
  b.hp = 0;
  return { sim, a, b };
}

describe('触れて復活（協力プレイ）', () => {
  it('倒れた味方に触れ続けると、ホストが復活させ、共有の復活可能数が減る', () => {
    const { sim, b } = coop('host', 2, 30);
    const events: string[] = [];
    for (let t = 0; t < 29; t++) sim.step([]);
    expect(b.down).toBe(true);
    sim.step([]);
    events.push(...sim.world.events.map((e) => e.type));
    expect(b.down).toBe(false);
    expect(b.hp).toBe(b.maxHp / 2);
    expect(sim.world.revives).toBe(1);
    expect(events).toContain('playerRevived');
  });

  it('離れていると数えず、復活可能数が無ければ復活しない', () => {
    const far = coop('host', 2, 200);
    for (let t = 0; t < 60; t++) far.sim.step([]);
    expect(far.b.down).toBe(true);
    const none = coop('host', 0, 30);
    for (let t = 0; t < 60; t++) none.sim.step([]);
    expect(none.b.down).toBe(true);
  });

  it('ゲストは自分では復活させず、ホストの知らせで復活する（HP と無敵時間は本人のブラウザで戻す）', () => {
    const { sim, b } = coop('guest', 2, 30);
    for (let t = 0; t < 60; t++) sim.step([]);
    expect(b.down).toBe(true);
    // 表示のために、触れている時間は数えている
    expect(sim.world.reviveTouch.get(2)).toBe(30);
    sim.step([{ type: 'revivePlayer', playerId: 2, revives: 1 }]);
    expect(b.down).toBe(false);
    expect(b.hp).toBe(b.maxHp / 2);
    expect(b.invincibleTicks).toBeGreaterThan(0);
    expect(sim.world.revives).toBe(1);
  });

  it('復活させた直後は、本人から遅れて届く「倒れている」を無視する', () => {
    const { sim, b } = coop('host', 2, 30);
    for (let t = 0; t < 30; t++) sim.step([]);
    expect(b.down).toBe(false);
    sim.step([{ type: 'remotePlayer', playerId: 2, x: 30, y: 0, facingX: 0, facingY: 1, inputX: 0, inputY: 0, hp: 0, maxHp: 100, down: true }]);
    expect(b.down).toBe(false);
    expect(sim.world.revives).toBe(1);
  });
});
