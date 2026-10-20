import type { PlayerId } from '../commands';

/** 当たり判定の動き方 */
export const MOTION_LINEAR = 0;
/** 持ち主からのずれを保って付いていく（近接） */
export const MOTION_FOLLOW = 1;
/** 持ち主の周りを回る */
export const MOTION_ORBIT = 2;

export interface ProjectileSpawn {
  owner: PlayerId;
  /** 技の番号とレベル（効果・見た目を引くため） */
  move: number;
  level: number;
  motion: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** MOTION_FOLLOW: 持ち主からのずれ */
  ox: number;
  oy: number;
  /** MOTION_ORBIT: 角度（ラジアン）・角速度（ラジアン/秒）・半径 */
  angle: number;
  angularSpeed: number;
  orbitRadius: number;
  /** 残り時間（秒） */
  life: number;
  /** タイプ相性などを掛ける前のダメージ */
  damage: number;
  radius: number;
  pierce: number;
  /** 同じ敵に当たり直すまでの更新回数。0 なら1回だけ */
  hitIntervalTicks: number;
}

/**
 * 発射体・攻撃の当たり判定の集まり。型付き配列で持ち、先頭から count 個に詰める。
 * 飛ぶ弾だけでなく、近接攻撃や周りを回る炎などの「一定時間残る当たり判定」も同じ形で扱う。
 */
export class ProjectileStore {
  count = 0;
  readonly owner: Uint16Array;
  readonly move: Uint16Array;
  readonly level: Uint8Array;
  readonly motion: Uint8Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly prevX: Float64Array;
  readonly prevY: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly ox: Float64Array;
  readonly oy: Float64Array;
  readonly angle: Float64Array;
  readonly angularSpeed: Float64Array;
  readonly orbitRadius: Float64Array;
  readonly life: Float64Array;
  readonly damage: Float64Array;
  readonly radius: Float64Array;
  /** 残りの貫通可能数（無限は Infinity） */
  readonly pierceLeft: Float64Array;
  readonly hitIntervalTicks: Uint16Array;
  /** 当てた敵の id と当てた更新番号（発射体ごとに hitMemory 個の輪状の記録） */
  readonly hitIds: Uint32Array;
  readonly hitTicks: Uint32Array;
  /** これまでに記録した数（書き込み位置にも使う） */
  readonly hitCount: Uint32Array;

  constructor(
    readonly capacity: number,
    readonly hitMemory: number,
  ) {
    this.owner = new Uint16Array(capacity);
    this.move = new Uint16Array(capacity);
    this.level = new Uint8Array(capacity);
    this.motion = new Uint8Array(capacity);
    this.x = new Float64Array(capacity);
    this.y = new Float64Array(capacity);
    this.prevX = new Float64Array(capacity);
    this.prevY = new Float64Array(capacity);
    this.vx = new Float64Array(capacity);
    this.vy = new Float64Array(capacity);
    this.ox = new Float64Array(capacity);
    this.oy = new Float64Array(capacity);
    this.angle = new Float64Array(capacity);
    this.angularSpeed = new Float64Array(capacity);
    this.orbitRadius = new Float64Array(capacity);
    this.life = new Float64Array(capacity);
    this.damage = new Float64Array(capacity);
    this.radius = new Float64Array(capacity);
    this.pierceLeft = new Float64Array(capacity);
    this.hitIntervalTicks = new Uint16Array(capacity);
    this.hitIds = new Uint32Array(capacity * hitMemory);
    this.hitTicks = new Uint32Array(capacity * hitMemory);
    this.hitCount = new Uint32Array(capacity);
  }

  add(p: ProjectileSpawn): number {
    if (this.count >= this.capacity) return -1;
    const i = this.count++;
    this.owner[i] = p.owner;
    this.move[i] = p.move;
    this.level[i] = p.level;
    this.motion[i] = p.motion;
    this.x[i] = this.prevX[i] = p.x;
    this.y[i] = this.prevY[i] = p.y;
    this.vx[i] = p.vx;
    this.vy[i] = p.vy;
    this.ox[i] = p.ox;
    this.oy[i] = p.oy;
    this.angle[i] = p.angle;
    this.angularSpeed[i] = p.angularSpeed;
    this.orbitRadius[i] = p.orbitRadius;
    this.life[i] = p.life;
    this.damage[i] = p.damage;
    this.radius[i] = p.radius;
    this.pierceLeft[i] = p.pierce;
    this.hitIntervalTicks[i] = Math.min(p.hitIntervalTicks, 0xffff);
    this.hitCount[i] = 0;
    return i;
  }

  removeAt(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.owner[i] = this.owner[last]!;
    this.move[i] = this.move[last]!;
    this.level[i] = this.level[last]!;
    this.motion[i] = this.motion[last]!;
    this.x[i] = this.x[last]!;
    this.y[i] = this.y[last]!;
    this.prevX[i] = this.prevX[last]!;
    this.prevY[i] = this.prevY[last]!;
    this.vx[i] = this.vx[last]!;
    this.vy[i] = this.vy[last]!;
    this.ox[i] = this.ox[last]!;
    this.oy[i] = this.oy[last]!;
    this.angle[i] = this.angle[last]!;
    this.angularSpeed[i] = this.angularSpeed[last]!;
    this.orbitRadius[i] = this.orbitRadius[last]!;
    this.life[i] = this.life[last]!;
    this.damage[i] = this.damage[last]!;
    this.radius[i] = this.radius[last]!;
    this.pierceLeft[i] = this.pierceLeft[last]!;
    this.hitIntervalTicks[i] = this.hitIntervalTicks[last]!;
    this.hitCount[i] = this.hitCount[last]!;
    const m = this.hitMemory;
    this.hitIds.copyWithin(i * m, last * m, (last + 1) * m);
    this.hitTicks.copyWithin(i * m, last * m, (last + 1) * m);
  }

  /**
   * この攻撃が今その敵に当たれないか（もう当てた・当たり直しの間隔がまだ来ていない）。
   * hitIntervalTicks が 0 なら、一度当てた敵には二度と当たらない。
   */
  isBlocked(i: number, enemyId: number, tick: number): boolean {
    const base = i * this.hitMemory;
    const n = Math.min(this.hitCount[i]!, this.hitMemory);
    const interval = this.hitIntervalTicks[i]!;
    for (let k = 0; k < n; k++) {
      if (this.hitIds[base + k] !== enemyId) continue;
      if (interval === 0) return true;
      if (tick - this.hitTicks[base + k]! < interval) return true;
    }
    return false;
  }

  /** 当てた敵を記録する（同じ敵の記録があれば更新番号を上書き、無ければ追加。一杯なら古いものを上書き） */
  recordHit(i: number, enemyId: number, tick: number): void {
    const base = i * this.hitMemory;
    const n = Math.min(this.hitCount[i]!, this.hitMemory);
    for (let k = 0; k < n; k++) {
      if (this.hitIds[base + k] === enemyId) {
        this.hitTicks[base + k] = tick;
        return;
      }
    }
    const slot = base + (this.hitCount[i]! % this.hitMemory);
    this.hitIds[slot] = enemyId;
    this.hitTicks[slot] = tick;
    this.hitCount[i]!++;
  }
}
