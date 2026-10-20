import { describe, expect, it } from 'vitest';
import { Rng } from '../rng';
import { SpatialHash } from './spatialHash';

describe('SpatialHash', () => {
  it('矩形の中にある要素を取りこぼさない（総当たりと比べる）', () => {
    const rng = new Rng(3);
    const n = 2000;
    const xs = Array.from({ length: n }, () => rng.range(-3000, 3000));
    const ys = Array.from({ length: n }, () => rng.range(-3000, 3000));
    const hash = new SpatialHash(64, n);
    for (let i = 0; i < n; i++) hash.insert(i, xs[i]!, ys[i]!);
    const out = new Int32Array(n * 2);
    for (let q = 0; q < 50; q++) {
      const x = rng.range(-3000, 3000);
      const y = rng.range(-3000, 3000);
      const r = rng.range(10, 400);
      const found = new Set(Array.from(out.subarray(0, hash.queryRect(x - r, y - r, x + r, y + r, out))));
      for (let i = 0; i < n; i++) {
        if (Math.abs(xs[i]! - x) <= r && Math.abs(ys[i]! - y) <= r) expect(found.has(i)).toBe(true);
      }
    }
  });
});
