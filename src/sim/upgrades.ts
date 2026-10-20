import type { LevelingConfig, ModifierData } from '../data/schema';

/** 持ち物・パッシブの効果の合計（% はそのまま足し合わせた値。タイプごとの項目はタイプの番号で引く） */
export interface Modifiers {
  powerPct: number;
  physicalPowerPct: number;
  specialPowerPct: number;
  typePowerPct: number[];
  areaPct: number;
  typeAreaPct: number[];
  cooldownPct: number;
  projectileSpeedPct: number;
  critChancePct: number;
  damageTakenPct: number;
  defensePct: number;
  maxHpPct: number;
  regenPerSecond: number;
  moveSpeedPct: number;
  pickupRangePct: number;
  xpPct: number;
}

/** シミュレーションが使う持ち物・パッシブの定義 */
export interface SimUpgradeDef {
  /** PokeAPI の持ち物の名前 */
  readonly key: string;
  readonly maxLevel: number;
  /** 進化・派生に使うとなくなる */
  readonly consumable: boolean;
  /** 1段階あたりの効果 */
  readonly perLevel: Modifiers;
}

export interface SimDerivation {
  /** 技の番号 */
  readonly from: number;
  /** 持ち物の番号 */
  readonly item: number;
  readonly to: number;
  /** 固有技なら系統（playables.json のキー）。派生技なら null */
  readonly line: string | null;
}

/** シミュレーションが使うレベルアップの定義 */
export interface SimLeveling extends LevelingConfig {
  /** レベル L から L+1 に必要な経験値。[L] で引く（[0] は使わない） */
  readonly xpToNext: readonly number[];
}

export function emptyModifiers(typeCount: number): Modifiers {
  return {
    powerPct: 0,
    physicalPowerPct: 0,
    specialPowerPct: 0,
    typePowerPct: new Array<number>(typeCount).fill(0),
    areaPct: 0,
    typeAreaPct: new Array<number>(typeCount).fill(0),
    cooldownPct: 0,
    projectileSpeedPct: 0,
    critChancePct: 0,
    damageTakenPct: 0,
    defensePct: 0,
    maxHpPct: 0,
    regenPerSecond: 0,
    moveSpeedPct: 0,
    pickupRangePct: 0,
    xpPct: 0,
  };
}

/** data の効果（タイプはキー）を、タイプの番号で引ける形にする */
export function resolveModifiers(data: ModifierData, typeNames: readonly string[]): Modifiers {
  const m = emptyModifiers(typeNames.length);
  for (const [k, v] of Object.entries(data)) {
    if (k === 'typePowerPct' || k === 'typeAreaPct') {
      for (const [type, pct] of Object.entries(v as Record<string, number>)) {
        const i = typeNames.indexOf(type);
        if (i === -1) throw new Error(`タイプ ${type} がありません`);
        m[k][i] = pct;
      }
    } else {
      (m as unknown as Record<string, number>)[k] = v as number;
    }
  }
  return m;
}

/** acc に mods を times 回分足す */
export function addModifiers(acc: Modifiers, mods: Modifiers, times: number): void {
  for (const [k, v] of Object.entries(mods) as [keyof Modifiers, number | number[]][]) {
    if (Array.isArray(v)) {
      const arr = acc[k] as number[];
      for (let i = 0; i < v.length; i++) arr[i]! += v[i]! * times;
    } else {
      (acc as unknown as Record<string, number>)[k]! += v * times;
    }
  }
}

/** レベルごとの必要経験値の表 */
export function buildXpTable(cfg: LevelingConfig): number[] {
  const table = [0];
  for (let level = 1; level < cfg.maxLevel; level++) table.push(Math.round(cfg.xpCurve.base * Math.pow(level, cfg.xpCurve.exponent)));
  return table;
}
