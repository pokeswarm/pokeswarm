import { achievementsConfig, derivationsConfig, generated, learnsetsConfig, playablesConfig } from '../data';
import { playableLoadout } from '../data/simRules';
import type { SimRules } from '../sim/rules';
import { achievementPerks } from './achievementPerks';
import { Simulation } from '../sim/simulation';
import { canLearnNewMove } from '../sim/systems/leveling';

/**
 * 遊べるポケモン 1 匹（系統）の、最初の技・覚えられる技・派生と固有技（docs/16_learnsets.json と わざ図鑑 で使う。07 の262章）。
 *
 * 覚えられる技は、レベルアップの候補と同じ決まり（leveling.ts の canLearnNewMove）で、進化の姿ごとに調べる。
 * ランのレベルの条件（learnMinLevel）は満たしたものとし、覚えている技の条件（learnWithMoves）は、その技を足して調べて条件として書く。
 * 派生・固有技は data/game/derivations.json から、その系統が使えるものをたどる（材料の持ち物・レベル・覚えている技の条件つき）。
 */
type Derivation = { from: string; to: string; item?: string; line?: string; minLevel?: number; needsMoves?: { move: string; level?: number }[] };
const genPokemon = generated.pokemon as Record<string, { evolvesTo: { to: string; trigger?: string; item?: string }[] } | undefined>;

export interface LineDerive {
  from: string;
  to: string;
  /** 固有技 */
  unique: boolean;
  item: string | null;
  minLevel: number | null;
  needs: { move: string; level: number | null }[];
  /** その系統だけの派生 */
  lineOnly: boolean;
}

export interface LineMoves {
  key: string;
  /** 進化の姿（系統のキーから、進化先をたどる。分かれる進化はすべて） */
  forms: string[];
  start: string[];
  learn: Map<string, { forms: string[]; withMoves?: string[]; minLevel?: number }>;
  special: ({ move: string; how: 'form'; form: string } | { move: string; how: 'item'; item: string })[];
  derives: LineDerive[];
}

/** その地方で手に入る持ち物（実績を全部達成したとき）。手に入らない持ち物の進化・派生は載せない（カントーのヤドキングなど。07 の180.5章） */
export function obtainableItems(region: string): ReadonlySet<string> {
  return achievementPerks(achievementsConfig, achievementsConfig.achievements.filter((a) => a.region === region).map((a) => a.id), region).items;
}

/** 地方の遊べるポケモンのキー（タマゴは、かえるポケモンに置きかえる） */
export function regionLineKeys(playables: readonly string[]): string[] {
  return playables.flatMap((k) => playablesConfig.pokemon[k]?.hatch ?? [k]);
}

export function lineMoves(rules: SimRules, key: string, obtainable: ReadonlySet<string>): LineMoves | null {
  const def = playablesConfig.pokemon[key];
  if (!def) return null;
  const moveName = (i: number): string => rules.moves[i]!.key;
  const loadout = playableLoadout(rules, key);
  const forms: string[] = [];
  const visit = (k: string): void => {
    if (forms.includes(k) || !genPokemon[k]) return;
    forms.push(k);
    for (const e of genPokemon[k]!.evolvesTo) {
      if (e.trigger === 'item' ? !obtainable.has(e.item!) : e.trigger === 'trade' && !obtainable.has('linking-cord')) continue;
      visit(e.to);
    }
  };
  visit(def.sprite && genPokemon[key] ? key : def.sprite ?? key);
  for (const b of def.becomes ?? []) visit(b.form);
  const learn = new Map<string, { forms: string[]; withMoves?: string[]; minLevel?: number }>();
  for (const form of forms) {
    const species = rules.species.findIndex((s) => s.key === form);
    if (species === -1) continue;
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    const p = sim.addPlayer({
      id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0,
      types: form === key ? loadout.types : [...rules.species[species]!.types],
      species, moves: loadout.moves, line: loadout.line, moveTypes: loadout.moveTypes, learnsAll: loadout.learnsAll,
    });
    sim.world.level = 100;
    const startMoves = p.moves.map((m) => ({ ...m }));
    rules.moves.forEach((m, move) => {
      const withMoves = m.learnWithMoves ?? [];
      if (withMoves.length) p.moves = [...startMoves, ...withMoves.map((w) => ({ ...startMoves[0]!, move: w, level: 1 }))];
      const ok = canLearnNewMove(sim.world, p, move);
      p.moves = startMoves.map((m) => ({ ...m }));
      if (!ok) return;
      const row = learn.get(m.key) ?? { forms: [], ...(withMoves.length ? { withMoves: withMoves.map(moveName) } : {}), ...(m.learnMinLevel ? { minLevel: m.learnMinLevel } : {}) };
      row.forms.push(form);
      learn.set(m.key, row);
    });
  }
  // 派生・固有技: 最初の技と覚えられる技から、この系統が使えるものをたどる
  const start = def.startingMoves ?? [];
  const have = new Set([...start, ...learn.keys(), ...(def.formMoves ?? []).map((f) => f.move), ...(def.itemMoves ?? []).map((f) => f.move)]);
  // 系統（姿が変わると別の系統になるもの: ピチュー → ピカチュウ）
  const lines = [key, loadout.line, ...(def.becomes ?? []).map((b) => b.line)];
  const allDerivations = [...derivationsConfig.derivations, ...derivationsConfig.unique] as Derivation[];
  // 全体の派生は、派生技がその系統の learnsets に無ければ出ない（leveling.ts の derivationUsable と同じ）
  const inLearnset = (move: string): boolean => lines.some((l) => !learnsetsConfig.lines[l] || (playablesConfig.pokemon[l]?.allMoveTypes ?? false) || learnsetsConfig.lines[l]!.some((e) => (typeof e === 'string' ? e : e.move) === move));
  const usable = (d: Derivation): boolean =>
    d.line ? lines.includes(d.line) : !allDerivations.some((x) => !!x.line && lines.includes(x.line) && x.from === d.from && x.item === d.item) && inLearnset(d.to);
  const derives: LineDerive[] = [];
  const all = [...(derivationsConfig.derivations as Derivation[]).map((d) => ({ ...d, unique: false })), ...(derivationsConfig.unique as Derivation[]).map((d) => ({ ...d, unique: true }))];
  for (let changed = true; changed; ) {
    changed = false;
    for (const d of all) {
      if ((d.item && !obtainable.has(d.item)) || !have.has(d.from) || !usable(d) || derives.some((x) => x.from === d.from && x.to === d.to)) continue;
      derives.push({ from: d.from, to: d.to, unique: d.unique, item: d.item ?? null, minLevel: d.minLevel ?? null, needs: (d.needsMoves ?? []).map((n) => ({ move: n.move, level: n.level ?? null })), lineOnly: !!d.line });
      if (!have.has(d.to)) {
        have.add(d.to);
        changed = true;
      }
    }
  }
  return {
    key,
    forms,
    start,
    learn,
    special: [...(def.formMoves ?? []).map((f) => ({ move: f.move, how: 'form' as const, form: f.form })), ...(def.itemMoves ?? []).map((f) => ({ move: f.move, how: 'item' as const, item: f.item }))],
    derives,
  };
}
