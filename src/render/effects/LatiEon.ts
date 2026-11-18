import Phaser from 'phaser';
import { findEnemyIndex, type World } from '../../sim/world';
import { c, DOT, DotPool, makeTexture, on, rnd } from './dotArt';

type Hz = World['hazards'][number];
type Body = { x: number; y: number; r: number };

interface Lingering {
  kind: 'burst';
  x: number;
  y: number;
  r: number;
  startMs: number;
}

const FR = 8;
const BURST_MS = 520;
const BEAM_W = 48;
const BEAM_H = 48;
/** 兄妹の色（ラティアスは赤、ラティオスは青） */
const RED = [0x7f0f1f, 0xc62828, 0xef5350, 0xff8a80, 0xffcdd2, 0xffffff];
const BLUE = [0x0d2a6b, 0x1565c0, 0x42a5f5, 0x90caf9, 0xe3f2fd, 0xffffff];

/**
 * ラティアス・ラティオスの技の絵（07 の298章）: ミストボールの霧の玉・りゅうのいぶき・いやしのはどう・ひかりのくっせつ・
 * ドラゴンダイブの光の尾・ラスターパージの光の爆発・りゅうのはどうの光線・りゅうのまいの炎。
 * 1 ドットずつ計算したドット絵のテクスチャで描く（半透明の塗りは使わない）。見た目だけ（当たりはシミュレーション）
 */
