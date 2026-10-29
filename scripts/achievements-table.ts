/**
 * 実績と解放の一覧（作者が見比べるための資料）を作る。
 *
 *   npm run achievements-table
 *
 * 入力: data/game/achievements.json・regions.json、data/generated/（ポケモン・持ち物・地方の名前）、src/i18n/ja.json（実績の名前・条件・報酬の文）
 * 出力: docs/15_achievements.md と docs/15_achievements.json（コミットする。実績を変えたら作り直す）
 *
 * ゲームの実績の画面と違い、隠す実績・「？？？」にする条件も、すべてそのまま出す。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): any => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));

type Condition = { stat: string; atLeast: number } | { all: Condition[] } | { any: Condition[] };
interface Achievement {
  id: string;
  region?: string;
  hidden?: boolean;
  condition: Condition;
  reward?: {
    pokemon?: string;
    item?: string;
    coins?: number;
    shiny?: string;
    buff?: { startMoveLevel?: { line: string; level: number }; coopXpPct?: number; candyWeight?: unknown; itemSlots?: number; mods?: { xpPct?: number; pickupRangePct?: number } };
  };
}

const achievements: Achievement[] = read('data/game/achievements.json').achievements;
const regions: { id: string; available: boolean; playables?: string[]; unlock?: Condition }[] = read('data/game/regions.json').regions;
const genPokemon: Record<string, { names: { ja: string } }> = read('data/generated/pokemon.json');
const genItems: Record<string, { names: { ja: string } }> = read('data/generated/items.json');
const genRegions: Record<string, { names: { ja: string } }> = read('data/generated/regions.json');
const ja: Record<string, string> = read('src/i18n/ja.json');

const fill = (text: string, vars: Record<string, string | number>): string => text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
const tr = (key: string, vars: Record<string, string | number> = {}): string => fill(ja[key] ?? key, vars);
const pokemonName = (key: string): string => genPokemon[key]?.names.ja ?? ja[`pokemon.${key}`] ?? key;
const regionName = (id: string): string => genRegions[id]?.names.ja ?? id;

/** 条件の文（翻訳ファイルの文。無ければ「〇〇を n 回倒す」か、記録の名前のまま） */
function conditionText(a: Achievement): string {
  const own = ja[`achievement.${a.id}.desc`];
  if (own) return own;
  return rawCondition(a.condition);
}
function rawCondition(c: Condition): string {
  if ('all' in c) return c.all.map(rawCondition).join(' かつ ');
  if ('any' in c) return c.any.map(rawCondition).join(' または ');
  const m = /^(?:\w+:)?(?:bossDefeated|defeated)\.(.+)$/.exec(c.stat);
  if (m) return tr('achievement.cond.defeat', { name: pokemonName(m[1]!), count: c.atLeast });
  return `${c.stat} ≧ ${c.atLeast}`;
}
/** 条件の記録の名前（調べるとき用） */
function statText(c: Condition): string {
  if ('all' in c) return c.all.map(statText).join(' & ');
  if ('any' in c) return c.any.map(statText).join(' | ');
  return `${c.stat} ≧ ${c.atLeast}`;
}

function rewardText(a: Achievement): { kind: string; text: string } {
  const r = a.reward;
  if (!r) return { kind: 'なし', text: '' };
  if (r.pokemon) return { kind: 'ポケモン', text: tr('achievement.reward.pokemon', { name: pokemonName(r.pokemon) }) };
  if (r.item) return { kind: '持ち物', text: tr('achievement.reward.item', { name: genItems[r.item]?.names.ja ?? r.item }) };
  if (r.coins) return { kind: 'コイン', text: tr('achievement.reward.coins', { coins: r.coins }) };
  if (r.shiny) return { kind: '色違い', text: tr('achievement.reward.shiny', { name: pokemonName(r.shiny) }) };
  const b = r.buff ?? {};
  if (b.startMoveLevel) return { kind: 'バフ', text: tr('achievement.reward.startMoveLevel', { name: pokemonName(b.startMoveLevel.line), level: b.startMoveLevel.level }) };
  if (b.coopXpPct) return { kind: 'バフ', text: tr('achievement.reward.coopXp', { pct: b.coopXpPct }) };
  if (b.candyWeight) return { kind: 'バフ', text: tr('achievement.reward.candy') };
  if (b.itemSlots) return { kind: 'バフ', text: tr('achievement.reward.itemSlots', { n: b.itemSlots }) };
  if (b.mods?.xpPct) return { kind: 'バフ', text: tr('achievement.reward.xp', { pct: b.mods.xpPct }) };
  if (b.mods?.pickupRangePct) return { kind: 'バフ', text: tr('achievement.reward.pickup', { pct: b.mods.pickupRangePct }) };
  return { kind: 'バフ', text: '' };
}

function achievementName(a: Achievement): string {
  return ja[`achievement.${a.id}.name`] ?? (a.reward?.pokemon ? tr('achievement.unlock.name', { name: pokemonName(a.reward.pokemon) }) : a.id);
}

const rows = achievements.map((a) => {
  const reward = rewardText(a);
  return {
    region: a.region ?? 'kanto',
    id: a.id,
    name: achievementName(a),
    hidden: !!a.hidden,
    condition: conditionText(a),
    stat: statText(a.condition),
    rewardKind: reward.kind,
    reward: reward.text,
  };
});
// 地方の解放は、プレイアブルのある地方だけ（まだ中身の無い地方は出さない）
const regionRows = regions.filter((r) => (r.playables?.length ?? 0) > 0).map((r) => ({
  id: r.id,
  name: regionName(r.id),
  available: r.available,
  condition: r.unlock ? (ja[`region.unlock.${r.id}`]?.replace(/^🔒\s*/, '') ?? rawCondition(r.unlock)) : '最初から',
  stat: r.unlock ? statText(r.unlock) : '',
}));

const esc = (s: string): string => s.replace(/\|/g, '\\|');
const lines: string[] = [
  '# 15. 実績と解放の一覧',
  '',
  '`npm run achievements-table` で自動で作る（`scripts/achievements-table.ts`）。手で直さない。',
  'ゲームの実績の画面と違い、隠す実績・「？？？」にする条件も、すべてそのまま出す。',
  '',
  '## 地方の解放',
  '',
  '| 地方 | 公開 | 解放の条件 | 記録 |',
  '|---|---|---|---|',
  ...regionRows.map((r) => `| ${r.name} | ${r.available ? '公開' : '未公開'} | ${esc(r.condition)} | ${r.stat ? `\`${esc(r.stat)}\`` : '—'} |`),
  '',
];
for (const region of [...new Set(rows.map((r) => r.region))]) {
  const list = rows.filter((r) => r.region === region);
  lines.push(`## ${regionName(region)}（${list.length}）`, '', '| 実績 | 条件 | 報酬 | 記録 |', '|---|---|---|---|');
  for (const r of list) lines.push(`| ${esc(r.name)}${r.hidden ? '（隠し）' : ''} | ${esc(r.condition)} | ${r.reward ? `${r.rewardKind}: ${esc(r.reward)}` : '—'} | \`${esc(r.stat)}\` |`);
  lines.push('');
}
writeFileSync(join(ROOT, 'docs/15_achievements.md'), lines.join('\n'));
writeFileSync(join(ROOT, 'docs/15_achievements.json'), JSON.stringify({ regions: regionRows, achievements: rows }, null, 1) + '\n');
console.log(`docs/15_achievements.md: 実績 ${rows.length}・地方 ${regionRows.length}`);
