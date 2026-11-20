import Phaser from 'phaser';
import type { World } from '../../sim/world';
import type { SkillUsedEvent } from '../../sim/events';
import { moltresAim } from '../../sim/activeSkills';
import { DotPool, c, makeTexture, on, rnd, shade } from './dotArt';

/**
 * 遊べるホウオウの技の絵（07 の322章。ミュウツーの サイコブレイク・ルギアの水準で、1 ドットずつ計算した不透明のドット絵）:
 * - せいなるほのお: 口の前で青白い炎がふくらみ、青白い炎弾（白い芯・青い炎の舌）が尾を引いて飛ぶ → 着弾で青白い爆発（白い閃光・青い炎の輪・炎の舌）→
 *   まわりへ飛び火が弧を描いて落ち、小さな青白い火が揺れて燃える。使った後 8 秒は聖炎: 体のまわりを青白い炎の粒が昇り、ほかの技の見た目が変わる
 * - ゴッドバード: 炎の鳥の姿で楕円を描いて回り、戻ってくる。通った所は燃える場所（橙の火。聖炎の間は青白い火）が並んで揺れる
 * - じこさいせい: 虹色の羽が舞い上がって体を包む。聖炎の間は、羽がまわりの味方にも降り、倒れている味方には虹の光の柱が立つ
 * - かぜおこし: 金色の三日月の風
 * 薄さ・消え際はディザ（半透明の塗りは使わない）。画面全体は光らせない。画面は揺らさない
 */

const ORB = 40;
const ORB_FRAMES = 6;
const BLAST = 128;
const BLAST_FRAMES = 8;
const FLAME_W = 24;
const FLAME_H = 36;
const FLAME_FRAMES = 4;
const BIRD_W = 64;
const BIRD_H = 40;
const BIRD_FRAMES = 3;
const FEATHER_W = 10;
const FEATHER_H = 20;
const FEATHER_COLS = [0xef5350, 0xffa726, 0xffee58, 0x66bb6a, 0x42a5f5, 0xab47bc];
const PILLAR_W = 32;
const PILLAR_H = 128;
const GUST = 24;
const GUST_FRAMES = 3;
const BLAST_MS = 720;
const REBIRTH_MS = 1000;
const POP_MS = 260;
/** ホウオウの絵の体の中心の高さ（足元からの上。大きく、飛んでいる） */
const BODY_Y = 44;

const FIRE = [0x6e1003, 0xb92207, 0xec4a0a, 0xff8412, 0xffbd3d, 0xfff0b8];
const HOLY = [0x0f2a6b, 0x1f4fb8, 0x3d7fe8, 0x8fc4ff, 0xd8ecff, 0xffffff];
/** 青白い炎（地面で燃える火。深い青の体に、根元の芯だけ白い） */
const HOLY_FIRE = [0x0a1f5c, 0x173fa8, 0x2f6fe0, 0x5aa0ff, 0xa8d4ff, 0xffffff];

type Flight = { ox: number; oy: number; tx: number; ty: number; total: number };
type Fx = { x: number; y: number; r: number; at: number; seed: number };

export class HoohPlayer {
  private built = false;
  private readonly pool: DotPool;
  private readonly front: DotPool;
  private readonly floor: DotPool;
  private flights = new Map<number, Flight>();
  private embers = new Map<number, { ox: number; oy: number; total: number }>();
  private loops = new Map<number, { sx: number; sy: number; trail: { x: number; y: number }[] }>();
  private blasts: Fx[] = [];
  private pops: Fx[] = [];
  private rebirths: { id: number; at: number; sacred: boolean }[] = [];
  private gusts = new Map<number, { x: number; y: number }>();
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

  /** じこさいせい を使った（本人のブラウザのイベント） */
  onSkillUsed(ev: SkillUsedEvent, world: World, timeMs: number): void {
    const p = world.players.find((q) => q.id === ev.playerId);
    this.rebirths.push({ id: ev.playerId, at: timeMs, sacred: !!p?.sacredFlame && world.tick < p.sacredFlame.untilTick });
  }

