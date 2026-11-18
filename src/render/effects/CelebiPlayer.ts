import Phaser from 'phaser';
import type { World } from '../../sim/world';
import { DOT, DotPool, c, makeTexture, on, rnd, shade } from './dotArt';

/**
 * 遊べるセレビィの技の絵（07 の306章）: エナジーボール（自然の力の玉 → 当たると葉が散る）・リーフストーム（葉の嵐が敵へ進み、
 * 着いた所で渦巻き続ける）・みらいよち（敵の上に時計の文字盤が浮き、針が 1 周すると未来から光の柱が落ちる）。
 * 1 ドットずつ計算した不透明のドット絵（薄さはディザ。半透明の塗りは使わない）
 */

const ORB = 32;
const ORB_FRAMES = 4;
const VORTEX = 96;
const VORTEX_FRAMES = 6;
const CLOCK = 80;
const PILLAR_W = 40;
const PILLAR_H = 160;
const LEAF_W = 14;
const LEAF_H = 8;
const RING_W = 48;
const RING_H = 22;
/** 光の柱の見た目の長さ（ミリ秒） */
const PILLAR_MS = 620;

/** セレビィの緑（暗い → 明るい）と金 */
const GREEN = [0x1f5a2a, 0x2e7d32, 0x43a047, 0x66bb6a, 0x9ccc65, 0xc5e1a5, 0xf1f8e0];
const GOLD = 0xf5c84a;
const GOLD_DARK = 0xc8962a;

