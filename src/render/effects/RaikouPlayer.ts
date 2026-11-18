import Phaser from 'phaser';
import type { World } from '../../sim/world';
import { extremeSpeedPreview, risingVoltagePreview } from '../../sim/activeSkills';
import { shockFull } from '../../sim/systems/attack';
import { DotPool, c, makeTexture, on, rnd, shade } from './dotArt';

/**
 * 遊べるライコウの技の絵（07 の309・310章）:
 * - しんそく: 1 体目から左右に折れて抜ける稲妻の道を駆け抜ける。押している間は道を見せる
 * - エレキフィールド: ライコウの足元に広がる、電気が走る地面（雑魚より下）。中の敵に びりびり の火花が重なる
 * - じゅうでん: まわりから電気が集まり、ためている間は体のまわりを火花が回る
 * - ライジングボルト: 地面の輪が光り、雷の柱が立ちのぼる。重ねきった敵へのコンボは、足元が白く弾け、岩が飛び、太い柱が立つ
 * 地面・輪・岩・柱の芯は 1 ドットずつ計算した不透明のドット絵、稲妻は不透明の線（薄い塗りは使わない。画面全体は光らせない）
 */

const FIELD_W = 128;
const FIELD_H = 64;
const FIELD_FRAMES = 4;
const RING_W = 96;
const RING_H = 40;
const PILLAR_W = 24;
const PILLAR_H = 128;
const BURST = 96;
const TRAIL_MS = 420;
const PILLAR_MS = 520;
const COMBO_MS = 900;
const CHARGE_MS = 520;
/** 柱の高さ（地面からの見た目の高さ） */
const PILLAR_LIFT = 230;

const FIELD = [0x3a2c06, 0x6b5410, 0xa67c00];
const ROCK = [0x2e2a26, 0x4a443d, 0x6d655b, 0x968b7d];

type Strike = { x: number; y: number; r: number; at: number; seed: number; combo: boolean };

