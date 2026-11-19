import Phaser from 'phaser';
import type { World } from '../../sim/world';
import type { SkillUsedEvent } from '../../sim/events';
import { aimOf } from '../../sim/activeSkills';
import { skillMoveStats } from '../../sim/systems/attack';
import { DotPool, c, makeTexture, on, rnd, shade } from './dotArt';

/**
 * 遊べるラティアスの技の絵（07 の319章。ミュウツーの サイコブレイク・ルギアの水準で、1 ドットずつ計算した不透明のドット絵）:
 * - ミストボール: 胸の前から、桃色の芯に白い霧の渦を巻いた玉が 5 つ、扇に開いて飛ぶ（後ろに霧の尾）→ 当たった所で霧が弾け、ふわふわの霧の雲が残ってゆっくり渦を巻く
 * - りゅうのはどう: 口の前に青紫の竜の気が集まり、らせんの筋をまとった太い波動がまっすぐ走る（先で気が裂けて広がる）
 * - いやしのはどう: 体から桃色と白の光の花がひらき、近くの仲間に光が降りる。残っている霧へ光の筋が走り、届いた霧が金色に光って弾ける
 * - ねんりき: 小さな桃色の念の輪
 * 薄さ・消え際はディザ（半透明の塗りは使わない）。画面全体は光らせない。画面は揺らさない
 */

const ORB = 40;
const ORB_FRAMES = 6;
const POP = 96;
const POP_FRAMES = 7;
const MIST_W = 96;
const MIST_H = 64;
const MIST_FRAMES = 6;
const CORB = 40;
const CORB_FRAMES = 6;
const BEAM_W = 64;
const BEAM_H = 40;
const BEAM_FRAMES = 4;
const HEAD = 64;
const HEAD_FRAMES = 4;
const BLOOM = 80;
const BLOOM_FRAMES = 7;
const SHINE = 128;
const SHINE_FRAMES = 8;
const PSY = 16;
const PSY_FRAMES = 3;
const POP_MS = 420;
const BLOOM_MS = 620;
const SHINE_MS = 760;
/** ラティアスの絵の胸の高さ（足元からの上。浮いている） */
const BODY_Y = 30;

const ROSE = [0x8e2a3b, 0xc2414f, 0xe57373, 0xff8a80, 0xfcc2c8, 0xfce4ec, 0xffffff];
const MIST = [0xd88aa0, 0xf0b3c4, 0xf8cfdc, 0xfce4ec, 0xffffff];
const GOLD = [0xc26a3a, 0xf0a04b, 0xffd166, 0xfff1b8, 0xffffff];
const DRAGON = [0x1a1050, 0x311b92, 0x5e35b1, 0x7986cb, 0xb3e5fc, 0xffffff];

type Flight = { ox: number; oy: number; tx: number; ty: number; total: number };
type Fx = { x: number; y: number; r: number; at: number; seed: number };

export class LatiasPlayer {
  private built = false;
  private readonly pool: DotPool;
  private readonly front: DotPool;
  private readonly floor: DotPool;
  private flights = new Map<number, Flight>();
  private threads = new Map<number, { ox: number; oy: number; at: number; total: number }>();
  private pops: Fx[] = [];
  private shines: Fx[] = [];
  private blooms: { id: number; at: number }[] = [];
  private psys = new Map<number, { x: number; y: number }>();
  private seen = new Set<number>();

  constructor(
    private readonly scene: Phaser.Scene,
    depth: number,
    floorDepth: number,
    private readonly frontDepth: number,
  ) {
    this.pool = new DotPool(scene, depth + 0.02);
    this.front = new DotPool(scene, frontDepth + 0.01);
    this.floor = new DotPool(scene, floorDepth + 0.15);
  }

  /** いやしのはどう を使った（本人のブラウザのイベント）: 体から光の花がひらく */
  onSkillUsed(ev: SkillUsedEvent, timeMs: number): void {
    this.blooms.push({ id: ev.playerId, at: timeMs });
  }

