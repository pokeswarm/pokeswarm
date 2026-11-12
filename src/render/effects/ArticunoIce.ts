import Phaser from 'phaser';
import type { World } from '../../sim/world';

/** 1 ドット（ワールドの単位） */
const DOT = 2;
const ICICLE_W = 22;
const ICICLE_H = 9;
const SPIKE_W = 26;
const SPIKE_H = 30;
const SPIKE_KINDS = 3;
const FROST = 64;
const HAIL = 12;

const abgr = (r: number, g: number, b: number, a = 1): number => ((Math.round(Math.max(0, Math.min(1, a)) * 255) << 24) | (b << 16) | (g << 8) | r) >>> 0;

function rnd(a: number, b: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * フリーザーの技の絵（07 の〔フリーザー〕章）: こおりのつぶて・こごえるかぜの雪の筋・フリーズドライ（凍っていく水と氷のとげ）・
 * あられの雹・マインドリーダーの照準・ぜったいれいどの冷気。見た目だけ（当たりはシミュレーション）
 */
export class ArticunoIce {
  private built = false;
  private readonly pool: Phaser.GameObjects.Image[] = [];
  private used = 0;
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly gn: Phaser.GameObjects.Graphics;
  private lastTick = -1;
  private tickMs = 0;
  /** ぜったいれいどが落ちた場所と時（冷気が広がって消える） */
  private blasts: { x: number; y: number; r: number; at: number }[] = [];
  private seenBlast = new Set<object>();
  /** 雹が落ちた場所と時（砕ける） */
  private shatters: { x: number; y: number; at: number }[] = [];
  private seenHail = new Set<object>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
    private readonly floorDepth: number,
  ) {
    this.g = scene.add.graphics().setDepth(depth - 0.01).setBlendMode(Phaser.BlendModes.ADD);
    this.gn = scene.add.graphics().setDepth(floorDepth);
  }

  private build(): void {
    if (this.built) return;
    this.built = true;
    const tx = this.scene.textures;
    const put = (key: string, w: number, h: number, draw: (out: Uint32Array) => void): void => {
      if (tx.exists(key)) tx.remove(key);
      const c = tx.createCanvas(key, w, h)!;
      const ctx = c.getContext();
      const img = ctx.createImageData(w, h);
      draw(new Uint32Array(img.data.buffer));
      ctx.putImageData(img, 0, 0);
      c.refresh();
    };
    // つらら（右向き。先がとがり、上の面が明るい）
    put('articuno-icicle', ICICLE_W, ICICLE_H, (out) => {
      for (let y = 0; y < ICICLE_H; y++) {
        for (let x = 0; x < ICICLE_W; x++) {
          const half = (ICICLE_H / 2) * (1 - x / ICICLE_W) + 0.3;
          const dy = y - (ICICLE_H - 1) / 2;
          if (Math.abs(dy) > half) continue;
          const edge = half - Math.abs(dy) < 1;
          out[y * ICICLE_W + x] = edge ? abgr(70, 140, 190) : dy < -half * 0.2 ? abgr(240, 252, 255) : dy < half * 0.4 ? abgr(170, 225, 245) : abgr(110, 180, 225);
        }
      }
    });
    // 氷のとげ（根元が広く、先がとがった 3〜4 本の塊）
    for (let k = 0; k < SPIKE_KINDS; k++) {
      put(`articuno-spike-${k}`, SPIKE_W, SPIKE_H, (out) => {
        const n = 3 + (k % 2);
        for (let s = 0; s < n; s++) {
          const bx = 4 + rnd(k, s) * (SPIKE_W - 8);
          const tall = 12 + rnd(k, s + 5) * (SPIKE_H - 14);
          const lean = (rnd(k, s + 9) - 0.5) * 0.6;
          const half = 2.5 + rnd(k, s + 3) * 2.5;
          for (let y = 0; y < tall; y++) {
            const yy = SPIKE_H - 1 - y;
            const w = half * (1 - y / tall);
            const cx = bx + lean * y;
            for (let x = Math.floor(cx - w); x <= Math.ceil(cx + w); x++) {
              if (x < 0 || x >= SPIKE_W) continue;
              const d = x - cx;
              if (Math.abs(d) > w) continue;
              out[yy * SPIKE_W + x] = Math.abs(d) > w - 1 ? abgr(80, 150, 200) : d < 0 ? abgr(236, 250, 255) : abgr(150, 210, 240);
            }
          }
        }
      });
    }
    // 凍っていく水: 樹の枝のように伸びる霜の模様（円の中）
    put('articuno-frost', FROST, FROST, (out) => {
      const c = (FROST - 1) / 2;
      const mask = new Uint8Array(FROST * FROST);
      for (let b = 0; b < 9; b++) {
        let a = (b / 9) * Math.PI * 2 + rnd(b, 1) * 0.4;
        let x = c;
        let y = c;
        for (let t = 0; t < 34; t++) {
          x += Math.cos(a);
          y += Math.sin(a);
          a += (rnd(b * 40 + t, 2) - 0.5) * 0.5;
          const i = Math.round(y) * FROST + Math.round(x);
          if (Math.hypot(x - c, y - c) > c - 1) break;
          mask[i] = 1;
          // 枝分かれ
          if (t % 7 === 6) {
            let bx = x;
            let by = y;
            const ba = a + (rnd(b, t) > 0.5 ? 0.9 : -0.9);
            for (let u = 0; u < 7; u++) {
              bx += Math.cos(ba);
              by += Math.sin(ba);
              const j = Math.round(by) * FROST + Math.round(bx);
              if (j >= 0 && j < mask.length && Math.hypot(bx - c, by - c) < c - 1) mask[j] = 1;
            }
          }
        }
      }
      for (let y = 0; y < FROST; y++) {
        for (let x = 0; x < FROST; x++) {
          const r = Math.hypot(x - c, y - c) / c;
          if (r > 1) continue;
          const i = y * FROST + x;
          out[i] = mask[i] ? abgr(236, 250, 255, 0.95) : 0;
        }
      }
    });
    put('articuno-hail', HAIL, HAIL, (out) => {
      for (let y = 0; y < HAIL; y++) {
        for (let x = 0; x < HAIL; x++) {
          const r = Math.hypot(x - 5.5, y - 5.5);
          if (r > 5.6 - (rnd(x, y) > 0.7 ? 0.8 : 0)) continue;
          out[y * HAIL + x] = r > 4.5 ? abgr(90, 150, 190) : x + y < 9 ? abgr(245, 252, 255) : abgr(190, 228, 245);
        }
      }
    });
  }

  private image(key: string): Phaser.GameObjects.Image {
    let img = this.pool[this.used];
    if (!img) {
      img = this.scene.add.image(0, 0, key);
      this.pool.push(img);
    }
    this.used++;
    return img.setTexture(key).setVisible(true).setAlpha(1).setRotation(0).setScale(DOT).setDepth(this.depth).setOrigin(0.5, 0.5);
  }

  update(world: World, timeMs: number): void {
    this.used = 0;
    this.g.clear();
    this.gn.clear();
    const moves = world.rules.stage.moves;
    if (world.hazards.some((h) => moves[h.move]?.id.startsWith('articuno-')) || this.blasts.length || this.shatters.length) this.build();
    if (world.tick !== this.lastTick) {
      this.lastTick = world.tick;
      this.tickMs = timeMs;
    }
    const frac = Math.min(1, (timeMs - this.tickMs) / (world.dt * 1000));
    for (const hz of world.hazards) {
      const move = moves[hz.move];
      if (!move?.id.startsWith('articuno-')) continue;
      const p = hz.activeTicks === undefined ? 1 - hz.ticksLeft / Math.max(1, hz.totalTicks) : 1;
      const seed = (hz.group ?? 0) * 7 + Math.round(hz.x) * 3 + Math.round(hz.y);
      if (move.id === 'articuno-ice-shard-bullet' && hz.activeTicks !== undefined) this.drawIcicle(hz, move.bullets?.speed ?? 0, world.dt, frac);
      else if (move.id === 'articuno-icy-wind' && hz.activeTicks !== undefined) this.drawWind(hz, move.arc ?? 70, timeMs, seed);
      else if (move.arenaPaths) this.drawFreezeDry(world, hz, move, p, seed);
      else if (move.id === 'articuno-hailstone') {
        if (hz.activeTicks === undefined) this.drawHail(hz, p);
        else if (!this.seenHail.has(hz)) {
          this.seenHail.add(hz);
          this.shatters.push({ x: hz.x, y: hz.y, at: timeMs });
        }
      } else if (move.follow && hz.activeTicks === undefined) this.drawReticle(world, hz, move.follow.seconds, timeMs);
      else if (move.id === 'articuno-sheer-cold' && hz.activeTicks !== undefined && !this.seenBlast.has(hz)) {
        this.seenBlast.add(hz);
        this.blasts.push({ x: hz.x, y: hz.y, r: hz.radius, at: timeMs });
      }
    }
    // 古い印は忘れる（範囲は消えると一覧から外れる）
    if (this.seenHail.size > 400) this.seenHail = new Set([...this.seenHail].filter((h) => world.hazards.includes(h as World['hazards'][number])));
    if (this.seenBlast.size > 20) this.seenBlast.clear();
    this.shatters = this.shatters.filter((s) => timeMs - s.at < 350);
    for (const s of this.shatters) {
      const t = (timeMs - s.at) / 350;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + s.at;
        const d = 6 + 30 * t;
        this.g.fillStyle(0xe1f5fe, 0.9 * (1 - t)).fillRect(s.x + Math.cos(a) * d - 2, s.y + Math.sin(a) * d * 0.6 - 2, 4, 4);
      }
    }
    this.blasts = this.blasts.filter((b) => timeMs - b.at < 900);
    for (const b of this.blasts) this.drawBlast(b, timeMs);
    for (let k = this.used; k < this.pool.length; k++) this.pool[k]!.setVisible(false);
  }

  private drawIcicle(hz: World['hazards'][number], speed: number, dt: number, frac: number): void {
    const back = speed * dt * (1 - frac);
    const x = hz.x - hz.dirX * back;
    const y = hz.y - hz.dirY * back;
    const rot = Math.atan2(hz.dirY, hz.dirX);
    for (let k = 1; k <= 4; k++) this.g.fillStyle(0xb3e5fc, 0.35 / k).fillCircle(x - hz.dirX * k * 14, y - hz.dirY * k * 14, 7 - k);
    this.image('articuno-icicle').setPosition(x, y).setRotation(rot).setScale(DOT * 1.6).setDepth(this.depth + 0.02);
  }

  /** こごえるかぜ: 扇の中を外へ流れる雪の筋 */
  private drawWind(hz: World['hazards'][number], arc: number, timeMs: number, seed: number): void {
    const base = Math.atan2(hz.dirY, hz.dirX);
    const half = (arc * Math.PI) / 360;
    this.g.fillStyle(0xb3e5fc, 0.1).slice(hz.x, hz.y, hz.radius, base - half, base + half, false).fillPath();
    for (let k = 0; k < 46; k++) {
      const a = base + (rnd(seed, k) * 2 - 1) * half;
      const d = ((timeMs * 0.9 + rnd(seed, k + 50) * hz.radius) % hz.radius) + 20;
      const len = 18 + rnd(seed, k + 90) * 22;
      const x = hz.x + Math.cos(a) * d;
      const y = hz.y + Math.sin(a) * d;
      this.g.lineStyle(k % 3 === 0 ? 3 : 2, 0xf1fbff, 0.75).lineBetween(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len);
    }
  }

  /** フリーズドライ: 予告の間は水に霜が広がり、落ちると氷のとげが立つ */
  private drawFreezeDry(world: World, hz: World['hazards'][number], move: NonNullable<World['rules']['stage']['moves'][number]>, p: number, seed: number): void {
    // 帯（線）に沿って霜の円を並べる。予告の間は霜が広がり、落ちると氷のとげが立つ
    const step = hz.radius * 1.3;
    const n = Math.max(1, Math.ceil(hz.length / step));
    const total = Math.round((move.activeSeconds ?? 1) / world.dt);
    const active = hz.activeTicks !== undefined;
    const age = active ? (total - hz.activeTicks!) * world.dt : 0;
    const rise = Math.min(1, age / 0.15);
    const fade = active ? Math.min(1, (hz.activeTicks! * world.dt) / 0.4) : 1;
    // 帯全体を薄い霜の色で（円を重ねると数珠に見えた）
    const ex = hz.x + hz.dirX * hz.length;
    const ey = hz.y + hz.dirY * hz.length;
    const band = active ? 0.42 * fade : 0.08 + 0.3 * p;
    this.gn.lineStyle(hz.radius * 2, 0xcfeaf7, band).lineBetween(hz.x, hz.y, ex, ey);
    for (let k = 0; k <= n; k++) {
      const d = (k / n) * hz.length;
      const x = hz.x + hz.dirX * d;
      const y = hz.y + hz.dirY * d;
      const s2 = seed + k * 13;
      const sc = ((hz.radius * 2) / FROST) * (active ? 1 : Math.max(0.05, p));
      this.image('articuno-frost').setPosition(x, y).setScale(sc).setRotation(s2).setAlpha(active ? 0.6 * fade : 0.15 + 0.4 * p).setDepth(this.floorDepth + 0.01);
      if (!active) continue;
      for (let j = 0; j < 3; j++) {
        const a = rnd(s2, j) * Math.PI * 2;
        const r = Math.sqrt(rnd(s2, j + 7)) * hz.radius * 0.7;
        const sx = x + Math.cos(a) * r;
        const sy = y + Math.sin(a) * r * 0.8;
        this.image(`articuno-spike-${(s2 + j) % SPIKE_KINDS}`)
          .setPosition(sx, sy)
          .setOrigin(0.5, 1)
          .setScale(DOT * (0.9 + rnd(s2, j + 3) * 0.5), DOT * rise * (0.9 + rnd(s2, j + 3) * 0.5))
          .setAlpha(fade)
          .setDepth(this.depth + sy / 100000);
      }
    }
  }

  /** 雹: 地面の影が濃くなり、上から氷の粒が落ちてくる */
  private drawHail(hz: World['hazards'][number], p: number): void {
    // 落ちる直前の影は、当たる広さ（直径）と同じ横幅
    this.gn.fillStyle(0x0d1b2a, 0.15 + 0.4 * p).fillEllipse(hz.x, hz.y, hz.radius * 2 * (0.5 + 0.5 * p), hz.radius * 0.9 * (0.5 + 0.5 * p));
    const fall = (1 - p) * (1 - p) * 260;
    if (p > 0.35) this.image('articuno-hail').setPosition(hz.x, hz.y - fall).setScale(DOT * 1.3).setRotation(p * 4).setDepth(this.depth + 0.03);
  }

  /** マインドリーダー: 追っている間は細い照準、止まると太く締まる */
  private drawReticle(world: World, hz: World['hazards'][number], followSeconds: number, timeMs: number): void {
    const elapsed = (hz.totalTicks - hz.ticksLeft) * world.dt;
    const locked = elapsed >= followSeconds;
    const r = hz.radius;
    const spin = timeMs / 700;
    const col = locked ? 0xff8a80 : 0xb3e5fc;
    this.gn.lineStyle(locked ? 5 : 3, col, locked ? 0.95 : 0.7).strokeCircle(hz.x, hz.y, r);
    this.gn.lineStyle(2, col, 0.6).strokeCircle(hz.x, hz.y, r * 0.55);
    for (let k = 0; k < 4; k++) {
      const a = spin + (k * Math.PI) / 2;
      this.gn.lineStyle(locked ? 5 : 3, col, 0.9).lineBetween(hz.x + Math.cos(a) * r * 0.75, hz.y + Math.sin(a) * r * 0.75, hz.x + Math.cos(a) * r * 1.12, hz.y + Math.sin(a) * r * 1.12);
    }
    if (locked) {
      const t = Math.min(1, (elapsed - followSeconds) / Math.max(0.1, hz.totalTicks * world.dt - followSeconds));
      this.gn.fillStyle(0xe1f5fe, 0.12 + 0.25 * t).fillCircle(hz.x, hz.y, r * t);
    }
  }

  /** ぜったいれいど: 白い冷気が広がり、輪の上に氷のとげが立って溶ける */
  private drawBlast(b: { x: number; y: number; r: number; at: number }, timeMs: number): void {
    const t = (timeMs - b.at) / 900;
    this.g.fillStyle(0xe1f5fe, 0.55 * (1 - t)).fillCircle(b.x, b.y, b.r * (0.6 + 0.4 * Math.min(1, t * 3)));
    this.g.lineStyle(6, 0xffffff, 0.8 * (1 - t)).strokeCircle(b.x, b.y, b.r * (0.9 + 0.2 * t));
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2 + b.at;
      const x = b.x + Math.cos(a) * b.r * 0.85;
      const y = b.y + Math.sin(a) * b.r * 0.85;
      this.image(`articuno-spike-${k % SPIKE_KINDS}`)
        .setPosition(x, y)
        .setOrigin(0.5, 1)
        .setScale(DOT * 1.3, DOT * 1.3 * Math.min(1, t * 6))
        .setAlpha(1 - t * t)
        .setDepth(this.depth + y / 100000);
    }
  }
}
