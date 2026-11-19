import Phaser from 'phaser';
import type { World } from '../../sim/world';
import type { SkillUsedEvent } from '../../sim/events';
import { aimOf, moltresAim } from '../../sim/activeSkills';
import { DotPool, c, makeTexture, on, rnd, shade } from './dotArt';

/**
 * 遊べるラティオスの技の絵（07 の320章。ミュウツーの サイコブレイク・ルギアの水準で、1 ドットずつ計算した不透明のドット絵）:
 * - ラスターパージ: 胸の前から白い光の玉（青い光の筋が回る）が飛び、着いた所から前へ、光の爆発（白い十字の閃光 → 青い光の輪 → 光の粒）が順に走る。爆発ごとに細い光の柱が立つ
 * - りゅうのまい: 青い竜の気が螺旋の炎になって体のまわりを昇る。重ねている間は、重ねた数だけ青い炎の舌が体のまわりを回る
 * - りゅうせいぐん: 体から橙の光の玉が空へ打ち上がり、少しして流星（青白い岩の芯に橙の炎）が斜めに降る。落ちる所に影が濃くなり、着弾で炎と岩のかけらが散って焦げが残る
 * - りゅうのいぶき: 小さな青紫の息の塊
 * 薄さ・消え際はディザ（半透明の塗りは使わない）。画面全体は光らせない。画面は揺らさない
 */

const ORB = 40;
const ORB_FRAMES = 6;
const BURST = 96;
const BURST_FRAMES = 8;
const PILLAR_W = 24;
const PILLAR_H = 96;
const DANCE_W = 64;
const DANCE_H = 96;
const DANCE_FRAMES = 6;
const METEOR = 32;
const METEOR_FRAMES = 4;
const IMPACT = 96;
const IMPACT_FRAMES = 7;
const CRATER = 64;
const BREATH = 20;
const BREATH_FRAMES = 3;
const BURST_MS = 520;
const DANCE_MS = 900;
const IMPACT_MS = 640;
const CRATER_MS = 1600;
const LAUNCH_MS = 420;
/** 流星が見えて落ちてくる時間（秒。これより前は空の上） */
const FALL = 0.45;
/** ラティオスの絵の胸の高さ（足元からの上。浮いている） */
const BODY_Y = 32;

const LIGHT = [0x1e4fa0, 0x3f7fd6, 0x64b5f6, 0x9fd3ff, 0xe3f2fd, 0xffffff];
const BLUE = [0x0d2f6b, 0x1e63b5, 0x42a5f5, 0x90caf9, 0xe3f2fd, 0xffffff];
const FIRE = [0x6e1003, 0xb92207, 0xec4a0a, 0xff8412, 0xffbd3d, 0xfff0b8];

type Shot = { ox: number; oy: number; tx: number; ty: number; total: number };
type Fx = { x: number; y: number; r: number; at: number; seed: number };

export class LatiosPlayer {
  private built = false;
  private readonly pool: DotPool;
  private readonly front: DotPool;
  private readonly floor: DotPool;
  private shots = new Map<number, Shot>();
  private meteors = new Map<number, { total: number; sx: number; sy: number }>();
  private bursts: Fx[] = [];
  private impacts: Fx[] = [];
  private craters: Fx[] = [];
  private dances: { id: number; at: number }[] = [];
  private launches: { id: number; at: number }[] = [];
  private breaths = new Map<number, { x: number; y: number }>();
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

  /** りゅうのまい・りゅうせいぐん を使った（本人のブラウザのイベント） */
  onSkillUsed(ev: SkillUsedEvent, kind: string, timeMs: number): void {
    if (kind === 'dragonDance') this.dances.push({ id: ev.playerId, at: timeMs });
    else if (kind === 'dracoMeteor') this.launches.push({ id: ev.playerId, at: timeMs });
  }

