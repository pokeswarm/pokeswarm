import { describe, expect, it } from 'vitest';
import { playerConfig } from '../data';
import { buildSimRules } from '../data/simRules';
import { Simulation } from './simulation';
import { CASTER_ID_BASE } from './systems/attack';
import { legendTurnIsActive, legendTurns, startLegendary } from './systems/stage';

/** レッド戦の作り直し（07 の193章）: 隙・交代・回復の回数の上限・きずぐすり */
function round(index: number, players = 1, role: 'host' | 'guest' | undefined = undefined) {
  const rules = buildSimRules('johto');
  const sim = new Simulation({ tickRate: 30, seed: 3, rules, ...(role ? { role, localPlayerId: 1 } : {}) });
  for (let k = 1; k <= players; k++) sim.addPlayer({ id: k, x: k * 30, y: 0, radius: 12, moveSpeed: 0 });
  for (const p of sim.world.players) p.invincibleTicks = 1e9;
  sim.step([]);
  const r = rules.stage.legendary!.rounds![index]!;
  startLegendary(sim.world, rules.enemies.kinds.findIndex((k) => k.id === r.kinds[0]), index);
  for (let k = 0; k < 95; k++) sim.step([]);
  return sim;
}

const indexOf = (sim: Simulation, id: string): number => {
  const e = sim.world.enemies;
  const kind = sim.world.rules.enemies.kinds.findIndex((k) => k.id === id);
  for (let i = 0; i < e.count; i++) if (e.kind[i] === kind && e.hp[i]! > 0) return i;
  return -1;
};
const moveId = (sim: Simulation, m: number): string => sim.world.rules.stage.moves[m]!.id;

