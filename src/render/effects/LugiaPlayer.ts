import Phaser from 'phaser';
import type { World } from '../../sim/world';
import { aimOf, moltresAim } from '../../sim/activeSkills';
import { DotPool, c, makeTexture, on, rnd, shade } from './dotArt';

/**
 * 遊べるルギアの技の絵（07 の317・318章。ミュウツーの サイコブレイク の水準で、1 ドットずつ計算した不透明のドット絵）:
 * - エアロブラスト: 口の前で、外から巻き込む風の渦の中に風の弾（白い芯・螺旋の腕・縁から外へ伸びる風の筋）が育つ → 螺旋の尾を引いて飛ぶ →
 *   着弾で風が螺旋に炸裂する（回る平たい渦の円盤が広がって崩れ、大きな風の帯がまわりをなぎ払う）→ 地面に風の渦が残り、ちりを吸い込む
 * - 水の渦の爆発: 風の渦に水流が当たると、渦が水を巻き上げて螺旋の水柱が立ち、着弾点で水が爆ぜる（白い泡の芯・水の輪・王冠のしぶき・落ちるしずく）
 * - じんつうりき: 狙われた敵の頭の上に、青紫の目がゆっくり開き、まわりの景色がゆがむ（波打つ輪）→ 目がはじけて紫のかけらと輪が広がる
 * - ハイドロポンプ: 口の前に水の玉が集まり、口もとでしぶきの輪がはじけて、ねじれる水流（白い泡の縁・回る筋）がなぎ払う。先で大きなしぶき、横へしずくが飛ぶ
 * - かぜおこし: 回る三日月の風
 * 薄さ・消え際はディザ（半透明の塗りは使わない）。画面全体は光らせない。画面は揺らさない
 */

const ORB = 48;
const ORB_FRAMES = 6;
const SWIRL = 96;
const SWIRL_FRAMES = 6;
const BURST = 128;
const BURST_FRAMES = 9;
const VORTEX = 96;
const VORTEX_FRAMES = 6;
const SPOUT_W = 48;
const SPOUT_H = 128;
const SPOUT_FRAMES = 6;
const SPLASH = 128;
const SPLASH_FRAMES = 8;
const EYE_W = 40;
const EYE_H = 24;
const EYE_FRAMES = 5;
const WARP_W = 64;
const WARP_H = 32;
const WARP_FRAMES = 4;
const POP = 64;
const POP_FRAMES = 6;
const BEAM_W = 64;
const BEAM_H = 32;
const BEAM_FRAMES = 4;
const MUZZLE = 40;
const MUZZLE_FRAMES = 3;
const SPRAY = 48;
const SPRAY_FRAMES = 4;
const GUST = 24;
const GUST_FRAMES = 3;
const BURST_MS = 760;
const SPLASH_MS = 820;
const POP_MS = 420;
/** ルギアの絵の口もとの高さ（足元からの上。立っている絵なので高い） */
const MOUTH_Y = 68;

/** 風の色の段（暗い → 明るい） */
const WIND = [0x0b5a78, 0x1590b8, 0x2bc4e0, 0x6fe6f2, 0xbaf6fa, 0xffffff];
const WATER = [0x013a6b, 0x0262a8, 0x0d8fdc, 0x3fbcf2, 0x9fe2fb, 0xffffff];
const PSY = [0x2e1065, 0x4c1d95, 0x6d28d9, 0x8b5cf6, 0xc4b5fd, 0xf5f3ff];

type Shot = { ox: number; oy: number; tx: number; ty: number; flight: number };
type Burst = { x: number; y: number; r: number; at: number; seed: number };

export class LugiaPlayer {
  private built = false;
  private readonly pool: DotPool;
  private readonly front: DotPool;
  private readonly floor: DotPool;
  private readonly ribbons: Phaser.GameObjects.Graphics;
  private shots = new Map<number, Shot>();
  private bursts: Burst[] = [];
  private splashes: Burst[] = [];
  private pops: Burst[] = [];
  private puffs: { x: number; y: number; at: number; seed: number }[] = [];
  private gusts = new Map<number, { x: number; y: number }>();
  private muzzles = new Map<number, number>();
  private seen = new Set<number>();

  constructor(
    private readonly scene: Phaser.Scene,
    depth: number,
    private readonly floorDepth: number,
    private readonly frontDepth: number,
  ) {
    this.pool = new DotPool(scene, depth + 0.02);
    this.front = new DotPool(scene, frontDepth + 0.01);
    this.floor = new DotPool(scene, floorDepth + 0.15);
    this.ribbons = scene.add.graphics().setDepth(frontDepth + 0.02);
  }

