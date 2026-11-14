import { describe, expect, it } from 'vitest';
import { buildSimRules } from '../data/simRules';
import { Simulation } from '../sim/simulation';
import { lineMoves, obtainableItems } from './lineMoves';
import { dexCount, dexStates, dexTree, type DexNode } from './moveDex';
import { RunRecorder } from './runRecorder';
import { addDexMove, emptySave, type SaveData } from './saveData';
import type { SaveStore } from './saveStore';

/** わざ図鑑（07 の262章）: ポケモンごとに、見つけた技と、最大まで上げた技を記録する */
const fakeStore = (save: SaveData): SaveStore => ({ current: save, update: (f: (d: SaveData) => void) => f(save) }) as unknown as SaveStore;
const find = (nodes: DexNode[], move: string): DexNode | undefined => {
  for (const n of nodes) {
    if (n.move === move) return n;
    const inner = find(n.edges.map((e) => e.next), move);
    if (inner) return inner;
  }
  return undefined;
};

describe('わざ図鑑（07 の262章）', () => {
  const rules = buildSimRules('kanto');
  const lm = lineMoves(rules, 'charmander', obtainableItems('kanto'))!;

  it('記録: ランで持っていた技を見つけた技に、最大まで上げた技に "!" を付けて、ポケモンごと・地方ごとに足す', () => {
    const save = emptySave();
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 180, moves: [{ move: rules.moves.findIndex((m) => m.key === 'ember'), level: 1 }] });
    const rec = new RunRecorder(fakeStore(save), 'charmander', null, null, 'kanto');
    rec.observe(sim.world);
    rec.commit(sim.world);
    expect(save.dex['kanto:charmander']).toEqual(['ember']);
    p.moves[0]!.level = rules.moves[p.moves[0]!.move]!.levels.length;
    rec.observe(sim.world);
    rec.commit(sim.world);
    expect(save.dex['kanto:charmander']).toEqual(['ember!']);
    // 一度最大にした技は、下がっても戻さない
    expect(addDexMove(save, 'kanto', 'charmander', 'ember', false)).toBe(false);
  });

  it('見つけていない技は ？？？。最大まで上げた技は、次の技は伏せたまま素材を見せる。派生先を見つければ、元の技は最大まで上げたことにする', () => {
    const save = emptySave();
    let tree = dexTree(lm, dexStates(save, 'kanto', lm));
    expect(find(tree, 'ember')!.state).toBe('unknown');
    addDexMove(save, 'kanto', 'charmander', 'ember', false);
    tree = dexTree(lm, dexStates(save, 'kanto', lm));
    const toFlame = find(tree, 'ember')!.edges.find((e) => e.next.move === 'flamethrower')!;
    expect(toFlame.showMaterials).toBe(false);
    expect(toFlame.next.state).toBe('unknown');
    addDexMove(save, 'kanto', 'charmander', 'ember', true);
    tree = dexTree(lm, dexStates(save, 'kanto', lm));
    const edge = find(tree, 'ember')!.edges.find((e) => e.next.move === 'flamethrower')!;
    expect(edge.showMaterials).toBe(true);
    expect(edge.derive.item).toBe('charcoal');
    expect(edge.next.state).toBe('unknown');
    // 別のポケモンで見つけた技は、このポケモンの図鑑には載らない
    const other = emptySave();
    addDexMove(other, 'kanto', 'growlithe', 'flamethrower', false);
    expect(find(dexTree(lm, dexStates(other, 'kanto', lm)), 'flamethrower')!.state).toBe('unknown');
    // 派生先を見つけていれば、元の技は最大まで上げている
    const later = emptySave();
    addDexMove(later, 'kanto', 'charmander', 'flamethrower', false);
    const states = dexStates(later, 'kanto', lm);
    expect(states.get('ember')).toBe('maxed');
    expect(dexCount(lm, states).found).toBe(2);
  });

  it('図鑑を作る前に達成した固有技は、そのポケモンの図鑑に載る', () => {
    const save = emptySave();
    const sig = lm.derives.find((d) => d.lineOnly)!;
    save.discoveries.push(sig.to);
    const states = dexStates(save, 'kanto', lm);
    expect(states.get(sig.to)).toBe('found');
    expect(states.get(sig.from)).toBe('maxed');
  });
});
