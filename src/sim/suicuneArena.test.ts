import { describe, expect, it } from 'vitest';
import { buildSimRules } from '../data/simRules';
import { Simulation } from './simulation';
import { startIntruder } from './systems/stage';

/** スイクンの登場と技（07 の218章） */
function setup(enter = true) {
  const rules = buildSimRules('johto');
  const sim = new Simulation({ tickRate: 30, seed: 5, rules });
  sim.addPlayer({ id: 1, x: 300, y: 300, radius: 12, moveSpeed: 180 });
  const p = sim.world.players[0]!;
  p.maxHp = p.hp = 1e9;
  sim.world.section = 3;
  const kind = rules.enemies.kinds.findIndex((k) => k.id === 'legend-suicune');
  const step = (seconds: number): void => {
    for (let t = 0; t < seconds * 30; t++) sim.step([]);
  };
  const bossIndex = (): number => {
    const e = sim.world.enemies;
    for (let i = 0; i < e.count; i++) if (e.id[i] === sim.world.bosses[0]?.id) return i;
    return -1;
  };
  if (enter) {
    startIntruder(sim.world, kind);
    step(5.2);
  }
  const of = (id: string) => sim.world.hazards.filter((h) => rules.stage.moves[h.move]?.id === id);
  const force = (...names: string[]): void => {
    const boss = sim.world.bosses[0]!;
    sim.world.hazards.length = 0;
    boss.moves = names.map((id) => rules.stage.moves.findIndex((m) => m.id === id));
    boss.next = 0;
    boss.cooldown = 1;
    boss.holdUntil = undefined;
    boss.hpMoves = [];
  };
  return { sim, rules, kind, step, bossIndex, of, force, p };
}

describe('スイクンの登場（07 の218章）', () => {
  it('雪の間は固定マップへ移らず、「DANGER」も出ない。雑魚は途中で凍り、消えてから固定マップへ移り、すぐ目の前にいて、ここで「DANGER」', () => {
    const { sim, kind, step, bossIndex, rules } = setup(false);
    step(6);
    sim.world.events.length = 0;
    startIntruder(sim.world, kind);
    expect(sim.world.arena).toBeNull();
    const types: string[] = sim.world.events.map((ev) => ev.type);
    expect(types).toContain('intruderIntro');
    expect(types).not.toContain('intruderWarning');
    const intro = rules.stage.legendary!.moveSets['legend-suicune']!.freezeIntro!;
    const e = sim.world.enemies;
    // 凍る前は、雑魚は動いている（新しくは出ない）
    step(1);
    expect(sim.world.intruder!.frozen).toBeUndefined();
    const count = e.count;
    expect(Array.from(e.speed.subarray(0, count)).some((v) => v > 0)).toBe(true);
    // 凍ると止まり、触れても痛くない
    step(intro.freezeAtSeconds - 1 + 0.1);
    expect(sim.world.intruder!.frozen).toBe(true);
    for (let i = 0; i < e.count; i++) {
      expect(e.speed[i]).toBe(0);
      expect(e.damage[i]).toBe(0);
    }
    // 消える
    step(intro.goneAtSeconds - intro.freezeAtSeconds);
    let alive = 0;
    for (let i = 0; i < e.count; i++) if (e.hp[i]! > 0) alive++;
    expect(alive).toBe(0);
    expect(sim.world.arena).toBeNull();
    for (let t = 0; t < 30 * 2 && !sim.world.arena; t++) {
      sim.step([]);
      types.push(...sim.world.events.map((ev) => ev.type));
    }
    expect(sim.world.arena).toBeTruthy();
    expect(types).toContain('intruderWarning');
    step(0.2);
    expect(bossIndex()).not.toBe(-1);
  });

  it('凍てつく間も、ランの時計は止まる', () => {
    const { sim, kind, step } = setup(false);
    step(3);
    const start = sim.world.sectionStartTick;
    startIntruder(sim.world, kind);
    for (let t = 0; t < 30 * 70 && sim.world.intruder && !sim.world.intruder.done; t++) sim.step([]);
    step(4);
    expect(sim.world.arena).toBeNull();
    expect(sim.world.sectionStartTick).toBeGreaterThan(start + 64 * 30);
  });

  it('ほかの準伝説は、すぐ「DANGER」のまま', () => {
    const { sim, rules } = setup(false);
    startIntruder(sim.world, rules.enemies.kinds.findIndex((k) => k.id === 'legend-raikou'));
    expect(sim.world.arena).toBeTruthy();
    expect(sim.world.intruder?.introUntil).toBeUndefined();
  });
});

