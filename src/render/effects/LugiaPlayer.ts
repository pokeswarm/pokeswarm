import Phaser from 'phaser';
import type { World } from '../../sim/world';
import { aimOf, moltresAim } from '../../sim/activeSkills';
import { DotPool, c, makeTexture, on, rnd, shade } from './dotArt';

/**
 * 遊べるルギアの技の絵（07 の317章）:
 * - エアロブラスト: 口もとにまわりの風の筋が吸い込まれて青白い風の玉がふくらみ、撃たれた玉がまっすぐ飛んで着弾で風が爆ぜる（輪に広がる風の筋）。
 *   その場に竜巻（渦を巻く漏斗の形）が残り、まわりのちりが吸い込まれる。ハイドロポンプ の水を吸った竜巻は青い水の竜巻になり、しぶきが舞う
 * - じんつうりき: 狙われた敵の頭の上に青紫の目の模様が開き、まわりがゆがむ → はじけて紫の輪が広がる
 * - ハイドロポンプ: 口もとに水が集まり（しぶきが吸い込まれる）、太い水流がなぎ払う。先でしぶきが散る
 * - かぜおこし: 小さな三日月形の風
 * 風・水・念はすべて 1 ドットずつ計算した不透明のドット絵（薄い塗りは使わない。画面全体は光らせない。画面は揺らさない）
 */

const ORB = 32;
const ORB_FRAMES = 3;
const TORNADO_W = 48;
const TORNADO_H = 96;
const TORNADO_FRAMES = 4;
const EYE_W = 24;
const EYE_H = 14;
const BEAM_W = 64;
const BEAM_H = 24;
const BEAM_FRAMES = 3;
const GUST = 16;
const BURST_MS = 360;
const POP_MS = 300;
/** ルギアの絵の口もとの高さ（足元からの上） */
const MOUTH_Y = 68;

const WIND = [0x4f9ccf, 0x81d4fa, 0xb3e5fc, 0xe1f5fe, 0xffffff];
const WATER = [0x01579b, 0x0288d1, 0x29b6f6, 0x81d4fa, 0xe1f5fe];
const PSY = [0x4527a0, 0x7c4dff, 0xb388ff, 0xede7f6];

type Shot = { ox: number; oy: number; tx: number; ty: number; flight: number };

export class LugiaPlayer {
  private built = false;
  private readonly pool: DotPool;
  private readonly front: DotPool;
  private shots = new Map<number, Shot>();
  private bursts: { x: number; y: number; r: number; at: number; seed: number }[] = [];
  private pops: { x: number; y: number; r: number; at: number; seed: number }[] = [];
  private gusts = new Map<number, { x: number; y: number }>();
  private seen = new Set<number>();

  constructor(
    private readonly scene: Phaser.Scene,
    depth: number,
    private readonly frontDepth: number,
  ) {
    this.pool = new DotPool(scene, depth + 0.02);
    this.front = new DotPool(scene, frontDepth + 0.01);
  }

