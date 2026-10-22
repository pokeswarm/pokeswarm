import { describe, expect, it } from 'vitest';
import { TRANSFER_ALPHABET, formatTransferCode, newTransferCode, normalizeTransferCode } from './transferCode';

describe('引き継ぎコード', () => {
  it('32文字から12文字を作り、Firestore のルールの形（^[A-HJ-NP-Z2-9]{12}$）に合う', () => {
    expect(TRANSFER_ALPHABET).toHaveLength(32);
    for (let i = 0; i < 50; i++) expect(newTransferCode()).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
  });

  it('同じ乱数からは同じコード', () => {
    const fixed = (b: Uint8Array<ArrayBuffer>): Uint8Array => b.map((_, i) => i * 37);
    expect(newTransferCode(fixed)).toBe(newTransferCode(fixed));
  });

  it('区切り・空白・小文字を許して、保存してある形にそろえる', () => {
    expect(normalizeTransferCode(' abcd-efgh-jklm ')).toBe('ABCDEFGHJKLM');
    expect(normalizeTransferCode('ABCD EFGH JKLM')).toBe('ABCDEFGHJKLM');
  });

  it('長さが違う・使わない文字（O・I・0・1）があれば null', () => {
    expect(normalizeTransferCode('ABCD-EFGH')).toBeNull();
    expect(normalizeTransferCode('ABCD-EFGH-JKLO')).toBeNull();
    expect(normalizeTransferCode('ABCD-EFGH-JKL1')).toBeNull();
  });

  it('4文字ずつ区切って見せる', () => {
    expect(formatTransferCode('ABCDEFGHJKLM')).toBe('ABCD-EFGH-JKLM');
  });
});
