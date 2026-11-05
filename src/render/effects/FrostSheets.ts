import Phaser from 'phaser';
import { blizzardFront, blizzardShelters, isInLee } from '../../sim/systems/stage';
import type { BossMove } from '../../data/schema';
import type { World } from '../../sim/world';

/** 描き直す間隔（ミリ秒） */
const REDRAW_MS = 80;
/** 決まった乱数（0〜1） */
function rnd(k: number, salt: number): number {
  const v = Math.sin(k * 127.1 + salt * 311.7) * 43758.5453;
  return v - Math.floor(v);
}
const abgr = (r: number, g: number, b: number, a: number): number => ((Math.round(a * 255) << 24) | (b << 16) | (g << 8) | r) >>> 0;

/** 一辺 SNOW_TILE でつながる、なめらかなむら（0〜1）。cells は一辺のマス数 */
function tileNoise(x: number, y: number, cells: number, salt: number): number {
  const fx = (x / SNOW_TILE) * cells;
  const fy = (y / SNOW_TILE) * cells;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const tx = smooth(fx - x0);
  const ty = smooth(fy - y0);
  const at = (i: number, j: number): number => rnd(((i + cells) % cells) * 97 + ((j + cells) % cells) * 311, salt);
  const a = at(x0, y0);
  const b = at(x0 + 1, y0);
  const c = at(x0, y0 + 1);
  const d = at(x0 + 1, y0 + 1);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** 雪の模様の一辺（ドット）と、1 ドットのワールドの単位 */
const SNOW_TILE = 256;
const SNOW_DOT = 2;
/** 積もりきったときの覆い具合（1 で全部。地面が所々のぞく） */
const SNOW_COVER = 0.74;

/**
 * スイクンの登場（07 の218章・219章）: 地面に雪が積もる。雑魚やポケモンより下に描く（地面の一部）。
 * 模様は地面に固定で、歩いてもずれない。見た目だけ
 */
export class SnowGround {
  private readonly images: Phaser.GameObjects.Image[] = [];
  private tex: Phaser.Textures.CanvasTexture | null = null;
  private threshold = new Float32Array(0);
  private lastDraw = -1e9;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
  ) {}

  private build(): void {
    if (this.tex) return;
    const key = 'snow-ground';
    if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    this.tex = this.scene.textures.createCanvas(key, SNOW_TILE, SNOW_TILE);
    this.threshold = new Float32Array(SNOW_TILE * SNOW_TILE);
    let lo = Infinity;
    let hi = -Infinity;
    for (let y = 0; y < SNOW_TILE; y++) {
      for (let x = 0; x < SNOW_TILE; x++) {
        // つながるまだら（大きなむら ＋ 小さなむら ＋ 細かい粒）
        const v = 1.0 * tileNoise(x, y, 4, 11) + 0.55 * tileNoise(x, y, 9, 12) + 0.3 * tileNoise(x, y, 22, 13) + 0.22 * rnd(y * SNOW_TILE + x, 7);
        this.threshold[y * SNOW_TILE + x] = v;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    for (let i = 0; i < this.threshold.length; i++) this.threshold[i] = (this.threshold[i]! - lo) / (hi - lo);
  }

  update(world: World, timeMs: number, cam: Phaser.Cameras.Scene2D.Camera): void {
    const it = world.intruder;
    if (!it || it.introUntil === undefined || it.introStart === undefined) {
      for (const img of this.images) img.setVisible(false);
      return;
    }
    this.build();
    // 地面に固定した格子で、見えている所に敷く
    const size = SNOW_TILE * SNOW_DOT;
    const view = cam.worldView;
    const x0 = Math.floor(view.x / size) * size;
    const y0 = Math.floor(view.y / size) * size;
    let used = 0;
    for (let y = y0; y < view.bottom; y += size) {
      for (let x = x0; x < view.right; x += size) {
        const img = this.images[used] ?? this.scene.add.image(0, 0, 'snow-ground').setOrigin(0, 0).setScale(SNOW_DOT).setDepth(this.depth);
        this.images[used] = img;
        img.setPosition(x, y).setVisible(true);
        used++;
      }
    }
    for (let k = used; k < this.images.length; k++) this.images[k]!.setVisible(false);
    if (timeMs - this.lastDraw < REDRAW_MS) return;
    this.lastDraw = timeMs;
    // 雑魚が凍るまでに積もりきる
    const span = Math.max(1, (it.introFreeze ?? it.introUntil) - it.introStart);
    const level = Math.min(1, (world.tick - it.introStart) / span) * SNOW_COVER;
    const ctx = this.tex!.getContext();
    const img = ctx.createImageData(SNOW_TILE, SNOW_TILE);
    const out = new Uint32Array(img.data.buffer);
    const edge = abgr(160, 180, 196, 0.6);
    const soft = abgr(190, 206, 218, 0.85);
    const bright = abgr(212, 224, 233, 0.9);
    for (let i = 0; i < out.length; i++) {
      const gap = level - this.threshold[i]!;
      if (gap <= 0) continue;
      out[i] = gap < 0.035 ? edge : gap < 0.11 ? soft : bright;
    }
    ctx.putImageData(img, 0, 0);
    this.tex!.refresh();
  }
}

/** 雪の雲の濃さのむら（一辺 CLOUD_TILE でつながる。0〜1） */
const CLOUD_TILE = 128;
function makeCloud(): Float32Array {
  const out = new Float32Array(CLOUD_TILE * CLOUD_TILE);
  let lo = Infinity;
  let hi = -Infinity;
  // tileNoise は SNOW_TILE を一周とするので、座標を合わせる
  const k = SNOW_TILE / CLOUD_TILE;
  for (let y = 0; y < CLOUD_TILE; y++) {
    for (let x = 0; x < CLOUD_TILE; x++) {
      const v = tileNoise(x * k, y * k, 4, 31) + 0.6 * tileNoise(x * k, y * k, 8, 32) + 0.35 * tileNoise(x * k, y * k, 16, 33) + 0.2 * tileNoise(x * k, y * k, 32, 34);
      out[y * CLOUD_TILE + x] = v;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i]! - lo) / (hi - lo);
  return out;
}

/** 雪片の数（細かい雪・筋の雪・大きな雪片）と、塊 1 つの両脇を流れる雪の数 */
const FAR = 80;
const MID = 36;
const BIG = 14;
const SPRAY_PER_BLOCK = 6;
/** 風の筋の列ごとの乱数 */
const LANES = Float32Array.from({ length: 1024 }, (_, k) => rnd(k, 25));
/** 雪の雲の色（薄い所は青く影になり、濃い所は白い） */
const VEIL_LEVELS = [abgr(150, 192, 226, 0.2), abgr(178, 214, 238, 0.36), abgr(204, 230, 246, 0.5), abgr(228, 243, 251, 0.64), abgr(246, 252, 255, 0.76)];

/**
 * ふぶき（スイクン。07 の218章・224章）: 雪の雲（濃淡のある帯）の中を、細かい雪・筋の雪・大きな雪片が別々の速さで流れる。
 * 氷の塊の風下には雪が入らず、塊の両脇を雪が割れて流れる。当たるかはシミュレーションが決める
 */
export class BlizzardSheet {
  private image: Phaser.GameObjects.Image | null = null;
  private tex: Phaser.Textures.CanvasTexture | null = null;
  private w = 0;
  private h = 0;
  private lastDraw = -1e9;
  private readonly flakes: Phaser.GameObjects.Image[] = [];
  private readonly spray: Phaser.GameObjects.Image[] = [];
  private cloud: Float32Array = new Float32Array(0);
  /** 風下の所（0: 雪が入る、1: 風下、2: 風下のふち。ふちは雪が少し入って見える） */
  private lee = new Uint8Array(0);
  private leeKey = '';
  private lastTick = -1;
  private lastTickMs = 0;
  private static readonly DOT = 4;
  private static readonly REDRAW_MS = 33;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
  ) {}

  private build(arena: NonNullable<World['arena']>): void {
    const d = BlizzardSheet.DOT;
    const w = Math.round((arena.halfWidth * 2) / d);
    const h = Math.round((arena.halfHeight * 2) / d);
    if (this.w === w && this.h === h && this.tex) return;
    this.image?.destroy();
    const key = 'blizzard-sheet';
    if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    this.tex = this.scene.textures.createCanvas(key, w, h);
    this.image = this.scene.add.image(arena.x, arena.y, key).setScale(d).setDepth(this.depth).setVisible(false);
    this.w = w;
    this.h = h;
    this.leeKey = '';
    if (!this.cloud.length) this.cloud = makeCloud();
    this.buildFlakes();
  }

  /** 雪片の絵（右へ流れる向き） */
  private buildFlakes(): void {
    const tx = this.scene.textures;
    const paint = (key: string, w: number, h: number, draw: (put: (x: number, y: number, c: number) => void) => void): void => {
      if (tx.exists(key)) tx.remove(key);
      const c = tx.createCanvas(key, w, h)!;
      const ctx = c.getContext();
      const img = ctx.createImageData(w, h);
      const out = new Uint32Array(img.data.buffer);
      draw((x, y, col) => {
        if (x >= 0 && y >= 0 && x < w && y < h) out[y * w + x] = col;
      });
      ctx.putImageData(img, 0, 0);
      c.refresh();
    };
    const white = abgr(250, 253, 255, 1);
    const pale = abgr(206, 232, 248, 0.9);
    const shade = abgr(104, 160, 208, 0.95);
    const faint = abgr(214, 236, 250, 0.55);
    paint('bz-far', 5, 2, (put) => {
      for (let x = 0; x < 5; x++) put(x, 0, x > 1 ? white : faint);
      for (let x = 2; x < 5; x++) put(x, 1, pale);
    });
    paint('bz-mid', 14, 3, (put) => {
      for (let x = 0; x < 14; x++) put(x, 1, x > 9 ? white : x > 4 ? pale : faint);
      for (let x = 8; x < 13; x++) {
        put(x, 0, pale);
        put(x, 2, shade);
      }
    });
    // 大きな雪片: 6 本の腕に枝。ふちを青くして、白い雲の中でも見える
    for (const [i, size] of [[0, 21], [1, 15]] as const) {
      const c = (size - 1) / 2;
      const grid = new Uint8Array(size * size);
      const mark = (x: number, y: number): void => {
        const px = Math.round(x);
        const py = Math.round(y);
        if (px >= 0 && py >= 0 && px < size && py < size) grid[py * size + px] = 1;
      };
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3;
        for (let r = 0; r <= c - 1; r += 0.5) mark(c + Math.cos(a) * r, c + Math.sin(a) * r);
        // 枝は腕の途中から外へ開く
        for (const at of [c * 0.45, c * 0.75]) {
          for (const side of [-1, 1]) {
            const b = a + (side * Math.PI) / 3;
            for (let r = 0; r <= c * 0.26; r += 0.5) mark(c + Math.cos(a) * at + Math.cos(b) * r, c + Math.sin(a) * at + Math.sin(b) * r);
          }
        }
      }
      paint(`bz-big-${i}`, size, size, (put) => {
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const on = grid[y * size + x];
            if (on) {
              put(x, y, white);
              continue;
            }
            const near = (dx: number, dy: number): boolean => {
              const px = x + dx;
              const py = y + dy;
              return px >= 0 && py >= 0 && px < size && py < size && grid[py * size + px] === 1;
            };
            if (near(1, 0) || near(-1, 0) || near(0, 1) || near(0, -1)) put(x, y, shade);
          }
        }
      });
    }
  }

  private flake(list: Phaser.GameObjects.Image[], k: number, key: string): Phaser.GameObjects.Image {
    const img = list[k] ?? this.scene.add.image(0, 0, key);
    list[k] = img;
    return img;
  }

  private hideFlakes(): void {
    for (const img of this.flakes) img.setVisible(false);
    for (const img of this.spray) img.setVisible(false);
  }

  /** 風下の所を前もって数えておく（塊は動かない） */
  private updateLee(arena: NonNullable<World['arena']>, shelters: readonly { x: number; y: number; radius: number }[], b: NonNullable<BossMove['blizzard']>): void {
    const key = `${b.dirX},${b.dirY},${shelters.map((s) => `${s.x},${s.y}`).join(';')}`;
    if (key === this.leeKey) return;
    this.leeKey = key;
    const { w, h } = this;
    const d = BlizzardSheet.DOT;
    const left = arena.x - arena.halfWidth;
    const top = arena.y - arena.halfHeight;
    if (this.lee.length !== w * h) this.lee = new Uint8Array(w * h);
    const lee = this.lee;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) lee[y * w + x] = isInLee(shelters, b, left + (x + 0.5) * d, top + (y + 0.5) * d) ? 1 : 0;
    }
    // 風下のふち（切り口を直線にしない）
    const inner: number[] = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (lee[i] === 1 && (lee[i - 1] === 0 || lee[i + 1] === 0 || lee[i - w] === 0 || lee[i + w] === 0)) inner.push(i);
      }
    }
    for (const i of inner) lee[i] = 2;
  }

  update(world: World, timeMs: number): void {
    const arena = world.arena;
    const moves = world.rules.stage.moves;
    const hz = arena ? world.hazards.find((h) => moves[h.move]?.blizzard) : undefined;
    const move = hz ? moves[hz.move] : undefined;
    const b = move?.blizzard;
    if (!arena || !hz || !move || !b) {
      this.image?.setVisible(false);
      this.hideFlakes();
      return;
    }
    this.build(arena);
    this.image!.setPosition(arena.x, arena.y).setVisible(true);
    const shelters = blizzardShelters(world, b);
    this.updateLee(arena, shelters, b);
    // シミュレーションの間（1/30 秒）も滑らかに進める
    if (world.tick !== this.lastTick) {
      this.lastTick = world.tick;
      this.lastTickMs = timeMs;
    }
    const f0 = hz.activeTicks !== undefined ? blizzardFront(world, hz, move) : null;
    const f = f0 === null ? null : f0 + b.speed * Math.min(world.dt, (timeMs - this.lastTickMs) / 1000);
    // 吹き出す前は、弱い風の筋と、少しの雪だけ（だんだん増える）
    const pre = f === null ? Math.max(0, Math.min(1, 1 - hz.ticksLeft / Math.max(1, hz.totalTicks))) : 1;
    this.placeFlakes(arena, shelters, b, f, pre, timeMs);
    if (timeMs - this.lastDraw < BlizzardSheet.REDRAW_MS) return;
    this.lastDraw = timeMs;
    this.drawVeil(arena, b, f, pre, timeMs);
  }

  private placeFlakes(arena: NonNullable<World['arena']>, shelters: readonly { x: number; y: number; radius: number }[], b: NonNullable<BossMove['blizzard']>, f: number | null, pre: number, timeMs: number): void {
    const sec = timeMs / 1000;
    const wind = Math.atan2(b.dirY, b.dirX);
    const crossSpan = (Math.abs(b.dirX) * arena.halfHeight + Math.abs(b.dirY) * arena.halfWidth) * 2;
    const alongSpan = (Math.abs(b.dirX) * arena.halfWidth + Math.abs(b.dirY) * arena.halfHeight) * 2;
    const band = b.width + 100;
    const total = FAR + MID + BIG;
    for (let k = 0; k < total; k++) {
      const big = k >= FAR + MID;
      const mid = !big && k >= FAR;
      const key = big ? `bz-big-${k % 2}` : mid ? 'bz-mid' : 'bz-far';
      const img = this.flake(this.flakes, k, key);
      const r1 = rnd(k, 21);
      const r2 = rnd(k, 22);
      const r3 = rnd(k, 23);
      // 大きな雪片（手前）は帯より速く、細かい雪（奥）は遅い
      const rel = big ? 90 + r3 * 90 : mid ? 20 + r3 * 60 : -70 - r3 * 60;
      const across = (r1 - 0.5) * crossSpan + Math.sin(sec * (1 + r3 * 2) + r3 * 6.28) * (big ? 26 : 8);
      let along: number;
      let alpha: number;
      if (f !== null) {
        const o = ((r2 * band + sec * rel) % band + band) % band;
        along = f + o - band / 2 - 20;
        alpha = Math.min(1, Math.min(o, band - o) / 40);
      } else {
        // 吹き出す前: マップ全体をゆっくり流れる。後半の数だけ出す
        if (r3 > pre * 0.7) {
          img.setVisible(false);
          continue;
        }
        const o = ((r2 * alongSpan + sec * (big ? 240 : mid ? 200 : 150)) % alongSpan + alongSpan) % alongSpan;
        along = o - alongSpan / 2;
        alpha = Math.min(1, Math.min(o, alongSpan - o) / 60) * 0.75;
      }
      const x = arena.x + b.dirX * along - b.dirY * across;
      const y = arena.y + b.dirY * along + b.dirX * across;
      if (Math.abs(x - arena.x) > arena.halfWidth || Math.abs(y - arena.y) > arena.halfHeight || isInLee(shelters, b, x, y)) {
        img.setVisible(false);
        continue;
      }
      img
        .setTexture(key)
        .setPosition(x, y)
        .setRotation(big ? sec * (1.2 + r3 * 2) * (k % 2 ? 1 : -1) + r2 * 6.28 : wind)
        .setScale(big ? 2 + r1 * 0.6 : 2)
        .setDepth(this.depth + (big ? 0.04 : mid ? 0.02 : 0.01))
        .setAlpha(alpha)
        .setVisible(true);
    }
    // 塊の両脇を雪が割れて流れる（風下の形が見える）
    const need = shelters.length * SPRAY_PER_BLOCK;
    for (let k = need; k < this.spray.length; k++) this.spray[k]!.setVisible(false);
    shelters.forEach((s, si) => {
      const blockAlong = (s.x - arena.x) * b.dirX + (s.y - arena.y) * b.dirY;
      const on = f !== null && Math.abs(blockAlong - f) < b.width / 2 + 40;
      for (let j = 0; j < SPRAY_PER_BLOCK; j++) {
        const img = this.flake(this.spray, si * SPRAY_PER_BLOCK + j, 'bz-mid');
        if (!on) {
          img.setVisible(false);
          continue;
        }
        const p = (sec * 1.5 + j / SPRAY_PER_BLOCK + rnd(si, 24)) % 1;
        const side = j % 2 ? 1 : -1;
        const along = -s.radius + p * (s.radius * 2 + 170);
        const across = side * s.radius * (0.55 + Math.min(1, p * 3) * 0.55);
        img
          .setPosition(s.x + b.dirX * along - b.dirY * across, s.y + b.dirY * along + b.dirX * across)
          .setRotation(wind)
          .setScale(2.4)
          .setDepth(this.depth + 0.03)
          .setAlpha(1 - p)
          .setVisible(true);
      }
    });
  }

  private drawVeil(arena: NonNullable<World['arena']>, b: NonNullable<BossMove['blizzard']>, f: number | null, pre: number, timeMs: number): void {
    const d = BlizzardSheet.DOT;
    const { w, h, lee, cloud } = this;
    const ctx = this.tex!.getContext();
    const img = ctx.createImageData(w, h);
    const out = new Uint32Array(img.data.buffer);
    const left = arena.x - arena.halfWidth;
    const top = arena.y - arena.halfHeight;
    const sec = timeMs / 1000;
    const half = b.width / 2;
    // 風の筋の流れ・雲の流れ（帯の中で、速さの違う 2 枚を重ねる）
    const flow = sec * 150;
    const flow1 = sec * 70;
    const flow2 = sec * 190;
    const mask = CLOUD_TILE - 1;
    const streakCol = abgr(232, 244, 252, 0.34 * pre);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const l = lee[i]!;
        if (l === 1) continue;
        const wx = left + (x + 0.5) * d;
        const wy = top + (y + 0.5) * d;
        const along = (wx - arena.x) * b.dirX + (wy - arena.y) * b.dirY;
        const across = -(wx - arena.x) * b.dirY + (wy - arena.y) * b.dirX;
        let col = 0;
        // 流れに沿った細く長い風の筋: ごく一部の列で、along の一部だけ光る
        const r = LANES[Math.floor((across + 2000) / d) & 1023]!;
        const seg = ((along + 4000 - flow * (1.4 + r)) % 300 + 300) % 300;
        if (l === 0 && r > 0.9 && seg < 60 + (r - 0.9) * 900) col = streakCol;
        if (f !== null) {
          const off = along - f;
          if (off < half + 44 && off > -half - 110) {
            const cq = Math.floor((across + 4096) / 8) & mask;
            const fq = Math.floor((across + 4096) / d) & mask;
            // 先頭は風に引かれた舌の形でぎざぎざ（大きなうねり ＋ 列ごとの長さ。当たりの帯の幅 ±38 まで）
            const swell = (cloud[(cq << 7) | (Math.floor(sec * 4) & mask)]! - 0.5) * 44;
            const finger = (cloud[(fq << 7) | 37]! - 0.5) * 60;
            const front = (half + swell + finger - off) / 44;
            // 後ろは列ごとの長さで、薄くほどける
            const tail = (off + half + 40 + cloud[(fq << 7) | 91]! * 70) / 120;
            const edge = Math.min(1, Math.min(front, tail));
            if (edge > 0) {
              // 雲の濃淡（大きい）と、風に引かれた細い筋（別の速さで流れる）
              const n1 = cloud[(cq << 7) | (Math.floor((along + 4096 - flow1) / 20) & mask)]!;
              const n2 = cloud[(fq << 7) | (Math.floor((along + 4096 - flow2) / 30) & mask)]!;
              const n3 = cloud[(((fq * 3 + 17) & mask) << 7) | (Math.floor((along + 4096 - flow2 * 1.5) / 18) & mask)]!;
              const dn = edge * (0.12 + 0.5 * n1 + 0.42 * n2 + 0.42 * n3);
              // 段を付けて、雲の濃淡がドットの段で見えるように
              const level = dn < 0.3 ? -1 : dn < 0.44 ? 0 : dn < 0.58 ? 1 : dn < 0.7 ? 2 : dn < 0.82 ? 3 : 4;
              // 風下のふちは、薄い雪が少し入るだけ
              if (l === 2) {
                if (level >= 2 && n2 > 0.5) col = VEIL_LEVELS[0]!;
              } else if (level >= 0) col = VEIL_LEVELS[level]!;
            }
          }
        }
        if (col !== 0) out[i] = col;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.tex!.refresh();
  }

  destroy(): void {
    this.image?.destroy();
    this.image = null;
    this.tex = null;
    this.w = 0;
    this.h = 0;
  }
}