  private build(): void {
    if (this.built) return;
    this.built = true;
    const s = this.scene;
    // 青白い炎弾: 白い芯、青い炎の舌が外へ揺れて回る（6 コマ）
    for (let f = 0; f < ORB_FRAMES; f++) {
      const ph = (f / ORB_FRAMES) * Math.PI * 2;
      makeTexture(s, `ho-orb-${f}`, ORB, ORB, (x, y) => {
        const cx = (ORB - 1) / 2;
        const nx = (x - cx) / (ORB / 2);
        const ny = (y - cx) / (ORB / 2);
        const a = Math.atan2(ny, nx);
        const r = Math.hypot(nx, ny);
        const R = 0.62 + 0.18 * Math.max(0, Math.sin(a * 6 + ph)) + 0.08 * Math.sin(a * 11 - ph * 2);
        if (r > R) return 0;
        const k = r / R;
        if (k > 0.82 && !on((1 - k) * 6, x + f, y)) return 0;
        return shade(HOLY, 1.05 - k * 0.8, x, y);
      });
    }
    // 青白い爆発: 白い閃光 → 青い炎の輪（炎の舌が外へ）→ 崩れて火の粉（8 コマ）
    for (let f = 0; f < BLAST_FRAMES; f++) {
      const t = f / (BLAST_FRAMES - 1);
      makeTexture(s, `ho-blast-${f}`, BLAST, BLAST, (x, y) => {
        const cx = (BLAST - 1) / 2;
        const dx = x - cx;
        const dy = y - cx;
        const r = Math.hypot(dx, dy) / (BLAST / 2);
        if (r > 1) return 0;
        const a = Math.atan2(dy, dx);
        if (t < 0.3 && r < 0.3 * (1 - t * 2.4)) return c(0xffffff);
        const R = 0.28 + 0.62 * Math.sqrt(t);
        const tongue = 0.12 * Math.max(0, Math.sin(a * 9 + f * 1.3)) * (1 - t * 0.6);
        const fade = 1 - Math.max(0, t - 0.45) / 0.55;
        const broken = t > 0.45 && rnd(Math.floor(a * 12), f) < (t - 0.45) * 1.6;
        // 炎の輪（太さに炎の舌）
        const inner = R - 0.08 - (1 - t) * 0.08;
        if (r > inner && r < R + tongue && !broken) {
          const k = (r - inner) / Math.max(0.01, R + tongue - inner);
          return shade(HOLY, 1.05 - k * 0.75, x, y);
        }
        if (r > R + tongue && r < R + tongue + 0.1 && rnd(x * 5 + f, y) > 0.94 && fade > 0.2) return c(0xd8ecff);
        return 0;
      });
    }
    // 燃える火（地面の小さな炎。下が太く上へ揺れる。橙と青白の 2 色。4 コマ）
    for (const [key, cols] of [['ho-fire', FIRE], ['ho-holy', HOLY_FIRE]] as const) {
      for (let f = 0; f < FLAME_FRAMES; f++) {
        makeTexture(s, `${key}-${f}`, FLAME_W, FLAME_H, (x, y) => {
          const t = 1 - y / (FLAME_H - 1);
          const cx0 = (FLAME_W - 1) / 2;
          // 根元: 丸くふくらんだ炎のかたまり
          const by = (FLAME_H - 1) * 0.82;
          const base = 1 - Math.hypot((x - cx0) / (FLAME_W * 0.42), (y - by) / (FLAME_H * 0.2));
          // 舌: 3 本がうねって上へ。先は丸く、左右へ巻く
          let tongue = -1;
          for (const [o, h, ph] of [[-0.22, 0.72, 0.0], [0, 1, 1.3], [0.24, 0.62, 2.6]] as const) {
            if (t > h || t < 0.12) continue;
            const tt = t / h;
            const cx = cx0 + o * FLAME_W * (1 - tt * 0.5) + Math.sin(tt * 6 + f * 1.6 + ph) * tt * 3.2;
            const w = FLAME_W * 0.2 * Math.sqrt(Math.max(0, 1 - tt)) * (0.9 + 0.2 * Math.sin(tt * 11 + f * 2 + ph)) + 0.4;
            const d = 1 - Math.abs(x - cx) / w;
            if (d > 0) tongue = Math.max(tongue, d * (1 - tt * 0.7));
          }
          const k = Math.max(base, tongue);
          if (k <= 0) return 0;
          // 縁はちぎれる（ディザ）
          if (k < 0.25 && !on(k * 4, x + f, y)) return 0;
          // 芯（根元の真ん中）だけ明るく、上と外は暗い
          const core = Math.max(0, base) * 0.6 + Math.max(0, tongue) * 0.35;
          return shade(cols, (key === 'ho-holy' ? 0.08 : 0.18) + core * 0.9 + (t < 0.3 ? 0.1 : 0), x, y);
        });
      }
    }
    // 炎の鳥（右向き。虹の炎の翼。芯は白い光）3 コマ
    for (let f = 0; f < BIRD_FRAMES; f++) {
      makeTexture(s, `ho-bird-${f}`, BIRD_W, BIRD_H, (x, y) => {
        const u = x / (BIRD_W - 1);
        const v = (y - (BIRD_H - 1) / 2) / (BIRD_H / 2);
        const av = Math.abs(v);
        const body = u > 0.42 && av < (u > 0.82 ? (1 - u) * 0.9 : 0.12 + (u - 0.42) * 0.1);
        if (body) return u > 0.78 ? c(0xffffff) : shade(FIRE, 0.75 + u * 0.3, x, y);
        const lead = 0.66 - av * 0.32;
        const trail = 0.34 - av * 0.3 + Math.sin(av * 9 + f * 2.1) * 0.05 + Math.sin(av * 23 - f) * 0.025;
        if (av > 0.1 && av < 0.98 && u < lead && u > trail) {
          const k = (lead - u) / Math.max(0.01, lead - trail);
          if (k > 0.8 && !on((1 - k) * 5, x + f, y)) return 0;
          // 翼の縁は虹色の筋
          if (k > 0.62) return c(FEATHER_COLS[Math.floor(av * 6) % FEATHER_COLS.length]!);
          return shade(FIRE, 1.05 - k * 0.7 - av * 0.1, x, y);
        }
        // 長い尾（3 本。虹色の先）
        for (const [o, q] of [[-0.16, 0], [0, 1], [0.16, 2]] as const) {
          const cy = o + Math.sin(u * 12 + f * 2 + q) * 0.05;
          if (u < 0.44 && u > 0.02 + q * 0.03 && Math.abs(v - cy) < 0.03 + u * 0.12) return u < 0.15 ? c(FEATHER_COLS[(q * 2) % 6]!) : shade(FIRE, 0.35 + u * 1.3, x, y);
        }
        return 0;
      });
    }
    // 虹の羽（縦長の羽。軸は白、羽毛は色。色ごとに作る）
    FEATHER_COLS.forEach((col, i) => {
      makeTexture(s, `ho-feather-${i}`, FEATHER_W, FEATHER_H, (x, y) => {
        const t = y / (FEATHER_H - 1);
        const w = 4.2 * Math.sin(Math.PI * Math.min(1, t * 1.05)) + 0.2;
        const d = Math.abs(x - (FEATHER_W - 1) / 2);
        if (d < 0.6 && t > 0.05) return c(0xfff8e1);
        if (d > w) return 0;
        return d > w - 1 ? c(col) : (x + y) % 3 === 0 ? c(0xffffff) : c(col);
      });
    });
    // 虹の光の柱（倒れた味方を起こす。芯は白、外へ虹の色の縞が上へ流れる）
    makeTexture(s, 'ho-pillar', PILLAR_W, PILLAR_H, (x, y) => {
      const k = Math.abs(x - (PILLAR_W - 1) / 2) / (PILLAR_W / 2);
      const up = 1 - y / PILLAR_H;
      if (k > 1 - up * 0.4) return 0;
      if (!on(1.1 - up * 0.7, x, y)) return 0;
      if (k < 0.3) return c(0xffffff);
      return c(FEATHER_COLS[Math.floor(((y / 10) + k * 3)) % FEATHER_COLS.length]!);
    });
    // かぜおこし（金色の三日月の風。3 コマ）
    for (let f = 0; f < GUST_FRAMES; f++) {
      makeTexture(s, `ho-gust-${f}`, GUST, GUST, (x, y) => {
        const cx = (GUST - 1) / 2;
        const r = Math.hypot(x - cx, y - cx) / (GUST / 2);
        if (r > 1 || r < 0.35) return 0;
        const a = Math.atan2(y - cx, x - cx) + f * 0.7;
        const arm = Math.sin(a * 2 + r * 3);
        if (arm < 0.4) return 0;
        return arm > 0.85 ? c(0xfff3b0) : c(r < 0.7 ? 0xffd166 : 0xf2b630);
      });
    }
  }

