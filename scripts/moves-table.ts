/**
 * 技の見本帳（作者が数値を見比べ、localhost で演出を見て直すための資料）の元データを作る。
 *
 *   npm run moves-table
 *
 * 入力: data/game/moves.json・derivations.json・playables.json、data/generated/（名前・タイプ・進化）
 * 出力: docs/08_moves_table.json（コミットする。技の数値を変えたら作り直し、技の見本帳のページを publish し直す）
 *
 * 「強さの目安」は、1体の敵に当て続けたときの1秒あたりのダメージ（威力 × 数 × 1回で当たる回数 ÷ 再使用の時間）。
 * ポケモンの攻撃・とくこう、タイプ一致・相性、持ち物・パッシブは掛けていない（技どうしを比べるための数）。
 * 周りを回る・地面に残る・ビームは、当たり直しの間隔ごとに持続の時間いっぱい当たり続けたとして数える（多めに出る）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { moveCrowdStrength, moveStatsAt, moveStrength, moveTotalStrength } from '../src/data/moveStrength.ts';
import type { MoveDefData } from '../src/data/schema.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): any => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));

const moves: Record<string, MoveDef> = read('data/game/moves.json').moves;
const derivations: { derivations: Derivation[]; unique: Derivation[] } = read('data/game/derivations.json');
const playables: Record<string, unknown> = read('data/game/playables.json').pokemon;
const genMoves: Record<string, { names: Names; type: string; damageClass: string }> = read('data/generated/moves.json');
// 名前を借りる技（ベイビィ用の ゆびをふる。moves.json の nameOf）
for (const [k, def] of Object.entries(moves as Record<string, { nameOf?: string }>)) if (def.nameOf && !genMoves[k] && genMoves[def.nameOf]) genMoves[k] = genMoves[def.nameOf]!;
const genItems: Record<string, { names: Names }> = read('data/generated/items.json');
const genPokemon: Record<string, { names: Names; types: string[]; evolvesTo: { to: string }[] }> = read('data/generated/pokemon.json');
const genTypes: Record<string, { names: Names }> = read('data/generated/types.json');
const ja: Record<string, string> = read('src/i18n/ja.json');

interface Names {
  ja: string;
  en: string;
}
interface Derivation {
  from: string;
  /** 材料の持ち物（無ければ、レベルの条件だけ） */
  item?: string;
  to: string;
  line?: string;
  minLevel?: number;
  /** 覚えていないといけない技（リーフブレード: つるぎのまい。07 の130章） */
  needsMoves?: { move: string; level?: number }[];
}
/** 派生の材料の表記（持ち物、無ければレベル。覚えていないといけない技があれば足す） */
const via = (d: Derivation): string => {
  const needs = (d.needsMoves ?? []).map((n) => `${genMoves[n.move]?.names.ja ?? n.move}${n.level ? ` Lv${n.level}` : ""}`).join("・");
  if (d.item) return `＋${itemName(d.item)}${d.minLevel ? `（Lv${d.minLevel} から）` : ""}${needs ? `（${needs}を覚えている）` : ""}`;
  return needs ? `${needs}を覚えている` : `Lv${d.minLevel ?? "?"}`;
};
type Stats = Record<string, number | string | undefined>;
interface MoveDef {
  pattern: string;
  base: Stats;
  levels: Stats[];
}

/** 状態異常の表示名（この資料のためだけ。ゲームの表示は翻訳ファイルと色で行う） */
const STATUS: Record<string, string> = {
  burn: 'やけど',
  poison: 'どく',
  paralysis: 'まひ',
  freeze: 'こおり',
  defenseDown: 'ぼうぎょダウン',
  attackDown: 'こうげきダウン',
  sleep: 'ねむり',
  flinch: 'ひるみ',
  leech: 'やどりぎ',
  soaked: 'みずびたし',
};
const TYPE_ORDER = ['normal', 'fire', 'water', 'grass', 'electric', 'ice', 'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'];

const moveName = (k: string): string => genMoves[k]?.names.ja ?? k;
const itemName = (k: string): string => genItems[k]?.names.ja ?? k;
const pokeName = (k: string): string => genPokemon[k]?.names.ja ?? k;

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

// 強さの目安の計算は、派生の決まりのテストと同じもの（src/data/moveStrength.ts）
const statsAt = (def: MoveDef, level: number): Stats => moveStatsAt(def as unknown as MoveDefData, level);
const dps = (def: MoveDef, s: Stats): number => moveStrength(def as unknown as MoveDefData, s);
const crowd = (def: MoveDef, s: Stats): number => moveCrowdStrength(def as unknown as MoveDefData, s);
const totalOf = (def: MoveDef, s: Stats): number => moveTotalStrength(def as unknown as MoveDefData, s);

/** 系統ごとに、進化の途中で持つタイプをすべて集める */
function lineTypes(line: string): Set<string> {
  const out = new Set<string>();
  const visit = (k: string): void => {
    const p = genPokemon[k];
    if (!p) return;
    for (const t of p.types) out.add(t);
    for (const e of p.evolvesTo) if (genPokemon[e.to]) visit(e.to);
  };
  visit(line);
  return out;
}
const lines = Object.keys(playables).map((k) => ({ key: k, types: lineTypes(k) }));