  private build(): void {
    if (this.built) return;
    this.built = true;
    const s = this.scene;
    // 風の玉（渦を巻く青白い玉。3 コマ）
    for (let f = 0; f < ORB_FRAMES; f++) {
      makeTexture(s, `lu-orb-${f}`, ORB, ORB, (x, y) => {
        const nx = (x - (ORB - 1) / 2) / (ORB / 2);
        const ny = (y - (ORB - 1) / 2) / (ORB / 2);
        const d = Math.hypot(nx, ny);
        if (d > 0.92) return 0;
        const a = Math.atan2(ny, nx);
        const swirl = Math.sin(a * 2 - d * 7 + f * 2.1);
        if (d > 0.78 && !on((0.92 - d) * 7, x + f, y)) return 0;
        return shade(WIND, 1.05 - d * 0.6 + swirl * 0.18, x, y);
      });
    }
    // 竜巻（下が細く上が広い漏斗。斜めの渦の帯がコマで上へ流れる）。水を吸った竜巻は別の色
    for (const [key, cols] of [['lu-tornado', WIND], ['lu-wet', WATER]] as const) {
      for (let f = 0; f < TORNADO_FRAMES; f++) {
        makeTexture(s, `${key}-${f}`, TORNADO_W, TORNADO_H, (x, y) => {
          const t = 1 - y / (TORNADO_H - 1);
          // 体がくねる（上ほど大きく揺れる）。縁はでこぼこにちぎれる
          const cx = (TORNADO_W - 1) / 2 + Math.sin(t * 5 + f * 1.4) * 4 * t + Math.sin(t * 13 - f) * 1.2;
          const w = 2.5 + Math.pow(t, 1.5) * 19 + Math.sin(y * 0.45 + f * 1.9) * 1.6 + (rnd(Math.floor(y / 3), f) - 0.5) * 2.2;
          const dx = (x - cx) / Math.max(1, w);
          const a = Math.abs(dx);
          if (a > 1) {
            // 縁から離れて舞う雲のかけら
            if (a < 1.35 && rnd(x * 7 + f, y) > 0.93) return shade(cols, 0.75, x, y);
            return 0;
          }
          // 渦の帯（斜めの筋が上へ流れる）。帯の間はまばら
          const band = Math.sin(dx * 3 + y * 0.32 - f * 1.6);
          if (band < -0.55 && !on(0.55, x + f, y)) return 0;
          if (a > 0.72 && !on((1 - a) * 4, x + f, y)) return 0;
          return shade(cols, 0.5 + band * 0.35 - a * 0.18 + t * 0.12, x, y);
        });
      }
    }
    // 目の模様（青紫のまぶたと、白い瞳）
    makeTexture(s, 'lu-eye', EYE_W, EYE_H, (x, y) => {
      const nx = (x - (EYE_W - 1) / 2) / (EYE_W / 2);
      const ny = (y - (EYE_H - 1) / 2) / (EYE_H / 2);
      const lid = Math.abs(ny) < (1 - nx * nx) * 1.05;
      if (!lid) return 0;
      const d = Math.hypot(nx * 1.8, ny);
      if (d < 0.32) return c(0xffffff);
      if (d < 0.62) return c(0x7c4dff);
      const edge = Math.abs(ny) > (1 - nx * nx) * 0.75;
      return edge ? c(0xb388ff) : c(0x5e35b1);
    });
    // 水流（右へ流れる帯。白い芯と青い縁、泡の点。3 コマ）
    for (let f = 0; f < BEAM_FRAMES; f++) {
      makeTexture(s, `lu-beam-${f}`, BEAM_W, BEAM_H, (x, y) => {
        const u = x / BEAM_W;
        const v = (y - (BEAM_H - 1) / 2) / (BEAM_H / 2);
        const edge = 0.82 + 0.1 * Math.sin(u * Math.PI * 6 + f * 2.1) + 0.06 * Math.sin(u * Math.PI * 14 - f);
        const a = Math.abs(v);
        if (a > edge) return 0;
        const k = a / edge;
        if (k < 0.5 && rnd(x * 3 + f, y) > 0.94) return c(0xffffff);
        return shade(WATER, 1.02 - k * 0.85 + Math.sin(u * 18 + f * 3 + v * 2) * 0.07, x, y);
      });
    }
    // かぜおこし（三日月形の風）
    makeTexture(s, 'lu-gust', GUST, GUST, (x, y) => {
      const d = Math.hypot(x - 7.5, y - 7.5);
      const d2 = Math.hypot(x - 4.5, y - 7.5);
      if (d < 7 && d2 > 6.2) return d > 5.8 ? c(0xe1f5fe) : c(0x81d4fa);
      return 0;
    });
  }