  update(world: World, timeMs: number, localId: number, aimSlot: number | null): void {
    const moves = world.rules.moves;
    const sa = moves.findIndex((m) => m.key === 'sky-attack-hooh');
    const sf = moves.findIndex((m) => m.key === 'sacred-fire-hooh');
    const gu = moves.findIndex((m) => m.key === 'gust-hooh');
    const pr = world.projectiles;
    this.pool.begin();
    this.front.begin();
    this.floor.begin();
    let any = this.blasts.length > 0 || this.pops.length > 0 || this.rebirths.length > 0 || this.gusts.size > 0 || aimSlot !== null;
    for (const p of world.players) if (p.sacredFlame) any = true;
    for (let i = 0; i < pr.count && !any; i++) {
      const m = pr.move[i];
      if (m === sa || m === sf || m === gu) any = true;
    }
    if (!any) {
      this.pool.end();
      this.front.end();
      this.floor.end();
      return;
    }
    this.build();
    const liveF = new Set<number>();
    const liveE = new Set<number>();
    const liveL = new Set<number>();
    const liveG = new Set<number>();
    const f4 = Math.floor(timeMs / 80);
    for (let i = 0; i < pr.count; i++) {
      const m = pr.move[i];
      const id = pr.serial[i]!;
      const x = pr.x[i]!;
      const y = pr.y[i]!;
      const r = pr.radius[i]!;
      if (m === sf) {
        const owner = world.players.find((q) => q.id === pr.owner[i]);
        if (pr.stage[i] === 3) {
          if (pr.angle[i] === 1) {
            liveF.add(id);
            let fl = this.flights.get(id);
            if (!fl) {
              fl = { ox: (owner?.x ?? x) + (owner?.facingX ?? 0) * 30, oy: (owner?.y ?? y) - BODY_Y, tx: x, ty: y - 20, total: Math.max(0.05, pr.life[i]!) };
              this.flights.set(id, fl);
            }
            this.drawOrb(fl, pr.life[i]!, timeMs, id);
          } else {
            liveE.add(id);
            let em = this.embers.get(id);
            const fl = [...this.flights.values()][0];
            if (!em) {
              em = { ox: fl?.tx ?? x, oy: fl?.ty ?? y, total: Math.max(0.05, pr.life[i]!) };
              this.embers.set(id, em);
            }
            this.drawEmberFlight(em, x, y, pr.life[i]!, timeMs);
          }
        } else if (pr.stage[i] === 0) {
          if (!this.seen.has(id)) {
            this.seen.add(id);
            this.blasts.push({ x, y: y - 20, r, at: timeMs, seed: id });
          }
        } else {
          this.drawFlame('ho-holy', x, y, r, pr.life[i]!, pr.maxLife[i]!, timeMs, id);
        }
      } else if (m === sa) {
        if (pr.motion[i] === 1) {
          // 体の当たり（楕円をたどる）: 炎の鳥の姿と、後ろの炎の尾
          const owner = world.players.find((q) => q.id === pr.owner[i]);
          if (!owner) continue;
          liveL.add(id);
          let lp = this.loops.get(id);
          if (!lp) {
            lp = { sx: owner.x, sy: owner.y, trail: [] };
            this.loops.set(id, lp);
          }
          lp.trail.push({ x: owner.x, y: owner.y - BODY_Y });
          if (lp.trail.length > 14) lp.trail.shift();
          this.drawBird(lp.trail, r, timeMs, !!owner.sacredFlame && world.tick < owner.sacredFlame.untilTick);
        } else if (pr.stage[i] === 1) {
          this.drawFlame(pr.angle[i] === 1 ? 'ho-holy' : 'ho-fire', x, y, r, pr.life[i]!, pr.maxLife[i]!, timeMs, id);
        }
      } else if (m === gu && pr.stage[i] === 0) {
        liveG.add(id);
        this.gusts.set(id, { x, y });
        this.front.image(`ho-gust-${(f4 + id) % GUST_FRAMES}`, this.frontDepth - 0.01).setPosition(x, y).setScale((r * 2.4) / GUST).setRotation(timeMs / 90);
        for (let q = 1; q <= 3; q++) this.pool.dot(x - pr.vx[i]! * q * 0.025, y - pr.vy[i]! * q * 0.025, 5 - q, 0xffd166);
      }
    }
    for (const id of this.flights.keys()) if (!liveF.has(id)) this.flights.delete(id);
    for (const id of this.embers.keys()) if (!liveE.has(id)) this.embers.delete(id);
    for (const id of this.loops.keys()) if (!liveL.has(id)) this.loops.delete(id);
    for (const [id, g] of this.gusts) {
      if (liveG.has(id)) continue;
      this.gusts.delete(id);
      this.pops.push({ x: g.x, y: g.y, r: 0, at: timeMs, seed: id });
    }
    if (this.seen.size > 600) this.seen.clear();
    this.drawBlasts(timeMs);
    this.drawPops(timeMs);
    this.drawSacred(world, timeMs);
    this.drawRebirths(world, timeMs);
    this.drawAim(world, timeMs, localId, aimSlot);
    this.pool.end();
    this.front.end();
    this.floor.end();
  }

