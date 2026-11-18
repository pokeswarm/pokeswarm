import Phaser from 'phaser';
import type { World } from '../../sim/world';
import { c, DOT, DotPool, makeTexture, on, rnd, shade } from './dotArt';

type Hz = World['hazards'][number];
type Body = { x: number; y: number; r: number };

interface Lingering {
  kind: 'splash' | 'bolt';
  x: number;
  y: number;
  r: number;
  seed: number;
  startMs: number;
  goneMs: number;
}

const SPLASH_LINGER_MS = 1200;
const BOLT_LINGER_MS = 500;
const FR = 8;
const BEAM_W = 48;
const BEAM_H = 60;
const WATER = [0x0d2a6b, 0x0d47a1, 0x1565c0, 0x1e88e5, 0x4fc3f7, 0xb3e5fc, 0xffffff];
const CLOUD = [0x1e272c, 0x37474f, 0x546e7a, 0x78909c, 0xb0bec5];

/**
 * カイオーガの技の絵（07 の284・297章）: こんげんのはどうの深い青の光線・しおふきの打ち上がって落ちる潮・かみなりの雷雲と稲妻・
 * ゲンシカイキの水の輪と水の筋。1 ドットずつ計算したドット絵のテクスチャで描く（半透明の塗りは使わない）。見た目だけ
 */
