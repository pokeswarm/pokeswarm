import Phaser from 'phaser';
import type { World } from '../../sim/world';
import { aimOf, eruptionPreview, overheatReach } from '../../sim/activeSkills';
import { DotPool, c, makeTexture, on, rnd, shade } from './dotArt';

/**
 * 遊べるエンテイの技の絵（07 の313章）:
 * - ふんか: 背中から火山弾（黒い岩に赤く光るひび。ボス戦の火山弾の絵）を噴き上げ、影が先に出てから落ちる。着弾で炎と岩のかけら。
 *   ふんえん の割れ目に落ちたもの（コンボ）は、割れ目から溶岩が噴き上がって大きく弾ける
 * - ふんえん: 踏んだ所から 3 本の地割れが走り（溶岩が光る割れ目）、根元から順に溶岩が噴く。割れ目は残り、消える前に暗くなる
 * - オーバーヒート: 体が赤熱して熱が集まり、前へ巨大な炎の奔流。使った後は体から湯気が立つ（ほのおの技が弱まっている間）
 * - せいなるほのお: 青白い炎の玉
 * 地面・炎・岩・溶岩は 1 ドットずつ計算した不透明のドット絵、割れ目は不透明の線（薄い塗りは使わない。画面全体は光らせない。画面は揺らさない）
 */

const BURST_W = 64;
const BURST_H = 48;
const BURST_FRAMES = 4;
const JET_W = 20;
const JET_H = 64;
const BLAST_W = 64;
const BLAST_H = 32;
const BLAST_FRAMES = 3;
const SACRED = 24;
const SACRED_FRAMES = 3;
const SCORCH = 48;
const IMPACT_MS = 520;
const COMBO_MS = 820;
const PLUME_MS = 460;
const STOMP_MS = 380;
const SACRED_HIT_MS = 220;
/** 火山弾が飛んでいる時間（これより前は背中の中） */
const FLIGHT = 0.55;

const FIRE = [0x6e1003, 0xb92207, 0xec4a0a, 0xff8412, 0xffbd3d, 0xfff0b8];
const LAVA = [0x2b0a04, 0x8e1a05, 0xec4a0a, 0xff8412, 0xffd27a];
const SACRED_COLS = [0x1a3a8a, 0x3d6be0, 0x8fc4ff, 0xe3f2ff, 0xffffff];

type Hit = { x: number; y: number; r: number; at: number; seed: number; kind: 'impact' | 'combo' | 'plume' | 'sacred' };
type Bomb = { ox: number; oy: number; tx: number; ty: number; total: number; combo: boolean };

export class EnteiPlayer {
  private built = false;
  private readonly pool: DotPool;
  private readonly front: DotPool;
  private readonly lines: Phaser.GameObjects.Graphics;
  private readonly floorLines: Phaser.GameObjects.Graphics;
  private bombs = new Map<number, Bomb>();
  private cracks = new Map<number, number>();
  private hits: Hit[] = [];
  private stomps: { x: number; y: number; at: number }[] = [];
  private plumes = new Map<number, number>();
  private sacred = new Map<number, { x: number; y: number }>();
  private seen = new Set<number>();

  constructor(
    private readonly scene: Phaser.Scene,
    depth: number,
    private readonly floorDepth: number,
    private readonly frontDepth: number,
  ) {
    this.pool = new DotPool(scene, depth + 0.02);
    this.front = new DotPool(scene, frontDepth + 0.01);
    this.lines = scene.add.graphics().setDepth(frontDepth + 0.02);
    this.floorLines = scene.add.graphics().setDepth(floorDepth + 0.15);
  }

