import Phaser from 'phaser';
import type { World } from '../../sim/world';
import { aimOf, articunoReach } from '../../sim/activeSkills';
import { FROST_ENCASED, frostFull } from '../../sim/systems/attack';
import { DotPool, c, makeTexture, on, rnd, shade } from './dotArt';

/**
 * 遊べるフリーザーの技の絵（07 の314章）:
 * - フリーズドライ: 足元から霜の線が 2 本、地面を這って伸び（羽のような霜の枝）、霜が通った少し後に、根元から順に氷のとげが突き出す。とげは少し残って砕ける
 * - こごえるかぜ: 向いている扇の中を、雪の筋と粒が外へ流れる
 * - ふぶき: 横に長い吹雪の帯（雪の壁）が前へ進み、前へ雪の粒が吹き付ける
 * - こおりのつぶて: 小さなつらら
 * - しもやけ: 重ねた数だけ敵の足元に氷の粒。重ねきった敵は頭の上に雪の結晶の印。氷漬けの敵は氷の塊に閉じ込められ、溶けると砕ける
 * 霜・氷・雪はすべて 1 ドットずつ計算した不透明のドット絵（薄い塗りは使わない。画面全体は光らせない。画面は揺らさない）
 */

const SPIKE_W = 24;
const SPIKE_H = 32;
const SPIKE_KINDS = 4;
const BLOCK = 32;
const PUFF_W = 32;
const PUFF_H = 24;
const PUFF_KINDS = 3;
const ICICLE_W = 16;
const ICICLE_H = 6;
const FLAKE = 9;
const STREAK_W = 24;
const STREAK_H = 5;
/** とげが立ち上がる・残る・砕ける時間 */
const SPIKE_RISE_MS = 90;
const SPIKE_HOLD_MS = 700;
const SPIKE_BREAK_MS = 260;
const SHATTER_MS = 420;

const ICE = [0x2f6f9f, 0x4f9cc9, 0x8fd0f0, 0xd2efff, 0xffffff];
const SNOW = [0x7ec8ee, 0xb3e5fc, 0xe3f6ff, 0xffffff];

type Spike = { x: number; y: number; r: number; at: number; seed: number };
type Shatter = { x: number; y: number; r: number; at: number; seed: number; big: boolean };

export class ArticunoPlayer {
  private built = false;
  private readonly pool: DotPool;
  private readonly front: DotPool;
  private readonly floorLines: Phaser.GameObjects.Graphics;
  private frostLines = new Map<number, number>();
  private spikes: Spike[] = [];
  private shatters: Shatter[] = [];
  private shards = new Map<number, { x: number; y: number }>();
  private encased = new Map<number, { x: number; y: number; r: number }>();
  private seen = new Set<number>();

  constructor(
    private readonly scene: Phaser.Scene,
    depth: number,
    floorDepth: number,
    private readonly frontDepth: number,
  ) {
    this.pool = new DotPool(scene, depth + 0.02);
    this.front = new DotPool(scene, frontDepth + 0.01);
    this.floorLines = scene.add.graphics().setDepth(floorDepth + 0.15);
  }