export class KyogreSea {
  private built = false;
  private readonly pool: DotPool;
  private readonly lingering = new Map<string, Lingering>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
    private readonly floorDepth: number,
    private readonly topDepth: number,
  ) {
    this.pool = new DotPool(scene, topDepth + 0.01);
  }

  private build(): void {
    if (this.built) return;
    this.built = true;
    const s = this.scene;
    // 光線の 1 区切り: 深い青の外側（ディザで細る）・青・水色・白い芯。先へ流れる波頭の白い筋
    for (let f = 0; f < 2; f++) {
      makeTexture(s, `ky-beam-${f}`, BEAM_W, BEAM_H, (x, y) => {
        const yy = (y - (BEAM_H - 1) / 2) / (BEAM_H / 2);
        const v = Math.abs(yy) + (f ? 0.03 * Math.sin((x / BEAM_W) * Math.PI * 6) : 0);
        const crest = Math.abs(yy - 0.45 * Math.sin((x / BEAM_W) * Math.PI * 2)) < 0.06 || Math.abs(yy + 0.45 * Math.sin((x / BEAM_W) * Math.PI * 2 + 1)) < 0.05;
        if (crest && v < 0.8) return c(0xe1f5fe);
        if (v < 0.14) return c(0xffffff);
        if (v < 0.32) return c(0xb3e5fc);
        if (v < 0.55) return c(0x4fc3f7);
        if (v < 0.78) return c(0x1e88e5);
        if (v < 1 && on((1 - v) / 0.22, x, y)) return c(0x0d47a1);
        return 0;
      });
    }
    // 溜めの玉・水の塊（回る 8 コマ）
    for (let f = 0; f < FR; f++) {
      const S = 32;
      makeTexture(s, `ky-orb-${f}`, S, S, (x, y) => {
        const dx = x - (S - 1) / 2;
        const dy = y - (S - 1) / 2;
        const r = Math.hypot(dx, dy) / (S / 2);
        if (r > 1) return 0;
        const sw = Math.sin(Math.atan2(dy, dx) * 3 + r * 7 - (f / FR) * Math.PI * 2);
        if (r < 0.3) return c(0xffffff);
        if (r < 0.6) return c(sw > 0.3 ? 0xb3e5fc : 0x4fc3f7);
        if (r < 0.85) return c(sw > 0.4 ? 0x29b6f6 : 0x1565c0);
        return on((1 - r) / 0.15, x, y) && sw > -0.2 ? c(0x0d47a1) : 0;
      });
      const W = 22;
      makeTexture(s, `ky-water-${f}`, W, W, (x, y) => {
        const dx = x - (W - 1) / 2;
        const dy = y - (W - 1) / 2;
        const r = Math.hypot(dx, dy * (1.05 + 0.08 * Math.sin((f / FR) * Math.PI * 2))) / (W / 2);
        if (r > 1) return 0;
        const hl = Math.hypot(dx + 3, dy + 3) / (W / 2);
        if (hl < 0.18) return c(0xffffff);
        if (hl < 0.35) return c(0xb3e5fc);
        if (r > 0.88) return c(0x0d47a1);
        return shade(WATER, 0.62 - r * 0.35 + (dy < 0 ? 0.08 : 0), x, y);
      });
    }
    // 落ちる所の影・印
    makeTexture(s, 'ky-shadow', 32, 14, (x, y) => {
      const r = Math.hypot((x - 15.5) / 16, (y - 6.5) / 7);
      return r < 1 && on(0.65 - r * 0.4, x, y) ? c(0x081a33) : 0;
    });
    makeTexture(s, 'ky-mark', 48, 22, (x, y) => {
      const r = Math.hypot((x - 23.5) / 24, (y - 10.5) / 11);
      if (r > 1) return 0;
      if (r > 0.86) return c(0xfff59d);
      return on(0.22 * r, x, y) ? c(0x0a0f1e) : 0;
    });
    // しぶきの王冠と波紋（8 コマ）・引いていく水たまり（8 コマ）
    for (let f = 0; f < FR; f++) {
      const t = f / (FR - 1);
      const W = 64;
      const H = 44;
      makeTexture(s, `ky-splash-${f}`, W, H, (x, y) => {
        const gy = H - 10;
        // 波紋（地面の輪）
        const rr = Math.hypot((x - (W - 1) / 2) / (W / 2), (y - gy) / 9);
        if (Math.abs(rr - (0.35 + 0.6 * t)) < 0.06 && on(1.1 - t, x, y)) return c(0xe1f5fe);
        // 王冠: 輪の上に立つしずくの柱（上がって落ちる）
        const h = 26 * Math.sin(Math.min(1, t * 1.4) * Math.PI) * (t < 0.85 ? 1 : 0);
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2;
          const bx = (W - 1) / 2 + Math.cos(a) * (W / 2) * (0.3 + 0.3 * t);
          const by = gy + Math.sin(a) * 9 * (0.3 + 0.3 * t);
          const top = by - h * (0.7 + 0.3 * rnd(k, 1));
          if (Math.abs(x - bx) < 1.4 && y <= by && y >= top) return c(y < top + 2 ? 0xffffff : 0x4fc3f7);
        }
        return 0;
      });
      makeTexture(s, `ky-puddle-${f}`, 48, 22, (x, y) => {
        const r = Math.hypot((x - 23.5) / 24, (y - 10.5) / 11);
        if (r > 1) return 0;
        const d = 1 - t;
        if (r < 0.45 && on(d * 0.8, x, y)) return c(0x81d4fa);
        return on(d * 0.7, x, y) ? c(0x1565c0) : 0;
      });
    }
    // 雷雲（中の光がゆっくり強まる 8 コマ。明滅させない）
    for (let f = 0; f < FR; f++) {
      const glow = f / (FR - 1);
      const W = 96;
      const H = 44;
      makeTexture(s, `ky-cloud-${f}`, W, H, (x, y) => {
        let best = 99;
        let lit = 0;
        for (let k = 0; k < 7; k++) {
          const cx = 10 + k * 12.6;
          const cy = H * 0.55 + (k % 2 ? -4 : 3);
          const rr = 13 + rnd(k, 3) * 5;
          const d = Math.hypot(x - cx, y - cy) / rr;
          if (d < best) {
            best = d;
            lit = (cy - rr * 0.4 - y) / rr;
          }
        }
        if (best > 1) return 0;
        // 下の真ん中が雷の光で黄色く
        const core = Math.hypot((x - W / 2) / (W * 0.35), (y - H * 0.75) / (H * 0.3));
        if (core < 1 && on(glow * (1 - core), x, y)) return c(core < 0.4 ? 0xffffff : 0xfff59d);
        return shade(CLOUD, 0.35 + lit * 0.5 + (1 - best) * 0.2, x, y);
      });
    }
    // 稲妻（4 種）: 雲から地面へ、枝分かれ
    for (let k = 0; k < 4; k++) {
      const W = 40;
      const H = 100;
      // 折れ点を 10 ドットごとに決め、その間をまっすぐつなぐ（ぎざぎざの 1 本の線）
      const knot = (y: number): number => (y === 0 ? W / 2 : W / 2 + (rnd(k, y) - 0.5) * 18 * (1 - (y / H) * 0.5));
      const path: number[] = [];
      for (let y = 0; y < H; y++) {
        const y0 = Math.floor(y / 10) * 10;
        const f = (y - y0) / 10;
        path.push(knot(y0) + (knot(y0 + 10) - knot(y0)) * f);
      }
      const branch = 25 + Math.floor(rnd(k, 99) * 30);
      makeTexture(s, `ky-bolt-${k}`, W, H, (x, y) => {
        const d = Math.abs(x - path[y]!);
        if (d < 2) return c(0xffffff);
        if (d < 3.6) return c(0xfff176);
        if (d < 5 && on(0.6, x, y)) return c(0xffd600);
        // 枝: 斜め下へ
        if (y > branch && y < branch + 22) {
          const bx = path[branch]! + (y - branch) * (k % 2 ? 1 : -1);
          const bd = Math.abs(x - bx);
          if (bd < 0.9) return c(0xffffff);
          if (bd < 1.8) return c(0xfff176);
        }
        return 0;
      });
    }
    // 焦げ（消えていく 8 コマ）
    for (let f = 0; f < FR; f++) {
      const t = f / (FR - 1);
      makeTexture(s, `ky-scorch-${f}`, 40, 18, (x, y) => {
        const r = Math.hypot((x - 19.5) / 20, (y - 8.5) / 9);
        if (r > 1) return 0;
        if (r < 0.35 && t < 0.4) return c(0xfff59d);
        return on((1 - t) * (0.8 - r * 0.5), x, y) ? c(0x15151a) : 0;
      });
    }
    // ゲンシカイキの水の輪（広がって消える 8 コマ）と、体のまわりを昇る水の舌
    for (let f = 0; f < FR; f++) {
      const t = f / (FR - 1);
      makeTexture(s, `ky-ripple-${f}`, 96, 44, (x, y) => {
        const r = Math.hypot((x - 47.5) / 48, (y - 21.5) / 22);
        const R = 0.3 + 0.65 * t;
        const d = Math.abs(r - R);
        if (d < 0.025 && on(1.1 - t, x, y)) return c(0xffffff);
        if (d < 0.07 && on(1 - t, x, y)) return c(0x1e88e5);
        return 0;
      });
      const W = 56;
      const H = 64;
      makeTexture(s, `ky-aura-${f}`, W, H, (x, y) => {
        const nx = (x - (W - 1) / 2) / (W / 2);
        const tt = 1 - y / H;
        const edge = Math.abs(Math.abs(nx) - (0.72 + 0.12 * Math.sin(tt * 5 + f * 0.8)));
        const tongue = Math.sin(x * 0.9 + f * 1.3 + tt * 3) > 0.2;
        if (edge < 0.15 && tongue && on(1 - tt * 0.9, x, y)) return c(edge < 0.06 ? 0xe1f5fe : 0x29b6f6);
        return 0;
      });
    }
  }

  update(world: World, timeMs: number): void {
    this.pool.begin();
    const moves = world.rules.stage.moves;
    if (world.hazards.some((h) => moves[h.move]?.id.startsWith('kyogre-'))) this.build();
    const kyogre = this.kyogre(world);
    const frame = Math.floor(timeMs / 80) % FR;
    const seen = new Set<string>();
    let pulseCharge = -1;
    for (const hz of world.hazards) {
      const id = moves[hz.move]?.id ?? '';
      if (!id.startsWith('kyogre-')) continue;
      const p = hz.activeTicks === undefined ? 1 - hz.ticksLeft / Math.max(1, hz.totalTicks) : 1;
      const key = `${hz.group ?? 0}:${Math.round(hz.x)}:${Math.round(hz.y)}`;
      if (id.startsWith('kyogre-origin-pulse')) {
        if (hz.activeTicks === undefined) {
          this.drawPulseAim(hz, p);
          pulseCharge = Math.max(pulseCharge, p);
        } else this.drawPulseBeam(hz, timeMs, frame);
      } else if (id.startsWith('kyogre-water-spout')) {
        if (hz.activeTicks === undefined) this.drawSpoutFlight(hz, kyogre, p, frame);
        else {
          seen.add(key);
          if (!this.lingering.has(key)) this.lingering.set(key, { kind: 'splash', x: hz.x, y: hz.y, r: hz.radius, seed: rnd(hz.x, hz.y), startMs: timeMs, goneMs: 0 });
        }
      } else if (id.startsWith('kyogre-thunder')) {
        if (hz.activeTicks === undefined) this.drawStormCloud(hz, p);
        else {
          seen.add(key);
          if (!this.lingering.has(key)) this.lingering.set(key, { kind: 'bolt', x: hz.x, y: hz.y, r: hz.radius, seed: rnd(hz.x, hz.y + timeMs), startMs: timeMs, goneMs: 0 });
        }
      } else if (id === 'kyogre-primal-reversion' && kyogre) {
        this.drawReversion(kyogre, p, timeMs, frame);
      }
    }
    if (pulseCharge >= 0 && kyogre) this.drawPulseCharge(kyogre, pulseCharge, timeMs, frame);
    for (const [key, l] of this.lingering) {
      if (!seen.has(key) && l.goneMs === 0) l.goneMs = timeMs;
      const limit = l.kind === 'splash' ? SPLASH_LINGER_MS : BOLT_LINGER_MS;
      if (l.goneMs > 0 && timeMs - l.goneMs > limit) {
        this.lingering.delete(key);
        continue;
      }
      if (l.kind === 'splash') this.drawSplash(l, timeMs);
      else this.drawBolt(l, timeMs);
    }
    if (!world.legendary) this.lingering.clear();
    this.pool.end();
  }

  private kyogre(world: World): Body | null {
    const e = world.enemies;
    for (let i = 0; i < e.count; i++) {
      if (e.hp[i]! <= 0) continue;
      if (world.rules.enemies.kinds[e.kind[i]!]?.id === 'legend-kyogre') return { x: e.x[i]!, y: e.y[i]!, r: e.radius[i]! };
    }
    return null;
  }

  /** こんげんのはどうの予告: 光線の通る道に、水色の点線（だんだん濃く） */
  private drawPulseAim(hz: Hz, p: number): void {
    for (let d = 30; d < hz.length; d += 22) {
      if (((d / 22) | 0) % 2 === 0 && rnd(d, hz.x) < 0.35 + 0.65 * p) this.pool.dot(hz.x + hz.dirX * d, hz.y + hz.dirY * d, 5, 0x81d4fa);
    }
  }

  /** こんげんのはどうの溜め: 水の光の粒が口元へ集まり、口元に深い青の玉が育つ */
  private drawPulseCharge(k: Body, p: number, timeMs: number, frame: number): void {
    const mx = k.x;
    const my = k.y - k.r * 0.6;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + rnd(i, 4) * 0.5;
      const t = ((timeMs / 520 + rnd(i, 9)) % 1 + 1) % 1;
      const d = k.r * (3.6 - 3.0 * t);
      const px = mx + Math.cos(a) * d;
      const py = my + Math.sin(a) * d * 0.8;
      for (let j = 1; j <= 2; j++) this.pool.dot(px - (mx - px) * 0.14 * j, py - (my - py) * 0.14 * j, 7 - j * 2, 0x4fc3f7);
      this.pool.dot(px, py, 8 + t * 4, 0xe1f5fe);
    }
    this.pool.image(`ky-orb-${frame}`, this.topDepth).setPosition(mx, my).setScale(DOT * (0.4 + 1.3 * p));
  }

  /** こんげんのはどうの光線: 区切りをつないで先へ流す（波頭の白い筋が流れる）。根元に水の玉 */
  private drawPulseBeam(hz: Hz, timeMs: number, frame: number): void {
    const rot = Math.atan2(hz.dirY, hz.dirX);
    const seg = BEAM_W * DOT;
    const sy = (hz.radius * 2 * 1.3) / BEAM_H;
    const off = (timeMs * 0.8) % seg;
    const f = Math.floor(timeMs / 90) % 2;
    for (let d = -seg + off; d < hz.length; d += seg) {
      const dd = Math.max(0, d);
      this.pool.image(`ky-beam-${f}`, this.depth).setOrigin(0, 0.5).setRotation(rot).setScale(DOT, sy).setPosition(hz.x + hz.dirX * dd, hz.y + hz.dirY * dd);
    }
    this.pool.image(`ky-orb-${frame}`, this.depth + 0.01).setPosition(hz.x, hz.y).setScale((hz.radius * 2.4) / 32);
  }

  /** しおふきの潮: 背中から水の塊が打ち上がり、放物線で落ちる所へ。落ちる所に影 */
  private drawSpoutFlight(hz: Hz, k: Body | null, p: number, frame: number): void {
    this.pool.image('ky-shadow', this.floorDepth).setPosition(hz.x, hz.y).setScale((hz.radius * 1.6 * (0.5 + 0.5 * p)) / 32);
    if (!k) return;
    const sx = k.x;
    const sy = k.y - k.r * 1.3;
    const peak = 170 + rnd(hz.x, hz.y) * 90;
    const pos = (t: number): [number, number] => [sx + (hz.x - sx) * t, sy + (hz.y - sy) * t - peak * 4 * t * (1 - t)];
    for (let s = 1; s <= 5; s++) {
      const [xx, yy] = pos(Math.max(0, p - s * 0.03));
      this.pool.dot(xx, yy, 11 - s * 1.6, s < 3 ? 0xb3e5fc : 0x4fc3f7);
    }
    const [x, y] = pos(p);
    this.pool.image(`ky-water-${frame}`, this.topDepth).setPosition(x, y).setScale(DOT * (1.4 + rnd(hz.y, hz.x) * 0.4));
  }

  /** しおふきの着いた所: 王冠のしぶきと波紋、水たまりが引いていく */
  private drawSplash(l: Lingering, timeMs: number): void {
    const age = timeMs - l.startMs;
    const fade = Math.min(1, age / (SPLASH_LINGER_MS + 300));
    this.pool.image(`ky-puddle-${Math.min(FR - 1, Math.floor(fade * FR))}`, this.floorDepth).setPosition(l.x, l.y).setScale((l.r * 1.8) / 48);
    if (age < 700) this.pool.image(`ky-splash-${Math.min(FR - 1, Math.floor((age / 700) * FR))}`, this.depth).setOrigin(0.5, (44 - 10) / 44).setPosition(l.x, l.y).setScale((l.r * 2.2) / 64);
  }

  /** かみなりの予告: 狙った所の上に雷雲が広がり、中の光がゆっくり強まる。地面に印 */
  private drawStormCloud(hz: Hz, p: number): void {
    this.pool.image('ky-mark', this.floorDepth).setPosition(hz.x, hz.y).setScale((hz.radius * 2) / 48);
    this.pool.image(`ky-cloud-${Math.min(FR - 1, Math.floor(p * FR))}`, this.topDepth).setPosition(hz.x, hz.y - 170).setScale(((hz.radius * 4.4) / 96) * (0.6 + 0.4 * p));
  }

  /** かみなり: 雲から地面へ枝分かれする稲妻、着いた所に焦げと火花 */
  private drawBolt(l: Lingering, timeMs: number): void {
    const age = timeMs - l.startMs;
    const t = Math.min(1, age / (BOLT_LINGER_MS + 200));
    this.pool.image(`ky-scorch-${Math.min(FR - 1, Math.floor(t * FR))}`, this.floorDepth).setPosition(l.x, l.y).setScale((l.r * 1.7) / 40);
    if (age < 260) this.pool.image(`ky-bolt-${Math.floor(l.seed * 4) % 4}`, this.topDepth).setOrigin(0.5, 1).setPosition(l.x, l.y).setScale(DOT);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + l.seed;
      const d = l.r * (0.4 + 1.2 * t);
      this.pool.dot(l.x + Math.cos(a) * d, l.y + Math.sin(a) * d * 0.5 - 30 * t * (1 - t), 7 * (1 - t), 0xfff9c4);
    }
  }

  /** ゲンシカイキ: まわりに水の輪が次々と広がり、体のまわりを水の舌が昇る */
  private drawReversion(k: Body, p: number, timeMs: number, frame: number): void {
    for (let i = 0; i < 4; i++) {
      const t = ((timeMs / 900 + i / 4) % 1 + 1) % 1;
      this.pool.image(`ky-ripple-${Math.min(FR - 1, Math.floor(t * FR))}`, this.floorDepth).setPosition(k.x, k.y + k.r * 0.3).setScale((k.r * 6.5) / 96);
    }
    if (p > 0.15) this.pool.image(`ky-aura-${frame}`, this.topDepth).setOrigin(0.5, 1).setPosition(k.x, k.y + k.r * 0.4).setScale((k.r * 4.2) / 56);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const t = ((timeMs / 560 + rnd(i, 5)) % 1 + 1) % 1;
      this.pool.dot(k.x + Math.cos(a) * k.r * 1.3, k.y + k.r * 0.2 - t * k.r * 3, 9 * (1 - t) * p + 1, i % 2 ? 0x4fc3f7 : 0xe1f5fe);
    }
  }
}
