import type { Rng } from './rng';

/**
 * ランダムな向きの単位ベクトル。
 * ブラウザごとに結果が変わりうる Math.sin/cos を使わず、棄却法と sqrt（結果が厳密に決まる）で作る。
 */
export function randomUnit(rng: Rng): [number, number] {
  for (;;) {
    const x = rng.range(-1, 1);
    const y = rng.range(-1, 1);
    const d2 = x * x + y * y;
    if (d2 > 1e-6 && d2 <= 1) {
      const d = Math.sqrt(d2);
      return [x / d, y / d];
    }
  }
}

/** 向き（各軸 -1/0/1）を単位ベクトルにする。(0,0) は (0,1) とみなす */
export function axisToUnit(ax: number, ay: number): [number, number] {
  if (ax === 0 && ay === 0) return [0, 1];
  if (ax !== 0 && ay !== 0) return [ax * Math.SQRT1_2, ay * Math.SQRT1_2];
  return [ax, ay];
}