  /** 青白い炎弾: まっすぐ飛び、後ろに青い炎の尾 */
  private drawOrb(fl: Flight, life: number, timeMs: number, id: number): void {
    const t = Math.max(0, Math.min(1, 1 - life / fl.total));
    const x = fl.ox + (fl.tx - fl.ox) * t;
    const y = fl.oy + (fl.ty - fl.oy) * t;
    const len = Math.hypot(fl.tx - fl.ox, fl.ty - fl.oy) || 1;
    const dx = (fl.tx - fl.ox) / len;
    const dy = (fl.ty - fl.oy) / len;
    for (let s = 8; s < Math.min(len * t, 120); s += 5) {
      const fall = s / 120;
      if (rnd(Math.floor(s), id + Math.floor(timeMs / 60)) < fall * 0.55) continue;
      const w = Math.sin(s * 0.14 - timeMs / 50) * 6 * fall;
      this.pool.dot(x - dx * s - dy * w, y - dy * s + dx * w, Math.max(2, Math.round(11 - fall * 9)), fall < 0.25 ? 0xd8ecff : fall < 0.6 ? 0x8fc4ff : 0x1f4fb8);
    }
    this.front.image(`ho-orb-${Math.floor(timeMs / 60 + id) % ORB_FRAMES}`, this.frontDepth - 0.01).setPosition(x, y).setScale(1.8).setRotation(timeMs / 150);
  }