  private build(): void {
    if (this.built) return;
    this.built = true;
    const s = this.scene;
    // 着弾の爆発: でこぼこの丸い火の玉が膨らみ（白 → 黄 → 橙 → 赤）、最後のコマでは芯から黒い煙に崩れる（4 コマ）
    for (let f = 0; f < BURST_FRAMES; f++) {
      makeTexture(s, `en-burst-${f}`, BURST_W, BURST_H, (x, y) => {
        const nx = (x - (BURST_W - 1) / 2) / (BURST_W / 2);
        const ny = (y - BURST_H * 0.55) / (BURST_H * 0.55);
        const a = Math.atan2(ny, nx);
        const d = Math.hypot(nx, ny * 1.1);
        const R = (0.5 + f * 0.15) * (1 + 0.16 * Math.sin(a * 5 + f) + 0.09 * Math.sin(a * 9 - f * 2));
        if (d > R) return 0;
        const k = d / R;
        if (f === BURST_FRAMES - 1) {
          if (!on(1.15 - k * 0.6, x, y)) return 0;
          return k < 0.55 ? c(rnd(x, y) > 0.7 ? 0x6e1003 : 0x3a2a26) : shade(FIRE, 0.45 - (k - 0.55), x, y);
        }
        if (f === 2 && k < 0.3) return c(0x6e1003);
        return shade(FIRE, 1.05 - k * (0.7 + f * 0.12), x, y);
      });
    }
    // 噴き上がる溶岩の柱（下が太い。上は丸い溶岩のしずく）
    makeTexture(s, 'en-jet', JET_W, JET_H, (x, y) => {
      const t = 1 - y / JET_H;
      const cx = (JET_W - 1) / 2 + Math.sin(t * 9) * 1.2;
      const w = 8 - t * 4.5;
      const d = Math.abs(x - cx);
      if (t > 0.86) {
        const r = Math.hypot(x - cx, y - JET_H * 0.08);
        return r < 4 ? c(r < 2 ? 0xffd27a : 0xff8412) : 0;
      }
      if (d > w) return 0;
      return shade(LAVA, 1 - d / w * 0.8 - (1 - t) * 0.15, x, y);
    });
    // 地面の焦げ（黒い跡に、冷えかけの溶岩の点）
    makeTexture(s, 'en-scorch', SCORCH, SCORCH / 2, (x, y) => {
      const nx = (x - (SCORCH - 1) / 2) / (SCORCH / 2);
      const ny = (y - (SCORCH / 2 - 1) / 2) / (SCORCH / 4);
      const r = Math.hypot(nx, ny) * (1 + Math.sin(Math.atan2(ny, nx) * 5) * 0.12);
      if (r > 1) return 0;
      if (r < 0.5 && rnd(x, y) > 0.86) return c(0xec4a0a);
      return on(1.2 - r, x, y) ? c(r < 0.55 ? 0x1c0603 : 0x3a1a10) : 0;
    });
    // オーバーヒートの炎の奔流（右へ流れる帯。芯は白、外は赤。舌が揺れる 3 コマ。横に並べてつなぐ）
    for (let f = 0; f < BLAST_FRAMES; f++) {
      makeTexture(s, `en-blast-${f}`, BLAST_W, BLAST_H, (x, y) => {
        const u = x / BLAST_W;
        const v = (y - (BLAST_H - 1) / 2) / (BLAST_H / 2);
        const edge = 0.78 + 0.14 * Math.sin(u * Math.PI * 4 + f * 2.1) + 0.08 * Math.sin(u * Math.PI * 10 - f * 1.7);
        const a = Math.abs(v);
        if (a > edge) return 0;
        const k = a / edge;
        if (k > 0.8 && !on((1 - k) * 5, x + f, y)) return 0;
        return shade(FIRE, 1.02 - k * 0.95 + Math.sin(u * 20 + f * 3 + v * 3) * 0.06, x, y);
      });
    }
    // せいなるほのお: 青白い炎の玉（右へ飛ぶ。後ろへ炎の尾）
    for (let f = 0; f < SACRED_FRAMES; f++) {
      makeTexture(s, `en-sacred-${f}`, SACRED, SACRED, (x, y) => {
        const nx = (x - 15) / 8;
        const ny = (y - (SACRED - 1) / 2) / 8;
        const r = Math.hypot(nx, ny);
        if (r < 1) return shade(SACRED_COLS, 1.05 - r * 0.85, x, y);
        // 尾（左へ）: 揺れる 2 本の舌
        if (nx < 0) {
          const tail = 1 - -nx / 1.9;
          const wob = Math.sin(-nx * 5 + f * 2) * 0.25;
          if (tail > 0 && Math.abs(ny - wob) < tail * 0.75) return shade(SACRED_COLS, tail * 0.75, x, y);
        }
        return 0;
      });
    }
  }

