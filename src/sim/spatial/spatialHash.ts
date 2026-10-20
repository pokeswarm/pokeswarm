/**
 * 空間ハッシュ。平面を格子に区切り、各マスに入っている要素の番号を連結リストで持つ。
 * 毎回の更新で clear → insert し直す前提。メモリは作成時に確保し、更新中は確保しない。
 *
 * マスの座標はハッシュ表に畳み込むため、別のマスの要素が候補に混ざることがある。
 * 呼び出し側で必ず距離を確かめること。
 */
export class SpatialHash {
  private readonly heads: Int32Array;
  private readonly next: Int32Array;
  private readonly mask: number;
  private readonly invCell: number;

  constructor(
    readonly cellSize: number,
    capacity: number,
    tableSizeLog2 = 12,
  ) {
    this.heads = new Int32Array(1 << tableSizeLog2).fill(-1);
    this.next = new Int32Array(capacity).fill(-1);
    this.mask = (1 << tableSizeLog2) - 1;
    this.invCell = 1 / cellSize;
  }

  clear(): void {
    this.heads.fill(-1);
  }

  private bucket(cx: number, cy: number): number {
    return (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) & this.mask;
  }

  insert(index: number, x: number, y: number): void {
    const b = this.bucket(Math.floor(x * this.invCell), Math.floor(y * this.invCell));
    this.next[index] = this.heads[b]!;
    this.heads[b] = index;
  }

  /**
   * 矩形と重なるマスの要素を out に書き出し、個数を返す（out が一杯になったら打ち切る）。
   * ハッシュの衝突で同じ要素が2回入ることがある。
   */
  queryRect(minX: number, minY: number, maxX: number, maxY: number, out: Int32Array): number {
    const cx0 = Math.floor(minX * this.invCell);
    const cy0 = Math.floor(minY * this.invCell);
    const cx1 = Math.floor(maxX * this.invCell);
    const cy1 = Math.floor(maxY * this.invCell);
    let n = 0;
    const cap = out.length;
    // 表の大きさを超える範囲を聞かれても、同じバケットを何度も回らないようにする
    const spanX = Math.min(cx1 - cx0, this.mask);
    const spanY = Math.min(cy1 - cy0, this.mask);
    for (let cy = cy0; cy <= cy0 + spanY; cy++) {
      for (let cx = cx0; cx <= cx0 + spanX; cx++) {
        let i = this.heads[this.bucket(cx, cy)]!;
        while (i !== -1) {
          if (n >= cap) return n;
          out[n++] = i;
          i = this.next[i]!;
        }
      }
    }
    return n;
  }
}
