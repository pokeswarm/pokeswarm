import Phaser from 'phaser';
import type { World } from '../../sim/world';

/** 波の絵の 1 ドット（ワールドの単位） */
const DOT = 2;
/** 波の絵の横の長さ（ドット）と、コマ数・コマの間隔 */
const STRIP_W = 210;
const FRAMES = 6;
const FRAME_MS = 90;
/** 当たりの真ん中から、波の先頭までの距離（ワールドの単位。当たりの半径に合わせる） */
const FRONT_AHEAD = 72;
/** 切れ目のふちのしぶきの高さ（ドット） */
const EDGE_H = 26;

const abgr = (r: number, g: number, b: number, a: number): number => ((Math.round(Math.max(0, Math.min(1, a)) * 255) << 24) | (b << 16) | (g << 8) | r) >>> 0;

/** 決まった乱数（0〜1） */
function rnd(a: number, b: number, salt: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7 + salt * 74.7) * 43758.5453;
  return v - Math.floor(v);
}

/** 色を混ぜる */
function mix(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  return [Math.round(a[0]! + (b[0]! - a[0]!) * t), Math.round(a[1]! + (b[1]! - a[1]!) * t), Math.round(a[2]! + (b[2]! - a[2]!) * t)];
}

/** 波の先頭の揺れ（y・コマで変わる。コマは 1 周でつながる） */
function frontWobble(y: number, f: number): number {
  const p = (f / FRAMES) * Math.PI * 2;
  return 6 * Math.sin(y * 0.041 + p) + 4 * Math.sin(y * 0.097 - p * 2) + 2.5 * Math.sin(y * 0.23 + p * 3);
}

/**
 * 波の 1 コマの 1 ドット。d は先頭から後ろへの距離（ドット）。
 * 先頭: 白く崩れる波頭 → 波頭の下の深い影 → 明るい波の面 → 後ろへ透けていく薄い水
 */
function waterPixel(x: number, y: number, d: number, f: number): number {
  if (d < 0) return 0;
  const p = (f / FRAMES) * Math.PI * 2;
  // 波頭の先のしぶき（粒）
  if (d < 7) {
    const n = rnd(Math.floor(x / 2), Math.floor(y / 2), f + 1);
    return n > 0.42 + d * 0.02 ? 0 : abgr(250, 254, 255, 0.95);
  }
  // 崩れる白い波頭。泡の間から水色がのぞく
  if (d < 24) {
    const foam = Math.sin(y * 0.33 + d * 0.5 - p) + Math.sin(y * 0.14 - d * 0.31 + p * 2);
    if (foam > 0.9) return abgr(150, 220, 244, 0.98);
    return d < 17 ? abgr(255, 255, 255, 1) : abgr(224, 245, 252, 1);
  }
  // 波頭の下にできる深い影（高さが出る）
  if (d < 36) {
    const k = (d - 24) / 12;
    const c = mix([12, 70, 128], [24, 112, 176], k);
    return abgr(c[0], c[1], c[2], 0.96);
  }
  // 波の面: 明るい水色から青へ。先頭へ流れる白い筋
  if (d < 78) {
    const k = (d - 36) / 42;
    const c = mix([46, 164, 222], [24, 112, 178], k);
    const s = Math.sin(y * 0.085 + Math.sin(d * 0.06 + p) * 1.8);
    if (Math.abs(s) < 0.035 + 0.02 * (1 - k)) return abgr(196, 238, 250, 0.9);
    return abgr(c[0], c[1], c[2], 0.9 - k * 0.22);
  }
  // 後ろの薄い水: だんだん透けて床が見える。泡の網目が流れる
  const k = (d - 78) / (STRIP_W - 78);
  const alpha = 0.62 * (1 - k) * (1 - k);
  const a = Math.sin(y * 0.11 + Math.sin(d * 0.09 - p) * 2.2);
  const b = Math.sin(d * 0.16 + Math.sin(y * 0.07 + p) * 2);
  if (Math.abs(a * b) < 0.035) return abgr(210, 240, 250, alpha + 0.2 * (1 - k));
  const c = mix([26, 120, 186], [20, 92, 152], k);
  return abgr(c[0], c[1], c[2], alpha);
}

/**
 * なみのり（スイクン。07 の221章）: マップの上下いっぱいの本物の波。絵は 1 枚の長い帯を前もって描いて動かす（速い波でも滑らかに）。
 * 切れ目のふちはしぶきで隠し、通った跡は床が濡れて光る。当たりはシミュレーション（線の技）
 */
