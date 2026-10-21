import type { PlayerId } from '../commands';

/** 当たり判定の動き方 */
export const MOTION_LINEAR = 0;
/** 持ち主からのずれを保って付いていく（近接） */
export const MOTION_FOLLOW = 1;
/** 持ち主の周りを回る */
export const MOTION_ORBIT = 2;
/** 飛んで、減速して戻ってくる */
export const MOTION_BOOMERANG = 3;
/** 一番近い敵を追いかける */
export const MOTION_HOMING = 4;
/** 放物線: 速さに重さ（angularSpeed を下向きの加速度に使う）を足して落ちる */
export const MOTION_LOB = 5;
/** 跳ね返り: 持ち主のまわりの枠（横 ox・縦 oy の半分の幅）の端で跳ね返る */
export const MOTION_BOUNCE = 6;
/**
 * 出し続ける流れ（stream）: 持ち主の位置から、向いている方向（から angle だけずらした向き）へ伸びる直線。
 * 向きは angularSpeed（ラジアン/秒）の速さで向いている方向へ回り、長さは障害物の手前まで（最大 orbitRadius）。
 * ox は流れの先の爆発までの残り秒数
 */
export const MOTION_STREAM = 7;

/** 当たり判定の形: 円（半径 radius） */
export const SHAPE_CIRCLE = 0;
/** 直線（始点 x, y から向き dir に長さ length、太さ radius） */
export const SHAPE_LINE = 1;
/** 扇形（中心 x, y から向き dir に半径 radius、開き length（片側の角度・ラジアン）。π 以上で円全体） */
export const SHAPE_SECTOR = 2;

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
  shape: number;
  /** SHAPE_LINE: 長さと向き（単位ベクトル） */
  length: number;
  dirX: number;
  dirY: number;
  /** 半径が1秒に広がる量（nova） */
  growth: number;
  /** 効き方の部品から出たもの（1）・遅れて弾ける印（2）。0 は技そのもの。0 のものだけが効き方を起こす（07 22.4） */
  stage?: number;
  /** 印（stage 2）が弾けるときに使う、技の効き方の番号 */
  fxIndex?: number;
  /** ノックバックの強さの上書き（ワールド単位/秒。マイナスで引き寄せる）。無ければ技の値 */
  knockback?: number;
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
  readonly shape: Uint8Array;
  readonly length: Float64Array;
  readonly dirX: Float64Array;
  readonly dirY: Float64Array;
  readonly growth: Float64Array;
  /** 出したときの残り時間（boomerang の戻りの計算に使う） */
  readonly maxLife: Float64Array;
  /** 当てた敵の id と当てた更新番号（発射体ごとに hitMemory 個の輪状の記録） */
  readonly hitIds: Uint32Array;
  readonly hitTicks: Uint32Array;
  /** これまでに記録した数（書き込み位置にも使う） */
  readonly hitCount: Uint32Array;
  /** 効き方の部品（07 22.4）: 段階・印の効き方の番号・繰り返しの残り秒数・当たったときの効き方を起こしたか・ノックバックの上書き（NaN なら技の値） */
  readonly stage: Uint8Array;
  readonly fxIndex: Uint8Array;
  readonly fxTimer: Float64Array;
  readonly hitFired: Uint8Array;
  readonly knockback: Float64Array;

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
    this.shape = new Uint8Array(capacity);
    this.length = new Float64Array(capacity);
    this.dirX = new Float64Array(capacity);
    this.dirY = new Float64Array(capacity);
    this.growth = new Float64Array(capacity);
    this.maxLife = new Float64Array(capacity);
    this.hitIds = new Uint32Array(capacity * hitMemory);
    this.hitTicks = new Uint32Array(capacity * hitMemory);
    this.hitCount = new Uint32Array(capacity);
    this.stage = new Uint8Array(capacity);
    this.fxIndex = new Uint8Array(capacity);
    this.fxTimer = new Float64Array(capacity);
    this.hitFired = new Uint8Array(capacity);
    this.knockback = new Float64Array(capacity);
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
    this.shape[i] = p.shape;
    this.length[i] = p.length;
    this.dirX[i] = p.dirX;
    this.dirY[i] = p.dirY;
    this.growth[i] = p.growth;
    this.maxLife[i] = p.life;
    this.hitCount[i] = 0;
    this.stage[i] = p.stage ?? 0;
    this.fxIndex[i] = p.fxIndex ?? 0;
    this.fxTimer[i] = 0;
    this.hitFired[i] = 0;
    this.knockback[i] = p.knockback ?? NaN;
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
    this.shape[i] = this.shape[last]!;
    this.length[i] = this.length[last]!;
    this.dirX[i] = this.dirX[last]!;
    this.dirY[i] = this.dirY[last]!;
    this.growth[i] = this.growth[last]!;
    this.maxLife[i] = this.maxLife[last]!;
    this.hitCount[i] = this.hitCount[last]!;
    this.stage[i] = this.stage[last]!;
    this.fxIndex[i] = this.fxIndex[last]!;
    this.fxTimer[i] = this.fxTimer[last]!;
    this.hitFired[i] = this.hitFired[last]!;
    this.knockback[i] = this.knockback[last]!;
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
