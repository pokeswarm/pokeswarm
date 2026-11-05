import Phaser from 'phaser';
import type { World } from '../../sim/world';

/** 絵の 1 ドット（ワールドの単位） */
const DOT = 2;
/** 足元の位置（体の中心からの下へのずれ。ワールドの単位） */
const FOOT_Y = 58;
/** 走るときの足跡の間隔（ワールドの単位）と、左右のずれ */
const STEP = 96;
const STEP_SIDE = 16;
/** 波紋の広がる半径（ワールドの単位）・消えるまでの秒数・コマ数 */
const RIPPLE_R = 120;
const RIPPLE_S = 1.1;
const RIPPLE_FRAMES = 11;
/** 走り出しと止まるときの波紋の大きさの倍率 */
const KICK_SCALE = 1.6;
/** これより速く動いていれば走っている（ふだん歩く速さより上。ワールドの単位/秒）。1 回の更新でこれ以上動いたら位置の補正で、足跡を付けない */
const RUN_SPEED = 260;
const TELEPORT = 200;
/** 立っているときの波紋の間隔（秒） */
const IDLE_S = 1.5;
const IDLE_SCALE = 0.65;
/** 足跡をつなぐ水の筋の消える秒数 */
const TRAIL_S = 0.7;
/** しぶきの秒数・重さ（ワールドの単位/秒²） */
const DROP_S = 0.5;
const DROP_GRAVITY = 900;
/** 同時に出す数の上限（古いものから使い回す） */
const MAX_RIPPLES = 24;
const MAX_TRAILS = 16;
const MAX_DROPS = 36;

const abgr = (r: number, g: number, b: number, a: number): number => ((Math.round(Math.max(0, Math.min(1, a)) * 255) << 24) | (b << 16) | (g << 8) | r) >>> 0;

/** 決まった乱数（0〜1） */
function rnd(a: number, b: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

interface Ripple {
  x: number;
  y: number;
  born: number;
  scale: number;
  flip: boolean;
}
interface Trail {
  x: number;
  y: number;
  born: number;
  angle: number;
  length: number;
}
interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rise: number;
  born: number;
}

/**
 * 水の上を走る（スイクン。07 の225章）: 足元に波紋が広がり、足跡を水の筋がつなぎ、しぶきが上がる。
 * 速く走ると波紋が重なって航跡の V 字になる。止まっているときは足元に小さな波紋。地面の一部なので雑魚より下に描く。見た目だけ
 */
export class WaterRun {
  private readonly rippleImages: Phaser.GameObjects.Image[] = [];
  private readonly trailImages: Phaser.GameObjects.Image[] = [];
  private readonly dropImages: Phaser.GameObjects.Image[] = [];
  private readonly ripples: (Ripple | null)[] = [];
  private readonly trails: (Trail | null)[] = [];
  private readonly drops: (Drop | null)[] = [];
  private nextRipple = 0;
  private nextTrail = 0;
  private nextDrop = 0;
  private built = false;
  private lastX = NaN;
  private lastY = NaN;
  private lastStepX = 0;
  private lastStepY = 0;
  private travelled = 0;
  private footSide = 1;
  private running = false;
  private lastIdle = -1e9;
  private lastTick = 0;
  private slowTicks = 0;
  private dropSeed = 0;
  private arena: World['arena'] = null;

  constructor(
    private readonly scene: Phaser.Scene,
    /** 地面の深さ */
    private readonly groundDepth: number,
    /** しぶきの深さ（体の少し後ろ） */
    private readonly dropDepth: number,
  ) {}

  private paint(key: string, w: number, h: number, draw: (out: Uint32Array) => void): void {
    const tx = this.scene.textures;
    if (tx.exists(key)) tx.remove(key);
    const c = tx.createCanvas(key, w, h)!;
    const ctx = c.getContext();
    const img = ctx.createImageData(w, h);
    draw(new Uint32Array(img.data.buffer));
    ctx.putImageData(img, 0, 0);
    c.refresh();
  }

