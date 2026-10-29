import type { LevelUpSnapshot } from '../sim/commands';
import type { LegendaryResult, RunOutcome, UpgradeOffer } from '../sim/world';

/**
 * 協力プレイで送るメッセージ。1回の更新で送るものを配列にまとめて1つの文字列（JSON）にする。
 * 数が多いもの（出現・撃破など）は、通信量を抑えるため数値を平らに並べる。
 */
export type NetMessage =
  /**
   * プレイヤーの状態: 位置・向き・入力・HP・最大HP・倒れているか（1/0）。i はプレイヤーの番号。
   * ゲストの分はホストがほかのゲストへ中継する。k は送り手の通し番号（順番を待たないチャンネルで、古いものが後から届いたら捨てる）
   */
  | { t: 'p'; i: number; x: number; y: number; fx: number; fy: number; ix: number; iy: number; h: number; m: number; dn: number; k?: number; w?: number; sp?: number }
  /** レベルアップの選択の状態（ホスト→ゲスト。変わったときだけ） */
  | { t: 'lu'; s: LevelUpSnapshot | null; r: [number, number][] }
  /** ホストが確定した選択（ホスト→ゲスト） */
  | { t: 'ua'; i: number; o: UpgradeOffer }
  /** 選択の要望（ゲスト→ホスト）: c 選ぶ・b 除外（n は候補の番号）・s 見送る・r リロール */
  | { t: 'rq'; k: 'c' | 's' | 'r' | 'b'; n: number }
  /** ランの記録（ゲスト→ホスト。固有技の条件。07 の134章）: s 記録の名前・v 値 */
  | { t: 'rs'; s: string; v: number }
  /** ボス・伝説の範囲技の予告（ホスト→ゲスト）: [技の番号, x, y, 向きx, 向きy, 突進する敵の id（無ければ -1）, 遅れ, 半径, 内側の半径, 追いかけるプレイヤー（無ければ -1）, ...] */
  | { t: 'hz'; e: number[] }
  /** 中ボス・ボス・伝説の HP と位置（ホスト→ゲスト）: [id, HP, 最大HP, x, y, ...] */
  | { t: 'bh'; e: number[] }
  /** まっすぐ進む敵の出現（ホスト→ゲスト。スウォームの突進）: [id, 種類, x, y, 速度x, 速度y, ...] */
  | { t: 'sv'; e: number[] }
  /** 伝説の乱入（ホスト→ゲスト。「DANGER」） */
  | { t: 'lw'; k: number; r?: 1; i?: 1 }
  | { t: 'lt'; e: number; p: number }
  /** 味方を復活させた（ホスト→ゲスト）: i は復活したプレイヤー、n は残りの復活可能数 */
  | { t: 'rv'; i: number; n: number }
  /** 次の区間へ進んだ（ホスト→ゲスト） */
  | { t: 'sa'; s: number }
  /** 道具を落とした（ホスト→ゲスト）: [id, 種類の番号, x, y, ...] */
  | { t: 'is'; e: number[] }
  /** 道具に触れた（ゲスト→ホスト）: [id, ...] */
  | { t: 'iq'; e: number[] }
  /** 道具の取得の確定（ホスト→ゲスト）: [id, 拾ったプレイヤー, 種類の番号, アメで上がるレベル, ...] */
  | { t: 'ic'; e: number[] }
  /** プレイヤーが抜けた（ホスト→ゲスト） */
  | { t: 'rm'; i: number }
  /** ランの終わり（ホスト→ゲスト）。lg は伝説戦の結果 */
  | { t: 'end'; o: RunOutcome; lg: { kind: number; result: LegendaryResult | null } | null; gt?: number }
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
  /** ポーズ（ホスト→ゲスト）: on 1 で止める・0 で再開 */
  | { t: 'pz'; on: number }
  /** マップの箱（ホスト→ゲスト）: 出た [id, x, y, ...]・なくなった [id, 開いたら1, ...] */
  | { t: 'bs'; e: number[] }
  | { t: 'br'; e: number[] }
  /** 箱への当たり（ゲスト→ホスト）: [箱の id, 攻撃の区別, ...] */
  | { t: 'bx'; e: number[] }
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

/** 最新だけあればよいメッセージ（位置・補正）の見分け: 位置はプレイヤーごと（ホストはほかのゲストの位置も中継する） */
export function latestKey(m: NetMessage): string {
  return m.t === 'p' ? `p:${m.i}` : m.t;
}
