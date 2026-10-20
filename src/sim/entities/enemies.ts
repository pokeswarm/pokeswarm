/**
 * 雑魚敵の集まり。オブジェクトの配列ではなく、項目ごとの型付き配列で持つ。
 * 生きている敵は先頭から count 個に詰めて並べる（倒れたら末尾と入れ替える）。
 * 並び順が変わるので、外部（通信など）から指すときは index ではなく id を使う。
 */
export class EnemyStore {
  count = 0;
  readonly id: Uint32Array;
  readonly kind: Uint16Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly prevX: Float64Array;
  readonly prevY: Float64Array;
  readonly hp: Float64Array;
  readonly maxHp: Float64Array;
  readonly speed: Float64Array;
  readonly radius: Float64Array;
  /** 上限到達時の強化段階 */
  readonly empower: Uint8Array;
  /** 移し替えた回数（移し替え先を決める番号に使う） */
  readonly relocations: Uint16Array;

  constructor(readonly capacity: number) {
    this.id = new Uint32Array(capacity);
    this.kind = new Uint16Array(capacity);
    this.x = new Float64Array(capacity);
    this.y = new Float64Array(capacity);
    this.prevX = new Float64Array(capacity);
    this.prevY = new Float64Array(capacity);
    this.hp = new Float64Array(capacity);
    this.maxHp = new Float64Array(capacity);
    this.speed = new Float64Array(capacity);
    this.radius = new Float64Array(capacity);
    this.empower = new Uint8Array(capacity);
    this.relocations = new Uint16Array(capacity);
  }

  /** 追加して index を返す。満杯なら -1 */
  add(id: number, kind: number, x: number, y: number, hp: number, speed: number, radius: number): number {
    if (this.count >= this.capacity) return -1;
    const i = this.count++;
    this.id[i] = id;
    this.kind[i] = kind;
    this.x[i] = this.prevX[i] = x;
    this.y[i] = this.prevY[i] = y;
    this.hp[i] = this.maxHp[i] = hp;
    this.speed[i] = speed;
    this.radius[i] = radius;
    this.empower[i] = 0;
    this.relocations[i] = 0;
    return i;
  }

  /** index の敵を消し、末尾の敵をそこへ移す */
  removeAt(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.id[i] = this.id[last]!;
    this.kind[i] = this.kind[last]!;
    this.x[i] = this.x[last]!;
    this.y[i] = this.y[last]!;
    this.prevX[i] = this.prevX[last]!;
    this.prevY[i] = this.prevY[last]!;
    this.hp[i] = this.hp[last]!;
    this.maxHp[i] = this.maxHp[last]!;
    this.speed[i] = this.speed[last]!;
    this.radius[i] = this.radius[last]!;
    this.empower[i] = this.empower[last]!;
    this.relocations[i] = this.relocations[last]!;
  }

  /** HP が 0 以下の敵をまとめて取り除く（順番は決まった手順で変わるので再現できる） */
  removeDead(): void {
    for (let i = this.count - 1; i >= 0; i--) {
      if (this.hp[i]! <= 0) this.removeAt(i);
    }
  }
}
