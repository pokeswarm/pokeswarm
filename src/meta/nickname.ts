/**
 * ニックネームとタグ（「ニックネーム#1234」。03_network.md 1.2）。Firebase に依存しない決まりだけを置く。
 * - ニックネームは1〜12文字。空白だけ・改行・見えない文字は不可。タグと紛らわしい「#」と、保存の都合で「/」も不可
 * - タグは数字4桁（0001〜9999）。重複を防ぐのは「ニックネーム＋4桁」の組み合わせ
 * - 照合では大文字・小文字・全角半角を区別しない（NFKC で正規化して小文字にする）
 */

export const NICKNAME_MAX = 12;
export const TAG_DIGITS = 4;

export type NicknameProblem = 'empty' | 'tooLong' | 'invalidChar';

/** 前後の空白を除いたニックネーム。問題があればその種類 */
export function validateNickname(raw: string): { ok: true; nickname: string } | { ok: false; problem: NicknameProblem } {
  const nickname = raw.normalize('NFC').trim();
  if (nickname.length === 0) return { ok: false, problem: 'empty' };
  // 制御文字・書式文字（ゼロ幅スペースなど）・行や段落の区切り・#・/ は使えない
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}#/]/u.test(nickname)) return { ok: false, problem: 'invalidChar' };
  if ([...nickname].length > NICKNAME_MAX) return { ok: false, problem: 'tooLong' };
  return { ok: true, nickname };
}

/** 照合用の形（全角半角・大文字小文字をそろえる） */
export function nicknameKey(nickname: string): string {
  return nickname.normalize('NFKC').trim().toLowerCase();
}

/** タグの文書の名前（照合用のニックネーム＋4桁） */
export function tagId(nickname: string, tag: string): string {
  return `${nicknameKey(nickname)}#${tag}`;
}

/** 表示用の「ニックネーム#1234」 */
export function formatTag(nickname: string, tag: string): string {
  return `${nickname}#${tag}`;
}

/** 入力された「ニックネーム#1234」を分ける（全角の＃・数字も受け付ける）。形が違えば null */
export function parseTag(text: string): { nickname: string; tag: string } | null {
  const s = text.normalize('NFKC').trim();
  const i = s.lastIndexOf('#');
  if (i <= 0) return null;
  const nickname = s.slice(0, i).trim();
  const tag = s.slice(i + 1).trim();
  if (!new RegExp(`^\\d{${TAG_DIGITS}}$`).test(tag) || tag === '0'.repeat(TAG_DIGITS)) return null;
  const v = validateNickname(nickname);
  return v.ok ? { nickname: v.nickname, tag } : null;
}

/** ランダムな4桁（0001〜9999）。random は 0 以上 1 未満 */
export function randomTag(random: () => number): string {
  const max = 10 ** TAG_DIGITS - 1;
  return String(1 + Math.floor(random() * max)).padStart(TAG_DIGITS, '0');
}
