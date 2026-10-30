import { describe, expect, it } from 'vitest';
import { roomVersionMismatch } from './room';

describe('部屋の版の照合（作者の決定 2026年10月31日。07 の143章）', () => {
  it('同じ版なら入れる', () => {
    expect(roomVersionMismatch('0.2.1.1', '0.2.1.1')).toBe(false);
  });

  it('版が違えば入れない（ページを読み直していない人と新しく開いた人を同じ部屋に入れない）', () => {
    expect(roomVersionMismatch('0.2.1.0', '0.2.1.1')).toBe(true);
    expect(roomVersionMismatch('0.2.1.2', '0.2.1.1')).toBe(true);
  });

  it('部屋に版が無い（この仕組みより前のホスト）ときも入れない', () => {
    expect(roomVersionMismatch(undefined, '0.2.1.1')).toBe(true);
  });

  it('自分の版を渡さなければ比べない（テスト用）', () => {
    expect(roomVersionMismatch('0.2.1.0', undefined)).toBe(false);
    expect(roomVersionMismatch(undefined, undefined)).toBe(false);
  });
});