  private build(): void {
    if (this.built) return;
    this.built = true;
    const s = this.scene;
    // 風の弾: 白い芯、3 本の螺旋の腕（明るい水色）、腕の間は濃い青。縁から外へ短い風の筋が伸びる（6 コマで回る）
    for (let f = 0; f < ORB_FRAMES; f++) {
      const ph = (f / ORB_FRAMES) * Math.PI * 2;
      makeTexture(s, `lu-orb-${f}`, ORB, ORB, (x, y) => {
        const cx = (ORB - 1) / 2;
        const dx = x - cx;
        const dy = y - cx;
        const r = Math.hypot(dx, dy) / (ORB / 2);
        const a = Math.atan2(dy, dx);
        if (r > 0.78) {
          // 縁の外へ伸びる風の筋（回る）
          const k = Math.sin(a * 7 + ph) > 0.82 ? 1 : 0;
          if (k && r < 0.98 && on(1.2 - r, x, y)) return c(r < 0.88 ? 0xbaf6fa : 0x6fe6f2);
          if (r < 0.84) return c(0x6fe6f2);
          return 0;
        }
        if (r < 0.16) return c(0xffffff);
        const arm = Math.sin(a * 3 - Math.log(r + 0.05) * 4.5 + ph);
        const t = 0.25 + (1 - r) * 0.35 + (arm > 0.55 ? 0.4 : arm > 0 ? 0.15 : -0.05);
        return shade(WIND, t, x, y);
      });
    }
    // ためる渦: 外から口の前へ巻き込む風の腕（6 コマで回る）
    for (let f = 0; f < SWIRL_FRAMES; f++) {
      const ph = (f / SWIRL_FRAMES) * Math.PI * 2;
      makeTexture(s, `lu-swirl-${f}`, SWIRL, SWIRL, (x, y) => {
        const cx = (SWIRL - 1) / 2;
        const r = Math.hypot(x - cx, y - cx) / (SWIRL / 2);
        if (r > 1 || r < 0.1) return 0;
        const a = Math.atan2(y - cx, x - cx);
        const arm = Math.sin(a * 4 + Math.log(r) * 5 - ph);
        if (arm < 0.35) return 0;
        const d = Math.min(1, (1.1 - r) * 1.6) * Math.min(1, (arm - 0.35) * 3);
        if (!on(d, x, y)) return 0;
        return arm > 0.85 ? c(r < 0.5 ? 0xffffff : 0xbaf6fa) : shade(WIND, 0.3 + (1 - r) * 0.5, x, y);
      });
    }
    // 螺旋の炸裂: 白い閃光の芯 → 回る平たい渦の円盤が広がる（腕の先は明るい縁）→ 腕がちぎれて粒になって消える（9 コマ）
    for (let f = 0; f < BURST_FRAMES; f++) {
      const t = f / (BURST_FRAMES - 1);
      makeTexture(s, `lu-burst-${f}`, BURST, BURST, (x, y) => {
        const cx = (BURST - 1) / 2;
        const dx = x - cx;
        const dy = y - cx;
        const r = Math.hypot(dx, dy) / (BURST / 2);
        if (r > 1) return 0;
        const a = Math.atan2(dy, dx);
        const R = 0.3 + 0.62 * Math.sqrt(t);
        const fade = 1 - Math.max(0, t - 0.5) / 0.5;
        // 閃光の芯（はじめ）
        if (t < 0.3 && r < 0.36 * (1 - t * 2.8)) return c(r < 0.18 ? 0xffffff : 0xbaf6fa);
        if (r > R + 0.06) {
          // 外へ飛ぶ風のかけら
          if (r < R + 0.2 && fade > 0.1 && rnd(x * 5 + f, y) > 0.95) return c(0xbaf6fa);
          return 0;
        }
        // 螺旋の腕（4 本。回りながら外へ巻く）
        const arm = Math.sin(a * 4 - Math.log(r + 0.04) * 6 - t * 9);
        const edgeK = Math.max(0, 1 - Math.abs(r - R) / 0.08);
        if (edgeK > 0 && arm > -0.2) {
          // 縁の明るい輪（腕の先）
          if (!on(fade * (0.4 + edgeK * 0.7), x, y)) return 0;
          return c(edgeK > 0.6 ? 0xffffff : 0x6fe6f2);
        }
        if (arm < 0.25) {
          // 腕の間はまばら
          return on(fade * 0.25 * (1 - r / R), x, y) ? shade(WIND, 0.3, x, y) : 0;
        }
        const broken = t > 0.45 && rnd(Math.floor(a * 10 + r * 8), f) < (t - 0.45) * 1.7;
        if (broken || !on(fade * (0.8 + (arm - 0.25) * 0.5), x, y)) return 0;
        return shade(WIND, 0.45 + (arm - 0.25) * 0.55 + (r / R) * 0.15, x, y);
      });
    }
    // 地面の風の渦（平たく描く。中心ほど明るい 3 本の腕。6 コマで回る）。水を巻き上げるときは水の色
    for (const [key, cols] of [['lu-vortex', WIND], ['lu-wvortex', WATER]] as const) {
      for (let f = 0; f < VORTEX_FRAMES; f++) {
        const ph = (f / VORTEX_FRAMES) * Math.PI * 2;
        makeTexture(s, `${key}-${f}`, VORTEX, VORTEX, (x, y) => {
          const cx = (VORTEX - 1) / 2;
          const r = Math.hypot(x - cx, y - cx) / (VORTEX / 2);
          if (r > 1) return 0;
          const a = Math.atan2(y - cx, x - cx);
          const arm = Math.sin(a * 3 + Math.log(r + 0.05) * 4 - ph);
          if (arm < 0.3) return 0;
          const d = Math.min(1, (1.05 - r) * 2) * Math.min(1, (arm - 0.3) * 2.5);
          if (!on(d, x, y)) return 0;
          return shade(cols, 0.35 + (1 - r) * 0.55 + (arm > 0.85 ? 0.15 : 0), x, y);
        });
      }
    }
    // 水柱: 下から上へねじれて巻き上がる水（白い泡の筋が螺旋に回る。上の口はしぶきで広がる。6 コマ）
    for (let f = 0; f < SPOUT_FRAMES; f++) {
      const ph = (f / SPOUT_FRAMES) * Math.PI * 2;
      makeTexture(s, `lu-spout-${f}`, SPOUT_W, SPOUT_H, (x, y) => {
        const t = 1 - y / (SPOUT_H - 1);
        const cx = (SPOUT_W - 1) / 2 + Math.sin(t * 7 + ph) * 2.5;
        const w = 7 + t * 10 + Math.sin(t * 19 - ph) * 1.4 + (t > 0.85 ? (t - 0.85) * 60 : 0);
        const dx = (x - cx) / w;
        const ad = Math.abs(dx);
        if (ad > 1) {
          if (ad < 1.4 && rnd(x * 3 + f, y) > 0.9) return c(0x9fe2fb);
          return 0;
        }
        // ねじれる泡の筋（太さも間もそろえない）
        const helix = Math.sin(dx * 2.6 + y * 0.28 + ph * 1.5) + 0.55 * Math.sin(-dx * 1.3 + y * 0.67 - ph) + (rnd(x >> 1, (y >> 2) + f * 7) - 0.5) * 0.7;
        if (helix > 1.05) return c(0xffffff);
        if (helix > 0.75) return c(0x9fe2fb);
        if (ad > 0.8 && !on((1 - ad) * 5, x + f, y)) return 0;
        return shade(WATER, 0.38 + helix * 0.18 - ad * 0.22 + t * 0.12, x, y);
      });
    }
    // 水の爆発: 水の芯 → 水の輪が広がる（縁は明るく）→ 王冠のしぶき → 崩れてしずくに（8 コマ）
    for (let f = 0; f < SPLASH_FRAMES; f++) {
      const t = f / (SPLASH_FRAMES - 1);
      makeTexture(s, `lu-splash-${f}`, SPLASH, SPLASH, (x, y) => {
        const cx = (SPLASH - 1) / 2;
        const dx = x - cx;
        const dy = y - cx;
        const r = Math.hypot(dx, dy) / (SPLASH / 2);
        if (r > 1) return 0;
        const a = Math.atan2(dy, dx);
        const R = 0.25 + 0.7 * Math.sqrt(t);
        const fade = 1 - Math.max(0, t - 0.45) / 0.55;
        if (t < 0.35 && r < 0.42 * (1 - t * 2.2)) return shade(WATER, 1 - r, x, y);
        // 王冠のしぶき（輪の外へ伸びるとげ）
        const crown = Math.max(0, Math.sin(a * 11 + rnd(Math.floor((a * 11) / Math.PI), 2) * 2));
        const edge = R + crown * 0.12 * (1 - t * 0.5);
        if (r > edge) {
          if (r < edge + 0.12 && fade > 0.2 && rnd(x * 7 + f, y) > 0.93) return c(0xffffff);
          return 0;
        }
        const k = r / Math.max(0.01, edge);
        if (k > 0.8) {
          // しぶきの輪（内側は濃い青、外側は白い泡）。後半は切れ切れに
          const broken = t > 0.5 && rnd(Math.floor(a * 14), f) < (t - 0.5) * 1.8;
          if (broken) return 0;
          return k > 0.93 ? c(0xffffff) : k > 0.86 ? c(0x9fe2fb) : c(0x0d8fdc);
        }
        // 中は空けて、外へ渦を巻く細い水の腕だけ
        const swirl = Math.sin(a * 3 - r * 10 + t * 7);
        if (swirl < 0.82 || (t > 0.6 && rnd(Math.floor(a * 9), f) < (t - 0.6) * 2)) return 0;
        return k < 0.4 ? c(0xffffff) : c(0x3fbcf2);
      });
    }
    // 目（開いていく 5 コマ）: 外のふち取りの模様、まぶた、紫の瞳、白い光
    for (let f = 0; f < EYE_FRAMES; f++) {
      const open = (f + 1) / EYE_FRAMES;
      makeTexture(s, `lu-eye-${f}`, EYE_W, EYE_H, (x, y) => {
        const nx = (x - (EYE_W - 1) / 2) / (EYE_W / 2);
        const ny = (y - (EYE_H - 1) / 2) / (EYE_H / 2);
        const lidH = (1 - nx * nx) * 0.95 * open;
        const outer = (1 - nx * nx) * 1.0;
        // ふち取りの模様（上下の弧と、両端の尾）
        if (Math.abs(Math.abs(ny) - outer) < 0.09 && Math.abs(nx) < 0.92) return c(0x8b5cf6);
        if (Math.abs(nx) > 0.86 && Math.abs(ny) < 0.12) return c(0xc4b5fd);
        if (Math.abs(ny) > lidH) return 0;
        // まぶたの線（明るい紫）。中は空けて、光る瞳だけ（白目は描かない）
        if (Math.abs(Math.abs(ny) - lidH) < 0.13) return c(0xc4b5fd);
        const d = Math.hypot(nx * 1.7, ny);
        if (d < 0.16) return c(0xffffff);
        if (d < 0.34) return c(0xc4b5fd);
        if (d < 0.5) return c(0x8b5cf6);
        // 瞳のまわりの光の筋（細い放射）
        const ray = Math.abs(Math.sin(Math.atan2(ny, nx * 1.7) * 4));
        if (d < 0.75 && ray > 0.92 && on(1 - d, x, y)) return c(0xa78bfa);
        return 0;
      });
    }
    // ゆがみ（波打つ楕円の輪が外へ。4 コマ）
    for (let f = 0; f < WARP_FRAMES; f++) {
      makeTexture(s, `lu-warp-${f}`, WARP_W, WARP_H, (x, y) => {
        const nx = (x - (WARP_W - 1) / 2) / (WARP_W / 2);
        const ny = (y - (WARP_H - 1) / 2) / (WARP_H / 2);
        const r = Math.hypot(nx, ny);
        if (r > 1) return 0;
        const a = Math.atan2(ny, nx);
        const wave = r * 3 - f / WARP_FRAMES + Math.sin(a * 6 + f) * 0.06;
        const ring = wave - Math.floor(wave);
        if (ring > 0.16) return 0;
        if (!on(1.15 - r, x, y)) return 0;
        return r > 0.6 ? c(0x8b5cf6) : c(0xc4b5fd);
      });
    }
    // 念のはじけ: 閃光 → 紫のかけら（とがった 8 本）と輪が広がる（6 コマ）
    for (let f = 0; f < POP_FRAMES; f++) {
      const t = f / (POP_FRAMES - 1);
      makeTexture(s, `lu-pop-${f}`, POP, POP, (x, y) => {
        const cx = (POP - 1) / 2;
        const r = Math.hypot(x - cx, y - cx) / (POP / 2);
        if (r > 1) return 0;
        const a = Math.atan2(y - cx, x - cx);
        if (t < 0.4 && r < 0.3 * (1 - t * 2)) return c(0xffffff);
        const R = 0.3 + 0.65 * t;
        const fade = 1 - Math.max(0, t - 0.5) / 0.5;
        if (Math.abs(r - R) < 0.06 && on(fade, x, y)) return c(r > R ? 0x8b5cf6 : 0xc4b5fd);
        const spike = Math.abs(Math.sin(a * 4)) ** 8;
        if (r < R * (0.4 + spike * 0.9) && r > R * 0.35 && spike > 0.3 && on(fade, x, y)) return shade(PSY, 0.6 + spike * 0.4, x, y);
        return 0;
      });
    }
    // 水流: ねじれる筋（右へ流れる）、白い泡の縁、芯は明るい（4 コマ）
    for (let f = 0; f < BEAM_FRAMES; f++) {
      const ph = (f / BEAM_FRAMES) * Math.PI * 2;
      makeTexture(s, `lu-beam-${f}`, BEAM_W, BEAM_H, (x, y) => {
        const u = x / BEAM_W;
        const v = (y - (BEAM_H - 1) / 2) / (BEAM_H / 2);
        const edge = 0.84 + 0.09 * Math.sin(u * Math.PI * 6 - ph) + 0.05 * Math.sin(u * Math.PI * 14 + ph * 2);
        const a = Math.abs(v);
        if (a > edge) {
          if (a < edge + 0.15 && rnd(x * 3 + f, y) > 0.86) return c(0xffffff);
          return 0;
        }
        const k = a / edge;
        if (k > 0.8) return on(0.85, x + f, y) ? c(k > 0.9 ? 0xffffff : 0x9fe2fb) : 0;
        const rifle = Math.sin(u * Math.PI * 8 + v * 3.2 - ph) + 0.6 * Math.sin(u * Math.PI * 19 - v * 2.1 + ph * 2) + (rnd(x >> 2, y + f) - 0.5) * 0.6;
        if (rifle > 1.15 && k < 0.7) return c(0xffffff);
        return shade(WATER, 0.9 - k * 0.6 + rifle * 0.08, x, y);
      });
    }
    // 口もとのしぶきの輪（3 コマで広がる）
    for (let f = 0; f < MUZZLE_FRAMES; f++) {
      makeTexture(s, `lu-muzzle-${f}`, MUZZLE, MUZZLE, (x, y) => {
        const cx = (MUZZLE - 1) / 2;
        const r = Math.hypot(x - cx, y - cx) / (MUZZLE / 2);
        const a = Math.atan2(y - cx, x - cx);
        const R = 0.45 + f * 0.2 + Math.sin(a * 9 + f) * 0.06;
        if (Math.abs(r - R) < 0.1) return c(r < R ? 0xffffff : 0x9fe2fb);
        if (r < 0.3 - f * 0.08) return c(0xffffff);
        return 0;
      });
    }
    // 先のしぶき（扇に散る、4 コマ）
    for (let f = 0; f < SPRAY_FRAMES; f++) {
      makeTexture(s, `lu-spray-${f}`, SPRAY, SPRAY, (x, y) => {
        const cx = SPRAY * 0.25;
        const cy = (SPRAY - 1) / 2;
        const dx = x - cx;
        const dy = y - cy;
        const r = Math.hypot(dx, dy) / (SPRAY * 0.75);
        const a = Math.atan2(dy, dx);
        if (Math.abs(a) > 1.1 || r > 1) return 0;
        const ray = Math.abs(Math.sin(a * 6 + f * 1.3));
        if (ray > 0.85 && r > 0.15 && on(1.1 - r, x + f, y)) return c(r < 0.5 ? 0xffffff : 0x9fe2fb);
        if (r < 0.3 && on(0.8, x, y)) return c(0xbfeaff);
        return 0;
      });
    }
    // かぜおこし: 回る三日月の風（3 コマ）
    for (let f = 0; f < GUST_FRAMES; f++) {
      makeTexture(s, `lu-gust-${f}`, GUST, GUST, (x, y) => {
        const cx = (GUST - 1) / 2;
        const r = Math.hypot(x - cx, y - cx) / (GUST / 2);
        if (r > 1 || r < 0.35) return 0;
        const a = Math.atan2(y - cx, x - cx) + f * 0.7;
        const arm = Math.sin(a * 2 + r * 3);
        if (arm < 0.4) return 0;
        return arm > 0.85 ? c(0xffffff) : shade(WIND, 0.5 + (1 - r) * 0.4, x, y);
      });
    }
  }

