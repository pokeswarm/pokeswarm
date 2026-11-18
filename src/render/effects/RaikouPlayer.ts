import Phaser from 'phaser';
import type { World } from '../../sim/world';
import { extremeSpeedPreview, risingVoltagePreview } from '../../sim/activeSkills';
import { electricFieldRadius, shockFull } from '../../sim/systems/attack';
import { DotPool, c, makeTexture, on, rnd, shade } from './dotArt';

/**
 * 遊べるライコウの技の絵（07 の309〜311章）:
 * - しんそく: 1 体目から左右に折れる道を、ライコウが駆け抜ける。通った跡に稲妻と光の粒が残る。押している間は道を見せる
 * - エレキフィールド: いつもライコウの足元に広がる、電気が走る楕円の地面（雑魚より下。当たりの楕円と同じ大きさ）。中の敵に びりびり の火花が重なる
 * - じゅうでん: まわりから電気が集まり、ためている間は体に電気を纏う（重ねた数だけ多く）
 * - ライジングボルト: 足元に輪 → 空から雷が落ち、着いた瞬間だけ黒・青・白に反転した光 → 岩が弾け飛び、焦げが残る。コンボは大きく、岩が多い
 * 地面・輪・反転の光・岩・焦げは 1 ドットずつ計算した不透明のドット絵、稲妻は不透明の線（薄い塗りは使わない。画面全体は光らせない）
 */

const FIELD_W = 128;
const FIELD_H = 64;
const FIELD_FRAMES = 4;
const RING_W = 96;
const RING_H = 40;
const NEG_W = 112;
const NEG_H = 64;
const SCORCH = 64;
const TRAIL_MS = 380;
const STRIKE_MS = 650;
const COMBO_MS = 950;
/** 着いた瞬間の反転の光（黒・青・白）の長さ */
const NEG_MS = 110;
/** 落ちてくる時間（待ちの終わりのこの秒数で、空から落ちる） */
const DROP_SECONDS = 0.1;
const CHARGE_MS = 520;
/** 雷が落ちてくる高さ */
const SKY = 420;

const FIELD = [0x3a2c06, 0x6b5410, 0xa67c00];
const ROCK = [0x2e2a26, 0x4a443d, 0x6d655b, 0x968b7d];

type Strike = { x: number; y: number; r: number; at: number; seed: number; combo: boolean };
type Trail = { pts: { x: number; y: number }[]; end: number; seed: number };

export class RaikouPlayer {
  private built = false;
  private readonly pool: DotPool;
  private readonly front: DotPool;
  private readonly lines: Phaser.GameObjects.Graphics;
  private trails = new Map<number, Trail>();
  private strikes: Strike[] = [];
  private charges = new Map<number, { stacks: number; at: number }>();
  private seen = new Set<number>();

  constructor(
    private readonly scene: Phaser.Scene,
    depth: number,
    private readonly floorDepth: number,
    private readonly frontDepth: number,
  ) {
    this.pool = new DotPool(scene, depth + 0.02);
    this.front = new DotPool(scene, frontDepth + 0.01);
    this.lines = scene.add.graphics().setDepth(frontDepth + 0.02);
  }