  update(world: World, timeMs: number, localId: number, aimSlot: number | null): void {
    const moves = world.rules.moves;
    const ab = moves.findIndex((m) => m.key === 'aeroblast-lugia');
    const ex = moves.findIndex((m) => m.key === 'extrasensory-lugia');
    const hp = moves.findIndex((m) => m.key === 'hydro-pump-lugia');
    const gu = moves.findIndex((m) => m.key === 'gust-lugia');
    const pr = world.projectiles;
    this.pool.begin();
    this.front.begin();
    let any = this.bursts.length > 0 || this.pops.length > 0 || this.gusts.size > 0 || aimSlot !== null;
    for (let i = 0; i < pr.count && !any; i++) {
      const m = pr.move[i];
      if (m === ab || m === ex || m === hp || m === gu) any = true;
    }
    if (!any) {
      this.pool.end();
      this.front.end();
      return;
    }
    this.build();
    const cfgA = world.rules.activeSkills?.defs.find((d) => d.kind === 'aeroblast')?.aeroblast;
    const cfgH = world.rules.activeSkills?.defs.find((d) => d.kind === 'hydroPump')?.hydroPump;
    const liveShot = new Set<number>();
    const liveGust = new Set<number>();
    const flick = Math.floor(timeMs / 70);
    for (let i = 0; i < pr.count; i++) {
      const m = pr.move[i];
      const id = pr.serial[i]!;
      const x = pr.x[i]!;
      const y = pr.y[i]!;
      const r = pr.radius[i]!;
      const owner = m === ab || m === hp ? world.players.find((q) => q.id === pr.owner[i]) : undefined;
      if (m === ab) {
        if (pr.stage[i] === 3) {
          // 竜巻の待ち（同じ所・同じ時間）は描かない。風の玉は爆ぜる方（armStage 0）で描く
          if (pr.armStage[i] !== 0) continue;
          liveShot.add(id);
          const flight = cfgA?.flightSeconds ?? 0.3;
          const mx = (owner?.x ?? x) + (owner?.facingX ?? 0) * 26;
          const my = (owner?.y ?? y) - MOUTH_Y + (owner?.facingY ?? 0) * 26;
          if (pr.life[i]! > flight) {
            const total = cfgA?.chargeSeconds || 0.01;
            this.drawGather(mx, my, 1 - (pr.life[i]! - flight) / total, timeMs, WIND);
            const k = Math.max(0, Math.min(1, 1 - (pr.life[i]! - flight) / total));
            this.front.image(`lu-orb-${flick % ORB_FRAMES}`, this.frontDepth + 0.015).setPosition(mx, my).setScale(0.6 + k * 1.4);
            continue;
          }
          let sh = this.shots.get(id);
          if (!sh) {
            sh = { ox: mx, oy: my, tx: x, ty: y - 20, flight };
            this.shots.set(id, sh);
          }
          this.drawShot(sh, pr.life[i]!, timeMs);
        } else if (pr.stage[i] === 0) {
          if (!this.seen.has(id)) {
            this.seen.add(id);
            this.bursts.push({ x, y, r, at: timeMs, seed: id });
          }
        } else if (pr.stage[i] === 1) {
          this.drawTornado(x, y, r, pr.angle[i] === 1, pr.life[i]!, pr.maxLife[i]!, timeMs, id);
        }
      } else if (m === ex) {
        if (pr.stage[i] === 3) this.drawEye(x, y, r, pr.life[i]!, timeMs, id);
        else if (!this.seen.has(id)) {
          this.seen.add(id);
          this.pops.push({ x, y, r, at: timeMs, seed: id });
        }
      } else if (m === hp) {
        const mx = (owner?.x ?? x) + (owner?.facingX ?? 0) * 26;
        const my = (owner?.y ?? y) - MOUTH_Y + (owner?.facingY ?? 0) * 26;
        if (pr.stage[i] === 3) {
          const total = cfgH?.chargeSeconds || 0.01;
          this.drawGather(mx, my, 1 - pr.life[i]! / total, timeMs, WATER);
        } else this.drawBeam(owner?.x ?? x, (owner?.y ?? y) - MOUTH_Y, pr.dirX[i]!, pr.dirY[i]!, pr.length[i]!, r, pr.life[i]!, timeMs);
      } else if (m === gu && pr.stage[i] === 0) {
        liveGust.add(id);
        this.gusts.set(id, { x, y });
        const img = this.front.image('lu-gust', this.frontDepth - 0.01);
        img.setPosition(x, y).setScale((r * 2.2) / GUST).setRotation(Math.atan2(pr.vy[i]!, pr.vx[i]!));
      }
    }
    for (const id of this.shots.keys()) if (!liveShot.has(id)) this.shots.delete(id);
    for (const [id, g] of this.gusts) {
      if (liveGust.has(id)) continue;
      this.gusts.delete(id);
      this.pops.push({ x: g.x, y: g.y, r: -8, at: timeMs, seed: id });
    }
    if (this.seen.size > 600) this.seen.clear();
    this.drawBursts(timeMs);
    this.drawPops(timeMs);
    this.drawAim(world, timeMs, localId, aimSlot);
    this.pool.end();
    this.front.end();
  }

