import { describe, expect, it } from 'vitest';
import { Rng } from './rng';

describe('Rng', () => {
  it('同じシードなら同じ列になる', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 1000; i++) expect(a.nextUint32()).toBe(b.nextUint32());
  });

  it('状態を移すと続きが一致する', () => {
    const a = new Rng(7);
    for (let i = 0; i < 10; i++) a.next();
    const b = new Rng(0);
    b.setState(a.getState());
    for (let i = 0; i < 100; i++) expect(b.next()).toBe(a.next());
  });

  it('next() は [0, 1) に収まる', () => {
    const r = new Rng(1);
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