  private build(): void {
    if (this.built) return;
    this.built = true;
    const s = this.scene;
    // 氷のとげの塊（根元が広く、先がとがった 3〜4 本。左の面が明るい）
    for (let k = 0; k < SPIKE_KINDS; k++) {
      const n = 3 + (k % 2);
      const spikes = Array.from({ length: n }, (_, q) => ({
        bx: 4 + rnd(k, q) * (SPIKE_W - 8),
        tall: (q === 1 ? 0.95 : 0.55 + rnd(k, q + 5) * 0.35) * (SPIKE_H - 1),
        lean: (rnd(k, q + 9) - 0.5) * 0.5,
        half: 2.6 + rnd(k, q + 3) * 2.4,
      }));
      makeTexture(s, `af-spike-${k}`, SPIKE_W, SPIKE_H, (x, y) => {
        const h = SPIKE_H - 1 - y;
        for (const sp of spikes) {
          if (h > sp.tall) continue;
          const w = sp.half * (1 - h / sp.tall) + 0.4;
          const d = x - (sp.bx + sp.lean * h);
          if (Math.abs(d) > w) continue;
          // 左の面は明るく、右の面は青く。真ん中に光る筋
          if (Math.abs(d) < 0.6 && h > 3) return c(0xffffff);
          return d < 0 ? shade(ICE, 0.75 + (h / sp.tall) * 0.25, x, y) : shade(ICE, 0.25 + (h / sp.tall) * 0.4, x, y);
        }
        return 0;
      });
    }
    // 氷の塊（敵を閉じ込める。角の丸い四角に、斜めの面と光の筋）
    makeTexture(s, 'af-block', BLOCK, BLOCK, (x, y) => {
      const nx = (x - (BLOCK - 1) / 2) / (BLOCK / 2);
      const ny = (y - (BLOCK - 1) / 2) / (BLOCK / 2);
      const r = Math.max(Math.abs(nx), Math.abs(ny)) * 0.75 + Math.hypot(nx, ny) * 0.25;
      if (r > 0.98) return 0;
      if (r > 0.88) return c(0x4f9cc9);
      // 面: 左上は明るく、右下は濃い
      const f = 0.55 - (nx + ny) * 0.3;
      if (Math.abs(nx - ny * 0.6 + 0.35) < 0.07) return c(0xffffff);
      if (Math.abs(nx - ny * 0.6 - 0.1) < 0.04) return c(0xe3f6ff);
      // 中は少し透けて見えるように点を抜く（ディザ）
      if (r < 0.6 && !on(0.55, x, y)) return 0;
      return shade(ICE, f, x, y);
    });
    // 吹雪の雪のかたまり（もこもこした雪雲。左上が白く、右下が青い影。縁はディザで抜ける）
    for (let k = 0; k < PUFF_KINDS; k++) {
      const blobs = Array.from({ length: 4 }, (_, q) => ({ x: 8 + rnd(k, q) * 16, y: 9 + rnd(k, q + 4) * 7, r: 6 + rnd(k, q + 8) * 4 }));
      makeTexture(s, `af-puff-${k}`, PUFF_W, PUFF_H, (x, y) => {
        let best = 0;
        let nx = 0;
        let ny = 0;
        for (const b of blobs) {
          const d = 1 - Math.hypot(x - b.x, y - b.y) / b.r;
          if (d > best) {
            best = d;
            nx = (x - b.x) / b.r;
            ny = (y - b.y) / b.r;
          }
        }
        if (best <= 0) return 0;
        if (!on(Math.min(1, best * 3.2), x + k, y)) return 0;
        return shade([0x5fa8d8, ...SNOW], 0.62 - (nx + ny) * 0.38 + best * 0.2, x, y);
      });
    }
    // つらら（右向き。先がとがり、上の面が明るい）
    makeTexture(s, 'af-icicle', ICICLE_W, ICICLE_H, (x, y) => {
      const half = (ICICLE_H / 2) * (1 - x / ICICLE_W) + 0.3;
      const dy = y - (ICICLE_H - 1) / 2;
      if (Math.abs(dy) > half) return 0;
      return dy < -half * 0.2 ? c(0xffffff) : dy < half * 0.4 ? c(0xb3e5fc) : c(0x6fb8e0);
    });
    // 冷たい風の筋（右が先。白い頭から、青い尾が細くかすれていく）
    makeTexture(s, 'af-streak', STREAK_W, STREAK_H, (x, y) => {
      const t = x / (STREAK_W - 1);
      const w = 0.6 + t * 1.6;
      const d = Math.abs(y - (STREAK_H - 1) / 2);
      if (d > w) return 0;
      if (!on(0.25 + t * 0.9, x, y)) return 0;
      return t > 0.75 ? c(0xffffff) : t > 0.4 ? c(0xe3f6ff) : c(0x9fd8f5);
    });
    // 雪の結晶（6 本の枝）
    makeTexture(s, 'af-flake', FLAKE, FLAKE, (x, y) => {
      const cx = (FLAKE - 1) / 2;
      const dx = x - cx;
      const dy = y - cx;
      if (dx === 0 && Math.abs(dy) <= 4) return c(Math.abs(dy) < 2 ? 0xffffff : 0xb3e5fc);
      if (Math.abs(dy) === Math.round(Math.abs(dx) * 0.6) && Math.abs(dx) <= 3 && Math.sign(dy) * Math.sign(dx) !== 0) return c(0xe3f6ff);
      if (dy === 0 && Math.abs(dx) <= 1) return c(0xffffff);
      return 0;
    });
  }