  /** ため: まわりから風の筋（水ならしぶき）が口もとへ吸い込まれる */
  private drawGather(x: number, y: number, t: number, timeMs: number, cols: readonly number[]): void {
    const k = Math.max(0, Math.min(1, t));
    for (let q = 0; q < 10; q++) {
      const a = (q / 10) * Math.PI * 2 + timeMs / 400;
      const far = 80 * (1 - k) + 16;
      for (let s = 0; s < 3; s++) this.front.dot(x + Math.cos(a - s * 0.12) * (far + s * 8), y + Math.sin(a - s * 0.12) * (far + s * 8) * 0.8, s === 0 ? 5 : 3, cols[cols.length - 1 - s]!);
    }
  }

  /** 撃たれた風の玉: まっすぐ飛び、後ろに風の筋 */
  private drawShot(sh: Shot, life: number, timeMs: number): void {
    const t = Math.max(0, Math.min(1, 1 - life / sh.flight));
    const x = sh.ox + (sh.tx - sh.ox) * t;
    const y = sh.oy + (sh.ty - sh.oy) * t;
    const len = Math.hypot(sh.tx - sh.ox, sh.ty - sh.oy) || 1;
    const dx = (sh.tx - sh.ox) / len;
    const dy = (sh.ty - sh.oy) / len;
    for (let q = 1; q <= 8; q++) this.front.dot(x - dx * q * 12 + (rnd(q, Math.floor(timeMs / 50)) - 0.5) * 8, y - dy * q * 12, 6 - Math.floor(q / 2), q < 3 ? 0xffffff : 0xb3e5fc);
    this.front.image(`lu-orb-${Math.floor(timeMs / 70) % ORB_FRAMES}`, this.frontDepth + 0.015).setPosition(x, y).setScale(2.2);
  }

  /** 竜巻: 漏斗の渦（中心の少し上に立つ）。まわりのちり（水ならしぶき）が渦を巻いて吸い込まれる。消える前は細くなる */
  private drawTornado(x: number, y: number, r: number, wet: boolean, life: number, maxLife: number, timeMs: number, id: number): void {
    const k = Math.min(1, life / 0.4, (maxLife - life) / 0.2 + 0.2);
    const f = Math.floor(timeMs / 80 + id) % TORNADO_FRAMES;
    const img = this.pool.image(`${wet ? 'lu-wet' : 'lu-tornado'}-${f}`, this.frontDepth - 0.04);
    img.setOrigin(0.5, 1).setPosition(x, y + r * 0.35).setScale(((r * 1.8) / TORNADO_W) * k, (r * 2.1) / TORNADO_H);
    for (let q = 0; q < 12; q++) {
      const ph = (timeMs / 900 + rnd(q, id)) % 1;
      const a = q * 1.7 + timeMs / 200;
      const d = r * (1.15 - ph);
      this.pool.dot(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.45 - ph * r * 0.6, wet ? 4 : 3, wet ? (q % 2 ? 0xe1f5fe : 0x29b6f6) : q % 2 ? 0xb3e5fc : 0x9e9e9e);
    }
  }

  /** 風が爆ぜる: 輪に広がる風の筋 */
  private drawBursts(timeMs: number): void {
    this.bursts = this.bursts.filter((b) => timeMs - b.at < BURST_MS);
    for (const b of this.bursts) {
      const t = (timeMs - b.at) / BURST_MS;
      const n = 18;
      for (let q = 0; q < n; q++) {
        const a = (q / n) * Math.PI * 2 + b.seed;
        const d = b.r * (0.3 + t * 1.1);
        for (let s = 0; s < 3; s++) {
          const aa = a + s * 0.07;
          this.front.dot(b.x + Math.cos(aa) * d, b.y - 16 + Math.sin(aa) * d * 0.7, Math.round(6 * (1 - t)) + (s === 0 ? 2 : 1), s === 0 ? 0xffffff : 0xb3e5fc);
        }
      }
    }
  }

  /** じんつうりき の待ち: 敵の頭の上に目の模様が開き、まわりがゆがむ */
  private drawEye(x: number, y: number, r: number, life: number, timeMs: number, id: number): void {
    const open = Math.min(1, (0.3 - life) / 0.12 + 0.15);
    const img = this.front.image('lu-eye', this.frontDepth + 0.01);
    img.setPosition(x, y - r - 18).setScale(2.2, 2.2 * Math.max(0.1, open));
    for (let q = 0; q < 10; q++) {
      const a = (q / 10) * Math.PI * 2 + timeMs / 250 + id;
      const d = r + 6 + Math.sin(timeMs / 60 + q) * 3;
      this.front.dot(x + Math.cos(a) * d, y - 6 + Math.sin(a) * d * 0.6, 3, PSY[q % 3]!);
    }
  }

