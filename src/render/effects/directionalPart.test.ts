import { describe, expect, it } from 'vitest';
import { directionalPart } from './MoveSprites';

describe('向きで描き分ける技の絵（かみつく。07 の69章）', () => {
  it('8方向: 右は横、下は正面、上は後ろ、斜めは斜め。左側は左右を返す', () => {
    const s = Math.SQRT1_2;
    expect(directionalPart(1, 0)).toEqual({ name: 'main', flip: false });
    expect(directionalPart(-1, 0)).toEqual({ name: 'main', flip: true });
    expect(directionalPart(0, 1).name).toBe('front');
    expect(directionalPart(0, -1).name).toBe('back');
    expect(directionalPart(s, s)).toEqual({ name: 'diag', flip: false });
    expect(directionalPart(-s, s)).toEqual({ name: 'diag', flip: true });
    expect(directionalPart(s, -s)).toEqual({ name: 'diagBack', flip: false });
  });
});