  update(world: World, timeMs: number, localId: number, aimSlot: number | null): void {
    const moves = world.rules.moves;
    const ab = moves.findIndex((m) => m.key === 'aeroblast-lugia');
    const ex = moves.findIndex((m) => m.key === 'extrasensory-lugia');
    const hp = moves.findIndex((m) => m.key === 'hydro-pump-lugia');
    const gu = moves.findIndex((m) => m.key === 'gust-lugia');
    const pr = world.projectiles;
    this.ribbons.clear();
    this.pool.begin();
    this.front.begin();
    this.floor.begin();
    let any = this.bursts.length > 0 || this.splashes.length > 0 || this.pops.length > 0 || this.puffs.length > 0 || this.gusts.size > 0 || aimSlot !== null;
    for (let i = 0; i < pr.count && !any; i++) {
      const m = pr.move[i];
      if (m === ab || m === ex || m === hp || m === gu) any = true;
    }
    if (!any) {
      this.pool.end();
      this.front.end();
      this.floor.end();
      return;
    }
    this.build();
    const cfgA = world.rules.activeSkills?.defs.find((d) => d.kind === 'aeroblast')?.aeroblast;
    const cfgH = world.rules.activeSkills?.defs.find((d) => d.kind === 'hydroPump')?.hydroPump;
    const liveShot = new Set<number>();
    const liveGust = new Set<number>();
    const liveBeam = new Set<number>();
    for (let i = 0; i < pr.count; i++) {
      const m = pr.move[i];
      const id = pr.serial[i]!;
      const x = pr.x[i]!;
      const y = pr.y[i]!;
      const r = pr.radius[i]!;
      const owner = m === ab || m === hp ? world.players.find((q) => q.id === pr.owner[i]) : undefined;
      const mouth = owner ? this.mouth(owner) : { x, y };
      if (m === ab) {
        if (pr.stage[i] === 3) {
          // 風の弾は着弾する方（armStage 0）で描く。風の渦の待ち・水の爆発の待ちは描かない
          if (pr.angle[i] === 2 || pr.armStage[i] !== 0) continue;
          liveShot.add(id);
          const flight = cfgA?.flightSeconds ?? 0.3;
          if (pr.life[i]! > flight) {
            const total = cfgA?.chargeSeconds || 0.01;
            this.drawCharge(mouth.x, mouth.y, 1 - (pr.life[i]! - flight) / total, timeMs);
            continue;
          }
          let sh = this.shots.get(id);
          if (!sh) {
            sh = { ox: mouth.x, oy: mouth.y, tx: x, ty: y - 18, flight };
            this.shots.set(id, sh);
          }
          this.drawShot(sh, pr.life[i]!, timeMs, id);
        } else if (pr.stage[i] === 0) {
          if (this.seen.has(id)) continue;
          this.seen.add(id);
          if (pr.angle[i] === 2) this.splashes.push({ x, y, r, at: timeMs, seed: id });
          else this.bursts.push({ x, y, r, at: timeMs, seed: id });
        } else if (pr.stage[i] === 1) {
          if (pr.angle[i] === 1) this.drawSpout(x, y, r, 1 - pr.life[i]! / Math.max(0.01, cfgH?.spoutSeconds ?? 0.6), timeMs, id);
          else this.drawVortex(x, y, r, pr.life[i]!, pr.maxLife[i]!, timeMs, id);
        }
      } else if (m === ex) {
        if (pr.stage[i] === 3) this.drawEye(x, y, r, pr.life[i]!, timeMs, id);
        else if (!this.seen.has(id)) {
          this.seen.add(id);
          this.pops.push({ x, y: y - r - 22, r, at: timeMs, seed: id });
        }
      } else if (m === hp) {
        if (pr.stage[i] === 3) {
          const total = cfgH?.chargeSeconds || 0.01;
          this.drawWaterCharge(mouth.x, mouth.y, 1 - pr.life[i]! / total, timeMs);
        } else {
          liveBeam.add(id);
          if (!this.muzzles.has(id)) this.muzzles.set(id, timeMs);
          this.drawBeam(mouth.x, mouth.y, pr.dirX[i]!, pr.dirY[i]!, pr.length[i]!, r, pr.life[i]!, timeMs, this.muzzles.get(id)!);
        }
      } else if (m === gu && pr.stage[i] === 0) {
        liveGust.add(id);
        this.gusts.set(id, { x, y });
        const img = this.front.image(`lu-gust-${Math.floor(timeMs / 50 + id) % GUST_FRAMES}`, this.frontDepth - 0.01);
        img.setPosition(x, y).setScale((r * 2.4) / GUST).setRotation(timeMs / 90);
        for (let q = 1; q <= 3; q++) this.pool.dot(x - pr.vx[i]! * q * 0.025, y - pr.vy[i]! * q * 0.025, 5 - q, 0xbaf6fa);
      }
    }
    for (const id of this.shots.keys()) if (!liveShot.has(id)) this.shots.delete(id);
    for (const id of this.muzzles.keys()) if (!liveBeam.has(id)) this.muzzles.delete(id);
    for (const [id, g] of this.gusts) {
      if (liveGust.has(id)) continue;
      this.gusts.delete(id);
      this.puffs.push({ x: g.x, y: g.y, at: timeMs, seed: id });
    }
    if (this.seen.size > 600) this.seen.clear();
    this.drawBursts(timeMs);
    this.drawSplashes(timeMs);
    this.drawPops(timeMs);
    this.drawPuffs(timeMs);
    this.drawAim(world, timeMs, localId, aimSlot);
    this.pool.end();
    this.front.end();
    this.floor.end();
  }