  private build(): void {
    if (this.built) return;
    this.built = true;
    const s = this.scene;
    // 光の玉: 白い芯、まわりを回る 4 本の青い光の筋、外の輪（6 コマ）
    for (let f = 0; f < ORB_FRAMES; f++) {
      const ph = (f / ORB_FRAMES) * Math.PI * 2;
      makeTexture(s, `lo-orb-${f}`, ORB, ORB, (x, y) => {
        const cx = (ORB - 1) / 2;
        const r = Math.hypot(x - cx, y - cx) / (ORB / 2);
        if (r > 1) return 0;
        const a = Math.atan2(y - cx, x - cx);
        if (r < 0.3) return c(0xffffff);
        const ray = Math.abs(Math.sin(a * 2 + ph)) ** 6;
        if (ray > 0.6 && r < 0.95) return c(r < 0.6 ? 0xffffff : 0x9fd3ff);
        if (Math.abs(r - 0.78) < 0.08) return c(0x64b5f6);
        if (r < 0.7) return shade(LIGHT, 1 - r * 0.6, x, y);
        return 0;
      });
    }
    // 光の爆発: 白い十字（4 本の光の筋）の閃光 → 青い光の輪が広がる → 光の粒になって消える（8 コマ）
    for (let f = 0; f < BURST_FRAMES; f++) {
      const t = f / (BURST_FRAMES - 1);
      makeTexture(s, `lo-burst-${f}`, BURST, BURST, (x, y) => {
        const cx = (BURST - 1) / 2;
        const dx = x - cx;
        const dy = y - cx;
        const r = Math.hypot(dx, dy) / (BURST / 2);
        if (r > 1) return 0;
        const fade = 1 - Math.max(0, t - 0.4) / 0.6;
        const arm = (1 - t * 0.7) * 0.95;
        const w = (1 - t) * 3.2 + 0.6;
        // 十字の光の筋（先が細く）
        if ((Math.abs(dx) < w * (1 - r / arm) && r < arm) || (Math.abs(dy) < w * (1 - r / arm) && r < arm)) return c(r < arm * 0.5 ? 0xffffff : 0xe3f2fd);
        // 斜めの短い筋
        if (Math.abs(Math.abs(dx) - Math.abs(dy)) < 1.2 && r < arm * 0.5) return c(0x9fd3ff);
        if (t < 0.3 && r < 0.26 * (1 - t * 2.5)) return c(0xffffff);
        // 光の衝撃波（太い輪。内側は白く、外へ青い。後半は切れ切れ）と、内側の細い輪
        const a = Math.atan2(dy, dx);
        const R = 0.25 + 0.68 * Math.sqrt(t);
        const band = 0.11 * (1 - t * 0.55) * (0.8 + 0.4 * Math.abs(Math.sin(a * 5 + f)));
        const broken = t > 0.35 && rnd(Math.floor(a * 9), f) < (t - 0.35) * 1.4;
        const e = r - (R - band);
        if (e > 0 && e < band && !broken) {
          const k = e / band;
          return k < 0.35 ? c(0xffffff) : k < 0.7 ? c(0x9fd3ff) : c(0x3f7fd6);
        }
        if (Math.abs(r - R * 0.62) < 0.025 && on(fade, x, y)) return c(0xe3f2fd);
        // 外へ飛ぶ光のかけら
        if (r > R && r < R + 0.18 && rnd(x * 5 + f, y) > 0.93 && fade > 0.2) return c(rnd(x, y + f) > 0.5 ? 0xffffff : 0x9fd3ff);
        return 0;
      });
    }
    // 光の柱（下が太く上へ細い。芯は白）
    makeTexture(s, 'lo-pillar', PILLAR_W, PILLAR_H, (x, y) => {
      const k = Math.abs(x - (PILLAR_W - 1) / 2) / (PILLAR_W / 2);
      const up = 1 - y / PILLAR_H;
      const w = 1 - up * 0.7;
      if (k > w || !on(1.1 - up * 0.8, x, y)) return 0;
      return k < w * 0.3 ? c(0xffffff) : k < w * 0.65 ? c(0x9fd3ff) : c(0x3f7fd6);
    });
    // りゅうのまい: 体のまわりを昇る 2 本の螺旋の青い炎（前は明るく、後ろは暗い。6 コマで昇る）
    for (let f = 0; f < DANCE_FRAMES; f++) {
      const ph = (f / DANCE_FRAMES) * Math.PI * 2;
      makeTexture(s, `lo-dance-${f}`, DANCE_W, DANCE_H, (x, y) => {
        const t = 1 - y / (DANCE_H - 1);
        const nx = (x - (DANCE_W - 1) / 2) / (DANCE_W / 2);
        const wid = 0.8 - t * 0.3;
        for (const off of [0, Math.PI]) {
          const a = t * 8 - ph + off;
          const cx = Math.sin(a) * wid;
          const front = Math.cos(a) > 0;
          // 帯は太く、外側の縁から炎の舌が上へちぎれる
          const lick = Math.max(0, Math.sin(t * 40 + off * 3 - ph * 2)) * 0.14;
          const thick = (0.26 - t * 0.12) * (front ? 1.15 : 0.85) + lick;
          const d = Math.abs(nx - cx);
          if (d < thick) {
            if (t > 0.55 && !on((1 - t) * 3, x + f, y)) return 0;
            if (d > thick - lick && !on(0.7, x + f, y)) return 0;
            if (!front) return shade(BLUE, 0.3 + (1 - t) * 0.15, x, y);
            return d < thick * 0.3 ? c(0xffffff) : d < thick * 0.6 ? c(0x90caf9) : shade(BLUE, 0.55 + (1 - t) * 0.15, x, y);
          }
        }
        // 昇る火の粉
        if (rnd(x * 3 + f, y) > 0.985 && Math.abs(nx) < 0.9) return c(0xe3f2fd);
        return 0;
      });
    }
    // 流星: 青白い岩の芯に、橙の炎が包む（4 コマ。右上が炎の尾の向き）
    for (let f = 0; f < METEOR_FRAMES; f++) {
      makeTexture(s, `lo-meteor-${f}`, METEOR, METEOR, (x, y) => {
        const cx = METEOR * 0.4;
        const cy = METEOR * 0.6;
        const dx = x - cx;
        const dy = y - cy;
        const d = Math.hypot(dx, dy);
        if (d < 5) return d < 2.5 ? c(0xffffff) : c(rnd(x, y + f) > 0.6 ? 0x90caf9 : 0xe3f2fd);
        // 炎（右上へ流れる）
        const u = dx * 0.7 - dy * 0.7;
        const v = dx * 0.7 + dy * 0.7;
        const len = 18 + Math.sin(f * 1.7) * 2;
        if (u > -6 && u < len) {
          const w = 7 * (1 - Math.max(0, u) / len) + Math.sin(u * 0.8 + f * 2) * 1.2;
          if (Math.abs(v) < w) return shade(FIRE, 1.05 - Math.max(0, u) / len - Math.abs(v) / (w * 2), x, y);
        }
        return 0;
      });
    }
    // 流星の着弾: 白い芯 → 橙の炎の玉が広がり、青い光が混じる → 黒い煙に崩れる（7 コマ）
    for (let f = 0; f < IMPACT_FRAMES; f++) {
      const t = f / (IMPACT_FRAMES - 1);
      makeTexture(s, `lo-impact-${f}`, IMPACT, IMPACT, (x, y) => {
        const cx = (IMPACT - 1) / 2;
        const r = Math.hypot(x - cx, (y - cx) * 1.15) / (IMPACT / 2);
        if (r > 1) return 0;
        const a = Math.atan2(y - cx, x - cx);
        const R = (0.3 + 0.62 * Math.sqrt(t)) * (1 + 0.12 * Math.sin(a * 7 + f));
        if (r > R) return 0;
        const k = r / R;
        if (t < 0.3 && k < 0.35) return c(0xffffff);
        if (t > 0.7) {
          if (!on(1.25 - k * 0.6 - (t - 0.7) * 2, x, y)) return 0;
          return k < 0.55 ? c(rnd(x, y) > 0.7 ? 0x6e1003 : 0x3a2a26) : shade(FIRE, 0.4 - (k - 0.55), x, y);
        }
        // 青い竜の気のすじ
        if (Math.abs(Math.sin(a * 5 + k * 6 - f)) > 0.94 && k < 0.85) return c(0x90caf9);
        if (k > 0.88 && !on((1 - k) * 8, x, y)) return 0;
        return shade(FIRE, 1.05 - k * (0.7 + t * 0.3), x, y);
      });
    }
    // 焦げ（黒い跡と、残り火の点）
    makeTexture(s, 'lo-crater', CRATER, CRATER / 2, (x, y) => {
      const nx = (x - (CRATER - 1) / 2) / (CRATER / 2);
      const ny = (y - (CRATER / 2 - 1) / 2) / (CRATER / 4);
      const r = Math.hypot(nx, ny) * (1 + Math.sin(Math.atan2(ny, nx) * 6) * 0.1);
      if (r > 1) return 0;
      if (r > 0.82 && !on((1 - r) * 5, x, y)) return 0;
      if (r < 0.55 && rnd(x, y) > 0.9) return c(0xff8412);
      return c(r < 0.5 ? 0x24100a : 0x45261a);
    });
    // りゅうのいぶき（青紫の息の塊。3 コマ）
    for (let f = 0; f < BREATH_FRAMES; f++) {
      makeTexture(s, `lo-breath-${f}`, BREATH, BREATH, (x, y) => {
        const cx = (BREATH - 1) / 2;
        const r = Math.hypot(x - cx, y - cx) / (BREATH / 2);
        const a = Math.atan2(y - cx, x - cx);
        const R = 0.8 + 0.15 * Math.sin(a * 5 + f * 2);
        if (r > R) return 0;
        if (r < 0.3) return c(0xf3e5f5);
        if (r > R * 0.8 && !on((R - r) * 6, x, y)) return 0;
        return r < 0.6 ? c(0x9575cd) : c(0x7e57c2);
      });
    }
  }

