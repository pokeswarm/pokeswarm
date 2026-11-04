import { describe, expect, it } from 'vitest';
import { playerConfig } from '../data';
import { buildSimRules } from '../data/simRules';
import { Simulation } from './simulation';
import type { World } from './world';
import { damageTakenMultiplier } from './systems/status';
import { addHazard, hazardHits, legendWeatherState, startLegendary } from './systems/stage';

/** レッド戦の作り直し（07 の193〜195章）: 隙・回復の回数の上限・きずぐすり・ピカチュウ・エーフィ */
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

  it('ピカチュウ 行動 3: ボルテッカーは今の面と直前の面へは飛ばず、プレイヤーを通すのは左右の面からだけ', () => {
    const m = rules0().stage.moves.find((x) => x.id === 'pika-volt-tackle-ghost')!;
    const box = m.travel!.bounceBox!;
    let aimed = 0;
    let bounces = 0;
    // 始まりの違う戦いで何度も見る
    for (let wait = 0; wait < 8; wait++) {
      const sim = round(0);
      const w = sim.world;
      for (let k = 0; k < wait * 11; k++) sim.step([]);
      const i = indexOf(sim, 'red-pikachu');
      w.enemies.hp[i] = w.enemies.maxHp[i]! * 0.69;
      const p = w.players[0]!;
      let ghost = null;
      for (let k = 0; k < 30 * 20 && !ghost; k++) {
        sim.step([]);
        ghost = w.hazards.find((h) => moveId(sim, h.move) === 'pika-volt-tackle-ghost' && h.activeTicks !== undefined) ?? null;
      }
      const walls: number[] = [];
      let last = 0;
      let sinceAim = 0;
      let prevAimed = false;
      while (w.hazards.includes(ghost!)) {
        sim.step([]);
        if (!w.hazards.includes(ghost!) || (ghost!.bounces ?? 0) === last) continue;
        last = ghost!.bounces!;
        bounces++;
        expect(Math.hypot(ghost!.vx!, ghost!.vy!)).toBeCloseTo(m.travel!.speed, 3);
        const wall = ghost!.lastWall!;
        const a = Math.atan2(ghost!.vy!, ghost!.vx!);
        const toPlayer = Math.atan2(p.y - ghost!.y, p.x - ghost!.x);
        const isAimed = Math.abs(Math.atan2(Math.sin(a - toPlayer), Math.cos(a - toPlayer))) < 0.001;
        sinceAim++;
        if (isAimed) {
          // 左右の面からだけ
          expect(wall).toBeLessThanOrEqual(1);
          expect(sinceAim).toBeGreaterThanOrEqual(box.aimEvery);
          aimed++;
          sinceAim = 0;
        }
        // 届いた面は、今の面でも直前の面でもない（プレイヤーを通した後は除く）
        if (!prevAimed && walls.length >= 2) {
          expect(wall).not.toBe(walls.at(-1));
          expect(wall).not.toBe(walls.at(-2));
        }
        walls.push(wall);
        prevAimed = isAimed;
      }
    }
    expect(bounces).toBeGreaterThanOrEqual(8 * 8);
    expect(aimed).toBeGreaterThanOrEqual(8);
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
    expect(still).toBeGreaterThanOrEqual(2);
    expect(moving).toBeLessThanOrEqual(still);
  });

  describe('エーフィ（07 の195章）', () => {
    const espeonRound = (solo = false) => {
      const sim = round(1);
      const w = sim.world;
      if (solo) {
        const s = indexOf(sim, 'red-snorlax');
        sim.step([{ type: 'damageEnemy', id: w.enemies.id[s]!, amount: 1e9, by: 1, kbx: 0, kby: 0, kbTicks: 0, status: -1, statusTicks: 0 }]);
      }
      return sim;
    };
    const until = (sim: Simulation, id: string, seconds = 40): World['hazards'][number] => {
      for (let k = 0; k < 30 * seconds; k++) {
        const h = sim.world.hazards.find((z) => moveId(sim, z.move) === id);
        if (h) return h;
        sim.step([]);
      }
      throw new Error(id + ' が出ない');
    };

    it('どろかけ → スピードスター → サイコキネシス の順に使い、消えない', () => {
      const sim = espeonRound();
      const w = sim.world;
      const id = w.enemies.id[indexOf(sim, 'red-espeon')]!;
      const used: string[] = [];
      const seen = new Set<unknown>();
      for (let k = 0; k < 30 * 30; k++) {
        sim.step([]);
        expect(w.hiddenEnemies.has(id)).toBe(false);
        for (const h of w.hazards) {
          if (h.dasher !== id || seen.has(h)) continue;
          seen.add(h);
          const m = moveId(sim, h.move);
          if (used.at(-1) !== m) used.push(m);
        }
      }
      expect(used.slice(0, 3)).toEqual(['espeon-mud-slap', 'espeon-swift', 'espeon-psychic-throw']);
    });

    it('どろかけ は 3 発で、当たると足が遅くなる', () => {
      // カビゴンが触れていると無敵の時間で当たらないので、エーフィだけで見る
      const sim = espeonRound(true);
      const w = sim.world;
      const seen = new Set<unknown>();
      const p = w.players[0]!;
      p.invincibleTicks = 0;
      p.maxHp = 1e9;
      p.hp = 1e9;
      until(sim, 'espeon-mud-slap');
      for (let k = 0; k < 30 * 2.5; k++) {
        p.invincibleTicks = 0;
        for (const h of w.hazards) if (moveId(sim, h.move) === 'espeon-mud-slap') seen.add(h);
        sim.step([]);
      }
      expect(seen.size).toBe(3);
      expect(p.mudTicks).toBeGreaterThan(0);
      // 遅くなる
      p.moveSpeed = 180;
      p.baseMoveSpeed = 180;
      p.mudTicks = 90;
      const x0 = p.x;
      sim.step([{ type: 'move', playerId: 1, dx: 1, dy: 0 }]);
      sim.step([]);
      expect(p.x - x0).toBeLessThan((180 / 30) * 2 * 0.65);
    });

    it('リフレクター: HP 66% を切ると張り、最大 HP の 8% を受け止め、割れると気絶する。受け止めた分は減らない', () => {
      const sim = espeonRound();
      const w = sim.world;
      let i = indexOf(sim, 'red-espeon');
      const id = w.enemies.id[i]!;
      const max = w.enemies.maxHp[i]!;
      w.enemies.hp[i] = max * 0.65;
      until(sim, 'espeon-reflect');
      const refl = w.hazards.find((z) => moveId(sim, z.move) === 'espeon-reflect')!;
      for (let k = 0; k < 30 && refl.activeTicks === undefined; k++) sim.step([]);
      expect(refl.activeTicks).toBeDefined();
      const hit = (amount: number) => sim.step([{ type: 'damageEnemy', id, amount, by: 1, kbx: 0, kby: 0, kbTicks: 0, status: -1, statusTicks: 0 }]);
      i = indexOf(sim, 'red-espeon');
      const before = w.enemies.hp[i]!;
      hit(max * 0.04);
      expect(w.enemies.hp[indexOf(sim, 'red-espeon')]).toBe(before);
      // 割れる（残りを超えた分だけ減る）
      hit(max * 0.06);
      expect(w.enemies.hp[indexOf(sim, 'red-espeon')]).toBeCloseTo(before - max * 0.02, 0);
      sim.step([]);
      // 泡が割れる絵の後に気絶する
      expect(w.hazards.some((z) => moveId(sim, z.move) === 'espeon-barrier-break')).toBe(true);
      const stun = until(sim, 'espeon-stun', 2);
      expect(stun).toBeDefined();
      // 壁の絵は消え、止まっている
      expect(w.hazards.some((z) => moveId(sim, z.move) === 'espeon-reflect')).toBe(false);
      expect(w.enemies.speed[indexOf(sim, 'red-espeon')]).toBe(0);
    });

    it('リフレクター: 割らなければ時間で消え、気絶しない。次からはまたダメージが通る', () => {
      const sim = espeonRound();
      const w = sim.world;
      const i = indexOf(sim, 'red-espeon');
      w.enemies.hp[i] = w.enemies.maxHp[i]! * 0.65;
      const refl = until(sim, 'espeon-reflect');
      while (w.hazards.includes(refl)) sim.step([]);
      expect(w.bosses.find((b) => b.id === w.enemies.id[indexOf(sim, 'red-espeon')])?.barrier).toBeUndefined();
      expect(w.hazards.some((z) => moveId(sim, z.move) === 'espeon-stun')).toBe(false);
    });

    it('サイコキネシス: カビゴンを浮かせて行動を止め、予告の場所へ投げ、着地の後しばらく止まる', () => {
      const sim = espeonRound();
      const w = sim.world;
      const h = until(sim, 'espeon-psychic-throw');
      const snorlaxId = w.enemies.id[indexOf(sim, 'red-snorlax')]!;
      sim.step([]);
      // 浮いている間、カビゴンは技を始めない
      while (h.activeTicks === undefined) {
        expect(w.enemies.speed[indexOf(sim, 'red-snorlax')]).toBe(0);
        const before = w.hazards.filter((z) => z.dasher === snorlaxId).length;
        sim.step([]);
        if (h.activeTicks === undefined) expect(w.hazards.filter((z) => z.dasher === snorlaxId).length).toBe(before);
      }
      const s = indexOf(sim, 'red-snorlax');
      expect(Math.hypot(w.enemies.x[s]! - h.x, w.enemies.y[s]! - h.y)).toBeLessThan(2);
      // 着地して気絶する（プレイヤーのギガインパクトの反動と同じ動作）
      const stun = w.hazards.find((z) => z.dasher === snorlaxId && moveId(sim, z.move) === 'snorlax-thrown-stun');
      expect(stun).toBeDefined();
      expect(rules0().stage.moves[stun!.move]!.pose).toBe('Hurt');
    });

    it('スピードスターの間は歩かない', () => {
      const sim = espeonRound();
      const w = sim.world;
      const first = until(sim, 'espeon-swift');
      void first;
      const id = w.enemies.id[indexOf(sim, 'red-espeon')]!;
      let k = 0;
      sim.step([]);
      while ((w.bossQueue.some((q) => q.bossId === id) || w.hazards.some((h) => h.dasher === id && h.activeTicks === undefined)) && k++ < 200) {
        expect(w.enemies.speed[indexOf(sim, 'red-espeon')]).toBe(0);
        sim.step([]);
      }
      expect(k).toBeGreaterThan(30);
    });

    it('どろかけ は扇でなく玉で、赤い予告を出さない', () => {
      const m = rules0().stage.moves.find((x) => x.id === 'espeon-mud-slap')!;
      expect(m.shape).toBe('circle');
      expect(m.hideTelegraph).toBe(true);
    });

    it('サイコキネシス: 予告が止まってから、プレイヤーの速さで範囲の外へ出られる', () => {
      const rules = rules0();
      const m = rules.stage.moves.find((x) => x.id === 'espeon-psychic-throw')!;
      const leftover = m.telegraphSeconds - m.follow!.seconds;
      expect(leftover * playerConfig.moveSpeed).toBeGreaterThanOrEqual(m.radius + 12);
    });

    it('サイコキネシス: カビゴンがいなければ、ランダムな場所を爆破する（止まったまま）', () => {
      const sim = espeonRound(true);
      const w = sim.world;
      const h = until(sim, 'espeon-psychic-burst');
      expect(w.hazards.some((z) => moveId(sim, z.move) === 'espeon-psychic-throw')).toBe(false);
      const seen = new Set<unknown>();
      for (let k = 0; k < 30 * 1.6; k++) {
        for (const z of w.hazards) if (moveId(sim, z.move) === 'espeon-psychic-burst') seen.add(z);
        expect(w.enemies.speed[indexOf(sim, 'red-espeon')]).toBe(0);
        sim.step([]);
      }
      expect(seen.size).toBe(rules0().stage.moves.find((x) => x.id === 'espeon-psychic-burst')!.count);
      expect(h).toBeDefined();
    });
  });

  describe('カビゴン（07 の196章）', () => {
    /** エーフィを倒してカビゴンだけにする */
    const alone = () => {
      const sim = round(1);
      const w = sim.world;
      sim.step([{ type: 'damageEnemy', id: w.enemies.id[indexOf(sim, 'red-espeon')]!, amount: 1e9, by: 1, kbx: 0, kby: 0, kbTicks: 0, status: -1, statusTicks: 0 }]);
      return sim;
    };

    it('プレイヤーのところへ飛んでこない（瞬間移動・跳ぶ・突進の技が無い）。走らないのでプレイヤーより遅い', () => {
      const rules = rules0();
      const set = rules.stage.legendary!.moveSets['red-snorlax']!;
      const ids = [...set.moves, ...(set.hpMoves ?? []).flatMap((h) => h.moves)];
      for (const id of ids) {
        const m = rules.stage.moves.find((x) => x.id === id)!;
        expect(m.teleport, id).toBeFalsy();
        expect(m.hideBoss, id).toBeFalsy();
        expect(m.dashSpeed, id).toBeFalsy();
        expect(m.bounce, id).toBeFalsy();
      }
    });

    it('エーフィがいなくなると、歩いて眠るだけで、自分からは攻撃しない', () => {
      const sim = alone();
      const w = sim.world;
      const hurt: string[] = [];
      for (let k = 0; k < 30 * 30; k++) {
        sim.step([]);
        for (const h of w.hazards) if (rules0().stage.moves[h.move]!.damage > 0) hurt.push(moveId(sim, h.move));
      }
      expect(hurt).toEqual([]);
    });

    it('HP 66%・33% で 怒る → 市松模様が 2 回 → 疲れる。その間は止まったまま', () => {
      const sim = alone();
      const w = sim.world;
      const i = indexOf(sim, 'red-snorlax');
      const max = w.enemies.maxHp[i]!;
      const run = (): void => {
        const used: string[] = [];
        const x0 = w.enemies.x[indexOf(sim, 'red-snorlax')]!;
        const seen = new Set<unknown>();
        for (let k = 0; k < 30 * 14; k++) {
          sim.step([]);
          for (const h of w.hazards) {
            if (seen.has(h)) continue;
            seen.add(h);
            const m = moveId(sim, h.move);
            if (used.at(-1) !== m && m !== 'snorlax-sleep') used.push(m);
          }
          if (used.includes('snorlax-giga-recover')) break;
        }
        expect(used).toEqual(['snorlax-giga-rage', 'snorlax-giga-wave-a', 'snorlax-giga-wave-b', 'snorlax-giga-recover']);
        expect(Math.abs(w.enemies.x[indexOf(sim, 'red-snorlax')]! - x0)).toBeLessThan(30);
      };
      w.enemies.hp[i] = max * 0.65;
      run();
      for (let k = 0; k < 30 * 4; k++) sim.step([]);
      w.enemies.hp[indexOf(sim, 'red-snorlax')] = max * 0.32;
      run();
    });

    it('全域の市松模様: 2 回で画面のマスが全部危なくなり、1 回目の安全なマスは 2 回目に危ない', () => {
      const sim = alone();
      const w = sim.world;
      const i = indexOf(sim, 'red-snorlax');
      w.enemies.hp[i] = w.enemies.maxHp[i]! * 0.65;
      const cells = new Map<string, Set<string>>();
      for (let k = 0; k < 30 * 12; k++) {
        sim.step([]);
        for (const h of w.hazards) {
          const m = moveId(sim, h.move);
          if (!m.startsWith('snorlax-giga-wave')) continue;
          (cells.get(m) ?? cells.set(m, new Set()).get(m)!).add(`${h.x},${h.y}`);
        }
      }
      const a = cells.get('snorlax-giga-wave-a')!;
      const b = cells.get('snorlax-giga-wave-b')!;
      expect(a.size).toBeGreaterThanOrEqual(15);
      expect(b.size).toBeGreaterThanOrEqual(15);
      for (const c of a) expect(b.has(c)).toBe(false);
      // プレイヤーのまわりは、どちらかのマスが必ず落ちる
      const p = w.players[0]!;
      const cell = 260;
      const near = [0, 1].map((dx) => `${(Math.round(p.x / cell) + dx) * cell},${Math.round(p.y / cell) * cell}`);
      expect(near.some((c) => a.has(c))).toBe(true);
      expect(near.some((c) => b.has(c))).toBe(true);
    });

    it('避けられる: 市松模様の 2 回の間に、プレイヤーの速さで隣のマスへ動ける', () => {
      const m = rules0().stage.moves.find((x) => x.id === 'snorlax-giga-wave-b')!;
      expect(m.telegraphSeconds * playerConfig.moveSpeed).toBeGreaterThanOrEqual(m.gridWave!.cell - m.radius);
    });
  });

  describe('御三家（07 の197章）', () => {
    const alone = (id: string) => {
      const sim = round(2);
      const w = sim.world;
      for (const other of ['red-venusaur', 'red-charizard', 'red-blastoise']) {
        if (other !== id) sim.step([{ type: 'damageEnemy', id: w.enemies.id[indexOf(sim, other)]!, amount: 1e9, by: 1, kbx: 0, kby: 0, kbTicks: 0, status: -1, statusTicks: 0 }]);
      }
      return sim;
    };
    const until = (sim: Simulation, id: string, seconds = 60): World['hazards'][number] => {
      for (let k = 0; k < 30 * seconds; k++) {
        const h = sim.world.hazards.find((z) => moveId(sim, z.move) === id);
        if (h) return h;
        sim.step([]);
      }
      throw new Error(id + ' が出ない');
    };

    it('3 体とも消えない・追う技が無い。大技の後は止まる', () => {
      const rules = rules0();
      for (const id of ['red-venusaur', 'red-charizard', 'red-blastoise']) {
        const set = rules.stage.legendary!.moveSets[id]!;
        expect(set.hpMoves?.length, id).toBe(2);
        for (const m of [...set.moves, ...set.hpMoves!.flatMap((h) => h.moves)]) {
          const mv = rules.stage.moves.find((x) => x.id === m)!;
          expect(mv.hideBoss, m).toBeFalsy();
          expect(mv.homing, m).toBeFalsy();
          expect(mv.teleport, m).toBeFalsy();
        }
        const last = rules.stage.moves.find((x) => x.id === set.hpMoves![0]!.moves.at(-1))!;
        expect(last.rooted, id).toBe(true);
        expect(last.damage, id).toBe(0);
      }
    });

    it('ソーラービームは撃つ前に狙いが止まり、避ける時間がある（にほんばれ の間も）', () => {
      const rules = rules0();
      for (const id of ['venusaur-solar-beam-red', 'venusaur-solar-beam-sun']) {
        const m = rules.stage.moves.find((x) => x.id === id)!;
        expect((m.telegraphSeconds - m.follow!.seconds) * playerConfig.moveSpeed, id).toBeGreaterThanOrEqual(m.radius + 12);
      }
    });

    it('にほんばれ の間は ソーラービームの溜めが短く、かえんほうしゃ が広い。あまごい で晴れが消える', () => {
      const sim = round(2);
      const w = sim.world;
      // カメックスがいると雨で晴れが消えるので、先に倒す
      sim.step([{ type: 'damageEnemy', id: w.enemies.id[indexOf(sim, 'red-blastoise')]!, amount: 1e9, by: 1, kbx: 0, kby: 0, kbTicks: 0, status: -1, statusTicks: 0 }]);
      until(sim, 'venusaur-sunny-day');
      // 晴れの間に使う技
      const seen = new Set<string>();
      for (let k = 0; k < 30 * 13; k++) {
        sim.step([]);
        for (const h of w.hazards) seen.add(moveId(sim, h.move));
        if (seen.has('blastoise-rain-dance')) break;
      }
      expect(seen.has('venusaur-solar-beam-sun')).toBe(true);
      expect(seen.has('charizard-flamethrower-sun')).toBe(true);
      // 雨が降ると晴れは消える
      const again = round(2);
      until(again, 'venusaur-sunny-day');
      const rain = until(again, 'blastoise-rain-dance');
      expect(rain).toBeDefined();
      again.step([]);
      expect(again.world.hazards.filter((h) => moveId(again, h.move) === 'venusaur-sunny-day').length).toBe(0);
    });

    it('フシギバナとカメックスは決まった場所に陣取り、歩かない', () => {
      const sim = round(2);
      const w = sim.world;
      const v0 = [w.enemies.x[indexOf(sim, 'red-venusaur')]!, w.enemies.y[indexOf(sim, 'red-venusaur')]!];
      const b0 = [w.enemies.x[indexOf(sim, 'red-blastoise')]!, w.enemies.y[indexOf(sim, 'red-blastoise')]!];
      expect(Math.hypot(v0[0]! - b0[0]!, v0[1]! - b0[1]!)).toBeGreaterThan(600);
      for (let k = 0; k < 30 * 25; k++) sim.step([]);
      expect(w.enemies.x[indexOf(sim, 'red-venusaur')]).toBe(v0[0]);
      expect(w.enemies.y[indexOf(sim, 'red-blastoise')]).toBe(b0[1]);
    });

    it('リザードン: 晴れは追って速く硬く、雨は遅くもろい。天気なしは距離を取る', () => {
      const sim = alone('red-charizard');
      const w = sim.world;
      const i = indexOf(sim, 'red-charizard');
      const add = (id: string) => addHazard(w, w.rules.stage.moves.findIndex((m) => m.id === id), 0, 0, 0, 0, -1);
      expect(legendWeatherState(w, i)).toBeNull();
      w.hazards.length = 0;
      add('venusaur-sunny-day');
      const sun = legendWeatherState(w, i)!;
      expect(sun.chase).toBe(true);
      expect(damageTakenMultiplier(w, i)).toBeCloseTo(0.5);
      w.hazards.length = 0;
      add('blastoise-rain-dance');
      const rain = legendWeatherState(w, i)!;
      expect(rain.speedPct).toBeLessThan(sun.speedPct);
      expect(damageTakenMultiplier(w, i)).toBeCloseTo(1.5);
      // 晴れでもプレイヤーより遅い（逃げれば離せる）
      const k = rules0().enemies.kinds.find((x) => x.id === 'red-charizard')!;
      expect((k.moveSpeed * (rules0().stage.bossRules.legendSpeedMultiplier ?? 1) * sun.speedPct) / 100).toBeLessThan(playerConfig.moveSpeed);
    });

    it('リザードン: 晴れの技は威力が上がり、雨の技は下がる', () => {
      const run = (weather: string | null): number => {
        const sim = alone('red-charizard');
        const w = sim.world;
        const idx = w.rules.stage.moves.findIndex((m) => m.id === 'charizard-wing-attack');
        const b = w.bosses[0]!;
        b.moves = [idx];
        b.next = 0;
        b.cooldown = 1;
        b.hpMoves = [];
        w.hazards.length = 0;
        if (weather) addHazard(w, w.rules.stage.moves.findIndex((m) => m.id === weather), 0, 0, 0, 0, -1);
        for (let k = 0; k < 90; k++) {
          sim.step([]);
          const h = w.hazards.find((z) => z.move === idx);
          if (h) return h.damageOverride || h.damage;
          for (const z of w.hazards) if (z.ticksLeft < 2 && !z.activeTicks) z.ticksLeft = 30;
        }
        throw new Error('出ない');
      };
      expect(run('venusaur-sunny-day')).toBeCloseTo(34 * 1.5);
      expect(run('blastoise-rain-dance')).toBeCloseTo(34 * 0.6);
      expect(run(null)).toBe(34);
    });

    it('なみのり: 足元は安全で、輪は広がり、切れ目を抜けられる', () => {
      const m = rules0().stage.moves.find((x) => x.id === 'blastoise-surf')!;
      const r = m.surfRing!;
      const hz = { shape: 'ring' as const, x: 0, y: 0, radius: 400, innerRadius: 330, dirX: 1, dirY: 0, length: 0 };
      // 輪の上
      expect(hazardHits(hz, 0, 365, 12, m)).toBe(true);
      // 切れ目（向かい合う 2 か所）
      expect(hazardHits(hz, 365, 0, 12, m)).toBe(false);
      expect(hazardHits(hz, -365, 0, 12, m)).toBe(false);
      // 輪の内側・外側
      expect(hazardHits(hz, 0, 200, 12, m)).toBe(false);
      expect(hazardHits(hz, 0, 500, 12, m)).toBe(false);
      // 足元は、輪が出たときから外
      expect(r.startRadius).toBeGreaterThan(100);
    });

    it('ふぶき: どこにいても少しずつ削られる', () => {
      const sim = alone('red-blastoise');
      const w = sim.world;
      const p = w.players[0]!;
      p.maxHp = 1000;
      p.hp = 1000;
      p.defense = 0;
      p.x = 3000;
      p.y = 3000;
      const hz = w.rules.stage.moves.findIndex((m) => m.id === 'blastoise-blizzard');
      addHazard(w, hz, 0, 0, 0, 0, -1);
      for (let k = 0; k < 30 * 3; k++) sim.step([]);
      expect(p.hp).toBeLessThan(1000);
      expect(p.hp).toBeGreaterThan(900);
    });

    it('フシギバナの大技: 光線 8 本がゆっくり回り、その後は止まって こうごうせい', () => {
      const sim = alone('red-venusaur');
      const w = sim.world;
      const i = indexOf(sim, 'red-venusaur');
      w.enemies.hp[i] = w.enemies.maxHp[i]! * 0.65;
      const hp = w.enemies.hp[i]!;
      until(sim, 'venusaur-solar-storm');
      expect(w.hazards.filter((h) => moveId(sim, h.move) === 'venusaur-solar-storm').length).toBe(8);
      until(sim, 'venusaur-synthesis');
      expect(w.enemies.speed[indexOf(sim, 'red-venusaur')]).toBe(0);
      for (let k = 0; k < 30 * 3.2; k++) sim.step([]);
      expect(w.enemies.hp[indexOf(sim, 'red-venusaur')]).toBeGreaterThan(hp);
    });

    it('リザードンの大技: 炎の輪には切れ目がボスと反対側にあり、中心の爆発の前に外へ出られる', () => {
      const sim = alone('red-charizard');
      const w = sim.world;
      const i = indexOf(sim, 'red-charizard');
      w.enemies.hp[i] = w.enemies.maxHp[i]! * 0.65;
      until(sim, 'charizard-fire-ring');
      const p = w.players[0]!;
      const b = indexOf(sim, 'red-charizard');
      const ring = w.hazards.filter((h) => moveId(sim, h.move) === 'charizard-fire-ring');
      expect(ring.length).toBeGreaterThan(10);
      expect(ring.length).toBeLessThan(18);
      // ボスと反対側には柱が無い
      const away = Math.atan2(p.y - w.enemies.y[b]!, p.x - w.enemies.x[b]!);
      for (const h of ring) {
        const a = Math.atan2(h.y - p.y, h.x - p.x);
        expect(Math.abs(Math.atan2(Math.sin(a - away), Math.cos(a - away)))).toBeGreaterThan(0.3);
      }
      const core = rules0().stage.moves.find((x) => x.id === 'charizard-fire-core')!;
      const radius = rules0().stage.moves.find((x) => x.id === 'charizard-fire-ring')!.around!.radius;
      expect(core.telegraphSeconds * playerConfig.moveSpeed).toBeGreaterThan(radius);
      until(sim, 'charizard-fire-core');
      until(sim, 'charizard-tired');
    });

    it('カメックスの大技: うずしお が 3 つ。引き寄せて、終わると甲羅にこもって止まる', () => {
      const sim = alone('red-blastoise');
      const w = sim.world;
      const i = indexOf(sim, 'red-blastoise');
      w.enemies.hp[i] = w.enemies.maxHp[i]! * 0.65;
      until(sim, 'blastoise-whirlpool');
      expect(w.hazards.filter((h) => moveId(sim, h.move) === 'blastoise-whirlpool').length).toBe(3);
      const s = until(sim, 'blastoise-withdraw');
      expect(rules0().stage.moves[s.move]!.pose).toBe('Withdraw');
    });
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