  /** 口の前（向いている方へ少し出す） */
  private mouth(p: { x: number; y: number; facingX: number; facingY: number }): { x: number; y: number } {
    const fx = p.facingX || (p.facingY ? 0 : 1);
    const fy = p.facingY;
    const fl = Math.hypot(fx, fy) || 1;
    return { x: p.x + (fx / fl) * 30, y: p.y - MOUTH_Y + (fy / fl) * 16 };
  }

  /** エアロブラスト のため: 外から巻き込む風の渦（2 つを逆に回す）の中で風の弾が育ち、粒が吸い込まれる */
  private drawCharge(x: number, y: number, t: number, timeMs: number): void {
    const k = Math.max(0, Math.min(1, t));
    const fr = Math.floor(timeMs / 70);
    this.front.image(`lu-swirl-${fr % SWIRL_FRAMES}`, this.frontDepth + 0.005).setPosition(x, y).setScale(2 * (1.5 - k * 0.6)).setRotation(-timeMs / 240);
    this.front.image(`lu-swirl-${(fr + 3) % SWIRL_FRAMES}`, this.frontDepth + 0.006).setPosition(x, y).setScale(2 * (0.8 - k * 0.3)).setRotation(timeMs / 190).setFlipX(true);
    this.front.image(`lu-orb-${Math.floor(timeMs / 55) % ORB_FRAMES}`, this.frontDepth + 0.012).setPosition(x, y).setScale(0.3 + k * 1.5);
    for (let q = 0; q < 24; q++) {
      const ph = (rnd(q, 7) + timeMs / 460) % 1;
      const ang = rnd(q, 9) * Math.PI * 2 + timeMs / 650 + ph * 1.6;
      const rr = 110 * (1 - ph) + 8;
      this.front.dot(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr * 0.85, Math.round(7 - ph * 4), q % 3 === 0 ? 0xffffff : q % 2 ? 0x6fe6f2 : 0xbaf6fa);
    }
  }

