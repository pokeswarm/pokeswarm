/**
 * 技の一覧表（作者が数値を見比べて直すための資料）を作る。
 *
 *   npm run moves-table
 *
 * 入力: data/game/moves.json・derivations.json・playables.json、data/generated/（名前・タイプ・進化）
 * 出力: docs/08_moves_table.md（コミットする。技の数値を変えたら作り直す）
 *
 * 「強さの目安」は、1体の敵に当て続けたときの1秒あたりのダメージ（威力 × 数 × 1回で当たる回数 ÷ 再使用の時間）。
 * ポケモンの攻撃・とくこう、タイプ一致・相性、持ち物・パッシブは掛けていない（技どうしを比べるための数）。
 * 周りを回る・地面に残る・ビームは、当たり直しの間隔ごとに持続の時間いっぱい当たり続けたとして数える（多めに出る）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): any => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));

const moves: Record<string, MoveDef> = read('data/game/moves.json').moves;
const derivations: { derivations: Derivation[]; unique: Derivation[] } = read('data/game/derivations.json');
const playables: Record<string, unknown> = read('data/game/playables.json').pokemon;
const genMoves: Record<string, { names: Names; type: string; damageClass: string }> = read('data/generated/moves.json');
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
  item: string;
  to: string;
  line?: string;
}
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
  sleep: 'ねむり',
  flinch: 'ひるみ',
  leech: 'やどりぎ',
};
const TYPE_ORDER = ['normal', 'fire', 'water', 'grass', 'electric', 'ice', 'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon'];

const moveName = (k: string): string => genMoves[k]?.names.ja ?? k;
const itemName = (k: string): string => genItems[k]?.names.ja ?? k;
const pokeName = (k: string): string => genPokemon[k]?.names.ja ?? k;

/** レベル L の性能（基本 + レベル2以降の足し算） */
function statsAt(def: MoveDef, level: number): Stats {
  const out: Stats = { ...def.base };
  for (let l = 0; l < level - 1 && l < def.levels.length; l++) {
    for (const [k, v] of Object.entries(def.levels[l]!)) {
      const cur = out[k];
      if (cur === 'infinite') continue;
      out[k] = round((cur as number) + (v as number));
    }
  }
  return out;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** 1体の敵に当て続けたときの1秒あたりのダメージ（目安） */
function dps(def: MoveDef, s: Stats): number {
  const power = s.power as number;
  const count = s.count as number;
  const cd = s.cooldownSeconds as number;
  const interval = s.hitIntervalSeconds as number;
  const duration = s.durationSeconds as number;
  const hits = interval > 0 ? Math.max(1, Math.floor(duration / interval)) : 1;
  // 周りを回るものは、1体に同時に当たるのはおおむね1つ
  const perTarget = def.pattern === 'orbit' ? 1 : count;
  return (power * perTarget * hits) / cd;
}

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
const derivesTo = (k: string): Derivation[] => [...derivations.derivations, ...derivations.unique].filter((d) => d.from === k);

/** 技を使える系統（タイプが合う系統。ノーマルの技は全員。固有技はその系統だけ） */
function users(k: string): string {
  const u = uniqueFrom.get(k);
  if (u) return pokeName(u.line!);
  const type = genMoves[k]?.type ?? '';
  if (type === 'normal') return '全員';
  return lines.filter((l) => l.types.has(type)).map((l) => pokeName(l.key)).join('・') || '—';
}

function kindOf(k: string): string {
  const u = uniqueFrom.get(k);
  if (u) return `固有技（${moveName(u.from)} ＋ ${itemName(u.item)}）`;
  const d = derivedFrom.get(k);
  if (d) return `派生技（${moveName(d.from)} ＋ ${itemName(d.item)}）`;
  return 'タイプの技';
}

const fmt = (v: number | string | undefined): string => (v === 'infinite' ? '∞' : v === undefined ? '—' : typeof v === 'string' ? v : String(round(v)));
const pair = (a: number | string | undefined, b: number | string | undefined): string => (fmt(a) === fmt(b) ? fmt(a) : `${fmt(a)} → ${fmt(b)}`);

const keys = Object.keys(moves).sort((a, b) => {
  const ta = TYPE_ORDER.indexOf(genMoves[a]?.type ?? '');
  const tb = TYPE_ORDER.indexOf(genMoves[b]?.type ?? '');
  const rank = (k: string): number => (uniqueFrom.has(k) ? 2 : derivedFrom.has(k) ? 1 : 0);
  return ta - tb || rank(a) - rank(b) || Object.keys(moves).indexOf(a) - Object.keys(moves).indexOf(b);
});

const out: string[] = [];
out.push('# 08. 技の一覧表（自動で作る資料）');
out.push('');
out.push('`npm run moves-table` で `data/game/moves.json` などから作る。**手で直さない**（直すのはデータ。直したら作り直す）。');
out.push('');
out.push('- 数値は「レベル1 → 最大レベル」。変わらないものは1つだけ書く。');
out.push('- **強さの目安**: 1体の敵に当て続けたときの1秒あたりのダメージ（威力 × 数 × 1回で当たる回数 ÷ 再使用）。ポケモンのステータス・タイプ一致・相性・持ち物は掛けていない。周りを回る・地面に残る・ビームは持続の間ずっと当たり続けたとして数えるので、多めに出る。');
out.push('- **大きさ**は当たり判定の半径、**距離**は狙える距離・前に出る距離・回る半径・ビームの長さ（出し方による）。');
out.push('');
out.push('## 早見表（強さの目安の順）');
out.push('');
out.push('| 技 | タイプ | 種類 | 出し方 | Lv1 | 最大 |');
out.push('|---|---|---|---|---|---|');
const summary = keys
  .map((k) => {
    const def = moves[k]!;
    const max = def.levels.length + 1;
    return { k, def, d1: dps(def, statsAt(def, 1)), dm: dps(def, statsAt(def, max)) };
  })
  .sort((a, b) => b.dm - a.dm);
for (const { k, def, d1, dm } of summary) {
  const kind = uniqueFrom.has(k) ? '固有' : derivedFrom.has(k) ? '派生' : 'タイプ';
  out.push(`| ${moveName(k)} | ${genTypes[genMoves[k]?.type ?? '']?.names.ja ?? ''} | ${kind} | ${ja[`pattern.${def.pattern}`] ?? def.pattern} | ${d1.toFixed(1)} | ${dm.toFixed(1)} |`);
}
out.push('');

let currentType = '';
for (const k of keys) {
  const def = moves[k]!;
  const g = genMoves[k];
  const type = g?.type ?? '';
  if (type !== currentType) {
    currentType = type;
    out.push(`## ${genTypes[type]?.names.ja ?? type}`);
    out.push('');
  }
  const max = def.levels.length + 1;
  const a = statsAt(def, 1);
  const b = statsAt(def, max);
  out.push(`### ${moveName(k)}（${k}）`);
  out.push('');
  out.push(`- ${kindOf(k)}・${ja[`pattern.${def.pattern}`] ?? def.pattern}・${g?.damageClass === 'physical' ? '物理' : '特殊'}・最大 Lv${max}`);
  const next = derivesTo(k);
  if (next.length) out.push(`- 派生先: ${next.map((d) => `${moveName(d.to)}（＋${itemName(d.item)}${d.line ? `・${pokeName(d.line)}だけ` : ''}）`).join('、')}`);
  out.push(`- 使える系統: ${users(k)}`);
  out.push('');
  out.push('| 強さの目安 | 威力 | 再使用（秒） | 数 | 大きさ | 距離 | 持続（秒） | 貫通 | 当たり直し（秒） | ノックバック | 状態異常 |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|');
  const status = a.statusId ? `${STATUS[a.statusId as string] ?? a.statusId} ${pair(Math.round((a.statusChance as number) * 100), Math.round((b.statusChance as number) * 100))}%` : '—';
  out.push(
    `| ${pair(dps(def, a).toFixed(1), dps(def, b).toFixed(1))} | ${pair(a.power, b.power)} | ${pair(a.cooldownSeconds, b.cooldownSeconds)} | ${pair(a.count, b.count)} | ${pair(a.size, b.size)} | ${pair(a.range, b.range)} | ${pair(a.durationSeconds, b.durationSeconds)} | ${pair(a.pierce, b.pierce)} | ${pair(a.hitIntervalSeconds, b.hitIntervalSeconds)} | ${pair(a.knockback, b.knockback)} | ${status} |`,
  );
  out.push('');
}

writeFileSync(join(ROOT, 'docs', '08_moves_table.md'), out.join('\n'));
console.log(`技 ${keys.length} 個を docs/08_moves_table.md に出力しました。`);
