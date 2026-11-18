import Phaser from 'phaser';
import type { World } from '../../sim/world';
import { aimOf, surfLane } from '../../sim/activeSkills';
import { DOT, DotPool, c, makeTexture, on, rnd, shade } from './dotArt';

/**
 * 遊べるスイクンの技の絵（07 の307章）: なみのり（横いっぱいの波と、通った跡に残る水）・ぜったいれいど（水が凍って氷のとげが立つ。
 * 水が無いときは雪の結晶の照準が締まって凍る）・ミラーコート（体を包む鏡の殻と、飛び出す鏡の破片）・めいそう（重ねた数の光の結晶）。
 * SPACE（なみのり）・E（ぜったいれいど）を押している間は、波の通り道・凍る所を見せる。
 * 1 ドットずつ計算した不透明のドット絵（薄さはディザ。半透明の塗りは使わない）
 */

const CREST_W = 128;
const CREST_H = 40;
const CREST_FRAMES = 4;
const WATER = 64;
const WATER_FRAMES = 3;
const ICE = 64;
const ICE_FRAMES = 5;
const SPIKES = 64;
const SHELL = 72;
const SHELL_FRAMES = 4;
const RETICLE = 64;
const SPIKE_MS = 700;

const WATERS = [0x0d3b66, 0x1565c0, 0x1e88e5, 0x42a5f5, 0x90caf9, 0xe3f2fd];
const ICES = [0x4f8fb8, 0x7fc3e6, 0xb3e5fc, 0xe1f5fe, 0xffffff];

export class SuicunePlayer {
  private built = false;
  private readonly pool: DotPool;
  private readonly front: DotPool;
  private spikes: { x: number; y: number; r: number; at: number }[] = [];
  private seen = new Set<number>();
  private flashes: { id: number; at: number }[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
    private readonly floorDepth: number,
    /** ポケモンとボスの絵より手前（殻・破片） */
    private readonly frontDepth: number,
  ) {
    this.pool = new DotPool(scene, depth + 0.02);
    this.front = new DotPool(scene, frontDepth + 0.01);
  }

  /** ミラーコートが吸った（殻が白く光る） */
  onAbsorbed(playerId: number, timeMs: number): void {
    this.flashes.push({ id: playerId, at: timeMs });
  }