  private build(): void {
    if (this.built) return;
    this.built = true;
    const s = this.scene;
    // エレキフィールド: 地面に散る暗い黄色の点（地面が透けて見えるディザ）と、コマごとに場所が変わる電気の筋。ふちは楕円
    for (let f = 0; f < FIELD_FRAMES; f++) {
      makeTexture(s, `rk-field-${f}`, FIELD_W, FIELD_H, (x, y) => {
        const nx = (x - (FIELD_W - 1) / 2) / (FIELD_W / 2);
        const ny = (y - (FIELD_H - 1) / 2) / (FIELD_H / 2);
        const r = Math.hypot(nx, ny);
        if (r > 1) return 0;
        if (r > 0.94) return Math.sin(Math.atan2(ny, nx) * 9 + f * 1.4) > -0.4 ? c(r > 0.97 ? 0xfbc02d : 0xffe082) : 0;
        const a = Math.atan2(ny, nx);
        for (let k = 0; k < 5; k++) {
          const base = (k / 5) * Math.PI * 2 + f * 0.7 + rnd(k, f) * 0.6;
          const wob = Math.sin(r * 14 + k * 3 + f * 2) * 0.12;
          const d = Math.abs(Math.atan2(Math.sin(a - base - wob), Math.cos(a - base - wob))) * r * FIELD_W * 0.5;
          if (r > 0.12 && r < 0.9 && d < 0.8) return c(0xfff59d);
          if (r > 0.12 && r < 0.9 && d < 1.8) return c(0xffd600);
        }
        return on(0.1 + r * 0.14, x, y) ? shade(FIELD, 0.3 + r * 0.6, x, y) : 0;
      });
    }
    // 落ちる所の輪（ふつう: 黄色。コンボ: 白に近い）
    for (const [key, cols] of [
      ['rk-ring', [0x8a5a00, 0xf9a825, 0xffd600, 0xfff176]],
      ['rk-ring-combo', [0xf9a825, 0xffe082, 0xfff9c4, 0xffffff]],
    ] as const) {
      makeTexture(s, key, RING_W, RING_H, (x, y) => {
        const nx = (x - (RING_W - 1) / 2) / (RING_W / 2);
        const ny = (y - (RING_H - 1) / 2) / (RING_H / 2);
        const r = Math.hypot(nx, ny);
        if (r > 1 || r < 0.66) return 0;
        return shade(cols, 1 - Math.abs(r - 0.83) / 0.18, x, y);
      });
    }
    // 着いた瞬間の反転の光: 黒い芯から、濃い青・明るい青・白のギザギザの光が外へ（1 枚の絵。ふちは尖る）
    makeTexture(s, 'rk-neg', NEG_W, NEG_H, (x, y) => {
      const nx = (x - (NEG_W - 1) / 2) / (NEG_W / 2);
      const ny = (y - (NEG_H - 1) / 2) / (NEG_H / 2);
      const r = Math.hypot(nx, ny);
      const a = Math.atan2(ny, nx);
      const spike = 0.62 + Math.pow(Math.abs(Math.sin(a * 6 + Math.sin(a * 3) * 0.8)), 3) * 0.38;
      if (r > spike) return 0;
      const k = r / spike;
      if (k < 0.28) return c(0x05060f);
      if (k < 0.45) return on((0.45 - k) / 0.17, x, y) ? c(0x05060f) : c(0x1a237e);
      if (k < 0.66) return c(k < 0.55 ? 0x1a237e : 0x3d5afe);
      if (k < 0.82) return c(0x8c9eff);
      return c(0xffffff);
    });
    // 落ちた所の焦げ（黒い穴と、まわりのひび）
    makeTexture(s, 'rk-scorch', SCORCH, SCORCH / 2, (x, y) => {
      const nx = (x - (SCORCH - 1) / 2) / (SCORCH / 2);
      const ny = (y - (SCORCH / 2 - 1) / 2) / (SCORCH / 4);
      const r = Math.hypot(nx, ny);
      const a = Math.atan2(ny, nx);
      if (r < 0.42) return c(r < 0.25 ? 0x14110d : 0x2e2a26);
      if (r < 1 && Math.abs(Math.sin(a * 5 + 0.7)) < 0.09 + (1 - r) * 0.08) return c(0x2e2a26);
      if (r < 0.55) return on(1 - (r - 0.42) / 0.13, x, y) ? c(0x4a443d) : 0;
      return 0;
    });
    // 飛ぶ岩（3 つ。左上が明るい）
    for (let k = 0; k < 3; k++) {
      makeTexture(s, `rk-rock-${k}`, 14, 12, (x, y) => {
        const nx = (x - 6.5) / (6 + k * 0.4);
        const ny = (y - 5.5) / (5 - k * 0.5);
        const r = Math.abs(nx) * (1 + rnd(k, 1) * 0.3) + Math.abs(ny) * 0.9 + Math.max(0, nx + ny) * 0.25;
        if (r > 1.05) return 0;
        if (r > 0.92) return c(0x1e1b18);
        return shade(ROCK, 0.85 - (nx + ny + 1) * 0.35, x, y);
      });
    }
  }