  /** 撃たれた風の弾: まっすぐ飛び、まわりを 2 本の螺旋の風が巻いて尾を引く */
  private drawShot(sh: Shot, life: number, timeMs: number, id: number): void {
    const t = Math.max(0, Math.min(1, 1 - life / sh.flight));
    const x = sh.ox + (sh.tx - sh.ox) * t;
    const y = sh.oy + (sh.ty - sh.oy) * t;
    const len = Math.hypot(sh.tx - sh.ox, sh.ty - sh.oy) || 1;
    const dx = (sh.tx - sh.ox) / len;
    const dy = (sh.ty - sh.oy) / len;
    const back = Math.min(len * t, 220);
    for (let s = 0; s < back; s += 5) {
      const fall = s / 220;
      for (const side of [0, Math.PI]) {
        const w = Math.sin(s * 0.09 - timeMs / 40 + side) * 18 * (1 - fall * 0.5);
        if (rnd(Math.floor(s), id + (side ? 1 : 0)) < fall * 0.6) continue;
        this.pool.dot(x - dx * s - dy * w, y - dy * s + dx * w, Math.max(2, Math.round(6 - fall * 4)), fall < 0.3 ? 0xffffff : fall < 0.6 ? 0xbaf6fa : 0x2bc4e0);
      }
    }
    this.front.image(`lu-orb-${Math.floor(timeMs / 50) % ORB_FRAMES}`, this.frontDepth + 0.012).setPosition(x, y).setScale(1.9).setRotation(timeMs / 120);
  }

