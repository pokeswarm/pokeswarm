import Phaser from 'phaser';
import type { World } from '../../sim/world';
import { DotPool, c, makeTexture, on, rnd, shade } from './dotArt';

/**
 * 遊べるジラーチの技の絵（07 の321章。ミュウツーの サイコブレイク・ルギアの水準で、1 ドットずつ計算した不透明のドット絵）:
 * - コメットパンチ（ジラーチの版）: 金色の星の拳（5 本のとがりの星に、白い芯と青い光の縁）が流れ星の尾を引いて飛び、当たると星のかけらが弾ける
 * - はめつのねがい: 狙われた敵の頭の上に、回る星の印（金の星と、時を刻む輪）が浮かぶ → 2 秒後に空から光の柱が立ち、
 *   大きな星が落ちて弾ける（白い閃光・金の輪・飛び散る星のかけら）。地面に星の模様が少し残る
 * 薄さ・消え際はディザ（半透明の塗りは使わない）。画面全体は光らせない。画面は揺らさない
 */

const FIST = 32;
const FIST_FRAMES = 4;
const MARK = 40;
const MARK_FRAMES = 6;
const PILLAR_W = 40;
const PILLAR_H = 160;
const STAR = 64;
const BLAST = 128;
const BLAST_FRAMES = 8;
const SHARD = 10;
const SCAR = 64;
const POP_MS = 360;
const BLAST_MS = 900;
const SCAR_MS = 1400;
/** 大きな星が空から落ちてくる時間（はめつのねがい の最後のこの秒数） */
const DROP = 0.35;

const GOLD = [0x8a5a10, 0xc9861b, 0xf2b630, 0xffd95e, 0xfff3b0, 0xffffff];
const SKY = [0x1f3a8a, 0x3557c9, 0x6a8ff0, 0xb7c8ff, 0xffffff];

/** 星の形（中心 0,0 から半径 1 の 5 本のとがり）の中か。k は 0（中心）〜1（縁）に近い値 */
function starK(nx: number, ny: number, rot = -Math.PI / 2): number {
  const a = Math.atan2(ny, nx) - rot;
  const r = Math.hypot(nx, ny);
  // 5 本のとがり: 角度で半径を変える（とがり 1・へこみ 0.45）
  const seg = ((a / (Math.PI * 2)) * 5 + 50) % 1;
  const edge = 0.45 + 0.55 * Math.abs(1 - seg * 2) ** 1.6;
  return r / edge;
}

