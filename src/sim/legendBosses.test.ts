import { describe, expect, it } from 'vitest';
import { buildSimRules } from '../data/simRules';
import { Simulation } from './simulation';

/**
 * 伝説ボスの強化（作者の案 2026年10月26日）: 本番のデータで伝説戦を始めて、それぞれの戦い方を確かめる
 */
function legend(id: string, players = 1) {
  const rules = buildSimRules();
  const sim = new Simulation({ tickRate: 30, seed: 3, rules });
  for (let k = 0; k < players; k++) sim.addPlayer({ id: k + 1, x: k * 120, y: 0, radius: 12, moveSpeed: 0 });
  const kind = rules.enemies.kinds.findIndex((k) => k.id === id);
  sim.world.cleared = true;
  sim.world.legendary = { kind, appearTick: sim.world.tick + 1, endTick: sim.world.tick + 30 * 600, spawned: false, result: null };
  for (let t = 0; t < 3; t++) sim.step([]);
  const e = sim.world.enemies;
  const i = [...Array(e.count).keys()].find((k) => e.kind[k] === kind)!;
  return { rules, sim, kind, i, p: sim.world.players[0]! };
}

// ミュウツーは固定マップの戦いに作り直した（07 の250章）。テストは src/sim/mewtwoArena.test.ts
// フリーザーは固定マップの戦いに作り直した（07 の251章）。テストは src/sim/articunoArena.test.ts

// サンダーは固定マップの戦いに作り直した（07 の252章）。テストは src/sim/zapdosArena.test.ts
// ファイヤーは固定マップの戦いに作り直した（07 の253章）。テストは src/sim/moltresArena.test.ts
// ミュウは固定マップの戦いに作り直した（07 の257章）。テストは src/sim/mewArena.test.ts

describe('色違いの御三家（プレイヤーと同じ技）', () => {
  // 色違いのリザードンは固定マップの戦いに作り直した（07 の254章）。テストは src/sim/shinyCharizardArena.test.ts

  // 色違いのフシギバナは固定マップの戦いに作り直した（07 の255章）。テストは src/sim/shinyVenusaurArena.test.ts

  // 色違いのカメックスは固定マップの戦いに作り直した（07 の256章）。テストは src/sim/shinyBlastoiseArena.test.ts
  it('伝説の HP は 5 倍のうえ人数倍（2人で 10 倍）、動く速さは 1.15 倍（作者の依頼 2026年10月29日。07 の123章・124章）', () => {
    const one = legend('legend-mewtwo', 1);
    const two = legend('legend-mewtwo', 2);
    const kind = one.rules.enemies.kinds[one.kind]!;
    expect(one.sim.world.enemies.maxHp[one.i]).toBeCloseTo(kind.hp * 5);
    expect(two.sim.world.enemies.maxHp[two.i]).toBeCloseTo(kind.hp * 10);
    expect(one.sim.world.enemies.speed[one.i]).toBeCloseTo(kind.moveSpeed * 1.15);
  });

  it('協力プレイの伝説は、直近に一番ダメージを与えた人を追い（2秒は乗り換えない）、足元を狙う技は全員の足元に落とす（07 の125章）', () => {
    const { sim, i } = legend('legend-articuno', 2);
    const w = sim.world;
    const id = w.enemies.id[i]!;
    const hit = (by: number, amount: number) => ({ type: 'damageEnemy', id, amount, by, kbx: 0, kby: 0, kbTicks: 0, status: -1, statusTicks: 0 }) as const;
    sim.step([hit(2, 100)]);
    expect(w.legendTargets.get(id)).toBe(2);
    expect(w.events.some((ev) => ev.type === 'legendTarget' && ev.playerId === 2)).toBe(true);
    // すぐに 1 がたくさん当てても、2 秒たつまでは乗り換えない
    sim.step([hit(1, 1000)]);
    expect(w.legendTargets.get(id)).toBe(2);
    for (let t = 0; t < 2 * 30 + 2; t++) sim.step([]);
    expect(w.legendTargets.get(id)).toBe(1);
    // 足元に落とす技（色違いのリザードンの ブラストバーン）は、2 人それぞれの近くに落ちる
    const blizzard = w.rules.stage.moves.findIndex((m) => m.id === 'charizard-s-blast-burn');
    const boss = w.bosses[0]!;
    boss.moves = [blizzard];
    boss.next = 0;
    boss.hpMoves = [];
    const near = new Set<number>();
    for (let t = 0; t < 30 * 20 && near.size < 2; t++) {
      sim.step([]);
      for (const h of w.hazards) {
        if (h.move !== blizzard) continue;
        for (const p of w.players) if (Math.hypot(h.x - p.x, h.y - p.y) < 1) near.add(p.id);
      }
    }
    expect([...near].sort()).toEqual([1, 2]);
  });
});
