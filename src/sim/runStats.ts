import type { Player } from './entities/player';
import type { World } from './world';

/**
 * ランの記録（ホウエンの固有技の条件。07 の134章）: 急所に当てた回数・ボスの範囲技を受けた回数など、本人のブラウザでしか分からないもの。
 * 本人のブラウザで数え、派生の条件（derivations.json の runStat）の数に届いたら runStatReached の出来事を出す。
 * 画面がそれを runStat のコマンド（ゲストはホストへのメッセージ）にして、どのブラウザのプレイヤーにも同じ値を付ける
 */
export function bumpRunStat(world: World, p: Player, stat: string, amount = 1): void {
  if (p.id !== world.localPlayerId) return;
  const local = (p.localStats ??= {});
  const before = local[stat] ?? 0;
  const after = before + amount;
  local[stat] = after;
  for (const d of world.rules.derivations) {
    if (d.runStat?.stat !== stat || (d.line !== null && d.line !== p.line)) continue;
    if (before < d.runStat.atLeast && after >= d.runStat.atLeast) world.events.push({ type: 'runStatReached', playerId: p.id, stat, value: after });
  }
}

/** 本人から届いたランの記録を付ける（どのブラウザでも同じ値になる） */
export function setRunStat(p: Player, stat: string, value: number): void {
  const s = (p.runStats ??= {});
  s[stat] = Math.max(s[stat] ?? 0, value);
}
