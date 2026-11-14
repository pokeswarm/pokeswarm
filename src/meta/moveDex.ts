import type { LineDerive, LineMoves } from './lineMoves';
import { dexKey, type SaveData } from './saveData';

/**
 * わざ図鑑（07 の262章。作者の案 2026年11月14日）: ずかん → 地方 → ポケモン → わざ。ポケモンごとに、そのポケモンで見つけた技を記録する。
 * - まだ使ったことのない技は「？？？」（枠だけ見せる）
 * - 使ったことのある技は、名前と説明が載る
 * - Lv の最大まで上げたのに派生していない技は、次の技は「？？？」のまま、次へ進むための素材が見える
 * - 派生させたことがある技は、次の技も載る（素材も見える）
 */
export type DexState = 'unknown' | 'found' | 'maxed';

export interface DexEdge {
  derive: LineDerive;
  /** 次へ進む素材を見せるか（元の技を最大まで上げた・次の技を見つけた） */
  showMaterials: boolean;
  next: DexNode;
}

export interface DexNode {
  move: string;
  state: DexState;
  edges: DexEdge[];
}

/** そのポケモンで見つけた技（"技" か "技!"）を状態にする。派生先を見つけていれば、元の技は最大まで上げたことにする */
export function dexStates(save: SaveData, region: string, lm: LineMoves): Map<string, DexState> {
  const states = new Map<string, DexState>();
  const up = (move: string, s: DexState): void => {
    const now = states.get(move) ?? 'unknown';
    const rank = { unknown: 0, found: 1, maxed: 2 } as const;
    if (rank[s] > rank[now]) states.set(move, s);
  };
  for (const e of save.dex[dexKey(region, lm.key)] ?? []) {
    if (e.endsWith('!')) up(e.slice(0, -1), 'maxed');
    else up(e, 'found');
  }
  // 図鑑を作る前の記録: 固有技（その系統だけの派生）は、達成した記録（discoveries）からそのポケモンのものと分かる
  for (const d of lm.derives) if (d.lineOnly && save.discoveries.includes(d.to)) up(d.to, 'found');
  // 派生先を見つけていれば、元の技は見つけて最大まで上げている（後ろからたどる）
  for (let changed = true; changed; ) {
    changed = false;
    for (const d of lm.derives) {
      if ((states.get(d.to) ?? 'unknown') !== 'unknown' && states.get(d.from) !== 'maxed') {
        up(d.from, 'maxed');
        changed = true;
      }
    }
  }
  return states;
}

/** 図鑑の並び: 最初の技・覚えられる技・姿や持ち物で変わる技を根にして、派生をつないだ木 */
export function dexTree(lm: LineMoves, states: ReadonlyMap<string, DexState>): DexNode[] {
  const node = (move: string, path: readonly string[]): DexNode => {
    const state = states.get(move) ?? 'unknown';
    const edges: DexEdge[] = [];
    for (const d of lm.derives) {
      if (d.from !== move || path.includes(d.to)) continue;
      const next = node(d.to, [...path, move]);
      edges.push({ derive: d, showMaterials: state === 'maxed' || next.state !== 'unknown', next });
    }
    return { move, state, edges };
  };
  const roots = [...new Set([...lm.start, ...lm.learn.keys(), ...lm.special.map((s) => s.move)])];
  return roots.map((m) => node(m, []));
}

/** 見つけた技の数と、図鑑に載る技の数（同じ技は 1 つに数える） */
export function dexCount(lm: LineMoves, states: ReadonlyMap<string, DexState>): { found: number; total: number } {
  const all = new Set([...lm.start, ...lm.learn.keys(), ...lm.special.map((s) => s.move), ...lm.derives.map((d) => d.to)]);
  return { found: [...all].filter((m) => (states.get(m) ?? 'unknown') !== 'unknown').length, total: all.size };
}
