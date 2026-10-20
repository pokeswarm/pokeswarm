import { describe, expect, it } from 'vitest';
import { formatTag, nicknameKey, parseTag, randomTag, tagId, validateNickname } from './nickname';

describe('ニックネーム', () => {
  it('1〜12文字。前後の空白は除く', () => {
    expect(validateNickname('  サトシ ')).toEqual({ ok: true, nickname: 'サトシ' });
    expect(validateNickname('あいうえおかきくけこさし')).toMatchObject({ ok: true });
    expect(validateNickname('あいうえおかきくけこさしす')).toEqual({ ok: false, problem: 'tooLong' });
  });

  it('空白だけ・改行・見えない文字・# と / は使えない', () => {
    expect(validateNickname('   ')).toEqual({ ok: false, problem: 'empty' });
    expect(validateNickname('a\nb')).toEqual({ ok: false, problem: 'invalidChar' });
    expect(validateNickname('a​b')).toEqual({ ok: false, problem: 'invalidChar' });
    expect(validateNickname('a#b')).toEqual({ ok: false, problem: 'invalidChar' });
    expect(validateNickname('a/b')).toEqual({ ok: false, problem: 'invalidChar' });
  });

  it('絵文字は1文字として数える', () => {
    expect(validateNickname('🔥'.repeat(12))).toMatchObject({ ok: true });
  });
});

describe('タグ', () => {
  it('照合では大文字・小文字・全角半角を区別しない', () => {
    expect(nicknameKey('Ｒｅｄ')).toBe(nicknameKey('red'));
    expect(tagId('RED', '0042')).toBe(tagId('ｒｅｄ', '0042'));
  });

  it('「ニックネーム#1234」を分ける（全角の＃・数字も受け付ける）', () => {
    expect(parseTag('レッド#0042')).toEqual({ nickname: 'レッド', tag: '0042' });
    expect(parseTag(' レッド＃００４２ ')).toEqual({ nickname: 'レッド', tag: '0042' });
    expect(parseTag('レッド#42')).toBeNull();
    expect(parseTag('レッド#0000')).toBeNull();
    expect(parseTag('#1234')).toBeNull();
    expect(parseTag('レッド')).toBeNull();
  });

  it('4桁は 0001〜9999', () => {
    expect(randomTag(() => 0)).toBe('0001');
    expect(randomTag(() => 0.9999999)).toBe('9999');
    expect(formatTag('レッド', '0042')).toBe('レッド#0042');
  });
});