  private build(): void {
    if (this.built) return;
    this.built = true;
    const s = this.scene;
    // 霧の玉: 桃色の芯、白い霧の渦が 2 本回る、縁はふわっと霧に溶ける（6 コマ）
    for (let f = 0; f < ORB_FRAMES; f++) {
      const ph = (f / ORB_FRAMES) * Math.PI * 2;
      makeTexture(s, `lt-orb-${f}`, ORB, ORB, (x, y) => {
        const cx = (ORB - 1) / 2;
        const r = Math.hypot(x - cx, y - cx) / (ORB / 2);
        if (r > 1) return 0;
        const a = Math.atan2(y - cx, x - cx);
        const sw = Math.sin(a * 2 - Math.log(r + 0.05) * 4 + ph);
        // 外: 霧のかさ（渦を巻いてにじむ。すき間はまばら）
        if (r > 0.62) return on((1 - r) * 3 * (sw > -0.2 ? 1 : 0.45), x + f, y) ? c(sw > 0.5 ? 0xffffff : r < 0.8 ? 0xfce4ec : 0xf8cfdc) : 0;
        // 芯: 白からやわらかい桃色へ。渦は淡い濃淡だけ
        if (r < 0.18) return c(0xffffff);
        return shade(ROSE, 0.95 - r * 0.55 + (sw > 0.4 ? 0.08 : -0.04), x, y);
      });
    }
    // 霧が弾ける: 白い芯 → 桃色の霧のふくらみが渦を巻いて広がる → ちぎれて薄れる（7 コマ）
    for (let f = 0; f < POP_FRAMES; f++) {
      const t = f / (POP_FRAMES - 1);
      makeTexture(s, `lt-pop-${f}`, POP, POP, (x, y) => {
        const cx = (POP - 1) / 2;
        const r = Math.hypot(x - cx, y - cx) / (POP / 2);
        if (r > 1) return 0;
        const a = Math.atan2(y - cx, x - cx);
        const R = (0.3 + 0.62 * Math.sqrt(t)) * (1 + 0.1 * Math.sin(a * 6 + f));
        if (r > R) return 0;
        const fade = 1 - Math.max(0, t - 0.45) / 0.55;
        if (t < 0.3 && r < 0.3 * (1 - t * 3)) return c(0xffffff);
        const sw = Math.sin(a * 3 - r * 9 + t * 6);
        const k = r / R;
        if (!on(fade * (k > 0.7 ? (1 - k) * 3.3 : 0.9) * (sw > -0.3 ? 1 : 0.4), x, y)) return 0;
        return shade(MIST, 0.95 - k * 0.6 + (sw > 0.5 ? 0.15 : 0), x, y);
      });
    }
    // 霧の雲: ふわふわの塊が重なり、ゆっくり渦を巻く（6 コマ。光っている版は金色）
    for (const [key, cols] of [['lt-mist', MIST], ['lt-mistlit', GOLD]] as const) {
      for (let f = 0; f < MIST_FRAMES; f++) {
        const ph = (f / MIST_FRAMES) * Math.PI * 2;
        const blobs = Array.from({ length: 7 }, (_, q) => {
          const a = (q / 7) * Math.PI * 2 + ph * 0.3;
          const d = q === 0 ? 0 : 0.42;
          return { x: (MIST_W - 1) / 2 + Math.cos(a) * d * MIST_W * 0.5, y: (MIST_H - 1) / 2 + Math.sin(a) * d * MIST_H * 0.42, r: (q === 0 ? 0.36 : 0.24 + rnd(q, 3) * 0.08) * MIST_W * 0.5 };
        });
        makeTexture(s, `${key}-${f}`, MIST_W, MIST_H, (x, y) => {
          let best = 0;
          let ny = 0;
          for (const b of blobs) {
            const d = 1 - Math.hypot(x - b.x, (y - b.y) * 1.3) / b.r;
            if (d > best) {
              best = d;
              ny = (y - b.y) / b.r;
            }
          }
          if (best <= 0) return 0;
          if (best < 0.35 && !on(best * 3, x + f, y)) return 0;
          const sw = Math.sin(Math.atan2(y - MIST_H / 2, (x - MIST_W / 2) * 0.66) * 2 + Math.hypot(x - MIST_W / 2, (y - MIST_H / 2) * 1.5) * 0.18 - ph);
          return shade(cols, 0.45 + best * 0.4 - ny * 0.15 + (sw > 0.55 ? 0.18 : 0), x, y);
        });
      }
    }
    // 竜の気の玉（ため）: 白い芯、青紫の渦（6 コマ）
    for (let f = 0; f < CORB_FRAMES; f++) {
      const ph = (f / CORB_FRAMES) * Math.PI * 2;
      makeTexture(s, `lt-corb-${f}`, CORB, CORB, (x, y) => {
        const cx = (CORB - 1) / 2;
        const r = Math.hypot(x - cx, y - cx) / (CORB / 2);
        if (r > 1) return 0;
        const a = Math.atan2(y - cx, x - cx);
        if (r < 0.22) return c(0xffffff);
        const sw = Math.sin(a * 3 - Math.log(r + 0.05) * 5 + ph);
        if (r > 0.82) return sw > 0 && on((1 - r) * 5, x, y) ? c(0x7986cb) : 0;
        return shade(DRAGON, 0.95 - r * 0.7 + (sw > 0.5 ? 0.18 : 0), x, y);
      });
    }
    // 竜の気の波動（右へ流れる帯。紺の外 → 青紫 → 水色 → 白い芯。2 本のらせんの筋。4 コマ）
    for (let f = 0; f < BEAM_FRAMES; f++) {
      const ph = (f / BEAM_FRAMES) * Math.PI * 2;
      makeTexture(s, `lt-beam-${f}`, BEAM_W, BEAM_H, (x, y) => {
        const u = x / BEAM_W;
        const v = (y - (BEAM_H - 1) / 2) / (BEAM_H / 2);
        const edge = 0.8 + 0.1 * Math.sin(u * Math.PI * 4 - ph) + 0.06 * Math.sin(u * Math.PI * 10 + ph);
        const s1 = Math.abs(v - 0.62 * Math.sin(u * Math.PI * 2 - ph)) < 0.08;
        const s2 = Math.abs(v + 0.62 * Math.sin(u * Math.PI * 2 - ph)) < 0.06;
        if ((s1 || s2) && Math.abs(v) < 0.95) return c(s1 ? 0xe1bee7 : 0xb3e5fc);
        const a = Math.abs(v);
        if (a > edge) return 0;
        const k = a / edge;
        if (k > 0.85 && !on((1 - k) * 6, x + f, y)) return 0;
        return shade(DRAGON, 1.02 - k * 0.85 + Math.sin(u * 14 - ph) * 0.05, x, y);
      });
    }
    // 波動の先: 気が裂けて扇に広がる（4 コマ）
    for (let f = 0; f < HEAD_FRAMES; f++) {
      makeTexture(s, `lt-head-${f}`, HEAD, HEAD, (x, y) => {
        const cx = HEAD * 0.2;
        const cy = (HEAD - 1) / 2;
        const dx = x - cx;
        const dy = y - cy;
        const r = Math.hypot(dx, dy) / (HEAD * 0.8);
        const a = Math.atan2(dy, dx);
        if (r > 1 || Math.abs(a) > 1.2 || dx < -4) return 0;
        const ray = Math.abs(Math.sin(a * 5 + f * 0.9));
        if (ray > 0.8 && on(1.1 - r, x + f, y)) return c(r < 0.4 ? 0xffffff : 0xb3e5fc);
        if (r < 0.35 && on(1 - r * 2, x, y)) return shade(DRAGON, 0.9 - r, x, y);
        return 0;
      });
    }
    // 光の花（いやしのはどう。桃色と白の花びらの光がひらいて薄れる。7 コマ）
    for (let f = 0; f < BLOOM_FRAMES; f++) {
      const t = f / (BLOOM_FRAMES - 1);
      makeTexture(s, `lt-bloom-${f}`, BLOOM, BLOOM, (x, y) => {
        const cx = (BLOOM - 1) / 2;
        const r = Math.hypot(x - cx, y - cx) / (BLOOM / 2);
        if (r > 1) return 0;
        const a = Math.atan2(y - cx, x - cx) + t * 0.6;
        const fade = 1 - Math.max(0, t - 0.45) / 0.55;
        // 6 枚の花びら（細長いしずく形）が外へひらく。真ん中は空けて体が見えるように
        const R = 0.42 + 0.5 * Math.sqrt(t);
        const sector = ((a / (Math.PI * 2)) * 6 + 6) % 1;
        const off = Math.abs(sector - 0.5) * 2;
        const width = Math.max(0, 1 - ((r - R * 0.55) / (R * 0.45)) ** 2) * 0.5;
        if (r > R * 0.5 && r < R && off < width) {
          if (!on(fade, x, y)) return 0;
          return off > width * 0.7 ? c(0xf48fb1) : r > R * 0.85 ? c(0xffffff) : c(0xfce4ec);
        }
        // 花びらの間の光の筋
        if (Math.abs(off - 1) < 0.06 && r > R * 0.4 && r < R * 1.1 && on(fade * 0.9, x, y)) return c(0xfff1b8);
        return 0;
      });
    }
    // 霧が光って弾ける: 金色の光の芯 → 花びらの光と放射の筋が広がる → 光の粒（8 コマ）
    for (let f = 0; f < SHINE_FRAMES; f++) {
      const t = f / (SHINE_FRAMES - 1);
      makeTexture(s, `lt-shine-${f}`, SHINE, SHINE, (x, y) => {
        const cx = (SHINE - 1) / 2;
        const r = Math.hypot(x - cx, y - cx) / (SHINE / 2);
        if (r > 1) return 0;
        const a = Math.atan2(y - cx, x - cx);
        const fade = 1 - Math.max(0, t - 0.45) / 0.55;
        if (t < 0.25 && r < 0.14 * (1 - t * 3)) return c(0xffffff);
        if (t < 0.25 && r < 0.24 * (1 - t * 2) && on(0.7, x, y)) return c(0xffd166);
        // 放射の筋（8 本。長短）
        const ray = Math.abs(Math.sin(a * 4)) ** 10;
        const reach = (0.4 + 0.55 * t) * (0.6 + 0.4 * Math.abs(Math.cos(a * 2)));
        if (ray > 0.5 && r < reach && on(fade * 1.1, x, y)) return c(r < reach * 0.5 ? 0xffffff : 0xffd166);
        // 光の輪
        const R = 0.25 + 0.6 * t;
        if (Math.abs(r - R) < 0.05 && on(fade, x, y)) return c(r > R ? 0xf48fb1 : 0xfff1b8);
        // 中の金色の光（だんだん薄く）
        if (r < R && on(fade * (1 - r / R) * 0.8, x, y)) return shade(GOLD, 0.9 - r, x, y);
        if (r < R + 0.15 && rnd(x * 5 + f, y) > 0.95 && fade > 0.2) return c(0xfff1b8);
        return 0;
      });
    }
    // ねんりき（小さな桃色の念の輪。3 コマで回る）
    for (let f = 0; f < PSY_FRAMES; f++) {
      makeTexture(s, `lt-psy-${f}`, PSY, PSY, (x, y) => {
        const cx = (PSY - 1) / 2;
        const r = Math.hypot(x - cx, y - cx) / (PSY / 2);
        const a = Math.atan2(y - cx, x - cx) + f * 0.9;
        if (Math.abs(r - 0.8) < 0.16 && Math.sin(a * 3) > -0.3) return c(0xf48fb1);
        if (Math.abs(r - 0.4) < 0.15) return c(0xfce4ec);
        if (r < 0.15) return c(0xffffff);
        return 0;
      });
    }
  }

