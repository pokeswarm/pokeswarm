import Phaser from 'phaser';
import { findEnemyIndex, type World } from '../../sim/world';
import { c, DOT, DotPool, makeTexture, on, rnd, shade } from './dotArt';

type Hz = World['hazards'][number];
type Body = { x: number; y: number; r: number };

interface Lingering {
  kind: 'impact' | 'crater';
  x: number;
  y: number;
  r: number;
  seed: number;
  startMs: number;
  goneMs: number;
}

const IMPACT_MS = 1400;
const CRATER_MS = 1800;
const FR = 8;
const BEAM_W = 48;
const BEAM_H = 60;
const FIRE = [0x7f1d00, 0xbf360c, 0xff3d00, 0xff6d00, 0xff9100, 0xffd180, 0xfff3e0];
const STONE = [0x2a2f33, 0x3d4448, 0x59636a, 0x7d878d, 0x9aa5ab];

/**
 * レックウザの技の絵（07 の288・292・297章）: ガリョウテンセイの旋回する影と緑の炎の急降下・光の柱と跳ね上がる石板、
 * りゅうせいぐんの燃える岩と着弾、しんそくの光の尾と空気の壁、ぼうふうの竜巻、はかいこうせんの光線。
 * 1 ドットずつ計算したドット絵のテクスチャで描く（半透明の塗りは使わない）。見た目だけ（当たりはシミュレーション）
 */