  update(world: World, timeMs: number, localId: number, aimSlot: number | null): void {
    const moves = world.rules.moves;
    const lp = moves.findIndex((m) => m.key === 'luster-purge-latios');
    const dm = moves.findIndex((m) => m.key === 'draco-meteor-latios');
    const db = moves.findIndex((m) => m.key === 'dragon-breath-latios');
    const pr = world.projectiles;
    this.pool.begin();
    this.front.begin();
    this.floor.begin();
    let any = this.bursts.length > 0 || this.impacts.length > 0 || this.craters.length > 0 || this.dances.length > 0 || this.launches.length > 0 || this.breaths.size > 0 || aimSlot !== null;
    for (const p of world.players) if (p.dance) any = true;
    for (let i = 0; i < pr.count && !any; i++) {
      const m = pr.move[i];
      if (m === lp || m === dm || m === db) any = true;
    }
    if (!any) {
      this.pool.end();
      this.front.end();
      this.floor.end();
      return;
    }
    this.build();
    const liveShot = new Set<number>();
    const liveMet = new Set<number>();
    const liveBreath = new Set<number>();
    for (let i = 0; i < pr.count; i++) {
      const m = pr.move[i];
      const id = pr.serial[i]!;
      const x = pr.x[i]!;
      const y = pr.y[i]!;
      const r = pr.radius[i]!;
      if (m === lp) {
        if (pr.stage[i] === 3) {
          if (pr.angle[i] !== 1) continue;
          liveShot.add(id);
          const owner = world.players.find((q) => q.id === pr.owner[i]);
          let sh = this.shots.get(id);
          if (!sh) {
            const ch = owner ? this.chest(owner) : { x, y };
            sh = { ox: ch.x, oy: ch.y, tx: x, ty: y - 18, total: Math.max(0.05, pr.life[i]!) };
            this.shots.set(id, sh);
          }
          this.drawShot(sh, pr.life[i]!, timeMs, id);
        } else if (!this.seen.has(id)) {
          this.seen.add(id);
          this.bursts.push({ x, y: y - 18, r, at: timeMs, seed: id });
        }
      } else if (m === dm) {
        if (pr.stage[i] === 3) {
          liveMet.add(id);
          let mt = this.meteors.get(id);
          if (!mt) {
            mt = { total: Math.max(0.05, pr.life[i]!), sx: 150 + rnd(id, 1) * 80, sy: -360 };
            this.meteors.set(id, mt);
          }
          this.drawMeteor(x, y, r, mt, pr.life[i]!, timeMs, id);
        } else if (!this.seen.has(id)) {
          this.seen.add(id);
          this.impacts.push({ x, y, r, at: timeMs, seed: id });
          this.craters.push({ x, y, r, at: timeMs, seed: id });
        }
      } else if (m === db && pr.stage[i] === 0) {
        liveBreath.add(id);
        this.breaths.set(id, { x, y });
        this.front.image(`lo-breath-${Math.floor(timeMs / 70 + id) % BREATH_FRAMES}`, this.frontDepth - 0.01).setPosition(x, y).setScale((r * 2.4) / BREATH);
        for (let q = 1; q <= 3; q++) this.pool.dot(x - pr.vx[i]! * q * 0.03, y - pr.vy[i]! * q * 0.03, 6 - q, 0x9575cd);
      }
    }
    for (const id of this.shots.keys()) if (!liveShot.has(id)) this.shots.delete(id);
    for (const id of this.meteors.keys()) if (!liveMet.has(id)) this.meteors.delete(id);
    for (const [id, b] of this.breaths) {
      if (liveBreath.has(id)) continue;
      this.breaths.delete(id);
      this.bursts.push({ x: b.x, y: b.y, r: -10, at: timeMs, seed: id });
    }
    if (this.seen.size > 600) this.seen.clear();
    this.drawCraters(timeMs);
    this.drawBursts(timeMs);
    this.drawImpacts(timeMs);
    this.drawDances(world, timeMs);
    this.drawLaunches(world, timeMs);
    this.drawAim(world, timeMs, localId, aimSlot);
    this.pool.end();
    this.front.end();
    this.floor.end();
  }

