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
  /** ホストの位置の補正のうち、まだ寄せていないずれ（ゲストだけ使う） */
  readonly corrX: Float64Array;
  readonly corrY: Float64Array;
  readonly hp: Float64Array;
  readonly maxHp: Float64Array;
  readonly speed: Float64Array;
  readonly radius: Float64Array;
  /** プレイヤーに触れたときのダメージ */
  readonly damage: Float64Array;
  /** 移し替えた回数（移し替え先を決める番号に使う） */
  readonly relocations: Uint16Array;
  /** まっすぐ進む敵（スウォームの突進）の速度。0 ならプレイヤーを追う */
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  /** ノックバックの速さ（ワールド単位/秒）と残りの更新回数 */
  readonly kbVx: Float64Array;
  readonly kbVy: Float64Array;
  readonly kbTicks: Uint16Array;
  /** 状態異常の残りの更新回数。[敵の index × 状態異常の種類数 + 種類の番号] */
  readonly statusTicks: Uint16Array;
  /** 状態異常を付けたプレイヤー（継続ダメージで倒したときのとどめに使う） */
  readonly statusBy: Uint16Array;
  /**
   * ゲストが自分の攻撃で倒したと見込んで、先に消して見せている敵の、ホストの撃破の知らせを待つ残りの更新回数（0 なら待っていない）。
   * 待っている間は HP 0 のまま入れ物に残し（撃破の知らせで、ふつうに倒れる）、知らせが来なければ savedHp に戻して見せ直す
   */
  readonly ghostTicks: Uint16Array;
  readonly savedHp: Float64Array;
  /**
   * 遅れて爆発する印（みらいよち）: 残りの更新回数（0 なら印なし）・爆発のダメージ・大きさ・技の番号・付けたプレイヤー。
   * どのブラウザでも同じように数え、時間が来たら付けたプレイヤーの技として爆発させる（ダメージを決めるのは付けたプレイヤーのブラウザ）
   */
  readonly markTicks: Uint16Array;
  readonly markDamage: Float64Array;
  readonly markSize: Float64Array;
  readonly markMove: Int16Array;
  readonly markBy: Uint16Array;

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
    this.corrX = new Float64Array(capacity);
    this.corrY = new Float64Array(capacity);
    this.hp = new Float64Array(capacity);
    this.maxHp = new Float64Array(capacity);
    this.speed = new Float64Array(capacity);
    this.radius = new Float64Array(capacity);
    this.damage = new Float64Array(capacity);
    this.relocations = new Uint16Array(capacity);
    this.vx = new Float64Array(capacity);
    this.vy = new Float64Array(capacity);
    this.kbVx = new Float64Array(capacity);
    this.kbVy = new Float64Array(capacity);
    this.kbTicks = new Uint16Array(capacity);
    this.statusTicks = new Uint16Array(capacity * statusCount);
    this.statusBy = new Uint16Array(capacity * statusCount);
    this.ghostTicks = new Uint16Array(capacity);
    this.savedHp = new Float64Array(capacity);
    this.markTicks = new Uint16Array(capacity);
    this.markDamage = new Float64Array(capacity);
    this.markSize = new Float64Array(capacity);
    this.markMove = new Int16Array(capacity);
    this.markBy = new Uint16Array(capacity);
  }

  /** 追加して index を返す。満杯なら -1 */
  add(id: number, kind: number, x: number, y: number, hp: number, speed: number, radius: number, damage = 0, vx = 0, vy = 0): number {
    if (this.count >= this.capacity) return -1;
    const i = this.count++;
    this.id[i] = id;
    this.kind[i] = kind;
    this.x[i] = this.prevX[i] = x;
    this.y[i] = this.prevY[i] = y;
    this.corrX[i] = this.corrY[i] = 0;
    this.hp[i] = this.maxHp[i] = hp;
    this.speed[i] = speed;
    this.radius[i] = radius;
    this.damage[i] = damage;
    this.relocations[i] = 0;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.kbVx[i] = this.kbVy[i] = 0;
    this.kbTicks[i] = 0;
    this.statusTicks.fill(0, i * this.statusCount, (i + 1) * this.statusCount);
    this.ghostTicks[i] = 0;
    this.markTicks[i] = 0;
    return i;
  }

  /** index の敵を消し、末尾の敵をそこへ移す */
  /** 何かの状態異常にかかっているか */
  hasAnyStatus(i: number): boolean {
    const n = this.statusCount;
    for (let k = i * n; k < (i + 1) * n; k++) if (this.statusTicks[k]! > 0) return true;
    return false;
  }

  removeAt(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.id[i] = this.id[last]!;
    this.kind[i] = this.kind[last]!;
    this.x[i] = this.x[last]!;
    this.y[i] = this.y[last]!;
    this.prevX[i] = this.prevX[last]!;
    this.prevY[i] = this.prevY[last]!;
    this.corrX[i] = this.corrX[last]!;
    this.corrY[i] = this.corrY[last]!;
    this.hp[i] = this.hp[last]!;
    this.maxHp[i] = this.maxHp[last]!;
    this.speed[i] = this.speed[last]!;
    this.radius[i] = this.radius[last]!;
    this.damage[i] = this.damage[last]!;
    this.relocations[i] = this.relocations[last]!;
    this.vx[i] = this.vx[last]!;
    this.vy[i] = this.vy[last]!;
    this.kbVx[i] = this.kbVx[last]!;
    this.kbVy[i] = this.kbVy[last]!;
    this.kbTicks[i] = this.kbTicks[last]!;
    this.ghostTicks[i] = this.ghostTicks[last]!;
    this.savedHp[i] = this.savedHp[last]!;
    this.markTicks[i] = this.markTicks[last]!;
    this.markDamage[i] = this.markDamage[last]!;
    this.markSize[i] = this.markSize[last]!;
    this.markMove[i] = this.markMove[last]!;
    this.markBy[i] = this.markBy[last]!;
    const n = this.statusCount;
    this.statusTicks.copyWithin(i * n, last * n, (last + 1) * n);
    this.statusBy.copyWithin(i * n, last * n, (last + 1) * n);
  }

  /** HP が 0 以下の敵をまとめて取り除く（順番は決まった手順で変わるので再現できる）。撃破の知らせを待っている敵（ゲスト）は残す */
  removeDead(): void {
    for (let i = this.count - 1; i >= 0; i--) {
      if (this.hp[i]! <= 0 && this.ghostTicks[i] === 0) this.removeAt(i);
    }
  }

  /** ゲスト: 先に消して見せた敵の待ち時間を減らし、撃破の知らせが来ないまま時間が切れたら見せ直す */
  stepGhosts(): void {
    for (let i = 0; i < this.count; i++) {
      if (this.ghostTicks[i] === 0) continue;
      this.ghostTicks[i]!--;
      if (this.ghostTicks[i] === 0 && this.hp[i]! <= 0) this.hp[i] = Math.max(1, this.savedHp[i]!);
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