  private build(): void {
    if (this.built) return;
    this.built = true;
    const s = this.scene;
    // 波頭: 下は深い青の水の壁、上へ明るく、てっぺんは白い泡が巻く（コマで泡が流れる）
    for (let f = 0; f < CREST_FRAMES; f++) {
      makeTexture(s, `su-crest-${f}`, CREST_W, CREST_H, (x, y) => {
        const u = x / CREST_W;
        const top = 10 + Math.sin(u * Math.PI * 6 + f * 1.6) * 4 + Math.sin(u * Math.PI * 2.3 + f) * 3;
        if (y < top - 4) {
          // 泡のしぶき
          return y > top - 8 && rnd(x + f * 13, y) > 0.82 ? c(0xffffff) : 0;
        }
        if (y < top) return on(0.75, x, y) ? c(0xffffff) : c(0xe3f2fd);
        const k = (y - top) / (CREST_H - top);
        const streak = Math.sin(u * 40 + y * 0.6 - f * 2) > 0.85;
        if (k < 0.18) return c(streak ? 0xffffff : 0xbbdefb);
        if (y > CREST_H - 6 && !on(1 - (y - (CREST_H - 6)) / 6, x, y)) return 0;
        return shade(WATERS, 0.75 - k * 0.6 + (streak ? 0.2 : 0), x, y);
      });
    }
    // 残る水: 青の円（ふちはディザで薄く）、光のさざ波が流れる
    for (let f = 0; f < WATER_FRAMES; f++) {
      makeTexture(s, `su-water-${f}`, WATER, WATER, (x, y) => {
        const cx = (WATER - 1) / 2;
        const r = Math.hypot(x - cx, y - cx) / (WATER / 2);
        if (r > 1) return 0;
        if (!on(r > 0.75 ? (1 - r) * 2.2 : 0.55, x, y)) return 0;
        const ripple = Math.sin((x + y * 0.4) * 0.35 + f * 2.1) + Math.sin(y * 0.5 - f * 1.4);
        if (ripple > 1.8) return c(0xbbdefb);
        if (ripple > 1.4) return c(0x42a5f5);
        return shade(WATERS, 0.2 + (1 - r) * 0.15, x, y);
      });
    }
    // 凍っていく水: ふちから霜の結晶が中へ伸び、最後は割れ目の入った氷の板
    for (let f = 0; f < ICE_FRAMES; f++) {
      const t = (f + 1) / ICE_FRAMES;
      makeTexture(s, `su-ice-${f}`, ICE, ICE, (x, y) => {
        const cx = (ICE - 1) / 2;
        const dx = x - cx;
        const dy = y - cx;
        const r = Math.hypot(dx, dy) / (ICE / 2);
        if (r > 1) return 0;
        if (r > 0.8 && !on((1 - r) * 4, x, y)) return 0;
        const a = Math.atan2(dy, dx);
        // 霜の枝（6 方向。ふちから伸びる）
        const branch = Math.abs(Math.sin(a * 3)) < 0.12 || Math.abs(Math.sin(a * 3 + r * 6)) < 0.08;
        const frosted = r > 1 - t;
        if (!frosted) return shade(WATERS, 0.4, x, y);
        if (branch) return c(0xffffff);
        // 割れ目（凍りきってから）
        if (t > 0.8 && Math.abs(Math.sin(dx * 0.4 + Math.sin(dy * 0.3) * 2)) < 0.06) return c(0x4f8fb8);
        return shade(ICES, 0.35 + (1 - r) * 0.35 + rnd(x, y) * 0.2, x, y);
      });
    }
    // 氷のとげ: 何本かの結晶が突き出す（下が太く、先は白）
    makeTexture(s, 'su-spikes', SPIKES, SPIKES, (x, y) => {
      const blades: [number, number, number][] = [[32, 10, 7], [20, 22, 5], [44, 20, 5], [12, 34, 4], [52, 32, 4], [27, 28, 4], [38, 30, 4]];
      for (const [bx, top, w] of blades) {
        const bottom = 58;
        if (y < top || y > bottom) continue;
        const k = (y - top) / (bottom - top);
        const half = w * k + 0.6;
        const dx = x + 0.5 - bx;
        if (Math.abs(dx) > half) continue;
        if (k < 0.18) return c(0xffffff);
        return dx < -half * 0.3 ? c(0xe1f5fe) : dx > half * 0.4 ? c(0x4f8fb8) : c(0x9fd6f0);
      }
      return 0;
    });
    // 雪の結晶の照準（水が無いときのぜったいれいど）
    makeTexture(s, 'su-reticle', RETICLE, RETICLE, (x, y) => {
      const cx = (RETICLE - 1) / 2;
      const dx = x - cx;
      const dy = y - cx;
      const r = Math.hypot(dx, dy) / (RETICLE / 2);
      if (r > 1) return 0;
      const a = Math.atan2(dy, dx);
      if (r > 0.86) return Math.sin(a * 12) > -0.3 ? c(0xe1f5fe) : 0;
      const arm = Math.abs(Math.sin(a * 3)) * r * (RETICLE / 2) < 1.2;
      const side = Math.abs(Math.sin(a * 3)) * r * (RETICLE / 2) < 3 && Math.abs((r * 10) % 2.5 - 1.25) < 0.4;
      if ((arm && r < 0.8) || (side && r > 0.25 && r < 0.75)) return c(r < 0.2 ? 0xffffff : 0xb3e5fc);
      return 0;
    });
    // ミラーコートの殻: 六角の鏡の面（ふちは明るく、面はまばら）。虹の光が面をなでる
    for (let f = 0; f < SHELL_FRAMES; f++) {
      makeTexture(s, `su-shell-${f}`, SHELL, SHELL, (x, y) => {
        const cx = (SHELL - 1) / 2;
        const nx = (x - cx) / (SHELL / 2);
        const ny = (y - cx) / (SHELL / 2);
        const r = Math.hypot(nx, ny);
        if (r > 1) return 0;
        const q = Math.abs(nx) * 0.866 + Math.abs(ny) * 0.5;
        const hex = Math.max(q, Math.abs(ny));
        if (hex > 0.92) return 0;
        const u = nx * 2.6;
        const v = ny * 2.6;
        const edge = Math.min(Math.abs(u - Math.round(u)), Math.abs(v * 0.866 + u * 0.5 - Math.round(v * 0.866 + u * 0.5)), Math.abs(v * 0.866 - u * 0.5 - Math.round(v * 0.866 - u * 0.5)));
        const band = (f / SHELL_FRAMES) * 2.4 - 1.2;
        const glint = Math.abs(nx + ny * 0.6 - band) < 0.12;
        if (hex > 0.84) return glint ? c(0xffffff) : c(0xb3e5fc);
        if (edge < 0.05) return glint ? c(0xfff9c4) : c(0xe1f5fe);
        if (glint && on(0.6, x, y)) return c([0xf8bbd0, 0xfff59d, 0xb2ebf2][(x + y) % 3]!);
        return on(0.08, x, y) ? c(0xe1f5fe) : 0;
      });
    }
    // 鏡の破片: ひし形。片側が白く光り、ふちに虹色
    makeTexture(s, 'su-shard', 12, 12, (x, y) => {
      const d = Math.abs(x + 0.5 - 6) + Math.abs(y + 0.5 - 6) * 0.6;
      if (d > 5) return 0;
      if (d > 4) return c([0xf8bbd0, 0xfff59d, 0xb2ebf2][(x + y) % 3]!);
      return x < 6 ? c(0xffffff) : c(0xb3e5fc);
    });
    // めいそうの結晶（重ねた数だけ、頭の上を回る）
    makeTexture(s, 'su-gem', 8, 10, (x, y) => {
      const d = Math.abs(x + 0.5 - 4) / 4 + Math.abs(y + 0.5 - 5) / 5;
      if (d > 1) return 0;
      return x < 4 ? c(0xe1f5fe) : c(0x7e57c2);
    });
  }