export class LatiEon {
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
    for (let f = 0; f < FR; f++) {
      // ミストボール: 桃色の玉に、白い霧の渦
      const S = 26;
      makeTexture(s, `la-mist-${f}`, S, S, (x, y) => {
        const dx = x - (S - 1) / 2;
        const dy = y - (S - 1) / 2;
        const r = Math.hypot(dx, dy) / (S / 2);
        if (r > 1) return 0;
        const sw = Math.sin(Math.atan2(dy, dx) * 2 + r * 6 - (f / FR) * Math.PI * 2);
        if (r < 0.3) return c(0xffffff);
        if (sw > 0.55 && r < 0.85) return c(0xfce4ec);
        if (r < 0.7) return c(0xff8a80);
        if (r < 0.9) return c(0xe57373);
        return on((1 - r) * 8, x, y) ? c(0xffcdd2) : 0;
      });
      // ラスターパージ: 白い光が十字に弾け、青い光の輪が広がる（消える 8 コマ）
      const t = f / (FR - 1);
      const B = 56;
      makeTexture(s, `la-burst-${f}`, B, B, (x, y) => {
        const dx = x - (B - 1) / 2;
        const dy = y - (B - 1) / 2;
        const r = Math.hypot(dx, dy) / (B / 2);
        if (r > 1) return 0;
        const cross = (Math.abs(dx) < 2.2 - t * 2 || Math.abs(dy) < 2.2 - t * 2) && r < 1 - t * 0.4;
        const diag = Math.abs(Math.abs(dx) - Math.abs(dy)) < 1.2 && r < 0.6 - t * 0.4;
        if (r < 0.35 * (1 - t)) return c(0xffffff);
        if (cross || diag) return c(t < 0.5 ? 0xffffff : 0xe3f2fd);
        const ring = Math.abs(r - (0.3 + 0.65 * t)) < 0.08;
        if (ring && on(1.1 - t, x, y)) return c(0x64b5f6);
        if (r < 0.3 + 0.65 * t && on(0.4 * (1 - t), x, y)) return c(0x90caf9);
        return 0;
      });
      // 落ちる所の印（青白い輪）
      // ひかりのくっせつ: 縦の光の帯がゆらめく、虹色のかげろう
      const RW = 32;
      const RH = 56;
      makeTexture(s, `la-refract-${f}`, RW, RH, (x, y) => {
        const nx = (x - (RW - 1) / 2) / (RW / 2);
        const ny = (y - (RH - 1) / 2) / (RH / 2);
        if (nx * nx + ny * ny > 1) return 0;
        const band = Math.sin(x * 0.9 + Math.sin(y * 0.2 + f) * 2);
        if (band < 0.85) return 0;
        const cols = [0xff8a80, 0xffe082, 0xb9f6ca, 0x80d8ff, 0xb388ff];
        return c(cols[Math.floor((y / RH) * cols.length + f) % cols.length]!);
      });
      // りゅうのいぶき: 口から開く扇の息（左が口。渦巻く青紫の炎と光の粒）
      const BW = 96;
      const BH = 64;
      makeTexture(s, `la-breath-${f}`, BW, BH, (x, y) => {
        const dx = x;
        const dy = y - (BH - 1) / 2;
        const a = Math.atan2(dy, Math.max(1, dx));
        const r = dx / BW;
        if (Math.abs(a) > 0.55 || r > 1) return 0;
        // 口から吹き出す息の塊（丸い塊が外へ流れ、大きくなる。塊の間はすき間）
        let best = 99;
        let core = 0;
        for (let k = 0; k < 9; k++) {
          const along = (((k / 9 + f / FR / 2) % 1) + 0.04) * BW;
          const side = (rnd(k, 3) - 0.5) * along * 0.75;
          const rr = 4 + along * 0.2;
          const d = Math.hypot(dx - along, dy - side) / rr;
          if (d < best) {
            best = d;
            core = along / BW;
          }
        }
        if (best > 1) return rnd(x + f * 7, y) > 0.992 ? c(0xffffff) : 0;
        // 塊の中: 芯が明るく、外ほど暗い紫。遠い塊ほどディザで薄れる
        if (!on(1.25 - core * 0.7, x, y) && best > 0.55) return 0;
        if (best < 0.35) return c(core < 0.5 ? 0xf3e5f5 : 0xce93d8);
        if (best < 0.7) return c(0x9575cd);
        return c(0x5e35b1);
      });
      // いやしのはどう: 桃色と白の波の輪（広がって消える）
      makeTexture(s, `la-heal-${f}`, 80, 40, (x, y) => {
        const r = Math.hypot((x - 39.5) / 40, (y - 19.5) / 20);
        const d = Math.abs(r - (0.25 + 0.7 * t));
        if (d < 0.03 && on(1.1 - t, x, y)) return c(0xffffff);
        if (d < 0.08 && on(1 - t, x, y)) return c(0xf48fb1);
        return 0;
      });
      // りゅうのまい: 体のまわりを昇る青と赤の炎の舌
      const W = 56;
      const H = 64;
      makeTexture(s, `la-dance-${f}`, W, H, (x, y) => {
        const nx = (x - (W - 1) / 2) / (W / 2);
        const tt = 1 - y / H;
        const edge = Math.abs(Math.abs(nx) - (0.72 + 0.12 * Math.sin(tt * 5 + f * 0.8)));
        const tongue = Math.sin(x * 0.9 + f * 1.3 + tt * 3) > 0.15;
        if (edge < 0.15 && tongue && on(1 - tt * 0.85, x, y)) return c(edge < 0.06 ? 0xe3f2fd : nx < 0 ? 0x42a5f5 : 0xef5350);
        return 0;
      });
      // 溜めの玉（青紫）
      const O = 28;
      makeTexture(s, `la-orb-${f}`, O, O, (x, y) => {
        const dx = x - (O - 1) / 2;
        const dy = y - (O - 1) / 2;
        const r = Math.hypot(dx, dy) / (O / 2);
        if (r > 1) return 0;
        const sw = Math.sin(Math.atan2(dy, dx) * 3 + r * 7 - (f / FR) * Math.PI * 2);
        if (r < 0.3) return c(0xffffff);
        if (r < 0.62) return c(sw > 0.3 ? 0xb3e5fc : 0x7986cb);
        if (r < 0.88) return c(sw > 0.4 ? 0x7e57c2 : 0x3949ab);
        return on((1 - r) * 8, x, y) && sw > -0.2 ? c(0x5e35b1) : 0;
      });
    }
    makeTexture(s, 'la-mark', 48, 22, (x, y) => {
      const r = Math.hypot((x - 23.5) / 24, (y - 10.5) / 11);
      if (r > 1) return 0;
      if (r > 0.86) return c(0x90caf9);
      return on(0.2 * r, x, y) ? c(0x0d2a6b) : 0;
    });
    // りゅうのはどう: 光線の 1 区切り（紺の外側・青紫・水色・白い芯。らせんの筋）
    for (let f = 0; f < 2; f++) {
      makeTexture(s, `la-pulse-${f}`, BEAM_W, BEAM_H, (x, y) => {
        const yy = (y - (BEAM_H - 1) / 2) / (BEAM_H / 2);
        const v = Math.abs(yy) + (f ? 0.04 * Math.sin((x / BEAM_W) * Math.PI * 4) : 0);
        const spiral = Math.abs(yy - 0.6 * Math.sin((x / BEAM_W) * Math.PI * 2)) < 0.07;
        if (spiral && v < 0.85) return c(0xe1bee7);
        if (v < 0.15) return c(0xffffff);
        if (v < 0.35) return c(0xb3e5fc);
        if (v < 0.58) return c(0x7986cb);
        if (v < 0.8) return c(0x5e35b1);
        if (v < 1 && on((1 - v) / 0.2, x, y)) return c(0x311b92);
        return 0;
      });
    }
    // ドラゴンダイブの光の尾（赤と青。横につなぐ）
    for (const [name, cols] of [
      ['red', RED],
      ['blue', BLUE],
    ] as const) {
      makeTexture(s, `la-trail-${name}`, 32, 24, (x, y) => {
        const v = Math.abs((y - 11.5) / 12);
        if (v < 0.2) return c(cols[5]!);
        if (v < 0.42) return c(cols[4]!);
        if (v < 0.66) return c(cols[2]!);
        if (v < 1 && on((1 - v) / 0.34, x, y)) return c(cols[1]!);
        return 0;
      });
    }
  }

  update(world: World, timeMs: number): void {
    this.pool.begin();
    const moves = world.rules.stage.moves;
    if (world.hazards.some((h) => /^lati[ao]s-/.test(moves[h.move]?.id ?? ''))) this.build();
    const frame = Math.floor(timeMs / 80) % FR;
    for (const hz of world.hazards) {
      const id = moves[hz.move]?.id ?? '';
      if (!/^lati[ao]s-/.test(id)) continue;
      const p = hz.activeTicks === undefined ? 1 - hz.ticksLeft / Math.max(1, hz.totalTicks) : 1;
      const active = hz.activeTicks !== undefined;
      const red = id.startsWith('latias');
      const boss = this.boss(world, hz);
      if (id.startsWith('latias-mist-ball')) {
        if (active) this.drawMist(hz, frame);
      } else if (id === 'latias-dragon-breath') {
        if (active) this.pool.image(`la-breath-${frame}`, this.depth).setOrigin(0, 0.5).setPosition(hz.x, hz.y).setRotation(Math.atan2(hz.dirY, hz.dirX)).setScale(hz.radius / 96);
        else if (boss) this.gather(boss, p, timeMs, 0xb388ff);
      } else if (id === 'latias-heal-pulse') {
        if (!active && boss) this.drawHeal(world, boss, p, timeMs);
      } else if (id.startsWith('latias-refraction')) {
        if (!active) this.drawRefraction(hz, p, frame, timeMs);
      } else if (id.endsWith('-cross')) {
        if (!active && boss) this.gather(boss, p, timeMs, red ? 0xff8a80 : 0x90caf9);
      } else if (id.includes('rush') || id.endsWith('cross-dive')) {
        if (active) this.drawDash(world, hz, red);
        else this.drawDashAim(hz, p, red);
      } else if (id === 'latios-luster-purge') {
        if (active) {
          const key = `${hz.group ?? 0}:${Math.round(hz.x)}:${Math.round(hz.y)}`;
          if (!this.lingering.has(key)) this.lingering.set(key, { kind: 'burst', x: hz.x, y: hz.y, r: hz.radius, startMs: timeMs });
        } else this.pool.image('la-mark', this.floorDepth).setPosition(hz.x, hz.y).setScale((hz.radius * 2 * (0.5 + 0.5 * p)) / 48);
      } else if (id === 'latios-dragon-pulse') {
        if (active) this.drawPulse(hz, timeMs, frame);
        else this.drawPulseCharge(hz, p, frame);
      } else if (id === 'latios-dragon-dance') {
        if (boss) this.pool.image(`la-dance-${frame}`, this.topDepth).setOrigin(0.5, 1).setPosition(boss.x, boss.y + boss.r * 0.4).setScale(((boss.r * 4) / 56) * (0.6 + 0.4 * p));
      }
    }
    for (const [key, l] of this.lingering) {
      const t = (timeMs - l.startMs) / BURST_MS;
      if (t >= 1) {
        this.lingering.delete(key);
        continue;
      }
      this.pool.image(`la-burst-${Math.min(FR - 1, Math.floor(t * FR))}`, this.depth).setPosition(l.x, l.y - l.r * 0.3).setScale((l.r * 2.4) / 56);
    }
    if (!world.legendary && !world.intruder) this.lingering.clear();
    this.pool.end();
  }

  private boss(world: World, hz: Hz): Body | null {
    if (hz.dasher === -1) return null;
    const i = findEnemyIndex(world, hz.dasher);
    if (i < 0) return null;
    return { x: world.enemies.x[i]!, y: world.enemies.y[i]!, r: world.enemies.radius[i]! };
  }

  /** 体のまわりから光の粒が集まる（技の溜め） */
  private gather(b: Body, p: number, timeMs: number, col: number): void {
    for (let k = 0; k < 10; k++) {
      const t = ((timeMs / 420 + rnd(k, 3)) % 1 + 1) % 1;
      const a = (k / 10) * Math.PI * 2 + timeMs / 300;
      const d = b.r * 3 * (1 - t);
      this.pool.dot(b.x + Math.cos(a) * d, b.y - b.r + Math.sin(a) * d * 0.7, 4 + 6 * t * (0.5 + 0.5 * p), t > 0.7 ? 0xffffff : col);
    }
  }

  /** ミストボール: 霧の玉と、後ろに残る霧の粒 */
  private drawMist(hz: Hz, frame: number): void {
    const sp = Math.hypot(hz.vx ?? 0, hz.vy ?? 0) || 1;
    const tx = -(hz.vx ?? 0) / sp;
    const ty = -(hz.vy ?? 0) / sp;
    for (let k = 1; k <= 4; k++) this.pool.dot(hz.x + tx * k * 14 + (rnd(k, hz.x) - 0.5) * 8, hz.y + ty * k * 14, 12 - k * 2.5, k < 3 ? 0xfce4ec : 0xffcdd2);
    this.pool.image(`la-mist-${frame}`, this.depth + 0.02).setPosition(hz.x, hz.y).setScale((hz.radius * 2.4) / 26);
  }

  /** いやしのはどう: ラティアスのまわりに波の輪が広がり、光の粒がラティオスへ流れる */
  private drawHeal(world: World, b: Body, _p: number, timeMs: number): void {
    for (let k = 0; k < 2; k++) {
      const t = ((timeMs / 700 + k / 2) % 1 + 1) % 1;
      this.pool.image(`la-heal-${Math.min(FR - 1, Math.floor(t * FR))}`, this.floorDepth).setPosition(b.x, b.y).setScale((b.r * 8) / 80);
    }
    const kinds = world.rules.enemies.kinds;
    for (let i = 0; i < world.enemies.count; i++) {
      if (world.enemies.hp[i]! <= 0 || kinds[world.enemies.kind[i]!]?.id !== 'legend-latios') continue;
      const tx = world.enemies.x[i]!;
      const ty = world.enemies.y[i]! - b.r;
      for (let k = 0; k < 8; k++) {
        const t = ((timeMs / 600 + k / 8) % 1 + 1) % 1;
        this.pool.dot(b.x + (tx - b.x) * t, b.y - b.r + (ty - b.y + b.r) * t - Math.sin(t * Math.PI) * 60, 12, k % 2 ? 0xffffff : 0xf48fb1);
      }
    }
  }

  /** ひかりのくっせつ: 現れる所に、虹色のかげろうがゆらめく（だんだん濃く） */
  private drawRefraction(hz: Hz, p: number, frame: number, timeMs: number): void {
    this.pool.image(`la-refract-${frame}`, this.depth).setOrigin(0.5, 1).setPosition(hz.x, hz.y + 4).setScale(DOT * (1.2 + 0.6 * p));
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + timeMs / 250;
      this.pool.dot(hz.x + Math.cos(a) * 50 * (1 - p * 0.5), hz.y - 40 + Math.sin(a) * 30, 5, [0xff8a80, 0xffe082, 0xb9f6ca, 0x80d8ff, 0xb388ff, 0xffffff][k]!);
    }
  }

  /** ドラゴンダイブの予告: 駆け抜ける道に点線（ラティアスは赤、ラティオスは青） */
  private drawDashAim(hz: Hz, p: number, red: boolean): void {
    for (let d = 30; d < hz.length; d += 24) {
      if (((d / 24) | 0) % 2 === 0 && rnd(d, hz.x) < 0.35 + 0.65 * p) this.pool.dot(hz.x + hz.dirX * d, hz.y + hz.dirY * d, 5, red ? 0xff8a80 : 0x90caf9);
    }
  }

  /** ドラゴンダイブ: 体の後ろに細っていく光の尾 */
  private drawDash(world: World, hz: Hz, red: boolean): void {
    const i = findEnemyIndex(world, hz.dasher);
    if (i < 0) return;
    const bx = world.enemies.x[i]!;
    const by = world.enemies.y[i]!;
    const run = Math.max(0, (bx - hz.x) * hz.dirX + (by - hz.y) * hz.dirY);
    const L = Math.min(run, 500);
    const rot = Math.atan2(hz.dirY, hz.dirX) + Math.PI;
    for (let d = 0; d < L; d += 32 * DOT) {
      const k = 1 - d / Math.max(1, L);
      this.pool.image(`la-trail-${red ? 'red' : 'blue'}`, this.depth - 0.01).setOrigin(0, 0.5).setRotation(rot).setPosition(bx - hz.dirX * d, by - hz.dirY * d).setScale(DOT, ((hz.radius * 1.8) / 24) * (0.3 + 0.7 * k));
    }
  }

  /** りゅうのはどうの溜め: 口元に青紫の玉が育ち、撃つ道に点線 */
  private drawPulseCharge(hz: Hz, p: number, frame: number): void {
    for (let d = 30; d < hz.length; d += 26) if (((d / 26) | 0) % 2 === 0 && rnd(d, 4) < 0.35 + 0.65 * p) this.pool.dot(hz.x + hz.dirX * d, hz.y + hz.dirY * d, 5, 0xb39ddb);
    this.pool.image(`la-orb-${frame}`, this.topDepth).setPosition(hz.x, hz.y).setScale(DOT * (0.4 + 1.2 * p));
  }

  /** りゅうのはどう: 区切りをつないで先へ流す（なぎ払う向きに合わせて回る） */
  private drawPulse(hz: Hz, timeMs: number, frame: number): void {
    const rot = Math.atan2(hz.dirY, hz.dirX);
    const seg = BEAM_W * DOT;
    const sy = (hz.radius * 2 * 1.3) / BEAM_H;
    const off = (timeMs * 0.9) % seg;
    const f = Math.floor(timeMs / 90) % 2;
    for (let d = -seg + off; d < hz.length; d += seg) {
      const dd = Math.max(0, d);
      this.pool.image(`la-pulse-${f}`, this.depth).setOrigin(0, 0.5).setRotation(rot).setScale(DOT, sy).setPosition(hz.x + hz.dirX * dd, hz.y + hz.dirY * dd);
    }
    this.pool.image(`la-orb-${frame}`, this.topDepth).setPosition(hz.x, hz.y).setScale((hz.radius * 2.6) / 28);
  }
}