export class JirachiPlayer {
  private built = false;
  private readonly pool: DotPool;
  private readonly front: DotPool;
  private readonly floor: DotPool;
  private fists = new Map<number, { x: number; y: number }>();
  private pops: { x: number; y: number; at: number; seed: number }[] = [];
  private blasts: { x: number; y: number; r: number; at: number; seed: number }[] = [];
  private scars: { x: number; y: number; r: number; at: number }[] = [];
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
    // 星の拳: 金の星（白い芯）に、前の縁が青く光る（4 コマで回る）
    for (let f = 0; f < FIST_FRAMES; f++) {
      const rot = -Math.PI / 2 + (f / FIST_FRAMES) * ((Math.PI * 2) / 5);
      makeTexture(s, `ji-fist-${f}`, FIST, FIST, (x, y) => {
        const nx = (x - (FIST - 1) / 2) / (FIST / 2);
        const ny = (y - (FIST - 1) / 2) / (FIST / 2);
        const k = starK(nx, ny, rot);
        if (k > 1) {
          // まわりの青い光（星のすき間から）
          if (k < 1.25 && Math.hypot(nx, ny) < 0.95 && on((1.25 - k) * 3, x + f, y)) return c(0x6a8ff0);
          return 0;
        }
        if (k > 0.85) return c(0xc9861b);
        return shade(GOLD, 1.02 - k * 0.6 + (nx + ny < 0 ? 0.1 : -0.05), x, y);
      });
    }
    // 星の印: 金の星（ゆっくり回る）と、時を刻む青い輪（12 の目盛り。進んだ分だけ明るい）6 コマ
    for (let f = 0; f < MARK_FRAMES; f++) {
      makeTexture(s, `ji-mark-${f}`, MARK, MARK, (x, y) => {
        const nx = (x - (MARK - 1) / 2) / (MARK / 2);
        const ny = (y - (MARK - 1) / 2) / (MARK / 2);
        const r = Math.hypot(nx, ny);
        const a = Math.atan2(ny, nx);
        // 輪と目盛り
        if (Math.abs(r - 0.9) < 0.06) return c(0x6a8ff0);
        const tick = Math.abs(Math.sin(a * 6)) > 0.96 && r > 0.72 && r < 0.86;
        if (tick) return c(0xb7c8ff);
        const k = starK(nx / 0.62, ny / 0.62, -Math.PI / 2 + (f / MARK_FRAMES) * ((Math.PI * 2) / 5));
        if (k <= 1) return k > 0.82 ? c(0xc9861b) : shade(GOLD, 1 - k * 0.5, x, y);
        return 0;
      });
    }
    // 光の柱（空から。上ほど細く、芯は白、外は金と青）
    makeTexture(s, 'ji-pillar', PILLAR_W, PILLAR_H, (x, y) => {
      const t = y / PILLAR_H;
      const k = Math.abs(x - (PILLAR_W - 1) / 2) / (PILLAR_W / 2);
      const w = 0.35 + t * 0.65;
      if (k > w) return 0;
      if (!on(0.5 + t * 0.6, x, y) && k > w * 0.5) return 0;
      return k < w * 0.3 ? c(0xffffff) : k < w * 0.65 ? c(0xfff3b0) : c(0x6a8ff0);
    });
    // 大きな星（落ちてくる。白い芯・金・縁は濃い金・青い光のふち）
    makeTexture(s, 'ji-star', STAR, STAR, (x, y) => {
      const nx = (x - (STAR - 1) / 2) / (STAR / 2);
      const ny = (y - (STAR - 1) / 2) / (STAR / 2);
      const k = starK(nx / 0.9, ny / 0.9);
      if (k > 1) return k < 1.12 && on(0.7, x, y) ? c(0xb7c8ff) : 0;
      if (k > 0.88) return c(0xc9861b);
      // 面: 左上が明るい（光の筋）
      const facet = Math.sin(Math.atan2(ny, nx) * 5 + Math.PI / 2) > 0 ? 0.08 : -0.06;
      return shade(GOLD, 1.02 - k * 0.55 + facet + (nx + ny < 0 ? 0.08 : 0), x, y);
    });
    // 星の爆発: 白い閃光 → 金の輪と放射の光の筋（星形に 5 本と、細い 5 本）→ 星のかけらが散って消える（8 コマ）
    for (let f = 0; f < BLAST_FRAMES; f++) {
      const t = f / (BLAST_FRAMES - 1);
      makeTexture(s, `ji-blast-${f}`, BLAST, BLAST, (x, y) => {
        const cx = (BLAST - 1) / 2;
        const dx = x - cx;
        const dy = y - cx;
        const r = Math.hypot(dx, dy) / (BLAST / 2);
        if (r > 1) return 0;
        const a = Math.atan2(dy, dx) + Math.PI / 2;
        const fade = 1 - Math.max(0, t - 0.4) / 0.6;
        if (t < 0.3 && r < 0.28 * (1 - t * 2.5)) return c(0xffffff);
        // 放射の光の筋（5 本は長く、間の 5 本は短い）
        const seg = ((a / (Math.PI * 2)) * 10 + 100) % 1;
        const main = Math.floor(((a / (Math.PI * 2)) * 10 + 100) % 2) === 0;
        const reach = (main ? 0.95 : 0.6) * (0.4 + 0.6 * Math.sqrt(t));
        const w = (main ? 0.12 : 0.07) * (1 - r / Math.max(0.01, reach));
        if (Math.abs(seg - 0.5) < w && r < reach && on(fade * 1.2, x, y)) return c(r < reach * 0.5 ? 0xffffff : 0xffd95e);
        // 細い光の輪（はじめだけ。後半は切れ切れに）
        const R = 0.25 + 0.6 * Math.sqrt(t);
        const broken = t > 0.4 && rnd(Math.floor(a * 12), f) < (t - 0.4) * 1.6;
        if (Math.abs(r - R) < 0.022 && !broken && t < 0.8) return c(0xfff3b0);
        // 芯のまわりの小さな星の形（はじめ）
        if (t < 0.45 && starK(dx / (BLAST * 0.18), dy / (BLAST * 0.18)) < 1) return c(t < 0.2 ? 0xffffff : 0xffd95e);
        return 0;
      });
    }
    // 星のかけら（小さな 4 本とがり）
    makeTexture(s, 'ji-shard', SHARD, SHARD, (x, y) => {
      const dx = Math.abs(x - 4.5);
      const dy = Math.abs(y - 4.5);
      if (dx + dy * 3 < 4.5 || dy + dx * 3 < 4.5) return dx + dy < 1.6 ? c(0xffffff) : c(0xffd95e);
      return 0;
    });
    // 地面に残る星の模様（細い線の星）
    makeTexture(s, 'ji-scar', SCAR, SCAR / 2, (x, y) => {
      const nx = (x - (SCAR - 1) / 2) / (SCAR / 2);
      const ny = (y - (SCAR / 2 - 1) / 2) / (SCAR / 4);
      const k = starK(nx / 0.8, ny / 0.8);
      if (Math.abs(k - 1) < 0.07 && on(0.8, x, y)) return c(0xc9861b);
      if (k < 0.3 && on(0.4, x, y)) return c(0x8a5a10);
      return 0;
    });
  }

  update(world: World, timeMs: number): void {
    const moves = world.rules.moves;
    const mm = moves.findIndex((m) => m.key === 'meteor-mash-jirachi');
    const dd = moves.findIndex((m) => m.key === 'doom-desire');
    const pr = world.projectiles;
    const e = world.enemies;
    this.pool.begin();
    this.front.begin();
    this.floor.begin();
    let any = this.pops.length > 0 || this.blasts.length > 0 || this.scars.length > 0 || this.fists.size > 0;
    for (let i = 0; i < pr.count && !any; i++) if (pr.move[i] === mm || pr.move[i] === dd) any = true;
    for (let i = 0; i < e.count && !any; i++) if (e.markTicks[i]! > 0 && e.markMove[i] === dd) any = true;
    if (!any || (mm < 0 && dd < 0)) {
      this.pool.end();
      this.front.end();
      this.floor.end();
      return;
    }
    this.build();
    const liveFist = new Set<number>();
    for (let i = 0; i < pr.count; i++) {
      const m = pr.move[i];
      const id = pr.serial[i]!;
      const x = pr.x[i]!;
      const y = pr.y[i]!;
      const r = pr.radius[i]!;
      if (m === mm) {
        if (pr.stage[i] === 0) {
          liveFist.add(id);
          this.fists.set(id, { x, y });
          this.drawFist(x, y, r, pr.vx[i]!, pr.vy[i]!, timeMs, id);
        } else if (!this.seen.has(id)) {
          // 当たった所の爆発（効き方の explode）
          this.seen.add(id);
          this.pops.push({ x, y, at: timeMs, seed: id });
        }
      } else if (m === dd) {
        if (this.seen.has(id)) continue;
        this.seen.add(id);
        if (pr.stage[i] === 1) {
          // 2 秒後の大きな星（tickMarks の爆発）
          this.blasts.push({ x, y, r, at: timeMs, seed: id });
          this.scars.push({ x, y, r, at: timeMs });
        } else {
          // 印を付けた瞬間の小さな星のきらめき
          this.pops.push({ x, y: y - 20, at: timeMs, seed: id });
        }
      }
    }
    for (const [id, f] of this.fists) {
      if (liveFist.has(id)) continue;
      this.fists.delete(id);
      this.pops.push({ x: f.x, y: f.y, at: timeMs, seed: id });
    }
    if (this.seen.size > 600) this.seen.clear();
    this.drawMarks(world, dd, timeMs);
    this.drawScars(timeMs);
    this.drawBlasts(timeMs);
    this.drawPops(timeMs);
    this.pool.end();
    this.front.end();
    this.floor.end();
  }

  /** 星の拳: 回る金の星と、後ろへ流れる青と金の流れ星の尾 */
  private drawFist(x: number, y: number, r: number, vx: number, vy: number, timeMs: number, id: number): void {
    const v = Math.hypot(vx, vy) || 1;
    const dx = vx / v;
    const dy = vy / v;
    for (let s = 6; s < 90; s += 5) {
      const fall = s / 90;
      if (rnd(Math.floor(s), id + Math.floor(timeMs / 60)) < fall * 0.5) continue;
      const w = Math.sin(s * 0.15 - timeMs / 60) * 5 * fall;
      this.pool.dot(x - dx * s - dy * w, y - dy * s + dx * w, Math.max(2, Math.round(r * 0.9 * (1 - fall))), fall < 0.3 ? 0xfff3b0 : fall < 0.6 ? 0xb7c8ff : 0x3557c9);
    }
    this.front.image(`ji-fist-${Math.floor(timeMs / 50 + id) % FIST_FRAMES}`, this.frontDepth - 0.01).setPosition(x, y).setScale((r * 2.6) / FIST);
  }

  /** はめつのねがい の印: 敵の頭の上で星が回り、輪の目盛りが残りの時間を刻む。落ちる直前は空から光の柱と大きな星 */
  private drawMarks(world: World, dd: number, timeMs: number): void {
    const e = world.enemies;
    const blast = world.rules.moves[dd]?.delayedBlast;
    if (!blast) return;
    const total = Math.max(1, Math.round(blast.seconds / world.dt));
    for (let i = 0; i < e.count; i++) {
      if (e.markTicks[i]! <= 0 || e.markMove[i] !== dd || e.hp[i]! <= 0) continue;
      const x = e.x[i]!;
      const y = e.y[i]!;
      const r = e.radius[i]!;
      const left = (e.markTicks[i]! * world.dt);
      const t = 1 - e.markTicks[i]! / total;
      const hy = y - r - 26 + Math.sin(timeMs / 200 + e.id[i]!) * 3;
      this.front.image(`ji-mark-${Math.floor(timeMs / 90) % MARK_FRAMES}`, this.frontDepth + 0.01).setPosition(x, hy).setScale(1.05 + t * 0.25);
      // 残りの時間（輪の上を明るい点が回って減る）
      const n = Math.max(1, Math.round((1 - t) * 12));
      for (let q = 0; q < n; q++) {
        const a = -Math.PI / 2 + (q / 12) * Math.PI * 2;
        this.front.dot(x + Math.cos(a) * 23, hy + Math.sin(a) * 23, 3, 0xfff3b0);
      }
      if (left > DROP) continue;
      // 落ちる直前: 空からの光の柱が細く立ち、大きな星が落ちてくる
      const k = 1 - left / DROP;
      const sr = e.markSize[i]! || r * 2;
      this.pool.image('ji-pillar', this.frontDepth - 0.02).setOrigin(0.5, 1).setPosition(x, y + 6).setScale(((sr * 0.55) / PILLAR_W) * (0.4 + k * 0.6), (520 * (0.5 + k * 0.5)) / PILLAR_H);
      this.front.image('ji-star', this.frontDepth + 0.02).setPosition(x, y - 20 - (1 - k) * 420).setScale((sr * 1.1) / STAR).setRotation(timeMs / 180);
    }
  }

  /** 大きな星が弾ける（8 コマ）と、飛び散る星のかけら */
  private drawBlasts(timeMs: number): void {
    this.blasts = this.blasts.filter((b) => timeMs - b.at < BLAST_MS);
    for (const b of this.blasts) {
      const t = (timeMs - b.at) / BLAST_MS;
      const f = Math.min(BLAST_FRAMES - 1, Math.floor(t * BLAST_FRAMES));
      this.front.image(`ji-blast-${f}`, this.frontDepth - 0.005).setPosition(b.x, b.y - 20).setScale((b.r * 2.4) / BLAST);
      const tt = t * 0.9;
      for (let q = 0; q < 14; q++) {
        const a = (q / 14) * Math.PI * 2 + rnd(q, b.seed);
        const sp = b.r * (0.9 + rnd(q, b.seed + 1) * 0.8);
        const hh = (360 + rnd(q, b.seed + 2) * 220) * tt - 1000 * tt * tt;
        if (hh < 0 && tt > 0.15) continue;
        this.front.image('ji-shard', this.frontDepth + 0.005).setPosition(b.x + Math.cos(a) * sp * tt * 1.6, b.y - 20 + Math.sin(a) * sp * tt * 0.8 - Math.max(0, hh)).setScale(2 * (1 - t * 0.5)).setRotation(tt * 8 + q);
      }
    }
  }

  /** 地面に残る星の模様（しばらく残る） */
  private drawScars(timeMs: number): void {
    this.scars = this.scars.filter((s) => timeMs - s.at < SCAR_MS);
    for (const s of this.scars) {
      const k = Math.min(1, (SCAR_MS - (timeMs - s.at)) / 500);
      if (!on(k, Math.floor(timeMs / 60), 1) && k < 0.6) continue;
      this.floor.image('ji-scar', this.floorDepth + 0.1).setPosition(s.x, s.y).setScale((s.r * 1.8) / SCAR, (s.r * 0.9) / (SCAR / 2));
    }
  }

  /** 小さな星のきらめき（拳が当たった・印を付けた） */
  private drawPops(timeMs: number): void {
    this.pops = this.pops.filter((p) => timeMs - p.at < POP_MS);
    for (const p of this.pops) {
      const t = (timeMs - p.at) / POP_MS;
      for (let q = 0; q < 6; q++) {
        const a = (q / 6) * Math.PI * 2 + p.seed;
        const d = 6 + t * 34;
        this.front.image('ji-shard', this.frontDepth + 0.005).setPosition(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * 0.8).setScale(2 * (1 - t)).setRotation(t * 6);
      }
      if (t < 0.3) this.front.dot(p.x, p.y, Math.round(14 * (1 - t / 0.3)) + 2, 0xffffff);
    }
  }
}

void SKY;
