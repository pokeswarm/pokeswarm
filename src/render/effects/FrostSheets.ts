import Phaser from 'phaser';
import { blizzardFront, blizzardShelters, isInLee } from '../../sim/systems/stage';
import type { World } from '../../sim/world';

/** 描き直す間隔（ミリ秒） */
const REDRAW_MS = 80;
/** 凍った氷の板の大きさ（ドット） */
const PLATE = 34;
/** 決まった乱数（0〜1） */
function rnd(k: number, salt: number): number {
  const v = Math.sin(k * 127.1 + salt * 311.7) * 43758.5453;
  return v - Math.floor(v);
}
const abgr = (r: number, g: number, b: number, a: number): number => ((Math.round(a * 255) << 24) | (b << 16) | (g << 8) | r) >>> 0;

/** スイクンの登場（07 の218章）: 今のマップの画面全体が、端から凍てつく。画面に固定して描く。見た目だけ */
export class FreezeSheet {
  private image: Phaser.GameObjects.Image | null = null;
  private tex: Phaser.Textures.CanvasTexture | null = null;
  private w = 0;
  private h = 0;
  private arrival = new Float32Array(0);
  private lace = new Uint8Array(0);
  private lastDraw = -1e9;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
    /** 1 ドットの画面のピクセル数 */
    private readonly dot: number,
  ) {}

  private build(width: number, height: number): void {
    const w = Math.ceil(width / this.dot);
    const h = Math.ceil(height / this.dot);
    if (this.w === w && this.h === h && this.tex) return;
    this.image?.destroy();
    const key = 'freeze-sheet';
    if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    this.tex = this.scene.textures.createCanvas(key, w, h);
    this.image = this.scene.add.image(0, 0, key).setOrigin(0, 0).setScrollFactor(0).setDepth(this.depth).setVisible(false);
    this.w = w;
    this.h = h;
    this.arrival = new Float32Array(w * h);
    this.lace = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // 氷の板: 一番近い種と二番目の種。板の境が白い割れ目
        const cx = Math.floor(x / PLATE);
        const cy = Math.floor(y / PLATE);
        let d1 = 1e9;
        let d2 = 1e9;
        let id = 0;
        for (let j = cy - 1; j <= cy + 1; j++) {
          for (let i = cx - 1; i <= cx + 1; i++) {
            const k = i * 7919 + j * 131;
            const px = (i + rnd(k, 1)) * PLATE;
            const py = (j + rnd(k, 2)) * PLATE;
            const d = Math.hypot(px - x, py - y);
            if (d < d1) {
              d2 = d1;
              d1 = d;
              id = k;
            } else if (d < d2) d2 = d;
          }
        }
        const border = d2 - d1;
        const edge = Math.min(x, w - 1 - x, y, h - 1 - y);
        // 板ごとに少し早く・遅く凍る（先端がぎざぎざに進む）
        this.arrival[y * w + x] = edge * 0.8 + rnd(id, 4) * 26 + border * 0.25;
        this.lace[y * w + x] = border < 0.8 ? 2 : border < 1.7 ? 1 : 0;
      }
    }
  }

  /** place: カメラに合わせて画面の左上へ置く（呼ぶ側の placeUi） */
  update(world: World, timeMs: number, cam: Phaser.Cameras.Scene2D.Camera, place: (o: Phaser.GameObjects.Image) => void): void {
    const it = world.intruder;
    if (!it || it.introUntil === undefined || it.introStart === undefined) {
      this.image?.setVisible(false);
      return;
    }
    // 画面がまだ大きさを持たないとき（裏のタブなど）は描かない
    if (cam.width <= 0 || cam.height <= 0) return;
    this.build(cam.width, cam.height);
    place(this.image!);
    this.image!.setVisible(true).setScale(this.dot / cam.zoom);
    if (timeMs - this.lastDraw < REDRAW_MS) return;
    this.lastDraw = timeMs;
    const p = Math.min(1, (world.tick - it.introStart) / Math.max(1, it.introUntil - it.introStart));
    // 全体の 7 割の時間で画面の真ん中まで届く
    const level = (p / 0.7) * (Math.min(this.w, this.h) * 0.4 + 40);
    const ctx = this.tex!.getContext();
    const img = ctx.createImageData(this.w, this.h);
    const out = new Uint32Array(img.data.buffer);
    const iceAlpha = 0.34 + 0.2 * p;
    const base = abgr(188, 228, 255, iceAlpha);
    const line1 = abgr(210, 238, 255, iceAlpha + 0.08);
    const line2 = abgr(240, 250, 255, iceAlpha + 0.22);
    const front = abgr(255, 255, 255, 0.92);
    for (let i = 0; i < out.length; i++) {
      const gap = level - this.arrival[i]!;
      if (gap <= 0) continue;
      if (gap < 2.5) out[i] = front;
      else {
        const l = this.lace[i]!;
        out[i] = l === 2 ? line2 : l === 1 ? line1 : base;
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