describe('スイクンの技（07 の218章）', () => {
  it('なみのり: 端から反対側へ帯が進み、切れ目がある。スイクンも一緒に走る', () => {
    const { step, of, force, sim, bossIndex } = setup();
    const a = sim.world.arena!;
    force('suicune-to-side', 'suicune-surf');
    step(1.6);
    sim.world.bosses[0]!.interval = 30 * 100;
    const startX = sim.world.enemies.x[bossIndex()]!;
    expect(Math.abs(startX - a.x)).toBeGreaterThan(600);
    step(1);
    const waves = of('suicune-wave');
    expect(waves.length).toBe(2);
    const [w1, w2] = waves;
    const gap = w2!.y - (w1!.y + w1!.length);
    expect(gap).toBeGreaterThan(250);
    step(2);
    expect(Math.sign(sim.world.enemies.x[bossIndex()]! - startX)).toBe(-Math.sign(startX - a.x));
    expect(Math.abs(w1!.x - (a.x + Math.sign(startX - a.x) * a.halfWidth))).toBeGreaterThan(100);
  });

  it('なみのり: 切れ目の見た目の中にいれば当たらない', () => {
    const { step, of, force, sim, p, bossIndex } = setup();
    const a = sim.world.arena!;
    const e = sim.world.enemies;
    e.x[bossIndex()] = a.x - 720;
    force('suicune-surf');
    step(0.1);
    const [w1, w2] = of('suicune-wave');
    const top = w1!.y + w1!.length;
    const bottom = w2!.y;
    // 切れ目の端の近く（プレイヤーの半径の分だけ内側）に立つ
    const hp = p.hp;
    for (let t = 0; t < 30 * 5; t++) {
      p.x = a.x + 300;
      p.y = top + 14;
      p.invincibleTicks = 0;
      step(1 / 30);
      if (t === 0) expect(bottom - top).toBeGreaterThan(200);
    }
    expect(p.hp).toBe(hp);
  });

  it('オーロラビーム: 向きが回り、通った跡に凍った床が残る。床は当たらない', () => {
    const { step, of, force, sim, p } = setup();
    p.x = sim.world.arena!.x;
    p.y = sim.world.arena!.y + 250;
    force('suicune-aurora');
    step(1.3);
    const beam = of('suicune-aurora')[0]!;
    const dir0 = Math.atan2(beam.dirY, beam.dirX);
    step(1.5);
    expect(Math.atan2(beam.dirY, beam.dirX)).not.toBeCloseTo(dir0, 1);
    const ice = sim.world.zones.filter((z) => z.unpainted);
    expect(ice.length).toBeGreaterThan(5);
    expect(ice[0]!.damagePerSecond).toBe(0);
    expect(ice[0]!.slowPct).toBeGreaterThan(0);
  });

  it('ミラーコート: 受けたダメージが多いほど、破片が増える', () => {
    const count = (loss: number): number => {
      const s = setup();
      s.force('suicune-mirror-coat');
      s.step(0.5);
      const e = s.sim.world.enemies;
      e.hp[s.bossIndex()] = e.hp[s.bossIndex()]! - e.maxHp[s.bossIndex()]! * loss;
      s.step(2.7);
      return s.of('suicune-shard').length;
    };
    const none = count(0);
    const many = count(0.1);
    expect(none).toBe(8);
    expect(many).toBeGreaterThan(none);
    const shard = buildSimRules('johto').stage.moves.find((m) => m.id === 'suicune-shard')!;
    expect(shard.bullets!.speed).toBeLessThan(180);
  });

  it('ふぶき: HP 50% で 1 回。氷の塊の風下は当たらず、外は当たる。風向きが変わる', () => {
    const { step, of, sim, bossIndex, rules, p } = setup();
    const a = sim.world.arena!;
    const e = sim.world.enemies;
    sim.world.bosses[0]!.hpMoves = [{ belowRatio: 0.5, moves: [rules.stage.moves.findIndex((m) => m.id === 'suicune-to-center')] }];
    e.hp[bossIndex()] = e.maxHp[bossIndex()]! * 0.49;
    const pos = { x: a.x + 700, y: a.y };
    const hurtDuring = (seconds: number): number => {
      const hp = p.hp;
      for (let t = 0; t < seconds * 30; t++) {
        p.x = pos.x;
        p.y = pos.y;
        p.invincibleTicks = 0;
        step(1 / 30);
      }
      return hp - p.hp;
    };
    let n = 0;
    while (of('suicune-ice').length === 0 && n++ < 300) step(1 / 30);
    expect(of('suicune-ice').length).toBe(6);
    // 塊のない場所は当たる
    expect(hurtDuring(2.1 + 2.6)).toBeGreaterThan(0);
    // 風下（右の塊の右）
    const s2 = setup();
    const a2 = s2.sim.world.arena!;
    s2.sim.world.bosses[0]!.hpMoves = [{ belowRatio: 0.5, moves: [s2.rules.stage.moves.findIndex((m) => m.id === 'suicune-to-center')] }];
    s2.sim.world.enemies.hp[s2.bossIndex()] = s2.sim.world.enemies.maxHp[s2.bossIndex()]! * 0.49;
    let m = 0;
    while (s2.of('suicune-ice').length === 0 && m++ < 300) s2.step(1 / 30);
    const rightTop = s2.of('suicune-ice').reduce((q, h) => (h.x > q.x && h.y < a2.y ? h : q));
    const hp = s2.p.hp;
    for (let t = 0; t < 30 * 4.9; t++) {
      s2.p.x = rightTop.x + 120;
      s2.p.y = rightTop.y;
      s2.p.invincibleTicks = 0;
      s2.step(1 / 30);
    }
    expect(s2.p.hp).toBe(hp);
    const front1 = s2.rules.stage.moves.find((x) => x.id === 'suicune-front-1')!.blizzard!;
    const front2 = s2.rules.stage.moves.find((x) => x.id === 'suicune-front-2')!.blizzard!;
    expect([front1.dirX, front1.dirY]).not.toEqual([front2.dirX, front2.dirY]);
  });

  it('1 分の中で全部の技を使い、走り去って戻る。常に遅くなる効果はない', () => {
    const { sim, rules } = setup();
    expect(rules.stage.legendary!.moveSets['legend-suicune']!.field!.slowPct).toBeUndefined();
    const seen = new Set<string>();
    for (let t = 0; t < 30 * 70 && sim.world.arena; t++) {
      sim.step([]);
      for (const h of sim.world.hazards) seen.add(rules.stage.moves[h.move]?.id ?? '');
    }
    for (const id of ['suicune-roar', 'suicune-surf', 'suicune-aurora', 'suicune-mirror-coat', 'suicune-glide', 'suicune-flee']) expect(seen).toContain(id);
    expect(sim.world.arena).toBeNull();
  });
});
