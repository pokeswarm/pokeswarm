/**
 * 引き継ぎコード（作者の決定 2026年10月22日。03_network.md 1.1）: ゲストが、メールアドレスなしでデータを別のブラウザへ移すためのコード。
 * 見間違えやすい文字（0 と O、1 と I）を除いた 32 文字から 12 文字（60 ビット）。当て推量では見つからない長さにする。
 * 表示は 4 文字ずつ区切る（ABCD-EFGH-JKLM）。入力では区切り・空白・小文字を許す
 */
export const TRANSFER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const TRANSFER_CODE_LENGTH = 12;

/** 新しいコード（暗号用の乱数で作る。ゲームのシード付き乱数とは別） */
export function newTransferCode(random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  // 256 は 32 で割り切れるので、余りで選んでも偏らない
  const bytes = random(new Uint8Array(TRANSFER_CODE_LENGTH));
  return [...bytes].map((b) => TRANSFER_ALPHABET[b % TRANSFER_ALPHABET.length]).join('');
}

/** 入力されたコードを、保存してある形にそろえる。形が違えば null */
export function normalizeTransferCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== TRANSFER_CODE_LENGTH) return null;
  return [...code].every((c) => TRANSFER_ALPHABET.includes(c)) ? code : null;
}

/** 見せるときの形（4文字ずつ区切る） */
export function formatTransferCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}
