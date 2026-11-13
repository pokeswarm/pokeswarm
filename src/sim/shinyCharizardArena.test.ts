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

  it('突進は予告の帯の上を走る（予告の間も突進の間も、間合いの動きで帯から外れない）', () => {
    const { w, i, step, of } = setup();
    w.enemies.hp[i()] = w.enemies.maxHp[i()]! * 0.65;
    let checked = 0;
    for (let t = 0; t < 30 * 8; t++) {
      step(1 / 30);
      for (const h of of('charizard-s-blaze-dash')) {
        const rx = w.enemies.x[i()]! - h.x;
        const ry = w.enemies.y[i()]! - h.y;
        const along = rx * h.dirX + ry * h.dirY;
        // 今走っている帯（と、まだ動いていない予告）だけ: 体は帯の真ん中の線の上
        if (h.activeTicks === undefined ? Math.abs(along) > 1 : along < 0 || along > h.length) continue;
        expect(Math.abs(-rx * h.dirY + ry * h.dirX)).toBeLessThan(2);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
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

  it('究極のブラストバーンの柱は、噴き出した後、出した場所の周りを層ごとに逆の向きへ回る（中心からの距離は変わらない）', () => {
    const { w, i, step, of } = setup();
    w.enemies.hp[i()] = w.enemies.maxHp[i()]! * 0.32;
    // 全部の柱が噴き出すまで進める
    for (let t = 0; t < 30 * 20 && !(of('charizard-s-ultimate').length === 48 && of('charizard-s-ultimate').every((h) => h.activeTicks !== undefined)); t++) step(1 / 30);
    const pillars = of('charizard-s-ultimate');
    expect(pillars.every((h) => h.activeTicks !== undefined)).toBe(true);
    const before = pillars.map((h) => ({ h, a: Math.atan2(h.y - h.orbitY!, h.x - h.orbitX!), d: Math.hypot(h.x - h.orbitX!, h.y - h.orbitY!) }));
    // 中心は全部同じ（出したときのボスの場所）
    for (const p of before) {
      expect(p.h.orbitX).toBeCloseTo(before[0]!.h.orbitX!, 3);
      expect(p.h.orbitY).toBeCloseTo(before[0]!.h.orbitY!, 3);
    }
    step(1);
    const turned = (p: (typeof before)[number]): number => {
      const a = Math.atan2(p.h.y - p.h.orbitY!, p.h.x - p.h.orbitX!);
      return Math.atan2(Math.sin(a - p.a), Math.cos(a - p.a));
    };
    const byLayer = new Map<number, number[]>();
    for (const p of before) {
      expect(Math.hypot(p.h.x - p.h.orbitX!, p.h.y - p.h.orbitY!)).toBeCloseTo(p.d, 3);
      const layer = Math.round((p.d - 140) / 120);
      byLayer.set(layer, [...(byLayer.get(layer) ?? []), turned(p)]);
    }
    expect(byLayer.size).toBe(6);
    for (const [layer, turns] of byLayer) {
      // 1 層 8 本が同じ向きに回る。隣の層とは逆
      for (const t of turns) expect(Math.sign(t)).toBe(layer % 2 === 0 ? 1 : -1);
      expect(Math.abs(turns[0]!)).toBeGreaterThan(0.2);
    }
  });
});
