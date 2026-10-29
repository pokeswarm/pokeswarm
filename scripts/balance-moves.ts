/**
 * 技の威力を、段階ごとの総合の強さにそろえる（作者の決定。07_content_draft.md 16.2）。
 *
 *   npm run balance-moves
 *
 * 入力: data/game/moves.json・derivations.json・move-balance.json
 * 出力: data/game/moves.json（威力 power とレベルごとの威力の増分だけを書き換える。範囲・数・速さ・持続は変えない）
 *
 * 総合の強さ = √(単体 × 群れ)（src/data/moveStrength.ts）は威力に比例するので、レベルごとの威力を、
 * 総合の強さが Lv1 の目安から最大の目安まで同じ幅で上がるように決める（retuned）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { moveMaxLevel, moveStatsAt, moveTotalStrength } from '../src/data/moveStrength.ts';
import type { MoveBalanceConfig, MoveDefData } from '../src/data/schema.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const path = (p: string): string => join(ROOT, p);
const movesFile = JSON.parse(readFileSync(path('data/game/moves.json'), 'utf8')) as { moves: Record<string, MoveDefData> };
const derivations = JSON.parse(readFileSync(path('data/game/derivations.json'), 'utf8')) as {
  derivations: { to: string }[];
  unique: { to: string }[];
};
const balance = JSON.parse(readFileSync(path('data/game/move-balance.json'), 'utf8')) as MoveBalanceConfig;

type Tier = keyof MoveBalanceConfig['tiers'];
const tierOf = (key: string): Tier =>
  balance.tierOverrides?.[key] ??
  (derivations.unique.some((d) => d.to === key) ? 'unique' : derivations.derivations.some((d) => d.to === key) ? 'derived' : 'base');

const total = (def: MoveDefData, level: number): number => moveTotalStrength(def, moveStatsAt(def, level));
const first = (def: MoveDefData): number => total(def, 1);
const max = (def: MoveDefData): number => total(def, moveMaxLevel(def));

/**
 * 威力をレベルごとに決め直す: 総合の強さが Lv1 の目安（max × firstRatio）から最大の目安（max）まで、レベルごとに同じ幅で上がるようにする。
 * 総合の強さは威力に比例するので、レベル L の威力 = そのレベルの目安 ÷（威力 1 のときの総合の強さ）。
 * 数が増えるレベルでは、1発の威力が下がることもある（増分がマイナス）
 */
function retuned(def: MoveDefData, firstTarget: number, maxTarget: number): MoveDefData {
  const n = moveMaxLevel(def);
  const powers: number[] = [];
  for (let level = 1; level <= n; level++) {
    const unit = moveTotalStrength(def, { ...moveStatsAt(def, level), power: 1 });
    const want = n === 1 ? maxTarget : firstTarget + ((maxTarget - firstTarget) * (level - 1)) / (n - 1);
    powers.push(Math.round((want / unit) * 10) / 10);
  }
  return {
    ...def,
    base: { ...def.base, power: powers[0]! },
    levels: def.levels.map((d, i) => {
      const { power: _old, ...rest } = d;
      const delta = Math.round((powers[i + 1]! - powers[i]!) * 10) / 10;
      return delta === 0 ? rest : { ...rest, power: delta };
    }),
  };
}

const report: string[] = [];
for (const [key, def] of Object.entries(movesFile.moves)) {
  if (balance.exempt.includes(key)) continue;
  const tier = balance.tiers[tierOf(key)];
  // 地方の固有技（ホウエン）だけ、帯を倍率の分だけ強くする。タイプの技・派生技は前の地方と同じ（敵の HP を増やした意味がなくなるため。07 の134章）
  const scale = def.region && tierOf(key) === 'unique' ? (balance.regionTierScale?.[def.region] ?? 1) : 1;
  const out = retuned(def, tier.max * scale * tier.firstRatio, tier.max * scale);
  movesFile.moves[key] = out;
  report.push(`${key.padEnd(16)} ${tierOf(key).padEnd(8)} ${first(def).toFixed(0).padStart(5)} → ${max(def).toFixed(0).padStart(5)}  を  ${first(out).toFixed(0).padStart(4)} → ${max(out).toFixed(0).padStart(4)}`);
}
writeFileSync(path('data/game/moves.json'), JSON.stringify(movesFile, null, 2) + '\n');
console.log(report.join('\n'));
