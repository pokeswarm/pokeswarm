import Phaser from 'phaser';
import { findEnemyIndex, type World } from '../../sim/world';

/** 1 ドット（ワールドの単位） */
const DOT = 2;
/** 岩の絵の大きさ（ドット）・種類 */
const ROCK_W = 26;
const ROCK_H = 22;
const ROCK_KINDS = 4;
/** 岩の絵の 1 ドット（ワールドの単位。大きく見せる）と、持ち上げる高さ */
const ROCK_DOT = 3;
const LIFT = 40;
/** はどうだんの玉の絵の大きさ（ドット）・渦のコマ数 */
const ORB = 40;
const ORB_FRAMES = 8;
const ORB_FRAME_MS = 70;
const SHARD = 16;
/** バリアーの殻の絵（ドット）・光の帯のコマ数 */
const SHELL_W = 64;
const SHELL_H = 80;
const SHELL_FRAMES = 10;
const SHELL_FRAME_MS = 90;
/** 飛ぶ岩の残像の数 */
const TRAILS = 3;

const abgr = (r: number, g: number, b: number, a = 1): number => ((Math.round(Math.max(0, Math.min(1, a)) * 255) << 24) | (b << 16) | (g << 8) | r) >>> 0;

/** 決まった乱数（0〜1） */
function rnd(a: number, b: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/** 岩の形（ドット）: でこぼこの輪郭の塊。中なら輪郭からの距離 */
function rockShape(kind: number): Float32Array {
  const d = new Float32Array(ROCK_W * ROCK_H).fill(-1);
  const cx = ROCK_W / 2 - 0.5;
  const cy = ROCK_H / 2 + 0.5;
  const rx = ROCK_W / 2 - 1.5;
  const ry = ROCK_H / 2 - 2;
  // 角ばった輪郭: 角度ごとの半径を少ない点でつなぐ
  const corners = 7 + (kind % 3);
  const radius = (a: number): number => {
    const t = ((a / (Math.PI * 2)) * corners + corners) % corners;
    const k = Math.floor(t);
    const f = t - k;
    const r0 = 0.74 + rnd(kind, k) * 0.26;
    const r1 = 0.74 + rnd(kind, (k + 1) % corners) * 0.26;
    return r0 + (r1 - r0) * f;
  };
  for (let y = 0; y < ROCK_H; y++) {
    for (let x = 0; x < ROCK_W; x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const r = Math.hypot(nx, ny);
      const edge = radius(Math.atan2(ny, nx)) - r;
      if (edge > 0) d[y * ROCK_W + x] = edge * Math.min(rx, ry);
    }
  }
  return d;
}

/**
 * ミュウツーの技の絵（07 の〔ミュウツー〕章）: テレポートの光・サイコキネシスで持ち上げて投げる岩・はどうだん（ためる玉・飛ぶ玉・弾けた小さな玉）。
 * 見た目だけ（当たりはシミュレーション）
 */
export class MewtwoPsychic {
  private built = false;
  private readonly pool: Phaser.GameObjects.Image[] = [];
  private used = 0;
  private readonly g: Phaser.GameObjects.Graphics;
  /** 加算しない絵（地面の影・テレポートの輪。明るい床でも見える） */
  private readonly gn: Phaser.GameObjects.Graphics;
  private lastTick = -1;
  private tickMs = 0;
  /** バリアーが割れた時と場所（破片が散る） */
  private shatter: { x: number; y: number; at: number } | null = null;
  private wasBreaking = false;
  /** 消えたボスの最後の場所（消える瞬間の光） */
  private vanish: { x: number; y: number; at: number } | null = null;
  private wasHidden = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
    private readonly floorDepth: number,
    /** ボスの絵より手前（ためる玉は体の前に） */
    private readonly frontDepth: number,
  ) {
    this.g = scene.add.graphics().setDepth(depth - 0.01).setBlendMode(Phaser.BlendModes.ADD);
    this.gn = scene.add.graphics().setDepth(depth - 0.02);
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
    for (let k = 0; k < ROCK_KINDS; k++) {
      const shape = rockShape(k);
      // 岩: 上の面は明るく、下は暗い。割れ目の筋と小さな斑点
      put(`mewtwo-rock-${k}`, ROCK_W, ROCK_H, (out) => {
        for (let y = 0; y < ROCK_H; y++) {
          for (let x = 0; x < ROCK_W; x++) {
            const e = shape[y * ROCK_W + x]!;
            if (e < 0) continue;
            const i = y * ROCK_W + x;
            if (e < 1) {
              out[i] = abgr(38, 32, 40);
              continue;
            }
            const up = shape[(y - 2) * ROCK_W + x] ?? -1;
            const top = y < 2 || up < 0;
            const k2 = y / ROCK_H;
            let r = 150 - 70 * k2;
            let g = 140 - 66 * k2;
            let b = 130 - 52 * k2;
            if (top) {
              r += 40;
              g += 38;
              b += 34;
            }
            // 面の分かれ目（斜めの筋）
            const facet = Math.sin((x * 0.9 + y * 1.6 + k * 5) * 0.55);
            if (facet > 0.86) {
              r -= 30;
              g -= 30;
              b -= 26;
            } else if (facet > 0.6) {
              r += 12;
              g += 12;
              b += 10;
            }
            if (rnd(x + k * 31, y) > 0.93) {
              r -= 22;
              g -= 22;
              b -= 18;
            }
            out[i] = abgr(Math.round(r), Math.round(g), Math.round(b));
          }
        }
      });
      // 念力の光: 岩の外側を包む紫の縁（中ほど濃く、外へ薄く）
      const pad = 4;
      const gw = ROCK_W + pad * 2;
      const gh = ROCK_H + pad * 2;
      put(`mewtwo-rock-glow-${k}`, gw, gh, (out) => {
        for (let y = 0; y < gh; y++) {
          for (let x = 0; x < gw; x++) {
            let near = 99;
            for (let dy = -pad; dy <= pad; dy++) {
              for (let dx = -pad; dx <= pad; dx++) {
                const sx = x - pad + dx;
                const sy = y - pad + dy;
                if (sx < 0 || sy < 0 || sx >= ROCK_W || sy >= ROCK_H || shape[sy * ROCK_W + sx]! < 0) continue;
                near = Math.min(near, Math.hypot(dx, dy));
              }
            }
            if (near > pad) continue;
            const a = 1 - near / (pad + 0.5);
            out[y * gw + x] = abgr(170, 84, 240, a * 0.85);
          }
        }
      });
    }
    // はどうだん: 白い芯・水色・青の外側。渦の筋が回る
    for (let f = 0; f < ORB_FRAMES; f++) {
      put(`mewtwo-orb-${f}`, ORB, ORB, (out) => {
        const c = (ORB - 1) / 2;
        for (let y = 0; y < ORB; y++) {
          for (let x = 0; x < ORB; x++) {
            const dx = x - c;
            const dy = y - c;
            const r = Math.hypot(dx, dy) / (ORB / 2);
            if (r > 1) continue;
            const a = Math.atan2(dy, dx);
            const swirl = Math.sin(a * 3 + r * 7 - (f / ORB_FRAMES) * Math.PI * 2);
            let col: number;
            if (r < 0.32) col = abgr(240, 252, 255);
            else if (r < 0.55) col = swirl > 0.3 ? abgr(200, 240, 255) : abgr(120, 206, 250);
            else if (r < 0.82) col = swirl > 0.45 ? abgr(130, 210, 252, 0.95) : abgr(52, 140, 232, 0.9);
            else col = swirl > 0.2 ? abgr(70, 150, 240, 0.55 * (1 - r) * 5) : abgr(30, 90, 200, 0.4 * (1 - r) * 5);
            out[y * ORB + x] = col;
          }
        }
      });
    }
    put('mewtwo-shard', SHARD, SHARD, (out) => {
      const c = (SHARD - 1) / 2;
      for (let y = 0; y < SHARD; y++) {
        for (let x = 0; x < SHARD; x++) {
          const r = Math.hypot(x - c, y - c) / (SHARD / 2);
          if (r > 1) continue;
          out[y * SHARD + x] = r < 0.35 ? abgr(236, 250, 255) : r < 0.7 ? abgr(110, 200, 250) : abgr(40, 120, 230, (1 - r) * 3);
        }
      }
    });
    // バリアー: 六角の格子の殻（縁は明るく、面は薄い紫）。斜めの光の帯が流れる
    for (let f = 0; f < SHELL_FRAMES; f++) {
      put(`mewtwo-shell-${f}`, SHELL_W, SHELL_H, (out) => {
        const cx = (SHELL_W - 1) / 2;
        const cy = (SHELL_H - 1) / 2;
        const band = (f / SHELL_FRAMES) * (SHELL_W + SHELL_H) * 1.4 - 30;
        for (let y = 0; y < SHELL_H; y++) {
          for (let x = 0; x < SHELL_W; x++) {
            const nx = (x - cx) / (SHELL_W / 2);
            const ny = (y - cy) / (SHELL_H / 2);
            const r = Math.hypot(nx, ny);
            if (r > 1) continue;
            // 六角の格子（横に並ぶ六角形。ふちの近くほど目が細かく見えるよう、球に貼ったように縮める）
            const z = Math.sqrt(Math.max(0, 1 - r * r));
            const u = (nx / (0.55 + 0.45 * z)) * 5.2;
            const v = (ny / (0.55 + 0.45 * z)) * 5.2;
            const q = (u * 2) / 3;
            const rr = -u / 3 + (Math.sqrt(3) / 3) * v;
            const fq = q - Math.round(q);
            const fr = rr - Math.round(rr);
            const fs = -q - rr - Math.round(-q - rr);
            const edge = Math.max(Math.abs(fq), Math.abs(fr), Math.abs(fs));
            const line = edge > 0.4;
            const rim = r > 0.9;
            const glint = Math.abs(x + y * 0.7 - band) < 4;
            let a = 0.14 + 0.2 * (1 - z);
            let c = abgr(186, 120, 255, a);
            if (line) c = abgr(220, 180, 255, 0.55 + 0.3 * (1 - z));
            if (rim) c = abgr(236, 214, 255, 0.85);
            if (glint && (line || rim)) c = abgr(255, 255, 255, 0.95);
            else if (glint) c = abgr(230, 210, 255, a + 0.2);
            out[y * SHELL_W + x] = c;
          }
        }
      });
    }
    put('mewtwo-shell-bit', 6, 6, (out) => {
      for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) if (Math.abs(x - 2.5) + Math.abs(y - 2.5) < 3.2) out[y * 6 + x] = Math.abs(x - 2.5) + Math.abs(y - 2.5) < 1.6 ? abgr(250, 240, 255) : abgr(196, 140, 255, 0.9);
    });
    put('mewtwo-shadow', 14, 6, (out) => {
      for (let y = 0; y < 6; y++) for (let x = 0; x < 14; x++) if (((x - 6.5) / 7) ** 2 + ((y - 2.5) / 3) ** 2 <= 1) out[y * 14 + x] = abgr(10, 6, 20, 0.45);
    });
  }

  private image(key: string): Phaser.GameObjects.Image {
    let img = this.pool[this.used];
    if (!img) {
      img = this.scene.add.image(0, 0, key);
      this.pool.push(img);
    }
    this.used++;
    return img.setTexture(key).setVisible(true).setAlpha(1).setRotation(0).setBlendMode(Phaser.BlendModes.NORMAL).setOrigin(0.5, 0.5);
  }

  update(world: World, timeMs: number): void {
    this.used = 0;
    this.g.clear();
    this.gn.clear();
    const moves = world.rules.stage.moves;
    const any = world.hazards.some((h) => moves[h.move]?.id.startsWith('mewtwo-'));
    if (any || this.vanish) this.build();
    if (world.tick !== this.lastTick) {
      this.lastTick = world.tick;
      this.tickMs = timeMs;
    }
    // 1 回の更新の中の、どれだけ進んだか（飛ぶ物を滑らかに）
    const frac = Math.min(1, (timeMs - this.tickMs) / (world.dt * 1000));
    for (const hz of world.hazards) {
      const move = moves[hz.move];
      if (!move?.id.startsWith('mewtwo-')) continue;
      const progress = hz.activeTicks === undefined ? 1 - hz.ticksLeft / Math.max(1, hz.totalTicks) : 1;
      const seed = (hz.group ?? 0) * 7 + Math.round(hz.x) + Math.round(hz.y) * 3;
      if (move.liftThrow && hz.activeTicks === undefined) this.drawLift(hz, progress, seed, timeMs);
      else if (move.id === 'mewtwo-rock' && hz.activeTicks !== undefined) this.drawRock(hz, move.bullets?.speed ?? 0, world.dt, frac, seed, timeMs);
      else if (move.blink && hz.activeTicks === undefined) this.drawBlink(hz.x, hz.y, progress, timeMs);
      else if (move.then === 'mewtwo-aura-orb' && hz.activeTicks === undefined) this.drawCharge(world, hz.dasher, progress, timeMs);
      else if (move.bullets?.burst && hz.activeTicks !== undefined) this.drawOrb(hz, move.bullets.speed, world.dt, frac, timeMs);
      else if (move.id === 'mewtwo-aura-shard' && hz.activeTicks !== undefined) this.drawShard(hz, move.bullets?.speed ?? 0, world.dt, frac);
      else if (move.barrier && hz.activeTicks !== undefined && !world.hiddenEnemies.has(hz.dasher)) this.drawShell(world, hz, timeMs);
      else if (move.arms && move.sweep) this.drawPsystrike(hz, move.sweep, progress, timeMs);
    }
    // バリアーが割れる: 殻の破片が外へ散る
    const breaking = world.hazards.find((h) => moves[h.move]?.clearsBarrier && moves[h.move]?.id.startsWith('mewtwo-'));
    if (breaking && !this.wasBreaking) {
      const i = findEnemyIndex(world, breaking.dasher);
      if (i !== -1) this.shatter = { x: world.enemies.x[i]!, y: world.enemies.y[i]! - 34, at: timeMs };
    }
    this.wasBreaking = !!breaking;
    if (this.shatter) {
      const t = (timeMs - this.shatter.at) / 700;
      if (t >= 1) this.shatter = null;
      else {
        for (let k = 0; k < 22; k++) {
          const a = (k / 22) * Math.PI * 2 + rnd(k, 5) * 0.3;
          const d = 50 + (120 + rnd(k, 6) * 90) * (1 - (1 - t) * (1 - t));
          this.image('mewtwo-shell-bit').setPosition(this.shatter.x + Math.cos(a) * d * 0.9, this.shatter.y + Math.sin(a) * d * 1.1 + t * t * 40).setScale(DOT * (1 + rnd(k, 7))).setRotation(t * 6 + k).setAlpha(1 - t).setDepth(this.frontDepth);
        }
        this.g.lineStyle(4, 0xe1bee7, 0.8 * (1 - t)).strokeEllipse(this.shatter.x, this.shatter.y, 128 + t * 60, 160 + t * 60);
      }
    }
    // 消える瞬間（テレポートの予告が出た時、ボスの場所に紫の光が縮む）
    const hidden = world.hazards.some((h) => moves[h.move]?.blink && h.activeTicks === undefined);
    if (hidden && !this.wasHidden) {
      const h = world.hazards.find((x) => moves[x.move]?.blink)!;
      const i = findEnemyIndex(world, h.dasher);
      if (i !== -1) this.vanish = { x: world.enemies.x[i]!, y: world.enemies.y[i]!, at: timeMs };
    }
    this.wasHidden = hidden;
    if (this.vanish) {
      const t = (timeMs - this.vanish.at) / 380;
      if (t >= 1) this.vanish = null;
      else {
        const r = 64 * (1 - t);
        this.gn.lineStyle(3, 0xb388ff, 0.8 * (1 - t)).strokeEllipse(this.vanish.x, this.vanish.y - 30, r * 1.3, r * 2.2);
        this.g.fillStyle(0xf3d6ff, 0.35 * (1 - t)).fillEllipse(this.vanish.x, this.vanish.y - 30, r * 0.5, r * 1.6);
      }
    }
    for (let k = this.used; k < this.pool.length; k++) this.pool[k]!.setVisible(false);
  }

  /** 持ち上げる: 地面から浮き上がり、紫の光をまとう。足元に影 */
  private drawLift(hz: World['hazards'][number], p: number, seed: number, timeMs: number): void {
    const kind = Math.floor(rnd(seed, 1) * ROCK_KINDS);
    // 初めの 0.25 は地面から割れて出る（少し揺れる）、その後ふわりと上がる
    const rise = p < 0.25 ? 0 : Math.min(1, (p - 0.25) / 0.45);
    const ease = 1 - (1 - rise) * (1 - rise);
    const bob = Math.sin(timeMs / 260 + seed) * 2 * rise;
    const shake = p < 0.25 ? Math.sin(timeMs / 30 + seed) * 1.2 : 0;
    const y = hz.y - LIFT * ease + bob;
    const rot = (rnd(seed, 2) - 0.5) * 0.5 + Math.sin(timeMs / 600 + seed) * 0.08 * rise;
    const shadow = this.image('mewtwo-shadow').setPosition(hz.x, hz.y + 12).setScale(ROCK_DOT * (1 - 0.3 * ease)).setAlpha(0.8).setDepth(this.floorDepth);
    void shadow;
    const glow = 0.45 + 0.25 * Math.sin(timeMs / 420 + seed);
    this.image(`mewtwo-rock-glow-${kind}`).setPosition(hz.x + shake, y).setScale(ROCK_DOT).setRotation(rot).setAlpha(Math.min(1, p * 3) * glow).setDepth(this.depth);
    this.image(`mewtwo-rock-${kind}`).setPosition(hz.x + shake, y).setScale(ROCK_DOT).setRotation(rot).setDepth(this.depth + 0.01);
    // 割れて出るときの砂ぼこり（地面から上がる小さな粒）
    if (p < 0.5) {
      for (let k = 0; k < 5; k++) {
        const t = (p * 2 + rnd(seed, k + 10) * 0.5) % 1;
        const px = hz.x + (rnd(seed, k + 20) - 0.5) * 40;
        const py = hz.y + 8 - t * 22;
        this.g.fillStyle(0xb39ddb, 0.5 * (1 - t)).fillRect(px - 1.5, py - 1.5, 3, 3);
      }
    }
  }

  /** 飛ぶ岩: 進む向きに回りながら、紫の残像を引く */
  private drawRock(hz: World['hazards'][number], speed: number, dt: number, frac: number, seed: number, timeMs: number): void {
    const kind = Math.floor(rnd(seed, 1) * ROCK_KINDS);
    const back = speed * dt * (1 - frac);
    const x = hz.x - hz.dirX * back;
    const y = hz.y - hz.dirY * back - LIFT;
    const rot = timeMs / 90 + seed;
    for (let k = TRAILS; k >= 1; k--) {
      const d = k * 22;
      this.image(`mewtwo-rock-glow-${kind}`).setPosition(x - hz.dirX * d, y - hz.dirY * d).setScale(ROCK_DOT * (1 - k * 0.12)).setRotation(rot - k * 0.3).setAlpha(0.32 / k).setDepth(this.depth);
    }
    this.image(`mewtwo-rock-glow-${kind}`).setPosition(x, y).setScale(ROCK_DOT).setRotation(rot).setAlpha(0.6).setDepth(this.depth);
    this.image(`mewtwo-rock-${kind}`).setPosition(x, y).setScale(ROCK_DOT).setRotation(rot).setDepth(this.depth + 0.01);
    this.image('mewtwo-shadow').setPosition(x, hz.y - hz.dirY * back + 12).setScale(ROCK_DOT * 0.8).setAlpha(0.6).setDepth(this.floorDepth);
  }

  /** テレポートの先: 地面に紫の影が濃くなり、輪が縮み、光の粒が渦を巻いて集まる */
  private drawBlink(x: number, y: number, p: number, timeMs: number): void {
    const cy = y - 34;
    this.gn.fillStyle(0x4a148c, 0.12 + 0.3 * p).fillEllipse(x, y + 10, 50 + 40 * p, 16 + 12 * p);
    const r = 90 * (1 - p) + 16;
    this.gn.lineStyle(3, 0xb388ff, 0.35 + 0.5 * p).strokeEllipse(x, cy, r * 1.2, r * 2);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + p * 5 + timeMs / 700;
      const rr = 80 * (1 - p) + 10;
      this.gn.fillStyle(k % 2 ? 0xf3e5ff : 0xce93d8, 0.5 + 0.5 * p).fillRect(x + Math.cos(a) * rr - 3, cy + Math.sin(a) * rr * 0.8 - 3, 6, 6);
    }
    if (p > 0.7) this.g.fillStyle(0xf3d6ff, (p - 0.7) * 2).fillEllipse(x, cy, 34, 80);
  }

  /** はどうだんを ためる: 胸の前に青い玉が育ち、まわりの光の筋が集まる */
  private drawCharge(world: World, dasher: number, p: number, timeMs: number): void {
    const i = findEnemyIndex(world, dasher);
    if (i === -1) return;
    const x = world.enemies.x[i]! + 0;
    const y = world.enemies.y[i]! - 30;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + timeMs / 500;
      const r0 = 80 * (1 - ((p * 2 + k / 8) % 1));
      this.g.lineStyle(2, 0x7fd8ff, 0.5).lineBetween(x + Math.cos(a) * r0, y + Math.sin(a) * r0, x + Math.cos(a) * (r0 * 0.7), y + Math.sin(a) * (r0 * 0.7));
    }
    const frame = Math.floor(timeMs / ORB_FRAME_MS) % ORB_FRAMES;
    this.image(`mewtwo-orb-${frame}`).setPosition(x, y).setScale(DOT * (0.15 + 0.7 * p)).setDepth(this.frontDepth);
  }

  /** 飛ぶ はどうだん */
  private drawOrb(hz: World['hazards'][number], speed: number, dt: number, frac: number, timeMs: number): void {
    const back = speed * dt * (1 - frac);
    const x = hz.x - hz.dirX * back;
    const y = hz.y - hz.dirY * back;
    const frame = Math.floor(timeMs / ORB_FRAME_MS) % ORB_FRAMES;
    this.g.fillStyle(0x4fc3f7, 0.18).fillCircle(x, y, 46);
    for (let k = 1; k <= 3; k++) this.g.fillStyle(0x4fc3f7, 0.12 / k).fillCircle(x - hz.dirX * k * 14, y - hz.dirY * k * 14, 34 - k * 4);
    this.image(`mewtwo-orb-${frame}`).setPosition(x, y).setScale(DOT * 0.9).setDepth(this.depth + 0.02);
  }

  /** バリアーの殻: ボスを包む六角の格子。張った直後は外から縮んで現れる */
  private drawShell(world: World, hz: World['hazards'][number], timeMs: number): void {
    const i = findEnemyIndex(world, hz.dasher);
    if (i === -1) return;
    const frame = Math.floor(timeMs / SHELL_FRAME_MS) % SHELL_FRAMES;
    const total = Math.round((world.rules.stage.moves[hz.move]?.activeSeconds ?? 1) / world.dt);
    const age = (total - (hz.activeTicks ?? 0)) * world.dt;
    const open = Math.min(1, age / 0.3);
    // 消える前の 1.5 秒は、ゆっくり薄くなる（点滅させない）
    const left = (hz.activeTicks ?? 0) * world.dt;
    const fade = Math.min(1, left / 1.5);
    this.image(`mewtwo-shell-${frame}`).setPosition(world.enemies.x[i]!, world.enemies.y[i]! - 34).setScale(DOT * (1.25 - 0.25 * open)).setAlpha(open * (0.4 + 0.6 * fade)).setDepth(this.frontDepth);
  }

  /** サイコブレイク: 予告は細い光と回る向きの弧、当たっている間は太い念の光（中は白く、外は桃色） */
  private drawPsystrike(hz: World['hazards'][number], sweep: { degrees: number }, p: number, timeMs: number): void {
    const len = hz.length;
    const ex = hz.x + hz.dirX * len;
    const ey = hz.y + hz.dirY * len;
    if (hz.activeTicks === undefined) {
      this.gn.lineStyle(4, 0xf48fb1, 0.3 + 0.5 * p).lineBetween(hz.x, hz.y, ex, ey);
      // 回る向き: 線の先から、回る側へ伸びる弧（だんだん伸びる）
      const a0 = Math.atan2(hz.dirY, hz.dirX);
      const a1 = a0 + ((sweep.degrees * Math.PI) / 180) * 0.35 * p;
      for (const r of [180, 320, 460]) {
        this.gn.lineStyle(5, 0xec407a, 0.55 * p);
        this.gn.beginPath();
        this.gn.arc(hz.x, hz.y, r, Math.min(a0, a1), Math.max(a0, a1), false);
        this.gn.strokePath();
      }
      return;
    }
    // 当たる幅（52）と同じ太さの光。明るい床でも見えるよう、加算しない色で重ねる
    this.gn.lineStyle(68, 0xad1457, 0.25).lineBetween(hz.x, hz.y, ex, ey);
    this.gn.lineStyle(52, 0xec407a, 0.6).lineBetween(hz.x, hz.y, ex, ey);
    this.gn.lineStyle(30, 0xf8bbd0, 0.85).lineBetween(hz.x, hz.y, ex, ey);
    this.gn.lineStyle(12, 0xffffff, 0.95).lineBetween(hz.x, hz.y, ex, ey);
    // 念の揺らぎ: 外へ流れる輪
    for (let k = 0; k < 12; k++) {
      const d = (timeMs * 0.5 + k * 150) % Math.min(len, 1800);
      const px = hz.x + hz.dirX * d;
      const py = hz.y + hz.dirY * d;
      this.g.lineStyle(4, 0xffc1e3, 0.6).strokeEllipse(px, py, 64, 64);
    }
  }

  /** 弾けた小さな玉 */
  private drawShard(hz: World['hazards'][number], speed: number, dt: number, frac: number): void {
    const back = speed * dt * (1 - frac);
    const x = hz.x - hz.dirX * back;
    const y = hz.y - hz.dirY * back;
    this.g.fillStyle(0x4fc3f7, 0.25).fillCircle(x, y, 18);
    this.image('mewtwo-shard').setPosition(x, y).setScale(DOT).setDepth(this.depth + 0.02);
  }
}
