import { describe, expect, it } from 'vitest';
import { playerConfig } from '../data';
import { buildSimRules } from '../data/simRules';
import { Simulation } from './simulation';
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

const rules0 = () => buildSimRules('johto');
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

  it('ピカチュウ: 消えない（攻撃できない時間が無い）。でんこうせっか と かみなり を交互に使う', () => {
    const sim = round(0);
    const w = sim.world;
    const id = w.enemies.id[indexOf(sim, 'red-pikachu')]!;
    const used: string[] = [];
    const seen = new Set<unknown>();
    for (let k = 0; k < 30 * 40; k++) {
      sim.step([]);
      expect(w.hiddenEnemies.has(id)).toBe(false);
      for (const h of w.hazards) {
        if (seen.has(h)) continue;
        seen.add(h);
        const m = moveId(sim, h.move);
        if (used.at(-1) !== m) used.push(m);
      }
    }
    expect(used.slice(0, 5)).toEqual(['pika-quick-attack', 'pika-thunderbolt-burst', 'pika-thunder-storm', 'pika-quick-attack', 'pika-thunderbolt-burst']);
  });

  it('ピカチュウ 行動 1: でんこうせっか の予告の後にプレイヤーの近くへ現れ、そこを中心に 10まんボルト', () => {
    const sim = round(0);
    const w = sim.world;
    let burst = null;
    for (let k = 0; k < 30 * 10 && !burst; k++) {
      sim.step([]);
      burst = w.hazards.find((h) => moveId(sim, h.move) === 'pika-thunderbolt-burst') ?? null;
    }
    expect(burst).not.toBeNull();
    // 当たっている間も止まったまま
    while (w.hazards.includes(burst!) && burst!.activeTicks === undefined) sim.step([]);
    const i = indexOf(sim, 'red-pikachu');
    const p = w.players[0]!;
    expect(Math.hypot(w.enemies.x[i]! - p.x, w.enemies.y[i]! - p.y)).toBeLessThan(60);
    expect(Math.hypot(burst!.x - w.enemies.x[i]!, burst!.y - w.enemies.y[i]!)).toBeLessThan(1);
    expect(w.enemies.speed[i]).toBe(0);
  });

  it('ピカチュウ 行動 2: 技の間は歩き、かみなり は止まったままで、たくさん落ちる', () => {
    const sim = round(0);
    const w = sim.world;
    const move = rules0().stage.moves.find((m) => m.id === 'pika-thunder-storm')!;
    const seen = new Set<unknown>();
    let walked = 0;
    let started = false;
    let done = false;
    for (let k = 0; k < 30 * 20 && !done; k++) {
      sim.step([]);
      const i = indexOf(sim, 'red-pikachu');
      const storm = w.hazards.filter((h) => moveId(sim, h.move) === 'pika-thunder-storm');
      for (const h of storm) seen.add(h);
      if (!started && storm.length > 0) started = true;
      if (!started && w.hazards.length === 0 && w.enemies.speed[i]! > 0) walked++;
      if (started && storm.some((h) => h.activeTicks === undefined)) expect(w.enemies.speed[i]).toBe(0);
      if (started && seen.size === move.repeat!.count * move.count && storm.length === 0) done = true;
    }
    expect(walked).toBeGreaterThan(30);
    expect(seen.size).toBe(move.repeat!.count * move.count);
    // 足元だけでなく、ばらけて落ちる
    expect(new Set([...seen].map((h) => Math.round((h as { x: number }).x))).size).toBeGreaterThan(10);
  });

  it('ピカチュウ 行動 3: HP 70%・40% でボルテッカー。体は止まったまま残像が跳ね返り、終わると疲れて止まる', () => {
    const sim = round(0);
    const w = sim.world;
    const i0 = indexOf(sim, 'red-pikachu');
    const max = w.enemies.maxHp[i0]!;
    const run = (): number => {
      let ghost = null;
      for (let k = 0; k < 30 * 20 && !ghost; k++) {
        sim.step([]);
        ghost = w.hazards.find((h) => moveId(sim, h.move) === 'pika-volt-tackle-ghost' && h.activeTicks !== undefined) ?? null;
      }
      expect(ghost).not.toBeNull();
      const p = w.players[0]!;
      const box = rules0().stage.moves.find((m) => m.id === 'pika-volt-tackle-ghost')!.travel!.bounceBox!;
      const i = indexOf(sim, 'red-pikachu');
      const x0 = w.enemies.x[i]!;
      let flips = 0;
      let lastVx = ghost!.vx;
      while (w.hazards.includes(ghost!)) {
        sim.step([]);
        expect(Math.abs(ghost!.x - p.x)).toBeLessThan(box.halfWidth + 60);
        expect(Math.abs(ghost!.y - p.y)).toBeLessThan(box.halfHeight + 60);
        expect(w.enemies.x[indexOf(sim, 'red-pikachu')]).toBe(x0);
        if (ghost!.vx !== lastVx) flips++;
        lastVx = ghost!.vx;
      }
      expect(flips).toBeGreaterThan(0);
      let tired = false;
      for (let k = 0; k < 10; k++) {
        sim.step([]);
        tired ||= w.hazards.some((h) => moveId(sim, h.move) === 'pika-tired');
      }
      expect(tired).toBe(true);
      expect(w.enemies.speed[indexOf(sim, 'red-pikachu')]).toBe(0);
      return flips;
    };
    w.enemies.hp[i0] = max * 0.69;
    run();
    // 同じ割合では 2 回使わない
    for (let k = 0; k < 30 * 8; k++) {
      sim.step([]);
      expect(w.hazards.some((h) => moveId(sim, h.move) === 'pika-volt-tackle-ghost')).toBe(false);
    }
    w.enemies.hp[indexOf(sim, 'red-pikachu')] = max * 0.39;
    run();
  });

  it('ピカチュウ 行動 3: ボルテッカーは反射で速さが変わらず、反射の角度はほんの少しだけずれる', () => {
    const sim = round(0);
    const w = sim.world;
    const i = indexOf(sim, 'red-pikachu');
    w.enemies.hp[i] = w.enemies.maxHp[i]! * 0.69;
    const m = rules0().stage.moves.find((x) => x.id === 'pika-volt-tackle-ghost')!;
    let ghost = null;
    for (let k = 0; k < 30 * 20 && !ghost; k++) {
      sim.step([]);
      ghost = w.hazards.find((h) => moveId(sim, h.move) === 'pika-volt-tackle-ghost' && h.activeTicks !== undefined) ?? null;
    }
    let flips = 0;
    while (w.hazards.includes(ghost!)) {
      const vx = ghost!.vx!;
      const vy = ghost!.vy!;
      sim.step([]);
      if (!w.hazards.includes(ghost!) || (ghost!.vx === vx && ghost!.vy === vy)) continue;
      flips++;
      expect(Math.hypot(ghost!.vx!, ghost!.vy!)).toBeCloseTo(m.travel!.speed, 3);
      // 本来の反射（x か y の向きが返る）からのずれは、決めた角度まで
      const a = Math.atan2(ghost!.vy!, ghost!.vx!);
      const candidates = [Math.atan2(vy, -vx), Math.atan2(-vy, vx), Math.atan2(-vy, -vx)];
      const off = Math.min(...candidates.map((c) => Math.abs(Math.atan2(Math.sin(a - c), Math.cos(a - c)))));
      expect((off * 180) / Math.PI).toBeLessThanOrEqual(m.travel!.bounceBox!.angleJitterDegrees! + 0.01);
    }
    expect(flips).toBeGreaterThanOrEqual(10);
  });

  it('ピカチュウ 行動 3: ボルテッカーは止まっていても動いていても当たりうる', () => {
    const hits = (moving: boolean): number => {
      const sim = round(0);
      const w = sim.world;
      const p = w.players[0]!;
      p.moveSpeed = playerConfig.moveSpeed;
      p.baseMoveSpeed = playerConfig.moveSpeed;
      p.maxHp = 1e9;
      p.hp = 1e9;
      p.invincibleTicks = 0;
      const i = indexOf(sim, 'red-pikachu');
      w.enemies.hp[i] = w.enemies.maxHp[i]! * 0.69;
      let ghost = null;
      let n = 0;
      for (let k = 0; k < 30 * 40; k++) {
        // 0.6 秒ごとに向きを変えて走る
        const turn = moving && k % 18 === 0 ? [{ type: 'move' as const, playerId: 1, dx: ([1, 0, -1, 0] as const)[(k / 18) % 4]!, dy: ([0, 1, 0, -1] as const)[(k / 18) % 4]! }] : [];
        sim.step(turn);
        ghost ??= w.hazards.find((h) => moveId(sim, h.move) === 'pika-volt-tackle-ghost' && h.activeTicks !== undefined) ?? null;
        if (ghost && !w.hazards.includes(ghost)) break;
        if (ghost) n += w.events.filter((e) => e.type === 'playerDamaged').length;
      }
      expect(ghost).not.toBeNull();
      return n;
    };
    const still = hits(false);
    const moving = hits(true);
    console.log('ボルテッカーに当たった回数 止まっている', still, '動いている', moving);
    expect(still + moving).toBeGreaterThan(0);
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

  it('ホウオウの じこさいせい は 2 回まで', () => {
    const rules = buildSimRules('johto');
    const sim = new Simulation({ tickRate: 30, seed: 3, rules });
    sim.addPlayer({ id: 1, x: 30, y: 0, radius: 12, moveSpeed: 0 });
    sim.world.players[0]!.invincibleTicks = 1e9;
    sim.step([]);
    startLegendary(sim.world, rules.enemies.kinds.findIndex((k) => k.id === 'legend-ho-oh'));
    let recovers = 0;
    const seen = new Set<unknown>();
    for (let k = 0; k < 30 * 170; k++) {
      sim.step([]);
      for (const h of sim.world.hazards) {
        if (seen.has(h)) continue;
        seen.add(h);
        if (moveId(sim, h.move) === 'hooh-recover') recovers++;
      }
    }
    expect(recovers).toBe(2);
  });

  it('ホウオウ: ブレイブバードの 2 回の突進が終わってから、その場で息切れする', () => {
    const rules = buildSimRules('johto');
    const sim = new Simulation({ tickRate: 30, seed: 3, rules });
    sim.addPlayer({ id: 1, x: 30, y: 0, radius: 12, moveSpeed: 0 });
    const w = sim.world;
    w.players[0]!.invincibleTicks = 1e9;
    sim.step([]);
    startLegendary(w, rules.enemies.kinds.findIndex((k) => k.id === 'legend-ho-oh'));
    let count = 0;
    const seen = new Set<unknown>();
    for (let k = 0; k < 30 * 60; k++) {
      sim.step([]);
      // 予告の間が止まっている時間（落ちた後は当たらない残りの時間で、もう動く）
      const h = w.hazards.find((z) => moveId(sim, z.move) === 'hooh-recoil' && z.activeTicks === undefined);
      if (!h) continue;
      const i = indexOf(sim, 'legend-ho-oh');
      expect(w.enemies.kbTicks[i]).toBe(0);
      expect(w.enemies.speed[i]).toBe(0);
      expect(Math.hypot(w.enemies.x[i]! - h.x, w.enemies.y[i]! - h.y)).toBeLessThan(1);
      expect(w.hazards.some((z) => moveId(sim, z.move) === 'hooh-brave-bird')).toBe(false);
      if (!seen.has(h)) {
        seen.add(h);
        count++;
      }
    }
    expect(count).toBeGreaterThanOrEqual(3);
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