  /** 胸の前（向いている方へ少し出す） */
  private chest(p: { x: number; y: number; facingX: number; facingY: number }): { x: number; y: number } {
    const fx = p.facingX || (p.facingY ? 0 : 1);
    const fy = p.facingY;
    const fl = Math.hypot(fx, fy) || 1;
    return { x: p.x + (fx / fl) * 22, y: p.y - BODY_Y + (fy / fl) * 12 };
  }

  /** ラスターパージ の光の玉: まっすぐ飛び、後ろに光の粒の尾 */
  private drawShot(sh: Shot, life: number, timeMs: number, id: number): void {
    const t = Math.max(0, Math.min(1, 1 - life / sh.total));
    const x = sh.ox + (sh.tx - sh.ox) * t;
    const y = sh.oy + (sh.ty - sh.oy) * t;
    const len = Math.hypot(sh.tx - sh.ox, sh.ty - sh.oy) || 1;
    const dx = (sh.tx - sh.ox) / len;
    const dy = (sh.ty - sh.oy) / len;
    for (let s = 6; s < Math.min(len * t, 110); s += 6) {
      const fall = s / 110;
      if (rnd(Math.floor(s), id + Math.floor(timeMs / 70)) < fall * 0.5) continue;
      this.pool.dot(x - dx * s + (rnd(s, id) - 0.5) * 8, y - dy * s, Math.max(2, Math.round(7 - fall * 5)), fall < 0.4 ? 0xffffff : 0x9fd3ff);
    }
    this.front.image(`lo-orb-${Math.floor(timeMs / 50) % ORB_FRAMES}`, this.frontDepth - 0.01).setPosition(x, y).setScale(1.6);
  }