  update(world: World, timeMs: number, localId: number, aimSlot: number | null): void {
    const moves = world.rules.moves;
    const mb = moves.findIndex((m) => m.key === 'mist-ball-latias');
    const dp = moves.findIndex((m) => m.key === 'dragon-pulse-latias');
    const hp = moves.findIndex((m) => m.key === 'heal-pulse-latias');
    const cf = moves.findIndex((m) => m.key === 'confusion-latias');
    const pr = world.projectiles;
    this.pool.begin();
    this.front.begin();
    this.floor.begin();
    let any = this.pops.length > 0 || this.shines.length > 0 || this.blooms.length > 0 || this.psys.size > 0 || aimSlot !== null;
    for (let i = 0; i < pr.count && !any; i++) {
      const m = pr.move[i];
      if (m === mb || m === dp || m === hp || m === cf) any = true;
    }
    if (!any) {
      this.pool.end();
      this.front.end();
      this.floor.end();
      return;
    }
    this.build();
    const liveF = new Set<number>();
    const liveT = new Set<number>();
    const livePsy = new Set<number>();
    const charge = world.rules.activeSkills?.defs.find((d) => d.kind === 'dragonPulse')?.dragonPulse?.chargeSeconds ?? 0.25;
    for (let i = 0; i < pr.count; i++) {
      const m = pr.move[i];
      const id = pr.serial[i]!;
      const x = pr.x[i]!;
      const y = pr.y[i]!;
      const r = pr.radius[i]!;
      const owner = m === mb || m === dp || m === hp ? world.players.find((q) => q.id === pr.owner[i]) : undefined;
      const chest = owner ? this.chest(owner) : { x, y };
      if (m === mb) {
        if (pr.stage[i] === 3) {
          if (pr.armStage[i] !== 0) continue;
          liveF.add(id);
          let fl = this.flights.get(id);
          if (!fl) {
            fl = { ox: chest.x, oy: chest.y, tx: x, ty: y - 16, total: Math.max(0.05, pr.life[i]!) };
            this.flights.set(id, fl);
          }
          this.drawOrb(fl, pr.life[i]!, timeMs, id);
        } else if (pr.stage[i] === 0) {
          if (this.seen.has(id)) continue;
          this.seen.add(id);
          this.pops.push({ x, y: y - 16, r, at: timeMs, seed: id });
        } else if (pr.stage[i] === 1) {
          this.drawMist(x, y, r, pr.angle[i] === 1, pr.life[i]!, pr.maxLife[i]!, timeMs, id);
        }
      } else if (m === dp) {
        if (pr.stage[i] === 3) this.drawDragonCharge(chest.x, chest.y - 10, 1 - pr.life[i]! / Math.max(0.01, charge), timeMs);
        else this.drawPulse(chest.x, chest.y - 10, pr.dirX[i]!, pr.dirY[i]!, pr.length[i]!, r, pr.life[i]!, pr.maxLife[i]!, timeMs);
      } else if (m === hp) {
        if (pr.stage[i] === 3) {
          liveT.add(id);
          let th = this.threads.get(id);
          if (!th) {
            th = { ox: chest.x, oy: chest.y, at: timeMs, total: Math.max(0.05, pr.life[i]!) };
            this.threads.set(id, th);
          }
          this.drawThread(th, x, y - 16, pr.life[i]!, timeMs, id);
        } else if (!this.seen.has(id)) {
          this.seen.add(id);
          this.shines.push({ x, y: y - 16, r, at: timeMs, seed: id });
        }
      } else if (m === cf && pr.stage[i] === 0) {
        livePsy.add(id);
        this.psys.set(id, { x, y });
        this.front.image(`lt-psy-${Math.floor(timeMs / 70 + id) % PSY_FRAMES}`, this.frontDepth - 0.01).setPosition(x, y).setScale((r * 2.4) / PSY);
        for (let q = 1; q <= 3; q++) this.pool.dot(x - pr.vx[i]! * q * 0.03, y - pr.vy[i]! * q * 0.03, 5 - q, 0xf8bbd0);
      }
    }
    for (const id of this.flights.keys()) if (!liveF.has(id)) this.flights.delete(id);
    for (const id of this.threads.keys()) if (!liveT.has(id)) this.threads.delete(id);
    for (const [id, s] of this.psys) {
      if (livePsy.has(id)) continue;
      this.psys.delete(id);
      this.pops.push({ x: s.x, y: s.y, r: -10, at: timeMs, seed: id });
    }
    if (this.seen.size > 600) this.seen.clear();
    this.drawPops(timeMs);
    this.drawShines(timeMs);
    this.drawBlooms(world, timeMs);
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

  /** 飛ぶ霧の玉: 胸から着く所へまっすぐ。後ろに霧の尾（ゆらぐ桃色と白の粒） */
  private drawOrb(fl: Flight, life: number, timeMs: number, id: number): void {
    const t = Math.max(0, Math.min(1, 1 - life / fl.total));
    const x = fl.ox + (fl.tx - fl.ox) * t;
    const y = fl.oy + (fl.ty - fl.oy) * t;
    const len = Math.hypot(fl.tx - fl.ox, fl.ty - fl.oy) || 1;
    const dx = (fl.tx - fl.ox) / len;
    const dy = (fl.ty - fl.oy) / len;
    const back = Math.min(len * t, 90);
    for (let s = 6; s < back; s += 6) {
      const fall = s / 90;
      if (rnd(Math.floor(s), id + Math.floor(timeMs / 80)) < fall * 0.5) continue;
      const w = Math.sin(s * 0.12 - timeMs / 70 + id) * 6;
      this.pool.dot(x - dx * s - dy * w, y - dy * s + dx * w, Math.max(3, Math.round(13 - fall * 9)), fall < 0.4 ? 0xfce4ec : 0xf8cfdc);
      if (s % 12 === 0) this.pool.dot(x - dx * s + dy * w * 0.6, y - dy * s - dx * w * 0.6, Math.max(2, Math.round(8 - fall * 6)), 0xffffff);
    }
    this.front.image(`lt-orb-${Math.floor(timeMs / 60 + id) % ORB_FRAMES}`, this.frontDepth - 0.01).setPosition(x, y).setScale(1.5).setRotation(timeMs / 200);
  }

  /** 残る霧: 2 枚の雲を少しずらして逆にゆっくり回す。光っている霧は金色で、まわりに光の粒。消える前は小さく */
  private drawMist(x: number, y: number, r: number, lit: boolean, life: number, maxLife: number, timeMs: number, id: number): void {
    const k = Math.min(1, life / 0.4, (maxLife - life) / 0.2 + 0.4);
    const key = lit ? 'lt-mistlit' : 'lt-mist';
    const f = Math.floor(timeMs / 110 + id) % MIST_FRAMES;
    this.pool.image(`${key}-${f}`, this.frontDepth - 0.05).setPosition(x, y - 10).setScale(((r * 2.3) / MIST_W) * k, ((r * 1.5) / MIST_H) * k);
    this.pool.image(`${key}-${(f + 3) % MIST_FRAMES}`, this.frontDepth - 0.049).setPosition(x + Math.sin(timeMs / 600 + id) * 8, y - 18).setScale(((r * 1.5) / MIST_W) * k, ((r * 1.0) / MIST_H) * k).setFlipX(true);
    if (lit) {
      for (let q = 0; q < 10; q++) {
        const a = (q / 10) * Math.PI * 2 + timeMs / 200;
        this.front.dot(x + Math.cos(a) * r * 0.9, y - 12 + Math.sin(a) * r * 0.5, 4, q % 2 ? 0xfff1b8 : 0xffffff);
      }
    }
  }

  /** 霧が弾ける（7 コマ）と、ねんりき が消えた所の小さな輪（r が負） */
  private drawPops(timeMs: number): void {
    this.pops = this.pops.filter((p) => timeMs - p.at < POP_MS);
    for (const p of this.pops) {
      const t = (timeMs - p.at) / POP_MS;
      if (p.r < 0) {
        for (let q = 0; q < 6; q++) {
          const a = (q / 6) * Math.PI * 2 + p.seed;
          this.front.dot(p.x + Math.cos(a) * (3 + t * 14), p.y + Math.sin(a) * (3 + t * 14), Math.round(4 * (1 - t)) + 1, q % 2 ? 0xfce4ec : 0xf48fb1);
        }
        continue;
      }
      const f = Math.min(POP_FRAMES - 1, Math.floor(t * POP_FRAMES));
      this.front.image(`lt-pop-${f}`, this.frontDepth - 0.01).setPosition(p.x, p.y).setScale((p.r * 3.2) / POP).setRotation(p.seed);
    }
  }

  /** りゅうのはどう のため: 口の前に青紫の気の玉がふくらみ、気の粒が吸い込まれる */
  private drawDragonCharge(x: number, y: number, t: number, timeMs: number): void {
    const k = Math.max(0, Math.min(1, t));
    for (let q = 0; q < 18; q++) {
      const ph = (rnd(q, 7) + timeMs / 360) % 1;
      const ang = rnd(q, 9) * Math.PI * 2 + timeMs / 500;
      const rr = 80 * (1 - ph) + 6;
      this.front.dot(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr * 0.85, Math.round(6 - ph * 3), q % 3 === 0 ? 0xffffff : q % 2 ? 0x7986cb : 0xb3e5fc);
    }
    this.front.image(`lt-corb-${Math.floor(timeMs / 50) % CORB_FRAMES}`, this.frontDepth + 0.012).setPosition(x, y).setScale(0.4 + k * 1.1);
  }

  /** りゅうのはどう: 帯を並べた波動、口もとの気の玉、先で裂けて広がる気。出始めは細く、消える前も細く */
  private drawPulse(x: number, y: number, dx: number, dy: number, len: number, r: number, life: number, maxLife: number, timeMs: number): void {
    const f = Math.floor(timeMs / 50) % BEAM_FRAMES;
    const rot = Math.atan2(dy, dx);
    const age = maxLife - life;
    const grow = Math.min(1, age / 0.08);
    const fade = Math.min(1, life / 0.1);
    const reach = len * grow;
    const seg = BEAM_W * 1.5;
    const n = Math.ceil(reach / seg);
    for (let k = 0; k < n; k++) {
      const d = k * seg;
      const w = Math.min(1, 0.7 + (k / Math.max(1, n - 1)) * 0.4) * fade;
      this.front.image(`lt-beam-${(f + k) % BEAM_FRAMES}`, this.frontDepth - 0.02).setOrigin(0, 0.5).setPosition(x + dx * d, y + dy * d).setRotation(rot).setScale(Math.min(seg, reach - d) / BEAM_W, ((r * 2.4) / BEAM_H) * w);
    }
    this.front.image(`lt-corb-${f % CORB_FRAMES}`, this.frontDepth - 0.015).setPosition(x, y).setScale(1.5 * fade);
    this.front.image(`lt-head-${f}`, this.frontDepth - 0.015).setOrigin(0.2, 0.5).setPosition(x + dx * reach, y + dy * reach).setRotation(rot).setScale(((r * 2.8) / HEAD) * fade);
  }

  /** いやしのはどう の光の筋: 胸から霧へ、光の頭が走り、通った後は点線が残る */
  private drawThread(th: { ox: number; oy: number; total: number }, tx: number, ty: number, life: number, timeMs: number, id: number): void {
    const t = Math.max(0, Math.min(1, 1 - life / th.total));
    const len = Math.hypot(tx - th.ox, ty - th.oy) || 1;
    const dx = (tx - th.ox) / len;
    const dy = (ty - th.oy) / len;
    const head = len * t;
    for (let s = 0; s < head; s += 7) {
      const w = Math.sin(s * 0.08 + id) * 4;
      this.front.dot(th.ox + dx * s - dy * w, th.oy + dy * s + dx * w, (Math.floor(s / 7) + Math.floor(timeMs / 60)) % 3 === 0 ? 7 : 4, (Math.floor(s / 7) % 2) ? 0xf8bbd0 : 0xffffff);
    }
    const hx = th.ox + dx * head;
    const hy = th.oy + dy * head;
    for (let q = 0; q < 6; q++) {
      const a = (q / 6) * Math.PI * 2 + timeMs / 80;
      this.front.dot(hx + Math.cos(a) * 6, hy + Math.sin(a) * 6, 4, q % 2 ? 0xfff1b8 : 0xffffff);
    }
    this.front.dot(hx, hy, 8, 0xffffff);
  }

  /** 霧が光って弾ける（8 コマ）と、舞い上がる光の粒 */
  private drawShines(timeMs: number): void {
    this.shines = this.shines.filter((s) => timeMs - s.at < SHINE_MS);
    for (const s of this.shines) {
      const t = (timeMs - s.at) / SHINE_MS;
      const f = Math.min(SHINE_FRAMES - 1, Math.floor(t * SHINE_FRAMES));
      this.front.image(`lt-shine-${f}`, this.frontDepth - 0.005).setPosition(s.x, s.y).setScale((s.r * 2.5) / SHINE).setRotation(s.seed * 0.3);
      for (let q = 0; q < 14; q++) {
        const ph = (t + rnd(q, s.seed)) % 1;
        const a = rnd(q, s.seed + 3) * Math.PI * 2;
        const d = s.r * (0.3 + rnd(q, 5) * 0.8);
        this.front.dot(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d * 0.6 - ph * 60, Math.round(5 * (1 - t)) + 1, q % 3 === 0 ? 0xffffff : q % 2 ? 0xfff1b8 : 0xf8bbd0);
      }
    }
  }

  /** いやしのはどう を使った体: 光の花がひらき、近くの仲間に光の粒が降りる */
  private drawBlooms(world: World, timeMs: number): void {
    this.blooms = this.blooms.filter((b) => timeMs - b.at < BLOOM_MS);
    const cfg = world.rules.activeSkills?.defs.find((d) => d.kind === 'healPulse')?.healPulse;
    for (const b of this.blooms) {
      const p = world.players.find((q) => q.id === b.id);
      if (!p) continue;
      const t = (timeMs - b.at) / BLOOM_MS;
      const f = Math.min(BLOOM_FRAMES - 1, Math.floor(t * BLOOM_FRAMES));
      this.front.image(`lt-bloom-${f}`, this.frontDepth + 0.015).setPosition(p.x, p.y - BODY_Y).setScale(2).setRotation(0);
      for (const q of world.players) {
        if (q.down || !cfg || Math.hypot(q.x - p.x, q.y - p.y) > cfg.allyRadius) continue;
        for (let k = 0; k < 8; k++) {
          const ph = (t * 1.4 + rnd(k, q.id)) % 1;
          this.front.dot(q.x + (rnd(k, 3) - 0.5) * 36, q.y - 70 + ph * 70, Math.round(6 - ph * 3), k % 2 ? 0xf8bbd0 : 0xffffff);
        }
      }
    }
  }

  /** 押している間（本人）: ミストボール は 5 本の玉の道、りゅうのはどう は波動の道、いやしのはどう は光が届く霧 */
  private drawAim(world: World, timeMs: number, localId: number, aimSlot: number | null): void {
    const me = world.players.find((p) => p.id === localId);
    const slot = aimSlot !== null ? me?.skills?.[aimSlot] : undefined;
    if (!me || !slot || me.down) return;
    const def = world.rules.activeSkills?.defs[slot.skill];
    const pm = def && def.move >= 0 ? me.moves.find((m) => m.move === def.move) : undefined;
    if (!def || !pm) return;
    const { st, sc } = skillMoveStats(world, me, pm);
    const range = st.range;
    const col = slot.charges > 0 ? 0xf48fb1 : 0x6d5a62;
    const [fx, fy] = aimOf(me);
    const step = 18;
    const off = (timeMs / 15) % step;
    if (def.mistBall) {
      const n = Math.max(1, st.count);
      const heading = Math.atan2(fy, fx);
      for (let k = 0; k < n; k++) {
        const a = heading + (n > 1 ? (k / (n - 1) - 0.5) * ((def.mistBall.spreadDegrees * Math.PI) / 180) : 0);
        for (let d = 24 + off; d < range; d += step) this.front.dot(me.x + Math.cos(a) * d, me.y + Math.sin(a) * d, 4, col);
      }
      return;
    }
    if (def.dragonPulse) {
      const w = sc.size;
      for (const side of [-1, 1]) for (let d = 20 + off; d < range; d += step) this.front.dot(me.x + fx * d - fy * w * side, me.y + fy * d + fx * w * side, 4, 0x7986cb);
      return;
    }
    if (def.healPulse) {
      // 光が届く霧に印
      const mb = world.rules.activeSkills?.defs.find((d) => d.kind === 'mistBall')?.move ?? -1;
      const pr = world.projectiles;
      for (let i = 0; i < pr.count; i++) {
        if (pr.move[i] !== mb || pr.owner[i] !== me.id || pr.stage[i] !== 1 || pr.angle[i] !== 0) continue;
        if (Math.hypot(pr.x[i]! - me.x, pr.y[i]! - me.y) > def.healPulse.mistRange) continue;
        for (let q = 0; q < 8; q++) {
          const a = (q / 8) * Math.PI * 2 + timeMs / 300;
          this.front.dot(pr.x[i]! + Math.cos(a) * 22, pr.y[i]! - 12 + Math.sin(a) * 12, 4, slot.charges > 0 ? 0xfff1b8 : 0x6d5a62);
        }
      }
    }
  }
}
