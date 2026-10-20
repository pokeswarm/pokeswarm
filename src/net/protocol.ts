import type { LevelUpSnapshot } from '../sim/commands';
import type { RunOutcome, UpgradeOffer } from '../sim/world';

/**
 * 協力プレイで送るメッセージ。1回の更新で送るものを配列にまとめて1つの文字列（JSON）にする。
 * 数が多いもの（出現・撃破など）は、通信量を抑えるため数値を平らに並べる。
 */
export type NetMessage =
  /**
   * プレイヤーの状態: 位置・向き・入力・HP・最大HP・倒れているか（1/0）。i はプレイヤーの番号。
   * ゲストの分はホストがほかのゲストへ中継する
   */
  | { t: 'p'; i: number; x: number; y: number; fx: number; fy: number; ix: number; iy: number; h: number; m: number; dn: number }
  /** レベルアップの選択の状態（ホスト→ゲスト。変わったときだけ） */
  | { t: 'lu'; s: LevelUpSnapshot | null; r: [number, number][] }
  /** ホストが確定した選択（ホスト→ゲスト） */
  | { t: 'ua'; i: number; o: UpgradeOffer }
  /** 選択の要望（ゲスト→ホスト）: c 選ぶ（n は候補の番号）・s 見送る・r リロール */
  | { t: 'rq'; k: 'c' | 's' | 'r'; n: number }
  /** ボスの範囲技の予告（ホスト→ゲスト）: [x, y, ...] */
  | { t: 'hz'; e: number[] }
  /** 中ボス・ボスの HP（ホスト→ゲスト）: [id, HP, 最大HP, ...] */
  | { t: 'bh'; e: number[] }
  /** 味方を復活させた（ホスト→ゲスト）: i は復活したプレイヤー、n は残りの復活可能数 */
  | { t: 'rv'; i: number; n: number }
  /** プレイヤーが抜けた（ホスト→ゲスト） */
  | { t: 'rm'; i: number }
  /** ランの終わり（ホスト→ゲスト） */
  | { t: 'end'; o: RunOutcome }
  /** 出現（ホスト→ゲスト）: [id, 種類, x, y, ...] */
  | { t: 'sp'; e: number[] }
  /** 撃破の確定（ホスト→ゲスト）: [id, とどめを刺したプレイヤー, ...] */
  | { t: 'k'; e: number[] }
  /** 前の時間帯の敵を消した（ホスト→ゲスト）: [id, ...] */
  | { t: 'rt'; e: number[] }
  /**
   * 命中（ゲスト→ホスト）: [id, ダメージ, 攻撃したプレイヤー, ノックバックx, y, ノックバックの更新回数, 状態異常の番号(-1なし), 状態異常の更新回数, ...]
   */
  | { t: 'd'; e: number[] }
  /** 効果（ホスト→ゲスト）: [id, 付けたプレイヤー, ノックバックx, y, ノックバックの更新回数, 状態異常の番号(-1なし), 状態異常の更新回数, ...] */
  | { t: 'fx'; e: number[] }
  /** 経験値の玉の出現（ホスト→ゲスト）: [id, x, y, 経験値, ...] */
  | { t: 'g'; e: number[] }
  /** 玉へのまとめ（ホスト→ゲスト）: [id, まとめた後の経験値, ...] */
  | { t: 'gm'; e: number[] }
  /** 玉の取得の確定（ホスト→ゲスト）: [id, 拾ったプレイヤー, 経験値, ...] */
  | { t: 'gc'; e: number[] }
  /** 玉に触れた（ゲスト→ホスト）: [id, 触れたプレイヤー, ...] */
  | { t: 'pr'; e: number[] }
  /** 敵の位置の補正（ホスト→ゲスト）: [id, x, y, ...]。k はホストの更新回数（ゲストの経過時間をそろえる） */
  | { t: 'c'; e: number[]; k: number }
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
