import { describe, expect, it } from 'vitest';
import type { BossMove } from '../data/schema';
import type { SimRules } from './rules';
import { Simulation } from './simulation';
import { testRules } from './testRules';

const CIRCLE: BossMove = { id: 'circle', effect: 'test', shape: 'circle', target: 'player', telegraphSeconds: 0.5, radius: 50, damage: 30, count: 1, spread: 0 };
const NOVA: BossMove = { id: 'nova', effect: 'test', shape: 'circle', target: 'self', telegraphSeconds: 0.5, radius: 200, damage: 20, count: 1, spread: 0 };
const DASH: BossMove = { id: 'dash', effect: 'test', shape: 'line', target: 'player', telegraphSeconds: 0.5, radius: 20, length: 300, damage: 25, count: 1, spread: 0, dashSpeed: 600 };

/** 敵の種類: 0 雑魚・1 中ボス・2 四天王A・3 四天王B・4 伝説・5 突進の群れ・6 囲む群れ */
function stageRules(stage: Partial<SimRules['stage']> = {}): SimRules {
  return testRules({
    move: { range: 1 },
    extraKinds: [
      { id: 'mid', rank: 'midboss', hp: 500, moveSpeed: 0, radius: 20, contactDamage: 0, xp: 50, types: [0] },
      { id: 'e4a', rank: 'boss', hp: 1000, moveSpeed: 0, radius: 30, contactDamage: 0, xp: 0, types: [0] },
      { id: 'e4b', rank: 'boss', hp: 1000, moveSpeed: 0, radius: 30, contactDamage: 0, xp: 0, types: [0] },
      { id: 'legend', rank: 'legendary', hp: 2000, moveSpeed: 0, radius: 30, contactDamage: 0, xp: 0, types: [0] },
      { id: 'rush', hp: 10, moveSpeed: 0, radius: 10, contactDamage: 0, types: [0] },
      { id: 'ring', hp: 50, moveSpeed: 30, radius: 14, contactDamage: 0, types: [0] },
    ],
    stage: {
      durationSeconds: 100,
      bosses: [
        { wave: 0, afterSeconds: 1, gate: false, kind: 'mid', moves: [], required: false },
        { wave: 0, afterSeconds: 2, gate: false, kind: 'e4a', moves: ['circle'], moveIntervalSeconds: 1, required: true },
        { wave: 0, afterSeconds: 2, gate: false, kind: 'e4b', moves: [], required: true },
      ],
      moves: [CIRCLE, NOVA, DASH],
      ...stage,
    },
  });
}

function run(sim: Simulation, ticks: number): string[] {
  const types: string[] = [];
  for (let t = 0; t < ticks; t++) {
    sim.step([]);
    types.push(...sim.world.events.map((e) => e.type));
  }
  return types;
}

function killKind(sim: Simulation, kind: number): void {
  const e = sim.world.enemies;
  for (let i = 0; i < e.count; i++) {
    if (e.kind[i] !== kind || e.hp[i]! <= 0) continue;
    sim.step([{ type: 'damageEnemy', id: e.id[i]!, amount: 1e9, by: 1, kbx: 0, kby: 0, kbTicks: 0, status: -1, statusTicks: 0 }]);
    return;
  }
  throw new Error(`種類 ${kind} の敵がいません`);
}

function solo(rules: SimRules, moveSpeed = 0) {
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed });
  return { sim, p };
}

