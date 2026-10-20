import type { SimRules } from '../sim/rules';

/**
 * 計測用に URL のパラメータで data/ の値を一時的に上書きする（技術検証用）。
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
  if (cap === undefined && spawn === undefined) return rules;
  return {
    ...rules,
    spawn: {
      ...rules.spawn,
      ...(cap !== undefined && { capGlobal: Math.floor(cap), capPerPlayer: Math.floor(cap) }),
      ...(spawn !== undefined && { spawnPerSecond: spawn }),
    },
  };
}