/** 氷の結晶の絵の大きさ（ドット）と、根元の高さ */
const CRYSTAL_DOT = 2;
const CRYSTAL_W = 78;
const CRYSTAL_H = 104;
const CRYSTAL_ROOT = 96;
const GROW_FRAMES = [0.4, 0.62, 0.85, 1];
const MELT_FRAMES = [0.7, 0.4];
const GLINT_FRAMES = 6;
const CRYSTAL_FRAME_S = 0.11;
const MELT_S = 0.3;
/** 光が走る間隔（秒）と、そのうち光っている割合 */
const GLINT_PERIOD_S = 3;
const GLINT_PART = 0.28;

/** 結晶の柱（奥から順に描く。cx・高さ・太さはドット、lean は傾き） */
const SPIRES = [
  { cx: -18, h: 58, hw: 10, lean: -0.15 },
  { cx: 19, h: 66, hw: 10, lean: 0.14 },
  { cx: 9, h: 84, hw: 13, lean: 0.05 },
  { cx: -8, h: 92, hw: 14, lean: -0.05 },
  { cx: 1, h: 50, hw: 12, lean: 0.02 },
] as const;

/** 結晶の 1 コマ（scale は育ち具合。glint は光の帯の位置。無ければ光らない） */
function crystalPixels(scale: number, glint: number | null): Uint32Array {
  const n = CRYSTAL_W * CRYSTAL_H;
  const rr = new Float32Array(n);
  const gg = new Float32Array(n);
  const bb = new Float32Array(n);
  const aa = new Float32Array(n);
  const over = (i: number, r: number, g: number, b: number, a: number): void => {
    const keep = aa[i]! * (1 - a);
    const out = a + keep;
    if (out <= 0) return;
    rr[i] = (r * a + rr[i]! * keep) / out;
    gg[i] = (g * a + gg[i]! * keep) / out;
    bb[i] = (b * a + bb[i]! * keep) / out;
    aa[i] = out;
  };
  const mid = (CRYSTAL_W - 1) / 2;
  // 根元の霜
  const frost = 34 * Math.min(1, scale * 1.2);
  for (let y = CRYSTAL_ROOT - 12; y < CRYSTAL_H; y++) {
    for (let x = 0; x < CRYSTAL_W; x++) {
      const e = Math.hypot((x - mid) / frost, (y - CRYSTAL_ROOT) / (frost * 0.24));
      const jag = 0.82 + 0.3 * rnd(Math.floor(x / 3), 41);
      if (e < jag) over(y * CRYSTAL_W + x, 214, 238, 250, e > jag - 0.2 ? 0.62 : 0.34);
    }
  }
  for (const s of SPIRES) {
    const h = s.h * scale;
    for (let y = 0; y < CRYSTAL_H; y++) {
      const up = CRYSTAL_ROOT - y;
      if (up < -2 || up > h) continue;
      const q = Math.max(0, up) / h;
      const half = (s.hw * (0.65 + 0.35 * scale)) * (q < 0.74 ? 1 - 0.2 * (q / 0.74) : 0.8 * (1 - (q - 0.74) / 0.26));
      if (half < 0.5) continue;
      const c = mid + s.cx * (0.7 + 0.3 * scale) + s.lean * Math.max(0, up);
      for (let x = Math.max(0, Math.floor(c - half)); x <= Math.min(CRYSTAL_W - 1, Math.ceil(c + half)); x++) {
        const off = (x - c) / half;
        if (Math.abs(off) > 1) continue;
        // 根元は丸くおさめる（地面に刺さって見えるように）
        if (up < 2 - 3.5 * (1 - off * off)) continue;
        const i = y * CRYSTAL_W + x;
        const px = half * (1 - Math.abs(off));
        // ふち: 外は濃い青の線、面の境は白い線
        if (px < 1) {
          over(i, 46, 104, 156, 0.92);
          continue;
        }
        if (Math.abs(Math.abs(off) - 0.36) * half < 0.55) {
          over(i, 238, 250, 255, 0.86);
          continue;
        }
        if (q >= 0.73 && q < 0.75) {
          over(i, 238, 250, 255, 0.8);
          continue;
        }
        // 面: 上へ行くほど透ける。左は明るく、真ん中は下が透け、右は暗い
        const clear = 1.1 - 0.55 * q;
        const cap = q > 0.74 ? 0.1 : 0;
        if (off < -0.36) over(i, 168, 224, 246, (0.5 + cap) * clear);
        else if (off < 0.36) over(i, 206, 240, 252, (0.28 + cap) * clear);
        else over(i, 82, 156, 206, (0.56 + cap) * clear);
        // 左の面の光
        if (off < -0.36 && Math.abs(off + 0.68 - q * 0.2) * half < 0.9 && q > 0.16 && q < 0.62) over(i, 255, 255, 255, 0.72);
        // 中のひび（光の屈折）
        if (Math.abs(off - 0.12 + Math.sin(q * 9 + s.cx) * 0.14) * half < 0.45 && q > 0.1 && q < 0.5) over(i, 240, 252, 255, 0.4);
      }
    }
  }
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const a = aa[i]!;
    if (a <= 0) continue;
    let r = rr[i]!;
    let g = gg[i]!;
    let b = bb[i]!;
    if (glint !== null && a > 0.2) {
      const x = i % CRYSTAL_W;
      const y = Math.floor(i / CRYSTAL_W);
      const dist = Math.abs(x + y * 0.55 - glint);
      if (dist < 5) {
        const m = 0.6 * (1 - dist / 5);
        r += (255 - r) * m;
        g += (255 - g) * m;
        b += (255 - b) * m;
      }
    }
    out[i] = abgr(Math.round(r), Math.round(g), Math.round(b), Math.min(1, a));
  }
  return out;
}

