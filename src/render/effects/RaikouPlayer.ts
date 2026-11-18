import Phaser from 'phaser';
import type { World } from '../../sim/world';
import { extremeSpeedPreview } from '../../sim/activeSkills';
import { DotPool, c, makeTexture, on, rnd, shade } from './dotArt';

/**
 * 遊べるライコウの技の絵（07 の309章）: かみなり（HP の一番高い敵へ流れて居座る雷雲と、その下に次々落ちる雷）・
 * しんそく（前の敵を角にして折れる稲妻の道を駆け抜ける。押している間は道を見せる）。
 * 雲・地面の焦げは 1 ドットずつ計算した不透明のドット絵、稲妻は不透明の線（薄い塗りは使わない）
 */

const CLOUD_W = 112;
const CLOUD_H = 52;
const CLOUD_FRAMES = 4;
const SCORCH = 40;
const BOLT_MS = 300;
const TRAIL_MS = 420;
/** 雲の高さ（地面からの見た目の高さ） */
const CLOUD_LIFT = 120;

const CLOUD = [0x1a1838, 0x2b2a52, 0x3d3c6e, 0x575a8c, 0x7d82b0];

export class RaikouPlayer {
  private built = false;
  private readonly pool: DotPool;
  private readonly front: DotPool;
  private readonly lines: Phaser.GameObjects.Graphics;
  private bolts: { x: number; y: number; r: number; at: number; seed: number }[] = [];
  private trails: { ax: number; ay: number; bx: number; by: number; at: number; seed: number }[] = [];
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
  }

  private build(): void {
    if (this.built) return;
    this.built = true;
    const s = this.scene;
    // 雷雲: もこもこした暗い雲。下側は暗く、上のふちが明るい。中で光が走る（コマで場所が変わる）
    for (let f = 0; f < CLOUD_FRAMES; f++) {
      makeTexture(s, `rk-cloud-${f}`, CLOUD_W, CLOUD_H, (x, y) => {
        const u = x / CLOUD_W;
        const top = CLOUD_H * (0.42 - 0.22 * Math.sin(u * Math.PI)) - Math.abs(Math.sin(u * Math.PI * 3.3 + f * 0.4)) * 7;
        const bottom = CLOUD_H * 0.92 - Math.abs(Math.sin(u * Math.PI * 4.1)) * 4;
        if (y < top || y > bottom) return 0;
        if (u < 0.03 || u > 0.97) return 0;
        const edge = Math.min(y - top, bottom - y, x, CLOUD_W - x);
        if (edge < 3 && !on(edge / 3, x, y)) return 0;
        const k = (y - top) / (bottom - top);
        const glow = Math.hypot(x - CLOUD_W * (0.3 + 0.13 * f), y - CLOUD_H * 0.6) < 10 + rnd(x, y + f) * 4;
        if (glow) return c(rnd(x, y) > 0.5 ? 0xfff59d : 0xb3b8ff);
        if (y - top < 3) return c(0x9fa4cc);
        return shade(CLOUD, 0.75 - k * 0.65, x, y);
      });
    }
    // 雷の落ちた所の焦げと火花
    makeTexture(s, 'rk-scorch', SCORCH, SCORCH / 2, (x, y) => {
      const nx = (x - (SCORCH - 1) / 2) / (SCORCH / 2);
      const ny = (y - (SCORCH / 2 - 1) / 2) / (SCORCH / 4);
      const r = Math.hypot(nx, ny);
      if (r > 1) return 0;
      const a = Math.atan2(ny, nx);
      if (r > 0.55 && Math.abs(Math.sin(a * 4)) < 0.2) return c(0xfff176);
      return on(1 - r * 0.8, x, y) ? c(r < 0.4 ? 0xfffde7 : 0x3d3a2a) : 0;
    });
  }

  /** ギザギザの稲妻の線（a → b）。太い黄色の上に白い芯 */
  private bolt(ax: number, ay: number, bx: number, by: number, seed: number, width: number, branches: boolean): void {
    const n = 7;
    const pts: [number, number][] = [[ax, ay]];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const px = -(by - ay) / len;
    const py = (bx - ax) / len;
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const j = (rnd(k, seed) - 0.5) * len * 0.16;
      pts.push([ax + (bx - ax) * t + px * j, ay + (by - ay) * t + py * j]);
    }
    pts.push([bx, by]);
    for (const [w, col] of [[width, 0xffd600], [Math.max(1, width * 0.45), 0xffffff]] as const) {
      this.lines.lineStyle(w, col, 1).beginPath().moveTo(pts[0]![0], pts[0]![1]);
      for (const p of pts.slice(1)) this.lines.lineTo(p[0], p[1]);
      this.lines.strokePath();
    }
    if (!branches) return;
    for (let k = 2; k < n - 1; k += 2) {
      const [sx, sy] = pts[k]!;
      const a = Math.atan2(by - ay, bx - ax) + (rnd(k, seed + 7) - 0.5) * 1.6;
      const l = len * 0.18;
      this.lines.lineStyle(Math.max(1, width * 0.5), 0xffd600, 1).beginPath().moveTo(sx, sy).lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l).strokePath();
    }
  }

  update(world: World, timeMs: number, localId: number, aimSlot: number | null): void {
    const moves = world.rules.moves;
    const th = moves.findIndex((m) => m.key === 'thunder-raikou');
    const es = moves.findIndex((m) => m.key === 'extreme-speed-raikou');
    const pr = world.projectiles;
    this.lines.clear();
    let any = this.bolts.length > 0 || this.trails.length > 0 || aimSlot !== null;
    for (let i = 0; i < pr.count && !any; i++) if (pr.move[i] === th || pr.move[i] === es) any = true;
    this.pool.begin();
    this.front.begin();
    if (!any) {
      this.pool.end();
      this.front.end();
      return;
    }
    this.build();
    for (let i = 0; i < pr.count; i++) {
      const m = pr.move[i];
      const x = pr.x[i]!;
      const y = pr.y[i]!;
      if (m === th) {
        if (pr.stage[i] === 0) {
          // 雷雲（空の上）と、地面に落ちる影
          const r = pr.radius[i]!;
          const cloud = this.front.image(`rk-cloud-${Math.floor(timeMs / 110) % CLOUD_FRAMES}`, this.frontDepth);
          cloud.setPosition(x, y - CLOUD_LIFT).setScale((r * 2.6) / CLOUD_W);
          for (let yy = -10; yy <= 10; yy += 4) for (let xx = -r; xx <= r; xx += 4) if ((xx / r) ** 2 + (yy / 10) ** 2 <= 1 && on(0.35, Math.round(xx / 4) + 50, Math.round(yy / 4) + 50)) this.pool.dot(x + xx, y + yy, 4, 0x15142a);
          // 雲から落ちる雨
          for (let k = 0; k < 8; k++) {
            const ph = (timeMs / 300 + rnd(k, i)) % 1;
            this.pool.dot(x + (rnd(k, 3) - 0.5) * r * 1.6, y - CLOUD_LIFT + 20 + ph * (CLOUD_LIFT - 20), 3, 0x9fa8da);
          }
        } else if (!this.seen.has(pr.serial[i]!)) {
          this.seen.add(pr.serial[i]!);
          this.bolts.push({ x, y, r: pr.radius[i]!, at: timeMs, seed: pr.serial[i]! });
        }
      } else if (m === es && !this.seen.has(pr.serial[i]!)) {
        this.seen.add(pr.serial[i]!);
        const len = pr.length[i]!;
        this.trails.push({ ax: x, ay: y, bx: x + pr.dirX[i]! * len, by: y + pr.dirY[i]! * len, at: timeMs, seed: pr.serial[i]! });
      }
    }
    if (this.seen.size > 600) this.seen.clear();
    // 落雷: 雲の高さから地面へ一瞬で落ち、焦げと火花が残る
    this.bolts = this.bolts.filter((b) => timeMs - b.at < BOLT_MS);
    for (const b of this.bolts) {
      const t = (timeMs - b.at) / BOLT_MS;
      const jx = (rnd(b.seed, 2) - 0.5) * b.r * 0.6;
      if (t < 0.55) this.bolt(b.x + jx * 0.4, b.y - CLOUD_LIFT + 14, b.x + jx * 0.2, b.y, b.seed, 6 * (1 - t), true);
      const sc = this.pool.image('rk-scorch', this.floorDepth);
      sc.setPosition(b.x, b.y).setScale((b.r * 1.6) / SCORCH);
      for (let k = 0; k < 6; k++) {
        const a = rnd(k, b.seed) * Math.PI * 2;
        const d = b.r * (0.2 + t * 0.9);
        this.front.dot(b.x + Math.cos(a) * d, b.y + Math.sin(a) * d * 0.6 - t * 14, Math.round(5 * (1 - t)) + 1, k % 2 ? 0xfff59d : 0xffffff);
      }
    }
    // しんそくの道: 稲妻が道に残り、細くなって消える
    this.trails = this.trails.filter((tr) => timeMs - tr.at < TRAIL_MS);
    for (const tr of this.trails) {
      const t = (timeMs - tr.at) / TRAIL_MS;
      this.bolt(tr.ax, tr.ay, tr.bx, tr.by, tr.seed + Math.floor(timeMs / 60), 8 * (1 - t) + 1, t < 0.5);
    }
    // 押している間（本人）: 折れ線の道と、角になる敵の印
    const me = world.players.find((p) => p.id === localId);
    const slot = aimSlot !== null ? me?.skills?.[aimSlot] : undefined;
    if (me && slot && !me.down && world.rules.activeSkills?.defs[slot.skill]?.kind === 'extremeSpeed') {
      const pts = extremeSpeedPreview(world, me, slot.skill);
      if (pts) {
        const ready = slot.charges > 0;
        for (let k = 1; k < pts.length; k++) {
          const a = pts[k - 1]!;
          const b = pts[k]!;
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          const step = 18;
          const off = (timeMs / 15) % step;
          for (let d = off; d < len; d += step) this.front.dot(a.x + ((b.x - a.x) * d) / len, a.y + ((b.y - a.y) * d) / len, 5, ready ? 0xffee58 : 0x6d6a4a);
          if (k < pts.length - 1) for (let q = 0; q < 4; q++) this.front.dot(b.x + Math.cos(q * 1.57 + timeMs / 200) * 12, b.y + Math.sin(q * 1.57 + timeMs / 200) * 12, 5, 0xffffff);
        }
        const end = pts[pts.length - 1]!;
        this.front.dot(end.x, end.y, 9, ready ? 0xfff59d : 0x6d6a4a);
      }
    }
    this.pool.end();
    this.front.end();
  }
}