  /** 飛び火: 着弾点から落ちる所へ弧を描いて飛ぶ小さな青い火 */
  private drawEmberFlight(em: { ox: number; oy: number; total: number }, tx: number, ty: number, life: number, timeMs: number): void {
    // 炎弾が着くまでは見せない（残りが 0.4 秒より長い間）
    const span = Math.min(em.total, 0.4);
    if (life > span) return;
    const t = 1 - life / span;
    const x = em.ox + (tx - em.ox) * t;
    const y = em.oy + (ty - 10 - em.oy) * t - Math.sin(Math.PI * t) * 50;
    this.front.dot(x, y, 8, 0xd8ecff);
    this.front.dot(x, y, 4, 0xffffff);
    for (let q = 1; q <= 3; q++) this.front.dot(x - (tx - em.ox) * 0.04 * q, y + q * 4, 5 - q, 0x3d7fe8);
    void timeMs;
  }

  /** 燃える場所: 小さな炎が 2〜3 本揺れ、火の粉が昇る。消える前は小さくなる */
  private drawFlame(key: string, x: number, y: number, r: number, life: number, maxLife: number, timeMs: number, id: number): void {
    const k = Math.min(1, life / 0.4, (maxLife - life) / 0.12 + 0.3);
    const n = r > 30 ? 3 : 2;
    for (let q = 0; q < n; q++) {
      const ox = (q - (n - 1) / 2) * r * 0.55 + (rnd(q, id) - 0.5) * 8;
      const img = this.pool.image(`${key}-${(Math.floor(timeMs / 90) + q + id) % FLAME_FRAMES}`, this.frontDepth - 0.05);
      img.setOrigin(0.5, 1).setPosition(x + ox, y + 6 + (q % 2) * 4).setScale(((r * 0.9) / FLAME_W) * k * (q === 1 ? 1.15 : 0.9));
    }
    for (let q = 0; q < 3; q++) {
      const ph = (timeMs / 700 + rnd(q, id)) % 1;
      this.pool.dot(x + (rnd(q + 3, id) - 0.5) * r, y - ph * r * 1.6, 3, key === 'ho-holy' ? 0xd8ecff : 0xffbd3d);
    }
  }