  update(world: World, timeMs: number, localId: number, aimSlot: number | null): void {
    const moves = world.rules.moves;
    const fd = moves.findIndex((m) => m.key === 'freeze-dry-articuno');
    const iw = moves.findIndex((m) => m.key === 'icy-wind-articuno');
    const bz = moves.findIndex((m) => m.key === 'blizzard-articuno');
    const is = moves.findIndex((m) => m.key === 'ice-shard-articuno');
    const pr = world.projectiles;
    const e = world.enemies;
    this.floorLines.clear();
    this.pool.begin();
    this.front.begin();
    let any = this.spikes.length > 0 || this.shatters.length > 0 || this.shards.size > 0 || this.encased.size > 0 || aimSlot !== null;
    for (let i = 0; i < pr.count && !any; i++) {
      const m = pr.move[i];
      if (m === fd || m === iw || m === bz || m === is) any = true;
    }
    for (let i = 0; i < e.count && !any; i++) if (e.frost[i]! > 0) any = true;
    if (!any) {
      this.pool.end();
      this.front.end();
      return;
    }
    this.build();
    const growSpeed = 1 / Math.max(0.0001, world.rules.activeSkills?.defs.find((d) => d.kind === 'freezeDry')?.freezeDry?.delayPerPixel ?? 0.0009);
    const liveLines = new Set<number>();
    const liveShards = new Set<number>();
    for (let i = 0; i < pr.count; i++) {
      const m = pr.move[i];
      const id = pr.serial[i]!;
      const x = pr.x[i]!;
      const y = pr.y[i]!;
      const r = pr.radius[i]!;
      if (m === fd) {
        if (pr.length[i]! > 0) {
          liveLines.add(id);
          if (!this.frostLines.has(id)) this.frostLines.set(id, timeMs);
          const grown = Math.min(pr.length[i]!, ((timeMs - this.frostLines.get(id)!) / 1000) * growSpeed);
          const fade = pr.stage[i] === 1 ? Math.min(1, pr.life[i]! / 0.8) : 1;
          this.drawFrostLine(x, y, pr.dirX[i]!, pr.dirY[i]!, grown, id, fade);
        } else if (pr.stage[i] !== 3 && !this.seen.has(id)) {
          this.seen.add(id);
          this.spikes.push({ x, y, r, at: timeMs, seed: id });
        }
      } else if (m === iw) {
        const owner = world.players.find((q) => q.id === pr.owner[i]);
        this.drawWind(owner?.x ?? x, owner?.y ?? y, pr.dirX[i]!, pr.dirY[i]!, r, pr.length[i]!, pr.life[i]!, pr.maxLife[i]!, timeMs, id);
      } else if (m === bz) {
        this.drawBlizzard(x, y, pr.dirX[i]!, pr.dirY[i]!, pr.length[i]!, r, pr.vx[i]!, pr.vy[i]!, pr.life[i]!, pr.maxLife[i]!, timeMs, id);
      } else if (m === is && pr.stage[i] === 0) {
        liveShards.add(id);
        this.shards.set(id, { x, y });
        const img = this.front.image('af-icicle', this.frontDepth - 0.01);
        img.setPosition(x, y).setScale((r * 2.4) / ICICLE_W).setRotation(Math.atan2(pr.vy[i]!, pr.vx[i]!));
      }
    }
    for (const id of this.frostLines.keys()) if (!liveLines.has(id)) this.frostLines.delete(id);
    // こおりのつぶて が消えたら、そこで小さく砕ける
    for (const [id, s] of this.shards) {
      if (liveShards.has(id)) continue;
      this.shards.delete(id);
      this.shatters.push({ x: s.x, y: s.y, r: 10, at: timeMs, seed: id, big: false });
    }
    if (this.seen.size > 800) this.seen.clear();
    this.drawSpikes(timeMs);
    this.drawFrost(world, timeMs);
    this.drawShatters(timeMs);
    this.drawAim(world, timeMs, localId, aimSlot);
    this.pool.end();
    this.front.end();
  }