describe('中ボス・ボスの出現', () => {
  it('予定の時間に出て、HP は参加人数に応じて上がる', () => {
    const sim = new Simulation({ tickRate: 30, seed: 1, rules: stageRules() });
    sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0 });
    sim.addPlayer({ id: 2, x: 0, y: 0, radius: 12, moveSpeed: 0 });
    run(sim, 30);
    expect(sim.world.enemies.count).toBe(0);
    expect(run(sim, 1)).toContain('bossAppeared');
    // hpPerExtraPlayerPct 50 → 2人で 1.5倍
    expect(sim.world.enemies.hp[0]).toBe(750);
    run(sim, 30);
    expect(sim.world.enemies.count).toBe(3);
    expect(sim.world.bosses).toHaveLength(1);
  });

  it('前の時間帯の種類でも、中ボスは離れすぎても消さない', () => {
    const rules = stageRules({ bosses: [{ wave: 1, afterSeconds: 0.5, gate: false, kind: 'mid', moves: [], required: false }] });
    rules.spawn.waves = [
      { durationSeconds: 0.5, hpMultiplier: 1, damageMultiplier: 1, kinds: ['test'] },
      { hpMultiplier: 1, damageMultiplier: 1, kinds: ['test'] },
    ];
    const { sim, p } = solo(rules);
    run(sim, 31);
    p.x = 5000;
    expect(run(sim, 2)).not.toContain('enemyRetired');
    expect(sim.world.enemies.count).toBe(1);
  });

  it('中ボスはノックバックされず、こおりの時間が短い', () => {
    const { sim } = solo(stageRules({ bosses: [] }));
    sim.world.enemies.add(1, 1, 100, 0, 500, 0, 20);
    sim.step([{ type: 'damageEnemy', id: 1, amount: 1, by: 1, kbx: 100, kby: 0, kbTicks: 10, status: 1, statusTicks: 40 }]);
    expect(sim.world.enemies.kbTicks[0]).toBe(0);
    // こおりは stopStatusMultiplier 0.25 で 40 → 10（この更新で1つ減る）
    expect(sim.world.enemies.statusTicks[0 * sim.world.statusKinds.length + 1]).toBe(9);
  });
});

describe('区間の進行', () => {
  function gateRules() {
    const rules = stageRules({
      bosses: [
        { wave: 0, afterSeconds: 1, gate: true, kind: 'mid', moves: [], required: false },
        { wave: 1, afterSeconds: 1, gate: true, kind: 'mid', moves: [], required: false },
      ],
    });
    rules.spawn.waves = [
      { hpMultiplier: 1, damageMultiplier: 1, kinds: ['test'] },
      { hpMultiplier: 1, damageMultiplier: 1, kinds: ['test'] },
      { durationSeconds: 1, hpMultiplier: 1, damageMultiplier: 1, kinds: ['test'] },
      { hpMultiplier: 1, damageMultiplier: 1, kinds: ['test'] },
    ];
    return rules;
  }

  it('中ボスを倒すまでは次の区間へ進まず、倒すと進む。次の中ボスは区間が始まってから数える', () => {
    const { sim } = solo(gateRules());
    run(sim, 31);
    expect(sim.world.gateIds.size).toBe(1);
    run(sim, 300);
    expect(sim.world.section).toBe(0);
    killKind(sim, 1);
    expect(sim.world.section).toBe(1);
    expect(sim.world.events.map((e) => e.type)).toContain('sectionAdvanced');
    // 2体目は区間1が始まって1秒後
    run(sim, 29);
    expect(sim.world.gateIds.size).toBe(0);
    run(sim, 2);
    expect(sim.world.gateIds.size).toBe(1);
  });

  it('中ボスのいない区間は時間で進み、最後の区間からは進まない', () => {
    const { sim } = solo(gateRules());
    run(sim, 31);
    killKind(sim, 1);
    run(sim, 31);
    killKind(sim, 1);
    expect(sim.world.section).toBe(2);
    run(sim, 31);
    expect(sim.world.section).toBe(3);
    run(sim, 300);
    expect(sim.world.section).toBe(3);
  });

  it('ゲストはホストの区間に合わせる', () => {
    const sim = new Simulation({ tickRate: 30, seed: 1, rules: gateRules(), role: 'guest' });
    sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0 });
    sim.step([{ type: 'setSection', section: 2 }]);
    expect(sim.world.section).toBe(2);
    run(sim, 300);
    expect(sim.world.section).toBe(2);
  });
});

