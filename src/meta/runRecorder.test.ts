import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim/simulation';
import { testRules } from '../sim/testRules';
import type { SimRole } from '../sim/world';
import { RunRecorder } from './runRecorder';
import { SaveStore } from './saveStore';

/** 番号0が雑魚（ポケモン test）、番号1が中ボス（ポケモン mid） */
function setup(role: SimRole = 'solo', localId = 1) {
  const store = new SaveStore(null, null);
  const rules = testRules({
    move: { range: 1 },
    extraKinds: [{ id: 'mid', rank: 'midboss', hp: 500, moveSpeed: 0, radius: 20, contactDamage: 0, xp: 0, types: [0] }],
  });
  const sim = new Simulation({ tickRate: 30, seed: 1, rules, role, localPlayerId: localId });
  sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, remote: localId !== 1 });
  if (role !== 'solo') sim.addPlayer({ id: 2, x: 0, y: 0, radius: 12, moveSpeed: 0, remote: localId !== 2 });
  const rec = new RunRecorder(store, 'charmander');
  /** 敵を出して、by のプレイヤーが倒したことにする（ホスト・ソロは命中、ゲストはホストの確定） */
  const kill = (kind: number, by: number) => {
    const id = sim.world.nextEnemyId++;
    sim.world.enemies.add(id, kind, 300, 0, 10, 0, 10);
    const cmd =
      role === 'guest'
        ? ({ type: 'killEnemy', id, by } as const)
        : ({ type: 'damageEnemy', id, amount: 999, by, kbx: 0, kby: 0, kbTicks: 0, status: -1, statusTicks: 0 } as const);
    sim.step([cmd]);
    rec.observe(sim.world);
  };
  return { store, sim, rec, kill };
}

describe('ランの記録', () => {
  it('ジョウトのランは、記録の名前の頭に johto: を付け、カントーの記録を進めない（コインの合計だけは共通）', () => {
    const { store, sim, kill } = setup();
    const rec = new RunRecorder(store, 'charmander', null, null, 'johto');
    kill(0, 1);
    rec.observe(sim.world);
    sim.world.outcome = 'clear';
    rec.finish(sim.world);
    const s = store.current.stats;
    expect(s.kills).toBeUndefined();
    expect(s.clears).toBeUndefined();
    expect(s['johto:clears']).toBe(1);
    expect(s['johto:clears.charmander']).toBe(1);
    expect(s['johto:bestKills']).toBeDefined();
    expect(Object.keys(s).every((k) => k.startsWith('johto:') || k === 'coinsEarned')).toBe(true);
  });

  it('途中の記録と終了時の記録を、同じ分を2回足さずにまとめる', () => {
    const { store, sim, rec, kill } = setup();
    for (let k = 0; k < 3; k++) kill(0, 1);
    for (let t = 0; t < 60; t++) sim.step([]);
    rec.commit(sim.world);
    rec.commit(sim.world);
    expect(store.current.stats.kills).toBe(3);
    expect(store.current.stats['defeated.test']).toBe(3);
    expect(store.current.stats.playSeconds).toBe(2);
    kill(0, 1);
    sim.world.outcome = 'clear';
    rec.finish(sim.world);
    rec.finish(sim.world);
    const s = store.current.stats;
    expect(s.kills).toBe(4);
    expect(s.runs).toBe(1);
    expect(s.clears).toBe(1);
    expect(s['clears.charmander']).toBe(1);
    expect(s['clears.solo']).toBe(1);
    expect(s.bestKills).toBe(4);
  });

  it('そのポケモンで倒した中ボスの数の最高・届いたレベルの最高を記録し、クリアした種類を数え直す', () => {
    const { store, sim, rec, kill } = setup();
    kill(1, 1);
    kill(1, 1);
    sim.world.outcome = 'clear';
    const rec2 = new RunRecorder(store, 'charmander', null, { playables: ['charmander', 'squirtle'], uniqueMoves: ['blast-burn'] });
    rec.finish(sim.world);
    rec2.finish(sim.world);
    const s = store.current.stats;
    expect(s['reached.charmander']).toBe(2);
    expect(s['bestLevel.charmander']).toBe(sim.world.level);
    expect(s.distinctClears).toBe(1);
    expect(s.uniqueKinds).toBe(0);
  });

  it('協力プレイ: 雑魚はとどめを刺した人だけ、中ボス・ボスは全員に数える', () => {
    const { store, sim, rec, kill } = setup('guest', 2);
    kill(0, 1); // ホストが倒した雑魚: 数えない
    kill(0, 2); // 自分が倒した雑魚
    kill(1, 1); // ホストが倒した中ボス: 全員に数える
    rec.commit(sim.world);
    const s = store.current.stats;
    expect(s.kills).toBe(1);
    expect(s['defeated.test']).toBe(1);
    expect(s['defeated.mid']).toBe(1);
    expect(s['bossDefeated.mid']).toBe(1);
    expect(s['bossDefeated.test']).toBeUndefined();
    expect(s.midbossKills).toBe(1);
  });
});