  /** 螺旋の炸裂: 渦の円盤（9 コマ）と、まわりをなぎ払う大きな風の帯（弧）と、飛び散る風のかけら */
  private drawBursts(timeMs: number): void {
    this.bursts = this.bursts.filter((b) => timeMs - b.at < BURST_MS);
    for (const b of this.bursts) {
      const t = (timeMs - b.at) / BURST_MS;
      const f = Math.min(BURST_FRAMES - 1, Math.floor(t * BURST_FRAMES));
      const img = this.front.image(`lu-burst-${f}`, this.frontDepth - 0.01);
      img.setPosition(b.x, b.y - 18).setScale((b.r * 2.5) / BURST).setRotation(b.seed + t * 5);
      // 風の帯: 外へ巻きながら広がる螺旋の帯（先が太く白く、尾へ細く水色に）。回りながら外へ流れる
      if (t < 0.7) {
        const tt = t / 0.7;
        for (let q = 0; q < 5; q++) {
          const head = b.seed + q * ((Math.PI * 2) / 5) + tt * 4.2;
          const R0 = b.r * (0.55 + tt * 1.25);
          const wHead = (1 - tt * 0.8) * (q % 2 ? 12 : 9);
          for (let k = 0; k < 26; k++) {
            const u = k / 25;
            const a = head - u * 1.9;
            const R = R0 * (1 - u * 0.35);
            const w = Math.max(2, Math.round(wHead * (1 - u * 0.85)));
            if (u > 0.6 && rnd(k, q + b.seed) < (u - 0.6) * 1.5) continue;
            this.front.dot(b.x + Math.cos(a) * R, b.y - 18 + Math.sin(a) * R * 0.8, w, u < 0.25 ? 0xffffff : u < 0.6 ? 0xbaf6fa : 0x2bc4e0);
          }
        }
      }
      for (let q = 0; q < 16; q++) {
        const ang = rnd(q, b.seed) * Math.PI * 2 + t * 2;
        const d = b.r * (0.5 + t * 1.3) * (0.7 + rnd(q, 3) * 0.5);
        this.front.dot(b.x + Math.cos(ang) * d, b.y - 18 + Math.sin(ang) * d * 0.8, Math.round(6 * (1 - t)) + 1, q % 3 === 0 ? 0xffffff : 0xbaf6fa);
      }
    }
  }

  /** 地面に残る風の渦: 回る平たい渦と、内側へ渦を巻いて吸い込まれるちり。消える前は小さく */
  private drawVortex(x: number, y: number, r: number, life: number, maxLife: number, timeMs: number, id: number): void {
    const k = Math.min(1, life / 0.5, (maxLife - life) / 0.15 + 0.3);
    const fr = Math.floor(timeMs / 70 + id) % VORTEX_FRAMES;
    this.floor.image(`lu-vortex-${fr}`, this.floorDepth + 0.1).setPosition(x, y).setScale(((r * 2.7) / VORTEX) * k, ((r * 1.35) / VORTEX) * k);
    for (let q = 0; q < 18; q++) {
      const ph = (timeMs / 1100 + rnd(q, id)) % 1;
      const a = q * 2.3 + ph * 5;
      const d = r * (1.2 - ph) * k;
      this.pool.dot(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.5 - ph * 26, q % 3 === 0 ? 4 : 3, q % 3 === 0 ? 0xffffff : q % 2 ? 0xbaf6fa : 0xa1887f);
    }
    // 立ちのぼる風の筋
    for (let q = 0; q < 3; q++) {
      const ph = (timeMs / 700 + q / 3) % 1;
      const a = q * 2.1 + timeMs / 300;
      for (let s = 0; s < 4; s++) this.pool.dot(x + Math.cos(a + s * 0.25) * r * 0.5 * k, y - ph * 70 - s * 6, 3, 0xbaf6fa);
    }
  }

