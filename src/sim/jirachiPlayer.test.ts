import { describe, expect, it } from 'vitest';
import { buildSimRules, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';

/** 遊べるジラーチ（07 の321章）: キーで使う技は無し（まぼろし）。スピードスター → コメットパンチ（ジラーチの版）→ はめつのねがい（ねがいごと Lv8 が要る） */
function setup(moves?: { key: string; level: number }[]) {
  const rules = buildSimRules('hoenn');
  const lo = playableLoadout(rules, 'jirachi');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const ids = moves ? moves.map((m) => ({ move: rules.moves.findIndex((x) => x.key === m.key), level: m.level })) : lo.moves;
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 180, types: lo.types, species: lo.species, moves: ids, line: 'jirachi', fixedMoves: lo.fixedMoves });
  return { rules, sim, p };
}

describe('遊べるジラーチ', () => {
  it('最初の技は スピードスター・ねんりき・ねがいごと・いやしのねがい。キーで使う技は無い', () => {
    const { rules, p } = setup();
    expect(p.moves.map((m) => rules.moves[m.move]!.key)).toEqual(['swift', 'confusion', 'wish', 'healing-wish']);
    expect(p.skills ?? []).toEqual([]);
  });

  it('ルート: スピードスター ＋メタルコート→ コメットパンチ（ジラーチの版）→（ねがいごと Lv8）はめつのねがい', () => {
    const { rules } = setup();
    const all = [...rules.derivations];
    const a = all.find((d) => d.line === 'jirachi' && rules.moves[d.to]?.key === 'meteor-mash-jirachi');
    const b = all.find((d) => d.line === 'jirachi' && rules.moves[d.to]?.key === 'doom-desire');
    expect(a && rules.moves[a.from]!.key).toBe('swift');
    expect(b && rules.moves[b.from]!.key).toBe('meteor-mash-jirachi');
  });

  it('はめつのねがい: HP の一番高い敵に星の印が付き、2 秒後に大きなダメージ', () => {
    const { sim } = setup([{ key: 'doom-desire', level: 1 }]);
    const e = sim.world.enemies;
    e.add(9001, 0, 200, 0, 1e7, 0, 20, 0, 0, 0);
    const hpOf = (): number => {
      for (let i = 0; i < e.count; i++) if (e.id[i] === 9001) return e.hp[i]!;
      return 0;
    };
    let marked = -1;
    for (let k = 0; k < 40 && marked === -1; k++) {
      sim.step([]);
      for (let i = 0; i < e.count; i++) if (e.id[i] === 9001 && e.markTicks[i]! > 0) marked = k;
    }
    expect(marked).not.toBe(-1);
    const afterMark = hpOf();
    for (let k = 0; k < 70; k++) sim.step([]);
    // 印の当たり（小さい）より、2 秒後の星（威力 × 6）の方がずっと大きい
    expect(afterMark - hpOf()).toBeGreaterThan((1e7 - afterMark) * 3);
  });
});
