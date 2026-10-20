import type { SimRules } from '../sim/rules';

/**
 * 確認用に URL のパラメータで data/ の値を一時的に上書きする。
 * 例: ?cap=1000&spawn=200 … 敵の上限を1000、出現を毎秒200にする
 */
export function applyDebugOverrides(rules: SimRules, search: string): SimRules {
  const q = new URLSearchParams(search);
  const num = (key: string): number | undefined => {
    const v = q.get(key);
    if (v === null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const cap = num('cap');
  const spawn = num('spawn');
  return {
    ...rules,
    spawn: {
      ...rules.spawn,
      ...(cap !== undefined && { capGlobal: Math.floor(cap), capPerPlayer: Math.floor(cap) }),
      ...(spawn !== undefined && { spawnPerSecond: spawn }),
      // 時間帯ごとの値より、URL の指定を優先する
      waves: rules.spawn.waves.map((w) => ({
        ...w,
        ...(cap !== undefined && { capPerPlayer: Math.floor(cap) }),
        ...(spawn !== undefined && { spawnPerSecond: spawn }),
      })),
    },
  };
}

/**
 * 確認用: ?moves=ember:8,fire-spin:3 で覚えている技とレベルを指定する（無ければ null）。
 * 知らない技は無視し、レベルは 1〜最大に収める。技の数は覚えられる数まで。
 */
export function parseMovesParam(rules: SimRules, search: string): { move: number; level: number }[] | null {
  const v = new URLSearchParams(search).get('moves');
  if (!v) return null;
  const out: { move: number; level: number }[] = [];
  for (const part of v.split(',')) {
    const [key, lv] = part.split(':');
    const move = rules.moves.findIndex((m) => m.key === key);
    if (move === -1) continue;
    const max = rules.moves[move]!.levels.length;
    out.push({ move, level: Math.max(1, Math.min(max, Number(lv) || 1)) });
  }
  return out.slice(0, rules.combat.maxMoveSlots);
}

/** 確認用: ?level=15 で、そのレベルから始める（進化などの確認用）。無ければ null */
export function parseLevelParam(search: string): number | null {
  const v = Number(new URLSearchParams(search).get('level'));
  return Number.isInteger(v) && v > 1 ? v : null;
}

/** 確認用: ?time=880 で、ランの途中（秒）から始める（中ボス・ボスの確認用）。無ければ null */
export function parseTimeParam(search: string): number | null {
  const v = Number(new URLSearchParams(search).get('time'));
  return Number.isFinite(v) && v > 0 ? v : null;
}
