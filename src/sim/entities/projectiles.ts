import type { PlayerId } from '../commands';

/** 発射体の集まり。敵と同じく型付き配列で持ち、先頭から count 個に詰める */
export class ProjectileStore {
  count = 0;
  readonly owner: Uint16Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly prevX: Float64Array;
  readonly prevY: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  /** 残り時間（秒） */
  readonly life: Float64Array;
  readonly damage: Float64Array;
  readonly radius: Float64Array;
  /** 残りの貫通可能数（無限は Infinity） */
  readonly pierceLeft: Float64Array;
  /** 当てた敵の id（発射体ごとに hitMemory 個の輪状の記録） */
  readonly hitIds: Uint32Array;
  /** これまでに当てた数（記録の書き込み位置にも使う） */
  readonly hitCount: Uint32Array;

  constructor(
    readonly capacity: number,
    readonly hitMemory: number,
  ) {
    this.owner = new Uint16Array(capacity);
    this.x = new Float64Array(capacity);
    this.y = new Float64Array(capacity);
    this.prevX = new Float64Array(capacity);
    this.prevY = new Float64Array(capacity);
    this.vx = new Float64Array(capacity);
    this.vy = new Float64Array(capacity);
    this.life = new Float64Array(capacity);
    this.damage = new Float64Array(capacity);
    this.radius = new Float64Array(capacity);
    this.pierceLeft = new Float64Array(capacity);
    this.hitIds = new Uint32Array(capacity * hitMemory);
    this.hitCount = new Uint32Array(capacity);
  }

  add(
    owner: PlayerId,
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    damage: number,
    radius: number,
    pierce: number,
  ): number {
    if (this.count >= this.capacity) return -1;
    const i = this.count++;
    this.owner[i] = owner;
    this.x[i] = this.prevX[i] = x;
    this.y[i] = this.prevY[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.damage[i] = damage;
    this.radius[i] = radius;
    this.pierceLeft[i] = pierce;
    this.hitCount[i] = 0;
    return i;
  }

  removeAt(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.owner[i] = this.owner[last]!;
    this.x[i] = this.x[last]!;
    this.y[i] = this.y[last]!;
    this.prevX[i] = this.prevX[last]!;
    this.prevY[i] = this.prevY[last]!;
    this.vx[i] = this.vx[last]!;
    this.vy[i] = this.vy[last]!;
    this.life[i] = this.life[last]!;
    this.damage[i] = this.damage[last]!;
    this.radius[i] = this.radius[last]!;
    this.pierceLeft[i] = this.pierceLeft[last]!;
    this.hitCount[i] = this.hitCount[last]!;
    this.hitIds.copyWithin(i * this.hitMemory, last * this.hitMemory, (last + 1) * this.hitMemory);
  }

  /** この発射体がすでに当てた敵か */
  hasHit(i: number, enemyId: number): boolean {
    const base = i * this.hitMemory;
    const n = Math.min(this.hitCount[i]!, this.hitMemory);
    for (let k = 0; k < n; k++) if (this.hitIds[base + k] === enemyId) return true;
    return false;
  }

  /** 当てた敵を記録する（一杯なら古いものを上書き） */
  recordHit(i: number, enemyId: number): void {
    this.hitIds[i * this.hitMemory + (this.hitCount[i]! % this.hitMemory)] = enemyId;
    this.hitCount[i]!++;
  }
}
