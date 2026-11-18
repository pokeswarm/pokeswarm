import { describe, expect, it } from 'vitest';
import { buildSimRules, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { maxCharges } from './activeSkills';
import { makeOffers, applyOffer } from './systems/leveling';

/** 遊べるミュウツー（07 の305章）: 最初の技・アクティブスキルのテレポート・サイコブレイク */
function setup(moves?: string[]) {
  const rules = buildSimRules('kanto');
  const lo = playableLoadout(rules, 'mewtwo');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const ids = moves ? moves.map((k) => ({ move: rules.moves.findIndex((m) => m.key === k), level: 1 })) : lo.moves;
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 180, types: lo.types, species: lo.species, moves: ids, line: 'mewtwo', fixedMoves: lo.fixedMoves });
  return { rules, sim, p };
}

describe('遊べるミュウツー', () => {
  it('最初から ねんりき・サイケこうせん・じこさいせい・みらいよち を持ち、新しい技は覚えない', () => {
    const rules = buildSimRules('kanto');
    const lo = playableLoadout(rules, 'mewtwo');
    expect(lo.moves.map((m) => rules.moves[m.move]!.key)).toEqual(['confusion', 'psybeam', 'recover', 'future-sight']);
    expect(lo.fixedMoves).toBe(true);
  });

  it('派生: ねんりき → サイコキネシス → サイコブレイク、サイケこうせん ＋ のろいのおふだ → シャドーボール', () => {
    const { rules } = setup();
    const key = (i: number) => rules.moves[i]!.key;
    const item = (i: number) => rules.items[i]!.key;
    const routes = rules.derivations.filter((d) => d.line === 'mewtwo').map((d) => `${key(d.from)}+${item(d.item)}>${key(d.to)}`);
    expect(routes).toContain('psychic+x-sp-atk>psystrike');
    expect(routes).toContain('psybeam+spell-tag>shadow-ball');
  });

  it('テレポート: SPACE を離すと進む向きへ移り、回数が減り、技の威力が上がる。続けて移ると重なる', () => {
    const { rules, sim, p } = setup();
    const d = rules.activeSkills!.defs[p.skills![0]!.skill]!;
    expect(d.key).toBe('teleport');
    // 回数を 2 にして続けて使う
    p.skills![0]!.level = 2;
    p.skills![0]!.charges = 2;
    sim.step([{ type: 'move', playerId: 1, dx: 1, dy: 0 }]);
    const x0 = p.x;
    sim.step([{ type: 'useSkill', playerId: 1, slot: 0 }]);
    expect(p.x - x0).toBeGreaterThan(d.distance - 10);
    expect(p.skills![0]!.charges).toBe(1);
    expect(p.skillBuff?.stacks).toBe(1);
    sim.step([{ type: 'useSkill', playerId: 1, slot: 0 }]);
    expect(p.skillBuff?.stacks).toBe(2);
    expect(p.skillBuff?.pct).toBe(d.buff!.powerPct * 2);
    // 回数が無いと使えない
    const x1 = p.x;
    sim.step([{ type: 'useSkill', playerId: 1, slot: 0 }]);
    expect(p.x - x1).toBeLessThan(10);
    // 強化は秒数で切れる
    for (let k = 0; k < Math.round(d.buff!.seconds * 30) + 2; k++) sim.step([]);
    expect(p.skillBuff).toBeUndefined();
  });

  it('テレポート: 1 回分は rechargeSeconds で戻る。ポイントマックスで最大の回数が増える', () => {
    const { rules, sim, p } = setup();
    const d = rules.activeSkills!.defs[0]!;
    sim.step([{ type: 'useSkill', playerId: 1, slot: 0 }]);
    expect(p.skills![0]!.charges).toBe(0);
    for (let k = 0; k < Math.round(d.rechargeSeconds * 30) + 2; k++) sim.step([]);
    expect(p.skills![0]!.charges).toBe(1);
    const before = maxCharges(sim.world, p, p.skills![0]!);
    p.mods.amountBonus += 1;
    expect(maxCharges(sim.world, p, p.skills![0]!)).toBe(before + 1);
  });

  it('レベルアップの候補に テレポート の強化が出て、取ると回数が 1 増える', () => {
    const { sim, p } = setup();
    let found = false;
    for (let k = 0; k < 40 && !found; k++) {
      const o = makeOffers(sim.world, p).find((x) => x.kind === 'skillUp');
      if (!o) continue;
      found = true;
      const c0 = p.skills![0]!.charges;
      applyOffer(sim.world, p, o);
      expect(p.skills![0]!.level).toBe(2);
      expect(p.skills![0]!.charges).toBe(c0 + 1);
    }
    expect(found).toBe(true);
  });

  it('サイコブレイク: 玉は 1 つ。狙った HP の一番高い敵へ追い、途中の敵を貫いて、狙った敵で弾ける', () => {
    const { rules, sim, p } = setup(['psystrike']);
    const psy = rules.moves.findIndex((m) => m.key === 'psystrike');
    p.moves[0]!.level = 8;
    const e = sim.world.enemies;
    // 手前に雑魚、奥に HP の多い敵
    e.add(1, 0, 120, 0, 50, 0, 12, 0, 0, 0);
    e.add(2, 0, 360, 0, 1e7, 0, 12, 0, 0, 0);
    let burst = false;
    let maxShots = 0;
    for (let k = 0; k < 150 && !burst; k++) {
      sim.step([]);
      const pr = sim.world.projectiles;
      let shots = 0;
      for (let i = 0; i < pr.count; i++) if (pr.move[i] === psy && pr.stage[i] === 0) shots++;
      maxShots = Math.max(maxShots, shots);
      for (let i = 0; i < pr.count; i++) if (pr.move[i] === psy && pr.stage[i]! > 0 && Math.abs(pr.x[i]! - 360) < 60) burst = true;
    }
    expect(maxShots).toBe(1);
    expect(burst).toBe(true);
    // 途中の雑魚にも当たった
    expect(e.hp[0]! < 50 || e.count < 2).toBe(true);
  });
});
