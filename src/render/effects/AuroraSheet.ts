import Phaser from 'phaser';
import type { World } from '../../sim/world';

/** 光線の絵の 1 ドット（ワールドの単位） */
const DOT = 2;
/** 光線の絵の長さ・太さ（ドット）。太さの半分が見える幅 */
const BEAM_L = 1250;
const BEAM_H = 84;
const FRAMES = 6;
const FRAME_MS = 80;

/** 凍った床の 1 ドットと、書き直す間隔 */
const ICE_DOT = 2;
const ICE_MS = 70;
/** 光線の幅（当たりの半径に合わせる。ワールドの単位） */
const ICE_HALF_WIDTH = 34;

const abgr = (r: number, g: number, b: number, a: number): number => ((Math.round(Math.max(0, Math.min(1, a)) * 255) << 24) | (b << 16) | (g << 8) | r) >>> 0;

/** 光の幕の色: 芯の白 → 明るい緑 → 水色 → 紫 → 透ける（t は芯からの距離 0〜1） */
const STOPS: readonly (readonly [number, number, number, number, number])[] = [
  [0, 255, 255, 255, 1],
  [0.16, 226, 255, 240, 0.98],
  [0.36, 118, 255, 196, 0.9],
  [0.56, 92, 226, 255, 0.72],
  [0.76, 168, 132, 255, 0.46],
  [1, 150, 96, 240, 0],
];
function auroraColor(t: number): [number, number, number, number] {
  const c = Math.max(0, Math.min(1, t));
  for (let i = 1; i < STOPS.length; i++) {
    const b = STOPS[i]!;
    if (c <= b[0]) {
      const a = STOPS[i - 1]!;
      const k = (c - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k, a[4] + (b[4] - a[4]) * k];
    }
  }
  return [150, 96, 240, 0];
}