  /** 折れ曲がった線（割れ目・稲妻の形） */
  private jag(g: Phaser.GameObjects.Graphics, ax: number, ay: number, dx: number, dy: number, len: number, seed: number, width: number, col: number): void {
    if (width < 1 || len < 1) return;
    const n = Math.max(2, Math.round(len / 26));
    g.lineStyle(width, col, 1).beginPath().moveTo(ax, ay);
    for (let k = 1; k <= n; k++) {
      const t = (k / n) * len;
      const j = k === n ? 0 : (rnd(k, seed) - 0.5) * 14;
      g.lineTo(ax + dx * t - dy * j, ay + dy * t + dx * j);
    }
    g.strokePath();
  }

  update(world: World, timeMs: number, localId: number, aimSlot: number | null): void {
    const moves = world.rules.moves;
    const er = moves.findIndex((m) => m.key === 'eruption-entei');
    const lp = moves.findIndex((m) => m.key === 'lava-plume-entei');
    const oh = moves.findIndex((m) => m.key === 'overheat-entei');
    const sf = moves.findIndex((m) => m.key === 'sacred-fire-entei');
    const pr = world.projectiles;
    this.lines.clear();
    this.floorLines.clear();
    this.pool.begin();
    this.front.begin();
    let any = this.hits.length > 0 || this.stomps.length > 0 || this.sacred.size > 0 || aimSlot !== null;
    for (const p of world.players) if (p.overheat) any = true;
    for (let i = 0; i < pr.count && !any; i++) {
      const m = pr.move[i];
      if (m === er || m === lp || m === oh || m === sf) any = true;
    }
    if (!any) {
      this.pool.end();
      this.front.end();
      return;
    }
    this.build();
    const growSpeed = 1 / Math.max(0.0001, world.rules.activeSkills?.defs.find((d) => d.kind === 'lavaPlume')?.lavaPlume?.delayPerPixel ?? 0.0012);
    const liveBombs = new Set<number>();
    const liveCracks = new Set<number>();
    const liveSacred = new Set<number>();
    for (let i = 0; i < pr.count; i++) {
      const m = pr.move[i];
      const id = pr.serial[i]!;
      const x = pr.x[i]!;
      const y = pr.y[i]!;
      const r = pr.radius[i]!;
      if (m === er) {
        if (pr.stage[i] === 3) {
          liveBombs.add(id);
          let b = this.bombs.get(id);
          if (!b) {
            const owner = world.players.find((q) => q.id === pr.owner[i]);
            b = { ox: owner?.x ?? x, oy: (owner?.y ?? y) - 26, tx: x, ty: y, total: Math.max(0.05, pr.life[i]!), combo: pr.armStage[i] === 1 };
            this.bombs.set(id, b);
            if (owner && !this.plumes.has(owner.id)) this.plumes.set(owner.id, timeMs);
          }
          this.drawBomb(b, pr.life[i]!, r, timeMs, id);
        } else if (!this.seen.has(id)) {
          this.seen.add(id);
          this.hits.push({ x, y, r, at: timeMs, seed: id, kind: pr.stage[i] === 1 ? 'combo' : 'impact' });
        }
      } else if (m === lp) {
        if (pr.length[i]! > 0) {
          liveCracks.add(id);
          if (!this.cracks.has(id)) {
            this.cracks.set(id, timeMs);
            if (!this.stomps.some((s) => timeMs - s.at < 50)) this.stomps.push({ x, y, at: timeMs });
          }
          const grown = Math.min(pr.length[i]!, ((timeMs - this.cracks.get(id)!) / 1000) * growSpeed);
          const fade = pr.stage[i] === 1 ? Math.min(1, pr.life[i]! / 1) : 1;
          this.drawCrack(x, y, pr.dirX[i]!, pr.dirY[i]!, grown, id, fade, timeMs);
        } else if (pr.stage[i] !== 3 && !this.seen.has(id)) {
          this.seen.add(id);
          this.hits.push({ x, y, r, at: timeMs, seed: id, kind: 'plume' });
        }
      } else if (m === oh) {
        const owner = world.players.find((q) => q.id === pr.owner[i]);
        if (pr.stage[i] === 3) this.drawHeat(owner?.x ?? x, owner?.y ?? y, 1 - pr.life[i]! / 0.35, timeMs);
        else this.drawBlast(x, y, pr.dirX[i]!, pr.dirY[i]!, pr.length[i]!, r, pr.life[i]!, timeMs);
      } else if (m === sf && pr.stage[i] === 0) {
        liveSacred.add(id);
        this.sacred.set(id, { x, y });
        const f = Math.floor(timeMs / 70) % SACRED_FRAMES;
        const img = this.front.image(`en-sacred-${f}`, this.frontDepth - 0.01);
        img.setPosition(x, y).setScale((r * 2.6) / SACRED).setRotation(Math.atan2(pr.vy[i]!, pr.vx[i]!));
      }
    }
    for (const id of this.bombs.keys()) if (!liveBombs.has(id)) this.bombs.delete(id);
    for (const id of this.cracks.keys()) if (!liveCracks.has(id)) this.cracks.delete(id);
    // せいなるほのお が消えたら、そこで青白く弾ける
    for (const [id, s] of this.sacred) {
      if (liveSacred.has(id)) continue;
      this.sacred.delete(id);
      this.hits.push({ x: s.x, y: s.y, r: 14, at: timeMs, seed: id, kind: 'sacred' });
    }
    if (this.seen.size > 800) this.seen.clear();
    this.drawPlumes(world, timeMs);
    this.drawStomps(timeMs);
    this.drawHits(timeMs);
    this.drawSteam(world, timeMs);
    this.drawAim(world, timeMs, localId, aimSlot);
    this.pool.end();
    this.front.end();
  }