export class RaikouPlayer {
  private built = false;
  private readonly pool: DotPool;
  private readonly front: DotPool;
  private readonly lines: Phaser.GameObjects.Graphics;
  private trails: { ax: number; ay: number; bx: number; by: number; at: number; seed: number }[] = [];
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
    // エレキフィールド: 地面に散る暗い黄色の点（地面が透けて見えるディザ）と、コマごとに場所が変わる電気の筋
    for (let f = 0; f < FIELD_FRAMES; f++) {
      makeTexture(s, `rk-field-${f}`, FIELD_W, FIELD_H, (x, y) => {
        const nx = (x - (FIELD_W - 1) / 2) / (FIELD_W / 2);
        const ny = (y - (FIELD_H - 1) / 2) / (FIELD_H / 2);
        const r = Math.hypot(nx, ny);
        if (r > 1) return 0;
        // ふち: 細い明るい輪（ところどころ切れる）
        if (r > 0.94) return Math.sin(Math.atan2(ny, nx) * 9 + f * 1.4) > -0.4 ? c(r > 0.97 ? 0xfbc02d : 0xffe082) : 0;
        // 地面を走る筋: 中心から外へ折れながら伸びる 5 本
        const a = Math.atan2(ny, nx);
        for (let k = 0; k < 5; k++) {
          const base = (k / 5) * Math.PI * 2 + f * 0.7 + rnd(k, f) * 0.6;
          const wob = Math.sin(r * 14 + k * 3 + f * 2) * 0.12;
          const d = Math.abs(Math.atan2(Math.sin(a - base - wob), Math.cos(a - base - wob))) * r * FIELD_W * 0.5;
          if (r > 0.12 && r < 0.9 && d < 0.8) return c(0xfff59d);
          if (r > 0.12 && r < 0.9 && d < 1.8) return c(0xffd600);
        }
        // 地の点: 外ほど少し濃い（地面が透ける程度）
        return on(0.1 + r * 0.14, x, y) ? shade(FIELD, 0.3 + r * 0.6, x, y) : 0;
      });
    }
    // ライジングボルトの地面の輪（ふつう: 黄色。コンボ: 白に近い）
    for (const [key, cols] of [
      ['rk-ring', [0x8a5a00, 0xf9a825, 0xffd600, 0xfff176]],
      ['rk-ring-combo', [0xf9a825, 0xffe082, 0xfff9c4, 0xffffff]],
    ] as const) {
      makeTexture(s, key, RING_W, RING_H, (x, y) => {
        const nx = (x - (RING_W - 1) / 2) / (RING_W / 2);
        const ny = (y - (RING_H - 1) / 2) / (RING_H / 2);
        const r = Math.hypot(nx, ny);
        if (r > 1 || r < 0.62) return r < 0.62 && on((0.62 - r) * 0.5, x, y) ? c(cols[1]) : 0;
        const t = 1 - Math.abs(r - 0.82) / 0.2;
        return shade(cols, t, x, y);
      });
    }
    // 雷の柱の芯（下が太く上が細い。折れながら立ちのぼる）
    makeTexture(s, 'rk-pillar', PILLAR_W, PILLAR_H, (x, y) => {
      const t = 1 - y / PILLAR_H;
      const cx = PILLAR_W / 2 + Math.sin(t * 13) * 2.4 * t + Math.sin(t * 31) * 1;
      const w = 9 - t * 6;
      const d = Math.abs(x - cx);
      if (d < w * 0.4) return c(0xffffff);
      if (d < w * 0.75) return c(0xfff59d);
      if (d < w) return on(1 - (d - w * 0.75) / (w * 0.25), x, y) ? c(0xffd600) : 0;
      return 0;
    });
    // コンボの足元の弾け（白 → 黄 → 橙。ふちはギザギザ）
    makeTexture(s, 'rk-burst', BURST, BURST / 2, (x, y) => {
      const nx = (x - (BURST - 1) / 2) / (BURST / 2);
      const ny = (y - (BURST / 2 - 1) / 2) / (BURST / 4);
      const r = Math.hypot(nx, ny);
      const a = Math.atan2(ny, nx);
      const edge = 0.82 + Math.abs(Math.sin(a * 7)) * 0.18;
      if (r > edge) return 0;
      if (r < 0.35) return c(0xffffff);
      if (r < 0.6) return on(1.4 - r * 1.2, x, y) ? c(0xffffff) : c(0xfff59d);
      return on(1.2 - r, x, y) ? c(0xffd600) : c(0xf57f17);
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

  /** ギザギザの稲妻の線（a → b）。太い黄色の上に白い芯 */
  private bolt(ax: number, ay: number, bx: number, by: number, seed: number, width: number, branches: boolean, n = 7): void {
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
    for (const [w, col] of [[width, 0xffd600], [Math.max(1, width * 0.45), 0xffffff]] as const) {
      this.lines.lineStyle(w, col, 1).beginPath().moveTo(pts[0]![0], pts[0]![1]);
      for (const p of pts.slice(1)) this.lines.lineTo(p[0], p[1]);
      this.lines.strokePath();
    }
    if (!branches) return;
    for (let k = 2; k < n - 1; k += 2) {
      const [sx, sy] = pts[k]!;
      const a = Math.atan2(by - ay, bx - ax) + (rnd(k, seed + 7) - 0.5) * 1.6;
      const l = len * 0.18;
      this.lines.lineStyle(Math.max(1, width * 0.5), 0xffd600, 1).beginPath().moveTo(sx, sy).lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l).strokePath();
    }
  }

  update(world: World, timeMs: number, localId: number, aimSlot: number | null): void {
    const moves = world.rules.moves;
    const es = moves.findIndex((m) => m.key === 'extreme-speed-raikou');
    const rv = moves.findIndex((m) => m.key === 'rising-voltage-raikou');
    const ef = moves.findIndex((m) => m.key === 'electric-terrain-raikou');
    const pr = world.projectiles;
    const e = world.enemies;
    this.lines.clear();
    this.pool.begin();
    this.front.begin();
    let any = this.trails.length > 0 || this.strikes.length > 0 || aimSlot !== null || this.charges.size > 0;
    for (let i = 0; i < pr.count && !any; i++) if (pr.move[i] === es || pr.move[i] === rv || pr.move[i] === ef) any = true;
    for (const p of world.players) if (p.charged) any = true;
    for (let i = 0; i < e.count && !any; i++) if (e.shock[i]! > 0) any = true;
    if (!any) {
      this.pool.end();
      this.front.end();
      return;
    }
    this.build();
    const frame = Math.floor(timeMs / 90) % FIELD_FRAMES;
    for (let i = 0; i < pr.count; i++) {
      const m = pr.move[i];
      const x = pr.x[i]!;
      const y = pr.y[i]!;
      const r = pr.radius[i]!;
      if (m === ef && pr.stage[i] === 0) {
        // エレキフィールド: 足元の地面
        const img = this.pool.image(`rk-field-${frame}`, this.floorDepth);
        img.setPosition(x, y).setScale((r * 2) / FIELD_W, r / FIELD_H);
      } else if (m === rv) {
        if (pr.stage[i] === 3) {
          // 立ちのぼる前: 足元の輪が広がって明るくなり、小さな火花が立つ
          const combo = pr.armStage[i] === 1;
          const k = Math.min(1, (timeMs / 1000) % 0.4 / 0.4);
          const ring = this.pool.image(combo ? 'rk-ring-combo' : 'rk-ring', this.floorDepth + 0.1);
          ring.setPosition(x, y).setScale(((r * 1.5) / RING_W) * (0.75 + k * 0.25), ((r * 0.68) / RING_H) * (0.75 + k * 0.25));
          for (let q = 0; q < (combo ? 6 : 4); q++) {
            const a = rnd(q, pr.serial[i]!) * Math.PI * 2;
            const ph = (timeMs / 260 + rnd(q, 9)) % 1;
            this.front.dot(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.4 - ph * 26, 3, ph < 0.5 ? 0xffffff : 0xffd600);
          }
        } else if (!this.seen.has(pr.serial[i]!)) {
          this.seen.add(pr.serial[i]!);
          this.strikes.push({ x, y, r, at: timeMs, seed: pr.serial[i]!, combo: pr.stage[i] === 1 });
        }
      } else if (m === es && !this.seen.has(pr.serial[i]!)) {
        this.seen.add(pr.serial[i]!);
        const len = pr.length[i]!;
        this.trails.push({ ax: x, ay: y, bx: x + pr.dirX[i]! * len, by: y + pr.dirY[i]! * len, at: timeMs, seed: pr.serial[i]! });
      }
    }
    if (this.seen.size > 600) this.seen.clear();
    this.drawShock(world, timeMs);
    this.drawStrikes(timeMs);
    this.drawCharge(world, timeMs);
    // しんそくの道: 稲妻が道に残り、細くなって消える
    this.trails = this.trails.filter((tr) => timeMs - tr.at < TRAIL_MS);
    for (const tr of this.trails) {
      const t = (timeMs - tr.at) / TRAIL_MS;
      this.bolt(tr.ax, tr.ay, tr.bx, tr.by, tr.seed + Math.floor(timeMs / 60), 8 * (1 - t) + 1, t < 0.5);
    }
    this.drawAim(world, timeMs, localId, aimSlot);
    this.pool.end();
    this.front.end();
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
        // 頭の上の印: 小さな稲妻の形
        const hy = y - r * 2 - 10;
        for (const [dx, dy] of [[1, -4], [0, -2], [-1, 0], [1, 0], [0, 2], [-1, 4]] as const) this.front.dot(x + dx * 2, hy + dy * 2, 3, 0xfff176);
      }
    }
  }

  /** ライジングボルトの柱（ふつう・コンボ） */
  private drawStrikes(timeMs: number): void {
    this.strikes = this.strikes.filter((s) => timeMs - s.at < (s.combo ? COMBO_MS : PILLAR_MS));
    for (const s of this.strikes) {
      const span = s.combo ? COMBO_MS : PILLAR_MS;
      const t = (timeMs - s.at) / span;
      const lift = PILLAR_LIFT * (s.combo ? 1.25 : 1);
      // 足元: ふつうは輪、コンボは白い弾け（縮みながら消える）
      if (s.combo && t < 0.5) {
        const b = this.pool.image('rk-burst', this.floorDepth + 0.2);
        const k = 1 - t * 1.6;
        b.setPosition(s.x, s.y).setScale(((s.r * 1.6) / BURST) * (0.6 + k * 0.5), ((s.r * 0.8) / (BURST / 2)) * (0.6 + k * 0.5));
      }
      if (t < 0.7) {
        const ring = this.pool.image(s.combo ? 'rk-ring-combo' : 'rk-ring', this.floorDepth + 0.1);
        const k = 1 + t * 0.5;
        ring.setPosition(s.x, s.y).setScale(((s.r * 1.5) / RING_W) * k, ((s.r * 0.68) / RING_H) * k);
      }
      // 柱: 下から一気に立ちのぼり（最初の 12%）、細くなって消える
      const grow = Math.min(1, t / 0.12);
      const fade = t < 0.45 ? 1 : 1 - (t - 0.45) / 0.55;
      if (fade > 0.05) {
        const core = this.front.image('rk-pillar', this.frontDepth);
        const w = (s.combo ? 2.8 : 2) * fade;
        core.setOrigin(0.5, 1).setPosition(s.x, s.y).setScale(w, (lift * grow) / PILLAR_H);
        // まわりを登る稲妻（コマごとに形が変わる）
        const seed = s.seed + Math.floor(timeMs / 50);
        const n = s.combo ? 4 : 2;
        for (let k = 0; k < n; k++) {
          const off = (k - (n - 1) / 2) * s.r * 0.35;
          this.bolt(s.x + off, s.y, s.x + off * 0.3, s.y - lift * grow, seed + k * 5, (s.combo ? 5 : 3.5) * fade + 1, k === 0);
        }
      }
      // 横へ散る火花の線（地面すれすれ）
      if (t < 0.5) {
        const n = s.combo ? 8 : 5;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + rnd(k, s.seed) * 0.5;
          const d0 = s.r * (0.3 + t * 1.6);
          const d1 = d0 + s.r * 0.5;
          this.bolt(s.x + Math.cos(a) * d0, s.y + Math.sin(a) * d0 * 0.45, s.x + Math.cos(a) * d1, s.y + Math.sin(a) * d1 * 0.45 - s.r * 0.3, s.seed + k, 2 * (1 - t * 2) + 1, false, 3);
        }
      }
      // コンボ: 岩が飛び上がって落ちる
      if (s.combo) {
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + rnd(k, s.seed) * 0.8;
          const sp = s.r * (0.9 + rnd(k, s.seed + 1) * 0.9);
          const up = 260 + rnd(k, s.seed + 2) * 160;
          const tt = t * (COMBO_MS / 1000);
          const h = up * tt - 700 * tt * tt;
          if (h < -2 && tt > 0.1) continue;
          const rock = this.front.image(`rk-rock-${k % 3}`, this.frontDepth - 0.005);
          rock.setPosition(s.x + Math.cos(a) * sp * tt * 1.8, s.y + Math.sin(a) * sp * tt * 0.8 - Math.max(0, h)).setScale(2 + (k % 2)).setRotation(tt * (k % 2 ? 6 : -5));
        }
      }
    }
  }

  /** じゅうでん: 使った瞬間はまわりから電気が集まり、ためている間は体のまわりを火花が回る（重ねた数だけ） */
  private drawCharge(world: World, timeMs: number): void {
    for (const p of world.players) {
      const stacks = p.charged?.stacks ?? 0;
      const prev = this.charges.get(p.id);
      if (stacks === 0) {
        this.charges.delete(p.id);
        continue;
      }
      if (!prev || stacks > prev.stacks) this.charges.set(p.id, { stacks, at: timeMs });
      else if (stacks < prev.stacks) this.charges.set(p.id, { stacks, at: prev.at - CHARGE_MS });
      const st = this.charges.get(p.id)!;
      const cx = p.x;
      const cy = p.y - 16;
      const t = (timeMs - st.at) / CHARGE_MS;
      if (t < 1) {
        // 6 方向から体へ集まる短い稲妻
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + st.at * 0.001;
          const d0 = 90 * (1 - t) + 14;
          const d1 = d0 + 26 * (1 - t);
          this.bolt(cx + Math.cos(a) * d1, cy + Math.sin(a) * d1, cx + Math.cos(a) * d0, cy + Math.sin(a) * d0, k + Math.floor(timeMs / 60), 3, false, 3);
        }
      }
      // ためている間: 重ねた数だけ火花が回る
      for (let k = 0; k < stacks * 2; k++) {
        const a = timeMs / 160 + (k / (stacks * 2)) * Math.PI * 2;
        const rr = 22 + (k % 2) * 6;
        this.front.dot(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.55, 4, k % 2 ? 0xffd600 : 0xffffff);
      }
    }
  }

  /** 押している間（本人）: しんそく は折れ線の道、ライジングボルト は柱が立つ所の印（コンボの相手は全員） */
  private drawAim(world: World, timeMs: number, localId: number, aimSlot: number | null): void {
    const me = world.players.find((p) => p.id === localId);
    const slot = aimSlot !== null ? me?.skills?.[aimSlot] : undefined;
    if (!me || !slot || me.down) return;
    const kind = world.rules.activeSkills?.defs[slot.skill]?.kind;
    const ready = slot.charges > 0;
    if (kind === 'extremeSpeed') {
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
        // 地面の輪が回る（コンボの相手は白く大きく）
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
