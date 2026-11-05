import Phaser from 'phaser';
import { lavaSeaLevel } from '../../sim/systems/stage';
import type { World } from '../../sim/world';

/** 溶岩の 1 ドット（ワールドの単位。マップと同じ細かさ） */
const DOT = 2;
/** 描き直す間隔（ミリ秒。流れて見える速さ） */
const REDRAW_MS = 80;
/** 溶岩の模様の一辺（ドット。2 の累乗。繰り返して敷く） */
const TILE = 256;
/** 模様のコマ数 */
const FRAMES = 4;
/** 溶岩の色（暗い固まり → 明るい流れ。0xAABBGGRR） */
const abgr = (hex: string): number => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
};
const CRUST = ['#1f0703', '#2e0b03', '#3f0f04'].map(abgr);
/** 岩板の間を流れる溶岩（岩板に近い方から、真ん中へ明るく） */
const VEIN = ['#7a1804', '#c8320a', '#f26a0c', '#ffa81e', '#ffe07a'].map(abgr);
/** 岩板の数（繰り返しの一辺の中） */
const PLATES = 26;
/** 溶岩の先端（白く熱い）と、島のまわりの固まりかけ */
const FRONT = abgr('#ffd24a');
const FRONT_HOT = abgr('#fff3c0');
const RIM = abgr('#1c0703');

