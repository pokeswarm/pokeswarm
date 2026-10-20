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

  constructor(readonly capacity: number) {
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
  }

  add(owner: PlayerId, x: number, y: number, vx: number, vy: number, life: number, damage: number, radius: number): number {
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
  }
}
