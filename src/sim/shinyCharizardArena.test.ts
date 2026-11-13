import { describe, expect, it } from 'vitest';
import { buildSimRules } from '../data/simRules';
import { Simulation } from './simulation';
import { startLegendary } from './systems/stage';

/** 色違いのリザードンの固定マップの戦い（07 の254章）: プレイヤーのリザードンの一番強いビルドと同じ技で戦う */
function setup(seed = 3) {
  const rules = buildSimRules();
  const sim = new Simulation({ tickRate: 30, seed, rules });
  sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 180 });
  const p = sim.world.players[0]!;
  sim.world.cleared = true;
  startLegendary(sim.world, rules.enemies.kinds.findIndex((k) => k.id === 'shiny-charizard'));
  const w = sim.world;
  const step = (seconds: number): void => {
    for (let t = 0; t < Math.round(seconds * 30); t++) {
      p.hp = p.maxHp = 1e6;
      p.invincibleTicks = 0;
      p.burnTicks = 0;
      sim.step([]);
    }
  };
  step(3.5);
  const boss = w.bosses[0]!;
  const i = (): number => {
    for (let k = 0; k < w.enemies.count; k++) if (w.enemies.id[k] === boss.id) return k;
    return -1;
  };
  const of = (id: string) => w.hazards.filter((h) => rules.stage.moves[h.move]?.id === id);
  const hostile = (key: string): number => {
    const move = rules.moves.findIndex((m) => m.key === key);
    let n = 0;
    for (let k = 0; k < w.projectiles.count; k++) if (w.projectiles.move[k] === move && w.projectiles.owner[k]! >= 60000) n++;
    return n;
  };
  return { rules, sim, w, p, boss, i, of, step, hostile };
}

describe('色違いのリザードン（07 の254章）', () => {
  it('固定マップで戦い、プレイヤーと同じ エアスラッシュ を出し続ける', () => {
    const { w, step, hostile } = setup();
    expect(w.arena).not.toBeNull();
    let slash = 0;
    for (let t = 0; t < 30 * 4; t++) {
      step(1 / 30);
      slash = Math.max(slash, hostile('air-slash'));
    }
    expect(slash).toBeGreaterThan(0);
  });

  it('ブラストバーン: 狙った人の足元に予告してから柱。狙い直して 3 回', () => {
    const { w, p, step, of } = setup();
    const marks = new Set<object>();
    for (let t = 0; t < 30 * 12 && marks.size < 3; t++) {
      step(1 / 30);
      for (const h of of('charizard-s-blast-burn')) {
        if (marks.has(h)) continue;
        marks.add(h);
        // 置いた時の狙った人の場所
        expect(Math.hypot(h.x - p.x, h.y - p.y)).toBeLessThan(80);
      }
    }
    expect(marks.size).toBe(3);
    void w;
  });

  it('HP 66% で フレアドライブ: 炎をまとい（体のまわりに当たる）、3 回突進し、反動で HP を 4% 失い、技の間隔が短くなる', () => {
    const { w, i, boss, step, of } = setup();
    w.enemies.hp[i()] = w.enemies.maxHp[i()]! * 0.65;
    let aura = 0;
    const dashes = new Set<object>();
    for (let t = 0; t < 30 * 8; t++) {
      step(1 / 30);
      aura = Math.max(aura, of('charizard-s-mantle').length);
      for (const h of of('charizard-s-blaze-dash')) dashes.add(h);
    }
    expect(aura).toBeGreaterThan(0);
    expect(dashes.size).toBe(3);
    expect(w.enemies.hp[i()]! / w.enemies.maxHp[i()]!).toBeCloseTo(0.61, 2);
    expect(boss.stacks).toBe(1);
  });

  it('HP 33% で 究極のブラストバーン: 真ん中で 8 方向に柱の列を根元から外へ。その後 4 秒止まる', () => {
    const { w, i, step, of } = setup();
    w.enemies.hp[i()] = w.enemies.maxHp[i()]! * 0.32;
    let pillars = 0;
    let recharge = false;
    for (let t = 0; t < 30 * 20; t++) {
      step(1 / 30);
      pillars = Math.max(pillars, of('charizard-s-ultimate').length);
      recharge ||= of('charizard-s-recharge').length > 0;
    }
    expect(pillars).toBe(48);
    expect(recharge).toBe(true);
  });
});