  /** 霜の線: 地面を這うまっすぐな霜の筋。まわりに霜の粒がつき、羊歯の葉のような枝が左右へ前向きに生える。消える前は細く少なくなる */
  private drawFrostLine(x: number, y: number, dx: number, dy: number, len: number, seed: number, fade: number): void {
    if (len < 2) return;
    const g = this.floorLines;
    const px = -dy;
    const py = dx;
    // 霜の粒（筋のまわり。根元ほど多い）
    for (let t = 4; t < len; t += 5) {
      for (let q = 0; q < 2; q++) {
        const r1 = rnd(t + q * 31, seed);
        if (r1 > fade * (1 - (t / len) * 0.3)) continue;
        const off = (rnd(t * 3 + q, seed) - 0.5) * 18 * fade;
        const sz = r1 < 0.3 ? 4 : 3;
        g.fillStyle(r1 < 0.25 ? 0xffffff : r1 < 0.6 ? 0xd2efff : 0x8fd0f0, 1).fillRect(Math.round(x + dx * t + px * off - sz / 2), Math.round(y + dy * t + py * off - sz / 2), sz, sz);
      }
    }
    // 芯の筋
    for (const [w, col] of [[4 * fade + 1, 0x8fd0f0], [2 * fade, 0xffffff]] as const) {
      if (w < 1) continue;
      g.lineStyle(w, col, 1).beginPath().moveTo(x, y).lineTo(x + dx * len, y + dy * len).strokePath();
    }
    // 羊歯の枝（左右へ、前向きに斜め。枝の途中から小枝）
    const bl = 12 * fade;
    if (bl < 3) return;
    g.lineStyle(2, 0xe3f6ff, 1);
    for (let t = 12; t < len - 6; t += 16) {
      for (const side of [-1, 1]) {
        const l = bl * (0.7 + rnd(t + side, seed) * 0.5);
        const ex = x + dx * t + (dx * 0.75 + px * side) * l;
        const ey = y + dy * t + (dy * 0.75 + py * side) * l;
        const mx = x + dx * t + (dx * 0.75 + px * side) * l * 0.5;
        const my = y + dy * t + (dy * 0.75 + py * side) * l * 0.5;
        g.beginPath().moveTo(x + dx * t, y + dy * t).lineTo(ex, ey).strokePath();
        g.beginPath().moveTo(mx, my).lineTo(mx + dx * l * 0.45, my + dy * l * 0.45).strokePath();
      }
    }
  }

