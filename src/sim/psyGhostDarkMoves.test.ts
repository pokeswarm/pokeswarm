import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import { MOTION_ORBIT } from './entities/projectiles';
import { Simulation } from './simulation';
import { hurtPlayer } from './systems/health';

/** ホウエンの技の作り直し（3）エスパー・ゴースト・あく（作者の指摘 2026年11月1日。07 の154章） */
function setup(move: string) {
  const rules = buildSimRules('hoenn');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const m = moveIndexOf(rules, move);
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, moves: [{ move: m, level: 1 }] });
  p.facingX = 1;
  p.facingY = 0;
  const pr = sim.world.projectiles;
  const find = (pred: (i: number) => boolean): number[] => [...Array(pr.count).keys()].filter(pred);
  return { rules, sim, p, m, pr, find };
}

describe('ミラーコート・マジックコート（受けたダメージを返す。効き方 hurt）', () => {
  it('鏡の輪が出ている間にダメージを受けると、受けた量 × 2 の衝撃の輪が自分から広がる', () => {
    const t = setup('mirror-coat');
    const def = t.rules.moves[t.m]!;
    expect(def.pattern).toBe('aura');
    expect(def.effects[0]!.trigger).toBe('hurt');
    t.sim.step([]);
    expect(t.find((i) => t.pr.move[i] === t.m && t.pr.stage[i] === 0)).toHaveLength(1);
    const hp0 = t.p.hp;
    hurtPlayer(t.sim.world, t.p, 40);
    const taken = hp0 - t.p.hp;
    expect(taken).toBeGreaterThan(0);
    t.sim.step([]);
    const rings = t.find((i) => t.pr.move[i] === t.m && t.pr.stage[i] === 1 && t.pr.band[i]! > 0);
    expect(rings).toHaveLength(1);
    expect(t.pr.damage[rings[0]!]).toBeCloseTo(taken * 2, 3);
  });
  it('鏡の輪が無いときは返さない', () => {
    const t = setup('mirror-coat');
    hurtPlayer(t.sim.world, t.p, 40);
    // 技を出す前に受けた分は、技を出した更新では返さない（出ている間に受けた分だけ）
    t.sim.step([]);
    expect(t.find((i) => t.pr.move[i] === t.m && t.pr.stage[i] === 1)).toHaveLength(0);
  });
});

describe('リフレクター・サイコキネシス・みらいよち', () => {
  it('リフレクターは光の板 4 枚が回り、受けるダメージが 30% 減る', () => {
    const t = setup('reflect');
    expect(t.rules.moves[t.m]!.selfBuff?.mods.damageTakenPct).toBe(-30);
    t.sim.step([]);
    const panels = t.find((i) => t.pr.move[i] === t.m);
    expect(panels).toHaveLength(4);
    expect(t.pr.motion[panels[0]!]).toBe(MOTION_ORBIT);
    expect(t.p.mods.damageTakenPct).toBe(-30);
  });
  it('サイコキネシスは使った瞬間に引き寄せ（負のノックバック）、念の波が広がる', () => {
    const t = setup('psychic');
    t.sim.step([]);
    const pull = t.find((i) => t.pr.move[i] === t.m && t.pr.stage[i] === 1);
    expect(pull).toHaveLength(1);
    expect(t.pr.knockback[pull[0]!]).toBeLessThan(0);
    expect(t.find((i) => t.pr.move[i] === t.m && t.pr.stage[i] === 0 && t.pr.band[i]! > 0)).toHaveLength(1);
  });
  it('みらいよち（2 つ）は敵の足元に印を置く strike で、1.5 秒後に弾ける', () => {
    for (const key of ['future-sight', 'future-sight-gardevoir']) {
      const t = setup(key);
      const def = t.rules.moves[t.m]!;
      expect(def.pattern).toBe('strike');
      expect(def.delayedBlast?.seconds).toBe(1.5);
    }
  });
});

describe('ふいうち・つじぎり・ナイトヘッド・ナイトバースト', () => {
  it('ふいうちは一番近い敵の足元、つじぎりはまっすぐ飛ぶ刃、ナイトヘッドはすり抜ける顔、ナイトバーストは攻撃を下げる', () => {
    const s = setup('sucker-punch');
    s.sim.world.enemies.add(1, 0, 150, 20, 1e6, 0, 10);
    s.sim.step([]);
    const amb = s.find((i) => s.pr.move[i] === s.m);
    expect(amb).toHaveLength(1);
    expect(Math.hypot(s.pr.x[amb[0]!]! - 150, s.pr.y[amb[0]!]! - 20)).toBeLessThan(1);
    const n = setup('night-slash');
    n.sim.step([]);
    const blade = n.find((i) => n.pr.move[i] === n.m);
    expect(blade).toHaveLength(1);
    expect(n.pr.vx[blade[0]!]).toBeGreaterThan(0);
    expect(n.rules.moves[n.m]!.levels[0]!.critChancePct).toBe(35);
    const f = setup('night-shade');
    expect(f.rules.moves[f.m]!.levels[0]!.pierce).toBe(Infinity);
    const d = setup('night-daze');
    expect(d.rules.moves[d.m]!.levels[0]!.status).toBeGreaterThanOrEqual(0);
    expect(d.rules.moves[d.m]!.levels[0]!.statusChance).toBe(0.4);
  });
});