describe('範囲技', () => {
  const only = (moves: string[]) => stageRules({ bosses: [{ wave: 0, afterSeconds: 0, gate: false, kind: 'e4a', moves, moveIntervalSeconds: 1, required: false }] });

  it('円: 足元に予告し、動かなければ当たる。予告の間に外へ出れば当たらない', () => {
    const hit = solo(only(['circle']), 200);
    expect(run(hit.sim, 31)).toContain('hazardTelegraphed');
    run(hit.sim, 15);
    expect(hit.p.hp).toBe(70);
    const dodge = solo(only(['circle']), 200);
    run(dodge.sim, 31);
    dodge.sim.step([{ type: 'move', playerId: 1, dx: 1, dy: 0 }]);
    run(dodge.sim, 14);
    expect(dodge.p.hp).toBe(100);
  });

  it('四天王の第2段階: HP が半分を切ると「DANGER」を出し、技の間隔が短くなる', () => {
    const rules = stageRules({ bosses: [{ wave: 0, afterSeconds: 0, gate: false, kind: 'e4a', moves: ['circle'], moveIntervalSeconds: 3, required: true, enrage: { hpRatio: 0.5, moveIntervalSeconds: 1, doubleChance: 0 } }] });
    const { sim } = solo(rules);
    run(sim, 2);
    const boss = sim.world.bosses[0]!;
    expect(boss.interval).toBe(90);
    const e = sim.world.enemies;
    const i = Array.from(e.kind.subarray(0, e.count)).indexOf(2);
    sim.step([{ type: 'damageEnemy', id: e.id[i]!, amount: 600, by: 1, kbx: 0, kby: 0, kbTicks: 0, status: -1, statusTicks: 0 }]);
    // 第2段階はダメージを受けたその更新の中で始まる
    const types = [...sim.world.events.map((ev) => ev.type), ...run(sim, 2)];
    expect(types).toContain('legendaryWarning');
    expect(boss.enraged).toBe(true);
    expect(boss.interval).toBe(30);
  });

  it('自分の周り: ボスの位置を中心に落ちる', () => {
    const { sim, p } = solo(only(['nova']));
    run(sim, 31);
    const hz = sim.world.hazards[0]!;
    expect(Math.hypot(hz.x - sim.world.enemies.x[0]!, hz.y - sim.world.enemies.y[0]!)).toBeLessThan(1);
    run(sim, 15);
    // ボスは spawnDistance 300 の所。半径200の外なので当たらない
    expect(p.hp).toBe(100);
  });

  it('直線の突進: 線の上にいれば当たり、ボスは線に沿って進む', () => {
    const { sim, p } = solo(only(['dash']));
    run(sim, 31);
    const before = { x: sim.world.enemies.x[0]!, y: sim.world.enemies.y[0]! };
    run(sim, 15);
    expect(p.hp).toBe(75);
    run(sim, 10);
    const moved = Math.hypot(sim.world.enemies.x[0]! - before.x, sim.world.enemies.y[0]! - before.y);
    expect(moved).toBeGreaterThan(150);
  });
});

describe('ランの進行と終わり', () => {
  it('四天王を全員倒すとクリア。中ボスを倒してもクリアにならず、経験値を落とす', () => {
    const { sim } = solo(stageRules());
    run(sim, 61);
    killKind(sim, 1);
    expect(sim.world.outcome).toBeNull();
    expect(sim.world.gems.value[0]).toBe(50);
    killKind(sim, 2);
    expect(sim.world.outcome).toBeNull();
    killKind(sim, 3);
    expect(sim.world.outcome).toBe('clear');
    const tick = sim.world.tick;
    run(sim, 10);
    expect(sim.world.tick).toBe(tick);
  });

  it('制限時間までに四天王が残っていたら失敗', () => {
    const { sim } = solo(stageRules({ durationSeconds: 3 }));
    run(sim, 61);
    killKind(sim, 2);
    const types = run(sim, 40);
    expect(types).toContain('runEnded');
    expect(sim.world.outcome).toBe('fail');
  });

  it('全員が倒れると失敗', () => {
    const { sim, p } = solo(stageRules({ bosses: [] }));
    sim.world.enemies.add(1, 0, 0, 0, 1000, 0, 10, 1000);
    sim.step([]);
    expect(p.down).toBe(true);
    expect(sim.world.outcome).toBe('fail');
  });

  it('雑魚の経験値に時間帯の倍率を掛ける', () => {
    const rules = stageRules({ bosses: [] });
    rules.spawn.waves = [{ hpMultiplier: 1, damageMultiplier: 1, xpMultiplier: 3, kinds: ['test'] }];
    const { sim } = solo(rules);
    sim.world.enemies.add(1, 0, 300, 0, 10, 0, 10);
    sim.step([{ type: 'damageEnemy', id: 1, amount: 50, by: 1, kbx: 0, kby: 0, kbTicks: 0, status: -1, statusTicks: 0 }]);
    expect(sim.world.gems.value[0]).toBe(3);
  });
});