const derivedFrom = new Map<string, Derivation>();
for (const d of derivations.derivations) derivedFrom.set(d.to, d);
const uniqueFrom = new Map<string, Derivation>();
for (const d of derivations.unique) uniqueFrom.set(d.to, d);
/** 段階の上書き（data/game/move-balance.json の tierOverrides。系統だけの派生技 かえんぐるま など） */
const tierOverrides: Record<string, string> = read('data/game/move-balance.json').tierOverrides ?? {};
const stageOf = (k: string): string => {
  const t = tierOverrides[k];
  if (t) return t === 'unique' ? '固有' : t === 'derived' ? '派生' : 'タイプ';
  return uniqueFrom.has(k) ? '固有' : derivedFrom.has(k) ? '派生' : 'タイプ';
};
const derivesTo = (k: string): Derivation[] => [...derivations.derivations, ...derivations.unique].filter((d) => d.from === k);

const keys = Object.keys(moves).sort((a, b) => {
  const ta = TYPE_ORDER.indexOf(genMoves[a]?.type ?? '');
  const tb = TYPE_ORDER.indexOf(genMoves[b]?.type ?? '');
  const rank = (k: string): number => (uniqueFrom.has(k) ? 2 : derivedFrom.has(k) ? 1 : 0);
  return ta - tb || rank(a) - rank(b) || Object.keys(moves).indexOf(a) - Object.keys(moves).indexOf(b);
});

// ---- 出力: docs/08_moves_table.json（技の見本帳のページの元データ。作者の決定 2026年10月30日: md の表はやめ、localhost のリンク付きのページにする） ----

const regions: { id: string; playables?: string[] }[] = read('data/game/regions.json').regions;
const genRegions: Record<string, { names: Names }> = read('data/generated/regions.json');
const DEV_URL = 'http://localhost:5173/';

/** 技を使える系統のキー（固有技はその系統。learners があればそれ。ほかはタイプが合う系統、ノーマルは全員） */
function userKeys(k: string): string[] {
  const u = uniqueFrom.get(k);
  if (u?.line) return [u.line];
  const def = moves[k] as unknown as { learners?: string[] };
  if (def.learners) return def.learners;
  const type = genMoves[k]?.type ?? '';
  if (type === 'normal') return lines.map((l) => l.key);
  return lines.filter((l) => l.types.has(type)).map((l) => l.key);
}

/** 演出を見る URL（その技を使える系統で始め、無敵にする）。地方の技はその地方で */
function demoUrl(k: string): { pokemon: string; region: string; url: string } {
  const def = moves[k] as unknown as { region?: string };
  const region = def.region ?? regions.find((r) => r.playables?.some((p) => userKeys(k).includes(p)))?.id ?? 'kanto';
  const inRegion = regions.find((r) => r.id === region)?.playables ?? [];
  const pokemon = userKeys(k).find((p) => inRegion.includes(p)) ?? inRegion[0] ?? 'mew';
  const max = moves[k]!.levels.length + 1;
  const url = `${DEV_URL}?pokemon=${pokemon}&region=${region}&moves=${k}:${max}&god&level=50`;
  return { pokemon, region, url };
}

const statOf = (def: MoveDef, level: number) => {
  const st = statsAt(def, level);
  const num = (v: number | string | undefined): number | string | null => (v === undefined ? null : v);
  return {
    strength: { solo: round(dps(def, st)), crowd: round(crowd(def, st)), total: round(totalOf(def, st)) },
    power: num(st.power), cooldown: num(st.cooldownSeconds), count: num(st.count), size: num(st.size), range: num(st.range),
    duration: num(st.durationSeconds), pierce: num(st.pierce), hitInterval: num(st.hitIntervalSeconds), knockback: num(st.knockback),
    status: st.statusId ? { id: st.statusId as string, name: STATUS[st.statusId as string] ?? (st.statusId as string), chance: st.statusChance as number } : null,
  };
};

const rows = keys.map((k) => {
  const def = moves[k]!;
  const max = def.levels.length + 1;
  const from = derivedFrom.get(k) ?? uniqueFrom.get(k) ?? null;
  const raw = def as unknown as { region?: string; teachOnly?: boolean; learners?: string[] };
  const demo = demoUrl(k);
  return {
    key: k,
    name: moveName(k),
    nameEn: genMoves[k]?.names.en ?? k,
    type: genMoves[k]?.type ?? 'normal',
    damageClass: genMoves[k]?.damageClass ?? 'special',
    tier: stageOf(k),
    pattern: ja[`pattern.${def.pattern}`] ?? def.pattern,
    patternKey: def.pattern,
    region: raw.region ?? null,
    teachOnly: !!raw.teachOnly,
    maxLevel: max,
    lv1: statOf(def, 1),
    max: statOf(def, max),
    from: from ? { move: from.from, via: via(from), item: from.item ?? null, line: from.line ?? null } : null,
    to: derivesTo(k).map((d) => d.to),
    users: userKeys(k),
    demo,
  };
});
const names = {
  pokemon: Object.fromEntries([...new Set(rows.flatMap((r) => [...r.users, r.demo.pokemon]))].map((p) => [p, pokeName(p)])),
  types: Object.fromEntries(TYPE_ORDER.map((t) => [t, genTypes[t]?.names.ja ?? t])),
  regions: Object.fromEntries(regions.map((r) => [r.id, genRegions[r.id]?.names.ja ?? r.id])),
};
writeFileSync(join(ROOT, 'docs', '08_moves_table.json'), JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), devUrl: DEV_URL, moves: rows, names }) + '\n');
console.log(`技 ${keys.length} 個を docs/08_moves_table.json に出力しました。`);
