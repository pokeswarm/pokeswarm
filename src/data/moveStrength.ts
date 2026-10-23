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

/** 当たり判定が別々の場所に出る出し方 */
const SPREAD_PATTERNS = new Set(['orbit', 'screen', 'cross', 'strike', 'scatter', 'chain', 'whip', 'trail', 'lob', 'bounce', 'stream', 'eruption', 'spin']);

export function moveStrength(def: MoveDefData, s: MoveStatsAt): number {
  const interval = s.hitIntervalSeconds as number;
  const hits = interval > 0 ? Math.max(1, Math.floor((s.durationSeconds as number) / interval)) : 1;
  // ゆびをふるは、出る技が毎回変わるので数えない
  if (def.pattern === 'metronome') return NaN;
  // 当たり判定が別々の場所に出るもの（周回・画面じゅう・十字・落雷・水たまり・連鎖・横なぎ・足あと・放物線・跳ね返り）は、1体に同時に当たるのはおおむね1つ
  const perTarget = SPREAD_PATTERNS.has(def.pattern) ? 1 : (s.count as number);
  return ((s.power as number) * perTarget * hits) / (s.cooldownSeconds as number);
}

/** Lv1 と最大レベルの強さの目安 */
export function moveStrengthRange(def: MoveDefData): { first: number; max: number } {
  return { first: moveStrength(def, moveStatsAt(def, 1)), max: moveStrength(def, moveStatsAt(def, moveMaxLevel(def))) };
}

/** 群れの強さの目安で使う、敵1体あたりの広さ（中盤の群れで、画面に敵がこのくらいの間隔でいるとみなす） */
export const CROWD_AREA_PER_ENEMY = 5000;
/** 1つの当たり判定が1回に当たる数の上限と、1回の技で当たる数の上限（まわりにいる敵の数を超えないように） */
const CROWD_MAX_TARGETS = 20;
const CROWD_MAX_PER_CAST = 40;

/**
 * 群れの強さの目安: 敵が群れでいるとき、1秒あたりに与えるダメージの合計の見込み。
 * 当たり判定1つが1回に当たる数を「覆う広さ ÷ 敵1体あたりの広さ」で見積もり（貫通の数まで）、
 * 威力 × 1回で当たる回数 × 当たる数（当たり判定の数 × 1つが当たる数。1回の技で40体まで）÷ 再使用 とする。範囲の広い技ほど大きく出る。
 * 飛ぶ技は通り道の広さ、近接の扇形は扇の広さ、ビームは線の広さ、周りに広がる技は円の広さ、周回は当たり判定の近くで数える
 */
export function moveCrowdStrength(def: MoveDefData, s: MoveStatsAt): number {
  if (def.pattern === 'metronome') return NaN;
  const num = (k: string): number => (typeof s[k] === 'number' ? (s[k] as number) : 0);
  const size = num('size');
  const range = num('range');
  const pierce = s.pierce === 'infinite' ? Infinity : num('pierce');
  const interval = num('hitIntervalSeconds');
  const hits = interval > 0 ? Math.max(1, Math.floor(num('durationSeconds') / interval)) : 1;
  let area: number;
  // 爆炎の柱は、1回の技で 方向の数 × 段の数 の柱が出る
  let pieces = num('count');
  switch (def.pattern) {
    case 'nearest':
    case 'facing':
    case 'homing':
    case 'boomerang':
    case 'cross':
    case 'lob':
    case 'bounce':
      area = 2 * size * Math.min(num('speed') * num('durationSeconds'), range || Infinity) * (def.pattern === 'boomerang' ? 2 : 1);
      break;
    case 'spin':
      // 開き arcDegrees の扇形（1枚）
      area = (Math.min(num('arcDegrees'), 360) / 360) * Math.PI * (range + size) ** 2;
      break;
    case 'melee': {
      const arc = num('arcDegrees');
      area = arc > 0 ? (Math.min(arc, 360) / 360) * Math.PI * (range + size) ** 2 : Math.PI * size * size;
      break;
    }
    case 'beam':
    case 'whip':
    case 'stream':
      area = range * 2 * size;
      break;
    case 'chain':
      // 1本の線は、だいたい跳ぶ距離（range の半分）の長さ
      area = range * 0.5 * 2 * size;
      break;
    case 'nova':
      area = Math.PI * range * range;
      break;
    case 'spiral':
      area = Math.PI * range * range * 0.5;
      break;
    case 'sweep':
      area = (Math.min(num('spreadDegrees') + num('arcDegrees'), 360) / 360) * Math.PI * (range + size) ** 2;
      break;
    case 'heal':
      area = 0;
      break;
    case 'eruption': {
      const er = def.eruption ?? { stages: 3, sizeGrowth: 0.25 };
      // 段ごとに半径が大きくなるので、真ん中の段の大きさで数える
      const r = size * (1 + (er.sizeGrowth * (er.stages - 1)) / 2);
      area = Math.PI * r * r;
      pieces *= er.stages;
      break;
    }
    case 'orbit':
      // 回りながら当たり直すので、1回に当たるのは当たり判定の近くだけ
      area = 2 * Math.PI * size * size;
      break;
    default:
      area = Math.PI * size * size;
  }
  const targets = Math.min(pierce, CROWD_MAX_TARGETS, 1 + area / CROWD_AREA_PER_ENEMY);
  const perCast = Math.min(CROWD_MAX_PER_CAST, pieces * targets);
  return (num('power') * hits * perCast) / num('cooldownSeconds');
}

/** 総合の強さの目安 = √(単体 × 群れ)（作者の決定。単体だけ・群れだけが強い技は中くらいになる） */
export function moveTotalStrength(def: MoveDefData, s: MoveStatsAt): number {
  return Math.sqrt(moveStrength(def, s) * moveCrowdStrength(def, s));
}

/** Lv1 と最大レベルの総合の強さ */
export function moveTotalRange(def: MoveDefData): { first: number; max: number } {
  return { first: moveTotalStrength(def, moveStatsAt(def, 1)), max: moveTotalStrength(def, moveStatsAt(def, moveMaxLevel(def))) };
}