  private build(): void {
    if (this.built) return;
    this.built = true;
    // 波紋: 奥行きを出すため縦につぶした輪。外の輪と、遅れて続く内の輪。輪は所々で切れる
    const w = Math.ceil((RIPPLE_R * 2) / DOT) + 4;
    const h = Math.ceil(w * 0.5) + 4;
    const cx = (w - 1) / 2;
    const cy = (h - 1) / 2;
    const maxR = RIPPLE_R / DOT;
    for (let f = 0; f < RIPPLE_FRAMES; f++) {
      const t = (f + 0.5) / RIPPLE_FRAMES;
      // 最初は速く広がり、だんだんゆっくり
      const outer = maxR * (1 - (1 - t) * (1 - t));
      const inner = outer * 0.62;
      const fade = 1 - t;
      this.paint(`water-ripple-${f}`, w, h, (out) => {
        const ring = (x: number, y: number, r: number, width: number, strength: number, salt: number): void => {
          const dx = x - cx;
          const dy = (y - cy) * 2;
          const d = Math.hypot(dx, dy);
          if (Math.abs(d - r) > width) return;
          const a = Math.atan2(dy, dx);
          // 広がるほど切れ目が増える
          const piece = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 18);
          if (rnd(piece, salt) < t * 0.55) return;
          const i = y * w + x;
          const lower = dy > 0;
          // 手前は明るく、向こうは少し沈む
          out[i] = lower ? abgr(226, 248, 255, 0.95 * strength) : abgr(166, 222, 244, 0.75 * strength);
          // 輪の下に影の線
          const below = (y + 1) * w + x;
          if (y + 1 < h && !out[below]) out[below] = abgr(18, 66, 104, 0.4 * strength);
        };
        for (let y = 0; y < h - 1; y++) {
          for (let x = 0; x < w; x++) {
            // 踏んだ直後は、足元の水がへこんで白く光る
            if (t < 0.28) {
              const d = Math.hypot(x - cx, (y - cy) * 2);
              if (d < outer * 0.6) out[y * w + x] = abgr(206, 240, 252, 0.4 * (1 - t / 0.28));
            }
            ring(x, y, inner, Math.max(0.6, 1.3 * fade), 0.6 * fade, 3);
            ring(x, y, outer, Math.max(0.7, 1.9 * fade), fade, 2);
          }
        }
      });
    }
    // 足跡をつなぐ水の筋: 右が進む先。後ろへ細くほどける
    const tw = 64;
    const th = 7;
    this.paint('water-trail', tw, th, (out) => {
      for (let y = 0; y < th; y++) {
        for (let x = 0; x < tw; x++) {
          const u = x / (tw - 1);
          const half = 0.6 + u * 2.6;
          const d = Math.abs(y - (th - 1) / 2);
          if (d > half) continue;
          if (rnd(x >> 1, y) > 0.35 + u * 0.75) continue;
          out[y * tw + x] = d < half * 0.45 ? abgr(236, 250, 255, 0.85) : abgr(146, 208, 236, 0.6);
        }
      }
    });
    // しぶきの粒
    this.paint('water-drop', 3, 4, (out) => {
      const col = abgr(238, 251, 255, 1);
      const side = abgr(120, 190, 226, 1);
      out[1] = col;
      out[3] = col;
      out[4] = col;
      out[5] = side;
      out[6] = col;
      out[7] = col;
      out[8] = side;
      out[10] = side;
    });
  }

  private addRipple(x: number, y: number, now: number, scale: number): void {
    if (!this.onFloor(x, y)) return;
    this.ripples[this.nextRipple] = { x, y, born: now, scale, flip: this.nextRipple % 2 === 0 };
    this.nextRipple = (this.nextRipple + 1) % MAX_RIPPLES;
  }

  private addDrops(x: number, y: number, now: number, count: number, dirX: number, dirY: number, power: number): void {
    if (!this.onFloor(x, y)) return;
    for (let k = 0; k < count; k++) {
      const seed = this.dropSeed++;
      const a = rnd(seed, 51) * Math.PI * 2;
      const spread = 40 + rnd(seed, 52) * 80;
      this.drops[this.nextDrop] = {
        x,
        y,
        // 走る向きの逆へ少し飛ぶ
        vx: (Math.cos(a) * spread - dirX * 90) * power,
        vy: (Math.sin(a) * spread * 0.5 - dirY * 50) * power,
        rise: (170 + rnd(seed, 53) * 170) * power,
        born: now,
      };
      this.nextDrop = (this.nextDrop + 1) % MAX_DROPS;
    }
  }

  /** マップの床の上か（逃げてマップの外へ出た後は何も出さない） */
  private onFloor(x: number, y: number): boolean {
    const a = this.arena;
    return !!a && Math.abs(x - a.x) <= a.halfWidth && Math.abs(y - a.y) <= a.halfHeight;
  }

  private hideAll(): void {
    for (const img of this.rippleImages) img.setVisible(false);
    for (const img of this.trailImages) img.setVisible(false);
    for (const img of this.dropImages) img.setVisible(false);
    this.ripples.length = 0;
    this.trails.length = 0;
    this.drops.length = 0;
    this.lastX = NaN;
    this.running = false;
  }

  /** 水の上を走る敵（ゲストは world.bosses を持たないので、敵の種類で探す） */
  private findRunner(world: World): number {
    if (!world.arena) return -1;
    const sets = world.rules.stage.legendary?.moveSets;
    const kinds = world.rules.enemies.kinds;
    const e = world.enemies;
    for (let i = 0; i < e.count; i++) {
      if (e.hp[i]! > 0 && sets?.[kinds[e.kind[i]!]?.id ?? '']?.waterRun) return i;
    }
    return -1;
  }

  update(world: World, timeMs: number): void {
    const i = this.findRunner(world);
    if (i === -1) {
      if (this.built) this.hideAll();
      return;
    }
    this.build();
    this.arena = world.arena;
    const x = world.enemies.x[i]!;
    const y = world.enemies.y[i]! + FOOT_Y;
    if (Number.isNaN(this.lastX)) {
      this.lastX = x;
      this.lastY = y;
      this.lastStepX = x;
      this.lastStepY = y;
      this.lastTick = world.tick;
    }
    // シミュレーションが進んだときだけ測る（描画の方が回数が多い）
    if (world.tick !== this.lastTick) this.stepRun(world, x, y, timeMs);
    // 立っているとき
    if (!this.running && timeMs - this.lastIdle >= IDLE_S * 1000) {
      this.lastIdle = timeMs;
      this.addRipple(x, y, timeMs, IDLE_SCALE);
    }
    this.draw(timeMs);
  }

  /** 動いた距離から走っているかを決め、足跡を付ける（ホストの技の予定を見ないので、ゲストの画面でも同じ） */
  private stepRun(world: World, x: number, y: number, timeMs: number): void {
    const ticks = world.tick - this.lastTick;
    this.lastTick = world.tick;
    const dx = x - this.lastX;
    const dy = y - this.lastY;
    const moved = Math.hypot(dx, dy);
    const speed = moved / Math.max(world.dt, ticks * world.dt);
    // 大きく飛んだとき（位置の補正）は足跡を付けない
    if (moved > TELEPORT * Math.max(1, ticks)) {
      this.lastX = x;
      this.lastY = y;
      this.lastStepX = x;
      this.lastStepY = y;
      this.travelled = 0;
      return;
    }
    const fast = speed >= RUN_SPEED;
    const ux = moved > 0 ? dx / moved : 0;
    const uy = moved > 0 ? dy / moved : 1;
    // 蹴り出しと、止まるとき（止まったと決めるのは 2 回続けて遅いとき）
    if (fast) this.slowTicks = 0;
    else this.slowTicks++;
    if (fast && !this.running) {
      this.running = true;
      this.travelled = 0;
      this.lastStepX = this.lastX;
      this.lastStepY = this.lastY;
      this.addRipple(this.lastX, this.lastY, timeMs, KICK_SCALE);
      this.addDrops(this.lastX, this.lastY, timeMs, 8, 0, 0, 1.1);
    } else if (!fast && this.running && this.slowTicks >= 2) {
      this.running = false;
      this.addRipple(x, y, timeMs, KICK_SCALE);
      this.addDrops(x, y, timeMs, 8, 0, 0, 1.1);
      this.lastIdle = timeMs;
    }
    if (this.running && moved > 0) {
      // 走った分の足跡（1 回で何歩も進むときは間の場所へ）
      let along = 0;
      while (this.travelled + (moved - along) >= STEP) {
        along += STEP - this.travelled;
        this.travelled = 0;
        this.footSide = -this.footSide;
        const fx = this.lastX + ux * along - uy * STEP_SIDE * this.footSide;
        const fy = this.lastY + uy * along + ux * STEP_SIDE * this.footSide * 0.5;
        this.addRipple(fx, fy, timeMs, 1);
        this.addDrops(fx, fy, timeMs, 2, ux, uy, 1);
        if (this.onFloor(fx, fy)) {
          this.trails[this.nextTrail] = { x: fx, y: fy, born: timeMs, angle: Math.atan2(fy - this.lastStepY, fx - this.lastStepX), length: Math.hypot(fx - this.lastStepX, fy - this.lastStepY) };
          this.nextTrail = (this.nextTrail + 1) % MAX_TRAILS;
        }
        this.lastStepX = fx;
        this.lastStepY = fy;
      }
      this.travelled += moved - along;
    }
    this.lastX = x;
    this.lastY = y;
  }

  private draw(now: number): void {
    for (let k = 0; k < MAX_RIPPLES; k++) {
      const r = this.ripples[k];
      const age = r ? (now - r.born) / 1000 : 1e9;
      if (!r || age >= RIPPLE_S) {
        this.rippleImages[k]?.setVisible(false);
        continue;
      }
      const key = `water-ripple-${Math.min(RIPPLE_FRAMES - 1, Math.floor((age / RIPPLE_S) * RIPPLE_FRAMES))}`;
      const img = this.rippleImages[k] ?? this.scene.add.image(0, 0, key).setDepth(this.groundDepth);
      this.rippleImages[k] = img;
      img.setTexture(key).setPosition(r.x, r.y).setScale(DOT * r.scale).setFlipX(r.flip).setVisible(true);
    }
    for (let k = 0; k < MAX_TRAILS; k++) {
      const t = this.trails[k];
      const age = t ? (now - t.born) / 1000 : 1e9;
      if (!t || age >= TRAIL_S) {
        this.trailImages[k]?.setVisible(false);
        continue;
      }
      const img = this.trailImages[k] ?? this.scene.add.image(0, 0, 'water-trail').setOrigin(1, 0.5).setDepth(this.groundDepth);
      this.trailImages[k] = img;
      img
        .setPosition(t.x, t.y)
        .setRotation(t.angle)
        .setScale(t.length / 64, DOT)
        .setAlpha(1 - age / TRAIL_S)
        .setVisible(true);
    }
    for (let k = 0; k < MAX_DROPS; k++) {
      const d = this.drops[k];
      const age = d ? (now - d.born) / 1000 : 1e9;
      if (!d || age >= DROP_S) {
        this.dropImages[k]?.setVisible(false);
        continue;
      }
      const lift = d.rise * age - (DROP_GRAVITY * age * age) / 2;
      if (lift < 0) {
        this.dropImages[k]?.setVisible(false);
        continue;
      }
      const img = this.dropImages[k] ?? this.scene.add.image(0, 0, 'water-drop').setScale(DOT).setDepth(this.dropDepth);
      this.dropImages[k] = img;
      img
        .setPosition(d.x + d.vx * age, d.y + d.vy * age - lift)
        .setVisible(true);
    }
  }
}
