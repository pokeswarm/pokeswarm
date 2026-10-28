import { describe, expect, it } from 'vitest';
import { buildSimRules } from '../data/simRules';
import { Simulation } from './simulation';
import { gateDeadlineTick } from './world';

/** 中ボス（gate）を制限時間で倒せなければ失敗（作者の決定 2026年10月28日。07 の106章） */
describe('中ボスの制限時間', () => {
  it('出てから制限時間がたっても倒せなければ失敗になり、その中ボスを知らせる', () => {
    const rules = buildSimRules();
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0 });
    const w = sim.world;
    const gate = w.bossSchedule.find((b) => b.wave === 0 && b.gate)!;
    const limit = Math.round(rules.stage.bossRules.gateTimeLimitSeconds! / w.dt);
    // すぐ中ボスが出るように区間の始まりをずらす
    w.sectionStartTick = w.tick - gate.afterTicks;
    sim.step([]);
    expect(w.gateIds.size).toBe(1);
    expect(gateDeadlineTick(w)).toBe(w.sectionStartTick + gate.afterTicks + limit);
    // 締め切りの直前では、まだ続く
    w.sectionStartTick = w.tick - gate.afterTicks - limit + 2;
    sim.step([]);
    expect(w.outcome).toBeNull();
    // 締め切りを過ぎると失敗
    w.sectionStartTick = w.tick - gate.afterTicks - limit;
    sim.step([]);
    expect(w.outcome).toBe('fail');
    const ended = w.events.find((e) => e.type === 'runEnded');
    expect(ended?.type === 'runEnded' && ended.gateTimeUp).toBe(gate.kind);
  });
});
