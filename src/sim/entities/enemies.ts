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
  /** プレイヤーに触れたときのダメージ */
  readonly damage: Float64Array;
  /** 移し替えた回数（移し替え先を決める番号に使う） */
  readonly relocations: Uint16Array;
  /** ノックバックの速さ（ワールド単位/秒）と残りの更新回数 */
  readonly kbVx: Float64Array;
  readonly kbVy: Float64Array;
  readonly kbTicks: Uint16Array;
  /** 状態異常の残りの更新回数。[敵の index × 状態異常の種類数 + 種類の番号] */
  readonly statusTicks: Uint16Array;
  /** 状態異常を付けたプレイヤー（継続ダメージで倒したときのとどめに使う） */
  readonly statusBy: Uint16Array;

  constructor(
    readonly capacity: number,
    /** 状態異常の種類の数 */
    readonly statusCount: number,
  ) {
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
    this.damage = new Float64Array(capacity);
    this.relocations = new Uint16Array(capacity);
    this.kbVx = new Float64Array(capacity);
    this.kbVy = new Float64Array(capacity);
    this.kbTicks = new Uint16Array(capacity);
    this.statusTicks = new Uint16Array(capacity * statusCount);
    this.statusBy = new Uint16Array(capacity * statusCount);
  }

  /** 追加して index を返す。満杯なら -1 */
  add(id: number, kind: number, x: number, y: number, hp: number, speed: number, radius: number, damage = 0): number {
    if (this.count >= this.capacity) return -1;
    const i = this.count++;
    this.id[i] = id;
    this.kind[i] = kind;
    this.x[i] = this.prevX[i] = x;
    this.y[i] = this.prevY[i] = y;
    this.hp[i] = this.maxHp[i] = hp;
    this.speed[i] = speed;
    this.radius[i] = radius;
    this.damage[i] = damage;
    this.relocations[i] = 0;
    this.kbVx[i] = this.kbVy[i] = 0;
    this.kbTicks[i] = 0;
    this.statusTicks.fill(0, i * this.statusCount, (i + 1) * this.statusCount);
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
    this.damage[i] = this.damage[last]!;
    this.relocations[i] = this.relocations[last]!;
    this.kbVx[i] = this.kbVx[last]!;
    this.kbVy[i] = this.kbVy[last]!;
    this.kbTicks[i] = this.kbTicks[last]!;
    const n = this.statusCount;
    this.statusTicks.copyWithin(i * n, last * n, (last + 1) * n);
    this.statusBy.copyWithin(i * n, last * n, (last + 1) * n);
  }

  /** HP が 0 以下の敵をまとめて取り除く（順番は決まった手順で変わるので再現できる） */
  removeDead(): void {
    for (let i = this.count - 1; i >= 0; i--) {
      if (this.hp[i]! <= 0) this.removeAt(i);
    }
  }

  /** ノックバックを付ける（前のものは上書き） */
  knockBack(i: number, vx: number, vy: number, ticks: number): void {
    if (ticks <= 0) return;
    this.kbVx[i] = vx;
    this.kbVy[i] = vy;
    this.kbTicks[i] = Math.min(ticks, 0xffff);
  }

  /** 状態異常を付ける。同じものが付いていれば、残り時間の長いほうにする（重ねがけで強くしない） */
  applyStatus(i: number, status: number, ticks: number, by: number): void {
    const k = i * this.statusCount + status;
    if (ticks > this.statusTicks[k]!) {
      this.statusTicks[k] = Math.min(ticks, 0xffff);
      this.statusBy[k] = by;
    }
  }

  hasStatus(i: number, status: number): boolean {
    return this.statusTicks[i * this.statusCount + status]! > 0;
  }
}
