import type { CombatConfig, MoveDefData, MovePattern, MoveEffect } from '../data/schema';

/** シミュレーションが使う技の性能（レベルを反映済み。貫通無限は Infinity） */
export interface MoveStats {
  power: number;
  cooldownSeconds: number;
  count: number;
  intervalSeconds: number;
  speed: number;
  size: number;
  range: number;
  durationSeconds: number;
  pierce: number;
  hitIntervalSeconds: number;
  knockback: number;
  knockbackSeconds: number;
  /** 状態異常の番号（data/game/status.json の並び）。-1 なら付けない */
  status: number;
  statusChance: number;
  statusSeconds: number;
  spreadDegrees: number;
  lifestealPct: number;
  /** この技だけの急所の確率（%） */
  critChancePct: number;
  /** 雑魚を一撃で倒す確率（0〜1） */
  instakillChance: number;
  /** 近接の扇形の角度（度）。0 なら円 */
  arcDegrees: number;
  /** 状態異常の敵へのダメージを何 % 上げるか */
  statusBonusPct: number;
  /** 使うたびに最大 HP の何 % を回復するか */
  healPct: number;
  /** 使ってから duration の間、受けるダメージを何 % 減らすか */
  guardPct: number;
  /** 覚えているほかの技 1つにつき、威力を何 % 上げるか */
  perMovePowerPct: number;
}

/** シミュレーションが使う技の定義 */
export interface SimMoveDef {
  /** PokeAPI の技の名前 */
  readonly key: string;
  readonly pattern: MovePattern;
  /** タイプの番号（SimRules.types の並び） */
  readonly type: number;
  /** 原作の分類。物理ならこうげき、特殊ならとくこうの威力を使う */
  readonly damageClass: 'physical' | 'special';
  /** レベルごとの性能。[0] がレベル1 */
  readonly levels: readonly MoveStats[];
  /** 見た目のレシピ（シミュレーションは使わない） */
  readonly effect: string;
  /** 自分の体で攻撃する技の見た目（使ったときに知らせる）。無ければ null */
  readonly body: { readonly lungeDistance: number; readonly afterimages: number } | null;
  /** eruption（爆炎の柱）の段の数と、外の段ほど半径を大きくする割合。eruption でなければ null */
  readonly eruption: { readonly stages: number; readonly sizeGrowth: number } | null;
  /** 効き方の部品（07 22.4）。無ければ空 */
  readonly effects: readonly MoveEffect[];
  /** 飛ぶ弾が曲がる速さ（ラジアン/秒）。0 なら まっすぐ */
  readonly curve: number;
  /** 外へ進む帯の厚さ（届く距離に対する割合）。0 なら中まで全部当たる */
  readonly sweep: number;
  /** 跳ね返る技を出す向きのずれ（ラジアン） */
  readonly bounceAngle: number;
  /** 当たったときの状態異常を、この中からランダムに選ぶ（状態異常の番号。空なら技の状態異常） */
  readonly randomStatuses: readonly number[];
}

/** 最小値で止める項目（足し続けても壊れないように） */
const MIN: Partial<Record<keyof MoveStats, number>> = {
  cooldownSeconds: 0.1,
  count: 1,
  size: 1,
  durationSeconds: 0.05,
  statusChance: 0,
};

/** レベル1の性能に、レベルごとの増分を順に足して、全レベルの性能を作る */
export function resolveMoveLevels(def: MoveDefData, statusIndexOf: (id: string) => number): MoveStats[] {
  const b = def.base;
  let cur: MoveStats = {
    power: b.power,
    cooldownSeconds: b.cooldownSeconds,
    count: b.count,
    intervalSeconds: b.intervalSeconds,
    speed: b.speed,
    size: b.size,
    range: b.range,
    durationSeconds: b.durationSeconds,
    pierce: b.pierce === 'infinite' ? Infinity : b.pierce,
    hitIntervalSeconds: b.hitIntervalSeconds,
    knockback: b.knockback,
    knockbackSeconds: b.knockbackSeconds,
    status: b.statusId ? statusIndexOf(b.statusId) : -1,
    statusChance: b.statusChance,
    statusSeconds: b.statusSeconds,
    spreadDegrees: b.spreadDegrees,
    lifestealPct: b.lifestealPct,
    critChancePct: b.critChancePct,
    instakillChance: b.instakillChance,
    arcDegrees: b.arcDegrees,
    statusBonusPct: b.statusBonusPct,
    healPct: b.healPct,
    guardPct: b.guardPct,
    perMovePowerPct: b.perMovePowerPct,
  };
  const out = [cur];
  for (const delta of def.levels) {
    const next = { ...cur };
    for (const [k, v] of Object.entries(delta) as [keyof MoveStats, number][]) {
      if (k === 'status') continue;
      next[k] = Math.max(MIN[k] ?? 0, next[k] + v);
    }
    next.statusChance = Math.min(1, next.statusChance);
    next.instakillChance = Math.min(1, next.instakillChance);
    out.push(next);
    cur = next;
  }
  return out;
}

/** タイプ相性の表。chart[攻撃のタイプ][守りのタイプ] = 原作の倍率（2 / 1 / 0.5 / 0） */
export interface TypeChart {
  readonly names: readonly string[];
  readonly chart: readonly (readonly number[])[];
}

export function buildTypeChart(
  types: Record<string, { doubleDamageTo: string[]; halfDamageTo: string[]; noDamageTo: string[] }>,
): TypeChart {
  const names = Object.keys(types);
  const index = new Map(names.map((n, i) => [n, i]));
  const chart = names.map((atk) => {
    const row = names.map(() => 1);
    const t = types[atk]!;
    for (const d of t.doubleDamageTo) if (index.has(d)) row[index.get(d)!] = 2;
    for (const d of t.halfDamageTo) if (index.has(d)) row[index.get(d)!] = 0.5;
    for (const d of t.noDamageTo) if (index.has(d)) row[index.get(d)!] = 0;
    return row;
  });
  return { names, chart };
}

/**
 * タイプ相性の倍率（01_game_design.md 4.5）。
 * 守る側が2タイプなら原作どおり掛け合わせ、1より大きければばつぐん、小さければ（効果なしも含め）いまひとつ。
 * 技のタイプが攻撃する側のタイプのどれかと同じならタイプ一致を掛ける。
 */
export function typeMultiplier(
  types: TypeChart,
  m: CombatConfig['typeMultipliers'],
  moveType: number,
  attackerTypes: readonly number[],
  defenderTypes: readonly number[],
): number {
  let raw = 1;
  const row = types.chart[moveType];
  if (row) for (const d of defenderTypes) raw *= row[d] ?? 1;
  let mult = raw > 1 ? m.superEffective : raw < 1 ? m.notVeryEffective : 1;
  if (attackerTypes.includes(moveType)) mult *= m.stab;
  return mult;
}
