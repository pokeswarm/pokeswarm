import Phaser from 'phaser';
import type { World } from '../../sim/world';
import { c, DOT, DotPool, makeTexture, on, rnd, shade } from './dotArt';

type Hz = World['hazards'][number];
type Body = { x: number; y: number; r: number };

/** 消えた後もしばらく描く物（岩の刃が沈む・溶岩が冷える） */
interface Lingering {
  kind: 'blade' | 'splash';
  x: number;
  y: number;
  r: number;
  seed: number;
  startMs: number;
  /** 当たり判定が消えた時刻（0 はまだある） */
  goneMs: number;
}

const BLADE_LINGER_MS = 900;
const SPLASH_LINGER_MS = 1600;
const FR = 8;
/** 割れ目の 1 区切り（ドット） */
const CRACK_W = 12;
const CRACK_H = 12;
/** 岩の刃（ドット） */
const BLADE_W = 22;
const BLADE_H = 64;
const ROCK = [0x2b120c, 0x4a1c14, 0x6d2c1d, 0x9c4a33, 0xc66f4e];
const LAVA = [0x5d0f05, 0xb71c1c, 0xe64a19, 0xff7043, 0xffab40, 0xffe0b2];

/**
 * グラードンの技の絵（07 の283・297章）: だんがいのつるぎの裂ける割れ目と突き上がる岩の刃・ふんかの打ち上がって落ちる溶岩と溶岩だまり・
 * ソーラービームの集まる日の光・ゲンシカイキの放射状の割れ目と体の熱。
 * 1 ドットずつ計算したドット絵のテクスチャで描く（半透明の塗りは使わない）。見た目だけ（当たりはシミュレーション）
 */
