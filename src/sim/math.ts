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

/**
 * 番号の組から決まる [0, 1) の値。共有の乱数列を進めないので、
 * ホストとゲストで乱数の使い方が違っても、同じ敵・同じ更新なら同じ値になる。
 */
export function hash01(seed: number, a: number, b: number, salt: number): number {
  let h = seed >>> 0;
  for (const v of [a, b, salt]) {
    h = Math.imul(h ^ (v >>> 0), 0x85ebca6b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
  }
  return h / 4294967296;
}
