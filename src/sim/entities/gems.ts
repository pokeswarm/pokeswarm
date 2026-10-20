/**
 * 経験値の玉の集まり。敵と同じく型付き配列で持ち、先頭から count 個に詰める。
 * 玉の id はホストが決め、協力プレイでは id で指す。
 */
export class GemStore {
  count = 0;
  readonly id: Uint32Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly prevX: Float64Array;
  readonly prevY: Float64Array;
  readonly value: Float64Array;
  /** 描画用の大きさ */
  readonly radius: Float64Array;
  /** 一度吸い寄せられ始めたら、取得範囲の外に出ても追いかける */
  readonly attracted: Uint8Array;
  /** ゲスト: 自分が触れてホストの確定を待っている（自分の画面では消して見せる） */
  readonly pending: Uint8Array;

  constructor(readonly capacity: number) {
    this.id = new Uint32Array(capacity);
    this.x = new Float64Array(capacity);
    this.y = new Float64Array(capacity);
    this.prevX = new Float64Array(capacity);
    this.prevY = new Float64Array(capacity);
    this.value = new Float64Array(capacity);
    this.radius = new Float64Array(capacity);
    this.attracted = new Uint8Array(capacity);
    this.pending = new Uint8Array(capacity);
  }

  add(id: number, x: number, y: number, value: number, radius: number): number {
    if (this.count >= this.capacity) return -1;
    const i = this.count++;
    this.id[i] = id;
    this.x[i] = this.prevX[i] = x;
    this.y[i] = this.prevY[i] = y;
    this.value[i] = value;
    this.radius[i] = radius;
    this.attracted[i] = 0;
    this.pending[i] = 0;
    return i;
  }

  removeAt(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.id[i] = this.id[last]!;
    this.x[i] = this.x[last]!;
    this.y[i] = this.y[last]!;
    this.prevX[i] = this.prevX[last]!;
    this.prevY[i] = this.prevY[last]!;
    this.value[i] = this.value[last]!;
    this.radius[i] = this.radius[last]!;
    this.attracted[i] = this.attracted[last]!;
    this.pending[i] = this.pending[last]!;
  }

  indexOf(id: number): number {
    for (let i = 0; i < this.count; i++) if (this.id[i] === id) return i;
    return -1;
  }

  /** 一番古い（id が一番小さい）玉の index。無ければ -1 */
  oldest(): number {
    let best = -1;
    for (let i = 0; i < this.count; i++) if (best === -1 || this.id[i]! < this.id[best]!) best = i;
    return best;
  }
}