describe('伝説の乱入', () => {
  const legendary = { chance: 1, kinds: ['legend'], moves: ['circle'], moveSets: {}, moveIntervalSeconds: 1, warningSeconds: 1, timeLimitSeconds: 2 };

  it('クリアすると「DANGER」の後、雑魚が消えて伝説が出る。倒すとクリア（倒した）', () => {
    const { sim } = solo(stageRules({ legendary }));
    run(sim, 61);
    sim.world.enemies.add(999, 0, 200, 0, 10, 0, 10);
    killKind(sim, 2);
    killKind(sim, 3);
    expect(sim.world.events.map((e) => e.type)).toContain('legendaryWarning');
    expect(sim.world.outcome).toBeNull();
    expect(sim.world.cleared).toBe(true);
    run(sim, 31);
    // 雑魚と中ボスは消え、伝説だけ
    const kinds = Array.from(sim.world.enemies.kind.subarray(0, sim.world.enemies.count));
    expect(kinds).toEqual([4]);
    killKind(sim, 4);
    expect(sim.world.outcome).toBe('clear');
    expect(sim.world.legendary?.result).toBe('won');
  });

  it('HP が半分を切ると第2段階（もう一度「DANGER」・技の間隔が短くなる）', () => {
    const { sim } = solo(
      stageRules({
        legendary: {
          ...legendary,
          timeLimitSeconds: 60,
          enrage: { hpRatio: 0.5, moveIntervalSeconds: 0.5, doubleChance: 0 },
        },
      }),
    );
    run(sim, 61);
    killKind(sim, 2);
    killKind(sim, 3);
    // 「DANGER」から1秒で伝説
    run(sim, 31);
    // HP を半分より下にする
    const e = sim.world.enemies;
    const i = Array.from(e.kind.subarray(0, e.count)).indexOf(4);
    e.hp[i] = e.maxHp[i]! * 0.4;
    const types = run(sim, 2);
    expect(types).toContain('legendaryWarning');
    expect(sim.world.bosses[0]!.enraged).toBe(true);
    expect(sim.world.bosses[0]!.interval).toBe(15);
  });

  it('伝説ごとの技: 次々に降る円・外へ広がる輪・後ろへの瞬間移動・遅くなる床', () => {
    const STAGGER: BossMove = { id: 'stagger', effect: 'test', shape: 'circle', target: 'player', telegraphSeconds: 0.5, radius: 40, damage: 0, count: 3, spread: 100, stagger: 0.5, leaves: { seconds: 2, slowPct: 40, damagePerSecond: 0, color: '#81d4fa' } };
    const RINGS: BossMove = { id: 'rings', effect: 'test', shape: 'ring', target: 'self', telegraphSeconds: 0.5, radius: 100, damage: 0, count: 1, spread: 0, rings: { count: 3, step: 100, width: 40 }, stagger: 0.3 };
    const TELE: BossMove = { id: 'tele', effect: 'test', shape: 'circle', target: 'player', telegraphSeconds: 0.5, radius: 60, damage: 0, count: 1, spread: 150, teleport: true };
    const cfg = { ...legendary, moves: ['circle'], moveSets: { legend: { moves: ['stagger', 'rings', 'tele'], random: false } }, moveIntervalSeconds: 2, timeLimitSeconds: 60 };
    const { sim, p } = solo(stageRules({ legendary: cfg, moves: [CIRCLE, NOVA, DASH, STAGGER, RINGS, TELE] }));
    run(sim, 61);
    killKind(sim, 2);
    killKind(sim, 3);
    run(sim, 31);
    // 1つ目の技（次々に降る円）: 予告の長さが 0.5 秒ずつずれる
    run(sim, 60);
    const ticks = sim.world.hazards.map((h) => h.totalTicks).sort((a, b) => a - b);
    expect(ticks).toEqual([15, 30, 45]);
    // 落ちると床が残り、上にいると遅くなる
    run(sim, 16);
    expect(sim.world.zones.length).toBeGreaterThan(0);
    expect(p.zoneSlowPct).toBe(40);
    // 2つ目の技（輪）: 外側ほど大きく、遅れて落ちる
    run(sim, 60 - 16);
    const rings = sim.world.hazards.filter((h) => h.shape === 'ring').sort((a, b) => a.radius - b.radius);
    expect(rings.map((h) => [h.radius, h.innerRadius, h.totalTicks])).toEqual([
      [100, 60, 15],
      [200, 160, 24],
      [300, 260, 33],
    ]);
    // 3つ目の技（瞬間移動）: プレイヤーの後ろ（右を向いているので左）に予告し、落ちたらそこへ現れる
    run(sim, 60);
    const tele = sim.world.hazards.find((h) => h.dasher !== -1)!;
    expect(tele.x).toBeCloseTo(-150);
    run(sim, 16);
    const e = sim.world.enemies;
    const i = Array.from(e.kind.subarray(0, e.count)).indexOf(4);
    expect(e.x[i]).toBeCloseTo(-150);
  });

  it('時間内に倒せなければ逃げられるが、クリアのまま', () => {
    const { sim } = solo(stageRules({ legendary }));
    run(sim, 61);
    killKind(sim, 2);
    killKind(sim, 3);
    run(sim, 30 + 61);
    expect(sim.world.outcome).toBe('clear');
    expect(sim.world.legendary?.result).toBe('timeUp');
  });
});