export class WaveSheet {
  private readonly strips: Phaser.GameObjects.Image[] = [];
  private readonly edges: Phaser.GameObjects.Image[] = [];
  private readonly wets: Phaser.GameObjects.Image[] = [];
  private built = false;
  private height = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
    private readonly wetDepth: number,
  ) {}

  private build(arena: NonNullable<World['arena']>): void {
    const h = Math.round((arena.halfHeight * 2) / DOT);
    if (this.built && this.height === h) return;
    this.built = true;
    this.height = h;
    const tx = this.scene.textures;
    const canvas = (key: string, w: number, ht: number): Phaser.Textures.CanvasTexture => {
      if (tx.exists(key)) tx.remove(key);
      return tx.createCanvas(key, w, ht)!;
    };
    for (let f = 0; f < FRAMES; f++) {
      const c = canvas(`wave-strip-${f}`, STRIP_W, h);
      const ctx = c.getContext();
      const img = ctx.createImageData(STRIP_W, h);
      const out = new Uint32Array(img.data.buffer);
      for (let y = 0; y < h; y++) {
        const wob = frontWobble(y, f) + 12;
        for (let x = 0; x < STRIP_W; x++) out[y * STRIP_W + x] = waterPixel(x, y, STRIP_W - 1 - x - wob, f);
      }
      ctx.putImageData(img, 0, 0);
      c.refresh();
      // 切れ目のふち: 下の端がぎざぎざのしぶき（上の端を切り口に合わせる）
      const e = canvas(`wave-edge-${f}`, STRIP_W, EDGE_H);
      const ec = e.getContext();
      const ei = ec.createImageData(STRIP_W, EDGE_H);
      const eo = new Uint32Array(ei.data.buffer);
      const p = (f / FRAMES) * Math.PI * 2;
      for (let x = 0; x < STRIP_W; x++) {
        const d = STRIP_W - 1 - x - 12;
        if (d < 0) continue;
        const fade = d < 78 ? 1 : Math.max(0, 1 - (d - 78) / (STRIP_W - 78)) ** 2;
        const reach = (d < 40 ? EDGE_H - 3 : 10 + 8 * (1 - d / STRIP_W)) * (0.72 + 0.28 * Math.sin(x * 0.31 + p) * Math.sin(x * 0.13 - p * 2));
        for (let y = 0; y < EDGE_H; y++) {
          if (y > reach) {
            // 飛び散る粒
            if (y < reach + 7 && rnd(x >> 1, y >> 1, f + 3) > 0.74) eo[y * STRIP_W + x] = abgr(250, 254, 255, 0.9 * fade);
            continue;
          }
          eo[y * STRIP_W + x] = abgr(246, 252, 255, 0.98 * fade);
        }
      }
      ec.putImageData(ei, 0, 0);
      e.refresh();
    }
    // 濡れた床（後ろへ行くほど乾く。前が濃い）
    const wet = canvas('wave-wet', 128, 2);
    const wc = wet.getContext();
    const wi = wc.createImageData(128, 2);
    const wo = new Uint32Array(wi.data.buffer);
    for (let x = 0; x < 128; x++) {
      const v = abgr(70, 170, 220, 0.18 * (x / 127));
      wo[x] = v;
      wo[128 + x] = v;
    }
    wc.putImageData(wi, 0, 0);
    wet.refresh();
  }

  update(world: World, timeMs: number): void {
    const arena = world.arena;
    const moves = world.rules.stage.moves;
    let used = 0;
    let usedEdge = 0;
    let usedWet = 0;
    if (arena) {
      for (const h of world.hazards) {
        const mv = moves[h.move];
        if (!mv?.waterWall) continue;
        // 予告の間に絵を用意しておく（動き出してから止まらないように）
        this.build(arena);
        if (h.activeTicks === undefined || h.vx === undefined) continue;
        const total = Math.max(1, Math.round((mv.activeSeconds ?? 1) / world.dt));
        const left = h.activeTicks;
        const fade = Math.min(1, left / Math.max(1, total * 0.12));
        const dirX = Math.sign(h.vx) || 1;
        const top = arena.y - arena.halfHeight;
        const frame = Math.floor(timeMs / FRAME_MS) % FRAMES;
        const frontX = h.x + dirX * FRONT_AHEAD;
        const stripWorld = STRIP_W * DOT;
        // 通った跡の濡れた床
        const startX = arena.x - dirX * arena.halfWidth;
        const wetLen = Math.max(0, Math.abs(frontX - startX) - 60);
        if (wetLen > 0) {
          const wet = this.wets[usedWet] ?? this.scene.add.image(0, 0, 'wave-wet').setOrigin(0, 0).setDepth(this.wetDepth);
          this.wets[usedWet++] = wet;
          wet.setFlipX(dirX < 0).setPosition(dirX > 0 ? startX : startX - wetLen, h.y).setDisplaySize(wetLen, h.length).setAlpha(fade).setVisible(true);
        }
        // 波の本体（線の長さに切る）
        const img = this.strips[used] ?? this.scene.add.image(0, 0, `wave-strip-${frame}`).setOrigin(0, 0).setScale(DOT).setDepth(this.depth);
        this.strips[used++] = img;
        const cropY = Math.max(0, Math.round((h.y - top) / DOT));
        const cropH = Math.round(h.length / DOT);
        img
          .setTexture(`wave-strip-${frame}`)
          .setFlipX(dirX < 0)
          .setPosition(dirX > 0 ? frontX - stripWorld : frontX, top)
          .setCrop(0, cropY, STRIP_W, cropH)
          .setAlpha(fade)
          .setVisible(true);
        // 切れ目のふち（壁の側にはいらない）
        const gapAtEnd = h.y + h.length < arena.y + arena.halfHeight - 1;
        const gapAtStart = h.y > top + 1;
        const place = (y: number, flipY: boolean): void => {
          const e = this.edges[usedEdge] ?? this.scene.add.image(0, 0, `wave-edge-${frame}`).setOrigin(0, 0).setScale(DOT).setDepth(this.depth + 0.001);
          this.edges[usedEdge++] = e;
          e.setTexture(`wave-edge-${frame}`)
            .setFlipX(dirX < 0)
            .setFlipY(flipY)
            .setPosition(dirX > 0 ? frontX - stripWorld : frontX, flipY ? y - EDGE_H * DOT : y)
            .setAlpha(fade)
            .setVisible(true);
        };
        // 下へ切れる帯の端は下向きのしぶき、上へ切れる帯の端は上向きのしぶき
        if (gapAtEnd) place(h.y + h.length - 8, false);
        if (gapAtStart) place(h.y + 8, true);
      }
    }
    for (let k = used; k < this.strips.length; k++) this.strips[k]!.setVisible(false);
    for (let k = usedEdge; k < this.edges.length; k++) this.edges[k]!.setVisible(false);
    for (let k = usedWet; k < this.wets.length; k++) this.wets[k]!.setVisible(false);
  }
}