  /** 光の爆発（8 コマ）と、立ちのぼる細い光の柱。りゅうのいぶき が消えた所の小さな息（r が負） */
  private drawBursts(timeMs: number): void {
    this.bursts = this.bursts.filter((b) => timeMs - b.at < BURST_MS);
    for (const b of this.bursts) {
      const t = (timeMs - b.at) / BURST_MS;
      if (b.r < 0) {
        for (let q = 0; q < 5; q++) {
          const a = (q / 5) * Math.PI * 2 + b.seed;
          this.front.dot(b.x + Math.cos(a) * (3 + t * 14), b.y + Math.sin(a) * (3 + t * 14), Math.round(4 * (1 - t)) + 1, q % 2 ? 0x9575cd : 0xf3e5f5);
        }
        continue;
      }
      const f = Math.min(BURST_FRAMES - 1, Math.floor(t * BURST_FRAMES));
      this.front.image(`lo-burst-${f}`, this.frontDepth - 0.005).setPosition(b.x, b.y).setScale((b.r * 3.4) / BURST).setRotation(0);
      if (t < 0.5) {
        const k = 1 - t / 0.5;
        this.pool.image('lo-pillar', this.frontDepth - 0.02).setOrigin(0.5, 1).setPosition(b.x, b.y + 18).setScale(((b.r * 0.6) / PILLAR_W) * k, (b.r * 3.2) / PILLAR_H);
      }
    }
  }