export class RayquazaSky {
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
    // 影（ディザの暗い楕円）と、落ちる所の緑の輪
    makeTexture(s, 'rq-shadow', 32, 14, (x, y) => {
      const r = Math.hypot((x - 15.5) / 16, (y - 6.5) / 7);
      if (r > 1) return 0;
      if (r > 0.72) return on(0.85, x, y) ? c(r > 0.88 ? 0x69f0ae : 0x00873e) : 0;
      return on(0.85 - r * 0.3, x, y) ? c(0x020405) : 0;
    });
    makeTexture(s, 'rq-ring', 48, 22, (x, y) => {
      const r = Math.hypot((x - 23.5) / 24, (y - 10.5) / 11);
      if (r > 1) return 0;
      if (r > 0.86) return c(0x69f0ae);
      if (Math.abs(r - 0.62) < 0.05) return on(0.6, x, y) ? c(0x00c853) : 0;
      return 0;
    });
    // 緑の炎をまとって降ってくる体（縦。下が頭）
    for (let f = 0; f < FR; f++) {
      const W = 40;
      const H = 120;
      makeTexture(s, `rq-comet-${f}`, W, H, (x, y) => {
        const t = (H - 1 - y) / H;
        const half = (W / 2) * (t < 0.12 ? Math.sqrt(t / 0.12) : 1 - (t - 0.12) * 0.95) * (0.85 + 0.15 * Math.sin(y * 0.4 + f));
        const dx = Math.abs(x - (W - 1) / 2);
        if (dx > half || half <= 0) return 0;
        const e = dx / half;
        const tongue = Math.sin(y * 0.5 + x * 0.8 + f * 1.4) > -0.2;
        if (t < 0.1 && e < 0.6) return c(0xffffff);
        if (e < 0.3 && t < 0.5) return c(0xccff90);
        if (e < 0.6) return c(t < 0.6 ? 0x69f0ae : 0x00e676);
        return tongue && on(1 - t * 0.7, x, y) ? c(0x00c853) : 0;
      });
    }
    // 着いた所の光の柱（下が太く上へ細る。消えていく 8 コマ）と衝撃の輪
    for (let f = 0; f < FR; f++) {
      const t = f / (FR - 1);
      const W = 40;
      const H = 160;
      makeTexture(s, `rq-pillar-${f}`, W, H, (x, y) => {
        const up = (H - 1 - y) / H;
        const half = (W / 2) * (1 - up) * (1 - t * 0.7);
        const dx = Math.abs(x - (W - 1) / 2);
        if (dx > half) return 0;
        const e = dx / Math.max(1, half);
        // 芯は塗りつぶし、外側だけディザで細る。消え際は外から
        const solid = e < 0.6 - t * 0.6;
        if (!solid && !on(1 - t - up * 0.4, x, y)) return 0;
        return c(e < 0.25 ? 0xffffff : e < 0.55 ? 0xb9f6ca : 0x00e676);
      });
      makeTexture(s, `rq-shock-${f}`, 96, 44, (x, y) => {
        const r = Math.hypot((x - 47.5) / 48, (y - 21.5) / 22);
        const d = Math.abs(r - (0.3 + 0.65 * t));
        if (d < 0.025 && on(1.1 - t, x, y)) return c(0xffffff);
        if (d < 0.08 && on(1 - t, x, y)) return c(0x00e676);
        return 0;
      });
      makeTexture(s, `rq-oshock-${f}`, 96, 44, (x, y) => {
        const r = Math.hypot((x - 47.5) / 48, (y - 21.5) / 22);
        const d = Math.abs(r - (0.3 + 0.65 * t));
        if (d < 0.025 && on(1.1 - t, x, y)) return c(0xfff3e0);
        if (d < 0.08 && on(1 - t, x, y)) return c(0xff9100);
        return 0;
      });
    }
    // 跳ね上がる石板（3 種）: 上の面が明るい
    for (let k = 0; k < 3; k++) {
      makeTexture(s, `rq-slab-${k}`, 16, 18, (x, y) => {
        const skew = (k - 1) * 0.15 * (17 - y);
        if (x < 1 + skew || x > 14 + skew) return 0;
        if (y < 3) return shade(STONE, 0.9, x, y);
        if (y > 16) return c(0x15181b);
        return shade(STONE, 0.45 + (rnd(x + k * 9, y) - 0.5) * 0.25, x, y);
      });
    }
    // りゅうせいぐんの流星（横。右が頭。尾は左へ）: 回る暗い岩、溶けた前の面、4 重の炎の尾、紫の光
    for (let f = 0; f < FR; f++) {
      const W = 96;
      const H = 40;
      makeTexture(s, `rq-meteor-${f}`, W, H, (x, y) => {
        const hx = W - 16;
        const hy = (H - 1) / 2;
        const dx = x - hx;
        const dy = y - hy;
        const r = Math.hypot(dx, dy);
        // 岩
        const rockR = 9 + 1.5 * Math.sin(Math.atan2(dy, dx) * 5 + f);
        if (r < rockR) {
          if (dx > 3) return c(r < 4 ? 0xffffff : 0xffab40);
          if (dx > -2) return c(0xd84315);
          return Math.abs(Math.sin((dx + dy) * 0.6 + f)) < 0.2 ? c(0xffd54f) : c(0x3a221a);
        }
        // 炎の衣と尾（左へ細る）
        const along = hx - x;
        if (along < -14) return 0;
        const tailHalf = along < 0 ? 15 - Math.abs(along) * 0.5 : 15 * (1 - along / 80) * (0.85 + 0.15 * Math.sin(along * 0.3 + f * 1.3));
        const e = Math.abs(dy) / Math.max(0.1, tailHalf);
        if (e > 1) {
          // 紫の光（ディザ）
          if (e < 1.35 && along < 30 && on(0.5, x, y)) return c(0x7c4dff);
          return 0;
        }
        if (e < 0.25 && along < 30) return c(0xfffde7);
        if (e < 0.5) return c(0xffd180);
        if (e < 0.75) return c(0xff9100);
        return on(1 - along / 90, x, y) ? c(0xff3d00) : 0;
      });
    }
    // 着弾の火の玉（もくもく広がって消える 8 コマ）
    for (let f = 0; f < FR; f++) {
      const t = f / (FR - 1);
      const S = 48;
      makeTexture(s, `rq-fire-${f}`, S, S, (x, y) => {
        let best = 99;
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + rnd(k, 1);
          const cx = S / 2 + Math.cos(a) * S * 0.18 * (0.5 + t);
          const cy = S / 2 + Math.sin(a) * S * 0.14 * (0.5 + t) - t * 6;
          best = Math.min(best, Math.hypot(x - cx, y - cy) / (S * (0.16 + 0.12 * t)));
        }
        if (best > 1) return 0;
        if (!on(1.15 - t, x, y)) return 0;
        return shade(t < 0.5 ? FIRE : [0x2b2526, 0x3e3436, 0x5d4f50, 0x7f1d00, 0xbf360c], 1 - best * 0.8 - t * 0.3, x, y);
      });
      // 焦げた穴と溶けたひび（冷えていく 8 コマ）
      makeTexture(s, `rq-crater-${f}`, 64, 30, (x, y) => {
        const nx = (x - 31.5) / 32;
        const ny = (y - 14.5) / 15;
        const r = Math.hypot(nx, ny);
        if (r > 1) return 0;
        if (r > 0.88) return on(0.9 - t * 0.6, x, y) ? c(0x4e3b30) : 0;
        const a = Math.atan2(ny, nx);
        const crack = Math.abs(Math.sin(a * 3.5 + r * 2)) < 0.12 && r > 0.15;
        if (crack && t < 0.8) return c(t < 0.4 ? 0xffab40 : 0xbf360c);
        return on(0.95 - t * 0.5, x, y) ? c(0x0d0a09) : 0;
      });
    }
    // しんそくの光の尾の 1 区切り（横につなぐ）と、前の空気の「く」の字
    makeTexture(s, 'rq-trail', 32, 24, (x, y) => {
      const v = Math.abs((y - 11.5) / 12);
      if (v < 0.2) return c(0xffffff);
      if (v < 0.45) return c(0xe8f5e9);
      if (v < 0.7) return c(0x69f0ae);
      if (v < 1 && on((1 - v) / 0.3, x, y)) return c(0x00c853);
      return 0;
    });
    makeTexture(s, 'rq-chev', 20, 32, (x, y) => {
      const d = Math.abs(x - (19 - Math.abs(y - 15.5) * 1.1));
      if (d < 1.5) return c(0xffffff);
      if (d < 2.8 && on(0.6, x, y)) return c(0xe0f7fa);
      return 0;
    });
    // 竜巻（8 コマ）: 下は細く上へ広がる風の体。斜めに巻き上がる白い帯
    for (let f = 0; f < FR; f++) {
      const W = 80;
      const H = 120;
      makeTexture(s, `rq-tornado-${f}`, W, H, (x, y) => {
        const t = 1 - y / H;
        const sway = Math.sin(t * 3 + f * 0.8) * 4 * t;
        const half = (W / 2) * (0.22 + 0.78 * t * t);
        const dx = x - (W - 1) / 2 - sway;
        if (Math.abs(dx) > half) return 0;
        const u = dx / half;
        const band = Math.sin(Math.asin(Math.max(-1, Math.min(1, u))) * 2 + t * 14 - (f / FR) * Math.PI * 2);
        if (band > 0.82) return c(Math.abs(u) < 0.7 ? 0xffffff : 0xe0f2f1);
        if (band > 0.55) return c(0xb9f6ca);
        if (Math.abs(u) > 0.9) return c(0x69f0ae);
        return on(0.35, x, y) ? c(0x80cbc4) : 0;
      });
    }
    // はかいこうせん: 光線の 1 区切り（橙の外側・黄・白い芯）、溜めの玉
    for (let f = 0; f < 2; f++) {
      makeTexture(s, `rq-beam-${f}`, BEAM_W, BEAM_H, (x, y) => {
        const v = Math.abs((y - (BEAM_H - 1) / 2) / (BEAM_H / 2)) + (f ? 0.04 * Math.sin((x / BEAM_W) * Math.PI * 4) : 0);
        const ring = Math.abs(((x + 6) % 24) - 12) < 1.2 && v < 0.85;
        if (v < 0.16) return c(0xffffff);
        if (ring) return c(0xfff3e0);
        if (v < 0.34) return c(0xfffde7);
        if (v < 0.56) return c(0xffd54f);
        if (v < 0.78) return c(0xff9100);
        if (v < 1 && on((1 - v) / 0.22, x, y)) return c(0xe65100);
        return 0;
      });
    }
    for (let f = 0; f < FR; f++) {
      const S = 32;
      makeTexture(s, `rq-borb-${f}`, S, S, (x, y) => {
        const dx = x - (S - 1) / 2;
        const dy = y - (S - 1) / 2;
        const r = Math.hypot(dx, dy) / (S / 2);
        const a = Math.atan2(dy, dx) + (f / FR) * (Math.PI / 4);
        const ray = Math.abs(Math.cos(a * 4)) > 0.93 && r < 1;
        if (r < 0.32) return c(0xffffff);
        if (r < 0.58) return c(0xffe082);
        if (r < 0.72) return c(0xff9100);
        if (ray) return c(0xffcc80);
        return 0;
      });
    }
  }

  update(world: World, timeMs: number): void {
    this.pool.begin();
    const moves = world.rules.stage.moves;
    if (world.hazards.some((h) => moves[h.move]?.id.startsWith('rayquaza-'))) this.build();
    const ray = this.rayquaza(world);
    const frame = Math.floor(timeMs / 70) % FR;
    const seen = new Set<string>();
    for (const hz of world.hazards) {
      const id = moves[hz.move]?.id ?? '';
      if (!id.startsWith('rayquaza-')) continue;
      const p = hz.activeTicks === undefined ? 1 - hz.ticksLeft / Math.max(1, hz.totalTicks) : 1;
      const key = `${id}:${hz.group ?? 0}:${Math.round(hz.x)}:${Math.round(hz.y)}`;
      if (id.startsWith('rayquaza-dragon-ascent')) {
        if (hz.activeTicks === undefined) this.drawAscent(hz, p, timeMs, frame);
        else {
          seen.add(key);
          if (!this.lingering.has(key)) this.lingering.set(key, { kind: 'impact', x: hz.x, y: hz.y, r: hz.radius, seed: rnd(hz.x, hz.y), startMs: timeMs, goneMs: 0 });
        }
      } else if (id === 'rayquaza-draco-meteor') {
        if (hz.activeTicks === undefined) this.drawMeteorFall(hz, p, ray, frame);
        else {
          seen.add(key);
          if (!this.lingering.has(key)) this.lingering.set(key, { kind: 'crater', x: hz.x, y: hz.y, r: hz.radius, seed: rnd(hz.x, hz.y), startMs: timeMs, goneMs: 0 });
        }
      } else if (id === 'rayquaza-extreme-speed') {
        if (hz.activeTicks === undefined) this.drawSpeedAim(hz, p, timeMs);
        else this.drawSpeedStreak(world, hz, timeMs);
      } else if (id === 'rayquaza-hurricane') {
        if (hz.activeTicks === undefined) this.drawWindGather(hz, p, timeMs);
        else this.drawVortex(hz, timeMs, frame);
      } else if (id === 'rayquaza-hyper-beam') {
        if (hz.activeTicks === undefined) this.drawBeamCharge(hz, ray, p, timeMs, frame);
        else this.drawBeam(world, hz, timeMs, frame);
      }
    }
    for (const [key, l] of this.lingering) {
      if (!seen.has(key) && l.goneMs === 0) l.goneMs = timeMs;
      const limit = l.kind === 'impact' ? IMPACT_MS : CRATER_MS;
      if (l.goneMs > 0 && timeMs - l.goneMs > limit) {
        this.lingering.delete(key);
        continue;
      }
      if (l.kind === 'impact') this.drawImpact(l, timeMs);
      else this.drawCrater(l, timeMs);
    }
    if (!world.legendary) this.lingering.clear();
    this.pool.end();
  }

  private rayquaza(world: World): Body | null {
    const e = world.enemies;
    for (let i = 0; i < e.count; i++) {
      if (e.hp[i]! <= 0) continue;
      if (world.rules.enemies.kinds[e.kind[i]!]?.id === 'legend-rayquaza') return { x: e.x[i]!, y: e.y[i]!, r: e.radius[i]! };
    }
    return null;
  }

  /**
   * ガリョウテンセイの予告: 空を旋回する長い体の影が地面をうねり、降りてくるほど小さく濃くなる。落ちる所に緑の輪。
   * 後半は、緑の炎をまとって空から真っ逆さまに降ってくる
   */
  private drawAscent(hz: Hz, p: number, timeMs: number, frame: number): void {
    const r = hz.radius;
    const spread = 1.9 - 0.9 * p;
    const turn = timeMs / 380;
    for (let k = 0; k < 16; k++) {
      const s = k / 15;
      const a = turn - s * 2.4;
      const rr = r * spread * (0.95 + 0.12 * Math.sin(s * 9 + timeMs / 200));
      const w = r * 0.5 * (1 - s * 0.7) * (0.7 + 0.3 * p);
      this.pool.image('rq-shadow', this.floorDepth).setPosition(hz.x + Math.cos(a) * rr, hz.y + Math.sin(a) * rr * 0.44).setScale((w * 2) / 32);
    }
    this.pool.image('rq-ring', this.floorDepth + 0.01).setPosition(hz.x, hz.y).setScale((r * 2 * (1 + (1 - p) * 0.6)) / 48);
    if (p > 0.55) {
      const t = (p - 0.55) / 0.45;
      const k = Math.pow(t, 1.5);
      const topY = hz.y - 950;
      const hx = hz.x + (1 - k) * 80;
      const hy = topY + (hz.y - topY) * k;
      this.pool.image(`rq-comet-${frame}`, this.topDepth).setOrigin(0.5, 1).setPosition(hx, hy + 30).setScale(DOT * 1.6).setRotation(-0.08);
    }
  }

  /** ガリョウテンセイが落ちた所: 緑の光の柱、3 重の衝撃の輪、土ぼこり、跳ね上がる石板 */
  private drawImpact(l: Lingering, timeMs: number): void {
    const age = timeMs - l.startMs;
    const t = Math.min(1, age / IMPACT_MS);
    if (age < 500) this.pool.image(`rq-pillar-${Math.min(FR - 1, Math.floor((age / 500) * FR))}`, this.depth).setOrigin(0.5, 1).setPosition(l.x, l.y).setScale((l.r * 2) / 40, DOT * 2.4);
    for (let k = 0; k < 3; k++) {
      const tt = (age - k * 130) / 620;
      if (tt <= 0 || tt >= 1) continue;
      this.pool.image(`rq-shock-${Math.min(FR - 1, Math.floor(tt * FR))}`, this.floorDepth + 0.01).setPosition(l.x, l.y).setScale((l.r * 6.4) / 96);
    }
    if (age < 900) {
      const tt = age / 900;
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2 + l.seed;
        const d = l.r * (1.0 + 1.6 * Math.sqrt(tt));
        this.pool.dot(l.x + Math.cos(a) * d, l.y + Math.sin(a) * d * 0.45 - tt * 20, 14 * (1 - tt), 0x8d8173);
      }
    }
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + l.seed * 3;
      const d = l.r * (0.8 + 0.25 * rnd(k, l.seed));
      const up = Math.min(1, age / 120) * (1 - Math.max(0, t - 0.7) / 0.3);
      if (up <= 0.05) continue;
      const shown = Math.max(1, Math.round(18 * up));
      this.pool.image(`rq-slab-${k % 3}`, this.depth).setOrigin(0.5, 1).setPosition(l.x + Math.cos(a) * d, l.y + Math.sin(a) * d * 0.45).setScale((l.r * 0.7) / 16).setCrop(0, 18 - shown, 16, shown).setRotation(Math.cos(a) * 0.3);
    }
  }

  /** りゅうせいぐんの予告: 口元から光の玉が空へ撃ち上がり、空から燃える岩が斜めに落ちてくる。落ちる所に影 */
  private drawMeteorFall(hz: Hz, p: number, ray: Body | null, frame: number): void {
    const seed = rnd(hz.x, hz.y);
    if (ray && p < 0.22) {
      const t = p / 0.22;
      const ox = ray.x + (seed - 0.5) * 60;
      const oy = ray.y - ray.r * 0.8 - t * 900;
      for (let j = 0; j < 5; j++) this.pool.dot(ox, oy + j * 22, 18 - j * 3, j < 2 ? 0xffffff : 0xb388ff);
    }
    this.pool.image('rq-shadow', this.floorDepth).setPosition(hz.x, hz.y).setScale((hz.radius * 2 * (0.45 + 0.55 * p)) / 32);
    if (p < 0.18) return;
    const t = Math.max(0, Math.min(1, (p - 0.18) / 0.82));
    const sx = hz.x - 260 - seed * 260;
    const sy = hz.y - 900;
    const k = Math.pow(t, 1.35);
    const x = sx + (hz.x - sx) * k;
    const y = sy + (hz.y - sy) * k;
    this.pool.image(`rq-meteor-${frame}`, this.topDepth).setOrigin(80 / 96, 0.5).setPosition(x, y).setRotation(Math.atan2(hz.y - sy, hz.x - sx)).setScale(DOT * 1.4);
  }

  /** りゅうせいぐんが落ちた所: 火の玉がもくもく広がり、衝撃の輪、岩のかけら。焦げた穴の溶けたひびが冷えていく */
  private drawCrater(l: Lingering, timeMs: number): void {
    const age = timeMs - l.startMs;
    const t = Math.min(1, age / CRATER_MS);
    this.pool.image(`rq-crater-${Math.min(FR - 1, Math.floor(t * FR))}`, this.floorDepth).setPosition(l.x, l.y).setScale((l.r * 2.1) / 64);
    if (age < 650) this.pool.image(`rq-fire-${Math.min(FR - 1, Math.floor((age / 650) * FR))}`, this.depth).setPosition(l.x, l.y - l.r * 0.5).setScale((l.r * 2.6) / 48);
    if (age < 450) this.pool.image(`rq-oshock-${Math.min(FR - 1, Math.floor((age / 450) * FR))}`, this.floorDepth + 0.01).setPosition(l.x, l.y).setScale((l.r * 5.6) / 96);
    if (age < 750) {
      const tt = age / 750;
      for (let k = 0; k < 10; k++) {
        const a = rnd(l.seed, k) * Math.PI * 2;
        const sp = l.r * (1.0 + rnd(k, l.seed) * 1.5);
        const px = l.x + Math.cos(a) * sp * tt;
        const py = l.y + Math.sin(a) * sp * tt * 0.45 - (l.r * 1.6 * tt - l.r * 2.2 * tt * tt);
        this.pool.dot(px, py, k % 3 === 0 ? 7 * (1 - tt) + 1 : 11 * (1 - tt * 0.5), k % 3 === 0 ? 0xffcc80 : k % 2 ? 0x3e2c24 : 0xe65100);
      }
    }
  }

  /** しんそくの予告: 道の両側の白い点の縁と、進む向きへ流れる「く」の字。出る所に縮む緑の点の輪 */
  private drawSpeedAim(hz: Hz, p: number, timeMs: number): void {
    const nx = -hz.dirY;
    const ny = hz.dirX;
    const w = hz.radius;
    for (let d = 0; d < hz.length; d += 26) {
      if (rnd(d, 7) > 0.35 + 0.65 * p) continue;
      for (const sg of [1, -1]) this.pool.dot(hz.x + hz.dirX * d + nx * w * sg, hz.y + hz.dirY * d + ny * w * sg, 5, 0xe0f7fa);
    }
    const off = (timeMs * 1.4) % 150;
    const rot = Math.atan2(hz.dirY, hz.dirX);
    for (let d = off; d < hz.length; d += 150) {
      if (p < 0.2) break;
      this.pool.image('rq-chev', this.depth).setPosition(hz.x + hz.dirX * d, hz.y + hz.dirY * d).setRotation(rot).setScale((w * 1.4) / 32);
    }
    const rr = w * (2.4 - 1.6 * p);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + timeMs / 200;
      this.pool.dot(hz.x + Math.cos(a) * rr, hz.y + Math.sin(a) * rr * 0.5, 6, 0x69f0ae);
    }
  }

  /** しんそく: 体の後ろに細って消える光の尾、前に押しのけられた空気の「く」の字、両側の速さの線と砂ぼこり */
  private drawSpeedStreak(world: World, hz: Hz, timeMs: number): void {
    const i = findEnemyIndex(world, hz.dasher);
    if (i < 0) return;
    const bx = world.enemies.x[i]!;
    const by = world.enemies.y[i]!;
    const dx = hz.dirX;
    const dy = hz.dirY;
    const nx = -dy;
    const ny = dx;
    const w = hz.radius;
    const run = Math.max(0, (bx - hz.x) * dx + (by - hz.y) * dy);
    const L = Math.min(run, 900);
    const rot = Math.atan2(dy, dx);
    const seg = 32 * DOT;
    for (let d = 0; d < L; d += seg) {
      const k = 1 - d / Math.max(1, L);
      this.pool.image('rq-trail', this.depth).setOrigin(0, 0.5).setRotation(rot + Math.PI).setPosition(bx - dx * d, by - dy * d).setScale(DOT, ((w * 2.4) / 24) * (0.3 + 0.7 * k));
    }
    this.pool.image('rq-chev', this.topDepth).setPosition(bx + dx * w * 1.4, by + dy * w * 1.4).setRotation(rot).setScale((w * 3) / 32);
    for (let k = 0; k < 14; k++) {
      const side = (rnd(k, 3) - 0.5) * 2 * w * 2.6;
      const t = ((timeMs / 160 + rnd(k, 9)) % 1 + 1) % 1;
      const d = t * Math.min(L, 700);
      const sx = bx - dx * d + nx * side;
      const sy = by - dy * d + ny * side;
      for (let j = 0; j < 4; j++) this.pool.dot(sx - dx * j * 18, sy - dy * j * 18, 4, k % 3 ? 0xffffff : 0xb9f6ca);
    }
    for (let k = 0; k < 8; k++) {
      const t = ((timeMs / 300 + k / 8) % 1 + 1) % 1;
      const sgn = k % 2 ? 1 : -1;
      const d = 40 + t * 220;
      const out = w * (0.9 + t * 1.6);
      this.pool.dot(bx - dx * d + nx * out * sgn, by - dy * d + ny * out * sgn - t * 20, 16 * (1 - t) + 2, 0x8d8173);
    }
  }

  /** ぼうふうの溜め: まわりの風（白い点の筋）が渦を巻いて集まる */
  private drawWindGather(hz: Hz, p: number, timeMs: number): void {
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + timeMs / 300;
      const d = hz.radius * (2.6 - 2.0 * (((timeMs / 600 + k / 10) % 1 + 1) % 1));
      const x = hz.x + Math.cos(a) * d;
      const y = hz.y + Math.sin(a) * d * 0.6;
      for (let j = 0; j < 4; j++) this.pool.dot(x + Math.cos(a + 1.6) * j * 10, y + Math.sin(a + 1.6) * j * 6, 6 * (0.6 + 0.4 * p), 0xe0f2f1);
    }
  }

  /** ぼうふう: 進む竜巻。足もとの土ぼこりと、巻き上げられて回る砂・小石・石板のかけら */
  private drawVortex(hz: Hz, timeMs: number, frame: number): void {
    const r = hz.radius;
    const H = r * 2.8;
    this.pool.image('rq-shadow', this.floorDepth).setPosition(hz.x, hz.y).setScale((r * 2.2) / 32);
    for (let k = 0; k < 12; k++) {
      const t = ((timeMs / 700 + k / 12) % 1 + 1) % 1;
      const a = timeMs / 160 + k * 0.52;
      const d = r * (0.5 + 0.9 * t);
      this.pool.dot(hz.x + Math.cos(a) * d, hz.y + Math.sin(a) * d * 0.42 - t * 16, 16 * (1 - t) + 2, 0xa1978a);
    }
    this.pool.image(`rq-tornado-${frame}`, this.depth).setOrigin(0.5, 1).setPosition(hz.x, hz.y + 6).setScale((r * 2.6) / 80, H / 120);
    for (let k = 0; k < 18; k++) {
      const t = ((timeMs / 900 + rnd(k, 5)) % 1 + 1) % 1;
      const a = timeMs / 150 + k * 1.3;
      const rw = r * (0.35 + 0.95 * t);
      const x = hz.x + Math.cos(a) * rw;
      const y = hz.y - t * H + Math.sin(a) * rw * 0.25;
      if (k % 6 === 0) this.pool.image(`rq-slab-${k % 3}`, Math.sin(a) > 0 ? this.topDepth : this.depth - 0.01).setPosition(x, y).setScale(DOT * 0.7).setRotation(timeMs / 90 + k);
      else this.pool.dot(x, y, Math.sin(a) > 0 ? 9 : 6, k % 6 === 3 ? 0x4f7a3a : k % 2 ? 0x8d8173 : 0xbdb3a4);
    }
  }

  /** はかいこうせんの溜め: 口元に光が集まり、橙の玉が育つ。狙う向きに点線 */
  private drawBeamCharge(hz: Hz, ray: Body | null, p: number, timeMs: number, frame: number): void {
    for (let d = 40; d < hz.length; d += 26) if (((d / 26) | 0) % 2 === 0 && rnd(d, 2) < 0.4 + 0.6 * p) this.pool.dot(hz.x + hz.dirX * d, hz.y + hz.dirY * d, 5, 0xffe082);
    const mx = ray?.x ?? hz.x;
    const my = (ray?.y ?? hz.y) - (ray?.r ?? 40) * 0.8;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + rnd(k, 2);
      const t = ((timeMs / 450 + rnd(k, 7)) % 1 + 1) % 1;
      const d = 200 * (1 - t);
      this.pool.dot(mx + Math.cos(a) * d, my + Math.sin(a) * d * 0.8, 8 + 6 * t, 0xfff8e1);
    }
    this.pool.image(`rq-borb-${frame}`, this.topDepth).setPosition(mx, my).setScale(DOT * (0.5 + 1.6 * p));
  }

  /** はかいこうせん: 光線の区切りをつないで流す（光の輪が先へ流れる）。マップの端に当たる所で火の玉と火花 */
  private drawBeam(world: World, hz: Hz, timeMs: number, frame: number): void {
    const dx = hz.dirX;
    const dy = hz.dirY;
    let len = hz.length;
    const ar = world.arena;
    if (ar) {
      const tx = dx > 0 ? (ar.x + ar.halfWidth - hz.x) / dx : dx < 0 ? (ar.x - ar.halfWidth - hz.x) / dx : Infinity;
      const ty = dy > 0 ? (ar.y + ar.halfHeight - hz.y) / dy : dy < 0 ? (ar.y - ar.halfHeight - hz.y) / dy : Infinity;
      len = Math.max(0, Math.min(len, tx, ty));
    }
    const rot = Math.atan2(dy, dx);
    const seg = BEAM_W * DOT;
    const sy = (hz.radius * 2 * 1.5) / BEAM_H;
    const off = (timeMs * 1.6) % seg;
    const f = Math.floor(timeMs / 90) % 2;
    for (let d = -seg + off; d < len; d += seg) {
      const dd = Math.max(0, d);
      this.pool.image(`rq-beam-${f}`, this.depth).setOrigin(0, 0.5).setRotation(rot).setScale(DOT, sy).setPosition(hz.x + dx * dd, hz.y + dy * dd);
    }
    this.pool.image(`rq-borb-${frame}`, this.topDepth).setPosition(hz.x, hz.y).setScale((hz.radius * 3.2) / 32);
    if (len < hz.length) {
      const x1 = hz.x + dx * len;
      const y1 = hz.y + dy * len;
      this.pool.image(`rq-fire-${frame % 4}`, this.topDepth).setPosition(x1, y1).setScale((hz.radius * 4) / 48);
      for (let k = 0; k < 12; k++) {
        const t = ((timeMs / 380 + rnd(k, 13)) % 1 + 1) % 1;
        const a = Math.atan2(-dy, -dx) + (rnd(13, k) - 0.5) * 2.6;
        const d = hz.radius * 2 * (0.6 + 2.6 * t);
        this.pool.dot(x1 + Math.cos(a) * d, y1 + Math.sin(a) * d + 60 * t * t, 10 * (1 - t) + 2, k % 3 ? 0xffcc80 : 0xffffff);
      }
    }
  }
}