  /** 炎の鳥: 今の位置に鳥の姿（進む向きへ回す）と、通った後ろの炎の尾（聖炎の間は青白い） */
  private drawBird(trail: { x: number; y: number }[], r: number, timeMs: number, sacred: boolean): void {
    const n = trail.length;
    if (n < 2) return;
    for (let k = 0; k < n - 1; k++) {
      const a = trail[k]!;
      const fall = 1 - k / (n - 1);
      for (let q = 0; q < 3; q++) {
        const t = q / 3;
        const b = trail[k + 1]!;
        this.pool.dot(a.x + (b.x - a.x) * t + (rnd(k * 3 + q, Math.floor(timeMs / 50)) - 0.5) * 10, a.y + (b.y - a.y) * t, Math.max(3, Math.round(14 * (1 - fall))), sacred ? (fall > 0.6 ? 0x1f4fb8 : 0x8fc4ff) : fall > 0.6 ? 0xb92207 : fall > 0.3 ? 0xff8412 : 0xffbd3d);
      }
    }
    const head = trail[n - 1]!;
    const prev = trail[n - 2]!;
    const rot = Math.atan2(head.y - prev.y, head.x - prev.x);
    this.front.image(`ho-bird-${Math.floor(timeMs / 60) % BIRD_FRAMES}`, this.frontDepth + 0.02).setPosition(head.x, head.y).setRotation(rot).setScale((r * 3.4) / BIRD_W);
  }

  /** 青白い爆発（8 コマ）と、飛び散る青い火の粉 */
  private drawBlasts(timeMs: number): void {
    this.blasts = this.blasts.filter((b) => timeMs - b.at < BLAST_MS);
    for (const b of this.blasts) {
      const t = (timeMs - b.at) / BLAST_MS;
      const f = Math.min(BLAST_FRAMES - 1, Math.floor(t * BLAST_FRAMES));
      this.front.image(`ho-blast-${f}`, this.frontDepth - 0.01).setPosition(b.x, b.y).setScale((b.r * 2.4) / BLAST).setRotation(b.seed);
      const tt = t * 0.72;
      for (let q = 0; q < 16; q++) {
        const a = (q / 16) * Math.PI * 2 + rnd(q, b.seed);
        const sp = b.r * (0.9 + rnd(q, b.seed + 1) * 0.8);
        const hh = (300 + rnd(q, b.seed + 2) * 200) * tt - 900 * tt * tt;
        if (hh < 0 && tt > 0.12) continue;
        this.front.dot(b.x + Math.cos(a) * sp * tt * 1.8, b.y + Math.sin(a) * sp * tt * 0.8 - Math.max(0, hh), q % 3 === 0 ? 6 : 4, q % 3 === 0 ? 0xffffff : q % 2 ? 0x8fc4ff : 0x3d7fe8);
      }
    }
  }

  /** かぜおこし が消えた所の小さな風 */
  private drawPops(timeMs: number): void {
    this.pops = this.pops.filter((p) => timeMs - p.at < POP_MS);
    for (const p of this.pops) {
      const t = (timeMs - p.at) / POP_MS;
      for (let q = 0; q < 5; q++) {
        const a = (q / 5) * Math.PI * 2 + p.seed + t * 3;
        this.front.dot(p.x + Math.cos(a) * (4 + t * 16), p.y + Math.sin(a) * (4 + t * 16), Math.round(4 * (1 - t)) + 1, q % 2 ? 0xfff3b0 : 0xffd166);
      }
    }
  }