  /** 火山弾: 背中から弧を描いて飛び、落ちる所に影が濃くなっていく */
  private drawBomb(b: Bomb, life: number, r: number, timeMs: number, id: number): void {
    const flight = Math.min(b.total, FLIGHT);
    if (life > flight) return;
    const t = 1 - life / flight;
    const dist = Math.hypot(b.tx - b.ox, b.ty - b.oy);
    const h = (260 + dist * 0.35) * Math.sin(Math.PI * t);
    const x = b.ox + (b.tx - b.ox) * t;
    const y = b.oy + (b.ty - b.oy) * t - h;
    // 影（地面。だんだん大きく濃く）
    const sr = r * (0.4 + t * 0.6);
    for (let yy = -sr * 0.45; yy <= sr * 0.45; yy += 4) for (let xx = -sr; xx <= sr; xx += 4) if ((xx / sr) ** 2 + (yy / (sr * 0.45)) ** 2 <= 1 && on(0.25 + t * 0.5, Math.round(xx / 4) + 64, Math.round(yy / 4) + 64)) this.pool.dot(b.tx + xx, b.ty + yy, 4, 0x1c0603);
    const f = Math.floor(timeMs / 80 + id) % 4;
    const key = this.scene.textures.exists(`msprite:entei-rock:0:main:${f}`) ? `msprite:entei-rock:0:main:${f}` : 'en-burst-0';
    const rock = this.front.image(key, this.frontDepth);
    rock.setPosition(x, y).setScale(((b.combo ? 1.15 : 1) * r * 0.95) / 40).setRotation(t * 4 + id);
    // 後ろに残る火の粉
    for (let k = 1; k <= 3; k++) {
      const tt = Math.max(0, t - k * 0.05);
      const hx = b.ox + (b.tx - b.ox) * tt;
      const hy = b.oy + (b.ty - b.oy) * tt - (260 + dist * 0.35) * Math.sin(Math.PI * tt);
      this.front.dot(hx + (rnd(k, id) - 0.5) * 8, hy, 5 - k, k === 1 ? 0xffbd3d : 0xec4a0a);
    }
  }

