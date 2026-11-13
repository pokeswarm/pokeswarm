import { describe, expect, it } from 'vitest';
import { buildSimRules } from '../data/simRules';
import { Simulation } from './simulation';
import { startLegendary } from './systems/stage';

/** 色違いのフシギバナの固定マップの戦い（07 の255章）: プレイヤーのフシギバナの一番強いビルドの技で戦う */
function setup(seed = 3) {
  const rules = buildSimRules();
  const sim = new Simulation({ tickRate: 30, seed, rules });
  sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 180 });
  const p = sim.world.players[0]!;
  sim.world.cleared = true;
  startLegendary(sim.world, rules.enemies.kinds.findIndex((k) => k.id === 'shiny-venusaur'));
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
  return { rules, sim, w, p, boss, i, of, idx, step, hostile };
}

describe('色違いのフシギバナ（07 の255章）', () => {
  it('固定マップで戦い、プレイヤーと同じ はっぱカッター を出し続ける', () => {
    const { w, step, hostile } = setup();
    expect(w.arena).not.toBeNull();
    let leaves = 0;
    for (let t = 0; t < 30 * 4; t++) {
      step(1 / 30);
      leaves = Math.max(leaves, hostile('razor-leaf'));
    }
    expect(leaves).toBeGreaterThan(0);
  });

  it('ヘドロばくだん: 狙った人のまわりに 5 つ落とし、落ちた所に毒だまりが残る。当たると どく', () => {
    // 最初の技が ヘドロばくだん（予告が重ならないよう、1 回分だけ数える）
    const { p, step, of } = setup(5);
    let bombs = 0;
    let puddles = 0;
    let poisoned = false;
    for (let t = 0; t < 30 * 4; t++) {
      step(1 / 30);
      bombs = Math.max(bombs, of('venusaur-s-sludge-bomb').length);
      puddles = Math.max(puddles, of('venusaur-s-sludge-puddle').length);
      poisoned ||= (p.poisonTicks ?? 0) > 0;
    }
    expect(bombs).toBe(5);
    expect(puddles).toBe(5);
    // 1 つ目は足元に落ちる
    expect(poisoned).toBe(true);
  });

  it('のしかかり: 狙った人の今の場所へ跳び、予告が終わるときに着地する。当たると まひ', () => {
    const { w, p, boss, i, step, of, idx } = setup();
    boss.forced = [idx('venusaur-s-body-slam')];
    let mark: { x: number; y: number } | null = null;
    for (let t = 0; t < 30 * 3 && !mark; t++) {
      step(1 / 30);
      const h = of('venusaur-s-body-slam')[0];
      if (h) mark = { x: h.x, y: h.y };
    }
    expect(mark).not.toBeNull();
    let landed = false;
    for (let t = 0; t < 30 * 2 && !landed; t++) {
      step(1 / 30);
      landed = of('venusaur-s-body-slam').every((h) => h.activeTicks !== undefined);
    }
    expect(Math.hypot(w.enemies.x[i()]! - mark!.x, w.enemies.y[i()]! - mark!.y)).toBeLessThan(40);
    expect(p.paralyzeTicks ?? 0).toBeGreaterThan(0);
  });

  it('ギガドレイン: 光線に入っていると、フシギバナが回復する', () => {
    const { w, boss, i, step, of, idx } = setup();
    w.enemies.hp[i()] = w.enemies.maxHp[i()]! * 0.8;
    boss.forced = [idx('venusaur-s-giga-drain')];
    let struck = false;
    for (let t = 0; t < 30 * 3 && !struck; t++) {
      step(1 / 30);
      struck = of('venusaur-s-giga-drain').some((h) => h.activeTicks !== undefined);
    }
    expect(struck).toBe(true);
    expect(w.enemies.hp[i()]! / w.enemies.maxHp[i()]!).toBeCloseTo(0.82, 2);
  });

  it('HP 66% で ねむりごな: 流れる雲を 8 つ置き、入ると眠って動けない。その後 のしかかり を 3 回', () => {
    const { w, p, i, step, of } = setup();
    w.enemies.hp[i()] = w.enemies.maxHp[i()]! * 0.65;
    let clouds: ReturnType<typeof of> = [];
    for (let t = 0; t < 30 * 5 && clouds.length === 0; t++) {
      step(1 / 30);
      const c = of('venusaur-s-sleep-powder');
      if (c.length === 8 && c.every((h) => h.activeTicks !== undefined)) clouds = c;
    }
    expect(clouds.length).toBe(8);
    // 雲は流れる
    const x0 = clouds[0]!.x;
    const y0 = clouds[0]!.y;
    step(1);
    expect(Math.hypot(clouds[0]!.x - x0, clouds[0]!.y - y0)).toBeGreaterThan(10);
    // 雲に入ると眠る（動けない）
    p.x = clouds[1]!.x;
    p.y = clouds[1]!.y;
    step(2 / 30);
    expect(p.sleepTicks ?? 0).toBeGreaterThan(0);
    expect(p.frozenTicks ?? 0).toBeGreaterThan(0);
    const slams = new Set<object>();
    for (let t = 0; t < 30 * 10; t++) {
      step(1 / 30);
      for (const h of of('venusaur-s-body-slam')) slams.add(h);
    }
    expect(slams.size).toBeGreaterThanOrEqual(3);
  });

  it('HP 33% で 究極のハードプラント: 真ん中で、狙った人の足元に根を次々と突き出す。根は残り、その間は動かない。その後 4 秒止まる', () => {
    const { w, p, i, step, of } = setup();
    w.enemies.hp[i()] = w.enemies.maxHp[i()]! * 0.32;
    const roots = new Set<object>();
    let recharge = false;
    let movedWhileRooted = false;
    let at: { x: number; y: number } | null = null;
    for (let t = 0; t < 30 * 20; t++) {
      // 狙った人は歩き回る（根は今いる場所に出る）
      p.x = Math.cos(t / 20) * 300;
      p.y = Math.sin(t / 20) * 200;
      step(1 / 30);
      const now = of('venusaur-s-frenzy-plant');
      for (const h of now) {
        if (roots.has(h)) continue;
        roots.add(h);
        expect(Math.hypot(h.x - p.x, h.y - p.y)).toBeLessThan(30);
      }
      if (now.some((h) => h.activeTicks !== undefined)) {
        at ??= { x: w.enemies.x[i()]!, y: w.enemies.y[i()]! };
        movedWhileRooted ||= Math.hypot(w.enemies.x[i()]! - at.x, w.enemies.y[i()]! - at.y) > 2;
      }
      recharge ||= of('venusaur-s-recharge').length > 0;
    }
    expect(roots.size).toBe(14);
    expect(Math.hypot(at!.x - w.arena!.x, at!.y - w.arena!.y)).toBeLessThan(20);
    expect(movedWhileRooted).toBe(false);
    expect(recharge).toBe(true);
  });
});
