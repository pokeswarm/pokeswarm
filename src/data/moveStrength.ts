import type { MoveDefData } from './schema';

/**
 * 技の強さの目安（技どうしを比べるための数。技の一覧表と、派生の決まりのテストで使う）:
 * 1体の敵に当て続けたときの1秒あたりのダメージ（威力 × 数 × 1回で当たる回数 ÷ 再使用）。
 * ポケモンのステータス・タイプ一致・相性・持ち物は掛けない。範囲の広さは数えない。
 * 周りを回る・地面に残る・ビームは、当たり直しの間隔ごとに持続の時間いっぱい当たり続けたとして数える。
 */
export type MoveStatsAt = Record<string, number | string | undefined>;

/** レベル L の性能（基本 + レベル2以降の足し算） */
export function moveStatsAt(def: MoveDefData, level: number): MoveStatsAt {
  const out: MoveStatsAt = { ...def.base };
  for (let l = 0; l < level - 1 && l < def.levels.length; l++) {
    for (const [k, v] of Object.entries(def.levels[l]!)) {
      const cur = out[k];
      if (cur === 'infinite') continue;
      out[k] = Math.round(((cur as number | undefined) ?? 0) * 1000 + (v as number) * 1000) / 1000;
    }
  }
  return out;
}

export function moveMaxLevel(def: MoveDefData): number {
  return def.levels.length + 1;
}

export function moveStrength(def: MoveDefData, s: MoveStatsAt): number {
  const interval = s.hitIntervalSeconds as number;
  const hits = interval > 0 ? Math.max(1, Math.floor((s.durationSeconds as number) / interval)) : 1;
  // 周りを回るものは、1体に同時に当たるのはおおむね1つ
  const perTarget = def.pattern === 'orbit' ? 1 : (s.count as number);
  return ((s.power as number) * perTarget * hits) / (s.cooldownSeconds as number);
}

/** Lv1 と最大レベルの強さの目安 */
export function moveStrengthRange(def: MoveDefData): { first: number; max: number } {
  return { first: moveStrength(def, moveStatsAt(def, 1)), max: moveStrength(def, moveStatsAt(def, moveMaxLevel(def))) };
}
