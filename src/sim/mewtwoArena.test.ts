import { describe, expect, it } from 'vitest';
import { buildSimRules } from '../data/simRules';
import { Simulation } from './simulation';
import { startLegendary } from './systems/stage';

/** ミュウツーの固定マップの戦い（07 の〔ミュウツー〕章） */
function setup(seed = 3) {
  const rules = buildSimRules();
  const sim = new Simulation({ tickRate: 30, seed, rules });
  sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 180 });
  const p = sim.world.players[0]!;
  sim.world.cleared = true;
  const kind = rules.enemies.kinds.findIndex((k) => k.id === 'legend-mewtwo');
  startLegendary(sim.world, kind);
  const w = sim.world;
  const step = (seconds: number): void => {
    for (let t = 0; t < Math.round(seconds * 30); t++) {
      p.hp = p.maxHp = 1e9;
      sim.step([]);
    }
  };
  step(3.5);
  const boss = w.bosses[0]!;
  const i = (): number => {
    for (let k = 0; k < w.enemies.count; k++) if (w.enemies.id[k] === boss.id) return k;
    return -1;
  };
  const idx = (id: string): number => rules.stage.moves.findIndex((m) => m.id === id);
  const force = (...ids: string[]): void => {
    w.hazards.length = 0;
    boss.moves = ids.map(idx);
    boss.next = 0;
    boss.cooldown = 1;
    boss.hpMoves = [];
  };
  const of = (id: string) => w.hazards.filter((h) => rules.stage.moves[h.move]?.id === id);
  return { rules, sim, w, p, boss, i, idx, force, of, step };
}

describe('ミュウツー（07 の〔ミュウツー〕章）', () => {
  it('固定マップで戦い、歩かない（テレポートで移る）', () => {
    const { w, i, boss, step } = setup();
    expect(w.arena).not.toBeNull();
    boss.moves = [];
    boss.hpMoves = [];
    w.hazards.length = 0;
    const x = w.enemies.x[i()]!;
    const y = w.enemies.y[i()]!;
    step(2);
    expect(Math.hypot(w.enemies.x[i()]! - x, w.enemies.y[i()]! - y)).toBeLessThan(1);
  });

  it('テレポート: 消えて、狙った人から 300〜440 のマップの中に現れる', () => {
    const { w, p, i, force, of, step } = setup();
    force('mewtwo-blink');
    step(0.2);
    const hz = of('mewtwo-blink')[0]!;
    expect(w.hiddenEnemies.has(hz.dasher)).toBe(true);
    const d = Math.hypot(hz.x - p.x, hz.y - p.y);
    expect(d).toBeGreaterThanOrEqual(299);
    expect(d).toBeLessThanOrEqual(441);
    step(0.6);
    expect(Math.round(w.enemies.x[i()]!)).toBe(Math.round(hz.x));
  });

  it('サイコキネシス: 狙った人を囲む岩から、その人の場所を通る線。落ちると岩がその向きへ飛ぶ', () => {
    const { p, force, of, step } = setup();
    force('mewtwo-psychic');
    step(0.2);
    const lines = of('mewtwo-psychic');
    expect(lines.length).toBe(5);
    for (const h of lines) {
      // 線は狙った人の場所を通る
      const tx = p.x - h.x;
      const ty = p.y - h.y;
      expect(Math.abs(tx * h.dirY - ty * h.dirX)).toBeLessThan(2);
      expect(tx * h.dirX + ty * h.dirY).toBeGreaterThan(0);
    }
    step(1.5);
    const rocks = of('mewtwo-rock');
    expect(rocks.length).toBe(5);
    expect(rocks.every((r) => r.activeTicks !== undefined)).toBe(true);
  });

  it('バリアーを張っている間は、投げる岩が多い', () => {
    const { boss, force, of, step } = setup();
    boss.barrier = 1000;
    force('mewtwo-psychic');
    step(0.2);
    expect(of('mewtwo-psychic').length).toBe(8);
  });

  it('はどうだん: ためてから狙った人へまっすぐ撃ち（追わない）、消えるときに 14 個の小さな玉に弾ける', () => {
    const { p, i, w, force, of, step } = setup();
    force('mewtwo-aura-sphere');
    step(1.2);
    const orb = of('mewtwo-aura-orb')[0]!;
    const bx = w.enemies.x[i()]!;
    const by = w.enemies.y[i()]!;
    const d = Math.hypot(p.x - bx, p.y - by) || 1;
    expect(orb.dirX).toBeCloseTo((p.x - bx) / d, 1);
    expect(orb.dirY).toBeCloseTo((p.y - by) / d, 1);
    // 追わない: プレイヤーが動いても向きは変わらない
    const dir = [orb.dirX, orb.dirY];
    p.x += 200;
    step(1);
    expect([orb.dirX, orb.dirY]).toEqual(dir);
    step(2);
    expect(of('mewtwo-aura-shard').length).toBe(14);
  });

  it('HP 66% でバリアー。割れると 3 秒ふらつく', () => {
    const { w, boss, i, idx, step, of } = setup();
    w.enemies.hp[i()] = w.enemies.maxHp[i()]! * 0.65;
    step(3);
    expect(boss.barrier).toBeGreaterThan(0);
    boss.forced = [idx('mewtwo-barrier-break')];
    for (let h = w.hazards.length - 1; h >= 0; h--) if (!w.rules.stage.moves[w.hazards[h]!.move]?.barrier) w.hazards.splice(h, 1);
    step(0.5);
    expect(of('mewtwo-stun').length).toBe(1);
    expect(of('mewtwo-barrier').length).toBe(0);
  });

  it('HP 33% でマップの真ん中へ移り、4 本の念の光を右回り・左回りに回し、その後疲れて止まる', () => {
    const { w, i, step, of } = setup();
    w.enemies.hp[i()] = w.enemies.maxHp[i()]! * 0.32;
    const seen = new Set<string>();
    let centered = false;
    let turned = 0;
    for (let t = 0; t < 30 * 25; t++) {
      step(1 / 30);
      for (const h of w.hazards) seen.add(w.rules.stage.moves[h.move]!.id);
      const arms = of('mewtwo-psystrike-1');
      if (arms.length) {
        centered ||= Math.abs(w.enemies.x[i()]! - w.arena!.x) < 1 && Math.abs(w.enemies.y[i()]! - w.arena!.y) < 1;
        expect(arms.length).toBe(4);
        const a = arms[0]!;
        if (a.activeTicks !== undefined && a.baseDirX !== undefined) turned = Math.max(turned, Math.abs(Math.atan2(a.dirX * a.baseDirY! - a.dirY * a.baseDirX!, a.dirX * a.baseDirX! + a.dirY * a.baseDirY!)));
      }
    }
    expect(centered).toBe(true);
    for (const id of ['mewtwo-to-center', 'mewtwo-psystrike-1', 'mewtwo-psystrike-2', 'mewtwo-tired']) expect(seen).toContain(id);
    expect(turned).toBeGreaterThan(1.2);
  });

  it('ミュウの ゆびをふる が使う昔の技（サイコブレイク・サイケこうせん）は残っている', () => {
    const { rules } = setup();
    const pool = rules.stage.legendary!.moveSets['legend-mew']!.pool!;
    for (const id of ['mewtwo-psystrike', 'mewtwo-psybeam']) {
      expect(pool).toContain(id);
      expect(rules.stage.moves.some((m) => m.id === id)).toBe(true);
    }
  });
});
