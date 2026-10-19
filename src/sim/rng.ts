/**
 * シード付き乱数（sfc32）。
 * 整数演算だけで作るので、どのブラウザでも同じ列になる。
 * 状態を取り出して送れば、別のブラウザで続きを再現できる。
 */
export type RngState = readonly [number, number, number, number];

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    // splitmix32 でシードを4つの状態に広げる
    let s = seed >>> 0;
    const next = (): number => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
  }

  /** 32bit の符号なし整数 */
  nextUint32(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t;
  }

  /** [0, 1) の小数 */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** [0, n) の整数 */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** [min, max) の小数 */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  getState(): RngState {
    return [this.a, this.b, this.c, this.d];
  }

  setState(state: RngState): void {
    [this.a, this.b, this.c, this.d] = state;
  }
}
