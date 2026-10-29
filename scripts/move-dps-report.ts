/**
 * 技の DPS の測定結果（docs/14_move_dps.json。npm run move-dps で測る）から、一覧の表（docs/14_move_dps.md）と CSV を作る。
 *
 *   npm run move-dps
 *
 * 見分け方（作者の考え 2026年10月29日: 範囲攻撃は雑魚に強く、単体攻撃はボスに強い。どちらにも強すぎる技は調整する）:
 * 同じ段階（タイプの技・派生技・固有技）の中で、ボス1体の DPS と 雑魚200 の DPS がそれぞれ上位何割かを見る。
 * - 両方に強い: どちらも上位 1/4 → 調整の候補
 * - 単体向き・群れ向き: 片方が上位半分で、もう片方が下位半分
 * - 両方に弱い: どちらも下位 1/4
 * - 桁外れ: どれかが 1000 万を超える（一撃・連鎖など、倒れない敵で測ると数字が意味を持たないもの。仕組みを確かめる）
 *
 * 届く距離（作者の考え 2026年10月29日: 範囲が狭いのに DPS が高いのはハイリスク・ハイリターン、広くて両方強いのはバランスブレイカー）:
 * 止まったボスを 50・150・300 に置き、間近（50）の DPS の 1/4 以上が出る一番遠い距離。
 * - バランスブレイカー候補: 両方に強く、150 以上届く
 * - ハイリスク・ハイリターン: ボスか雑魚200 のどちらかで上位 1/4 に入るが、50 でしか当たらない
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Row = { key: string; name: string; type: string; tier: string; pattern: string; dps: Record<string, number>; note: string };
/** 届く距離: 間近（50）の DPS の 1/4 以上が出る一番遠い距離 */
const reachOf = (r: Row): number => {
  const near = r.dps.at50 ?? 0;
  if (near <= 0) return 0;
  if ((r.dps.at300 ?? 0) >= near * 0.25) return 300;
  if ((r.dps.at150 ?? 0) >= near * 0.25) return 150;
  return 50;
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(ROOT, 'docs/14_move_dps.json'), 'utf8')) as { seconds: number; rows: Row[] };
const TIER: Record<string, string> = { base: 'タイプの技', derived: '派生技', unique: '固有技' };
const HUGE = 1e7;

const pct = (list: number[], v: number): number => list.filter((x) => x < v).length / Math.max(1, list.length - 1);
const out: (Row & { label: string; bossPct: number; swarmPct: number; reach: number })[] = [];
for (const tier of ['base', 'derived', 'unique']) {
  const rows = data.rows.filter((r) => r.tier === tier);
  // 桁外れの技は、順位の基準から外す（ほかの技がみな下位に見えてしまう）
  const normal = rows.filter((r) => !Object.values(r.dps).some((v) => v >= HUGE));
  const boss = normal.map((r) => r.dps.boss!);
  const swarm = normal.map((r) => r.dps.n200!);
  for (const r of rows) {
    const b = pct(boss, r.dps.boss!);
    const s = pct(swarm, r.dps.n200!);
    const reach = reachOf(r);
    let label = '';
    if (Object.values(r.dps).some((v) => v >= HUGE)) label = '桁外れ（要確認）';
    else if (b >= 0.75 && s >= 0.75) label = reach >= 150 ? 'バランスブレイカー候補' : 'ハイリスク・ハイリターン';
    else if ((b >= 0.75 || s >= 0.75) && reach === 50) label = 'ハイリスク・ハイリターン';
    else if (b <= 0.25 && s <= 0.25) label = '両方に弱い';
    else if (b >= 0.5 && s < 0.5) label = '単体向き';
    else if (s >= 0.5 && b < 0.5) label = '群れ向き';
    out.push({ ...r, label, bossPct: b, swarmPct: s, reach });
  }
}
const fmt = (v: number): string => (v >= HUGE ? `${(v / 1e6).toFixed(0)}M` : Math.round(v).toLocaleString('en-US'));
const md: string[] = [
  '# 14. 技の DPS（60 秒・敵の数ごと）',
  '',
  '`npm run move-dps` で作る（手で直さない）。測り方は `src/sim/moveDps.balance.ts`、見分け方は `scripts/move-dps-report.ts`。',
  '',
  '- 技は最大レベル・持ち物なし。プレイヤーはタイプなしの ミュウ Lv50（タイプ一致なし）で、止まったまま右を向く。敵はタイプなし・倒れない・接触ダメージなし。敵の置き方と乱数を変えて 3 回測った平均。',
  '- ボス1体: 半径 28 の中ボスが右から近づく。雑魚 10・50・200: 半径 12 がまわりから群がる（速さはどちらも 60）。数字は 1 秒あたりのダメージ（状態異常の継続ダメージも含む）。',
  '- 止まったボス 50・150・300: 動かないボスを右のその距離に置いた DPS。**届く距離**は、50 の DPS の 1/4 以上が出る一番遠い距離（0 は止まったボスに当たらない）。',
  '- 見分け: 同じ段階の中で、ボス1体と雑魚200 の DPS がそれぞれ上位何割か。どちらも上位 1/4 で 150 以上届けば **バランスブレイカー候補**（調整の候補）。どちらかが上位 1/4 でも 50 でしか当たらなければ **ハイリスク・ハイリターン**（近づく危険と引き換え）。桁外れは一撃・連鎖などで、倒れない敵では数字に意味がないもの。',
  '',
];
for (const tier of ['base', 'derived', 'unique']) {
  md.push(`## ${TIER[tier]}`, '', '| 技 | タイプ | 出し方 | ボス1体 | 雑魚10 | 雑魚50 | 雑魚200 | 止まったボス 50 / 150 / 300 | 届く距離 | 見分け |', '|---|---|---|---:|---:|---:|---:|---:|---:|---|');
  for (const r of out.filter((x) => x.tier === tier).sort((a, b) => b.dps.boss! - a.dps.boss!)) {
    md.push(`| ${r.name} | ${r.type} | ${r.pattern} | ${fmt(r.dps.boss!)} | ${fmt(r.dps.n10!)} | ${fmt(r.dps.n50!)} | ${fmt(r.dps.n200!)} | ${fmt(r.dps.at50!)} / ${fmt(r.dps.at150!)} / ${fmt(r.dps.at300!)} | ${r.reach || '—'} | ${r.label === 'バランスブレイカー候補' ? '**バランスブレイカー候補**' : r.label} |`);
  }
  md.push('');
}
writeFileSync(join(ROOT, 'docs/14_move_dps.md'), md.join('\n'));
const csv = ['key,name,type,tier,tier_ja,pattern,boss,n10,n50,n200,at50,at150,at300,reach,label'];
for (const r of out) csv.push([r.key, r.name, r.type, r.tier, TIER[r.tier], r.pattern, ...['boss', 'n10', 'n50', 'n200', 'at50', 'at150', 'at300'].map((k) => Math.round(r.dps[k]!)), r.reach, r.label].join(','));
writeFileSync(join(ROOT, 'docs/14_move_dps.csv'), csv.join('\n') + '\n');
console.log(`技 ${out.length} 個を docs/14_move_dps.md と .csv に出力しました。バランスブレイカー候補: ${out.filter((r) => r.label === 'バランスブレイカー候補').map((r) => r.name).join('・')} / ハイリスク・ハイリターン: ${out.filter((r) => r.label === 'ハイリスク・ハイリターン').map((r) => r.name).join('・')}`);
