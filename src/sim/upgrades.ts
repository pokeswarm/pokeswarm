import type { LevelingConfig, ModifierData } from '../data/schema';

/** 持ち物の効果の合計（% はそのまま足し合わせた値。タイプごとの項目はタイプの番号で引く） */
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
  /** 技の数に足す数 */
  amountBonus: number;
  durationPct: number;
  /** 技の射程 */
  rangePct: number;
  /** 技の貫通に足す数 */
  pierceBonus: number;
}

/** シミュレーションが使う持ち物の定義 */
export interface SimUpgradeDef {
  /** PokeAPI の持ち物の名前 */
  readonly key: string;
  /** stat・type・evolution（07_content_draft.md 21.2） */
  readonly category: "stat" | "type" | "evolution";
  readonly maxLevel: number;
  /** 進化・派生に使うとなくなる */
  readonly consumable: boolean;
  /** 1段階あたりの効果 */
  readonly perLevel: Modifiers;
  /** この系統だけが持てる（無ければだれでも） */
  readonly lines?: readonly string[];
  /** 持っているあいだ、技の威力に掛ける倍率 */
  readonly powerMultiplier?: number;
  /** 今の姿がこのどれかのときだけ持てる（種類の番号） */
  readonly forms?: readonly number[];
  /** 一緒に持てない持ち物（持ち物の番号） */
  readonly excludes?: readonly number[];
  /** 今の姿がこの持ち物で進化できるときだけ候補に出す（つながりのヒモ） */
  readonly onlyWhenEvolves?: boolean;
}

export interface SimDerivation {
  /** 技の番号 */
  readonly from: number;
  /** 持ち物の番号（-1 なら持ち物はいらない） */
  readonly item: number;
  readonly to: number;
  /** 固有技なら系統（playables.json のキー）。派生技なら null */
  readonly line: string | null;
  /** このレベル以上でないと覚えられない */
  readonly minLevel?: number;
  /** 今の姿がこのどれかのときだけ覚えられる（種類の番号） */
  readonly forms?: readonly number[];
  /** ほかにも最大レベルで持っていないといけない技（進化すると消費される） */
  readonly withMoves?: readonly number[];
  /** 進化するとき、持っていれば消費する技 */
  readonly consumes?: readonly number[];
  /** ほかにも覚えていないといけない技（消費しない）。level があればそのレベル以上（リーフブレード・だくりゅう） */
  readonly needsMoves?: readonly { readonly move: number; readonly level?: number }[];
  /** 材料にした技の強化分（レベル − 1）を新しい技のレベルに足す（ばくれつパンチ） */
  readonly inheritLevels?: boolean;
  /** 最大レベル = base + perConsumed × 消費した consumes の数（ばくれつパンチ。07 の105章） */
  readonly levelCap?: { readonly base: number; readonly perConsumed: number };
  /** 系統だけの技でも、段階は派生技（ジョウトの御三家の かえんぐるま など。move-balance.json の tierOverrides） */
  readonly derivedTier?: boolean;
}

/** 固有技の段階か（系統だけの技。ただし derivedTier の技は派生技の段階） */
export function isUniqueDerivation(d: SimDerivation): boolean {
  return d.line !== null && !d.derivedTier;
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
    amountBonus: 0,
    durationPct: 0,
    rangePct: 0,
    pierceBonus: 0,
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
  // [maxLevel] は最大レベルの後も経験値を数えるときの1回分（そのたびに回復かコインを選ぶ。作者の決定 2026年10月25日）
  for (let level = 1; level <= cfg.maxLevel; level++) table.push(Math.round(cfg.xpCurve.base * Math.pow(level, cfg.xpCurve.exponent)));
  return table;
}
