import Phaser from 'phaser';
import type { World } from '../../sim/world';
import { moltresAim, thunderboltAim } from '../../sim/activeSkills';
import { zapNetwork } from '../../sim/systems/attack';
import { DotPool, c, makeTexture, on, rnd, shade } from './dotArt';

/**
 * 遊べるサンダーの技の絵（07 の316章）:
 * - ドリルくちばし: くちばしの先に回る黄色いドリル（ねじれの筋が回る）をつけて、向きへ突き抜ける。後ろに 3 本の光の筋
 * - でんじほう: 大きな電気の球（白い芯のまわりを稲妻が回り、縁で火花がはじける）がゆっくり進む。自分の球どうしは、ぎざぎざの電気の帯でつながる（共鳴）
 * - 10まんボルト: サンダーから向きへ太い稲妻が走る。でんじほう の網に当たると、つながった球が大きくはじけ（外へ稲妻が伸びる）、帯の上も太い稲妻になってはじける
 * - でんきショック: 小さな電気の粒
 * 電気・光は不透明のドット絵と不透明の線（薄い塗りは使わない。画面全体は光らせない。画面は揺らさない）
 */

const ORB = 48;
const ORB_FRAMES = 4;
const DRILL_W = 40;
const DRILL_H = 24;
const DRILL_FRAMES = 3;
const BURST = 64;
const BURST_FRAMES = 3;
const SPARK = 12;
const SPARK_FRAMES = 2;
const BURST_MS = 420;
const BAND_MS = 260;
const SPARK_MS = 160;
/** サンダーの絵の体の中心の高さ（足元からの上。飛んでいるので高い） */
const BODY_Y = 32;

const VOLT = [0x8a6d00, 0xf9a825, 0xffd600, 0xfff59d, 0xffffff];

type Burst = { x: number; y: number; r: number; at: number; seed: number };
type Band = { x: number; y: number; dx: number; dy: number; len: number; at: number; seed: number };

export class ZapdosPlayer {
  private built = false;
  private readonly pool: DotPool;
  private readonly front: DotPool;
  private readonly lines: Phaser.GameObjects.Graphics;
  private dashes = new Map<number, { sx: number; sy: number; dx: number; dy: number }>();
  private bursts: Burst[] = [];
  private bands: Band[] = [];
  private sparks: { x: number; y: number; at: number; seed: number }[] = [];
  private shocks = new Map<number, { x: number; y: number }>();
  private seen = new Set<number>();

  constructor(
    private readonly scene: Phaser.Scene,
    depth: number,
    private readonly frontDepth: number,
  ) {
    this.pool = new DotPool(scene, depth + 0.02);
    this.front = new DotPool(scene, frontDepth + 0.01);
    this.lines = scene.add.graphics().setDepth(frontDepth + 0.015);
  }