describe('レッド戦（07 の193章）', () => {
  it('どの相手も、走っていないときはプレイヤーより遅い（離れて避けられる）', () => {
    const rules = buildSimRules('johto');
    const mul = rules.stage.bossRules.legendSpeedMultiplier ?? 1;
    for (const k of rules.enemies.kinds.filter((x) => x.id.startsWith('red-'))) {
      expect(k.moveSpeed * mul, k.id).toBeLessThan(playerConfig.moveSpeed);
    }
  });

  it('レッドの相手に必中の技（予告が追ってくる技）は無い', () => {
    const rules = buildSimRules('johto');
    const sets = rules.stage.legendary!.moveSets;
    for (const [id, set] of Object.entries(sets)) {
      if (!id.startsWith('red-')) continue;
      for (const m of set.moves) expect(rules.stage.moves.find((x) => x.id === m)?.homing, m).toBeFalsy();
    }
  });

  it('ピカチュウ: 消えているか走っている時間は半分未満で、止まっている隙が 2 割以上ある', () => {
    const sim = round(0);
    const w = sim.world;
    const i = indexOf(sim, 'red-pikachu');
    const id = w.enemies.id[i]!;
    let gone = 0;
    let still = 0;
    const ticks = 30 * 60;
    for (let k = 0; k < ticks; k++) {
      sim.step([]);
      const boss = w.bosses.find((b) => b.id === id);
      if (w.hiddenEnemies.has(id) || boss?.bounce) gone++;
      else if (w.enemies.speed[indexOf(sim, 'red-pikachu')] === 0) still++;
    }
    expect(gone / ticks).toBeLessThan(0.5);
    expect(still / ticks).toBeGreaterThan(0.2);
  });

  it('ボルテッカーの後に反動で止まり、その間は技も 10まんボルトも出さない', () => {
    const sim = round(0);
    const w = sim.world;
    let recoilAt = -1;
    for (let k = 0; k < 30 * 30 && recoilAt === -1; k++) {
      sim.step([]);
      if (w.hazards.some((h) => moveId(sim, h.move) === 'pika-recoil')) recoilAt = w.tick;
    }
    expect(recoilAt).toBeGreaterThan(-1);
    // 止まる前に撃った分（2 発目の遅れ）が出終わるのを待つ
    for (let k = 0; k < 10; k++) sim.step([]);
    const bossShots = (): number => {
      let n = 0;
      for (let i = 0; i < w.projectiles.count; i++) if (w.projectiles.owner[i]! >= CASTER_ID_BASE) n++;
      return n;
    };
    let added = 0;
    for (let k = 0; k < 30; k++) {
      const n = bossShots();
      sim.step([]);
      expect(w.enemies.speed[indexOf(sim, 'red-pikachu')]).toBe(0);
      added += Math.max(0, bossShots() - n);
    }
    expect(added).toBe(0);
  });

  it('交代: 第 3 ラウンドは順番の 1 体だけが動き、順番でない相手は遅く歩いて技を使わない', () => {
    const sim = round(2);
    const w = sim.world;
    const ids = ['red-venusaur', 'red-charizard', 'red-blastoise'];
    const seen = new Set<string>();
    for (let k = 0; k < 30 * 30; k++) {
      sim.step([]);
      const active = ids.filter((id) => legendTurnIsActive(w, indexOf(sim, id)));
      expect(active.length).toBe(1);
      seen.add(active[0]!);
      for (const id of ids) {
        if (id === active[0]) continue;
        const i = indexOf(sim, id);
        const bid = w.enemies.id[i]!;
        // 順番が変わった直後は前の技の続きが残るので、新しく始めた技だけを見る
        if (w.hazards.some((h) => h.dasher === bid && h.ticksLeft === h.totalTicks)) throw new Error(`${id} が順番でないのに技を始めた`);
      }
    }
    expect(seen.size).toBe(3);
  });

  it('交代: 相手が 1 体になると交代は終わり、常に動く', () => {
    const sim = round(1);
    const w = sim.world;
    const espeon = indexOf(sim, 'red-espeon');
    expect(legendTurns(w, espeon)).not.toBeNull();
    sim.step([{ type: 'damageEnemy', id: w.enemies.id[espeon]!, amount: 1e9, by: 1, kbx: 0, kby: 0, kbTicks: 0, status: -1, statusTicks: 0 }]);
    sim.step([]);
    const snorlax = indexOf(sim, 'red-snorlax');
    expect(legendTurns(w, snorlax)).toBeNull();
    expect(legendTurnIsActive(w, snorlax)).toBe(true);
  });

  it('交代の順番は残り時間から決まるので、ゲストでも同じになる', () => {
    const host = round(2);
    const guest = round(2);
    // ゲストの残り時間は、ホストから届いた残り（ticksLeft）に自分の更新番号を足したもの
    const left = host.world.legendary!.endTick - host.world.tick;
    guest.world.tick += 1234;
    guest.world.legendary!.endTick = guest.world.tick + left;
    for (const id of ['red-venusaur', 'red-charizard', 'red-blastoise']) {
      expect(legendTurnIsActive(guest.world, indexOf(guest, id))).toBe(legendTurnIsActive(host.world, indexOf(host, id)));
    }
  });

  it('回復の技は 1 体につき決まった回数まで（あさのひざし・ねむる）', () => {
    const sim = round(1);
    const w = sim.world;
    let suns = 0;
    let rests = 0;
    const seen = new Set<unknown>();
    for (let k = 0; k < 30 * 170; k++) {
      sim.step([]);
      for (const h of w.hazards) {
        if (seen.has(h)) continue;
        seen.add(h);
        if (moveId(sim, h.move) === 'espeon-morning-sun') suns++;
        if (moveId(sim, h.move) === 'snorlax-rest-snore') rests++;
      }
    }
    expect(suns).toBeLessThanOrEqual(2);
    expect(rests).toBeLessThanOrEqual(2);
    expect(suns + rests).toBeGreaterThan(0);
  });

  it('HP が決めた割合を切るたびと倒したときに、きずぐすりを人数分落とす', () => {
    const sim = round(0, 2);
    const w = sim.world;
    const potions = (): number => w.items.filter((x) => x.kind === 'potion').length;
    const i = indexOf(sim, 'red-pikachu');
    const id = w.enemies.id[i]!;
    const max = w.enemies.maxHp[i]!;
    expect(potions()).toBe(0);
    w.enemies.hp[i] = max * 0.74;
    sim.step([]);
    expect(potions()).toBe(2);
    // 同じ割合では 2 回落とさない
    sim.step([]);
    expect(potions()).toBe(2);
    // 一度に 2 つの割合を切ったら、続けて 2 回落とす
    w.enemies.hp[indexOf(sim, 'red-pikachu')] = max * 0.2;
    sim.step([]);
    sim.step([]);
    expect(potions()).toBe(6);
    sim.step([{ type: 'damageEnemy', id, amount: 1e9, by: 1, kbx: 0, kby: 0, kbTicks: 0, status: -1, statusTicks: 0 }]);
    expect(potions()).toBe(8);
  });

  it('はねの戦い（ルギア・ホウオウ）でも、きずぐすりを人数分落とす', () => {
    for (const id of ['legend-lugia', 'legend-ho-oh']) {
      const rules = buildSimRules('johto');
      const sim = new Simulation({ tickRate: 30, seed: 3, rules });
      for (const k of [1, 2]) sim.addPlayer({ id: k, x: k * 30, y: 0, radius: 12, moveSpeed: 0 });
      for (const p of sim.world.players) p.invincibleTicks = 1e9;
      sim.step([]);
      startLegendary(sim.world, rules.enemies.kinds.findIndex((k) => k.id === id));
      for (let k = 0; k < 95; k++) sim.step([]);
      const w = sim.world;
      const potions = (): number => w.items.filter((x) => x.kind === 'potion').length;
      const i = indexOf(sim, id);
      const bossId = w.enemies.id[i]!;
      w.enemies.hp[i] = w.enemies.maxHp[i]! * 0.7;
      sim.step([]);
      expect(potions(), id).toBe(2);
      sim.step([{ type: 'damageEnemy', id: bossId, amount: 1e9, by: 1, kbx: 0, kby: 0, kbTicks: 0, status: -1, statusTicks: 0 }]);
      expect(potions(), id).toBe(4);
    }
  });

  it('次のラウンドが始まっても、落ちているきずぐすりは残る', () => {
    const sim = round(0);
    const w = sim.world;
    const id = w.enemies.id[indexOf(sim, 'red-pikachu')]!;
    sim.step([{ type: 'damageEnemy', id, amount: 1e9, by: 1, kbx: 0, kby: 0, kbTicks: 0, status: -1, statusTicks: 0 }]);
    sim.step([]);
    expect(w.legendary?.round).toBe(1);
    expect(w.items.filter((x) => x.kind === 'potion').length).toBeGreaterThan(0);
  });
});