export class CelebiPlayer {
  private built = false;
  private readonly pool: DotPool;
  private readonly front: DotPool;
  private pillars: { x: number; y: number; r: number; at: number }[] = [];
  private seen = new Set<number>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
    private readonly floorDepth: number,
    /** ボスの絵より手前（光の柱） */
    private readonly frontDepth: number,
  ) {
    this.pool = new DotPool(scene, depth + 0.02);
    this.front = new DotPool(scene, frontDepth + 0.01);
  }

  private build(): void {
    if (this.built) return;
    this.built = true;
    const s = this.scene;
    // エナジーボール: 白っぽい芯、明るい緑に光の筋が回り、縁は深い緑。小さな光の点
    for (let f = 0; f < ORB_FRAMES; f++) {
      const ph = (f / ORB_FRAMES) * Math.PI * 2;
      makeTexture(s, `cb-orb-${f}`, ORB, ORB, (x, y) => {
        const cx = (ORB - 1) / 2;
        const dx = x - cx;
        const dy = y - cx;
        const r = Math.hypot(dx, dy) / (ORB / 2);
        if (r > 1) return 0;
        if (r > 0.88) return on(0.7, x, y) ? c(0x2e7d32) : 0;
        const a = Math.atan2(dy, dx);
        const streak = Math.sin(a * 2 + r * 6 - ph);
        if (r < 0.22) return c(0xf1f8e0);
        if (rnd(x + f * 7, y) > 0.96) return c(0xffffff);
        return shade(GREEN, 0.35 + (1 - r) * 0.45 + (streak > 0.55 ? 0.25 : 0), x, y);
      });
    }
    // 葉: 緑の 2 色、真ん中に明るい葉脈、先は金
    makeTexture(s, 'cb-leaf', LEAF_W, LEAF_H, (x, y) => {
      const u = (x + 0.5) / LEAF_W;
      const half = Math.sin(u * Math.PI) * (LEAF_H / 2);
      const dy = y + 0.5 - LEAF_H / 2;
      if (Math.abs(dy) > half) return 0;
      if (u > 0.86) return c(GOLD);
      if (Math.abs(dy) < 0.6) return c(0xe6f5c0);
      return dy < 0 ? c(0x7cc35a) : c(0x3f9a44);
    });
    // 嵐の渦: 中心へ巻き込む緑の風の腕（外ほど点が減る）。葉は別に回す
    for (let f = 0; f < VORTEX_FRAMES; f++) {
      const ph = (f / VORTEX_FRAMES) * Math.PI * 2;
      makeTexture(s, `cb-vortex-${f}`, VORTEX, VORTEX, (x, y) => {
        const cx = (VORTEX - 1) / 2;
        const dx = x - cx;
        const dy = y - cx;
        const r = Math.hypot(dx, dy) / (VORTEX / 2);
        if (r > 1 || r < 0.08) return 0;
        const a = Math.atan2(dy, dx);
        const arm = Math.sin(a * 3 + Math.log(r) * 4.2 - ph);
        if (arm < 0.2) return 0;
        const d = Math.min(1, (1.1 - r) * 1.5) * Math.min(1, (arm - 0.2) * 2.4);
        if (!on(d, x, y)) return 0;
        if (arm > 0.85 && r < 0.6) return c(r < 0.3 ? 0xf1f8e0 : 0xc5e1a5);
        if (arm > 0.7 && rnd(x, y + f) > 0.9) return c(GOLD);
        return shade(GREEN, 0.4 + (1 - r) * 0.45 + (arm - 0.2) * 0.3, x, y);
      });
    }
    // 時計の文字盤: 金の外の輪と 12 の目盛り、中は淡い緑（ディザで薄く）、真ん中の留め具
    makeTexture(s, 'cb-clock', CLOCK, CLOCK, (x, y) => {
      const cx = (CLOCK - 1) / 2;
      const dx = x - cx;
      const dy = y - cx;
      const r = Math.hypot(dx, dy) / (CLOCK / 2);
      if (r > 1) return 0;
      const a = Math.atan2(dy, dx);
      if (r > 0.9) return r > 0.96 ? c(GOLD_DARK) : c(GOLD);
      if (r > 0.84) return c(0x2e7d32);
      // 目盛り（12 本。3・6・9・12 は長い）
      const k = Math.round((a / (Math.PI * 2)) * 12);
      const da = Math.abs(a - (k / 12) * Math.PI * 2);
      const long = ((k % 3) + 3) % 3 === 0;
      if (da * r * (CLOCK / 2) < 1.3 && r > (long ? 0.6 : 0.7)) return c(long ? 0xfff3c0 : GOLD);
      if (r < 0.1) return c(GOLD);
      // 文字盤の面: 内ほど薄い淡い緑（葉の模様が少し透ける）
      const leafy = Math.sin(a * 5 + r * 9) > 0.7;
      if (!on(0.06 + r * 0.22, x, y)) return 0;
      return leafy ? c(0x9ccc65) : c(0xc5e1a5);
    });
    // 針（根元が下。回して使う）
    makeTexture(s, 'cb-hand', 6, 34, (x, y) => {
      const w = 3 - (y / 34) * 2;
      if (Math.abs(x + 0.5 - 3) > w) return 0;
      return y < 6 ? c(0xfff3c0) : c(GOLD);
    });
    // 光の柱: 白い芯、淡い緑、外は金。上ほど点が減る
    makeTexture(s, 'cb-pillar', PILLAR_W, PILLAR_H, (x, y) => {
      const k = Math.abs(x + 0.5 - PILLAR_W / 2) / (PILLAR_W / 2);
      const up = 1 - y / PILLAR_H;
      if (k > 1 || !on(1.1 - up * 0.8 - k * 0.25, x, y)) return 0;
      return k < 0.2 ? c(0xf1f8e0) : k < 0.5 ? c(0xd7ecb0) : k < 0.78 ? c(0x9ccc65) : k < 0.9 ? c(0x66bb6a) : c(GOLD);
    });
    // 地面の輪（柱が落ちた所）
    makeTexture(s, 'cb-ring', RING_W, RING_H, (x, y) => {
      const nx = (x - (RING_W - 1) / 2) / (RING_W / 2);
      const ny = (y - (RING_H - 1) / 2) / (RING_H / 2);
      const r = Math.hypot(nx, ny);
      if (r > 1 || r < 0.72) return 0;
      return r > 0.9 ? c(GOLD) : c(0xc5e1a5);
    });
  }

  update(world: World, timeMs: number): void {
    const moves = world.rules.moves;
    const eb = moves.findIndex((m) => m.key === 'energy-ball');
    const ls = moves.findIndex((m) => m.key === 'leaf-storm-celebi');
    const fs = moves.findIndex((m) => m.key === 'future-sight-celebi');
    const pr = world.projectiles;
    let any = this.pillars.length > 0;
    for (let i = 0; i < pr.count && !any; i++) if (pr.move[i] === eb || pr.move[i] === ls || pr.move[i] === fs) any = true;
    this.pool.begin();
    this.front.begin();
    if (!any) {
      this.pool.end();
      this.front.end();
      return;
    }
    this.build();
    const wait = fs >= 0 ? (moves[fs]!.scatterDelaySeconds ?? 1.5) : 1.5;
    for (let i = 0; i < pr.count; i++) {
      const m = pr.move[i];
      const x = pr.x[i]!;
      const y = pr.y[i]!;
      const r = pr.radius[i]!;
      if (m === eb) {
        if (pr.stage[i] === 0) {
          const orb = this.pool.image(`cb-orb-${Math.floor(timeMs / 80) % ORB_FRAMES}`, this.depth);
          orb.setPosition(x, y).setScale((r * 2.6) / ORB).setRotation(timeMs / 300);
          // 後ろに光の粒
          const vx = pr.vx[i]!;
          const vy = pr.vy[i]!;
          const v = Math.hypot(vx, vy) || 1;
          for (let k = 1; k <= 5; k++) this.pool.dot(x - (vx / v) * r * (0.8 + k * 0.6) + Math.sin(k * 2 + timeMs / 60) * 3, y - (vy / v) * r * (0.8 + k * 0.6), Math.max(2, 6 - k), k % 2 ? 0xc5e1a5 : 0xf1f8e0);
        } else {
          // 飛び散る葉
          const leaf = this.pool.image('cb-leaf', this.depth);
          leaf.setPosition(x, y).setScale(DOT * 0.9).setRotation(Math.atan2(pr.vy[i]!, pr.vx[i]!) + timeMs / 90);
        }
      } else if (m === ls) {
        // 嵐: 渦の絵と、まわりを回る葉。着いた後（stage 1）も同じ絵で渦巻き続ける
        const vortex = this.pool.image(`cb-vortex-${Math.floor(timeMs / 60) % VORTEX_FRAMES}`, this.depth);
        vortex.setPosition(x, y).setScale((r * 2.3) / VORTEX).setRotation(-timeMs / 180);
        const n = 12;
        for (let k = 0; k < n; k++) {
          const ph = (k / n) * Math.PI * 2 - timeMs / 220 - rnd(k, 3) * 0.6;
          const rr = r * (0.35 + rnd(k, 5) * 0.75);
          const lx = x + Math.cos(ph) * rr;
          const ly = y + Math.sin(ph) * rr * 0.8 - 6;
          const leaf = this.front.image('cb-leaf', this.frontDepth);
          leaf.setPosition(lx, ly).setScale(DOT * (0.8 + rnd(k, 7) * 0.5)).setRotation(ph + Math.PI / 2);
        }
      } else if (m === fs) {
        if (pr.stage[i] === 3) {
          // 文字盤と針（針が 1 周すると落ちる）
          const t = Math.max(0, Math.min(1, 1 - pr.life[i]! / wait));
          const cy = y - r * 0.15;
          const clock = this.pool.image('cb-clock', this.depth);
          clock.setPosition(x, cy).setScale(((r * 2.2) / CLOCK) * (0.85 + Math.min(1, t * 6) * 0.15));
          const hand = this.front.image('cb-hand', this.frontDepth);
          hand.setOrigin(0.5, 1).setPosition(x, cy).setScale(((r * 2.2) / CLOCK) * 1.6).setRotation(t * Math.PI * 2);
          // 終わりが近いと文字盤のまわりに光の粒が集まる
          if (t > 0.6) {
            for (let k = 0; k < 8; k++) {
              const a = (k / 8) * Math.PI * 2 + timeMs / 200;
              const d = r * (1.3 - (t - 0.6) * 1.2);
              this.front.dot(x + Math.cos(a) * d, cy + Math.sin(a) * d, 5, k % 2 ? GOLD : 0xf1f8e0);
            }
          }
        } else if (!this.seen.has(pr.serial[i]!)) {
          this.seen.add(pr.serial[i]!);
          this.pillars.push({ x, y, r, at: timeMs });
        }
      }
    }
    if (this.seen.size > 400) this.seen.clear();
    // 光の柱: 空から一気に落ち、細くなって消える。地面の輪が広がり、葉と光の粒が散る
    this.pillars = this.pillars.filter((p) => timeMs - p.at < PILLAR_MS);
    for (const p of this.pillars) {
      const t = (timeMs - p.at) / PILLAR_MS;
      const drop = Math.min(1, t / 0.15);
      const pil = this.front.image('cb-pillar', this.frontDepth);
      const w = (p.r * 1.3) / PILLAR_W;
      pil.setOrigin(0.5, 1).setPosition(p.x, p.y + 4).setScale(w * Math.max(0.1, 1 - Math.max(0, t - 0.35) / 0.65), (p.r * 5 * drop) / PILLAR_H);
      const ring = this.pool.image('cb-ring', this.floorDepth);
      ring.setPosition(p.x, p.y + 4).setScale(((p.r * 2.4) / RING_W) * (0.5 + t * 0.8));
      for (let k = 0; k < 12; k++) {
        const a = rnd(k, p.at) * Math.PI * 2;
        const d = p.r * (0.3 + t * 1.3) * (0.7 + rnd(k, 2) * 0.5);
        if (k % 3 === 0) {
          const leaf = this.pool.image('cb-leaf', this.depth + 0.02);
          leaf.setPosition(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * 0.7 - t * 20).setScale(DOT * 0.9).setRotation(a + t * 6);
        } else this.front.dot(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * 0.7 - t * 30, Math.round(6 * (1 - t)) + 1, k % 2 ? 0xf1f8e0 : GOLD);
      }
    }
    this.pool.end();
    this.front.end();
  }
}
