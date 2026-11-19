import Phaser from 'phaser';
import type { World } from '../../sim/world';
import { moltresAim } from '../../sim/activeSkills';
import { DotPool, c, makeTexture, on, rnd, shade } from './dotArt';

/**
 * 遊べるファイヤーの技の絵（07 の315章）:
 * - ゴッドバード: 体が白い光に包まれ（まわりから光が集まる）、炎の鳥の姿で向きへ突き抜ける。通った後ろに光の尾、通り道に燃える羽が落ちて少し燃える
 * - ねっぷう: 弧の熱波（赤橙の炎の舌が並んだ帯）が 3 回、少しずつ向きを変えて外へ広がる。後ろに陽炎のゆらぎ
 * - もえつきる: 体の炎が頭の上の大きな炎の玉に集まり、投げられて弧を描いて落ち、大きく爆発して焦げが残る。
 *   燃え尽きている間は体から灰色の煙が上り、動くと後ろに灰が舞う（炎が消えて軽くなった）
 * - ひのこ: 小さな火の粉
 * 炎・光・羽・煙はすべて 1 ドットずつ計算した不透明のドット絵（薄い塗りは使わない。画面全体は光らせない。画面は揺らさない）
 */

const BIRD_W = 64;
const BIRD_H = 40;
const BIRD_FRAMES = 3;
const FEATHER_W = 14;
const FEATHER_H = 20;
const FEATHER_FRAMES = 3;
const ORB = 48;
const ORB_FRAMES = 3;
const BLAST_W = 96;
const BLAST_H = 72;
const BLAST_FRAMES = 4;
const SCORCH = 64;
const EMBER = 12;
const LICK_W = 8;
const LICK_H = 14;
const LICK_FRAMES = 3;
const EMBER_FRAMES = 3;
const BLAST_MS = 640;
/** ファイヤーの絵の体の中心の高さ（足元からの上。飛んでいるので高い） */
const BODY_Y = 55;
const SPARK_MS = 200;

const FIRE = [0x6e1003, 0xb92207, 0xec4a0a, 0xff8412, 0xffbd3d, 0xfff0b8];
const LIGHT = [0xffbd3d, 0xffe08a, 0xfff3c4, 0xffffff];
const ASH = [0x8a827c, 0xb0a8a2, 0xd6d0cb];

type Dash = { sx: number; sy: number; dx: number; dy: number };
type Orb = { ox: number; oy: number; tx: number; ty: number; flight: number };