  /** 水柱: 渦が水を巻き上げ、螺旋の水柱がのびる（t 0 → 1）。足元に水の渦 */
  private drawSpout(x: number, y: number, r: number, t: number, timeMs: number, id: number): void {
    const k = Math.max(0, Math.min(1, t));
    const fr = Math.floor(timeMs / 60 + id) % SPOUT_FRAMES;
    const h = r * 3.2 * Math.min(1, 0.15 + k * 1.2);
    this.floor.image(`lu-wvortex-${fr % VORTEX_FRAMES}`, this.floorDepth + 0.1).setPosition(x, y).setScale((r * 2.4) / VORTEX, (r * 1.2) / VORTEX);
    this.front.image(`lu-spout-${fr}`, this.frontDepth - 0.02).setOrigin(0.5, 1).setPosition(x, y + r * 0.2).setScale((r * 1.3) / SPOUT_W, h / SPOUT_H);
    for (let q = 0; q < 14; q++) {
      const ph = (timeMs / 500 + rnd(q, id)) % 1;
      const a = q * 1.9 + ph * 7;
      this.front.dot(x + Math.cos(a) * r * (0.5 + ph * 0.5), y - ph * h, 4, q % 2 ? 0xffffff : 0x3fbcf2);
    }
  }

  /** 水の爆発: 水の輪（8 コマ）・王冠のしぶき・放物線で落ちるしずく */
  private drawSplashes(timeMs: number): void {
    this.splashes = this.splashes.filter((b) => timeMs - b.at < SPLASH_MS);
    for (const b of this.splashes) {
      const t = (timeMs - b.at) / SPLASH_MS;
      const f = Math.min(SPLASH_FRAMES - 1, Math.floor(t * SPLASH_FRAMES));
      this.front.image(`lu-splash-${f}`, this.frontDepth - 0.01).setPosition(b.x, b.y - 10).setScale((b.r * 1.9) / SPLASH, (b.r * 1.15) / SPLASH);
      // 吹き上がる水柱（はじめの 0.35 だけ。高くのびて、上が広がって弾ける）
      if (t < 0.35) {
        const k = t / 0.35;
        const fr = Math.floor(timeMs / 60) % SPOUT_FRAMES;
        this.front.image(`lu-spout-${fr}`, this.frontDepth - 0.005).setOrigin(0.5, 1).setPosition(b.x, b.y).setScale(((b.r * 0.8) / SPOUT_W) * (1 + k * 0.8), ((b.r * 2.4) / SPOUT_H) * (1 + k * 0.6) * (1 - k * k * 0.5));
      }
      const tt = t * 0.82;
      for (let q = 0; q < 26; q++) {
        const a = (q / 26) * Math.PI * 2 + rnd(q, b.seed);
        const sp = b.r * (0.9 + rnd(q, b.seed + 1) * 0.9);
        const hh = (420 + rnd(q, b.seed + 2) * 260) * tt - 1100 * tt * tt;
        if (hh < 0 && tt > 0.12) continue;
        this.front.dot(b.x + Math.cos(a) * sp * tt * 1.8, b.y - 24 + Math.sin(a) * sp * tt * 0.8 - Math.max(0, hh), q % 3 === 0 ? 7 : 5, q % 3 === 0 ? 0xffffff : q % 2 ? 0x9fe2fb : 0x3fbcf2);
      }
    }
  }

  /** じんつうりき の待ち: 頭の上で目がゆっくり開き、まわりがゆがむ */
  private drawEye(x: number, y: number, r: number, life: number, timeMs: number, id: number): void {
    const open = Math.max(0, Math.min(1, (0.3 - life) / 0.22));
    const fr = Math.min(EYE_FRAMES - 1, Math.floor(open * EYE_FRAMES));
    const ey = y - r - 22;
    this.front.image(`lu-warp-${Math.floor(timeMs / 80 + id) % WARP_FRAMES}`, this.frontDepth + 0.005).setPosition(x, ey).setScale(0.9 + open * 0.5);
    this.front.image(`lu-eye-${fr}`, this.frontDepth + 0.01).setPosition(x, ey).setScale(1.25);
    // 敵のまわりの念の粒（ゆっくり回る）
    for (let q = 0; q < 8; q++) {
      const a = (q / 8) * Math.PI * 2 + timeMs / 300 + id;
      const d = r + 8 + Math.sin(timeMs / 70 + q) * 3;
      this.front.dot(x + Math.cos(a) * d, y - 8 + Math.sin(a) * d * 0.55, 3, PSY[2 + (q % 3)]!);
    }
  }

  /** はじけた念（6 コマ）と、まわりへ散る紫のかけら */
  private drawPops(timeMs: number): void {
    this.pops = this.pops.filter((p) => timeMs - p.at < POP_MS);
    for (const p of this.pops) {
      const t = (timeMs - p.at) / POP_MS;
      const f = Math.min(POP_FRAMES - 1, Math.floor(t * POP_FRAMES));
      this.front.image(`lu-pop-${f}`, this.frontDepth + 0.01).setPosition(p.x, p.y).setScale(1.4 + t * 0.6).setRotation(p.seed);
      for (let q = 0; q < 8; q++) {
        const a = (q / 8) * Math.PI * 2 + p.seed;
        const d = 10 + t * 46;
        this.front.dot(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * 0.8 + t * t * 30, Math.round(5 * (1 - t)) + 1, q % 2 ? 0xc4b5fd : 0x8b5cf6);
      }
    }
  }

