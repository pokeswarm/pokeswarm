import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import { Simulation } from './simulation';

/**
 * 作者の指摘（2026年10月27日）:
 * - 光線（れいとうビームなど）は、数を増やすと本数は増えず幅が広がる
 * - 追尾して貫通する弾は、1体目に当たった後は別の敵へ進む
 * - ほろびのうた: 3回くらった雑魚は確定で倒れる（ボスには効かない）
 * - ぜったいれいど: 倒した敵が氷の破片を飛ばす
 * - ほのおのパンチ・かみなりパンチ: マッハパンチと同じく一番近い敵へ飛び、当たると小さなスプラッシュ
 * - うたう: 音符はランダムな向きへ
 */
function setup(move: string, level = 1) {
  const rules = buildSimRules();
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const m = moveIndexOf(rules, move);
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, moves: [{ move: m, level }] });
  return { rules, sim, p, m };
}
const kindOf = (rules: ReturnType<typeof buildSimRules>, rank: string) => rules.enemies.kinds.findIndex((k) => (k.rank ?? 'normal') === rank);

describe('光線の数', () => {
  it('数を増やしても1本のまま、幅が広がる', () => {
    const widths = [1, 3].map((count) => {
      const { sim, p, m } = setup('ice-beam');
      p.mods.amountBonus = count - 1;
      sim.world.enemies.add(1, 0, 150, 0, 1e9, 0, 10);
      // 光線は短い間だけ出る: 出ている間の本数と太さを見る
      let n = 0;
      let r = 0;
      for (let t = 0; t < 40; t++) {
        sim.step([]);
        const pr = sim.world.projectiles;
        const beams = [...Array(pr.count).keys()].filter((i) => pr.move[i] === m && pr.stage[i] === 0);
        n = Math.max(n, beams.length);
        for (const i of beams) r = Math.max(r, pr.radius[i]!);
      }
      return { n, r };
    });
    expect(widths[1]!.n).toBe(widths[0]!.n);
    expect(widths[1]!.r).toBeGreaterThan(widths[0]!.r * 1.5);
  });
});

describe('ほろびのうた', () => {
  it('3回くらった雑魚は倒れ、ボスは倒れない', () => {
    const { rules, sim, m } = setup('perish-song');
    const normal = kindOf(rules, 'normal');
    const boss = kindOf(rules, 'boss');
    sim.world.enemies.add(900001, normal, 100, 0, 1e7, 0, 10);
    sim.world.enemies.add(900002, boss, -100, 0, 1e7, 0, 10);
    for (let t = 0; t < 30 * 4; t++) sim.step([]);
    const e = sim.world.enemies;
    const alive = [...Array(e.count).keys()].map((i) => e.id[i]);
    expect(alive).not.toContain(900001);
    expect(alive).toContain(900002);
    void m;
  });
});

describe('ぜったいれいど', () => {
  it('倒した敵が氷の破片を飛ばす', () => {
    const { rules, sim, m } = setup('sheer-cold');
    for (let k = 0; k < 6; k++) sim.world.enemies.add(k + 1, kindOf(rules, 'normal'), 80 + k * 30, 40, 1, 0, 10);
    let shards = 0;
    for (let t = 0; t < 40; t++) {
      sim.step([]);
      const pr = sim.world.projectiles;
      for (let i = 0; i < pr.count; i++) if (pr.move[i] === m && pr.stage[i] === 1) shards++;
    }
    expect(shards).toBeGreaterThan(0);
  });
});

describe('ほのおのパンチ・かみなりパンチ', () => {
  for (const key of ['fire-punch', 'thunder-punch']) {
    it(`${key}: 一番近い敵へ飛び、当たるとスプラッシュ`, () => {
      const { sim, m } = setup(key);
      sim.world.enemies.add(1, 0, 120, 30, 1e9, 0, 10);
      let splash = 0;
      for (let t = 0; t < 40; t++) {
        sim.step([]);
        const pr = sim.world.projectiles;
        for (let i = 0; i < pr.count; i++) if (pr.move[i] === m && pr.stage[i] === 1) splash++;
      }
      expect(splash).toBeGreaterThan(0);
    });
  }
});

describe('ばくれつパンチ', () => {
  it('連打が確率で、ほのおのパンチ・かみなりパンチのスプラッシュとして弾ける', () => {
    const { rules, sim } = setup('dynamic-punch', 24);
    for (let k = 0; k < 8; k++) sim.world.enemies.add(k + 1, 0, 40 + k * 8, 0, 1e9, 0, 14);
    const seen = new Set<number>();
    for (let t = 0; t < 30 * 4; t++) {
      sim.step([]);
      const pr = sim.world.projectiles;
      for (let i = 0; i < pr.count; i++) if (pr.stage[i] === 1) seen.add(pr.move[i]!);
    }
    expect(seen.has(moveIndexOf(rules, 'fire-punch'))).toBe(true);
    expect(seen.has(moveIndexOf(rules, 'thunder-punch'))).toBe(true);
  });
});

describe('追尾と貫通', () => {
  it('貫通する追尾の弾は、当たった敵を追い続けず次の敵へ進む', () => {
    const { sim, p } = setup('swift');
    p.mods.pierceBonus = 3;
    sim.world.enemies.add(1, 0, 80, 0, 1e9, 0, 10);
    sim.world.enemies.add(2, 0, 80, 140, 1e9, 0, 10);
    const e = sim.world.enemies;
    for (let t = 0; t < 60; t++) sim.step([]);
    expect(e.hp[0]!).toBeLessThan(1e9);
    expect(e.hp[1]!).toBeLessThan(1e9);
  });
});

describe('うたう', () => {
  it('音符はランダムな向きに飛ぶ（使うたびに向きが違う）', () => {
    const { sim, m } = setup('sing');
    const angles: number[] = [];
    for (let t = 0; t < 30 * 5; t++) {
      const before = sim.world.projectiles.count;
      sim.step([]);
      const pr = sim.world.projectiles;
      for (let i = before; i < pr.count; i++) if (pr.move[i] === m) angles.push(Math.round(Math.atan2(pr.vy[i]!, pr.vx[i]!) * 100));
    }
    expect(new Set(angles).size).toBeGreaterThan(5);
  });
});