export class GroudonEarth {
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
    // 割れ目の 1 区切り: 黒い裂け目の奥に赤、芯に橙（コマで脈打つ）。横につなぐ
    for (let f = 0; f < FR; f++) {
      makeTexture(s, `gr-crack-${f}`, CRACK_W, CRACK_H, (x, y) => {
        const mid = CRACK_H / 2 - 0.5 + Math.sin((x / CRACK_W) * Math.PI * 2) * 1.2;
        const d = Math.abs(y - mid);
        const pulse = 0.5 + 0.5 * Math.sin((f / FR) * Math.PI * 2 + x * 0.5);
        if (d < 0.8) return c(pulse > 0.5 ? 0xffd180 : 0xff9100);
        if (d < 1.8) return c(0xe64a19);
        if (d < 3.2) return c(0x8e1b10);
        if (d < 4.6) return c(0x1a0f0a);
        if (d < 5.6 && rnd(x, y) > 0.5) return c(0x3e2723);
        return 0;
      });
    }
    // 岩の刃（3 種）: 左の面は光が当たり、右の面は影。ふちは熱で赤い。根もとほど赤く焼ける
    for (let k = 0; k < 3; k++) {
      const lean = (k - 1) * 0.18;
      makeTexture(s, `gr-blade-${k}`, BLADE_W, BLADE_H, (x, y) => {
        const t = 1 - y / BLADE_H;
        const cx = BLADE_W / 2 + lean * (BLADE_H - y) * 0.5;
        const shoulder = t > 0.55 ? 1 - (t - 0.55) / 0.45 : 1;
        const half = (BLADE_W / 2 - 1) * (0.25 + 0.75 * shoulder) * (1 - t * 0.35) + (rnd(k, Math.floor(y / 5)) - 0.5) * 2;
        const dx = x - cx;
        if (Math.abs(dx) > half) return 0;
        if (Math.abs(dx) > half - 1.2) return c(t < 0.4 ? 0xff3d00 : 0xbf360c);
        const lit = dx < -half * 0.1;
        let col = shade(ROCK, (lit ? 0.75 : 0.3) + (rnd(x + k * 13, y) - 0.5) * 0.15, x, y);
        if (Math.abs(dx + half * 0.1) < 0.6) col = c(0x2b0f0a);
        if (t < 0.18 && on((0.18 - t) / 0.18, x, y)) col = shade(LAVA, 0.5 + (0.18 - t) * 2, x, y);
        return col;
      });
    }
    // 溶岩だまり（冷えていく 8 コマ）: 赤く光る溶岩の上に黒い皮が広がる
    for (let f = 0; f < FR; f++) {
      const cool = f / (FR - 1);
      const W = 48;
      const H = 22;
      makeTexture(s, `gr-pool-${f}`, W, H, (x, y) => {
        const nx = (x - (W - 1) / 2) / (W / 2);
        const ny = (y - (H - 1) / 2) / (H / 2);
        const r = Math.hypot(nx, ny) + (rnd(x, y) - 0.5) * 0.08;
        if (r > 1) return 0;
        const crust = rnd(Math.floor(x / 3), Math.floor(y / 2)) < cool * 1.1 + r * 0.3;
        if (crust) return shade([0x0d0907, 0x1b1210, 0x2b1b17], 0.3 + (1 - r) * 0.5, x, y);
        return shade(LAVA, (1 - r) * 0.9 + 0.1 - cool * 0.4, x, y);
      });
    }
    // 溶岩の塊（回る 8 コマ）: 黒い皮のひびから溶岩が光る
    for (let f = 0; f < FR; f++) {
      const S = 20;
      makeTexture(s, `gr-lava-${f}`, S, S, (x, y) => {
        const dx = x - (S - 1) / 2;
        const dy = y - (S - 1) / 2;
        const r = Math.hypot(dx, dy) / (S / 2);
        if (r > 1) return 0;
        const a = Math.atan2(dy, dx) + (f / FR) * Math.PI * 2;
        const vein = Math.abs(Math.sin(a * 3 + r * 6)) < 0.25;
        if (r < 0.35) return c(0xffe082);
        if (vein) return c(r < 0.7 ? 0xff9100 : 0xe64a19);
        return shade([0x1a0f0a, 0x2b1b17, 0x4a2a20], 0.8 - r * 0.6 + (dy < 0 ? 0.2 : 0), x, y);
      });
    }
    // 落ちる所の影（ディザ）
    makeTexture(s, 'gr-shadow', 32, 14, (x, y) => {
      const r = Math.hypot((x - 15.5) / 16, (y - 6.5) / 7);
      return r < 1 && on(0.7 - r * 0.4, x, y) ? c(0x0d0907) : 0;
    });
    // 着いた所の光の輪（広がって消える 8 コマ）
    for (let f = 0; f < FR; f++) {
      const t = f / (FR - 1);
      makeTexture(s, `gr-ring-${f}`, 64, 30, (x, y) => {
        const r = Math.hypot((x - 31.5) / 32, (y - 14.5) / 15);
        const R = 0.4 + 0.55 * t;
        return Math.abs(r - R) < 0.07 && on(1.1 - t, x, y) ? c(t < 0.4 ? 0xffd180 : 0xff6d00) : 0;
      });
    }
    // 日の光の玉（回る光の筋）
    for (let f = 0; f < FR; f++) {
      const S = 32;
      makeTexture(s, `gr-sun-${f}`, S, S, (x, y) => {
        const dx = x - (S - 1) / 2;
        const dy = y - (S - 1) / 2;
        const r = Math.hypot(dx, dy) / (S / 2);
        const a = Math.atan2(dy, dx) + (f / FR) * (Math.PI / 4);
        const ray = Math.abs(Math.cos(a * 4)) > 0.92 && r < 1;
        if (r < 0.32) return c(0xffffff);
        if (r < 0.55) return c(0xfff59d);
        if (r < 0.7) return c(0xffee58);
        if (ray) return c(r < 0.85 ? 0xfff176 : 0xffd600);
        return 0;
      });
    }
    // ゲンシカイキの体の熱（下から昇る炎の舌の輪。8 コマ）
    for (let f = 0; f < FR; f++) {
      const W = 56;
      const H = 64;
      makeTexture(s, `gr-heat-${f}`, W, H, (x, y) => {
        const nx = (x - (W - 1) / 2) / (W / 2);
        const t = 1 - y / H;
        const body = Math.abs(nx) < 0.62 + 0.12 * Math.sin(t * 6 + f);
        const edge = Math.abs(Math.abs(nx) - (0.7 + 0.15 * Math.sin(t * 5 + f * 0.8)));
        if (body) return 0;
        const tongue = Math.sin(x * 0.9 + f * 1.3 + t * 3) > 0.2;
        if (edge < 0.16 && tongue && on(1 - t * 0.9, x, y)) return c(edge < 0.07 ? 0xffab40 : 0xe64a19);
        return 0;
      });
    }
  }

  update(world: World, timeMs: number): void {
    this.pool.begin();
    const moves = world.rules.stage.moves;
    if (world.hazards.some((h) => moves[h.move]?.id.startsWith('groudon-'))) this.build();
    const groudon = this.groudon(world);
    const frame = Math.floor(timeMs / 80) % FR;
    const seen = new Set<string>();
    const cracks = new Map<number, Hz[]>();
    for (const hz of world.hazards) {
      const id = moves[hz.move]?.id ?? '';
      if (!id.startsWith('groudon-')) continue;
      const p = hz.activeTicks === undefined ? 1 - hz.ticksLeft / Math.max(1, hz.totalTicks) : 1;
      const key = `${hz.group ?? 0}:${Math.round(hz.x)}:${Math.round(hz.y)}`;
      if (id.startsWith('groudon-precipice-blades')) {
        const list = cracks.get(hz.group ?? 0) ?? [];
        list.push(hz);
        cracks.set(hz.group ?? 0, list);
        if (hz.activeTicks !== undefined) {
          seen.add(key);
          if (!this.lingering.has(key)) this.lingering.set(key, { kind: 'blade', x: hz.x, y: hz.y, r: hz.radius, seed: rnd(hz.x, hz.y), startMs: timeMs, goneMs: 0 });
        }
      } else if (id.startsWith('groudon-eruption')) {
        if (hz.activeTicks === undefined) this.drawLavaFlight(hz, groudon, p, frame);
        else {
          seen.add(key);
          if (!this.lingering.has(key)) this.lingering.set(key, { kind: 'splash', x: hz.x, y: hz.y, r: hz.radius, seed: rnd(hz.x, hz.y), startMs: timeMs, goneMs: 0 });
        }
      } else if (id.startsWith('groudon-solar-beam') && hz.activeTicks === undefined && groudon) {
        this.drawSunGather(groudon, p, timeMs, id.endsWith('-sun'), frame);
      } else if (id === 'groudon-primal-reversion' && groudon) {
        this.drawReversion(groudon, p, timeMs, frame);
      }
    }
    for (const list of cracks.values()) this.drawCrack(list, groudon, frame);
    for (const [key, l] of this.lingering) {
      if (!seen.has(key) && l.goneMs === 0) l.goneMs = timeMs;
      const limit = l.kind === 'blade' ? BLADE_LINGER_MS : SPLASH_LINGER_MS;
      if (l.goneMs > 0 && timeMs - l.goneMs > limit) {
        this.lingering.delete(key);
        continue;
      }
      if (l.kind === 'blade') this.drawBlade(l, timeMs);
      else this.drawSplash(l, timeMs);
    }
    if (!world.legendary) this.lingering.clear();
    this.pool.end();
  }

  /** グラードン（ゲンシの姿も同じ敵）の足元の位置と体の大きさ */
  private groudon(world: World): Body | null {
    const e = world.enemies;
    for (let i = 0; i < e.count; i++) {
      if (e.hp[i]! <= 0) continue;
      if (world.rules.enemies.kinds[e.kind[i]!]?.id === 'legend-groudon') return { x: e.x[i]!, y: e.y[i]!, r: e.radius[i]! };
    }
    return null;
  }

  /** 割れ目の絵を (x0,y0) から (x1,y1) へ、区切りをつないで置く（limit の長さまで） */
  private crackLine(x0: number, y0: number, x1: number, y1: number, frame: number, limit: number): number {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const step = CRACK_W * DOT - 2;
    const rot = Math.atan2(y1 - y0, x1 - x0);
    let used = 0;
    for (let d = 0; d < len && used < limit; d += step) {
      const t = d / len;
      this.pool.image(`gr-crack-${(frame + Math.floor(d / step)) % FR}`, this.floorDepth).setOrigin(0, 0.5).setRotation(rot).setPosition(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      used += step;
    }
    return used;
  }

  /**
   * だんがいのつるぎの割れ目: グラードンの足元から、刃の並ぶ所を通って割れ目が伸びる（予告の 7 割で端まで）。
   * 予告の間は、刃の出る所にディザの赤い印
   */
  private drawCrack(list: Hz[], groudon: Body | null, frame: number): void {
    const ox = groudon?.x ?? list[0]!.x;
    const oy = groudon?.y ?? list[0]!.y;
    const sorted = [...list].sort((a, b) => Math.hypot(a.x - ox, a.y - oy) - Math.hypot(b.x - ox, b.y - oy));
    const lines: Hz[][] = [];
    for (const h of sorted) {
      const line = lines.find((l) => Math.hypot(l[l.length - 1]!.x - h.x, l[l.length - 1]!.y - h.y) < h.radius * 2.2);
      if (line) line.push(h);
      else lines.push([h]);
    }
    for (const line of lines) {
      const first = line[0]!;
      const p = first.activeTicks === undefined ? 1 - first.ticksLeft / Math.max(1, first.totalTicks) : 1;
      const pts: [number, number][] = [[ox, oy]];
      for (const h of line) pts.push([h.x + (rnd(h.x, 1) - 0.5) * 14, h.y + (rnd(h.y, 2) - 0.5) * 8]);
      const last = line[line.length - 1]!;
      pts.push([last.x + last.dirX * last.radius, last.y + last.dirY * last.radius]);
      let total = 0;
      for (let k = 0; k < pts.length - 1; k++) total += Math.hypot(pts[k + 1]![0] - pts[k]![0], pts[k + 1]![1] - pts[k]![1]);
      let left = total * Math.min(1, p / 0.7);
      for (let k = 0; k < pts.length - 1 && left > 0; k++) left -= this.crackLine(pts[k]![0], pts[k]![1], pts[k + 1]![0], pts[k + 1]![1], frame, left);
    }
  }

  /**
   * だんがいのつるぎの刃: 割れ目から、焼けた岩の刃が 3 本、一気に突き上がる（0.14 秒。下から現れる）。
   * 根もとに溶岩だまり、岩のかけらと火の粉が飛ぶ。当たり判定が消えた後は沈む
   */
  private drawBlade(l: Lingering, timeMs: number): void {
    const age = timeMs - l.startMs;
    const rise = 1 - Math.pow(1 - Math.min(1, age / 140), 3);
    const sink = l.goneMs > 0 ? Math.min(1, (timeMs - l.goneMs) / BLADE_LINGER_MS) : 0;
    const bx = l.x;
    const by = l.y + l.r * 0.3;
    const sc = (l.r * 0.9) / (BLADE_W * DOT) * DOT;
    this.pool.image(`gr-pool-${Math.min(FR - 1, Math.floor(sink * FR))}`, this.floorDepth).setPosition(bx, by).setScale((l.r * 2.4) / 48);
    const shards = [
      { k: 0, off: -0.6, h: 0.62 },
      { k: 2, off: 0.6, h: 0.56 },
      { k: 1, off: 0, h: 1 },
    ];
    for (const sh of shards) {
      const vis = Math.max(0, rise * sh.h * (1 - sink));
      if (vis <= 0.02) continue;
      const scale = sc * (0.85 + 0.3 * sh.h);
      const shown = Math.ceil(BLADE_H * vis);
      // 下から現れる（上を切る）
      this.pool.image(`gr-blade-${sh.k}`, this.depth).setOrigin(0.5, 1).setPosition(bx + l.r * sh.off, by).setScale(scale).setCrop(0, BLADE_H - shown, BLADE_W, shown);
    }
    if (age < 600) {
      const t = age / 600;
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (rnd(l.seed, k + 9) - 0.5) * 2.4;
        const sp = l.r * (1.4 + rnd(k, l.seed) * 1.8);
        const x = bx + Math.cos(a) * sp * t;
        const y = by + Math.sin(a) * sp * t + 260 * t * t;
        this.pool.dot(x, y, k % 3 === 0 ? 5 * (1 - t) + 1 : 8 * (1 - t * 0.5), k % 3 === 0 ? 0xffab40 : k % 2 ? 0x4a1c14 : 0x9c4a33);
      }
    }
  }

  /** ふんかの溶岩の塊: グラードンの背中から打ち上がり、放物線を描いて落ちる。落ちる所に影 */
  private drawLavaFlight(hz: Hz, groudon: Body | null, p: number, frame: number): void {
    this.pool.image('gr-shadow', this.floorDepth).setPosition(hz.x, hz.y).setScale((hz.radius * 1.6 * (0.5 + 0.5 * p)) / 32);
    if (!groudon) return;
    const sx = groudon.x;
    const sy = groudon.y - groudon.r * 1.6;
    const peak = 170 + rnd(hz.x, hz.y) * 90;
    const at = (t: number): [number, number] => [sx + (hz.x - sx) * t, sy + (hz.y - sy) * t - peak * 4 * t * (1 - t)];
    for (let k = 1; k <= 6; k++) {
      const [xx, yy] = at(Math.max(0, p - k * 0.02));
      this.pool.dot(xx, yy, 10 - k * 1.4, k < 3 ? 0xffab40 : 0xe64a19);
    }
    const [x, y] = at(p);
    this.pool.image(`gr-lava-${(frame + Math.floor(rnd(hz.x, 3) * FR)) % FR}`, this.depth + 0.02).setPosition(x, y).setScale(DOT * (1 + rnd(hz.y, hz.x) * 0.4));
  }

  /** ふんかの着いた所: 溶岩だまりが光ってから冷えて黒くなる。しずくが飛び、光の輪が広がる */
  private drawSplash(l: Lingering, timeMs: number): void {
    const age = timeMs - l.startMs;
    const cool = Math.min(1, age / (SPLASH_LINGER_MS + 400));
    this.pool.image(`gr-pool-${Math.min(FR - 1, Math.floor(cool * FR))}`, this.floorDepth).setPosition(l.x, l.y).setScale((l.r * 1.9) / 48);
    if (age < 500) {
      const t = age / 500;
      this.pool.image(`gr-ring-${Math.min(FR - 1, Math.floor(t * FR))}`, this.floorDepth + 0.01).setPosition(l.x, l.y).setScale((l.r * 2.6) / 64);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2 + l.seed * 3;
        const d = l.r * (0.6 + rnd(k, l.seed) * 0.9) * t;
        const up = -l.r * 1.3 * t * (1 - t) * (0.6 + rnd(l.seed, k));
        this.pool.dot(l.x + Math.cos(a) * d, l.y + Math.sin(a) * d * 0.5 + up, 7 * (1 - t * 0.6), k % 3 ? 0xff6d00 : 0xffd54f);
      }
    }
  }

  /** ソーラービームの溜め: 日の光の粒がまわりから口元へ集まり、口元の光の玉が大きくなる（ひざしの間は速い） */
  private drawSunGather(g: Body, p: number, timeMs: number, sun: boolean, frame: number): void {
    const mx = g.x + g.r * 0.3;
    const my = g.y - g.r * 1.5;
    const speed = sun ? 420 : 760;
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2 + rnd(k, 3) * 0.5;
      const t = ((timeMs / speed + rnd(k, 7)) % 1 + 1) % 1;
      const d = g.r * (4.6 - 4.0 * t);
      const px = mx + Math.cos(a) * d;
      const py = my + Math.sin(a) * d * 0.8;
      // 粒と、口元へ向かう短い尾（点を並べる）
      for (let j = 1; j <= 3; j++) this.pool.dot(px - (mx - px) * 0.12 * j, py - (my - py) * 0.12 * j, 8 - j * 2, 0xfff176);
      this.pool.dot(px, py, 10 + t * 4, 0xfff59d);
      this.pool.dot(px, py, 5 + t * 2, 0xffffff);
    }
    this.pool.image(`gr-sun-${frame}`, this.topDepth).setPosition(mx, my).setScale(DOT * (0.4 + 1.3 * p));
  }

  /** ゲンシカイキ: 地面に割れ目が放射状に走り、体のまわりに炎の舌が昇る */
  private drawReversion(g: Body, p: number, timeMs: number, frame: number): void {
    const by = g.y + g.r * 0.3;
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + rnd(k, 1) * 0.4;
      const len = g.r * (3.6 + rnd(k, 2) * 2.4) * Math.min(1, p * 1.6);
      const mx = g.x + Math.cos(a + 0.15) * len * 0.5;
      const my = by + Math.sin(a + 0.15) * len * 0.5 * 0.55;
      const used = this.crackLine(g.x, by, mx, my, frame, len);
      this.crackLine(mx, my, g.x + Math.cos(a) * len, by + Math.sin(a) * len * 0.55, frame, Math.max(0, len - used));
    }
    if (p > 0.15) this.pool.image(`gr-heat-${frame}`, this.topDepth).setOrigin(0.5, 1).setPosition(g.x, g.y + g.r * 0.4).setScale((g.r * 4.2) / 56);
    for (let k = 0; k < 12; k++) {
      const t = ((timeMs / 520 + rnd(k, 5)) % 1 + 1) % 1;
      const a = (k / 12) * Math.PI * 2;
      this.pool.dot(g.x + Math.cos(a) * g.r * 1.3, g.y + g.r * 0.2 - t * g.r * 3.4, 9 * (1 - t) * p + 1, k % 2 ? 0xff6d00 : 0xffab40);
    }
  }
}
