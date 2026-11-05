import Phaser from 'phaser';
import { blizzardFront, blizzardShelters, isInLee } from '../../sim/systems/stage';
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

/** ふぶき（スイクン。07 の218章）: マップを吹き抜ける雪の帯と風の筋。氷の塊の風下には雪が入らない。当たるかはシミュレーションが決める */
export class BlizzardSheet {
  private image: Phaser.GameObjects.Image | null = null;
  private tex: Phaser.Textures.CanvasTexture | null = null;
  private w = 0;
  private h = 0;
  private lastDraw = -1e9;
  private static readonly DOT = 4;

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
  }

  update(world: World, timeMs: number): void {
    const arena = world.arena;
    const moves = world.rules.stage.moves;
    const hz = arena ? world.hazards.find((h) => moves[h.move]?.blizzard) : undefined;
    const move = hz ? moves[hz.move] : undefined;
    const b = move?.blizzard;
    if (!arena || !hz || !move || !b) {
      this.image?.setVisible(false);
      return;
    }
    this.build(arena);
    this.image!.setPosition(arena.x, arena.y).setVisible(true);
    if (timeMs - this.lastDraw < REDRAW_MS) return;
    this.lastDraw = timeMs;
    const d = BlizzardSheet.DOT;
    const { w, h } = this;
    const ctx = this.tex!.getContext();
    const img = ctx.createImageData(w, h);
    const out = new Uint32Array(img.data.buffer);
    const left = arena.x - arena.halfWidth;
    const top = arena.y - arena.halfHeight;
    const shelters = blizzardShelters(world, b);
    const f = hz.activeTicks !== undefined ? blizzardFront(world, hz, move) : null;
    // 風の筋は風向きへ流れる
    const flow = Math.floor((timeMs / 1000) * 150);
    // 吹き出す前は弱い風の筋だけ
    const pre = f === null ? Math.min(1, 1 - hz.ticksLeft / Math.max(1, hz.totalTicks)) : 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const wx = left + (x + 0.5) * d;
        const wy = top + (y + 0.5) * d;
        const along = (wx - arena.x) * b.dirX + (wy - arena.y) * b.dirY;
        const across = -(wx - arena.x) * b.dirY + (wy - arena.y) * b.dirX;
        // 流れに沿った長い筋: 同じ across の列で、along の一部だけ光る
        const lane = Math.floor((across + 2000) / 12);
        const v = Math.sin(lane * 78.233) * 43758.5453;
        const r = v - Math.floor(v);
        const seg = ((along + 4000 - flow * (1.2 + r)) % 170 + 170) % 170;
        const streak = r > 0.55 && seg < 40 + r * 40;
        let alpha = streak ? 0.2 * pre : 0;
        if (f !== null) {
          // 帯の前後はぎざぎざに。雪は風に沿って流れる短い筋
          const fine = Math.floor((across + 2000) / 8);
          const rr = rnd(fine, 5);
          const off = Math.abs(along - f) + rr * 70 - 35;
          if (off < b.width / 2) {
            const k = 1 - Math.max(0, off) / (b.width / 2);
            const seg2 = Math.floor((along + 4000 - flow * 3) / (24 + rr * 36));
            alpha = Math.max(alpha, Math.min(0.96, k * 1.7) * (0.5 + 0.5 * rnd(fine * 31 + seg2, 6)));
          }
        }
        if (alpha <= 0) continue;
        if (isInLee(shelters, b, wx, wy)) continue;
        out[y * w + x] = abgr(244, 251, 255, alpha);
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
