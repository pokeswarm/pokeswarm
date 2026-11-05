import Phaser from 'phaser';
import { findEnemyIndex, type World } from '../../sim/world';

/** 鏡の 1 ドット（ワールドの単位）と、絵の大きさ（ドット） */
const DOT = 2;
const PANEL_W = 34;
const PANEL_H = 52;
/** 鏡の枚数・回る半径（ワールドの単位。奥行きを出すため縦を詰める）・回る速さ（ラジアン/秒） */
const PANELS = 6;
const ORBIT_X = 138;
const ORBIT_Y = 74;
const SPIN = 1.5;
/** ひびの段階（0 はひび無し）と、光の帯のコマ数 */
const LEVELS = 4;
const GLINT_FRAMES = 8;
const GLINT_MS = 70;

const abgr = (r: number, g: number, b: number, a = 1): number => ((Math.round(a * 255) << 24) | (b << 16) | (g << 8) | r) >>> 0;

/** 決まった乱数（0〜1） */
function rnd(a: number, b: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/** 鏡の外形の中か（上下の角を落とした細長い六角形）。中なら、ふちからの距離（ドット） */
function panelInside(x: number, y: number): number {
  const cx = (PANEL_W - 1) / 2;
  const cy = (PANEL_H - 1) / 2;
  const dx = Math.abs(x - cx);
  const dy = Math.abs(y - cy);
  const side = PANEL_W / 2 - dx;
  const top = PANEL_H / 2 - dy;
  const corner = (PANEL_W / 2 + PANEL_H / 2 - 10 - dx - dy) * 0.71;
  return Math.min(side, top, corner);
}

/** ひびの線の点（段階が上がると、前の段階の線はそのままで本数が増える） */
function crackMask(level: number): Uint8Array {
  const mask = new Uint8Array(PANEL_W * PANEL_H);
  if (level === 0) return mask;
  const cx = PANEL_W * 0.42;
  const cy = PANEL_H * 0.46;
  const lines = level * 3;
  for (let k = 0; k < lines; k++) {
    let a = rnd(k, 4) * Math.PI * 2;
    let x = cx;
    let y = cy;
    const len = 12 + rnd(k, 7) * 24;
    for (let s = 0; s < len; s++) {
      x += Math.cos(a);
      y += Math.sin(a);
      a += (rnd(k * 13 + s, 3) - 0.5) * 0.7;
      const i = Math.round(y) * PANEL_W + Math.round(x);
      if (i >= 0 && i < mask.length) mask[i] = 1;
    }
  }
  return mask;
}

/**
 * ミラーコート（スイクン。07 の223章）: スイクンのまわりを鏡の板が回り、光を反射する。受けたダメージが多いほどひびが入る
 * （割れたときの破片の数と同じ割合）。見た目だけ（破片はシミュレーション）
 */
export class MirrorCoat {
  private readonly images: Phaser.GameObjects.Image[] = [];
  private built = false;

  constructor(
    private readonly scene: Phaser.Scene,
    /** ボスの絵の深さ（奥の鏡はこれより下、手前の鏡は上） */
    private readonly bossDepth: number,
  ) {}

  private build(): void {
    if (this.built) return;
    this.built = true;
    const tx = this.scene.textures;
    for (let level = 0; level < LEVELS; level++) {
      const cracks = crackMask(level);
      for (let f = 0; f < GLINT_FRAMES; f++) {
        const key = `mirror-panel-${level}-${f}`;
        if (tx.exists(key)) tx.remove(key);
        const c = tx.createCanvas(key, PANEL_W, PANEL_H)!;
        const ctx = c.getContext();
        const img = ctx.createImageData(PANEL_W, PANEL_H);
        const out = new Uint32Array(img.data.buffer);
        // 斜めの光の帯が流れる（コマの終わりは鏡の外へ）
        const band = (f / GLINT_FRAMES) * (PANEL_W + PANEL_H + 30) - 15;
        for (let y = 0; y < PANEL_H; y++) {
          for (let x = 0; x < PANEL_W; x++) {
            const e = panelInside(x, y);
            if (e <= 0) continue;
            const i = y * PANEL_W + x;
            if (e < 1.4) {
              out[i] = abgr(34, 86, 124);
              continue;
            }
            if (e < 3) {
              out[i] = y < PANEL_H / 2 ? abgr(236, 250, 255) : abgr(150, 206, 232);
              continue;
            }
            // 鏡の面: 上は空の色、下は深い青へ
            const k = y / PANEL_H;
            let r = 176 - 92 * k;
            let g = 226 - 70 * k;
            let b = 246 - 36 * k;
            // 映り込みの淡い帯
            if (Math.sin((x + y * 0.5) * 0.28) > 0.72) {
              r += 26;
              g += 14;
              b += 6;
            }
            const d = Math.abs(x + y - band);
            if (d < 3.5) {
              r = 255;
              g = 255;
              b = 255;
            } else if (d < 7) {
              r = (r + 255) / 2;
              g = (g + 255) / 2;
              b = (b + 255) / 2;
            }
            out[i] = abgr(Math.round(r), Math.round(g), Math.round(b), 0.94);
            // ひび: 暗い線の隣が明るい
            if (cracks[i]) out[i] = abgr(22, 56, 88);
            else if (x > 0 && cracks[i - 1]) out[i] = abgr(240, 252, 255);
          }
        }
        ctx.putImageData(img, 0, 0);
        c.refresh();
      }
    }
  }

  update(world: World, timeMs: number): void {
    const moves = world.rules.stage.moves;
    const hz = world.hazards.find((h) => moves[h.move]?.mirrorShards && h.activeTicks === undefined);
    if (!hz) {
      for (const img of this.images) img.setVisible(false);
      return;
    }
    const i = findEnemyIndex(world, hz.dasher);
    const m = moves[hz.move]?.mirrorShards;
    if (i === -1 || !m) return;
    this.build();
    const e = world.enemies;
    const taken = Math.max(0, (hz.hpAtStart ?? e.hp[i]!) - e.hp[i]!);
    const count = Math.min(m.maxCount, m.minCount + ((taken / Math.max(1, e.maxHp[i]!)) * 100) * m.perHpPct);
    // 破片が増えるほど、ひびが増える
    const level = Math.min(LEVELS - 1, Math.ceil(((count - m.minCount) / Math.max(1, m.maxCount - m.minCount)) * (LEVELS - 1)));
    const elapsed = (hz.totalTicks - hz.ticksLeft) * world.dt;
    // 現れるときは外から寄ってくる
    const open = Math.min(1, elapsed / 0.35);
    const radius = 1.5 - 0.5 * open * open;
    for (let k = 0; k < PANELS; k++) {
      const img = this.images[k] ?? this.scene.add.image(0, 0, 'mirror-panel-0-0').setOrigin(0.5, 0.5);
      this.images[k] = img;
      const a = (k / PANELS) * Math.PI * 2 + elapsed * SPIN;
      const front = Math.sin(a) > 0;
      const frame = Math.floor(timeMs / GLINT_MS + k * 3) % GLINT_FRAMES;
      // 向こうと手前で深さを変え、回って見えるよう横の幅を変える
      img
        .setTexture(`mirror-panel-${level}-${frame}`)
        .setPosition(e.x[i]! + Math.cos(a) * ORBIT_X * radius, e.y[i]! + Math.sin(a) * ORBIT_Y * radius - 18)
        .setScale(DOT * (0.42 + 0.58 * Math.abs(Math.sin(a))), DOT * (0.86 + (front ? 0.14 : 0)))
        .setDepth(this.bossDepth + (front ? 0.02 : -0.02))
        .setAlpha(open)
        .setVisible(true);
    }
  }
}