  private build(): void {
    if (this.built) return;
    this.built = true;
    const s = this.scene;
    // 電気の球（白い芯 → 黄。中を稲妻の筋が回り、縁がぎざぎざにはじける。4 コマ）
    for (let f = 0; f < ORB_FRAMES; f++) {
      makeTexture(s, `za-orb-${f}`, ORB, ORB, (x, y) => {
        const nx = (x - (ORB - 1) / 2) / (ORB / 2);
        const ny = (y - (ORB - 1) / 2) / (ORB / 2);
        const a = Math.atan2(ny, nx);
        const d = Math.hypot(nx, ny);
        const R = 0.8 + 0.08 * Math.sin(a * 9 + f * 1.7) + 0.06 * Math.sin(a * 17 - f * 2.3);
        if (d > R) {
          // 縁からはじける火花
          if (d < 1 && rnd(Math.round(a * 20), f) > 0.88) return c(0xfff59d);
          return 0;
        }
        const k = d / R;
        // 中を回る稲妻の筋
        const swirl = Math.sin(a * 3 + k * 9 - f * 1.6);
        if (k > 0.25 && Math.abs(swirl) < 0.12) return c(0xffffff);
        if (k > 0.86 && !on((1 - k) * 6, x + f, y)) return 0;
        return shade(VOLT, 1.05 - k * 0.7, x, y);
      });
    }
    // ドリル（右向きの円すい。ねじれの筋がコマで回る）
    for (let f = 0; f < DRILL_FRAMES; f++) {
      makeTexture(s, `za-drill-${f}`, DRILL_W, DRILL_H, (x, y) => {
        const u = x / (DRILL_W - 1);
        const v = (y - (DRILL_H - 1) / 2) / (DRILL_H / 2);
        const w = (1 - u) * 0.95 + 0.04;
        if (Math.abs(v) > w) return 0;
        const twist = ((u * 7 + (v / w) * 1.1 + f / DRILL_FRAMES) % 1 + 1) % 1;
        if (twist < 0.22) return c(0xffffff);
        return shade(VOLT, 0.95 - Math.abs(v / w) * 0.45 - (1 - u) * 0.15, x, y);
      });
    }
    // はじける電気（白い芯から外へ稲妻の放射。3 コマで広がって細くなる）
    for (let f = 0; f < BURST_FRAMES; f++) {
      makeTexture(s, `za-burst-${f}`, BURST, BURST, (x, y) => {
        const nx = (x - (BURST - 1) / 2) / (BURST / 2);
        const ny = (y - (BURST - 1) / 2) / (BURST / 2);
        const a = Math.atan2(ny, nx);
        const d = Math.hypot(nx, ny);
        const core = 0.42 - f * 0.12;
        if (d < core) return shade(VOLT, 1.05 - d / core * 0.4, x, y);
        // 放射の稲妻（12 本。ぎざぎざ）
        const n = 12;
        const ray = (a / (Math.PI * 2)) * n + Math.sin(d * 14 + f) * 0.18;
        const off = Math.abs(ray - Math.round(ray));
        const reach = 0.7 + f * 0.13 + rnd(Math.round(ray), 3) * 0.15;
        if (d < reach && off < 0.07 + (1 - d) * 0.05) return d < reach * 0.6 ? c(0xffffff) : c(0xffd600);
        return 0;
      });
    }
    // でんきショック（小さな電気の粒 2 コマ）
    for (let f = 0; f < SPARK_FRAMES; f++) {
      makeTexture(s, `za-spark-${f}`, SPARK, SPARK, (x, y) => {
        const d = Math.hypot(x - 5.5, y - 5.5);
        if (d < 2.2) return c(0xffffff);
        if (d < 3.6) return c(0xffd600);
        const a = Math.atan2(y - 5.5, x - 5.5);
        if (d < 5.8 && Math.abs(Math.sin(a * 3 + f * 1.5)) > 0.93) return c(0xfff59d);
        return 0;
      });
    }
  }