/** 決まった乱数（0〜1） */
function rnd(k: number, salt: number): number {
  const v = Math.sin(k * 127.1 + salt * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/** 周期 TILE でつながる、割れた岩板の間を溶岩が光る模様の 1 コマ。f は 0〜1 で一周（岩板がゆっくり揺れ、溶岩の明るさが脈打つ） */
function plateFrame(f: number): Uint32Array {
  const seeds: { x: number; y: number; k: number }[] = [];
  const p = f * Math.PI * 2;
  for (let k = 0; k < PLATES; k++) {
    seeds.push({ x: rnd(k, 1) * TILE + Math.sin(p + k) * 2.5, y: rnd(k, 2) * TILE + Math.cos(p + k * 1.7) * 2.5, k });
  }
  const t = new Uint32Array(TILE * TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      // 岩板の境を波打たせる
      const wx = x + Math.sin((y / TILE) * Math.PI * 6) * 4;
      const wy = y + Math.sin((x / TILE) * Math.PI * 6) * 4;
      let d1 = 1e9;
      let d2 = 1e9;
      let near = 0;
      for (const s of seeds) {
        const dx = Math.abs(wx - s.x) % TILE;
        const dy = Math.abs(wy - s.y) % TILE;
        const mx = Math.min(dx, TILE - dx);
        const my = Math.min(dy, TILE - dy);
        const d = mx * mx + my * my;
        if (d < d1) {
          d2 = d1;
          d1 = d;
          near = s.k;
        } else if (d < d2) d2 = d;
      }
      const border = Math.sqrt(d2) - Math.sqrt(d1);
      // 溶岩の幅は、場所と時間で少し変わる
      const width = 3.4 + 1.4 * Math.sin(p + (x + y * 0.5) * 0.05);
      if (border < width) {
        const k = 1 - border / width;
        t[y * TILE + x] = VEIN[Math.min(VEIN.length - 1, Math.floor(k * k * VEIN.length + 0.6))]!;
      } else {
        // 岩板: 板ごとの明るさ。ふちは熱で少し明るい
        const plate = Math.floor(rnd(near, 3) * 3);
        t[y * TILE + x] = CRUST[border < width + 2 ? 2 : plate]!;
      }
    }
  }
  return t;
}

/**
 * 溶岩の海（エンテイの ふんえん。07 の214章）: 壁ぎわから内側へ満ちる溶岩を、岩の島を抜いて床の上に描く。
 * 大きな範囲がだんだん変わるので、1 枚の絵を毎回書き換える。当たるかはシミュレーションが決める（lavaSeaHits）
 */
export class LavaSea {
  private image: Phaser.GameObjects.Image | null = null;
  private tex: Phaser.Textures.CanvasTexture | null = null;
  private w = 0;
  private h = 0;
  /** 溶岩が届く水位（ワールドの単位）。端からの距離に揺らぎを足したもの */
  private arrival = new Float32Array(0);
  /** 0: 溶岩になる・1: 島の中（描かない）・2: 島のまわり */
  private mask = new Uint8Array(0);
  private maskKey = '';
  private tiles: Uint32Array[] = [];
  private lastDraw = -1e9;
  private frame = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
  ) {}

  /** 溶岩の模様を作る（最初に使うときだけ） */
  private buildTiles(): void {
    if (this.tiles.length) return;
    for (let f = 0; f < FRAMES; f++) this.tiles.push(plateFrame(f / FRAMES));
  }

  private build(arena: NonNullable<World['arena']>): void {
    const w = Math.round((arena.halfWidth * 2) / DOT);
    const h = Math.round((arena.halfHeight * 2) / DOT);
    if (this.w === w && this.h === h && this.tex) return;
    this.destroy();
    this.w = w;
    this.h = h;
    const key = 'lava-sea';
    if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    this.tex = this.scene.textures.createCanvas(key, w, h);
    this.image = this.scene.add.image(arena.x, arena.y, key).setScale(DOT).setDepth(this.depth).setVisible(false);
    this.arrival = new Float32Array(w * h);
    this.mask = new Uint8Array(w * h);
    this.maskKey = '';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const edge = Math.min(x, w - 1 - x, y, h - 1 - y) * DOT;
        // 先端は波打つ。見た目は当たりより少し先へ行く（触れる前に見える）
        const wob = 12 + 9 * Math.sin(x * 0.041 + Math.sin(y * 0.03) * 2) + 7 * Math.sin(y * 0.067 + x * 0.013) + 4 * Math.sin((x + y) * 0.21);
        this.arrival[y * w + x] = Math.max(0, edge - wob);
      }
    }
  }

  private buildMask(arena: NonNullable<World['arena']>, islands: readonly { x: number; y: number; radius: number }[]): void {
    const key = islands.map((i) => `${i.x},${i.y},${i.radius}`).join(';');
    if (key === this.maskKey) return;
    this.maskKey = key;
    const { w, h, mask } = this;
    mask.fill(0);
    const left = arena.x - arena.halfWidth;
    const top = arena.y - arena.halfHeight;
    for (const isl of islands) {
      const cx = (isl.x - left) / DOT;
      const cy = (isl.y - top) / DOT;
      const r = isl.radius / DOT;
      const R = Math.ceil(r + 5);
      for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(h - 1, Math.ceil(cy + R)); y++) {
        for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(w - 1, Math.ceil(cx + R)); x++) {
          const d = Math.hypot(x - cx, y - cy);
          const i = y * w + x;
          if (d <= r) mask[i] = 1;
          else if (d <= r + 4 + Math.sin(Math.atan2(y - cy, x - cx) * 7) * 1.5 && mask[i] !== 1) mask[i] = 2;
        }
      }
    }
  }

  /** 毎フレーム呼ぶ。溶岩が無ければ隠す */
  update(world: World, timeMs: number): void {
    const arena = world.arena;
    const moves = world.rules.stage.moves;
    const hz = arena ? world.hazards.find((h) => h.activeTicks !== undefined && moves[h.move]?.lavaSea) : undefined;
    const sea = hz ? moves[hz.move]?.lavaSea : undefined;
    if (!arena || !hz || !sea) {
      this.image?.setVisible(false);
      return;
    }
    this.buildTiles();
    this.build(arena);
    this.image!.setVisible(true);
    if (timeMs - this.lastDraw < REDRAW_MS) return;
    this.lastDraw = timeMs;
    this.frame = (this.frame + 1) % (FRAMES * 3);
    const islands = world.hazards.filter((h) => moves[h.move]?.id === sea.islands);
    this.buildMask(arena, islands);
    const level = lavaSeaLevel(world, hz, moves[hz.move]!);
    const { w, h, arrival, mask } = this;
    const tile = this.tiles[Math.floor(this.frame / 3)]!;
    const ctx = this.tex!.getContext();
    const img = ctx.createImageData(w, h);
    const out = new Uint32Array(img.data.buffer);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      const ty = (y & (TILE - 1)) * TILE;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        const m = mask[i]!;
        if (m === 1) continue;
        const gap = level - arrival[i]!;
        if (gap <= 0) continue;
        if (m === 2) out[i] = RIM;
        else if (gap < 7) out[i] = FRONT_HOT;
        else if (gap < 16) out[i] = FRONT;
        else out[i] = tile[ty + (x & (TILE - 1))]!;
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