/** 決まった乱数（0〜1） */
function rnd(a: number, b: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * オーロラビーム（スイクン。07 の222章）: 白い芯のまわりを緑・水色・紫の光の幕が揺れて流れる光線。
 * 長い帯を前もって描いて回す。通った跡の床には氷が筋で広がって溶ける（雑魚の下に描く）。当たりはシミュレーション
 */
export class AuroraSheet {
  private beam: Phaser.GameObjects.Image | null = null;
  private built = false;
  private ice: Phaser.GameObjects.Image | null = null;
  private iceTex: Phaser.Textures.CanvasTexture | null = null;
  private iceAmount = new Float32Array(0);
  private iceNoise = new Float32Array(0);
  private iceCrack = new Uint8Array(0);
  private iceW = 0;
  private iceH = 0;
  private lastIce = -1e9;
  private lastDir: number | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
    private readonly iceDepth: number,
  ) {}

  private buildBeam(): void {
    if (this.built) return;
    this.built = true;
    const mid = (BEAM_H - 1) / 2;
    for (let f = 0; f < FRAMES; f++) {
      const key = `aurora-beam-${f}`;
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
      const c = this.scene.textures.createCanvas(key, BEAM_L, BEAM_H)!;
      const ctx = c.getContext();
      const img = ctx.createImageData(BEAM_L, BEAM_H);
      const out = new Uint32Array(img.data.buffer);
      const p = (f / FRAMES) * Math.PI * 2;
      for (let u = 0; u < BEAM_L; u++) {
        // 根元は細く、すぐ広がる
        const open = Math.min(1, 0.45 + u / 26);
        // 幕全体がゆっくり波打つ
        const center = mid + 4.5 * Math.sin(u * 0.021 - p) + 2.5 * Math.sin(u * 0.057 + p * 2);
        // 幕の幅が場所で変わる
        const width = (mid - 4) * open * (0.8 + 0.14 * Math.sin(u * 0.017 + p) + 0.06 * Math.sin(u * 0.08 - p * 2));
        for (let v = 0; v < BEAM_H; v++) {
          const off = (v - center) / Math.max(1, width);
          const abs = Math.abs(off);
          if (abs >= 1) continue;
          // 色の境も波打つ（帯の縞に見せない）
          const t = abs + 0.07 * Math.sin(u * 0.11 - p * 2 + off * 3);
          const [r, g, b, a0] = auroraColor(t);
          // オーロラの細い光の筋（流れに直角）
          const ray = 0.78 + 0.22 * Math.sin(u * 0.46 + Math.sin(u * 0.05 - p) * 3);
          const a = t < 0.2 ? a0 : a0 * ray;
          out[v * BEAM_L + u] = abgr(Math.round(r), Math.round(g), Math.round(b), a);
        }
      }
      ctx.putImageData(img, 0, 0);
      c.refresh();
    }
    this.beam = this.scene.add.image(0, 0, 'aurora-beam-0').setOrigin(0, 0.5).setScale(DOT).setDepth(this.depth).setVisible(false);
  }

  private buildIce(arena: NonNullable<World['arena']>): void {
    const w = Math.round((arena.halfWidth * 2) / ICE_DOT);
    const h = Math.round((arena.halfHeight * 2) / ICE_DOT);
    if (this.iceTex && this.iceW === w && this.iceH === h) return;
    this.ice?.destroy();
    const key = 'aurora-ice';
    if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    this.iceTex = this.scene.textures.createCanvas(key, w, h)!;
    this.ice = this.scene.add.image(arena.x, arena.y, key).setScale(ICE_DOT).setDepth(this.iceDepth);
    this.iceW = w;
    this.iceH = h;
    this.iceAmount = new Float32Array(w * h);
    this.iceNoise = new Float32Array(w * h);
    this.iceCrack = new Uint8Array(w * h);
    const cell = 26;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // 薄い氷の板: 板ごとに溶ける早さが違い、板の境が白いひびになる
        const cx = Math.floor(x / cell);
        const cy = Math.floor(y / cell);
        let d1 = 1e9;
        let d2 = 1e9;
        let id = 0;
        for (let j = cy - 1; j <= cy + 1; j++) {
          for (let i = cx - 1; i <= cx + 1; i++) {
            const k = i * 73 + j * 1009;
            const d = Math.hypot((i + rnd(k, 1)) * cell - x, (j + rnd(k, 2)) * cell - y);
            if (d < d1) {
              d2 = d1;
              d1 = d;
              id = k;
            } else if (d < d2) d2 = d;
          }
        }
        this.iceNoise[y * w + x] = rnd(id, 3);
        const border = d2 - d1;
        this.iceCrack[y * w + x] = border < 0.9 ? 2 : border < 2 ? 1 : 0;
      }
    }
  }

  /** 線の上の床を凍らせる */
  private paintLine(arena: NonNullable<World['arena']>, x0: number, y0: number, angle: number, length: number): void {
    const { iceW: w, iceH: h, iceAmount } = this;
    const left = arena.x - arena.halfWidth;
    const top = arena.y - arena.halfHeight;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const half = Math.ceil(ICE_HALF_WIDTH / ICE_DOT);
    for (let d = 0; d < length; d += ICE_DOT) {
      const cx = (x0 + dx * d - left) / ICE_DOT;
      const cy = (y0 + dy * d - top) / ICE_DOT;
      if (cx < -half || cy < -half || cx >= w + half || cy >= h + half) continue;
      for (let o = -half; o <= half; o++) {
        const px = Math.round(cx - dy * o);
        const py = Math.round(cy + dx * o);
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        iceAmount[py * w + px] = 1;
      }
    }
  }

  update(world: World, timeMs: number): void {
    const arena = world.arena;
    const moves = world.rules.stage.moves;
    const hz = arena ? world.hazards.find((h) => moves[h.move]?.auroraBeam) : undefined;
    if (hz) this.buildBeam();
    const active = hz && hz.activeTicks !== undefined;
    if (this.beam) this.beam.setVisible(false);
    if (arena && hz && active && this.beam) {
      const mv = moves[hz.move]!;
      const total = Math.max(1, Math.round((mv.sweep?.seconds ?? 1) / world.dt));
      const left = hz.activeTicks!;
      const frame = Math.floor(timeMs / FRAME_MS) % FRAMES;
      const dir = Math.atan2(hz.dirY, hz.dirX);
      // 消える前に薄くする
      this.beam
        .setTexture(`aurora-beam-${frame}`)
        .setPosition(hz.x, hz.y)
        .setRotation(dir)
        .setCrop(0, 0, Math.min(BEAM_L, Math.ceil(hz.length / DOT)), BEAM_H)
        .setAlpha(Math.min(1, left / Math.max(1, total * 0.08)))
        .setVisible(true);
    }
    // 凍った床
    if (!arena) {
      this.ice?.setVisible(false);
      this.lastDir = null;
      return;
    }
    // 予告の間に用意しておく（動き出してから止まらないように）
    if (hz) this.buildIce(arena);
    if (!this.iceTex || !this.ice) return;
    if (timeMs - this.lastIce < ICE_MS) return;
    const step = Math.min(250, timeMs - this.lastIce) / 1000;
    this.lastIce = timeMs;
    const { iceW: w, iceH: h, iceAmount, iceNoise, iceCrack } = this;
    // 消えるまでの秒数はデータの通り
    const seconds = hz ? (moves[hz.move]?.sweepTrail?.seconds ?? 1.5) : 1.5;
    const decay = step / seconds;
    if (active && hz) {
      const dir = Math.atan2(hz.dirY, hz.dirX);
      const from = this.lastDir ?? dir;
      // 回った分の間も凍らせる（筋に隙間ができないように）
      let diff = dir - from;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const n = Math.max(1, Math.ceil(Math.abs(diff) / 0.02));
      for (let k = 1; k <= n; k++) this.paintLine(arena, hz.x, hz.y, from + (diff * k) / n, hz.length);
      this.lastDir = dir;
    } else this.lastDir = null;
    const ctx = this.iceTex.getContext();
    const img = ctx.createImageData(w, h);
    const out = new Uint32Array(img.data.buffer);
    const thin = abgr(176, 220, 240, 0.26);
    const thick = abgr(196, 232, 248, 0.34);
    const line = abgr(226, 246, 254, 0.42);
    const crack = abgr(248, 253, 255, 0.6);
    let any = false;
    for (let i = 0; i < iceAmount.length; i++) {
      const v = iceAmount[i]!;
      if (v <= 0) continue;
      any = true;
      const next = v - decay;
      iceAmount[i] = next < 0 ? 0 : next;
      const n = iceNoise[i]!;
      // 量が減ると、板ごとに溶けて消える
      if (n > v * 1.25) continue;
      const c = iceCrack[i]!;
      out[i] = c === 2 ? crack : c === 1 ? line : n > 0.5 ? thick : thin;
    }
    this.ice.setVisible(any);
    if (!any) return;
    ctx.putImageData(img, 0, 0);
    this.iceTex.refresh();
  }
}