  /** 流星: 空から斜めに降る（見えるのは最後の FALL 秒）。落ちる所の影は先に出て濃くなる */
  private drawMeteor(x: number, y: number, r: number, mt: { total: number; sx: number; sy: number }, life: number, timeMs: number, id: number): void {
    // 落ちる所の印: 落ちる直前（FALL 秒）だけ、細い輪が締まっていく（影を重ねると黒いかたまりになるので、輪にする）
    if (life > FALL) return;
    const t0 = 1 - life / FALL;
    const rr = r * (1.6 - t0 * 0.8);
    for (let q = 0; q < 14; q++) {
      const a = (q / 14) * Math.PI * 2 + id;
      this.floor.dot(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.45, 3, t0 > 0.6 ? 0xff8412 : 0x90caf9);
    }
    const t = 1 - life / FALL;
    const mx = x + mt.sx * (1 - t);
    const my = y - 18 + mt.sy * (1 - t);
    // 炎の尾（来た方へ）
    const len = Math.hypot(mt.sx, mt.sy);
    const ux = mt.sx / len;
    const uy = mt.sy / len;
    for (let s = 8; s < 110; s += 6) {
      const fall = s / 110;
      if (rnd(Math.floor(s), id + Math.floor(timeMs / 60)) < fall * 0.55) continue;
      this.front.dot(mx + ux * s + (rnd(s, id) - 0.5) * 8, my + uy * s, Math.max(2, Math.round(9 - fall * 7)), fall < 0.25 ? 0xffbd3d : fall < 0.6 ? 0xec4a0a : 0x6e1003);
    }
    const img = this.front.image(`lo-meteor-${Math.floor(timeMs / 60 + id) % METEOR_FRAMES}`, this.frontDepth + 0.01);
    img.setPosition(mx, my).setScale((r * 1.5) / METEOR).setRotation(Math.atan2(-uy, -ux) - Math.atan2(0.6, -0.4) + Math.PI);
  }

  /** 流星の着弾（7 コマ）と、飛び散る岩と炎のかけら */
  private drawImpacts(timeMs: number): void {
    this.impacts = this.impacts.filter((b) => timeMs - b.at < IMPACT_MS);
    for (const b of this.impacts) {
      const t = (timeMs - b.at) / IMPACT_MS;
      const f = Math.min(IMPACT_FRAMES - 1, Math.floor(t * IMPACT_FRAMES));
      this.front.image(`lo-impact-${f}`, this.frontDepth - 0.01).setOrigin(0.5, 0.7).setPosition(b.x, b.y).setScale((b.r * 2.3) / IMPACT);
      const tt = t * 0.64;
      for (let q = 0; q < 10; q++) {
        const a = (q / 10) * Math.PI * 2 + rnd(q, b.seed);
        const sp = b.r * (1 + rnd(q, b.seed + 1));
        const hh = (240 + rnd(q, b.seed + 2) * 180) * tt - 900 * tt * tt;
        if (hh < 0 && tt > 0.1) continue;
        this.front.dot(b.x + Math.cos(a) * sp * tt * 2, b.y + Math.sin(a) * sp * tt - Math.max(0, hh), q % 3 === 0 ? 6 : 4, q % 3 === 0 ? 0x5d5651 : q % 3 === 1 ? 0xff8412 : 0x90caf9);
      }
    }
  }

  /** 焦げ（しばらく残って消える） */
  private drawCraters(timeMs: number): void {
    this.craters = this.craters.filter((b) => timeMs - b.at < CRATER_MS);
    for (const b of this.craters) {
      const k = Math.min(1, (CRATER_MS - (timeMs - b.at)) / 400);
      this.floor.image('lo-crater', this.floorDepth + 0.1).setPosition(b.x, b.y).setScale(((b.r * 1.9) / CRATER) * (0.6 + k * 0.4), ((b.r * 0.95) / (CRATER / 2)) * (0.6 + k * 0.4));
    }
  }

