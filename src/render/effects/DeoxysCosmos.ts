import Phaser from 'phaser';
import { findEnemyIndex, type World } from '../../sim/world';

/**
 * デオキシスの技の絵（07 の293・294章）。ミュウツー（MewtwoPsychic）と同じく、1 ドットずつ計算したドット絵のテクスチャをコマで動かして描く。
 * 色はすべて不透明（半透明の面は使わない）。薄さ・消え際はディザ（市松の点の密度）で出す。見た目だけ（当たりはシミュレーション）
 */

/** 絵の 1 ドット（ワールドの単位） */
const DOT = 2;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** ディザのしきい値（0〜1）。密度 d がこれより大きい点だけ描く */
const th = (x: number, y: number): number => (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16;
const on = (d: number, x: number, y: number): boolean => d > th(x, y);

/** 不透明の色（0xRRGGBB → 画像の 1 点） */
const c = (hex: number): number => ((255 << 24) | ((hex & 0xff) << 16) | (hex & 0xff00) | ((hex >> 16) & 0xff)) >>> 0;

function rnd(a: number, b: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

type Hz = World['hazards'][number];
type Boss = { x: number; y: number; r: number };

/** 光線の 1 区切りの長さ・太さ（ドット）。らせんの 1 周が 1 区切り（つなぐと切れ目が出ない） */
const BEAM_W = 48;
const BEAM_H = 66;
const FR = 8;

interface Lingering {
  kind: 'zap' | 'star' | 'shade' | 'mirror' | 'smash';
  x: number;
  y: number;
  r: number;
  dirX: number;
  dirY: number;
  seed: number;
  startMs: number;
}
const LINGER_MS: Record<Lingering['kind'], number> = { zap: 640, star: 480, shade: 720, mirror: 560, smash: 480 };

export class DeoxysCosmos {
  private built = false;
  private readonly pool: Phaser.GameObjects.Image[] = [];
  private used = 0;
  /** 小さな不透明の点（火花・光の粒）だけを描く */
  private readonly dots: Phaser.GameObjects.Graphics;
  private readonly lingering = new Map<string, Lingering>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
    private readonly floorDepth: number,
    private readonly frontDepth: number,
  ) {
    this.dots = scene.add.graphics().setDepth(frontDepth + 0.01);
  }

  // ───────────────────────── 絵を作る ─────────────────────────

  private put(key: string, w: number, h: number, px: (x: number, y: number) => number): void {
    const tx = this.scene.textures;
    if (tx.exists(key)) tx.remove(key);
    const cv = tx.createCanvas(key, w, h)!;
    const ctx = cv.getContext();
    const img = ctx.createImageData(w, h);
    const out = new Uint32Array(img.data.buffer);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = px(x, y);
    ctx.putImageData(img, 0, 0);
    cv.refresh();
  }

  private build(): void {
    if (this.built) return;
    this.built = true;
    this.buildBeam();
    this.buildOrbs();
    this.buildStars();
    this.buildShade();
    this.buildHelix();
    this.buildShells();
    this.buildZap();
    this.buildRings();
  }

  /** サイコブーストの光線の 1 区切り: 白い芯・桃色・紅紫・紫の外側（外はディザで細る）。橙と薄紫の 2 本のらせんと横木 */
  private buildBeam(): void {
    for (let f = 0; f < 2; f++) {
      this.put(`dx-beam-${f}`, BEAM_W, BEAM_H, (x, y) => {
        const v = Math.abs((y - (BEAM_H - 1) / 2) / (BEAM_H / 2));
        const wob = f ? 0.04 * Math.sin((x / BEAM_W) * Math.PI * 4) : 0;
        const a = (x / BEAM_W) * Math.PI * 2;
        const sA = (BEAM_H / 2) * 0.72 * Math.sin(a);
        const yy = y - (BEAM_H - 1) / 2;
        const front = Math.cos(a) > 0;
        // らせん（手前の 1 本を上に）
        if (Math.abs(yy - sA) < 1.6) return c(front ? 0xffab40 : 0xb388ff);
        if (Math.abs(yy + sA) < 1.6) return c(front ? 0xb388ff : 0xffab40);
        // 横木（塩基の対）: らせんの間だけ、点々で
        if (x % 12 === 6 && Math.abs(yy) < Math.abs(sA) && (y & 1) === 0) return c(0xfce4ec);
        const vv = v + wob;
        if (vv < 0.16) return c(0xffffff);
        if (vv < 0.34) return c(rnd(x, y + f) > 0.85 ? 0xffffff : 0xff80ab);
        if (vv < 0.56) return c(0xff4081);
        if (vv < 0.78) return c(0xd500f9);
        if (vv < 1 && on((1 - vv) / 0.22, x, y)) return c(0x7c4dff);
        return 0;
      });
    }
    // 口元の光の花: 8 枚の花びらが回る
    for (let f = 0; f < FR; f++) {
      const S = 40;
      this.put(`dx-flare-${f}`, S, S, (x, y) => {
        const dx = x - (S - 1) / 2;
        const dy = y - (S - 1) / 2;
        const r = Math.hypot(dx, dy) / (S / 2);
        const a = Math.atan2(dy, dx) + (f / FR) * (Math.PI / 4);
        const petal = 0.55 + 0.45 * Math.abs(Math.cos(a * 4));
        if (r < 0.3) return c(0xffffff);
        if (r < 0.55 * petal + 0.1) return c(0xff80ab);
        if (r < petal) return on((petal - r) / 0.3, x, y) ? c(0xd500f9) : 0;
        return 0;
      });
    }
  }

  /** ためる玉（念の玉・電気の玉）: 渦の筋が回る */
  private buildOrbs(): void {
    const S = 32;
    for (let f = 0; f < FR; f++) {
      this.put(`dx-psyorb-${f}`, S, S, (x, y) => {
        const dx = x - (S - 1) / 2;
        const dy = y - (S - 1) / 2;
        const r = Math.hypot(dx, dy) / (S / 2);
        if (r > 1) return 0;
        const sw = Math.sin(Math.atan2(dy, dx) * 3 + r * 7 - (f / FR) * Math.PI * 2);
        if (r < 0.3) return c(0xffffff);
        if (r < 0.6) return c(sw > 0.3 ? 0xffc1e3 : 0xff4081);
        if (r < 0.85) return c(sw > 0.4 ? 0xea80fc : 0xaa00ff);
        return on((1 - r) / 0.15, x, y) && sw > -0.2 ? c(0x7c4dff) : 0;
      });
      const Z = 40;
      this.put(`dx-zap-${f}`, Z, Z, (x, y) => {
        const dx = x - (Z - 1) / 2;
        const dy = y - (Z - 1) / 2;
        const r = Math.hypot(dx, dy) / (Z / 2);
        if (r > 1) return 0;
        const a = Math.atan2(dy, dx);
        // 玉の面を走る稲妻の筋（コマごとに場所が変わる）
        const arc = Math.abs(Math.sin(a * 5 + Math.sin(r * 9 + f * 1.7) * 1.4 + f));
        if (r < 0.28) return c(0xffffff);
        if (r < 0.62) return c(arc < 0.12 ? 0xffffff : 0xffee58);
        if (r < 0.86) return c(arc < 0.16 ? 0xe1f5fe : 0xfbc02d);
        return arc < 0.22 && on((1 - r) / 0.14 + 0.2, x, y) ? c(0x80d8ff) : 0;
      });
    }
  }

  /** 星（黄色のスピードスター・青白い流れ星）と、落ちた所のきらめき */
  private buildStars(): void {
    const S = 15;
    const star = (key: string, edge: number, body: number, core: number): void =>
      this.put(key, S, S, (x, y) => {
        const dx = x - (S - 1) / 2;
        const dy = y - (S - 1) / 2 - 0.5;
        const r = Math.hypot(dx, dy) / (S / 2);
        const a = Math.atan2(dy, dx) + Math.PI / 2;
        const k = Math.abs(((((a / (Math.PI * 2)) * 5) % 1) + 1) % 1 - 0.5) * 2;
        const lim = 0.42 + 0.58 * (1 - k);
        if (r > lim) return 0;
        if (r < lim * 0.45) return c(core);
        if (r > lim - 0.16) return c(edge);
        return c(body);
      });
    star('dx-star', 0xf57f17, 0xffd600, 0xfffde7);
    star('dx-star-blue', 0x3949ab, 0x82b1ff, 0xffffff);
    for (let f = 0; f < 6; f++) {
      const S2 = 24;
      const t = f / 5;
      this.put(`dx-sparkle-${f}`, S2, S2, (x, y) => {
        const dx = x - (S2 - 1) / 2;
        const dy = y - (S2 - 1) / 2;
        const r = Math.hypot(dx, dy) / (S2 / 2);
        const cross = Math.min(Math.abs(dx), Math.abs(dy)) < 1.2 - t && r < 1 - t * 0.3;
        const ring = Math.abs(r - (0.35 + 0.6 * t)) < 0.08;
        if (r < 0.25 * (1 - t)) return c(0xffffff);
        if (cross) return c(t < 0.5 ? 0xffffff : 0xb3e5fc);
        if (ring && on(1 - t, x, y)) return c(0x82b1ff);
        return 0;
      });
    }
    // 落ちる所の印（青い輪。ディザで中を透かす）
    this.put('dx-mark', 48, 22, (x, y) => {
      const nx = (x - 23.5) / 24;
      const ny = (y - 10.5) / 11;
      const r = Math.hypot(nx, ny);
      if (r > 1) return 0;
      if (r > 0.86) return c(0x82b1ff);
      return on(0.25 * r, x, y) ? c(0x1a237e) : 0;
    });
  }

  /** ナイトヘッド: 地面にしみ出す影（縁で紫の影の炎がゆらめく）と、立ち昇る黒い柱 */
  private buildShade(): void {
    for (let f = 0; f < FR; f++) {
      const W = 76;
      const H = 40;
      this.put(`dx-shade-${f}`, W, H, (x, y) => {
        const nx = (x - (W - 1) / 2) / (W / 2);
        const ny = (y - H * 0.62) / (H * 0.38);
        const r = Math.hypot(nx, ny);
        // 縁から上へ伸びる炎の舌
        const tongue = Math.max(0, Math.sin(x * 0.7 + f * 0.8) * 0.5 + Math.sin(x * 0.31 - f * 0.5) * 0.5);
        const top = H * 0.62 - H * 0.38 * Math.sqrt(Math.max(0, 1 - nx * nx)) - tongue * 9;
        if (r <= 1) return r < 0.7 ? c(0x0d0614) : c(r < 0.86 ? 0x1f0b33 : 0x4a148c);
        if (Math.abs(nx) < 0.95 && y >= top && y < H * 0.62) return on(0.8 - (H * 0.62 - y) / 14, x, y) ? c(y < top + 2 ? 0x9575cd : 0x5e35b1) : 0;
        return 0;
      });
      const PW = 76;
      const PH = 220;
      const t = f / (FR - 1);
      this.put(`dx-pillar-${f}`, PW, PH, (x, y) => {
        const fromBottom = (PH - 1 - y) / PH;
        const rise = Math.min(1, t * 4);
        if (fromBottom > rise) return 0;
        const fade = 1 - Math.max(0, (t - 0.35) / 0.65);
        // 下が太く、上へ炎のように細る（ゆらぐ舌）
        const half = (PW / 2) * Math.pow(Math.max(0, 1 - fromBottom), 0.8) * (0.8 + 0.2 * Math.sin(y * 0.22 + f * 0.9)) * (0.9 + 0.1 * Math.sin(y * 0.6 - f));
        const dx = Math.abs(x - (PW - 1) / 2);
        if (dx > half) return 0;
        const edge = dx / Math.max(1, half);
        // 上へ流れる影の筋
        const streak = Math.sin(y * 0.35 + x * 1.3 + f * 1.6) > 0.7;
        const d = fade * (1 - fromBottom * 0.3);
        if (!on(d, x, y)) return 0;
        if (edge > 0.8) return c(0x7c4dff);
        if (streak) return c(0x4527a0);
        return c(edge > 0.5 ? 0x311b92 : 0x12061f);
      });
    }
  }

  /** DNA の二重らせん（縦）: 念の色（桃色と橙）と、回復の色（緑と白） */
  private buildHelix(): void {
    const W = 22;
    const H = 72;
    for (const [name, a1, a2, rung] of [
      ['psy', 0xff80ab, 0xffab40, 0xfce4ec],
      ['heal', 0x69f0ae, 0xffffff, 0xccff90],
    ] as const) {
      for (let f = 0; f < FR; f++) {
        this.put(`dx-helix-${name}-${f}`, W, H, (x, y) => {
          const a = (y / H) * Math.PI * 4 + (f / FR) * Math.PI * 2;
          const s = (W / 2 - 2) * Math.sin(a);
          const xx = x - (W - 1) / 2;
          const front = Math.cos(a) > 0;
          if (Math.abs(xx - s) < 1.4) return c(front ? a1 : a2);
          if (Math.abs(xx + s) < 1.4) return c(front ? a2 : a1);
          if (y % 9 === 4 && Math.abs(xx) < Math.abs(s)) return c(rung);
          return 0;
        });
      }
    }
  }

  /** 体を包む殻: 光の殻（姿の変わり目）・鋼の六角の殻（てっぺき）・虹色の結晶の殻（ミラーコート）。面はディザで透かす */
  private buildShells(): void {
    const W = 72;
    const H = 84;
    const cols = [0xff80ab, 0xffd180, 0xffff8d, 0xb9f6ca, 0x80d8ff, 0xb388ff];
    for (let f = 0; f < FR; f++) {
      const band = (f / FR) * (W + H) * 1.4 - 30;
      const shell = (key: string, px: (nx: number, ny: number, z: number, x: number, y: number, glint: boolean) => number): void =>
        this.put(key, W, H, (x, y) => {
          const nx = (x - (W - 1) / 2) / (W / 2);
          const ny = (y - (H - 1) / 2) / (H / 2);
          const r = Math.hypot(nx, ny);
          if (r > 1) return 0;
          return px(nx, ny, Math.sqrt(Math.max(0, 1 - r * r)), x, y, Math.abs(x + y * 0.7 - band) < 4);
        });
      // 光の殻: 桃色の縁、中は点々の光、斜めの光の帯
      shell(`dx-shell-light-${f}`, (_nx, _ny, z, x, y, glint) => {
        if (z < 0.3) return c(glint ? 0xffffff : 0xff80ab);
        if (glint) return on(0.6, x, y) ? c(0xffffff) : 0;
        // 中は格子に見えないよう、ばらばらの光の粒
        return rnd(x * 3 + f, y) > 0.9 - 0.12 * (1 - z) ? c(rnd(x, y * 5 + f) > 0.5 ? 0xffffff : 0xf8bbd0) : 0;
      });
      // 鋼の殻: 六角の格子（球に貼ったように縮める）。線は銀、面は灰色の点々
      shell(`dx-shell-steel-${f}`, (nx, ny, z, x, y, glint) => {
        const u = (nx / (0.55 + 0.45 * z)) * 4.2;
        const v = (ny / (0.55 + 0.45 * z)) * 4.2;
        const q = (u * 2) / 3;
        const rr = -u / 3 + (Math.sqrt(3) / 3) * v;
        const edge = Math.max(Math.abs(q - Math.round(q)), Math.abs(rr - Math.round(rr)), Math.abs(-q - rr - Math.round(-q - rr)));
        if (z < 0.25) return c(glint ? 0xffffff : 0xb0bec5);
        if (edge > 0.4) return c(glint ? 0xffffff : edge > 0.46 ? 0x78909c : 0xcfd8dc);
        return on(0.3 + 0.3 * (1 - z), x, y) ? c(glint ? 0xeceff1 : 0x607d8b) : 0;
      });
      // 結晶の殻: 8 枚の三角の面（虹の色）、面の境に白い線
      shell(`dx-shell-crystal-${f}`, (nx, ny, z, x, y, glint) => {
        const a = Math.atan2(ny, nx) + (f / FR) * (Math.PI / 4);
        const seg = ((a / (Math.PI * 2)) * 8 + 8) % 8;
        const k = Math.floor(seg);
        const nearEdge = Math.min(seg - k, 1 - (seg - k)) < 0.06 + 0.04 * (1 - z);
        if (z < 0.22) return c(0xe1f5fe);
        if (nearEdge || glint) return c(0xffffff);
        return on(0.3 + 0.25 * (1 - z), x, y) ? c(cols[k % cols.length]!) : 0;
      });
    }
    // 結晶のひび（受けた量が多いと出す）
    this.put('dx-crystal-crack', W, H, (x, y) => {
      for (let k = 0; k < 6; k++) {
        const a = rnd(k, 9) * Math.PI * 2;
        const t = ((x - W / 2) * Math.cos(a) + (y - H / 2) * Math.sin(a)) / (W / 2);
        const dist = Math.abs(-(x - W / 2) * Math.sin(a) + (y - H / 2) * Math.cos(a) + Math.sin(t * 9 + k) * 2);
        if (t > 0.15 && t < 0.95 && dist < 0.9) return c(0xffffff);
      }
      return 0;
    });
  }

  /** でんじほう: 稲妻（4 種類）・大放電（広がって消える 8 コマ） */
  private buildZap(): void {
    const BW = 56;
    const BH = 15;
    for (let k = 0; k < 4; k++) {
      const path: number[] = [];
      let yy = BH / 2;
      for (let x = 0; x < BW; x++) {
        if (x % 6 === 0) yy = BH / 2 + (rnd(k, x) - 0.5) * (BH - 4) * Math.min(1, x / 10);
        path.push(yy);
      }
      this.put(`dx-bolt-${k}`, BW, BH, (x, y) => {
        const d = Math.abs(y - path[x]!);
        if (d < 0.8) return c(0xffffff);
        if (d < 1.8) return c(0xfff176);
        if (d < 2.8 && on(0.6, x, y)) return c(0x40c4ff);
        return 0;
      });
    }
    const S = 80;
    for (let f = 0; f < FR; f++) {
      const t = f / (FR - 1);
      this.put(`dx-zapblast-${f}`, S, S, (x, y) => {
        const dx = x - (S - 1) / 2;
        const dy = (y - (S - 1) / 2) * 1.8;
        const r = Math.hypot(dx, dy) / (S / 2);
        if (r > 1) return 0;
        const fade = 1 - t;
        if (r < 0.5 * (1 - t) && t < 0.4) return c(0xffffff);
        // 外へ走る稲妻（放射）
        const a = Math.atan2(dy, dx);
        const ray = Math.abs(Math.sin(a * 6 + Math.sin(r * 12 + f) * 0.6 + f * 0.4));
        if (ray < 0.07 && r < 0.3 + 0.7 * Math.min(1, t * 2.5)) return on(fade + 0.2, x, y) ? c(r < 0.5 ? 0xffffff : 0xfff176) : 0;
        // 広がる輪
        if (Math.abs(r - (0.3 + 0.65 * t)) < 0.06) return on(fade, x, y) ? c(0x80d8ff) : 0;
        if (r < 0.3 + 0.65 * t) return on(0.35 * fade, x, y) ? c(0xfbc02d) : 0;
        return 0;
      });
    }
  }

  /** 輪と弧: ミラーコートの虹の輪・ばかぢからの衝撃の弧（広がって消える） */
  private buildRings(): void {
    const W = 100;
    const H = 46;
    const cols = [0xff80ab, 0xffd180, 0xffff8d, 0xb9f6ca, 0x80d8ff, 0xb388ff];
    for (let f = 0; f < FR; f++) {
      const t = f / (FR - 1);
      this.put(`dx-ring-${f}`, W, H, (x, y) => {
        const r = Math.hypot((x - (W - 1) / 2) / (W / 2), (y - (H - 1) / 2) / (H / 2));
        const band = (0.82 - r) / 0.18;
        if (band < 0 || band > 1) return 0;
        if (!on(1.15 - t, x, y)) return 0;
        return c(cols[Math.min(5, Math.floor(band * 6))]!);
      });
      const S = 64;
      this.put(`dx-smash-${f}`, S, S, (x, y) => {
        const dx = x - 4;
        const dy = y - (S - 1) / 2;
        const r = Math.hypot(dx, dy) / S;
        const a = Math.abs(Math.atan2(dy, dx));
        if (a > 0.85) return 0;
        const R = 0.35 + 0.6 * t;
        const d = Math.abs(r - R);
        // 太い衝撃の弧（白い芯・橙・赤）と、内側に流れる力の筋
        if (d < 0.04) return on(1.2 - t, x, y) ? c(0xfff3e0) : 0;
        if (d < 0.09) return on(1.1 - t, x, y) ? c(0xff9100) : 0;
        if (d < 0.13) return on(1 - t, x, y) ? c(0xdd2c00) : 0;
        if (r < R && r > R - 0.3 && Math.sin(a * 22) > 0.6) return on(0.9 * (1 - t), x, y) ? c(0xff6d00) : 0;
        return 0;
      });
    }
  }

  // ───────────────────────── 描く ─────────────────────────

  private image(key: string, depth = this.depth): Phaser.GameObjects.Image {
    let img = this.pool[this.used];
    if (!img) {
      img = this.scene.add.image(0, 0, key);
      this.pool.push(img);
    }
    this.used++;
    return img.setCrop().setTexture(key).setVisible(true).setAlpha(1).setRotation(0).setScale(DOT).setOrigin(0.5, 0.5).setDepth(depth).setFlipX(false);
  }

  update(world: World, timeMs: number): void {
    this.used = 0;
    this.dots.clear();
    const moves = world.rules.stage.moves;
    const frame = Math.floor(timeMs / 70) % FR;
    if (world.hazards.some((h) => moves[h.move]?.id.startsWith('deoxys-'))) this.build();
    for (const hz of world.hazards) {
      const id = moves[hz.move]?.id ?? '';
      if (!id.startsWith('deoxys-')) continue;
      const p = hz.activeTicks === undefined ? 1 - hz.ticksLeft / Math.max(1, hz.totalTicks) : 1;
      const active = hz.activeTicks !== undefined;
      const key = `${id}:${hz.group ?? 0}:${Math.round(hz.x)}:${Math.round(hz.y)}`;
      const boss = this.boss(world, hz);
      const linger = (kind: Lingering['kind']): void => {
        if (!this.lingering.has(key)) this.lingering.set(key, { kind, x: hz.x, y: hz.y, r: hz.radius, dirX: hz.dirX, dirY: hz.dirY, seed: rnd(hz.x, hz.y), startMs: timeMs });
      };
      if (id.startsWith('deoxys-psycho-boost') || id === 'deoxys-double-team-beam') {
        if (active) this.drawBeam(hz, timeMs, frame);
        else this.drawPsyCharge(hz, p, timeMs, frame);
      } else if (id === 'deoxys-swift' || id === 'deoxys-swift-fast') {
        if (active) this.drawSwift(hz, timeMs);
      } else if (id === 'deoxys-night-shade') {
        if (active) linger('shade');
        else this.drawShadePool(hz, p, frame);
      } else if (id.startsWith('deoxys-teleport') || id === 'deoxys-double-team') {
        if (!active) this.drawTeleport(hz, p, timeMs, frame);
      } else if (id.startsWith('deoxys-form-change')) {
        if (!active && boss) this.drawFormChange(boss, p, timeMs, frame);
      } else if (id.startsWith('deoxys-superpower')) {
        if (active) linger('smash');
        else if (boss) this.drawSmashAim(boss, hz, p, timeMs);
      } else if (id === 'deoxys-zap-cannon') {
        if (!active && boss) this.drawZapCharge(boss, p, timeMs, frame);
      } else if (id === 'deoxys-zap-orb') {
        if (active) this.drawZapOrb(hz, timeMs, frame);
      } else if (id === 'deoxys-zap-burst' || id === 'deoxys-zap-spark') {
        if (active) linger('zap');
        else this.drawZapWarn(hz, p, timeMs);
      } else if (id === 'deoxys-iron-defense') {
        if (boss) this.drawShell(boss, 'steel', active ? 1 : p, frame);
      } else if (id === 'deoxys-mirror-coat') {
        if (!active && boss) this.drawMirror(world, hz, boss, p, frame);
      } else if (id === 'deoxys-mirror-burst') {
        if (active) linger('mirror');
      } else if (id === 'deoxys-cosmic-power') {
        if (!active && boss) this.drawCosmicCharge(boss, p, timeMs);
      } else if (id === 'deoxys-cosmic-stars') {
        if (active) linger('star');
        else this.drawStarFall(hz, p, timeMs);
      } else if (id === 'deoxys-recover') {
        if (!active && boss) this.drawRecover(boss, p, timeMs, frame);
      }
    }
    for (const [key, l] of this.lingering) {
      const t = (timeMs - l.startMs) / LINGER_MS[l.kind];
      if (t >= 1) {
        this.lingering.delete(key);
        continue;
      }
      const f = Math.min(FR - 1, Math.floor(t * FR));
      if (l.kind === 'zap') this.drawZapBlast(l, f, timeMs);
      else if (l.kind === 'star') this.image(`dx-sparkle-${Math.min(5, Math.floor(t * 6))}`).setPosition(l.x, l.y - 6).setScale(DOT * (l.r / 20));
      else if (l.kind === 'shade') this.image(`dx-pillar-${f}`, this.depth).setOrigin(0.5, 1).setPosition(l.x, l.y + 4).setScale((l.r * 2) / 76);
      else if (l.kind === 'mirror') this.image(`dx-ring-${f}`, this.floorDepth).setPosition(l.x, l.y).setScale((l.r * 2) / 82, (l.r * 0.9) / 37.5);
      else this.image(`dx-smash-${f}`).setOrigin(4 / 64, 0.5).setPosition(l.x, l.y).setRotation(Math.atan2(l.dirY, l.dirX)).setScale(l.r / 60);
    }
    if (!world.legendary) this.lingering.clear();
    for (let k = this.used; k < this.pool.length; k++) this.pool[k]!.setVisible(false);
  }

  private boss(world: World, hz: Hz): Boss | null {
    if (hz.dasher === -1) return null;
    const i = findEnemyIndex(world, hz.dasher);
    if (i < 0) return null;
    return { x: world.enemies.x[i]!, y: world.enemies.y[i]!, r: world.enemies.radius[i]! };
  }

  /** 小さな不透明の点（大きさで消え際を出す） */
  private dot(x: number, y: number, s: number, col: number): void {
    if (s < 1) return;
    this.dots.fillStyle(col, 1).fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
  }

  /** サイコブーストの溜め: 口元に念の玉が育ち、まわりから光の粒が渦を巻いて集まる。撃つ道には細い点線 */
  private drawPsyCharge(hz: Hz, p: number, timeMs: number, frame: number): void {
    for (let d = 40; d < hz.length; d += 26) {
      if (((d / 26) | 0) % 2 === 0 && rnd(d, 1) < 0.4 + 0.6 * p) this.dot(hz.x + hz.dirX * d, hz.y + hz.dirY * d, 4, 0xff80ab);
    }
    for (let k = 0; k < 10; k++) {
      const t = ((timeMs / 420 + rnd(k, 3)) % 1 + 1) % 1;
      const a = (k / 10) * Math.PI * 2 + timeMs / 260 + t * 2;
      const d = 170 * (1 - t);
      this.dot(hz.x + Math.cos(a) * d, hz.y + Math.sin(a) * d * 0.8, 4 + 6 * t, k % 2 ? 0xea80fc : 0xff80ab);
    }
    this.image(`dx-psyorb-${frame}`, this.frontDepth).setPosition(hz.x, hz.y).setScale(DOT * (0.4 + 1.4 * p));
  }

  /** サイコブースト: 光線の区切りをつないで流す（らせんが先へ回って進む）。口元に光の花 */
  private drawBeam(hz: Hz, timeMs: number, frame: number): void {
    const rot = Math.atan2(hz.dirY, hz.dirX);
    const seg = BEAM_W * DOT;
    const sy = (hz.radius * 2 * 1.35) / BEAM_H;
    const off = (timeMs * 0.9) % seg;
    const f = Math.floor(timeMs / 90) % 2;
    for (let d = -seg + off; d < hz.length; d += seg) {
      // 口元より後ろへはみ出す 1 区切り目は、口元から置く（次の区切りと少し重なる）
      const dd = Math.max(0, d);
      this.image(`dx-beam-${f}`).setOrigin(0, 0.5).setRotation(rot).setScale(DOT, sy).setPosition(hz.x + hz.dirX * dd, hz.y + hz.dirY * dd);
    }
    this.image(`dx-flare-${frame}`).setPosition(hz.x, hz.y).setScale(DOT * (hz.radius / 26));
  }

  /** スピードスター: 回る星と、進んだ後ろに小さくなる星の跡 */
  private drawSwift(hz: Hz, timeMs: number): void {
    const sp = Math.hypot(hz.vx ?? 0, hz.vy ?? 0) || 1;
    const tx = -(hz.vx ?? 0) / sp;
    const ty = -(hz.vy ?? 0) / sp;
    const rot = timeMs / 120 + hz.x * 0.01;
    for (let k = 2; k >= 1; k--) this.image('dx-star').setPosition(hz.x + tx * k * 16, hz.y + ty * k * 16).setScale(DOT * (1 - k * 0.3)).setRotation(rot - k * 0.4);
    this.image('dx-star').setPosition(hz.x, hz.y).setScale(DOT * 1.3).setRotation(rot);
  }

  /** ナイトヘッドの予告: 地面に影がしみ出して広がる。半分過ぎると影の中に赤い目 */
  private drawShadePool(hz: Hz, p: number, frame: number): void {
    const s = (hz.radius * 2 * (0.45 + 0.55 * p)) / 76;
    this.image(`dx-shade-${frame}`, this.floorDepth).setPosition(hz.x, hz.y - 4).setScale(s);
    if (p > 0.45) {
      this.dot(hz.x - 13, hz.y - 3, 6, 0xff1744);
      this.dot(hz.x + 13, hz.y - 3, 6, 0xff1744);
    }
  }

  /** テレポート: 現れる所に紫の点が渦を巻いて集まり、DNA のらせんが地面から伸びる */
  private drawTeleport(hz: Hz, p: number, timeMs: number, frame: number): void {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + timeMs / 300;
      const rr = 110 * (1 - p) + 24;
      this.dot(hz.x + Math.cos(a) * rr, hz.y + Math.sin(a) * rr * 0.45, 6, k % 2 ? 0xea80fc : 0x7c4dff);
    }
    this.image(`dx-helix-psy-${frame}`).setOrigin(0.5, 1).setPosition(hz.x, hz.y).setScale(DOT * 1.4, DOT * 1.4 * p);
  }

  /** 姿の変わり目: 光の殻に包まれ、左右の DNA のらせんが昇る。光の粒が舞い上がる */
  private drawFormChange(b: Boss, p: number, timeMs: number, frame: number): void {
    const cy = b.y - b.r * 1.5;
    const sc = (b.r * 6.2) / 72;
    this.image(`dx-shell-light-${frame}`, this.frontDepth).setPosition(b.x, cy).setScale(sc * (0.75 + 0.25 * p));
    for (const side of [-1, 1]) {
      this.image(`dx-helix-psy-${(frame + (side > 0 ? 4 : 0)) % FR}`, this.frontDepth).setOrigin(0.5, 1).setPosition(b.x + side * b.r * 2.2, b.y + b.r).setScale(DOT * 1.6, DOT * 1.6 * Math.min(1, p * 1.6));
    }
    for (let k = 0; k < 14; k++) {
      const t = ((timeMs / 700 + rnd(k, 5)) % 1 + 1) % 1;
      const a = rnd(5, k) * Math.PI * 2;
      this.dot(b.x + Math.cos(a) * b.r * 2.6, b.y + b.r - t * b.r * 5, 8 * (1 - t), k % 3 ? 0xfff59d : 0xff80ab);
    }
  }

  /** ばかぢからの予告: 体のまわりに赤橙の力の粒が集まり、振り下ろす向きへ流れる */
  private drawSmashAim(b: Boss, hz: Hz, p: number, timeMs: number): void {
    for (let k = 0; k < 14; k++) {
      const t = ((timeMs / 360 + rnd(k, 7)) % 1 + 1) % 1;
      const a = (k / 14) * Math.PI * 2;
      const d = b.r * 2.4 * (1 - t);
      this.dot(b.x + Math.cos(a) * d, b.y - b.r + Math.sin(a) * d, 4 + 6 * t * p, t > 0.7 ? 0xffe0b2 : 0xff6d00);
    }
    for (let k = 1; k <= 5; k++) {
      const d = hz.radius * (k / 6) * p;
      this.dot(hz.x + hz.dirX * d, hz.y + hz.dirY * d, 8 - k, 0xffab40);
    }
  }

  /** でんじほうの溜め: 体の前に電気の玉が育ち、まわりに稲妻が走る */
  private drawZapCharge(b: Boss, p: number, timeMs: number, frame: number): void {
    const x = b.x;
    const y = b.y - b.r * 1.4;
    this.bolts(x, y, 40 + 50 * p, 3, timeMs);
    this.image(`dx-zap-${frame}`, this.frontDepth).setPosition(x, y).setScale(DOT * (0.3 + 1.1 * p));
  }

  /** (x,y) から放射状に稲妻の絵を n 本（時間でちらつく） */
  private bolts(x: number, y: number, len: number, n: number, timeMs: number): void {
    const f = Math.floor(timeMs / 60);
    for (let k = 0; k < n; k++) {
      const a = rnd(f, k) * Math.PI * 2;
      this.image(`dx-bolt-${(f + k) % 4}`, this.frontDepth).setOrigin(0, 0.5).setPosition(x, y).setRotation(a).setScale(len / 56, DOT);
    }
  }

  /** でんじほうの玉: 回る電気の玉、まわりに稲妻、地面の影 */
  private drawZapOrb(hz: Hz, timeMs: number, frame: number): void {
    const s = (hz.radius * 2.2) / 40;
    this.image('dx-mark', this.floorDepth).setPosition(hz.x, hz.y + hz.radius * 0.7).setScale((hz.radius * 1.8) / 48);
    this.bolts(hz.x, hz.y, hz.radius * 2.2, 4, timeMs);
    this.image(`dx-zap-${frame}`).setPosition(hz.x, hz.y).setScale(s);
  }

  /** 大放電の予告: 範囲の中のばらばらの場所に火花 */
  private drawZapWarn(hz: Hz, p: number, timeMs: number): void {
    const f = Math.floor(timeMs / 80);
    for (let k = 0; k < 4; k++) {
      const a = rnd(f, k) * Math.PI * 2;
      const d = rnd(k, f) * hz.radius * p;
      this.image(`dx-bolt-${(f + k) % 4}`).setOrigin(0, 0.5).setPosition(hz.x + Math.cos(a) * d, hz.y + Math.sin(a) * d * 0.45).setRotation(rnd(k + 9, f) * 6.3).setScale(0.7, DOT * 0.7);
    }
  }

  private drawZapBlast(l: Lingering, f: number, timeMs: number): void {
    this.image(`dx-zapblast-${f}`).setPosition(l.x, l.y).setScale((l.r * 2.3) / 80);
    if (f < 4) this.bolts(l.x, l.y - 20, l.r * 1.2, 5, timeMs);
  }

  /** 体を包む殻（てっぺき: 鋼）。張った直後は外から縮んで現れる */
  private drawShell(b: Boss, kind: 'steel' | 'crystal' | 'light', p: number, frame: number): void {
    const sc = ((b.r * 6.2) / 72) * (1.25 - 0.25 * Math.min(1, p * 3));
    this.image(`dx-shell-${kind}-${frame}`, this.frontDepth).setPosition(b.x, b.y - b.r * 1.4).setScale(sc);
  }

  /** ミラーコートの構え: 虹色の結晶の殻。受けたダメージが多いほど、ひびが光る */
  private drawMirror(world: World, hz: Hz, b: Boss, p: number, frame: number): void {
    this.drawShell(b, 'crystal', p, frame);
    const i = findEnemyIndex(world, hz.dasher);
    const taken = i >= 0 ? Math.max(0, (hz.hpAtStart ?? world.enemies.hp[i]!) - world.enemies.hp[i]!) : 0;
    if (taken > 2000) this.image('dx-crystal-crack', this.frontDepth + 0.002).setPosition(b.x, b.y - b.r * 1.4).setScale((b.r * 6.2) / 72);
  }

  /** コスモパワーの溜め: 小さな星が体のまわりを回りながら上へ打ち上がる */
  private drawCosmicCharge(b: Boss, p: number, timeMs: number): void {
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + timeMs / 250;
      const d = b.r * 2.4 * (1.2 - 0.5 * p);
      this.image(k % 3 ? 'dx-star' : 'dx-star-blue', this.frontDepth).setPosition(b.x + Math.cos(a) * d, b.y - b.r + Math.sin(a) * d * 0.5 - p * 70).setScale(DOT * 0.9).setRotation(a);
    }
  }

  /** 流れ星の予告: 落ちる所の青い輪と、空から斜めに落ちる星（後ろに小さな星の跡） */
  private drawStarFall(hz: Hz, p: number, timeMs: number): void {
    this.image('dx-mark', this.floorDepth).setPosition(hz.x, hz.y).setScale((hz.radius * 2 * (0.5 + 0.5 * p)) / 48);
    if (p < 0.3) return;
    const t = (p - 0.3) / 0.7;
    const sx = hz.x + 260;
    const sy = hz.y - 760;
    const x = sx + (hz.x - sx) * t;
    const y = sy + (hz.y - sy) * t;
    const len = Math.hypot(hz.x - sx, hz.y - sy);
    const ux = (hz.x - sx) / len;
    const uy = (hz.y - sy) / len;
    for (let k = 4; k >= 1; k--) this.image('dx-star-blue').setPosition(x - ux * k * 26, y - uy * k * 26).setScale(DOT * (1.4 - k * 0.25)).setRotation(timeMs / 90 - k);
    this.image('dx-star-blue', this.frontDepth).setPosition(x, y).setScale(DOT * 1.8).setRotation(timeMs / 90);
  }

  /** じこさいせい: 体の左右に緑の DNA のらせん、下から昇る光の粒 */
  private drawRecover(b: Boss, p: number, timeMs: number, frame: number): void {
    for (const side of [-1, 1]) this.image(`dx-helix-heal-${frame}`, this.frontDepth).setOrigin(0.5, 1).setPosition(b.x + side * b.r * 2, b.y + b.r).setScale(DOT * 1.4, DOT * 1.4 * Math.min(1, p * 2));
    for (let k = 0; k < 12; k++) {
      const t = ((timeMs / 900 + rnd(k, 4)) % 1 + 1) % 1;
      const a = rnd(4, k) * Math.PI * 2;
      this.dot(b.x + Math.cos(a) * b.r * 1.6, b.y + b.r * 0.6 - t * b.r * 4, 7 * (1 - t) + 1, k % 2 ? 0xccff90 : 0xffffff);
    }
  }
}
