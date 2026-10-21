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

const fmt = (v: number | string | undefined): string => (v === 'infinite' ? '∞' : v === undefined ? '—' : typeof v === 'string' ? v : String(round(v)));

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
out.push('- 最初に派生のつながり（タイプの技 → 派生技 → 固有技）、次に強さの順の早見表、最後に派生の前後を並べた数値の表。');
out.push('- **強さの目安**: 1体の敵に当て続けたときの1秒あたりのダメージ（威力 × 数 × 1回で当たる回数 ÷ 再使用）。ポケモンのステータス・タイプ一致・相性・持ち物は掛けていない。周りを回る・地面に残る・ビームは持続の間ずっと当たり続けたとして数えるので、多めに出る。');
out.push('- **大きさ**は当たり判定の半径、**距離**は狙える距離・前に出る距離・回る半径・ビームの長さ（出し方による）。');
out.push('');
/** 派生のつながり: タイプの技（根）から、派生技・固有技までの道すじ */
interface Step {
  move: string;
  /** この技になるための材料（根は null） */
  via: Derivation | null;
}
const roots = keys.filter((k) => !derivedFrom.has(k) && !uniqueFrom.has(k));
function paths(k: string, via: Derivation | null): Step[][] {
  const next = derivesTo(k);
  if (next.length === 0) return [[{ move: k, via }]];
  return next.flatMap((d) => paths(d.to, d).map((p) => [{ move: k, via }, ...p]));
}
/** 根から、たどれる技を順に（根 → 派生技 → その固有技 → 次の派生技 …） */
function chainMoves(k: string, via: Derivation | null): Step[] {
  return [{ move: k, via }, ...derivesTo(k).flatMap((d) => chainMoves(d.to, d))];
}
const strength = (k: string): string => {
  const def = moves[k]!;
  return `${dps(def, statsAt(def, 1)).toFixed(1)} → ${dps(def, statsAt(def, def.levels.length + 1)).toFixed(1)}`;
};
const cell = (s: Step | undefined): string => (s ? `**${moveName(s.move)}**<br>${strength(s.move)}` : '');
const material = (s: Step | undefined): string => (s?.via ? `＋${itemName(s.via.item)}${s.via.line ? `<br>（${pokeName(s.via.line)}だけ）` : ''}` : '');

out.push('## 派生のつながり');
out.push('');
out.push('左から タイプの技 → 派生技 → 固有技。各技の下の数は強さの目安（Lv1 → 最大）。1つの技から2つに分かれるものは行を分け、2行目からは元の技を空けている。');
out.push('');
let rootType = '';
for (const root of roots) {
  const type = genMoves[root]?.type ?? '';
  if (type !== rootType) {
    rootType = type;
    out.push(`### ${genTypes[type]?.names.ja ?? type}`);
    out.push('');
    out.push('| タイプの技 | 材料 | 派生技 | 材料 | 固有技 |');
    out.push('|---|---|---|---|---|');
  }
  paths(root, null).forEach((p, row) => {
    out.push(`| ${row === 0 ? cell(p[0]) : '〃'} | ${material(p[1])} | ${cell(p[1])} | ${material(p[2])} | ${cell(p[2])} |`);
  });
  const nextRoot = roots[roots.indexOf(root) + 1];
  if (!nextRoot || (genMoves[nextRoot]?.type ?? '') !== type) out.push('');
}

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

out.push('## 系統ごとの数値（派生の前後を並べる）');
out.push('');
out.push('タイプの技ごとに、その技と派生先を上から順に並べる。1つの技につき Lv1 と最大の2行。');
out.push('');
rootType = '';
for (const root of roots) {
  const type = genMoves[root]?.type ?? '';
  if (type !== rootType) {
    rootType = type;
    out.push(`### ${genTypes[type]?.names.ja ?? type}`);
    out.push('');
  }
  out.push(`#### ${moveName(root)} から`);
  out.push('');
  out.push('| 段階 | 技 | Lv | 強さの目安 | 威力 | 再使用（秒） | 数 | 大きさ | 距離 | 持続（秒） | 貫通 | 当たり直し（秒） | ノックバック | 状態異常 |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of chainMoves(root, null)) {
    const def = moves[s.move]!;
    const max = def.levels.length + 1;
    const stage = uniqueFrom.has(s.move) ? '固有' : derivedFrom.has(s.move) ? '派生' : 'タイプ';
    const name = `**${moveName(s.move)}**${s.via ? `<br>（${moveName(s.via.from)} ＋${itemName(s.via.item)}${s.via.line ? `・${pokeName(s.via.line)}だけ` : ''}）` : ''}<br>${ja[`pattern.${def.pattern}`] ?? def.pattern}・${genMoves[s.move]?.damageClass === 'physical' ? '物理' : '特殊'}`;
    for (const [i, level] of [1, max].entries()) {
      const st = statsAt(def, level);
      const status = st.statusId ? `${STATUS[st.statusId as string] ?? st.statusId} ${Math.round((st.statusChance as number) * 100)}%` : '—';
      out.push(
        `| ${i === 0 ? stage : ''} | ${i === 0 ? name : ''} | ${level} | ${dps(def, st).toFixed(1)} | ${fmt(st.power)} | ${fmt(st.cooldownSeconds)} | ${fmt(st.count)} | ${fmt(st.size)} | ${fmt(st.range)} | ${fmt(st.durationSeconds)} | ${fmt(st.pierce)} | ${fmt(st.hitIntervalSeconds)} | ${fmt(st.knockback)} | ${status} |`,
      );
    }
  }
  out.push('');
  out.push(`使える系統: ${users(root)}`);
  out.push('');
}

writeFileSync(join(ROOT, 'docs', '08_moves_table.md'), out.join('\n'));
console.log(`技 ${keys.length} 個を docs/08_moves_table.md に出力しました。`);