  /** りゅうのまい: 使った時は螺旋の青い炎が体を昇る。重ねている間は、重ねた数だけ青い炎の舌が体のまわりを回る */
  private drawDances(world: World, timeMs: number): void {
    this.dances = this.dances.filter((d) => timeMs - d.at < DANCE_MS);
    for (const d of this.dances) {
      const p = world.players.find((q) => q.id === d.id);
      if (!p) continue;
      const t = (timeMs - d.at) / DANCE_MS;
      const k = t < 0.15 ? t / 0.15 : t > 0.7 ? (1 - t) / 0.3 : 1;
      this.front.image(`lo-dance-${Math.floor(timeMs / 60) % DANCE_FRAMES}`, this.frontDepth + 0.015).setOrigin(0.5, 1).setPosition(p.x, p.y + 8).setScale(1.7 * Math.max(0.2, k), 1.5);
    }
    for (const p of world.players) {
      const dn = p.dance;
      if (!dn || world.tick >= dn.untilTick || p.down) continue;
      for (let k = 0; k < dn.stacks; k++) {
        const a = (k / dn.stacks) * Math.PI * 2 + timeMs / 260;
        const fx = p.x + Math.cos(a) * 50;
        const fy = p.y - BODY_Y + 6 + Math.sin(a) * 18;
        const behind = Math.sin(a) < 0;
        // 青い炎の舌（下が太く、上へ揺れて細くなる。後ろを回るときは暗い）
        for (let s2 = 0; s2 < 6; s2++) {
          const sway = Math.sin(timeMs / 90 + s2 + k * 2) * s2 * 0.8;
          this.front.dot(fx + sway, fy - s2 * 6, Math.max(3, 15 - s2 * 2), behind ? 0x1e63b5 : s2 < 2 ? 0x1e88e5 : s2 < 4 ? 0x64b5f6 : 0xe3f2fd);
          if (!behind && s2 < 3) this.front.dot(fx + sway, fy - s2 * 6 + 1, Math.max(2, 6 - s2), 0xffffff);
        }
      }
    }
  }

  /** りゅうせいぐん を使った時: 体から橙の光の玉が空へ打ち上がる */
  private drawLaunches(world: World, timeMs: number): void {
    this.launches = this.launches.filter((l) => timeMs - l.at < LAUNCH_MS);
    for (const l of this.launches) {
      const p = world.players.find((q) => q.id === l.id);
      if (!p) continue;
      const t = (timeMs - l.at) / LAUNCH_MS;
      const y = p.y - BODY_Y - t * 360;
      for (let s = 0; s < 8; s++) this.front.dot(p.x + (rnd(s, l.at) - 0.5) * 6, y + s * 10, Math.max(2, 10 - s), s < 2 ? 0xfff0b8 : s < 5 ? 0xff8412 : 0xb92207);
      this.front.dot(p.x, y, 14, 0xffbd3d);
      this.front.dot(p.x, y, 7, 0xffffff);
    }
  }

  /** 押している間（本人）: ラスターパージ は爆発の走る列、りゅうせいぐん は流星の落ちる区画 */
  private drawAim(world: World, timeMs: number, localId: number, aimSlot: number | null): void {
    const me = world.players.find((p) => p.id === localId);
    const slot = aimSlot !== null ? me?.skills?.[aimSlot] : undefined;
    if (!me || !slot || me.down) return;
    const aim = moltresAim(world, me, slot.skill);
    if (!aim || aim.x === undefined || aim.y === undefined || !aim.r) return;
    const def = world.rules.activeSkills?.defs[slot.skill];
    const col = slot.charges > 0 ? 0x64b5f6 : 0x5a6b78;
    if (def?.lusterPurge && aim.path && aim.path.length > 1) {
      const [a, b] = [aim.path[0]!, aim.path[1]!];
      const n = Math.round(Math.hypot(b.x - a.x, b.y - a.y) / def.lusterPurge.spacing) + 1;
      for (let k = 0; k < n; k++) {
        const x = a.x + ((b.x - a.x) * k) / Math.max(1, n - 1);
        const y = a.y + ((b.y - a.y) * k) / Math.max(1, n - 1);
        for (let q = 0; q < 10; q++) {
          const t = (q / 10) * Math.PI * 2 + timeMs / 600;
          this.front.dot(x + Math.cos(t) * aim.r * 0.6, y + Math.sin(t) * aim.r * 0.35, 3, col);
        }
      }
      const [fx, fy] = aimOf(me);
      void fx;
      void fy;
      return;
    }
    if (def?.dracoMeteor) {
      const n = 32;
      for (let k = 0; k < n; k++) {
        const t = (k / n) * Math.PI * 2 + timeMs / 900;
        this.front.dot(aim.x + Math.cos(t) * aim.r, aim.y + Math.sin(t) * aim.r * 0.7, 4, slot.charges > 0 ? 0xff8412 : 0x5a6b78);
      }
      // 重ねた数だけ多く落ちることを、輪の中の小さな印で見せる
      const stacks = me.dance && world.tick < me.dance.untilTick ? me.dance.stacks : 0;
      for (let k = 0; k < stacks; k++) this.front.dot(aim.x - (stacks - 1) * 8 + k * 16, aim.y, 8, 0x42a5f5);
    }
  }
}
