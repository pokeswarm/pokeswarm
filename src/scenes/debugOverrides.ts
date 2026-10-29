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
  // ?spawnx=2 … 雑魚の出る数と上限を、ふだん（時間帯ごとの値）の2倍にする（宣伝の動画。作者の依頼 2026年10月30日）
  const x = num('spawnx') ?? 1;
  return {
    ...rules,
    spawn: {
      ...rules.spawn,
      ...(cap !== undefined && { capGlobal: Math.floor(cap), capPerPlayer: Math.floor(cap) }),
      ...(spawn !== undefined && { spawnPerSecond: spawn }),
      ...(x !== 1 && cap === undefined && { capGlobal: Math.floor(rules.spawn.capGlobal * x), capPerPlayer: Math.floor(rules.spawn.capPerPlayer * x), spawnPerSecond: rules.spawn.spawnPerSecond * x }),
      // 時間帯ごとの値より、URL の指定を優先する
      waves: rules.spawn.waves.map((w) => ({
        ...w,
        ...(x !== 1 && { capPerPlayer: Math.floor((w.capPerPlayer ?? rules.spawn.capPerPlayer) * x), spawnPerSecond: (w.spawnPerSecond ?? rules.spawn.spawnPerSecond) * x }),
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

/**
 * 確認用: ?items=pp-max:2,charcoal:3 で持ち物とレベルを指定する（無ければ null）。知らない持ち物は無視し、レベルは 1〜最大に収める
 */
export function parseItemsParam(rules: SimRules, search: string): { item: number; level: number }[] | null {
  const v = new URLSearchParams(search).get('items');
  if (!v) return null;
  const out: { item: number; level: number }[] = [];
  for (const part of v.split(',')) {
    const [key, lv] = part.split(':');
    const item = rules.items.findIndex((it) => it.key === key);
    if (item === -1) continue;
    out.push({ item, level: Math.max(1, Math.min(rules.items[item]!.maxLevel, Number(lv) || 1)) });
  }
  return out;
}

/**
 * テストプレイ（作者の依頼 2026年10月26日）: ?legend=mewtwo で、最初から伝説（enemies.json の legend-<名前>・shiny-<名前>、または id そのもの）と戦う。
 * 知らない名前なら null
 */
export function parseLegendParam(rules: SimRules, search: string): number | null {
  const v = new URLSearchParams(search).get('legend');
  if (!v) return null;
  const kinds = rules.enemies.kinds;
  const k = kinds.findIndex((x) => (x.id === v || x.id === `legend-${v}` || x.id === `shiny-${v}`) && x.rank === 'legendary');
  return k === -1 ? null : k;
}

/** テストプレイ: ?intruder=raikou で、少し後に伝説（三犬）が乱入する（legend-<名前> または id）。知らない名前なら null */
export function parseIntruderParam(rules: SimRules, search: string): number | null {
  const v = new URLSearchParams(search).get('intruder');
  if (!v) return null;
  const k = rules.enemies.kinds.findIndex((x) => (x.id === v || x.id === `legend-${v}`) && x.rank === 'legendary');
  return k === -1 ? null : k;
}

/** テストプレイ: ?wings で、はね（ぎんいろ・にじいろ）を最初から持っている（レッドに勝つとルギア・ホウオウと戦える） */
export function parseWingsParam(search: string): boolean {
  return new URLSearchParams(search).has('wings');
}

/** テストプレイ: ?god で自分は無敵（受けたはずのダメージは数えて出す） */
export function parseGodParam(search: string): boolean {
  return new URLSearchParams(search).has('god');
}

/** 確認用: ?level=15 で、そのレベルから始める（進化などの確認用）。無ければ null */
export function parseLevelParam(search: string): number | null {
  const v = Number(new URLSearchParams(search).get('level'));
  return Number.isInteger(v) && v > 1 ? v : null;
}

/** 確認用: ?time=880 で、ランの途中の時刻（秒）から始める（制限時間・スウォームの確認用）。無ければ null */
export function parseTimeParam(search: string): number | null {
  const v = Number(new URLSearchParams(search).get('time'));
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** 確認用: ?section=3 で、その区間（data/game/spawn.json の waves の番号）から始める。無ければ null */
export function parseSectionParam(search: string): number | null {
  const v = Number(new URLSearchParams(search).get('section'));
  return Number.isInteger(v) && v > 0 ? v : null;
}
