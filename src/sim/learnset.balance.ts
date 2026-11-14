import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { generated, playablesConfig, regionsConfig } from '../data';
import { buildSimRules } from '../data/simRules';
import { lineMoves, obtainableItems, regionLineKeys } from '../meta/lineMoves';

/**
 * 遊べるポケモンごとの、最初の技・覚えられる技・派生と固有技の一覧（作者の依頼 2026年10月30日。docs/16_learnsets.json を作る）。
 *   npm run learnsets
 *
 * 中身の調べ方は src/meta/lineMoves.ts（わざ図鑑と同じ）。
 */
type Names = { ja: string; en: string };
const OUT = process.env.LEARNSET_OUT ?? 'docs/16_learnsets.json';
const genMoves = generated.moves as Record<string, { names: Names; type: string } | undefined>;
const genPokemon = generated.pokemon as Record<string, { names: Names; types: string[] } | undefined>;
const genItems = generated.items as Record<string, { names: Names } | undefined>;

it('技の一覧', () => {
  const out: unknown[] = [];
  for (const region of regionsConfig.regions) {
    if (!region.playables?.length) continue;
    const rules = buildSimRules(region.id);
    // その地方で手に入る持ち物（実績を全部達成したとき）。手に入らない持ち物の進化・派生は載せない（カントーのヤドキングなど。07 の180.5章）
    const obtainable = obtainableItems(region.id);
    const keys = regionLineKeys(region.playables);
    for (const key of keys) {
      const lm = lineMoves(rules, key, obtainable);
      if (!lm) continue;
      out.push({
        region: region.id,
        key,
        name: genPokemon[key]?.names.ja ?? key,
        types: (genPokemon[key]?.types ?? []),
        forms: lm.forms.map((f) => ({ key: f, name: genPokemon[f]?.names.ja ?? f, types: genPokemon[f]?.types ?? [] })),
        fixedMoves: !!playablesConfig.pokemon[key]!.fixedMoves,
        learnsAll: !!playablesConfig.pokemon[key]!.allMoveTypes,
        start: lm.start,
        learn: [...lm.learn].map(([move, r]) => ({ move, ...r })),
        special: lm.special,
        derives: lm.derives,
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
