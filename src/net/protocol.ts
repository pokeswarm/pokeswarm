/**
 * 協力プレイで送るメッセージ。1回の更新で送るものを配列にまとめて1つの文字列（JSON）にする。
 * 数が多いもの（出現・撃破など）は、通信量を抑えるため数値を平らに並べる。
 */
export type NetMessage =
  /** 送り手のプレイヤーの状態: 位置・向き・入力 */
  | { t: 'p'; x: number; y: number; fx: number; fy: number; ix: number; iy: number }
  /** 出現（ホスト→ゲスト）: [id, 種類, x, y, ...] */
  | { t: 'sp'; e: number[] }
  /** 強化（ホスト→ゲスト）: [id, 段階, ...] */
  | { t: 'em'; e: number[] }
  /** 撃破の確定（ホスト→ゲスト）: [id, とどめを刺したプレイヤー, ...] */
  | { t: 'k'; e: number[] }
  /** 前の時間帯の敵を消した（ホスト→ゲスト）: [id, ...] */
  | { t: 'rt'; e: number[] }
  /** 命中（ゲスト→ホスト）: [id, ダメージ, 攻撃したプレイヤー, ...] */
  | { t: 'd'; e: number[] }
  /** 敵の位置の補正（ホスト→ゲスト）: [id, x, y, ...] */
  | { t: 'c'; e: number[] }
  /** 往復時間の計測 */
  | { t: 'ping'; s: number }
  | { t: 'pong'; s: number };

export function encode(messages: readonly NetMessage[]): string {
  return JSON.stringify(messages);
}

export function decode(text: string): NetMessage[] {
  const v: unknown = JSON.parse(text);
  return Array.isArray(v) ? (v as NetMessage[]) : [];
}

/** 小数第2位で丸める（位置を送るときの通信量を減らす） */
export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