  update(world: World, timeMs: number, localId: number, aimSlot: number | null): void {
    const moves = world.rules.moves;
    const surf = moves.findIndex((m) => m.key === 'surf-suicune');
    const cold = moves.findIndex((m) => m.key === 'sheer-cold-suicune');
    const mirror = moves.findIndex((m) => m.key === 'mirror-coat-suicune');
    const pr = world.projectiles;
    let any = this.spikes.length > 0 || world.players.some((p) => p.mirror || p.calm || (p.line === 'suicune' && p.id === localId && aimSlot !== null));
    for (let i = 0; i < pr.count && !any; i++) if (pr.move[i] === surf || pr.move[i] === cold || pr.move[i] === mirror) any = true;
    this.pool.begin();
    this.front.begin();
    if (!any) {
      this.pool.end();
      this.front.end();
      return;
    }
    this.build();
    const delay = world.rules.activeSkills?.defs.find((d) => d.kind === 'sheerCold')?.sheerCold?.freezeDelaySeconds ?? 0.45;
    // 波頭はまとまりごとに 1 枚（並んだ当たり判定の真ん中に、幅いっぱいで）
    const crests = new Map<number, { x: number; y: number; n: number; vx: number; vy: number; minOff: number; maxOff: number; r: number }>();
    for (let i = 0; i < pr.count; i++) {
      const m = pr.move[i];
      const x = pr.x[i]!;
      const y = pr.y[i]!;
      const r = pr.radius[i]!;
      if (m === surf) {
        if (pr.stage[i] === 0) {
          const g = pr.group[i]!;
          const cr = crests.get(g) ?? { x: 0, y: 0, n: 0, vx: pr.vx[i]!, vy: pr.vy[i]!, minOff: Infinity, maxOff: -Infinity, r };
          cr.x += x;
          cr.y += y;
          cr.n++;
          const v = Math.hypot(cr.vx, cr.vy) || 1;
          const off = x * (-cr.vy / v) + y * (cr.vx / v);
          cr.minOff = Math.min(cr.minOff, off);
          cr.maxOff = Math.max(cr.maxOff, off);
          crests.set(g, cr);
        } else if (pr.stage[i] === 1) {
          const w = this.pool.image(`su-water-${Math.floor(timeMs / 180 + rnd(i, 1) * 3) % WATER_FRAMES}`, this.floorDepth);
          w.setPosition(x, y).setScale((r * 2.3) / WATER);
          // 消える前は小さく
          if (pr.life[i]! < 0.8) w.setScale(((r * 2.3) / WATER) * Math.max(0.2, pr.life[i]! / 0.8));
        }
      } else if (m === cold) {
        if (pr.stage[i] === 3) {
          const t = Math.max(0, Math.min(0.999, 1 - pr.life[i]! / delay));
          if (pr.armStage[i] === 1) {
            // 水が凍っていく
            const ice = this.pool.image(`su-ice-${Math.floor(t * ICE_FRAMES)}`, this.floorDepth + 0.01);
            ice.setPosition(x, y).setScale((r * 2.2) / ICE);
          } else {
            // 雪の結晶の照準が締まる
            const ret = this.pool.image('su-reticle', this.depth);
            ret.setPosition(x, y).setScale(((r * 2.2) / RETICLE) * (1.4 - t * 0.4)).setRotation(t * 1.2);
          }
        } else if (!this.seen.has(pr.serial[i]!)) {
          this.seen.add(pr.serial[i]!);
          this.spikes.push({ x, y, r, at: timeMs });
        }
      } else if (m === mirror) {
        const sh = this.front.image('su-shard', this.frontDepth);
        sh.setPosition(x, y).setScale(DOT * 1.1).setRotation(Math.atan2(pr.vy[i]!, pr.vx[i]!) + timeMs / 80);
        this.front.dot(x - pr.vx[i]! * 0.02, y - pr.vy[i]! * 0.02, 3, 0xe1f5fe);
      }
    }
    if (this.seen.size > 600) this.seen.clear();
    for (const cr of crests.values()) {
      const v = Math.hypot(cr.vx, cr.vy) || 1;
      const ang = Math.atan2(cr.vy, cr.vx);
      const width = cr.maxOff - cr.minOff + cr.r * 2.4;
      const img = this.pool.image(`su-crest-${Math.floor(timeMs / 90) % CREST_FRAMES}`, this.depth);
      img.setPosition(cr.x / cr.n, cr.y / cr.n).setRotation(ang + Math.PI / 2).setScale(width / CREST_W, (cr.r * 2.2) / CREST_H);
      // 前へ飛ぶしぶき
      for (let k = 0; k < 10; k++) {
        const side = (rnd(k, Math.floor(timeMs / 60)) - 0.5) * width;
        const ahead = cr.r * (0.6 + rnd(k, 3) * 0.8);
        const sx = cr.x / cr.n + (cr.vx / v) * ahead + (-cr.vy / v) * side;
        const sy = cr.y / cr.n + (cr.vy / v) * ahead + (cr.vx / v) * side;
        this.front.dot(sx, sy, 4, k % 2 ? 0xffffff : 0xbbdefb);
      }
    }
    // 氷のとげ: 一気に突き出して、砕けて散る
    this.spikes = this.spikes.filter((s) => timeMs - s.at < SPIKE_MS);
    for (const s of this.spikes) {
      const t = (timeMs - s.at) / SPIKE_MS;
      // 場所ごとに、立つ時間・大きさ・向きをばらつかせる（同じ形が並ぶと模様に見える）
      const jit = rnd(Math.round(s.x), Math.round(s.y));
      const rise = Math.max(0, Math.min(1, (t - jit * 0.18) / 0.12));
      const vary = 0.7 + rnd(Math.round(s.y), Math.round(s.x)) * 0.45;
      // 凍った水の板（とげが砕けるまで残る）
      if (t < 0.75) {
        const sheet = this.pool.image(`su-ice-${ICE_FRAMES - 1}`, this.floorDepth + 0.01);
        sheet.setPosition(s.x, s.y).setScale(((s.r / 1.15) * 2.2) / ICE);
      }
      const img = this.pool.image('su-spikes', this.depth + 0.01);
      const sc = (s.r * 2) / SPIKES;
      img.setOrigin(0.5, 0.9).setPosition(s.x + (jit - 0.5) * s.r * 0.5, s.y + s.r * 0.3).setFlipX(jit > 0.5).setScale(sc * vary * (t > 0.6 ? 1 - (t - 0.6) * 1.5 : 1), sc * vary * rise * (t > 0.6 ? 1 - (t - 0.6) * 2 : 1));
      if (t > 0.5) {
        for (let k = 0; k < 10; k++) {
          const a = rnd(k, s.at) * Math.PI * 2;
          const d = s.r * (0.3 + (t - 0.5) * 2) * (0.6 + rnd(k, 4) * 0.6);
          this.front.dot(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d * 0.7 - (t - 0.5) * 40, Math.round(6 * (1 - t)) + 1, k % 2 ? 0xffffff : 0xb3e5fc);
        }
      }
    }
    // ミラーコートの殻・めいそうの結晶
    this.flashes = this.flashes.filter((f) => timeMs - f.at < 220);
    for (const p of world.players) {
      if (p.down) continue;
      if (p.mirror && world.tick < p.mirror.untilTick) {
        const lit = this.flashes.some((f) => f.id === p.id);
        const shell = this.front.image(`su-shell-${Math.floor(timeMs / 110) % SHELL_FRAMES}`, this.frontDepth);
        shell.setPosition(p.x, p.y - 14).setScale(DOT * (lit ? 1.15 : 1.05));
        if (lit) for (let k = 0; k < 8; k++) this.front.dot(p.x + Math.cos(k * 0.785) * 44, p.y - 14 + Math.sin(k * 0.785) * 44, 6, 0xffffff);
      }
      if (p.calm && world.tick < p.calm.untilTick) {
        for (let k = 0; k < p.calm.stacks; k++) {
          const a = (k / p.calm.stacks) * Math.PI * 2 + timeMs / 600;
          const gem = this.front.image('su-gem', this.frontDepth);
          gem.setPosition(p.x + Math.cos(a) * 18, p.y - 46 + Math.sin(a) * 5).setScale(DOT);
        }
        // オーロラのような光の粒が足元から立ちのぼる
        for (let k = 0; k < 6; k++) {
          const ph = (timeMs / 900 + rnd(k, p.id)) % 1;
          this.pool.dot(p.x + (rnd(k, 9) - 0.5) * 36, p.y + 8 - ph * 50, Math.round(4 * (1 - ph)) + 1, [0x80deea, 0xb39ddb, 0xa5d6a7][k % 3]!);
        }
      }
    }
    // 押している間の狙い（本人）
    const me = world.players.find((p) => p.id === localId);
    const slot = aimSlot !== null ? me?.skills?.[aimSlot] : undefined;
    const def = slot ? world.rules.activeSkills?.defs[slot.skill] : undefined;
    if (me && slot && def && !me.down) {
      const [dx, dy] = aimOf(me);
      if (def.kind === 'surf') {
        const lane = surfLane(world, me, slot.skill);
        if (lane) {
          const px = -dy;
          const py = dx;
          const hw = lane.width / 2;
          const step = 24;
          const moving = (timeMs / 20) % step;
          for (let d = moving; d < lane.length; d += step) {
            for (const s of [-1, 1]) this.front.dot(me.x + dx * d + px * hw * s, me.y + dy * d + py * hw * s, 5, slot.charges > 0 ? 0x90caf9 : 0x546e7a);
          }
          for (let o = -hw; o <= hw; o += step) this.front.dot(me.x + dx * lane.length + px * o, me.y + dy * lane.length + py * o, 5, 0xe3f2fd);
        }
      } else if (def.kind === 'sheerCold') {
        let water = 0;
        for (let i = 0; i < pr.count; i++) {
          if (pr.move[i] !== surf || pr.owner[i] !== me.id || pr.stage[i] !== 1) continue;
          water++;
          // 凍る水を白く縁取る
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2 + timeMs / 400;
            this.front.dot(pr.x[i]! + Math.cos(a) * pr.radius[i]!, pr.y[i]! + Math.sin(a) * pr.radius[i]! * 0.8, 4, 0xffffff);
          }
        }
        if (water === 0) {
          const st = pm(world, me, def.move);
          const e = world.enemies;
          let best = -1;
          for (let i = 0; i < e.count; i++) if (e.hp[i]! > 0 && (e.x[i]! - me.x) ** 2 + (e.y[i]! - me.y) ** 2 <= st * st && (best === -1 || e.hp[i]! > e.hp[best]!)) best = i;
          const tx = best !== -1 ? e.x[best]! : me.x + dx * st * 0.5;
          const ty = best !== -1 ? e.y[best]! : me.y + dy * st * 0.5;
          const ret = this.pool.image('su-reticle', this.depth);
          ret.setPosition(tx, ty).setScale(DOT * 1.6 * (1 + Math.sin(timeMs / 120) * 0.05)).setRotation(timeMs / 900);
        }
      }
    }
    this.pool.end();
    this.front.end();
  }
}

/** 技の射程（狙いを見せる） */
function pm(world: World, p: World['players'][number], move: number): number {
  const m = p.moves.find((x) => x.move === move);
  const def = world.rules.moves[move];
  if (!m || !def) return 400;
  return def.levels[Math.min(def.levels.length, m.level) - 1]?.range ?? 400;
}