  /** ギザギザの稲妻の線（a → b）。太い色の上に芯（反転の光の間は 黒い芯に白い外側） */
  private bolt(ax: number, ay: number, bx: number, by: number, seed: number, width: number, branches: boolean, n = 7, neg = false): void {
    if (width < 1) return;
    const pts: [number, number][] = [[ax, ay]];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const px = -(by - ay) / len;
    const py = (bx - ax) / len;
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const j = (rnd(k, seed) - 0.5) * len * 0.16;
      pts.push([ax + (bx - ax) * t + px * j, ay + (by - ay) * t + py * j]);
    }
    pts.push([bx, by]);
    const outer = neg ? 0xffffff : 0xffd600;
    const inner = neg ? 0x05060f : 0xffffff;
    for (const [w, col] of [[width, outer], [Math.max(1, width * 0.45), inner]] as const) {
      this.lines.lineStyle(w, col, 1).beginPath().moveTo(pts[0]![0], pts[0]![1]);
      for (const p of pts.slice(1)) this.lines.lineTo(p[0], p[1]);
      this.lines.strokePath();
    }
    if (!branches) return;
    for (let k = 2; k < n - 1; k += 2) {
      const [sx, sy] = pts[k]!;
      const a = Math.atan2(by - ay, bx - ax) + (rnd(k, seed + 7) - 0.5) * 1.6;
      const l = len * 0.18;
      this.lines.lineStyle(Math.max(1, width * 0.5), neg ? 0x8c9eff : 0xffd600, 1).beginPath().moveTo(sx, sy).lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l).strokePath();
    }
  }

  update(world: World, timeMs: number, localId: number, aimSlot: number | null): void {
    const moves = world.rules.moves;
    const es = moves.findIndex((m) => m.key === 'extreme-speed-raikou');
    const rv = moves.findIndex((m) => m.key === 'rising-voltage-raikou');
    const pr = world.projectiles;
    this.lines.clear();
    this.pool.begin();
    this.front.begin();
    let any = this.trails.size > 0 || this.strikes.length > 0 || aimSlot !== null || this.charges.size > 0;
    for (const p of world.players) if (p.charged || electricFieldRadius(world, p) > 0) any = true;
    for (let i = 0; i < pr.count && !any; i++) if (pr.move[i] === es || pr.move[i] === rv) any = true;
    if (!any) {
      this.pool.end();
      this.front.end();
      return;
    }
    this.build();
    // エレキフィールド: 足元の楕円（当たりと同じ大きさ。横の半径 r、縦 r/2）
    const frame = Math.floor(timeMs / 90) % FIELD_FRAMES;
    for (const p of world.players) {
      const r = electricFieldRadius(world, p);
      if (r <= 0 || p.down) continue;
      this.pool.image(`rk-field-${frame}`, this.floorDepth).setPosition(p.x, p.y).setScale((r * 2) / FIELD_W, r / FIELD_H);
    }
    const live = new Set<number>();
    for (let i = 0; i < pr.count; i++) {
      const m = pr.move[i];
      const x = pr.x[i]!;
      const y = pr.y[i]!;
      const r = pr.radius[i]!;
      if (m === rv) {
        if (pr.stage[i] === 3) this.drawFalling(x, y, r, pr.armStage[i] === 1, pr.life[i]!, pr.serial[i]!, timeMs);
        else if (!this.seen.has(pr.serial[i]!)) {
          this.seen.add(pr.serial[i]!);
          this.strikes.push({ x, y, r, at: timeMs, seed: pr.serial[i]!, combo: pr.stage[i] === 1 });
        }
      } else if (m === es) {
        // しんそく: 体に付いて動く当たりの通り道を覚える
        const id = pr.serial[i]!;
        live.add(id);
        let tr = this.trails.get(id);
        if (!tr) this.trails.set(id, (tr = { pts: [], end: 0, seed: id }));
        const last = tr.pts[tr.pts.length - 1];
        if (!last || Math.hypot(last.x - x, last.y - y) > 2) tr.pts.push({ x, y });
        tr.end = timeMs;
      }
    }
    if (this.seen.size > 600) this.seen.clear();
    this.drawShock(world, timeMs);
    this.drawStrikes(timeMs);
    this.drawCharge(world, timeMs);
    this.drawTrails(timeMs, live);
    this.drawAim(world, timeMs, localId, aimSlot);
    this.pool.end();
    this.front.end();
  }

  /** しんそく の通った跡: 駆け抜けている間は後ろに稲妻が伸び、光の粒が散る。終わると細くなって消える */
  private drawTrails(timeMs: number, live: Set<number>): void {
    for (const [id, tr] of this.trails) {
      const running = live.has(id);
      const t = running ? 0 : (timeMs - tr.end) / TRAIL_MS;
      if (t >= 1 || tr.pts.length === 0) {
        this.trails.delete(id);
        continue;
      }
      const seed = tr.seed + Math.floor(timeMs / 60);
      for (let k = 1; k < tr.pts.length; k++) {
        const a = tr.pts[k - 1]!;
        const b = tr.pts[k]!;
        // 体に近い所ほど太い（駆け抜けている間）
        const near = running ? (k / tr.pts.length) ** 0.6 : 1;
        this.bolt(a.x, a.y - 10, b.x, b.y - 10, seed + k * 3, (10 * near + 2) * (1 - t), k % 4 === 0, 3);
      }
      // 体の後ろの光の粒（駆け抜けている間）と、残る火花
      const head = tr.pts[tr.pts.length - 1]!;
      if (running) for (let q = 0; q < 6; q++) this.front.dot(head.x + (rnd(q, seed) - 0.5) * 30, head.y - 10 + (rnd(q + 3, seed) - 0.5) * 24, 4, q % 2 ? 0xffffff : 0xffee58);
      for (let k = 0; k < tr.pts.length; k += 2) {
        const p = tr.pts[k]!;
        if (rnd(k, seed) < 0.5) this.front.dot(p.x + (rnd(k + 1, seed) - 0.5) * 18, p.y - 10 + (rnd(k + 2, seed) - 0.5) * 14, Math.round(4 * (1 - t)) + 1, 0xfff59d);
      }
    }
  }

  /** 落ちる前: 足元の輪が締まり、最後の一瞬で空から雷が落ちてくる */
  private drawFalling(x: number, y: number, r: number, combo: boolean, life: number, seed: number, timeMs: number): void {
    const k = Math.min(1, (timeMs / 1000) % 0.3 / 0.3);
    const ring = this.pool.image(combo ? 'rk-ring-combo' : 'rk-ring', this.floorDepth + 0.1);
    ring.setPosition(x, y).setScale(((r * 1.5) / RING_W) * (1.15 - k * 0.3), ((r * 0.68) / RING_H) * (1.15 - k * 0.3));
    if (life < DROP_SECONDS) {
      const p = 1 - life / DROP_SECONDS;
      const top = y - SKY;
      this.bolt(x + (rnd(seed, 1) - 0.5) * 30, top, x, top + SKY * p, seed + Math.floor(timeMs / 40), combo ? 8 : 5, true, 9);
    }
  }

  /** 落雷: 着いた瞬間は黒・青・白に反転した光、そのあと黄色の雷が細くなって消え、岩が弾け飛ぶ */
  private drawStrikes(timeMs: number): void {
    this.strikes = this.strikes.filter((s) => timeMs - s.at < (s.combo ? COMBO_MS : STRIKE_MS));
    for (const s of this.strikes) {
      const span = s.combo ? COMBO_MS : STRIKE_MS;
      const ms = timeMs - s.at;
      const t = ms / span;
      const neg = ms < NEG_MS;
      const size = s.combo ? 1.25 : 1;
      // 焦げ（ずっと地面に。消える前に小さくなる）
      const sc = this.pool.image('rk-scorch', this.floorDepth + 0.05);
      const shrink = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      sc.setPosition(s.x, s.y).setScale(((s.r * 1.3 * size) / SCORCH) * shrink, ((s.r * 0.6 * size) / (SCORCH / 2)) * shrink);
      if (neg) {
        // 反転の光（着いた瞬間だけ）
        const n = this.front.image('rk-neg', this.frontDepth - 0.01);
        n.setPosition(s.x, s.y - s.r * 0.2).setScale((s.r * 2.1 * size) / NEG_W, (s.r * 1.3 * size) / NEG_H);
      }
      // 空からの雷（反転の間は黒い芯、そのあと黄色で細くなって消える）
      const fade = neg ? 1 : Math.max(0, 1 - (ms - NEG_MS) / (span * 0.4));
      if (fade > 0) {
        const seed = s.seed + Math.floor(timeMs / 50);
        const n = s.combo ? 3 : 1;
        for (let k = 0; k < n; k++) {
          const off = (k - (n - 1) / 2) * s.r * 0.25;
          this.bolt(s.x + off + (rnd(s.seed, k) - 0.5) * 40, s.y - SKY, s.x + off * 0.2, s.y, seed + k * 5, ((s.combo ? 9 : 6) * fade + 1) * (neg ? 1.3 : 1), true, 9, neg);
        }
      }
      // 地面すれすれに散る火花
      if (!neg && t < 0.45) {
        const n = s.combo ? 8 : 5;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + rnd(k, s.seed) * 0.5;
          const d0 = s.r * (0.3 + t * 1.6);
          const d1 = d0 + s.r * 0.45;
          this.bolt(s.x + Math.cos(a) * d0, s.y + Math.sin(a) * d0 * 0.45, s.x + Math.cos(a) * d1, s.y + Math.sin(a) * d1 * 0.45 - s.r * 0.25, s.seed + k, 2 * (1 - t * 2) + 1, false, 3);
        }
      }
      // 岩が弾け飛んで落ちる
      const rocks = s.combo ? 8 : 4;
      const tt = ms / 1000;
      for (let k = 0; k < rocks; k++) {
        const a = (k / rocks) * Math.PI * 2 + rnd(k, s.seed) * 0.8;
        const sp = s.r * (1 + rnd(k, s.seed + 1) * 1.1) * size;
        const up = (240 + rnd(k, s.seed + 2) * 180) * size;
        const h = up * tt - 900 * tt * tt;
        if (h < -2 && tt > 0.1) continue;
        const rock = this.front.image(`rk-rock-${k % 3}`, this.frontDepth - 0.005);
        rock.setPosition(s.x + Math.cos(a) * sp * tt * 1.6, s.y + Math.sin(a) * sp * tt * 0.7 - Math.max(0, h)).setScale((s.combo ? 2.5 : 2) + (k % 2)).setRotation(tt * (k % 2 ? 7 : -6));
        if (neg) rock.setTint(0x1a237e);
        else rock.clearTint();
      }
    }
  }

  /** びりびり: 重ねた数だけ敵のまわりに火花。重ねきった敵は、体を小さな稲妻が走り、頭の上に印 */
  private drawShock(world: World, timeMs: number): void {
    const e = world.enemies;
    const full = shockFull(world);
    const tick = Math.floor(timeMs / 70);
    for (let i = 0; i < e.count; i++) {
      const n = e.shock[i]!;
      if (n === 0 || e.hp[i]! <= 0) continue;
      const x = e.x[i]!;
      const y = e.y[i]!;
      const r = e.radius[i]!;
      for (let q = 0; q < n; q++) {
        const a = rnd(q + tick, e.id[i]!) * Math.PI * 2;
        const d = r * (0.6 + rnd(q, tick) * 0.6);
        this.front.dot(x + Math.cos(a) * d, y - r * 0.6 + Math.sin(a) * d, 3, (q + tick) % 2 ? 0xffd600 : 0xffffff);
      }
      if (full > 0 && n >= full) {
        const seed = e.id[i]! * 13 + tick;
        this.bolt(x - r * 0.9, y - r * 1.2, x + r * 0.9, y - r * 0.1, seed, 2, false, 4);
        const hy = y - r * 2 - 10;
        for (const [dx, dy] of [[1, -4], [0, -2], [-1, 0], [1, 0], [0, 2], [-1, 4]] as const) this.front.dot(x + dx * 2, hy + dy * 2, 3, 0xfff176);
      }
    }
  }

  /** じゅうでん: 使った瞬間はまわりから電気が集まり、ためている間は体に電気を纏う（体を走る小さな稲妻。重ねた数だけ多く太く） */
  private drawCharge(world: World, timeMs: number): void {
    for (const p of world.players) {
      const stacks = p.charged?.stacks ?? 0;
      const prev = this.charges.get(p.id);
      if (stacks === 0) {
        this.charges.delete(p.id);
        continue;
      }
      if (!prev || stacks > prev.stacks) this.charges.set(p.id, { stacks, at: timeMs });
      const st = this.charges.get(p.id)!;
      const cx = p.x;
      const cy = p.y - 16;
      const t = (timeMs - st.at) / CHARGE_MS;
      if (t < 1) {
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + st.at * 0.001;
          const d0 = 90 * (1 - t) + 14;
          const d1 = d0 + 26 * (1 - t);
          this.bolt(cx + Math.cos(a) * d1, cy + Math.sin(a) * d1, cx + Math.cos(a) * d0, cy + Math.sin(a) * d0, k + Math.floor(timeMs / 60), 3, false, 3);
        }
      }
      // 纏う電気: 体の輪郭のあたりを、短い稲妻が場所を変えながら走る
      const seed = Math.floor(timeMs / 70);
      const n = 3 + stacks * 2;
      for (let k = 0; k < n; k++) {
        const a0 = rnd(k, seed + p.id) * Math.PI * 2;
        const a1 = a0 + 0.8 + rnd(k + 9, seed) * 0.9;
        const rx = 22 + (k % 3) * 4;
        const ry = 24 + (k % 2) * 5;
        // 体の上下を回り込む弧（途中の点を外へふくらませる）
        const am = (a0 + a1) / 2;
        const mx = cx + Math.cos(am) * rx * 1.25;
        const my = cy + Math.sin(am) * ry * 1.25;
        const w = 2.5 + stacks * 0.8;
        this.bolt(cx + Math.cos(a0) * rx, cy + Math.sin(a0) * ry, mx, my, seed * 7 + k, w, false, 2);
        this.bolt(mx, my, cx + Math.cos(a1) * rx, cy + Math.sin(a1) * ry, seed * 7 + k + 50, w, false, 2);
      }
      for (let k = 0; k < stacks * 3; k++) {
        const a = rnd(k, seed) * Math.PI * 2;
        this.front.dot(cx + Math.cos(a) * 26, cy + Math.sin(a) * 26, 3, k % 2 ? 0xffd600 : 0xffffff);
      }
    }
  }

  /** 押している間（本人）: しんそく は折れ線の道、ライジングボルト は雷が落ちる所の印（コンボの相手は全員） */
  private drawAim(world: World, timeMs: number, localId: number, aimSlot: number | null): void {
    const me = world.players.find((p) => p.id === localId);
    const slot = aimSlot !== null ? me?.skills?.[aimSlot] : undefined;
    if (!me || !slot || me.down) return;
    const kind = world.rules.activeSkills?.defs[slot.skill]?.kind;
    const ready = slot.charges > 0;
    if (kind === 'extremeSpeed') {
      if (me.esDash) return;
      const pts = extremeSpeedPreview(world, me, slot.skill);
      if (!pts) return;
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1]!;
        const b = pts[k]!;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const step = 18;
        const off = (timeMs / 15) % step;
        for (let d = off; d < len; d += step) this.front.dot(a.x + ((b.x - a.x) * d) / len, a.y + ((b.y - a.y) * d) / len, 5, ready ? 0xffee58 : 0x6d6a4a);
        if (k < pts.length - 1) for (let q = 0; q < 4; q++) this.front.dot(b.x + Math.cos(q * 1.57 + timeMs / 200) * 12, b.y + Math.sin(q * 1.57 + timeMs / 200) * 12, 5, 0xffffff);
      }
      const end = pts[pts.length - 1]!;
      this.front.dot(end.x, end.y, 9, ready ? 0xfff59d : 0x6d6a4a);
    } else if (kind === 'risingVoltage') {
      const pv = risingVoltagePreview(world, me, slot.skill);
      if (!pv) return;
      for (const s of pv.spots) {
        const rr = pv.combo ? 30 : 24;
        const n = 10;
        for (let q = 0; q < n; q++) {
          const a = timeMs / 300 + (q / n) * Math.PI * 2;
          this.front.dot(s.x + Math.cos(a) * rr, s.y + Math.sin(a) * rr * 0.45, 4, !ready ? 0x6d6a4a : pv.combo ? 0xffffff : 0xffd600);
        }
      }
    }
  }
}