  /** 聖炎の間: 体のまわりを青白い炎の粒が昇り、足元に青い炎の輪が揺れる */
  private drawSacred(world: World, timeMs: number): void {
    for (const p of world.players) {
      const sf = p.sacredFlame;
      if (!sf || world.tick >= sf.untilTick || p.down) continue;
      for (let q = 0; q < 12; q++) {
        const ph = (timeMs / 900 + rnd(q, p.id)) % 1;
        const a = q * 2.1 + timeMs / 400;
        const d = 34 + Math.sin(ph * 6 + q) * 6;
        this.front.dot(p.x + Math.cos(a) * d, p.y - BODY_Y * 0.4 - ph * 90, Math.round(9 - ph * 6), ph < 0.4 ? 0xd8ecff : ph < 0.7 ? 0x8fc4ff : 0x3d7fe8);
      }
      for (let q = 0; q < 6; q++) {
        const a = (q / 6) * Math.PI * 2 + timeMs / 600;
        const img = this.pool.image(`ho-holy-${(Math.floor(timeMs / 90) + q) % FLAME_FRAMES}`, this.frontDepth - 0.06);
        img.setOrigin(0.5, 1).setPosition(p.x + Math.cos(a) * 40, p.y + 8 + Math.sin(a) * 14).setScale(0.9);
      }
    }
  }

  /** じこさいせい: 虹色の羽が舞い上がって体を包む。聖炎の間は、まわりの味方にも羽が降り、倒れていた味方には虹の光の柱 */
  private drawRebirths(world: World, timeMs: number): void {
    this.rebirths = this.rebirths.filter((r) => timeMs - r.at < REBIRTH_MS);
    const cfg = world.rules.activeSkills?.defs.find((d) => d.kind === 'rebirth')?.rebirth;
    for (const rb of this.rebirths) {
      const p = world.players.find((q) => q.id === rb.id);
      if (!p) continue;
      const t = (timeMs - rb.at) / REBIRTH_MS;
      const targets = rb.sacred && cfg ? world.players.filter((q) => Math.hypot(q.x - p.x, q.y - p.y) <= cfg.allyRadius) : [p];
      for (const q of targets) {
        for (let k = 0; k < 12; k++) {
          const ph = (t * 1.2 + rnd(k, q.id)) % 1;
          const a = (k / 12) * Math.PI * 2 + t * 3 + q.id;
          const d = 46 * (1 - ph * 0.5);
          const img = this.front.image(`ho-feather-${k % FEATHER_COLS.length}`, this.frontDepth + 0.015);
          img.setPosition(q.x + Math.cos(a) * d, q.y - BODY_Y * 0.4 - 20 + Math.sin(a) * d * 0.4 - (q === p ? ph * 50 : (1 - ph) * -60 - 40)).setRotation(a + ph * 3).setScale(2 * (1 - t * 0.5));
        }
        if (q !== p && rb.sacred && t < 0.6) {
          this.pool.image('ho-pillar', this.frontDepth - 0.02).setOrigin(0.5, 1).setPosition(q.x, q.y + 8).setScale(1.3 * (1 - t / 0.6), 2);
        }
      }
    }
  }

  /** 押している間（本人）: ゴッドバード は楕円の道、せいなるほのお は炎弾の落ちる所 */
  private drawAim(world: World, timeMs: number, localId: number, aimSlot: number | null): void {
    const me = world.players.find((p) => p.id === localId);
    const slot = aimSlot !== null ? me?.skills?.[aimSlot] : undefined;
    if (!me || !slot || me.down) return;
    const def = world.rules.activeSkills?.defs[slot.skill];
    const aim = moltresAim(world, me, slot.skill);
    if (!def || !aim) return;
    const sacred = !!me.sacredFlame && world.tick < me.sacredFlame.untilTick;
    const col = slot.charges > 0 ? (sacred ? 0x8fc4ff : 0xff8412) : 0x6d5a4a;
    if (def.skyLoop && aim.path) {
      const pts = aim.path;
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1]!;
        const b = pts[k]!;
        const l = Math.hypot(b.x - a.x, b.y - a.y);
        for (let d = (timeMs / 15) % 18; d < l; d += 18) this.front.dot(a.x + ((b.x - a.x) * d) / l, a.y + ((b.y - a.y) * d) / l, 4, col);
      }
      return;
    }
    if (def.sacredFire && aim.x !== undefined && aim.y !== undefined && aim.r) {
      for (let k = 0; k < 28; k++) {
        const t = (k / 28) * Math.PI * 2 + timeMs / 900;
        this.front.dot(aim.x + Math.cos(t) * aim.r, aim.y + Math.sin(t) * aim.r * 0.6, 4, slot.charges > 0 ? 0x8fc4ff : 0x6d5a4a);
      }
    }
  }
}
