import { describe, expect, it } from 'vitest';
import { DMG_CRIT, type DamageNumberEvent } from './events';
import { Simulation } from './simulation';
import { testRules } from './testRules';

/** ダメージの数字（07 の102章）: 設定でオンのときだけ、自分の攻撃の命中ごとに出す。ランの進み方は変わらない */
function make(on: boolean) {
  const rules = testRules({ spawn: { spawnPerSecond: 0 }, move: { power: 5, cooldownSeconds: 0.2, range: 300, pierce: 1 } });
  const sim = new Simulation({ tickRate: 30, seed: 1, rules, role: 'solo', localPlayerId: 1 });
  sim.world.damageNumbers = on;
  sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, moves: [{ move: 0, level: 1 }] });
  sim.step([{ type: 'spawnEnemy', id: 1, kind: 0, x: 60, y: 0 }]);
  return sim;
}

const collect = (sim: Simulation, n: number): DamageNumberEvent[] => {
  const out: DamageNumberEvent[] = [];
  for (let t = 0; t < n; t++) {
    sim.step([]);
    for (const ev of sim.world.events) if (ev.type === 'damageNumber') out.push(ev);
  }
  return out;
};

describe('ダメージの数字', () => {
  it('オンなら命中ごとに出て、オフなら出ない。どちらでも敵の HP は同じ', () => {
    const on = make(true);
    const off = make(false);
    const shown = collect(on, 30);
    expect(collect(off, 30)).toHaveLength(0);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown[0]!.enemyId).toBe(1);
    expect(shown[0]!.amount).toBeGreaterThan(0);
    // 急所の率が 0 のルールなので、きゅうしょの印は付かない
    expect(shown.every((ev) => !(ev.flags & DMG_CRIT))).toBe(true);
    expect(on.world.enemies.hp[0]).toBe(off.world.enemies.hp[0]);
  });
});