  /** ぎざぎざの稲妻の線（太さ width・色 col。seed で形が変わる） */
  private bolt(ax: number, ay: number, bx: number, by: number, seed: number, width: number, col: number, jag = 12): void {
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1 || width < 1) return;
    const dx = (bx - ax) / len;
    const dy = (by - ay) / len;
    const n = Math.max(2, Math.round(len / 22));
    const g = this.lines;
    g.lineStyle(width, col, 1).beginPath().moveTo(ax, ay);
    for (let k = 1; k <= n; k++) {
      const t = (k / n) * len;
      const j = k === n ? 0 : (rnd(k, seed) - 0.5) * jag;
      g.lineTo(ax + dx * t - dy * j, ay + dy * t + dx * j);
    }
    g.strokePath();
  }

  update(world: World, timeMs: number, localId: number, aimSlot: number | null): void {
    const moves = world.rules.moves;
    const dp = moves.findIndex((m) => m.key === 'drill-peck-zapdos');
    const zc = moves.findIndex((m) => m.key === 'zap-cannon-zapdos');
    const tb = moves.findIndex((m) => m.key === 'thunderbolt-zapdos');
    const ts = moves.findIndex((m) => m.key === 'thunder-shock-zapdos');
    const pr = world.projectiles;
    this.lines.clear();
    this.pool.begin();
    this.front.begin();
    let any = this.bursts.length > 0 || this.bands.length > 0 || this.sparks.length > 0 || this.shocks.size > 0 || aimSlot !== null;
    for (let i = 0; i < pr.count && !any; i++) {
      const m = pr.move[i];
      if (m === dp || m === zc || m === tb || m === ts) any = true;
    }
    if (!any) {
      this.pool.end();
      this.front.end();
      return;
    }
    this.build();
    const flick = Math.floor(timeMs / 70);
    const liveDash = new Set<number>();
    const liveShock = new Set<number>();
    const owners = new Set<number>();
    for (let i = 0; i < pr.count; i++) {
      const m = pr.move[i];
      const id = pr.serial[i]!;
      const x = pr.x[i]!;
      const y = pr.y[i]!;
      const r = pr.radius[i]!;
      if (m === dp) {
        const owner = world.players.find((q) => q.id === pr.owner[i]);
        if (pr.stage[i] === 3) {
          // 構え: くちばしの先に電気が集まる
          if (owner) for (let q = 0; q < 6; q++) this.front.dot(owner.x + (owner.facingX || 0) * 30 + (rnd(q, flick) - 0.5) * 16, owner.y - BODY_Y + (owner.facingY || 0) * 30 + (rnd(q + 5, flick) - 0.5) * 16, 4, q % 2 ? 0xffd600 : 0xffffff);
          continue;
        }
        liveDash.add(id);
        let d = this.dashes.get(id);
        if (!d) {
          d = { sx: owner?.x ?? x, sy: owner?.y ?? y, dx: pr.dirX[i]!, dy: pr.dirY[i]! };
          this.dashes.set(id, d);
        }
        this.drawDrill(d, owner?.x ?? x, owner?.y ?? y, r, timeMs);
      } else if (m === zc) {
        if (pr.stage[i] !== 0 || pr.shape[i] !== 0) continue;
        owners.add(pr.owner[i]!);
        const img = this.pool.image(`za-orb-${(Math.floor(timeMs / 60) + id) % ORB_FRAMES}`, this.frontDepth - 0.03);
        img.setPosition(x, y - 20).setScale((r * 2.3) / ORB);
        // 足元の影（地面に落ちる光ではなく、浮いている印）
        for (let q = -2; q <= 2; q++) this.pool.dot(x + q * r * 0.25, y + r * 0.45, 4, 0x6b5a1a);
      } else if (m === tb) {
        if (pr.stage[i] === 0 && pr.shape[i] === 1) {
          const owner = world.players.find((q) => q.id === pr.owner[i]);
          const sx = owner?.x ?? x;
          const sy = (owner?.y ?? y) - BODY_Y * 0.6;
          const ex = sx + pr.dirX[i]! * pr.length[i]!;
          const ey = sy + pr.dirY[i]! * pr.length[i]!;
          this.bolt(sx, sy, ex, ey, flick * 7 + id, 9, 0xf9a825, 20);
          this.bolt(sx, sy, ex, ey, flick * 7 + id, 5, 0xffd600, 20);
          this.bolt(sx, sy, ex, ey, flick * 7 + id, 2, 0xffffff, 20);
          for (let q = 0; q < 6; q++) this.front.dot(ex + (rnd(q, flick) - 0.5) * 30, ey + (rnd(q + 4, flick) - 0.5) * 30, 5, q % 2 ? 0xffffff : 0xffd600);
        } else if (pr.stage[i] === 1 && !this.seen.has(id)) {
          this.seen.add(id);
          if (pr.shape[i] === 1) this.bands.push({ x, y: y - 20, dx: pr.dirX[i]!, dy: pr.dirY[i]!, len: pr.length[i]!, at: timeMs, seed: id });
          else this.bursts.push({ x, y: y - 20, r, at: timeMs, seed: id });
        }
      } else if (m === ts && pr.stage[i] === 0) {
        liveShock.add(id);
        this.shocks.set(id, { x, y });
        const img = this.front.image(`za-spark-${(flick + id) % SPARK_FRAMES}`, this.frontDepth - 0.01);
        img.setPosition(x, y).setScale((r * 2.6) / SPARK);
      }
    }
    // 共鳴の帯（自分の球どうし）
    for (const o of owners) {
      const net = zapNetwork(world, o);
      for (const [a, b] of net.links) {
        const A = net.spheres[a]!;
        const B = net.spheres[b]!;
        const seed = A.serial * 31 + B.serial + flick;
        this.bolt(A.x, A.y - 20, B.x, B.y - 20, seed, 6, 0xf9a825, 16);
        this.bolt(A.x, A.y - 20, B.x, B.y - 20, seed, 2, 0xffffff, 16);
        this.bolt(A.x, A.y - 20, B.x, B.y - 20, seed + 3, 2, 0xfff59d, 22);
      }
    }
    for (const id of this.dashes.keys()) if (!liveDash.has(id)) this.dashes.delete(id);
    for (const [id, s] of this.shocks) {
      if (liveShock.has(id)) continue;
      this.shocks.delete(id);
      this.sparks.push({ x: s.x, y: s.y, at: timeMs, seed: id });
    }
    if (this.seen.size > 600) this.seen.clear();
    this.drawBursts(timeMs);
    this.drawSparks(timeMs);
    this.drawAim(world, timeMs, localId, aimSlot);
    this.pool.end();
    this.front.end();
  }

  /** ドリルくちばし: くちばしの先の回るドリルと、後ろの 3 本の光の筋 */
  private drawDrill(d: { sx: number; sy: number; dx: number; dy: number }, x: number, y: number, r: number, timeMs: number): void {
    const cy = y - BODY_Y;
    const len = Math.hypot(x - d.sx, y - d.sy);
    for (const o of [-1, 0, 1]) {
      for (let t = 0; t < len; t += 9) {
        const k = t / Math.max(1, len);
        if ((Math.floor(t / 9) + o) % 3 === 0) continue;
        this.pool.dot(d.sx + d.dx * t - d.dy * o * r * 0.5, d.sy - BODY_Y + d.dy * t + d.dx * o * r * 0.5, o === 0 ? 5 : 3, k > 0.6 ? 0xffffff : 0xffd600);
      }
    }
    const img = this.front.image(`za-drill-${Math.floor(timeMs / 40) % DRILL_FRAMES}`, this.frontDepth + 0.02);
    img.setOrigin(0, 0.5).setPosition(x + d.dx * 6, cy + d.dy * 6).setRotation(Math.atan2(d.dy, d.dx)).setScale((r * 2.4) / DRILL_W, (r * 1.5) / DRILL_H);
  }

  /** はじける球（放射の稲妻が広がる）と、はじける帯（太い稲妻が太く光ってから消える） */
  private drawBursts(timeMs: number): void {
    this.bursts = this.bursts.filter((b) => timeMs - b.at < BURST_MS);
    for (const b of this.bursts) {
      const t = (timeMs - b.at) / BURST_MS;
      const f = Math.min(BURST_FRAMES - 1, Math.floor(t * BURST_FRAMES));
      const img = this.front.image(`za-burst-${f}`, this.frontDepth + 0.01);
      img.setPosition(b.x, b.y).setScale((b.r * 2.2) / BURST).setRotation(b.seed);
      // 外へ伸びる稲妻
      for (let q = 0; q < 5; q++) {
        const a = (q / 5) * Math.PI * 2 + rnd(q, b.seed) * 0.8;
        const reach = b.r * (0.8 + t * 0.7);
        this.bolt(b.x, b.y, b.x + Math.cos(a) * reach, b.y + Math.sin(a) * reach * 0.8, b.seed * 5 + q + Math.floor(timeMs / 60), t < 0.5 ? 4 : 2, t < 0.5 ? 0xffffff : 0xffd600, 18);
      }
    }
    this.bands = this.bands.filter((b) => timeMs - b.at < BAND_MS);
    for (const b of this.bands) {
      const t = (timeMs - b.at) / BAND_MS;
      const w = Math.round(14 * (1 - t)) + 2;
      const seed = b.seed + Math.floor(timeMs / 50);
      this.bolt(b.x, b.y, b.x + b.dx * b.len, b.y + b.dy * b.len, seed, w, 0xf9a825, 26);
      this.bolt(b.x, b.y, b.x + b.dx * b.len, b.y + b.dy * b.len, seed, Math.max(1, w - 6), 0xffffff, 26);
    }
  }

  /** でんきショック が消えた所の小さな火花 */
  private drawSparks(timeMs: number): void {
    this.sparks = this.sparks.filter((s) => timeMs - s.at < SPARK_MS);
    for (const s of this.sparks) {
      const t = (timeMs - s.at) / SPARK_MS;
      for (let q = 0; q < 4; q++) {
        const a = (q / 4) * Math.PI * 2 + s.seed;
        this.front.dot(s.x + Math.cos(a) * (3 + t * 14), s.y + Math.sin(a) * (3 + t * 14), Math.round(4 * (1 - t)) + 1, q % 2 ? 0xffffff : 0xffd600);
      }
    }
  }

  /** 押している間（本人）: ドリルくちばし は突き抜ける道、10まんボルト は稲妻の道（でんじほう に当たるなら明るく脈打つ） */
  private drawAim(world: World, timeMs: number, localId: number, aimSlot: number | null): void {
    const me = world.players.find((p) => p.id === localId);
    const slot = aimSlot !== null ? me?.skills?.[aimSlot] : undefined;
    if (!me || !slot || me.down) return;
    const ready = slot.charges > 0;
    const step = 18;
    const off = (timeMs / 15) % step;
    const tb = thunderboltAim(world, me, slot.skill);
    if (tb) {
      const col = !ready ? 0x6d6a4a : tb.hits ? (Math.floor(timeMs / 120) % 2 ? 0xffffff : 0xffd600) : 0xf9a825;
      for (let d = 20 + off; d < tb.len; d += step) this.front.dot(tb.x + tb.dx * d, tb.y - BODY_Y * 0.6 + tb.dy * d, tb.hits ? 6 : 4, col);
      return;
    }
    const aim = moltresAim(world, me, slot.skill);
    if (!aim?.path || aim.path.length < 2) return;
    const [a, b] = [aim.path[0]!, aim.path[1]!];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const dx = (b.x - a.x) / len;
    const dy = (b.y - a.y) / len;
    const w = aim.width ?? 30;
    const col = ready ? 0xffd600 : 0x6d6a4a;
    for (const side of [-1, 1]) for (let d = off; d < len; d += step) this.front.dot(a.x + dx * d - dy * w * side, a.y + dy * d + dx * w * side, 4, col);
  }
}