describe('スウォームイベント', () => {
  it('突進の群れはプレイヤーを追わずにまっすぐ進み、離れたら消える', () => {
    const { sim } = solo(
      stageRules({ bosses: [], swarms: [{ atSeconds: 0, everySeconds: 100, untilSeconds: 0, kind: 'rush', pattern: 'rush', count: 9, spacing: 20, speed: 900 }] }),
    );
    expect(run(sim, 1)).toContain('swarmStarted');
    expect(sim.world.enemies.count).toBe(9);
    const e = sim.world.enemies;
    const v0 = [e.vx[0]!, e.vy[0]!];
    run(sim, 10);
    expect([e.vx[0], e.vy[0]]).toEqual(v0);
    // 900/秒で通り抜け、移し替えの距離（900）より離れたら消える
    const types = run(sim, 90);
    expect(types).toContain('enemyRetired');
    expect(sim.world.enemies.count).toBe(0);
  });

  it('囲む群れはプレイヤーの周りにぐるりと出る', () => {
    const { sim } = solo(
      stageRules({ bosses: [], swarms: [{ atSeconds: 0, everySeconds: 100, untilSeconds: 0, kind: 'ring', pattern: 'encircle', count: 12, radius: 400 }] }),
    );
    run(sim, 1);
    const e = sim.world.enemies;
    expect(e.count).toBe(12);
    for (let i = 0; i < e.count; i++) expect(Math.hypot(e.x[i]!, e.y[i]!)).toBeCloseTo(400 - 30 / 30, 0);
  });
  it('じばく: 近づいたら止まって範囲を予告し、落ちると中のプレイヤーにダメージを与えて、いなくなる', () => {
    const BOOM: BossMove = { id: 'boom', effect: 'test', shape: 'circle', target: 'self', telegraphSeconds: 0.5, radius: 90, damage: 30, count: 1, spread: 0, selfDestruct: true };
    const rules = stageRules({
      bosses: [],
      moves: [CIRCLE, NOVA, DASH, BOOM],
      swarms: [{ atSeconds: 0, everySeconds: 100, untilSeconds: 0, kind: 'ring', pattern: 'bomber', count: 1, triggerRange: 100, move: 'boom' }],
    });
    rules.enemies.kinds[6]!.moveSpeed = 600;
    const { sim, p } = solo(rules);
    const hp = p.hp;
    const types = run(sim, 60);
    expect(types).not.toContain('swarmStarted');
    expect(types).toContain('hazardTelegraphed');
    expect(types).toContain('hazardStruck');
    expect(types).toContain('enemyRetired');
    expect(sim.world.enemies.count).toBe(0);
    expect(p.hp).toBeLessThan(hp);
    expect(sim.world.stats.kills).toBe(0);
  });
});
