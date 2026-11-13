import { describe, expect, it } from 'vitest';
import { buildSimRules } from '../data/simRules';
import { Simulation } from './simulation';
import { startLegendary } from './systems/stage';

/** 色違いのカメックスの固定マップの戦い（07 の256章）: 甲羅で回って間合いを詰め、目の前で撃ち合うインファイター */
function setup(seed = 3) {
  const rules = buildSimRules();
  const sim = new Simulation({ tickRate: 30, seed, rules });
  sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 180 });
  const p = sim.world.players[0]!;
  sim.world.cleared = true;
  startLegendary(sim.world, rules.enemies.kinds.findIndex((k) => k.id === 'shiny-blastoise'));
  const w = sim.world;
  const step = (seconds: number): void => {
    for (let t = 0; t < Math.round(seconds * 30); t++) {
      p.hp = p.maxHp = 1e6;
      p.invincibleTicks = 0;
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
  const idx = (id: string): number => rules.stage.moves.findIndex((m) => m.id === id);
  const hostile = (key: string): number => {
    const move = rules.moves.findIndex((m) => m.key === key);
    let n = 0;
    for (let k = 0; k < w.projectiles.count; k++) if (w.projectiles.move[k] === move && w.projectiles.owner[k]! >= 60000) n++;
    return n;
  };
  /** プレイヤーをボスから向き (dx, dy) へ dist の場所に置く */
  const place = (dist: number, dx = 1, dy = 0): void => {
    p.x = w.enemies.x[i()]! + dx * dist;
    p.y = w.enemies.y[i()]! + dy * dist;
  };
  return { rules, sim, w, p, boss, i, of, idx, step, hostile, place };
}

const angle = (x: number, y: number): number => (Math.atan2(y, x) * 180) / Math.PI;
const diff = (a: number, b: number): number => ((((a - b) % 360) + 540) % 360) - 180;

describe('色違いのカメックス（07 の256章）', () => {
  it('固定マップで戦い、プレイヤーと同じ あわ を出し続ける', () => {
    const { w, step, hostile } = setup();
    expect(w.arena).not.toBeNull();
    let bubbles = 0;
    for (let t = 0; t < 30 * 4; t++) {
      step(1 / 30);
      bubbles = Math.max(bubbles, hostile('bubble'));
    }
    expect(bubbles).toBeGreaterThan(0);
  });

  it('離れていると、近くの技の代わりに アクアジェット: 狙った人の少し先まで一直線に突っ込む（予告の間は止まる）', () => {
    const { w, p, i, step, of, place } = setup();
    place(500);
    let jet: ReturnType<typeof of>[number] | undefined;
    for (let t = 0; t < 30 * 4 && !jet; t++) {
      place(500);
      step(1 / 30);
      jet = of('blastoise-s-aqua-jet')[0];
    }
    expect(jet).toBeDefined();
    // 長さは狙った人までの距離 + 80
    expect(jet!.length).toBeCloseTo(Math.hypot(p.x - jet!.x, p.y - jet!.y) + 80, 0);
    const start = { x: w.enemies.x[i()]!, y: w.enemies.y[i()]! };
    step(0.5);
    // 予告の間は動かない
    expect(Math.hypot(w.enemies.x[i()]! - start.x, w.enemies.y[i()]! - start.y)).toBeLessThan(1);
    step(1.2);
    // 帯の端（狙った人の少し先）まで来ている
    const endX = jet!.x + jet!.dirX * jet!.length;
    const endY = jet!.y + jet!.dirY * jet!.length;
    expect(Math.hypot(w.enemies.x[i()]! - endX, w.enemies.y[i()]! - endY)).toBeLessThan(40);
  });

  it('近くでは ハイドロカノン: 狙った向きの左右 14° に 2 本の流れ（V 字）。出している間は止まっている', () => {
    const { w, p, i, step, of, place } = setup();
    let arms: ReturnType<typeof of> = [];
    for (let t = 0; t < 30 * 4 && arms.length === 0; t++) {
      place(150, 0, 1);
      step(1 / 30);
      arms = of('blastoise-s-hydro-cannon');
    }
    expect(arms.length).toBe(2);
    const aim = angle(p.x - w.enemies.x[i()]!, p.y - w.enemies.y[i()]!);
    const a = arms.map((h) => diff(angle(h.dirX, h.dirY), aim)).sort((x, y) => x - y);
    expect(a[0]).toBeCloseTo(-14, 0);
    expect(a[1]).toBeCloseTo(14, 0);
    // 撃っている間は止まったまま
    for (let t = 0; t < 30 && !arms[0]!.activeTicks; t++) step(1 / 30);
    const at = { x: w.enemies.x[i()]!, y: w.enemies.y[i()]! };
    step(0.5);
    expect(Math.hypot(w.enemies.x[i()]! - at.x, w.enemies.y[i()]! - at.y)).toBeLessThan(1);
  });

  it('バブルこうせん: 当たると押し流されて間合いが開く', () => {
    const { w, p, boss, i, step, of, idx, place } = setup();
    boss.forced = [idx('blastoise-s-bubble-beam')];
    place(200);
    let beam: ReturnType<typeof of>[number] | undefined;
    for (let t = 0; t < 30 * 3 && !beam?.activeTicks; t++) {
      step(1 / 30);
      beam = of('blastoise-s-bubble-beam')[0];
      // 線の上に立ち続ける
      if (beam) {
        p.x = beam.x + beam.dirX * 200;
        p.y = beam.y + beam.dirY * 200;
      }
    }
    expect(beam?.activeTicks).toBeDefined();
    const before = Math.hypot(p.x - w.enemies.x[i()]!, p.y - w.enemies.y[i()]!);
    step(0.4);
    expect(Math.hypot(p.x - w.enemies.x[i()]!, p.y - w.enemies.y[i()]!)).toBeGreaterThan(before + 80);
  });

  it('しおふき: 狙った人のまわりに降らせる。HP が多いほど数が多い（満タンで 12、半分で 6）', () => {
    const count = (hpRatio: number): number => {
      const { w, i, boss, step, of, idx } = setup();
      w.enemies.hp[i()] = w.enemies.maxHp[i()]! * hpRatio;
      boss.hpMoves = [];
      boss.forced = [idx('blastoise-s-water-spout')];
      let n = 0;
      for (let t = 0; t < 30 * 2; t++) {
        step(1 / 30);
        n = Math.max(n, of('blastoise-s-water-spout').length);
      }
      return n;
    };
    expect(count(1)).toBe(12);
    expect(count(0.5)).toBe(6);
  });

  it('HP 66% で アクアジェット 3 連: 突っ込むたびに、止まった所で ハイドロカノン', () => {
    const { w, i, step, of } = setup();
    w.enemies.hp[i()] = w.enemies.maxHp[i()]! * 0.65;
    const jets = new Set<object>();
    const cannons = new Set<number>();
    for (let t = 0; t < 30 * 14; t++) {
      // 狙った人はボスから離れていく（突っ込んでくる）
      const k = i();
      const p = w.players[0]!;
      const dx = p.x - w.enemies.x[k]!;
      const dy = p.y - w.enemies.y[k]!;
      const d = Math.hypot(dx, dy) || 1;
      if (d < 200) {
        p.x = w.enemies.x[k]! + (dx / d) * 200;
        p.y = w.enemies.y[k]! + (dy / d) * 200;
      }
      step(1 / 30);
      for (const h of of('blastoise-s-aqua-jet')) jets.add(h);
      for (const h of of('blastoise-s-hydro-cannon')) if (h.group !== undefined) cannons.add(h.group);
    }
    expect(jets.size).toBeGreaterThanOrEqual(3);
    expect(cannons.size).toBeGreaterThanOrEqual(3);
  });

  it('HP 33% で 究極のハイドロカノン: 真ん中で甲羅にこもり、V 字の 2 本の流れを、ゆっくり回し始めて加速しながら 1 周回す。その後 4 秒止まる', () => {
    const { w, i, boss, step, of } = setup();
    w.enemies.hp[i()] = w.enemies.maxHp[i()]! * 0.32;
    // HP 66% の大技は飛ばす
    boss.hpMoves = boss.hpMoves!.filter((h) => h.belowRatio < 0.5);
    const ult = (): ReturnType<typeof of> => [...of('blastoise-s-ultimate-cw'), ...of('blastoise-s-ultimate-ccw')];
    for (let t = 0; t < 30 * 8 && !(ult().length === 2 && ult()[0]!.activeTicks !== undefined); t++) step(1 / 30);
    const arms = ult();
    expect(arms.length).toBe(2);
    // 真ん中で
    expect(Math.hypot(w.enemies.x[i()]! - w.arena!.x, w.enemies.y[i()]! - w.arena!.y)).toBeLessThan(20);
    // V 字: 2 本の間は 50°
    expect(Math.abs(diff(angle(arms[0]!.dirX, arms[0]!.dirY), angle(arms[1]!.dirX, arms[1]!.dirY)))).toBeCloseTo(50, 0);
    const a0 = angle(arms[0]!.dirX, arms[0]!.dirY);
    let turned = 0;
    let last = a0;
    const at: number[] = [];
    for (let t = 0; t < Math.round(3.2 * 30) - 1; t++) {
      step(1 / 30);
      const a = angle(arms[0]!.dirX, arms[0]!.dirY);
      turned += diff(a, last);
      last = a;
      at.push(Math.abs(turned));
    }
    // 1 周（ほぼ 360°）回る
    expect(Math.abs(turned)).toBeGreaterThan(340);
    // 加速: 前半の 1.6 秒で回るのは 1/4 ほど
    expect(at[47]!).toBeLessThan(110);
    // 回っている間は止まったまま、その後 4 秒止まる
    let recharge = false;
    for (let t = 0; t < 30 * 3; t++) {
      step(1 / 30);
      recharge ||= of('blastoise-s-recharge').length > 0;
    }
    expect(recharge).toBe(true);
  });

  it('究極のハイドロカノンの回る向きは、戦いごとに右回りと左回りがある', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12 && seen.size < 2; seed++) {
      const { w, i, boss, step, of } = setup(seed);
      w.enemies.hp[i()] = w.enemies.maxHp[i()]! * 0.32;
      boss.hpMoves = boss.hpMoves!.filter((h) => h.belowRatio < 0.5);
      for (let t = 0; t < 30 * 8; t++) {
        step(1 / 30);
        if (of('blastoise-s-ultimate-cw').length) seen.add('cw');
        if (of('blastoise-s-ultimate-ccw').length) seen.add('ccw');
        if (seen.size && (of('blastoise-s-ultimate-cw').length || of('blastoise-s-ultimate-ccw').length)) break;
      }
    }
    expect(seen.size).toBe(2);
  });
});