  /** ふんえん の割れ目: 黒い割れ目の奥で溶岩が光る。根元から伸び、消える前に暗く細くなる */
  private drawCrack(x: number, y: number, dx: number, dy: number, len: number, seed: number, fade: number, timeMs: number): void {
    const g = this.floorLines;
    this.jag(g, x, y, dx, dy, len, seed, 8 * fade + 1, 0x1c0603);
    this.jag(g, x, y, dx, dy, len, seed, 5 * fade, fade > 0.5 ? 0x8e1a05 : 0x4a1206);
    this.jag(g, x, y, dx, dy, len, seed, 2.5 * fade, fade > 0.5 ? 0xec4a0a : 0x8e1a05);
    // 所々が明るく流れる
    if (fade > 0.4) {
      const ph = (timeMs / 600) % 1;
      for (let k = 0; k < 4; k++) {
        const t = ((k / 4 + ph) % 1) * len;
        this.pool.dot(x + dx * t, y + dy * t, 3, 0xffd27a);
      }
    }
  }

  /** オーバーヒートの溜め: 体が赤熱し、まわりから熱が集まる */
  private drawHeat(x: number, y: number, t: number, timeMs: number): void {
    const cy = y - 16;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + timeMs / 400;
      const d = 70 * (1 - Math.min(1, t)) + 18;
      this.front.dot(x + Math.cos(a) * d, cy + Math.sin(a) * d * 0.7, 5, k % 3 === 0 ? 0xfff0b8 : 0xff8412);
    }
    for (let k = 0; k < 8; k++) {
      const a = rnd(k, Math.floor(timeMs / 60)) * Math.PI * 2;
      this.front.dot(x + Math.cos(a) * 20, cy + Math.sin(a) * 22, 4, 0xec4a0a);
    }
  }

  /** オーバーヒートの炎: 体の少し前から、帯を並べて先まで。先は広がって崩れる */
  private drawBlast(x: number, y: number, dx: number, dy: number, len: number, r: number, life: number, timeMs: number): void {
    const f = Math.floor(timeMs / 70) % BLAST_FRAMES;
    const rot = Math.atan2(dy, dx);
    const start = 22;
    const seg = BLAST_W * 1.6;
    const fade = Math.min(1, life / 0.18);
    const n = Math.ceil((len - start) / seg);
    for (let k = 0; k < n; k++) {
      const d = start + k * seg;
      const w = Math.min(1, 0.55 + (k / Math.max(1, n - 1)) * 0.6) * fade;
      const img = this.front.image(`en-blast-${(f + k) % BLAST_FRAMES}`, this.frontDepth - 0.02);
      img.setOrigin(0, 0.5).setPosition(x + dx * d, y - 12 + dy * d).setRotation(rot).setScale(Math.min(seg, len - d) / BLAST_W, ((r * 2) / BLAST_H) * w);
    }
    // 先で舞う火の粉
    for (let k = 0; k < 10; k++) {
      const a = rot + (rnd(k, Math.floor(timeMs / 50)) - 0.5) * 1.4;
      const d = len * (0.85 + rnd(k + 5, Math.floor(timeMs / 50)) * 0.25);
      this.front.dot(x + Math.cos(a) * d, y - 12 + Math.sin(a) * d, 4, k % 2 ? 0xffbd3d : 0xec4a0a);
    }
  }

  /** ふんか を使った時: 背中から噴煙が赤く光って立ちのぼる */
  private drawPlumes(world: World, timeMs: number): void {
    for (const [id, at] of this.plumes) {
      const t = (timeMs - at) / 600;
      if (t >= 1) {
        this.plumes.delete(id);
        continue;
      }
      const p = world.players.find((q) => q.id === id);
      if (!p) continue;
      for (let k = 0; k < 10; k++) {
        const ph = (t + rnd(k, id)) % 1;
        const x = p.x + (rnd(k, 3) - 0.5) * 26;
        const y = p.y - 26 - ph * 90;
        this.front.dot(x, y, Math.round(8 - ph * 4), ph < 0.3 ? 0xff8412 : ph < 0.6 ? 0x6e1003 : 0x3a2a26);
      }
    }
  }

  /** ふんえん の踏み込み: 足元から土ぼこりの点が外へ */
  private drawStomps(timeMs: number): void {
    this.stomps = this.stomps.filter((s) => timeMs - s.at < STOMP_MS);
    for (const s of this.stomps) {
      const t = (timeMs - s.at) / STOMP_MS;
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        const d = 20 + t * 60;
        this.pool.dot(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d * 0.45, Math.round(6 * (1 - t)) + 1, k % 2 ? 0x8d6e63 : 0x5d4037);
      }
    }
  }

  /** 着弾・噴火・溶岩の噴き上げ・せいなるほのお の当たり */
  private drawHits(timeMs: number): void {
    this.hits = this.hits.filter((h) => timeMs - h.at < (h.kind === 'combo' ? COMBO_MS : h.kind === 'plume' ? PLUME_MS : h.kind === 'sacred' ? SACRED_HIT_MS : IMPACT_MS));
    for (const h of this.hits) {
      const ms = timeMs - h.at;
      if (h.kind === 'sacred') {
        const t = ms / SACRED_HIT_MS;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          this.front.dot(h.x + Math.cos(a) * (6 + t * 22), h.y + Math.sin(a) * (6 + t * 22), Math.round(5 * (1 - t)) + 1, k % 2 ? 0x8fc4ff : 0xffffff);
        }
        continue;
      }
      const span = h.kind === 'combo' ? COMBO_MS : h.kind === 'plume' ? PLUME_MS : IMPACT_MS;
      const t = ms / span;
      // 焦げ
      const sc = this.pool.image('en-scorch', this.floorDepth + 0.1);
      sc.setPosition(h.x, h.y).setScale((h.r * 1.8) / SCORCH, (h.r * 0.9) / (SCORCH / 2));
      // 炎の塊（4 コマで広がって崩れる）
      if (h.kind !== 'plume' || t < 0.6) {
        const f = Math.min(BURST_FRAMES - 1, Math.floor(t * BURST_FRAMES * (h.kind === 'plume' ? 1.6 : 1)));
        const b = this.front.image(`en-burst-${f}`, this.frontDepth - 0.01);
        const size = h.kind === 'combo' ? 2.2 : h.kind === 'plume' ? 1.4 : 1.8;
        b.setOrigin(0.5, 0.75).setPosition(h.x, h.y).setScale((h.r * size) / BURST_W);
      }
      // 溶岩の柱（ふんえん は低く、コンボは高く噴き上がって崩れる）
      if (h.kind !== 'impact') {
        const up = h.kind === 'combo' ? 190 : 80;
        const k = t < 0.35 ? t / 0.35 : 1 - (t - 0.35) / 0.65;
        if (k > 0.05) {
          const jet = this.front.image('en-jet', this.frontDepth - 0.012);
          jet.setOrigin(0.5, 1).setPosition(h.x, h.y).setScale((h.r * (h.kind === 'combo' ? 1.1 : 0.8)) / JET_W, (up * k) / JET_H);
        }
      }
      // 岩のかけら・溶岩のしずくが飛ぶ
      const n = h.kind === 'combo' ? 10 : h.kind === 'plume' ? 4 : 6;
      const tt = ms / 1000;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + rnd(k, h.seed);
        const sp = h.r * (1.2 + rnd(k, h.seed + 1)) * (h.kind === 'combo' ? 1.4 : 1);
        const hh = (200 + rnd(k, h.seed + 2) * 160) * tt - 800 * tt * tt;
        if (hh < 0 && tt > 0.1) continue;
        this.front.dot(h.x + Math.cos(a) * sp * tt * 2, h.y + Math.sin(a) * sp * tt - Math.max(0, hh), k % 3 === 0 ? 6 : 4, k % 3 === 0 ? 0x3a2a26 : k % 3 === 1 ? 0xff8412 : 0xffbd3d);
      }
    }
  }

  /** オーバーヒートの後（ほのおの技が弱まっている間）: 体から湯気が立つ */
  private drawSteam(world: World, timeMs: number): void {
    for (const p of world.players) {
      const o = p.overheat;
      if (!o || world.tick < o.fromTick + Math.round(1.05 / world.dt) || world.tick >= o.untilTick) continue;
      for (let k = 0; k < 6; k++) {
        const ph = (timeMs / 900 + rnd(k, p.id)) % 1;
        this.front.dot(p.x + (rnd(k, 7) - 0.5) * 28 + Math.sin(ph * 6 + k) * 4, p.y - 30 - ph * 46, Math.round(7 - ph * 4), ph < 0.5 ? 0xd7ccc8 : 0x9e9e9e);
      }
    }
  }

  /** 押している間（本人）: ふんか は落ちる区画（割れ目があれば割れ目）、オーバーヒート は炎の届く範囲 */
  private drawAim(world: World, timeMs: number, localId: number, aimSlot: number | null): void {
    const me = world.players.find((p) => p.id === localId);
    const slot = aimSlot !== null ? me?.skills?.[aimSlot] : undefined;
    if (!me || !slot || me.down) return;
    const kind = world.rules.activeSkills?.defs[slot.skill]?.kind;
    const ready = slot.charges > 0;
    if (kind === 'eruption') {
      const pv = eruptionPreview(world, me, slot.skill);
      if (!pv) return;
      if (pv.combo) {
        // 割れ目が明るく脈打つ（火山弾は全部ここへ落ちる）
        for (const cr of pv.cracks) {
          const step = 20;
          const off = (timeMs / 12) % step;
          for (let d = off; d < cr.len; d += step) this.front.dot(cr.x + cr.dx * d, cr.y + cr.dy * d, 5, ready ? 0xffd27a : 0x6d5a4a);
        }
      } else {
        const n = 28;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + timeMs / 900;
          this.front.dot(pv.x + Math.cos(a) * pv.r, pv.y + Math.sin(a) * pv.r * 0.7, 4, ready ? 0xff8412 : 0x6d5a4a);
        }
      }
      // 落ちる数（HP が多いほど多い）: 足元に岩の印を並べる
      for (let k = 0; k < pv.count; k++) this.front.dot(me.x - (pv.count - 1) * 5 + k * 10, me.y + 26, 6, ready ? 0x3a2a26 : 0x6d5a4a);
    } else if (kind === 'overheat') {
      const reach = overheatReach(world, me, slot.skill);
      if (!reach) return;
      const [fx, fy] = aimOf(me);
      const px = -fy;
      const py = fx;
      const step = 18;
      const off = (timeMs / 15) % step;
      for (const side of [-1, 1]) for (let d = 22 + off; d < reach.length; d += step) this.front.dot(me.x + fx * d + px * reach.radius * side, me.y - 12 + fy * d + py * reach.radius * side, 4, ready ? 0xff8412 : 0x6d5a4a);
      for (let s = -reach.radius; s <= reach.radius; s += step) this.front.dot(me.x + fx * reach.length + px * s, me.y - 12 + fy * reach.length + py * s, 4, ready ? 0xffbd3d : 0x6d5a4a);
    }
  }
}
