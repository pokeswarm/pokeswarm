import { z } from 'zod';

/**
 * セーブデータ（プレイヤー1人分。Firestore の saves/{uid} に1つの文書として保存する）。
 * 形を変えるときは version を上げて、古い形からの変換を migrate に足す。
 * 個人情報（メールアドレスなど）は入れない。
 */
export const saveDataSchema = z.object({
  version: z.literal(1),
  /** 最後に変更した時刻（ms）。データが2つあるときの選択画面と、ブラウザの一時保存との比較に使う */
  updatedAt: z.number().nonnegative(),
  /** コイン（区切り3） */
  coins: z.number().int().nonnegative(),
  /** 永続強化のレベル（区切り3。キーは強化の id） */
  upgrades: z.record(z.string(), z.number().int().nonnegative()),
  /** 解放したポケモン（区切り2） */
  unlocked: z.array(z.string()),
  /** 記録（撃破数などの数。キーは記録の id。区切り2で増やす） */
  stats: z.record(z.string(), z.number().nonnegative()),
  /** 達成した実績（区切り2） */
  achievements: z.array(z.string()),
  /** 一度でも達成した派生・固有技（派生先の技のキー）。選択画面の「おや……？」に使う */
  discoveries: z.array(z.string()),
});
export type SaveData = z.infer<typeof saveDataSchema>;

export function emptySave(now = 0): SaveData {
  return { version: 1, updatedAt: now, coins: 0, upgrades: {}, unlocked: [], stats: {}, achievements: [], discoveries: [] };
}

/** 読み込んだ値をセーブデータにする。形が違えば null（壊れたデータで上書きしないため、呼び出し側で扱いを決める） */
export function parseSave(raw: unknown): SaveData | null {
  const r = saveDataSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** 記録の数を足す */
export function addStat(save: SaveData, key: string, amount: number): void {
  if (amount === 0) return;
  save.stats[key] = (save.stats[key] ?? 0) + amount;
}

/** 記録の最大値を更新する（1ランでの最多撃破など） */
export function maxStat(save: SaveData, key: string, value: number): void {
  if (value > (save.stats[key] ?? 0)) save.stats[key] = value;
}