/** ふぶきの氷の塊（07 の224章）: ガラスのように下の床が透ける結晶。光がゆっくり走る。見た目だけ（風下はシミュレーション） */
export class IceCrystals {
  private readonly images: Phaser.GameObjects.Image[] = [];
  private built = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
  ) {}

  private build(): void {
    if (this.built) return;
    this.built = true;
    const tx = this.scene.textures;
    const paint = (key: string, pixels: Uint32Array): void => {
      if (tx.exists(key)) tx.remove(key);
      const c = tx.createCanvas(key, CRYSTAL_W, CRYSTAL_H)!;
      const ctx = c.getContext();
      const img = ctx.createImageData(CRYSTAL_W, CRYSTAL_H);
      new Uint32Array(img.data.buffer).set(pixels);
      ctx.putImageData(img, 0, 0);
      c.refresh();
    };
    GROW_FRAMES.forEach((s, k) => paint(`ice-crystal-grow-${k}`, crystalPixels(s, null)));
    MELT_FRAMES.forEach((s, k) => paint(`ice-crystal-melt-${k}`, crystalPixels(s, null)));
    for (let k = 0; k < GLINT_FRAMES; k++) paint(`ice-crystal-glint-${k}`, crystalPixels(1, -10 + ((k + 0.5) / GLINT_FRAMES) * (CRYSTAL_W + CRYSTAL_H * 0.55 + 20)));
  }

  update(world: World, timeMs: number): void {
    const moves = world.rules.stage.moves;
    const blocks = new Set<string>();
    for (const m of moves) if (m.blizzard) blocks.add(m.blizzard.blocks);
    let used = 0;
    for (const hz of world.hazards) {
      const mv = moves[hz.move];
      if (!mv || !blocks.has(mv.id)) continue;
      this.build();
      const total = Math.round((mv.activeSeconds ?? 1) / world.dt);
      const left = hz.activeTicks ?? total;
      const elapsed = (total - left) * world.dt;
      const remain = left * world.dt;
      let key: string;
      if (remain < MELT_S) key = `ice-crystal-melt-${Math.min(MELT_FRAMES.length - 1, Math.floor(((MELT_S - remain) / MELT_S) * MELT_FRAMES.length))}`;
      else if (elapsed < CRYSTAL_FRAME_S * GROW_FRAMES.length) key = `ice-crystal-grow-${Math.floor(elapsed / CRYSTAL_FRAME_S)}`;
      else {
        // 塊ごとに違う時に、光がゆっくり走る
        const phase = (timeMs / 1000 / GLINT_PERIOD_S + rnd(Math.round(hz.x) + Math.round(hz.y) * 3, 42)) % 1;
        key = phase < GLINT_PART ? `ice-crystal-glint-${Math.floor((phase / GLINT_PART) * GLINT_FRAMES)}` : `ice-crystal-grow-${GROW_FRAMES.length - 1}`;
      }
      const img = this.images[used] ?? this.scene.add.image(0, 0, key).setOrigin(0.5, CRYSTAL_ROOT / CRYSTAL_H).setScale(CRYSTAL_DOT).setDepth(this.depth);
      this.images[used] = img;
      img.setTexture(key).setPosition(hz.x, hz.y + mv.radius * 0.8).setAlpha(remain < MELT_S ? 0.5 + (remain / MELT_S) * 0.5 : 1).setVisible(true);
      used++;
    }
    for (let k = used; k < this.images.length; k++) this.images[k]!.setVisible(false);
  }
}
