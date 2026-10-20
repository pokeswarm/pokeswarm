import type { SimRules } from '../sim/rules';

/**
 * 計測用に URL のパラメータで data/ の値を一時的に上書きする（技術検証用）。
 * 例: ?cap=1000&spawn=200 … 敵の上限を1000、出現を毎秒200にする
 *     ?status=freeze&chance=1 … 仮の自動攻撃の状態異常を「こおり・必ず付く」にする
 *     ?kb=600 … ノックバックの速さを600にする
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
  const status = q.get('status');
  const chance = num('chance');
  const kb = num('kb');
  const attack = { ...rules.attack };
  if (status && rules.status.kinds.some((k) => k.id === status)) {
    attack.status = { id: status, chance: Math.min(1, chance ?? 1), durationSeconds: rules.attack.status?.durationSeconds ?? 3 };
  } else if (chance !== undefined && attack.status) {
    attack.status = { ...attack.status, chance: Math.min(1, chance) };
  }
  if (kb !== undefined) attack.knockback = { speed: kb, durationSeconds: rules.attack.knockback?.durationSeconds ?? 0.12 };
  return {
    ...rules,
    attack,
    spawn: {
      ...rules.spawn,
      ...(cap !== undefined && { capGlobal: Math.floor(cap), capPerPlayer: Math.floor(cap) }),
      ...(spawn !== undefined && { spawnPerSecond: spawn }),
    },
  };
}