  /** かぜおこし が消えた所の小さな風 */
  private drawPuffs(timeMs: number): void {
    this.puffs = this.puffs.filter((p) => timeMs - p.at < 220);
    for (const p of this.puffs) {
      const t = (timeMs - p.at) / 220;
      for (let q = 0; q < 5; q++) {
        const a = (q / 5) * Math.PI * 2 + p.seed + t * 3;
        this.front.dot(p.x + Math.cos(a) * (4 + t * 16), p.y + Math.sin(a) * (4 + t * 16), Math.round(4 * (1 - t)) + 1, q % 2 ? 0xffffff : 0xbaf6fa);
      }
    }
  }

  /** ハイドロポンプ のため: 口の前に水の玉がふくらみ、まわりのしずくが吸い込まれる */
  private drawWaterCharge(x: number, y: number, t: number, timeMs: number): void {
    const k = Math.max(0, Math.min(1, t));
    for (let q = 0; q < 20; q++) {
      const ph = (rnd(q, 5) + timeMs / 420) % 1;
      const ang = rnd(q, 11) * Math.PI * 2 + timeMs / 600;
      const rr = 90 * (1 - ph) + 8;
      this.front.dot(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr * 0.85, Math.round(6 - ph * 3), q % 3 === 0 ? 0xffffff : 0x3fbcf2);
    }
    const n = Math.round(10 + k * 26);
    const seed = Math.floor(timeMs / 50);
    for (let q = 0; q < n; q++) {
      const a = rnd(q, seed) * Math.PI * 2;
      const d = rnd(q + 3, seed) * (6 + k * 14);
      this.front.dot(x + Math.cos(a) * d, y + Math.sin(a) * d, 5, q % 4 === 0 ? 0xffffff : q % 2 ? 0x0d8fdc : 0x3fbcf2);
    }
  }

  /** ハイドロポンプ の水流: 口もとのしぶきの輪、帯を並べた水流、先の大きなしぶき、横へ飛ぶしずく */
  private drawBeam(x: number, y: number, dx: number, dy: number, len: number, r: number, life: number, timeMs: number, from: number): void {
    const f = Math.floor(timeMs / 60) % BEAM_FRAMES;
    const rot = Math.atan2(dy, dx);
    const start = 14;
    const seg = BEAM_W * 1.5;
    const fade = Math.min(1, life / 0.12);
    const n = Math.ceil((len - start) / seg);
    for (let k = 0; k < n; k++) {
      const d = start + k * seg;
      const w = Math.min(1, 0.6 + (k / Math.max(1, n - 1)) * 0.5) * fade;
      const img = this.front.image(`lu-beam-${(f + k) % BEAM_FRAMES}`, this.frontDepth - 0.02);
      img.setOrigin(0, 0.5).setPosition(x + dx * d, y + dy * d).setRotation(rot).setScale(Math.min(seg, len - d) / BEAM_W, ((r * 2.2) / BEAM_H) * w);
    }
    const mt = Math.floor((timeMs - from) / 70) % MUZZLE_FRAMES;
    this.front.image(`lu-muzzle-${mt}`, this.frontDepth - 0.015).setPosition(x + dx * 10, y + dy * 10).setScale((r * 1.8) / MUZZLE).setRotation(rot);
    this.front.image(`lu-spray-${Math.floor(timeMs / 70) % SPRAY_FRAMES}`, this.frontDepth - 0.015).setOrigin(0.25, 0.5).setPosition(x + dx * len, y + dy * len).setRotation(rot).setScale((r * 3) / SPRAY);
    // 横へ飛ぶしずく（水流の縁から外へ）
    for (let q = 0; q < 20; q++) {
      const along = rnd(q, Math.floor(timeMs / 90)) * len;
      const side = q % 2 ? 1 : -1;
      const out = r * (1 + ((timeMs / 300 + rnd(q, 4)) % 1) * 1.4);
      this.front.dot(x + dx * along - dy * out * side, y + dy * along + dx * out * side, q % 3 === 0 ? 5 : 3, q % 3 === 0 ? 0xffffff : 0x9fe2fb);
    }
  }

  /** 押している間（本人）: エアロブラスト は着弾する所の渦の輪、ハイドロポンプ はなぎ払う扇の両端と弧 */
  private drawAim(world: World, timeMs: number, localId: number, aimSlot: number | null): void {
    const me = world.players.find((p) => p.id === localId);
    const slot = aimSlot !== null ? me?.skills?.[aimSlot] : undefined;
    if (!me || !slot || me.down) return;
    const def = world.rules.activeSkills?.defs[slot.skill];
    const aim = moltresAim(world, me, slot.skill);
    if (!def || !aim || aim.x === undefined || aim.y === undefined || !aim.r) return;
    const col = slot.charges > 0 ? 0x6fe6f2 : 0x5a6b78;
    const step = 18;
    const off = (timeMs / 15) % step;
    if (def.hydroPump) {
      const [fx, fy] = aimOf(me);
      const a = Math.atan2(fy, fx);
      const half = (def.hydroPump.sweepDegrees * Math.PI) / 360;
      for (const s of [-1, 1]) for (let d = 30 + off; d < aim.r; d += step) this.front.dot(me.x + Math.cos(a + s * half) * d, me.y + Math.sin(a + s * half) * d, 4, col);
      for (let t = -half; t <= half; t += 0.06) this.front.dot(me.x + Math.cos(a + t) * aim.r, me.y + Math.sin(a + t) * aim.r, 4, col);
      return;
    }
    if (def.aeroblast) {
      const n = 32;
      for (let k = 0; k < n; k++) {
        const t = (k / n) * Math.PI * 2 + timeMs / 700;
        const rr = aim.r * (0.85 + 0.15 * Math.sin(t * 3 + timeMs / 200));
        this.front.dot(aim.x + Math.cos(t) * rr, aim.y + Math.sin(t) * rr * 0.55, 4, col);
      }
    }
  }
}
