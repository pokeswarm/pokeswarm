import { describe, expect, it } from 'vitest';
import { buildSimRules } from '../data/simRules';
import { Simulation } from './simulation';
import { addBox } from './systems/boxes';
import { applyItem } from './systems/items';
import { MOTION_LINEAR, SHAPE_CIRCLE } from './entities/projectiles';

/**
 * マップの箱（作者の決定 2026年10月25日）: 攻撃を決まった回数当てると開き、一時的な強化を落とす。
 * 拾うと決まった時間だけ効き、時間が切れると外れる
 */
function setup() {
  const rules = buildSimRules();
  // 本番のデータでは止めている（max 0。協力プレイの不具合の調査中）ので、テストでは出す
  (rules as { pickups: typeof rules.pickups }).pickups = { ...rules.pickups, boxes: { ...rules.pickups.boxes!, max: 3 } };
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, moves: [] });
  return { rules, sim, p };
}

function shoot(sim: Simulation, x: number, y: number): void {
  sim.world.projectiles.add({
    owner: 1, move: 0, level: 1, motion: MOTION_LINEAR, x, y, vx: 0, vy: 0, ox: 0, oy: 0, angle: 0, angularSpeed: 0, orbitRadius: 0,
    life: 0.1, damage: 1, radius: 10, pierce: Infinity, hitIntervalTicks: 0, shape: SHAPE_CIRCLE, length: 0, dirX: 1, dirY: 0, growth: 0, stage: 0,
  });
}

describe('マップの箱', () => {
  it('本番のデータでは出さない（協力プレイで不具合があるため止めている。2026年10月25日）', () => {
    const rules = buildSimRules();
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, moves: [] });
    for (let t = 0; t < 120 * 30; t++) sim.step([]);
    expect(sim.world.boxes).toHaveLength(0);
  });

  it('しばらくすると、プレイヤーの周りに出る', () => {
    const { rules, sim } = setup();
    const cfg = rules.pickups.boxes!;
    for (let t = 0; t < cfg.firstSpawnSeconds * 30 + 2; t++) sim.step([]);
    expect(sim.world.boxes).toHaveLength(1);
    const b = sim.world.boxes[0]!;
    const d = Math.hypot(b.x, b.y);
    expect(d).toBeGreaterThanOrEqual(cfg.distanceMin - 1);
    expect(d).toBeLessThanOrEqual(cfg.distanceMax + 1);
  });

  it('別々の攻撃を決まった回数当てると開き、強化の道具を落とす（同じ攻撃は1回だけ数える）', () => {
    const { rules, sim } = setup();
    addBox(sim.world, 99, 300, 0);
    shoot(sim, 300, 0);
    sim.step([]);
    sim.step([]);
    expect(sim.world.boxes[0]!.hp).toBe(rules.pickups.boxes!.hits - 1);
    for (let k = 1; k < rules.pickups.boxes!.hits; k++) {
      for (let t = 0; t < 6; t++) sim.step([]);
      shoot(sim, 300, 0);
      sim.step([]);
    }
    expect(sim.world.boxes).toHaveLength(0);
    expect(sim.world.items.some((it) => it.kind === 'buff')).toBe(true);
  });

  it('拾った強化は決まった時間だけ効き、切れると外れる', () => {
    const { rules, sim, p } = setup();
    const k = rules.pickups.items.buff!.buffs.findIndex((b) => b.item === 'x-speed');
    const def = rules.pickups.items.buff!.buffs[k]!;
    const before = p.moveSpeed;
    sim.world.items.push({ id: 5, kind: 'buff', x: 0, y: 0, pending: false });
    applyItem(sim.world, 5, 1, 'buff', k);
    expect(p.moveSpeed).toBeCloseTo(before * (1 + (def.mods.moveSpeedPct ?? 0) / 100));
    for (let t = 0; t < def.seconds * 30 + 2; t++) sim.step([]);
    expect(p.buffs).toHaveLength(0);
    expect(p.moveSpeed).toBeCloseTo(before);
  });
});