  /** 氷のとげ: 地面から突き出し、少し残ってから砕けて粒が散る */
  private drawSpikes(timeMs: number): void {
    this.spikes = this.spikes.filter((s) => timeMs - s.at < SPIKE_HOLD_MS + SPIKE_BREAK_MS);
    for (const s of this.spikes) {
      const ms = timeMs - s.at;
      const scale = (s.r * 2.2) / SPIKE_H;
      if (ms < SPIKE_HOLD_MS) {
        const up = Math.min(1, ms / SPIKE_RISE_MS);
        const img = this.pool.image(`af-spike-${s.seed % SPIKE_KINDS}`, this.frontDepth - 0.02);
        img.setOrigin(0.5, 1).setPosition(s.x, s.y + s.r * 0.35).setScale(scale, scale * up).setFlipX(s.seed % 2 === 0);
        // 突き出した瞬間の雪けむり
        if (ms < 160) {
          const t = ms / 160;
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2 + s.seed;
            this.front.dot(s.x + Math.cos(a) * s.r * (0.5 + t), s.y + s.r * 0.3 + Math.sin(a) * s.r * 0.35 * (0.5 + t), Math.round(5 * (1 - t)) + 1, 0xe3f6ff);
          }
        }
        continue;
      }
      // 砕ける: 氷の破片が外へ落ちる
      const t = (ms - SPIKE_HOLD_MS) / SPIKE_BREAK_MS;
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + rnd(k, s.seed);
        const d = s.r * (0.3 + t * 0.9);
        const h = s.r * (1.2 - t) * rnd(k + 3, s.seed);
        this.front.dot(s.x + Math.cos(a) * d, s.y - h + Math.sin(a) * d * 0.4, Math.round(5 * (1 - t)) + 1, k % 2 ? 0xb3e5fc : 0xffffff);
      }
    }
  }

  /** しもやけ: 重ねた数だけ足元に氷の粒、重ねきった敵は頭の上に雪の結晶。氷漬けは氷の塊（溶けると砕ける） */
  private drawFrost(world: World, timeMs: number): void {
    const e = world.enemies;
    const full = frostFull(world);
    const live = new Set<number>();
    for (let i = 0; i < e.count; i++) {
      const n = e.frost[i]!;
      if (n === 0 || e.hp[i]! <= 0) continue;
      const x = e.x[i]!;
      const y = e.y[i]!;
      const r = e.radius[i]!;
      if (n === FROST_ENCASED) {
        live.add(e.id[i]!);
        this.encased.set(e.id[i]!, { x, y, r });
        const img = this.front.image('af-block', this.frontDepth - 0.03);
        img.setPosition(x, y - r * 0.25).setScale((r * 2.5) / BLOCK);
        continue;
      }
      for (let q = 0; q < n; q++) {
        const a = Math.PI * (0.15 + (q / Math.max(1, full - 1)) * 0.7);
        this.pool.dot(x + Math.cos(a) * r * 1.05, y + Math.sin(a) * r * 0.45, 4, q % 2 ? 0xb3e5fc : 0xffffff);
      }
      if (full > 0 && n >= full) {
        const img = this.front.image('af-flake', this.frontDepth - 0.01);
        img.setPosition(x, y - r * 1.6 - 12).setRotation(timeMs / 600).setScale(2);
      }
    }
    // 氷漬けが終わった（溶けた・倒れた）ら砕ける
    for (const [id, b] of this.encased) {
      if (live.has(id)) continue;
      this.encased.delete(id);
      this.shatters.push({ x: b.x, y: b.y - b.r * 0.25, r: b.r * 1.2, at: timeMs, seed: id, big: true });
    }
  }

  /** 砕けた氷の破片（氷の塊・つらら） */
  private drawShatters(timeMs: number): void {
    this.shatters = this.shatters.filter((s) => timeMs - s.at < SHATTER_MS);
    for (const s of this.shatters) {
      const t = (timeMs - s.at) / SHATTER_MS;
      const n = s.big ? 12 : 5;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + rnd(k, s.seed);
        const d = s.r * (0.2 + t * (0.9 + rnd(k + 7, s.seed)));
        const fall = 60 * t * t;
        this.front.dot(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d * 0.6 + fall, Math.round((s.big ? 7 : 4) * (1 - t)) + 1, k % 3 === 0 ? 0x8fd0f0 : k % 3 === 1 ? 0xffffff : 0xd2efff);
      }
    }
  }

  /** こごえるかぜ: 扇の中を、雪の筋（3 点の短い線）と粒が外へ流れる。最初と最後は筋が少ない */
  private drawWind(x: number, y: number, dx: number, dy: number, reach: number, half: number, life: number, maxLife: number, timeMs: number, seed: number): void {
    const age = maxLife - life;
    const amount = Math.min(1, age / 0.12, life / 0.2);
    const base = Math.atan2(dy, dx);
    const n = Math.round(64 * amount);
    const speed = 820;
    const cy = y - 14;
    for (let k = 0; k < n; k++) {
      // 外ほど広がる筋。少し揺れながら流れる
      const a = base + (rnd(k, seed) * 2 - 1) * half * 0.95 + Math.sin(timeMs / 140 + k) * 0.04;
      const d = 30 + ((rnd(k + 11, seed) * reach + (timeMs / 1000) * speed * (0.7 + rnd(k + 3, seed) * 0.5)) % (reach - 30));
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      if (k % 4 === 0) {
        // 雪の結晶（回りながら流れる）
        const fl = this.pool.image('af-flake', this.frontDepth - 0.04);
        fl.setPosition(x + ca * d, cy + sa * d).setRotation(timeMs / 300 + k).setScale(1.6 + (d / reach) * 0.8);
        continue;
      }
      const st = this.pool.image('af-streak', this.frontDepth - 0.04);
      st.setOrigin(1, 0.5).setPosition(x + ca * d, cy + sa * d).setRotation(a).setScale(1.6 + (d / reach) * 1.2, 2);
    }
    // 口もとの冷たい息
    for (let k = 0; k < 5; k++) {
      const a = base + (rnd(k, Math.floor(timeMs / 60)) - 0.5) * half;
      this.front.dot(x + Math.cos(a) * 20, y - 14 + Math.sin(a) * 20, 5, 0xe3f6ff);
    }
  }

  /** ふぶき: 雪のかたまりが帯の幅に並んで渦を巻きながら前へ進み、前へ雪の筋と結晶が吹き付ける。出始めと終わりは奥行きが小さい */
  private drawBlizzard(x: number, y: number, px: number, py: number, len: number, r: number, vx: number, vy: number, life: number, maxLife: number, timeMs: number, seed: number): void {
    const age = maxLife - life;
    const k = Math.max(0.2, Math.min(1, age / 0.25, life / 0.35));
    const sp = Math.hypot(vx, vy) || 1;
    const fx = vx / sp;
    const fy = vy / sp;
    const at = (u: number, v: number): [number, number] => [x + px * u + fx * v, y + py * u + fy * v];
    // 雪のかたまり（2 列。渦を巻いて入れ替わる）
    const n = Math.max(4, Math.round(len / 34));
    const ts = timeMs / 1000;
    for (let q = 0; q < n * 2; q++) {
      const row = q % 2;
      const ph = ts * (2.2 + rnd(q, seed)) + q * 1.7;
      const u = ((Math.floor(q / 2) + 0.5 + (row ? 0.5 : 0)) / n) * len + Math.sin(ph) * 14 - (row ? len / n / 2 : 0);
      if (u < -10 || u > len + 10) continue;
      const v = ((row ? -0.35 : 0.3) + Math.cos(ph) * 0.18) * r * k;
      const [qx, qy] = at(u, v);
      const img = this.pool.image(`af-puff-${(q + seed) % PUFF_KINDS}`, this.frontDepth - 0.04);
      img.setPosition(qx, qy).setScale(((r * 0.9 + rnd(q, 3) * 24) * k) / PUFF_H).setFlipX((q + Math.floor(ph / 3)) % 2 === 0);
    }
    // 前へ吹き付ける雪の筋（帯の中から前の縁の先へ）
    const rot = Math.atan2(fy, fx);
    for (let q = 0; q < 30; q++) {
      const u = rnd(q, seed) * len;
      const ph = (ts * (1.6 + rnd(q + 9, seed)) + rnd(q + 5, seed)) % 1;
      const [qx, qy] = at(u, (-0.6 + ph * 1.6) * r * k + ph * 40);
      if (q % 5 === 0) {
        const fl = this.front.image('af-flake', this.frontDepth - 0.03);
        fl.setPosition(qx, qy).setRotation(ts * 4 + q).setScale(1.8);
        continue;
      }
      const st = this.front.image('af-streak', this.frontDepth - 0.03);
      st.setOrigin(1, 0.5).setPosition(qx, qy).setRotation(rot).setScale(2 + ph, 2);
    }
  }

  /** 押している間（本人）: フリーズドライ は霜の走る線、ふぶき は帯の出る所と進む先 */
  private drawAim(world: World, timeMs: number, localId: number, aimSlot: number | null): void {
    const me = world.players.find((p) => p.id === localId);
    const slot = aimSlot !== null ? me?.skills?.[aimSlot] : undefined;
    if (!me || !slot || me.down) return;
    const reach = articunoReach(world, me, slot.skill);
    if (!reach) return;
    const ready = slot.charges > 0;
    const col = ready ? 0xb3e5fc : 0x5a6b78;
    const [fx, fy] = aimOf(me);
    const step = 18;
    const off = (timeMs / 15) % step;
    if (reach.width === 0) {
      const heading = Math.atan2(fy, fx);
      for (let k = 0; k < reach.count; k++) {
        const a = heading + ((k - (reach.count - 1) / 2) * reach.spreadDegrees * Math.PI) / 180;
        for (let d = 20 + off; d < reach.length; d += step) this.front.dot(me.x + Math.cos(a) * d, me.y + Math.sin(a) * d, 4, col);
      }
      return;
    }
    const px = -fy;
    const py = fx;
    const half = reach.width / 2;
    // 帯の出る所（前の縁と後ろの縁）と、進む先の線
    for (const dd of [reach.start - reach.depth / 2, reach.start + reach.depth / 2]) {
      for (let s = -half; s <= half; s += step) this.front.dot(me.x + fx * dd + px * s, me.y + fy * dd + py * s, 4, col);
    }
    for (const s of [-half, half]) for (let d = reach.start + off; d < reach.length; d += step) this.front.dot(me.x + fx * d + px * s, me.y + fy * d + py * s, 3, col);
  }
}