export class MoltresPlayer {
  private built = false;
  private readonly pool: DotPool;
  private readonly front: DotPool;
  private readonly floor: DotPool;
  private dashes = new Map<number, Dash>();
  private orbs = new Map<number, Orb>();
  private blasts: { x: number; y: number; r: number; at: number; seed: number }[] = [];
  private sparks: { x: number; y: number; at: number; seed: number }[] = [];
  private embers = new Map<number, { x: number; y: number }>();
  private outs = new Map<number, number>();
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
  }

  private build(): void {
    if (this.built) return;
    this.built = true;
    const s = this.scene;
    // 炎の鳥（右向き。後ろへ大きく広げた 2 枚の翼の後ろの縁が炎の舌になって揺れる。体と頭は白い光、尾は 3 本の炎）
    for (let f = 0; f < BIRD_FRAMES; f++) {
      makeTexture(s, `mo-bird-${f}`, BIRD_W, BIRD_H, (x, y) => {
        const u = x / (BIRD_W - 1);
        const v = (y - (BIRD_H - 1) / 2) / (BIRD_H / 2);
        const av = Math.abs(v);
        // 頭と体（右の先がとがる）
        const body = u > 0.4 && av < (u > 0.82 ? (1 - u) * 0.9 : 0.12 + (u - 0.4) * 0.12);
        if (body) return u > 0.78 ? c(0xffffff) : shade(LIGHT, 0.55 + u * 0.45, x, y);
        // 翼: 前の縁は体の真ん中から先の方へ斜めに、後ろの縁は炎の舌で揺れる
        const lead = 0.66 - av * 0.32;
        const trail = 0.36 - av * 0.3 + Math.sin(av * 9 + f * 2.1) * 0.05 + Math.sin(av * 23 - f) * 0.025;
        if (av > 0.1 && av < 0.98 && u < lead && u > trail) {
          const k = (lead - u) / Math.max(0.01, lead - trail);
          if (k > 0.8 && !on((1 - k) * 5, x + f, y)) return 0;
          return shade(FIRE, 1.05 - k * 0.75 - av * 0.15, x, y);
        }
        // 尾（左へ伸びる 3 本の炎）
        for (const [o, q] of [[-0.16, 0], [0, 1], [0.16, 2]] as const) {
          const cy = o + Math.sin(u * 12 + f * 2 + q) * 0.05;
          if (u < 0.45 && u > 0.03 + q * 0.03 && Math.abs(v - cy) < 0.03 + u * 0.14) return shade(FIRE, 0.35 + u * 1.3, x, y);
        }
        return 0;
      });
    }
    // 燃える羽（下に羽、上に炎が揺れる 3 コマ）
    for (let f = 0; f < FEATHER_FRAMES; f++) {
      makeTexture(s, `mo-feather-${f}`, FEATHER_W, FEATHER_H, (x, y) => {
        const cx = (FEATHER_W - 1) / 2;
        // 羽（下半分。斜めの軸に羽毛）
        if (y >= 11) {
          const t = (y - 11) / 8;
          const w = 4.5 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.1));
          if (Math.abs(x - cx - (t - 0.5) * 2) < 0.6) return c(0xfff0b8);
          if (Math.abs(x - cx) < w) return (x + y) % 3 === 0 ? c(0xb92207) : c(0xec4a0a);
          return 0;
        }
        // 炎（上へ揺れる舌）
        const t = (11 - y) / 11;
        const sway = Math.sin(t * 5 + f * 2.2) * 1.5 * t;
        const w = 4.2 * (1 - t) + 0.4;
        const d = Math.abs(x - cx - sway);
        if (d > w) return 0;
        return shade(FIRE, 1 - d / w * 0.5 - t * 0.55, x, y);
      });
    }
    // もえつきる の炎の玉（でこぼこの縁が揺れる 3 コマ。芯は白）
    for (let f = 0; f < ORB_FRAMES; f++) {
      makeTexture(s, `mo-orb-${f}`, ORB, ORB, (x, y) => {
        const nx = (x - (ORB - 1) / 2) / (ORB / 2);
        const ny = (y - (ORB - 1) / 2) / (ORB / 2);
        const a = Math.atan2(ny, nx);
        const d = Math.hypot(nx, ny);
        const R = 0.78 + 0.1 * Math.sin(a * 7 + f * 2) + 0.06 * Math.sin(a * 13 - f * 3) + (ny < 0 ? -ny * 0.12 : 0);
        if (d > R) return 0;
        const k = d / R;
        if (k > 0.86 && !on((1 - k) * 7, x + f, y)) return 0;
        return shade(FIRE, 1.05 - k * 0.95, x, y);
      });
    }
    // 大きな爆発（丸い火の玉が膨らみ、炎の舌が外へ伸び、最後のコマは芯から黒い煙に崩れる。4 コマ）
    for (let f = 0; f < BLAST_FRAMES; f++) {
      makeTexture(s, `mo-blast-${f}`, BLAST_W, BLAST_H, (x, y) => {
        const nx = (x - (BLAST_W - 1) / 2) / (BLAST_W / 2);
        const ny = (y - BLAST_H * 0.6) / (BLAST_H * 0.6);
        const a = Math.atan2(ny, nx);
        const d = Math.hypot(nx, ny * 1.05);
        const tongues = 0.13 * Math.max(0, Math.sin(a * 9 + f * 1.3)) + 0.07 * Math.sin(a * 17 - f * 2);
        const R = (0.45 + f * 0.17) * (1 + tongues);
        if (d > R) return 0;
        const k = d / R;
        if (f === BLAST_FRAMES - 1) {
          if (!on(1.1 - k * 0.6, x, y)) return 0;
          return k < 0.6 ? c(rnd(x, y) > 0.75 ? 0x6e1003 : 0x3a2a26) : shade(FIRE, 0.5 - (k - 0.6), x, y);
        }
        if (k > 0.9 && !on((1 - k) * 8, x, y)) return 0;
        return shade(FIRE, 1.08 - k * (0.65 + f * 0.12), x, y);
      });
    }
    // 焦げ（黒い跡と、残り火の点）
    makeTexture(s, 'mo-scorch', SCORCH, SCORCH / 2, (x, y) => {
      const nx = (x - (SCORCH - 1) / 2) / (SCORCH / 2);
      const ny = (y - (SCORCH / 2 - 1) / 2) / (SCORCH / 4);
      const r = Math.hypot(nx, ny) * (1 + Math.sin(Math.atan2(ny, nx) * 7) * 0.1);
      if (r > 1) return 0;
      if (r < 0.6 && rnd(x, y) > 0.9) return c(0xff8412);
      if (r > 0.8 && !on((1 - r) * 5, x, y)) return 0;
      return c(r < 0.5 ? 0x24100a : 0x45261a);
    });
    // ねっぷう の炎の舌（上向き。根元が赤く、先が黄色い。揺れる 3 コマ）
    for (let f = 0; f < LICK_FRAMES; f++) {
      makeTexture(s, `mo-lick-${f}`, LICK_W, LICK_H, (x, y) => {
        const t = 1 - y / (LICK_H - 1);
        const cx = (LICK_W - 1) / 2 + Math.sin(t * 4 + f * 2.1) * t * 1.6;
        const w = (LICK_W / 2) * (1 - t) * (0.8 + Math.sin(t * 3 + f) * 0.15) + 0.4;
        const d = Math.abs(x - cx);
        if (d > w) return 0;
        return shade(FIRE, 0.3 + t * 0.75 - (d / w) * 0.25, x, y);
      });
    }
    // ひのこ（上へ揺れる小さな炎 3 コマ）
    for (let f = 0; f < EMBER_FRAMES; f++) {
      makeTexture(s, `mo-ember-${f}`, EMBER, EMBER, (x, y) => {
        const cx = (EMBER - 1) / 2;
        const t = 1 - y / (EMBER - 1);
        const w = (t < 0.4 ? 3.6 : 3.6 * (1 - (t - 0.4) / 0.6)) + 0.3;
        const d = Math.abs(x - cx - Math.sin(t * 4 + f * 2) * t * 1.2);
        if (d > w) return 0;
        return shade(FIRE, 1 - d / w * 0.4 - t * 0.5, x, y);
      });
    }
  }

  update(world: World, timeMs: number, localId: number, aimSlot: number | null): void {
    const moves = world.rules.moves;
    const sa = moves.findIndex((m) => m.key === 'sky-attack-moltres');
    const hw = moves.findIndex((m) => m.key === 'heat-wave-moltres');
    const bu = moves.findIndex((m) => m.key === 'burn-up-moltres');
    const em = moves.findIndex((m) => m.key === 'ember-moltres');
    const pr = world.projectiles;
    this.pool.begin();
    this.front.begin();
    this.floor.begin();
    let any = this.blasts.length > 0 || this.sparks.length > 0 || this.embers.size > 0 || aimSlot !== null;
    for (const p of world.players) if (p.burnedOut) any = true;
    for (let i = 0; i < pr.count && !any; i++) {
      const m = pr.move[i];
      if (m === sa || m === hw || m === bu || m === em) any = true;
    }
    if (!any) {
      this.pool.end();
      this.front.end();
      this.floor.end();
      return;
    }
    this.build();
    const burnCfg = world.rules.activeSkills?.defs.find((d) => d.kind === 'burnUp')?.burnUp;
    const chargeSa = world.rules.activeSkills?.defs.find((d) => d.kind === 'skyAttack')?.skyAttack?.chargeSeconds ?? 0.6;
    const liveDash = new Set<number>();
    const liveOrb = new Set<number>();
    const liveEmber = new Set<number>();
    for (let i = 0; i < pr.count; i++) {
      const m = pr.move[i];
      const id = pr.serial[i]!;
      const x = pr.x[i]!;
      const y = pr.y[i]!;
      const r = pr.radius[i]!;
      const owner = m === sa || m === bu || m === hw ? world.players.find((q) => q.id === pr.owner[i]) : undefined;
      if (m === sa) {
        // 羽（線の上に落ちて燃える。stage 1）と、体の当たり（自分に付いて動く。stage 3 の間はため）
        if (pr.motion[i] !== 1) {
          if (pr.stage[i] === 1) this.drawFeather(x, y, pr.life[i]!, timeMs, id);
          continue;
        }
        if (pr.stage[i] === 3) {
          this.drawCharge(owner?.x ?? x, owner?.y ?? y, 1 - pr.life[i]! / chargeSa, timeMs);
          continue;
        }
        liveDash.add(id);
        let d = this.dashes.get(id);
        if (!d) {
          d = { sx: owner?.x ?? x, sy: owner?.y ?? y, dx: pr.dirX[i]!, dy: pr.dirY[i]! };
          this.dashes.set(id, d);
        }
        this.drawDash(d, owner?.x ?? x, owner?.y ?? y, r, timeMs);
      } else if (m === hw) {
        if (pr.stage[i] === 0) this.drawHeatWave(owner?.x ?? x, owner?.y ?? y, pr.dirX[i]!, pr.dirY[i]!, r, pr.band[i]!, pr.length[i]!, pr.life[i]!, timeMs, id);
      } else if (m === bu) {
        if (pr.stage[i] === 3) {
          liveOrb.add(id);
          const flight = burnCfg?.flightSeconds ?? 0.5;
          if (pr.life[i]! > flight) {
            // ため: 体の炎が頭の上の玉に集まる
            const total = (burnCfg?.chargeSeconds ?? 0.4) || 0.01;
            this.drawGather(owner?.x ?? x, owner?.y ?? y, 1 - (pr.life[i]! - flight) / total, r, timeMs);
            continue;
          }
          let o = this.orbs.get(id);
          if (!o) {
            o = { ox: owner?.x ?? x, oy: (owner?.y ?? y) - BODY_Y - 64, tx: x, ty: y, flight };
            this.orbs.set(id, o);
          }
          this.drawOrb(o, pr.life[i]!, r, timeMs, id);
        } else if (!this.seen.has(id)) {
          this.seen.add(id);
          this.blasts.push({ x, y, r, at: timeMs, seed: id });
        }
      } else if (m === em && pr.stage[i] === 0) {
        liveEmber.add(id);
        this.embers.set(id, { x, y });
        const img = this.front.image(`mo-ember-${Math.floor(timeMs / 80 + id) % EMBER_FRAMES}`, this.frontDepth - 0.01);
        img.setPosition(x, y).setScale((r * 2.4) / EMBER);
      }
    }
    for (const id of this.dashes.keys()) if (!liveDash.has(id)) this.dashes.delete(id);
    for (const id of this.orbs.keys()) if (!liveOrb.has(id)) this.orbs.delete(id);
    for (const [id, s] of this.embers) {
      if (liveEmber.has(id)) continue;
      this.embers.delete(id);
      this.sparks.push({ x: s.x, y: s.y, at: timeMs, seed: id });
    }
    if (this.seen.size > 400) this.seen.clear();
    this.drawBlasts(timeMs);
    this.drawSparks(timeMs);
    this.drawBurnout(world, timeMs);
    this.drawAim(world, timeMs, localId, aimSlot);
    this.pool.end();
    this.front.end();
    this.floor.end();
  }

  /** ゴッドバード のため: まわりから光の筋が集まり、体が白い光に包まれる（ためるほど厚く明るい） */
  private drawCharge(x: number, y: number, t: number, timeMs: number): void {
    const cy = y - BODY_Y;
    const k = Math.max(0, Math.min(1, t));
    // 集まる光の筋（8 方向から内へ）
    for (let q = 0; q < 8; q++) {
      const a = (q / 8) * Math.PI * 2 + 0.3;
      const far = 110 * (1 - k) + 34;
      for (let d = far; d > far - 30; d -= 6) this.front.dot(x + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, d === far ? 6 : 4, d === far ? 0xffffff : 0xfff3c4);
    }
    // 体を包む光
    const n = Math.round(18 + k * 40);
    const seed = Math.floor(timeMs / 45);
    for (let q = 0; q < n; q++) {
      const a = rnd(q, seed) * Math.PI * 2;
      const d = 10 + rnd(q + 3, seed) * (14 + k * 14);
      this.front.dot(x + Math.cos(a) * d, cy + Math.sin(a) * d * 0.85, q % 4 === 0 ? 7 : 5, q % 3 === 0 ? 0xffe08a : 0xffffff);
    }
  }

  /** ゴッドバード の突き抜け: 炎の鳥の姿と、通った後ろの光の尾 */
  private drawDash(d: Dash, x: number, y: number, r: number, timeMs: number): void {
    const rot = Math.atan2(d.dy, d.dx);
    const len = Math.hypot(x - d.sx, y - d.sy);
    // 光の尾（後ろほど細く、黄色く）
    for (let t = 0; t < len; t += 7) {
      const k = t / Math.max(1, len);
      const w = Math.round(4 + k * 12);
      const jx = (rnd(t, Math.floor(timeMs / 40)) - 0.5) * 6;
      this.pool.dot(d.sx + d.dx * t - d.dy * jx, d.sy - BODY_Y + d.dy * t + d.dx * jx, w, k > 0.7 ? 0xffffff : k > 0.35 ? 0xfff3c4 : 0xffbd3d);
    }
    const img = this.front.image(`mo-bird-${Math.floor(timeMs / 60) % BIRD_FRAMES}`, this.frontDepth + 0.02);
    img.setPosition(x, y - BODY_Y).setRotation(rot).setScale((r * 3.2) / BIRD_W);
  }

  /** 燃える羽: 落ちたところで炎が揺れ、消える前は小さくなる */
  private drawFeather(x: number, y: number, life: number, timeMs: number, id: number): void {
    const k = Math.min(1, life / 0.35);
    if (k <= 0.05) return;
    const img = this.pool.image(`mo-feather-${Math.floor(timeMs / 90 + id) % FEATHER_FRAMES}`, this.frontDepth - 0.05);
    img.setOrigin(0.5, 1).setPosition(x + (rnd(id, 1) - 0.5) * 16, y + 8).setScale(2.2 * k).setFlipX(id % 2 === 0);
  }

  /** ねっぷう: 弧に並んだ炎の舌（外向きに揺れる）と、その内側の赤い熱の帯・陽炎のゆらぎ。消える前は舌が小さい */
  private drawHeatWave(x: number, y: number, dx: number, dy: number, r: number, band: number, half: number, life: number, timeMs: number, seed: number): void {
    const base = Math.atan2(dy, dx);
    const k = Math.min(1, life / 0.15);
    const cy = y - 10;
    const step = 13 / Math.max(30, r);
    const f = Math.floor(timeMs / 70);
    for (let a = -half; a <= half + 1e-6; a += step) {
      const ang = base + a;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const edge = 1 - Math.abs(a) / Math.max(0.01, half);
      const q = Math.round(a * 100);
      const wob = Math.sin(a * 18 + timeMs / 60) * 3;
      const rr = r + wob;
      // 炎の舌（外向き。真ん中ほど大きい）
      const lick = this.pool.image(`mo-lick-${(f + q) % LICK_FRAMES}`, this.frontDepth - 0.04);
      lick.setOrigin(0.5, 1).setPosition(x + ca * (rr - 4), cy + sa * (rr - 4) * 0.9).setRotation(ang + Math.PI / 2).setScale(k * (1.6 + edge * 1.4 + rnd(q, seed) * 0.6));
      // 内側の熱の帯（赤 → 暗い赤。まばら）
      for (let t = 6; t < band * 0.9; t += 8) {
        if (rnd(q + t, seed + f) > 0.75 - t / band * 0.4) continue;
        const d = rr - t;
        this.pool.dot(x + ca * d + Math.sin(timeMs / 50 + a * 9 + t) * 2, cy + sa * d * 0.9, t < band * 0.4 ? 5 : 4, t < band * 0.4 ? 0xec4a0a : 0xb92207);
      }
    }
  }

  /** もえつきる のため: 体のまわりの炎が頭の上へ集まり、炎の玉が大きくなる */
  private drawGather(x: number, y: number, t: number, r: number, timeMs: number): void {
    const k = Math.max(0, Math.min(1, t));
    const oy = y - BODY_Y - 64;
    for (let q = 0; q < 12; q++) {
      const a = (q / 12) * Math.PI * 2 + timeMs / 300;
      const d = 40 * (1 - k) + 8;
      this.front.dot(x + Math.cos(a) * d, oy + 30 * (1 - k) + Math.sin(a) * d * 0.6, 5, q % 2 ? 0xff8412 : 0xffbd3d);
    }
    const img = this.front.image(`mo-orb-${Math.floor(timeMs / 70) % ORB_FRAMES}`, this.frontDepth + 0.015);
    img.setPosition(x, oy).setScale(((10 + k * r * 0.35) * 2) / ORB);
  }

  /** もえつきる の炎の玉: 弧を描いて飛び、落ちる所の影が濃くなる */
  private drawOrb(o: Orb, life: number, r: number, timeMs: number, id: number): void {
    const t = Math.max(0, Math.min(1, 1 - life / o.flight));
    const dist = Math.hypot(o.tx - o.ox, o.ty - o.oy);
    const h = (120 + dist * 0.3) * Math.sin(Math.PI * t);
    const x = o.ox + (o.tx - o.ox) * t;
    const y = o.oy + (o.ty - o.oy) * t - h;
    // 影（だんだん大きく。中は埋めて、縁だけ点を抜く）
    const sr = r * (0.15 + t * 0.6);
    for (let yy = -sr * 0.45; yy <= sr * 0.45; yy += 4) {
      for (let xx = -sr; xx <= sr; xx += 4) {
        const e = (xx / sr) ** 2 + (yy / (sr * 0.45)) ** 2;
        if (e > 1 || (e > 0.7 && !on((1 - e) * 3, Math.round(xx / 4) + 64, Math.round(yy / 4) + 64))) continue;
        this.floor.dot(o.tx + xx, o.ty + yy, 4, 0x2e3a1c);
      }
    }
    const img = this.front.image(`mo-orb-${Math.floor(timeMs / 70 + id) % ORB_FRAMES}`, this.frontDepth + 0.015);
    img.setPosition(x, y).setScale(((10 + r * 0.35) * 2) / ORB);
    // 後ろの火の粉
    for (let q = 1; q <= 4; q++) {
      const tt = Math.max(0, t - q * 0.04);
      this.front.dot(o.ox + (o.tx - o.ox) * tt + (rnd(q, id) - 0.5) * 12, o.oy + (o.ty - o.oy) * tt - (120 + dist * 0.3) * Math.sin(Math.PI * tt), 7 - q, q < 2 ? 0xffbd3d : 0xec4a0a);
    }
  }

  /** もえつきる の爆発: 焦げ・大きな火の玉（4 コマ）・外へ飛ぶ炎のかけら */
  private drawBlasts(timeMs: number): void {
    this.blasts = this.blasts.filter((b) => timeMs - b.at < BLAST_MS);
    for (const b of this.blasts) {
      const t = (timeMs - b.at) / BLAST_MS;
      const sc = this.floor.image('mo-scorch', this.floorDepth + 0.1);
      sc.setPosition(b.x, b.y).setScale((b.r * 2) / SCORCH, (b.r * 1.0) / (SCORCH / 2));
      const f = Math.min(BLAST_FRAMES - 1, Math.floor(t * BLAST_FRAMES));
      const img = this.front.image(`mo-blast-${f}`, this.frontDepth - 0.01);
      img.setOrigin(0.5, 0.62).setPosition(b.x, b.y).setScale((b.r * 2.1) / BLAST_W);
      const tt = t * 0.64;
      for (let q = 0; q < 14; q++) {
        const a = (q / 14) * Math.PI * 2 + rnd(q, b.seed);
        const sp = b.r * (1.1 + rnd(q, b.seed + 1));
        const hh = (260 + rnd(q, b.seed + 2) * 200) * tt - 900 * tt * tt;
        if (hh < 0 && tt > 0.1) continue;
        this.front.dot(b.x + Math.cos(a) * sp * tt * 2, b.y + Math.sin(a) * sp * tt - Math.max(0, hh), q % 3 === 0 ? 7 : 5, q % 3 === 0 ? 0xfff0b8 : q % 3 === 1 ? 0xff8412 : 0xec4a0a);
      }
    }
  }

  /** ひのこ が消えた所の小さな火花 */
  private drawSparks(timeMs: number): void {
    this.sparks = this.sparks.filter((s) => timeMs - s.at < SPARK_MS);
    for (const s of this.sparks) {
      const t = (timeMs - s.at) / SPARK_MS;
      for (let q = 0; q < 5; q++) {
        const a = (q / 5) * Math.PI * 2 + s.seed;
        this.front.dot(s.x + Math.cos(a) * (4 + t * 16), s.y + Math.sin(a) * (4 + t * 16) - t * 8, Math.round(4 * (1 - t)) + 1, q % 2 ? 0xffbd3d : 0xec4a0a);
      }
    }
  }

  /** 燃え尽きている間: 体から灰色の煙が上り、動くと後ろに灰が舞う。燃え尽きた瞬間は煙がふくらむ */
  private drawBurnout(world: World, timeMs: number): void {
    for (const p of world.players) {
      const b = p.burnedOut;
      if (!b || world.tick >= b.untilTick) {
        this.outs.delete(p.id);
        continue;
      }
      if (world.tick < b.offTick) continue;
      if (!this.outs.has(p.id)) this.outs.set(p.id, timeMs);
      const since = timeMs - this.outs.get(p.id)!;
      if (since < 400) {
        const t = since / 400;
        for (let q = 0; q < 12; q++) {
          const a = (q / 12) * Math.PI * 2;
          const d = 14 + t * 40;
          this.front.dot(p.x + Math.cos(a) * d, p.y - BODY_Y + Math.sin(a) * d * 0.7 - t * 20, Math.round(10 * (1 - t)) + 3, q % 2 ? ASH[1]! : ASH[2]!);
        }
      }
      for (let q = 0; q < 10; q++) {
        const ph = (timeMs / 900 + rnd(q, p.id)) % 1;
        this.front.dot(p.x + (rnd(q, 7) - 0.5) * 44 + Math.sin(ph * 6 + q) * 5, p.y - BODY_Y - 24 - ph * 60, Math.round(10 - ph * 5), ASH[Math.min(2, Math.floor(ph * 3))]!);
      }
      const mv = Math.hypot(p.x - p.prevX, p.y - p.prevY);
      if (mv > 0.5) {
        const bx = (p.prevX - p.x) / mv;
        const by = (p.prevY - p.y) / mv;
        for (let q = 0; q < 5; q++) {
          const d = 16 + q * 9 + (timeMs / 20) % 9;
          this.pool.dot(p.x + bx * d + (rnd(q, Math.floor(timeMs / 90)) - 0.5) * 14, p.y - BODY_Y * 0.6 + by * d, 5, ASH[q % 3]!);
        }
      }
    }
  }

  /** 押している間（本人）: ゴッドバード は突き抜ける道の幅、もえつきる は炎の玉が落ちる所 */
  private drawAim(world: World, timeMs: number, localId: number, aimSlot: number | null): void {
    const me = world.players.find((p) => p.id === localId);
    const slot = aimSlot !== null ? me?.skills?.[aimSlot] : undefined;
    if (!me || !slot || me.down) return;
    const aim = moltresAim(world, me, slot.skill);
    if (!aim) return;
    const col = slot.charges > 0 ? 0xffbd3d : 0x6d5a4a;
    const step = 18;
    const off = (timeMs / 15) % step;
    if (aim.path && aim.path.length > 1) {
      const [a, b] = [aim.path[0]!, aim.path[1]!];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const dx = (b.x - a.x) / len;
      const dy = (b.y - a.y) / len;
      const w = aim.width ?? 30;
      for (const side of [-1, 1]) for (let d = off; d < len; d += step) this.front.dot(a.x + dx * d - dy * w * side, a.y + dy * d + dx * w * side, 4, col);
      for (let s = -w; s <= w; s += 10) this.front.dot(b.x - dy * s, b.y + dx * s, 4, col);
      return;
    }
    if (aim.x !== undefined && aim.y !== undefined && aim.r) {
      const n = 32;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + timeMs / 900;
        this.front.dot(aim.x + Math.cos(a) * aim.r, aim.y + Math.sin(a) * aim.r * 0.6, 4, col);
      }
    }
  }
}
