import { describe, expect, it } from 'vitest';
import { statusConfig } from '../data';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { SHAPE_BOX, SHAPE_CIRCLE } from './entities/projectiles';
import { canLearnNewMove } from './systems/leveling';

/** ゴーストの技の追加: したでなめる・おどろかす（作者の依頼 2026年11月1日。07 の147章） */
function setup(pokemon: string, move: string, region: string, level = 1) {
  const rules = buildSimRules(region);
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const lo = playableLoadout(rules, pokemon);
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, types: lo.types, moveTypes: lo.moveTypes, moves: [{ ...lo.moves[0]!, move: moveIndexOf(rules, move), level }], line: lo.line, species: lo.species });
  return { rules, sim, p };
}

const statusIndex = (id: string): number => statusConfig.kinds.findIndex((k) => k.id === id);

describe('したでなめる', () => {
  it('正面の長方形にベロの当たり判定を出す近接の技（物理）。まひさせることがある', () => {
    const { rules, sim } = setup('gastly', 'lick', 'johto');
    const def = rules.moves[moveIndexOf(rules, 'lick')]!;
    expect(def.pattern).toBe('melee');
    expect(def.frontBox).toBeTruthy();
    expect(def.damageClass).toBe('physical');
    expect(def.levels[0]!.status).toBe(statusIndex('paralysis'));
    expect(def.levels[0]!.statusChance).toBeGreaterThan(0);
    sim.step([]);
    const pr = sim.world.projectiles;
    expect(pr.count).toBe(1);
    expect(pr.shape[0]).toBe(SHAPE_BOX);
  });

  it('ゴーストのポケモン（ゴース・カゲボウズ）が候補に出る', () => {
    for (const [pokemon, region] of [
      ['gastly', 'johto'],
      ['shuppet', 'hoenn'],
    ] as const) {
      const { rules, sim, p } = setup(pokemon, 'night-shade', region);
      expect(canLearnNewMove(sim.world, p, moveIndexOf(rules, 'lick')), pokemon).toBe(true);
    }
  });

  it('のろいのおふだで おどろかす に派生する', () => {
    const rules = buildSimRules('johto');
    const item = rules.items.findIndex((i) => i.key === 'spell-tag');
    expect(rules.derivations.some((d) => d.from === moveIndexOf(rules, 'lick') && d.item === item && d.to === moveIndexOf(rules, 'astonish') && d.line === null)).toBe(true);
  });
});

describe('おどろかす', () => {
  it('届く範囲のランダムな敵の足元に当たり判定を置き（落雷の形）、短い再使用で繰り返す。ひるませることがある', () => {
    const { rules, sim } = setup('gastly', 'astonish', 'johto');
    const def = rules.moves[moveIndexOf(rules, 'astonish')]!;
    expect(def.pattern).toBe('strike');
    expect(def.levels[0]!.cooldownSeconds).toBeLessThanOrEqual(0.5);
    expect(def.levels[0]!.status).toBe(statusIndex('flinch'));
    sim.step([{ type: 'spawnEnemy', id: 1, kind: 0, x: 120, y: 40 }]);
    sim.step([]);
    const pr = sim.world.projectiles;
    expect(pr.count).toBe(1);
    expect(pr.shape[0]).toBe(SHAPE_CIRCLE);
    // 敵の足元に出て（敵はその更新で少し歩く）、その場に留まる（幻影は敵の影から出る）
    expect(Math.hypot(pr.x[0]! - 120, pr.y[0]! - 40)).toBeLessThan(6);
    const x0 = pr.x[0]!;
    sim.step([]);
    expect(pr.x[0]).toBe(x0);
  });

  it('敵がいなければ出ない', () => {
    const { sim } = setup('gastly', 'astonish', 'johto');
    sim.step([]);
    expect(sim.world.projectiles.count).toBe(0);
  });
});
