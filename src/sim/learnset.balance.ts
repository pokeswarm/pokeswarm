import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { derivationsConfig, generated, playablesConfig, regionsConfig } from '../data';
import { buildSimRules, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { canLearnNewMove } from './systems/leveling';

/**
 * 遊べるポケモンごとの、最初の技・覚えられる技・派生と固有技の一覧（作者の依頼 2026年10月30日。docs/16_learnsets.json を作る）。
 *   npm run learnsets
 *
 * 覚えられる技は、レベルアップの候補と同じ決まり（leveling.ts の canLearnNewMove）で、進化の姿ごとに調べる。
 * ランのレベルの条件（learnMinLevel）は満たしたものとし、覚えている技の条件（learnWithMoves）は、その技を足して調べて条件として書く。
 * 派生・固有技は data/game/derivations.json から、その系統が使えるものをたどる（材料の持ち物・レベル・覚えている技の条件つき）。
 */
type Names = { ja: string; en: string };
type Derivation = { from: string; to: string; item?: string; line?: string; minLevel?: number; needsMoves?: { move: string; level?: number }[] };
const OUT = process.env.LEARNSET_OUT ?? 'docs/16_learnsets.json';
const genMoves = generated.moves as Record<string, { names: Names; type: string } | undefined>;
const genPokemon = generated.pokemon as Record<string, { names: Names; types: string[]; evolvesTo: { to: string }[] } | undefined>;
const genItems = generated.items as Record<string, { names: Names } | undefined>;

it('技の一覧', () => {
  const out: unknown[] = [];
  for (const region of regionsConfig.regions) {
    if (!region.playables?.length) continue;
    const rules = buildSimRules(region.id);
    const moveName = (i: number): string => rules.moves[i]!.key;
    const keys = region.playables.flatMap((k) => playablesConfig.pokemon[k]?.hatch ?? [k]);
    for (const key of keys) {
      const def = playablesConfig.pokemon[key];
      if (!def) continue;
      const loadout = playableLoadout(rules, key);
      // 進化の姿（系統のキーから、進化先をたどる。分かれる進化はすべて）
      const forms: string[] = [];
      const visit = (k: string): void => {
        if (forms.includes(k) || !genPokemon[k]) return;
        forms.push(k);
        for (const e of genPokemon[k]!.evolvesTo) visit(e.to);
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
      const usable = (d: Derivation): boolean =>
        d.line ? lines.includes(d.line) : !allDerivations.some((x) => !!x.line && lines.includes(x.line) && x.from === d.from && x.item === d.item);
      const derives: unknown[] = [];
      const all = [...(derivationsConfig.derivations as Derivation[]).map((d) => ({ ...d, unique: false })), ...(derivationsConfig.unique as Derivation[]).map((d) => ({ ...d, unique: true }))];
      for (let changed = true; changed; ) {
        changed = false;
        for (const d of all) {
          if (!have.has(d.from) || !usable(d) || derives.some((x) => (x as { from: string; to: string }).from === d.from && (x as { to: string }).to === d.to)) continue;
          derives.push({ from: d.from, to: d.to, unique: d.unique, item: d.item ?? null, minLevel: d.minLevel ?? null, needs: (d.needsMoves ?? []).map((n) => ({ move: n.move, level: n.level ?? null })), lineOnly: !!d.line });
          if (!have.has(d.to)) {
            have.add(d.to);
            changed = true;
          }
        }
      }
      out.push({
        region: region.id,
        key,
        name: genPokemon[key]?.names.ja ?? key,
        types: (genPokemon[key]?.types ?? []),
        forms: forms.map((f) => ({ key: f, name: genPokemon[f]?.names.ja ?? f, types: genPokemon[f]?.types ?? [] })),
        fixedMoves: !!def.fixedMoves,
        learnsAll: !!def.allMoveTypes,
        start,
        learn: [...learn].map(([move, r]) => ({ move, ...r })),
        special: [...(def.formMoves ?? []).map((f) => ({ move: f.move, how: 'form', form: f.form })), ...(def.itemMoves ?? []).map((f) => ({ move: f.move, how: 'item', item: f.item }))],
        derives,
      });
    }
  }
  // 名前の辞書（ページで使う）
  const used = new Set<string>();
  const items = new Set<string>();
  for (const r of out as { start: string[]; learn: { move: string; withMoves?: string[] }[]; special: { move: string; item?: string }[]; derives: { from: string; to: string; item: string | null; needs: { move: string }[] }[] }[]) {
    r.start.forEach((m) => used.add(m));
    r.learn.forEach((l) => { used.add(l.move); l.withMoves?.forEach((m) => used.add(m)); });
    r.special.forEach((s) => { used.add(s.move); if (s.item) items.add(s.item); });
    r.derives.forEach((d) => { used.add(d.from); used.add(d.to); if (d.item) items.add(d.item); d.needs.forEach((n) => used.add(n.move)); });
  }
  const rules = buildSimRules();
  const moveInfo = Object.fromEntries([...used].map((k) => {
    const m = rules.moves.find((x) => x.key === k);
    const nameOf = (m as { nameOf?: string } | undefined)?.nameOf;
    const g = genMoves[k] ?? (nameOf ? genMoves[nameOf] : undefined);
    return [k, { name: g?.names.ja ?? k, type: g?.type ?? 'normal', pattern: m?.pattern ?? '' }];
  }));
  const itemNames = Object.fromEntries([...items].map((k) => [k, genItems[k]?.names.ja ?? k]));
  const typeNames = Object.fromEntries(Object.entries(generated.types as Record<string, { names: Names }>).map(([k, v]) => [k, v.names.ja]));
  const regionNames = Object.fromEntries(regionsConfig.regions.map((r) => [r.id, (generated.regions as Record<string, { names: Names }>)[r.id]?.names.ja ?? r.id]));
  writeFileSync(OUT, JSON.stringify({ pokemon: out, moves: moveInfo, items: itemNames, types: typeNames, regions: regionNames }) + '\n');
});