  /** はじけた念（紫の輪が広がる）と、かぜおこし が消えた所の小さな風（r が負） */
  private drawPops(timeMs: number): void {
    this.pops = this.pops.filter((p) => timeMs - p.at < POP_MS);
    for (const p of this.pops) {
      const t = (timeMs - p.at) / POP_MS;
      if (p.r < 0) {
        for (let q = 0; q < 4; q++) {
          const a = (q / 4) * Math.PI * 2 + p.seed;
          this.front.dot(p.x + Math.cos(a) * (3 + t * 12), p.y + Math.sin(a) * (3 + t * 12), Math.round(4 * (1 - t)) + 1, 0xe1f5fe);
        }
        continue;
      }
      const n = 16;
      for (let q = 0; q < n; q++) {
        const a = (q / n) * Math.PI * 2;
        const d = p.r * (0.4 + t * 1.2);
        this.front.dot(p.x + Math.cos(a) * d, p.y - 10 + Math.sin(a) * d * 0.7, Math.round(6 * (1 - t)) + 1, q % 2 ? 0xb388ff : 0xede7f6);
      }
    }
  }

  /** ハイドロポンプ の水流: 口もとから帯を並べて先まで。先でしぶきが散る */
  private drawBeam(x: number, y: number, dx: number, dy: number, len: number, r: number, life: number, timeMs: number): void {
    const f = Math.floor(timeMs / 70) % BEAM_FRAMES;
    const rot = Math.atan2(dy, dx);
    const start = 24;
    const seg = BEAM_W * 1.6;
    const fade = Math.min(1, life / 0.12);
    const n = Math.ceil((len - start) / seg);
    for (let k = 0; k < n; k++) {
      const d = start + k * seg;
      const w = Math.min(1, 0.7 + (k / Math.max(1, n - 1)) * 0.4) * fade;
      const img = this.front.image(`lu-beam-${(f + k) % BEAM_FRAMES}`, this.frontDepth - 0.02);
      img.setOrigin(0, 0.5).setPosition(x + dx * d, y + dy * d).setRotation(rot).setScale(Math.min(seg, len - d) / BEAM_W, ((r * 2) / BEAM_H) * w);
    }
    for (let q = 0; q < 12; q++) {
      const a = rot + (rnd(q, Math.floor(timeMs / 50)) - 0.5) * 1.6;
      const d = len * (0.9 + rnd(q + 5, Math.floor(timeMs / 50)) * 0.2);
      this.front.dot(x + Math.cos(a) * d, y + Math.sin(a) * d, q % 3 === 0 ? 6 : 4, q % 2 ? 0xe1f5fe : 0x81d4fa);
    }
  }

  /** 押している間（本人）: エアロブラスト は竜巻の出る所、ハイドロポンプ はなぎ払う扇の両端 */
  private drawAim(world: World, timeMs: number, localId: number, aimSlot: number | null): void {
    const me = world.players.find((p) => p.id === localId);
    const slot = aimSlot !== null ? me?.skills?.[aimSlot] : undefined;
    if (!me || !slot || me.down) return;
    const def = world.rules.activeSkills?.defs[slot.skill];
    const aim = moltresAim(world, me, slot.skill);
    if (!def || !aim || aim.x === undefined || aim.y === undefined || !aim.r) return;
    const col = slot.charges > 0 ? 0x81d4fa : 0x5a6b78;
    const step = 18;
    const off = (timeMs / 15) % step;
    if (def.hydroPump) {
      const [fx, fy] = aimOf(me);
      const a = Math.atan2(fy, fx);
      const half = (def.hydroPump.sweepDegrees * Math.PI) / 360;
      for (const s of [-1, 1]) for (let d = 30 + off; d < aim.r; d += step) this.front.dot(me.x + Math.cos(a + s * half) * d, me.y + Math.sin(a + s * half) * d, 4, col);
      for (let t = -half; t <= half; t += 0.08) this.front.dot(me.x + Math.cos(a + t) * aim.r, me.y + Math.sin(a + t) * aim.r, 4, col);
      return;
    }
    if (def.aeroblast) {
      const n = 28;
      for (let k = 0; k < n; k++) {
        const t = (k / n) * Math.PI * 2 + timeMs / 900;
        this.front.dot(aim.x + Math.cos(t) * aim.r, aim.y + Math.sin(t) * aim.r * 0.6, 4, col);
      }
    }
  }
}
