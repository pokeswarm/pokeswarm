import Phaser from 'phaser';
import type { World } from '../../sim/world';
import type { SkillUsedEvent } from '../../sim/events';
import { teleportDestination } from '../../sim/activeSkills';
import { DOT, DotPool, c, makeTexture, on, rnd, shade } from './dotArt';

/**
 * 遊べるミュウツーの技の絵（07 の305章）: サイコブレイク（ためる → 追う 1 発の玉 → 大きな爆発）と、アクティブスキルの テレポート
 * （行き先の印・消える・現れる・重ねた強化のまとい）。ボス戦の MewtwoPsychic と同じく、1 ドットずつ計算した不透明のドット絵で描く
 * （薄さはディザ。半透明の塗りは使わない）
 */

const ORB = 48;
const ORB_FRAMES = 6;
const BURST = 128;
const BURST_FRAMES = 9;
const SWIRL = 96;
const SWIRL_FRAMES = 6;
const PILLAR_W = 16;
const PILLAR_H = 56;
const RING_W = 48;
const RING_H = 22;
/** 爆発の見た目の長さ（ミリ秒。当たりは技の値で短い） */
const BURST_MS = 900;
const VANISH_MS = 420;
const APPEAR_MS = 520;

/** 紫のエネルギーの色の段（暗い → 明るい） */
const VIOLET = [0x2a0a3e, 0x4a1272, 0x6e1aa0, 0x9a2ccc, 0xc455ee, 0xe68cff, 0xfad4ff];
const RIM = [0x9a2ccc, 0xe040fb, 0xff8ad8, 0xffc9ec];
const SPARK = [0xffb300, 0xffe082, 0xfffde7];

export class MewtwoPlayer {
  private built = false;
  private readonly pool: DotPool;
  private readonly front: DotPool;
  private bursts: { x: number; y: number; r: number; at: number }[] = [];
  private seenBursts = new Set<number>();
  private blinks: { x: number; y: number; at: number; appear: boolean; stacks: number }[] = [];
  /** ほかのブラウザのプレイヤーの前の位置（テレポートを位置の飛びで見つける） */
  private lastPos = new Map<number, { x: number; y: number }>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
    private readonly floorDepth: number,
    /** ポケモンの絵より手前（ためる玉は体の前に） */
    private readonly frontDepth: number,
  ) {
    this.pool = new DotPool(scene, depth + 0.02);
    this.front = new DotPool(scene, frontDepth + 0.01);
  }

  /** テレポートした（本人のブラウザのイベント） */
  onSkillUsed(ev: SkillUsedEvent, timeMs: number): void {
    this.build();
    this.blinks.push({ x: ev.fromX, y: ev.fromY, at: timeMs, appear: false, stacks: ev.stacks }, { x: ev.toX, y: ev.toY, at: timeMs, appear: true, stacks: ev.stacks });
  }

  private build(): void {
    if (this.built) return;
    this.built = true;
    const s = this.scene;
    // 玉: 中は暗い紫の渦、外へ明るい紫、縁は桃色に光り、片側（右下）だけ橙が差す
    for (let f = 0; f < ORB_FRAMES; f++) {
      const ph = (f / ORB_FRAMES) * Math.PI * 2;
      makeTexture(s, `m2p-orb-${f}`, ORB, ORB, (x, y) => {
        const cx = (ORB - 1) / 2;
        const dx = x - cx;
        const dy = y - cx;
        const r = Math.hypot(dx, dy) / (ORB / 2);
        if (r > 1) return 0;
        const a = Math.atan2(dy, dx);
        if (r > 0.86) {
          if (r > 0.95 && !on(0.6, x, y)) return 0;
          const warm = Math.cos(a - 0.7) > 0.55;
          return warm ? c(r > 0.93 ? 0xffb74d : 0xff8a65) : shade(RIM, 1 - (r - 0.86) * 6, x, y);
        }
        const swirl = Math.sin(a * 3 - r * 9 + ph) + Math.sin(a * 5 + r * 4 - ph * 2) * 0.4;
        if (r < 0.2) return c(r < 0.1 ? 0xfff4ff : 0xf2c4ff);
        const t = 0.15 + (1 - r) * 0.35 + (swirl > 0.6 ? 0.42 : swirl > 0 ? 0.18 : 0) + (r > 0.7 ? 0.2 : 0);
        return shade(VIOLET, t, x, y);
      });
    }
    // 爆発: 白い閃光 → 紫の殻が広がる → 中は暗い紫の渦 → 殻が崩れて粒になって消える。黄色い稲妻のとげが外へ
    for (let f = 0; f < BURST_FRAMES; f++) {
      const t = f / (BURST_FRAMES - 1);
      makeTexture(s, `m2p-burst-${f}`, BURST, BURST, (x, y) => {
        const cx = (BURST - 1) / 2;
        const dx = x - cx;
        const dy = y - cx;
        const r = Math.hypot(dx, dy) / (BURST / 2);
        if (r > 1) return 0;
        const a = Math.atan2(dy, dx);
        const ring = 0.28 + 0.66 * Math.sqrt(t);
        const thick = 0.2 * (1 - t) + 0.05;
        const fade = 1 - Math.max(0, t - 0.55) / 0.45;
        // 稲妻のとげ（はじめの方だけ）
        if (t < 0.6) {
          for (let k = 0; k < 7; k++) {
            const ka = (k / 7) * Math.PI * 2 + rnd(k, 3) * 0.6;
            let da = a - ka;
            da = Math.atan2(Math.sin(da), Math.cos(da));
            const jag = Math.sin(r * 26 + k) * 0.035;
            if (Math.abs(da + jag) < 0.045 && r > ring * 0.6 && r < ring + 0.22) return c(r > ring + 0.12 ? SPARK[0]! : SPARK[1]!);
          }
        }
        // 殻
        const edge = Math.abs(r - ring);
        if (edge < thick) {
          const k = 1 - edge / thick;
          const broken = t > 0.5 && rnd(Math.floor(a * 12), f) < (t - 0.5) * 1.6;
          if (broken || !on(fade * (0.5 + k * 0.6), x, y)) return 0;
          const warm = Math.cos(a - 0.7) > 0.6;
          return warm && k > 0.4 ? c(k > 0.75 ? 0xffcc80 : 0xff8a65) : shade(RIM, k, x, y);
        }
        // 中: 閃光の芯（はじめ）と、暗い紫の渦（だんだん薄く）
        if (r < ring) {
          if (t < 0.25 && r < 0.4 * (1 - t * 2.5)) return c(r < 0.2 ? 0xffffff : 0xfad4ff);
          const swirl = Math.sin(a * 4 - r * 10 + t * 6);
          const d = (1 - t) * (0.55 + (swirl > 0.3 ? 0.35 : 0));
          if (!on(d * fade, x, y)) return 0;
          return shade(VIOLET, 0.12 + (swirl > 0.3 ? 0.35 : 0.1) + (1 - r / ring) * 0.2, x, y);
        }
        // 外の粒
        if (r < ring + 0.18 && rnd(x * 3 + f, y) > 0.93 && fade > 0.2) return c(0xe68cff);
        return 0;
      });
    }
    // ためる渦: 外から中心へ巻き込む紫の腕（中ほど濃い）
    for (let f = 0; f < SWIRL_FRAMES; f++) {
      const ph = (f / SWIRL_FRAMES) * Math.PI * 2;
      makeTexture(s, `m2p-swirl-${f}`, SWIRL, SWIRL, (x, y) => {
        const cx = (SWIRL - 1) / 2;
        const dx = x - cx;
        const dy = y - cx;
        const r = Math.hypot(dx, dy) / (SWIRL / 2);
        if (r > 1 || r < 0.12) return 0;
        const a = Math.atan2(dy, dx);
        const arm = Math.sin(a * 3 + Math.log(r) * 5 - ph);
        if (arm < 0.15) return 0;
        const d = Math.min(1, (1.15 - r) * 1.4) * Math.min(1, (arm - 0.15) * 2.2);
        if (!on(d, x, y)) return 0;
        // 腕の芯は明るく（桃色）、外側は暗い紫
        return arm > 0.8 && r < 0.75 ? c(r < 0.4 ? 0xfad4ff : 0xe68cff) : shade(VIOLET, 0.3 + (1 - r) * 0.55 + (arm - 0.15) * 0.25, x, y);
      });
    }
    // 光の柱（消える・現れるときに立つ）: 芯は白、外へ紫。上へ行くほど点が減る
    makeTexture(s, 'm2p-pillar', PILLAR_W, PILLAR_H, (x, y) => {
      const k = Math.abs(x - (PILLAR_W - 1) / 2) / (PILLAR_W / 2);
      const up = 1 - y / PILLAR_H;
      if (k > 1 || !on(1.05 - up * 0.75 - k * 0.3, x, y)) return 0;
      return k < 0.22 ? c(0xfff4ff) : k < 0.5 ? c(0xe68cff) : c(0xa040d8);
    });
    // 地面の輪（楕円）: 現れる所・消える所・行き先の印
    makeTexture(s, 'm2p-ring', RING_W, RING_H, (x, y) => {
      const nx = (x - (RING_W - 1) / 2) / (RING_W / 2);
      const ny = (y - (RING_H - 1) / 2) / (RING_H / 2);
      const r = Math.hypot(nx, ny);
      if (r > 1 || r < 0.72) return 0;
      return r > 0.9 ? c(0xc455ee) : c(0xf6b6ff);
    });
    // 行き先の印: 切れ目のある楕円（回して見せる）と、真ん中の小さなひし形
    makeTexture(s, 'm2p-mark', RING_W, RING_H, (x, y) => {
      const nx = (x - (RING_W - 1) / 2) / (RING_W / 2);
      const ny = (y - (RING_H - 1) / 2) / (RING_H / 2);
      const r = Math.hypot(nx, ny);
      const a = Math.atan2(ny, nx);
      if (Math.abs(nx) * 3.2 + Math.abs(ny) * 1.6 < 0.42) return c(0xfad4ff);
      if (r > 1 || r < 0.74) return 0;
      if (Math.sin(a * 6) < -0.2) return 0;
      return r > 0.88 ? c(0xd16cf0) : c(0xfad4ff);
    });
  }

  update(world: World, timeMs: number, localId: number, aimSlot: number | null): void {
    const pr = world.projectiles;
    const moves = world.rules.moves;
    const psy = moves.findIndex((m) => m.key === 'psystrike');
    const hasTeleport = world.players.some((p) => p.skills?.some((s) => world.rules.activeSkills?.defs[s.skill]?.kind === 'teleport'));
    const mewtwoLine = world.players.some((p) => p.line === 'mewtwo');
    let any = this.bursts.length > 0 || this.blinks.length > 0 || aimSlot !== null || hasTeleport;
    for (let i = 0; i < pr.count && !any; i++) if (pr.move[i] === psy) any = true;
    for (const p of world.players) if (p.moves.some((m) => m.move === psy && m.windup !== undefined)) any = true;
    if (!any && !mewtwoLine) {
      this.pool.begin();
      this.pool.end();
      this.front.begin();
      this.front.end();
      return;
    }
    this.build();
    this.pool.begin();
    this.front.begin();

    // ほかのブラウザのプレイヤーのテレポート: 位置が大きく飛んだら、消える・現れるを出す
    for (const p of world.players) {
      const last = this.lastPos.get(p.id);
      this.lastPos.set(p.id, { x: p.x, y: p.y });
      if (!p.remote || p.line !== 'mewtwo' || !last) continue;
      if (Math.hypot(p.x - last.x, p.y - last.y) > 200) this.blinks.push({ x: last.x, y: last.y, at: timeMs, appear: false, stacks: 0 }, { x: p.x, y: p.y, at: timeMs, appear: true, stacks: 0 });
    }

    // サイコブレイクをためる: 体のまわりに外から紫の渦が巻き込み、体の前で玉が育つ
    if (psy !== -1) {
      for (const p of world.players) {
        const pm = p.moves.find((m) => m.move === psy && m.windup !== undefined);
        const w = moves[psy]!.windupSeconds;
        if (!pm || !w || p.down) continue;
        const t = Math.max(0, Math.min(1, 1 - pm.windup! / w));
        const sw = this.pool.image(`m2p-swirl-${Math.floor(timeMs / 70) % SWIRL_FRAMES}`, this.depth);
        sw.setPosition(p.x, p.y - 14).setScale(DOT * (1.7 - t * 0.7)).setRotation(-timeMs / 260);
        // 内側にもう 1 つ、逆に回る小さな渦（重ねて濃く見せる）
        const sw2 = this.pool.image(`m2p-swirl-${(Math.floor(timeMs / 70) + 3) % SWIRL_FRAMES}`, this.depth);
        sw2.setPosition(p.x, p.y - 14).setScale(DOT * (0.9 - t * 0.35)).setRotation(timeMs / 200).setFlipX(true);
        const fx = p.facingX || (p.facingY ? 0 : 1);
        const fy = p.facingY;
        const fl = Math.hypot(fx, fy) || 1;
        const ox = p.x + (fx / fl) * 26;
        const oy = p.y - 16 + (fy / fl) * 18;
        const orb = this.front.image(`m2p-orb-${Math.floor(timeMs / 60) % ORB_FRAMES}`, this.frontDepth);
        orb.setPosition(ox, oy).setScale(DOT * (0.15 + t * 0.55));
        // 吸い込まれる粒
        for (let k = 0; k < 24; k++) {
          const ph = (rnd(k, 7) + timeMs / 480) % 1;
          const ang = rnd(k, 9) * Math.PI * 2 + timeMs / 700 + ph * 1.5;
          const rr = 120 * (1 - ph) + 6;
          this.front.dot(ox + Math.cos(ang) * rr, oy + Math.sin(ang) * rr * 0.85, Math.round(7 - ph * 4), (k % 4 === 0 ? 0xffe082 : k % 2 ? 0xe68cff : 0xfad4ff));
        }
      }
    }

    // サイコブレイクの玉: 当たり判定の大きさに合わせ、まわりに黄色い稲妻の火花と、後ろに紫の尾
    for (let i = 0; i < pr.count; i++) {
      if (pr.move[i] !== psy) continue;
      const x = pr.x[i]!;
      const y = pr.y[i]!;
      if (pr.stage[i] === 0) {
        const r = pr.radius[i]!;
        const orb = this.pool.image(`m2p-orb-${Math.floor(timeMs / 55) % ORB_FRAMES}`, this.depth);
        orb.setPosition(x, y).setScale((r * 2.3) / ORB);
        const vx = pr.vx[i]!;
        const vy = pr.vy[i]!;
        const v = Math.hypot(vx, vy) || 1;
        // 尾: 後ろへ細くなる紫の粒の帯（細かい粒を散らして、四角が並んで見えないように）
        for (let k = 0; k < 70; k++) {
          const along = r * 0.6 + rnd(k, 1) * r * 2.4;
          const spread = (rnd(k, 2) - 0.5) * r * 1.1 * (1 - along / (r * 3.2));
          const wob = Math.sin(along * 0.08 - timeMs / 70) * r * 0.12;
          const bx = x - (vx / v) * along - (vy / v) * (spread + wob);
          const by = y - (vy / v) * along + (vx / v) * (spread + wob);
          const fall = along / (r * 3);
          if (rnd(k, Math.floor(timeMs / 50)) < fall * 0.7) continue;
          this.pool.dot(bx, by, Math.max(3, Math.round(r * 0.3 * (1 - fall))), (fall < 0.35 ? 0xe68cff : fall < 0.65 ? 0xc455ee : 0x7a2cb0));
        }
        // 稲妻の火花（玉の外で短いギザギザ）
        for (let k = 0; k < 4; k++) {
          const ang = rnd(k, Math.floor(timeMs / 90)) * Math.PI * 2;
          let px = x + Math.cos(ang) * r * 1.05;
          let py = y + Math.sin(ang) * r * 1.05;
          for (let j = 0; j < 4; j++) {
            const nx = px + Math.cos(ang + (j % 2 ? 0.7 : -0.7)) * r * 0.18;
            const ny = py + Math.sin(ang + (j % 2 ? 0.7 : -0.7)) * r * 0.18;
            this.front.dot(nx, ny, 3, (j === 1 ? SPARK[2]! : SPARK[1]!));
            px = nx;
            py = ny;
          }
        }
      } else if (!this.seenBursts.has(pr.serial[i]!)) {
        // 弾けた（効き方の爆発）: 見た目は当たりより長く残す
        this.seenBursts.add(pr.serial[i]!);
        this.bursts.push({ x, y, r: pr.radius[i]!, at: timeMs });
      }
    }
    if (this.seenBursts.size > 200) this.seenBursts.clear();
    this.bursts = this.bursts.filter((b) => timeMs - b.at < BURST_MS);
    for (const b of this.bursts) {
      const t = (timeMs - b.at) / BURST_MS;
      const f = Math.min(BURST_FRAMES - 1, Math.floor(t * BURST_FRAMES));
      const img = this.pool.image(`m2p-burst-${f}`, this.depth + 0.01);
      img.setPosition(b.x, b.y).setScale((b.r * 2.25 * (0.85 + t * 0.25)) / BURST);
      // 飛び散る火の粉
      for (let k = 0; k < 18; k++) {
        const ang = rnd(k, b.at) * Math.PI * 2;
        const d = b.r * (0.4 + t * 1.1) * (0.7 + rnd(k, 3) * 0.5);
        const sz = Math.round(5 * (1 - t));
        this.front.dot(b.x + Math.cos(ang) * d, b.y + Math.sin(ang) * d, sz, (k % 4 === 0 ? SPARK[1]! : k % 2 ? 0xe68cff : 0xfad4ff));
      }
    }

    // テレポート: 消える所は柱が細く閉じて輪が縮む、現れる所は輪が広がり柱が開いて閉じる。粒が立ちのぼる
    this.blinks = this.blinks.filter((b) => timeMs - b.at < (b.appear ? APPEAR_MS : VANISH_MS));
    for (const b of this.blinks) {
      const t = (timeMs - b.at) / (b.appear ? APPEAR_MS : VANISH_MS);
      const ring = this.pool.image('m2p-ring', this.floorDepth);
      const rs = b.appear ? 0.5 + t * 0.9 : 1.3 - t * 1.1;
      ring.setPosition(b.x, b.y + 4).setScale(DOT * rs * 1.2);
      if (b.appear && t > 0.7 && !on(1 - (t - 0.7) / 0.3, Math.floor(timeMs / 40), 1)) ring.setVisible(false);
      const pil = this.pool.image('m2p-pillar', this.depth + 0.03);
      const open = b.appear ? Math.sin(Math.min(1, t * 1.6) * Math.PI) : 1 - t;
      pil.setOrigin(0.5, 1).setPosition(b.x, b.y + 6).setScale(DOT * Math.max(0.05, open) * 1.3, DOT * (b.appear ? 1.2 : 1.2 + t * 0.6));
      for (let k = 0; k < 10; k++) {
        const ph = (t + rnd(k, 5)) % 1;
        const px = b.x + (rnd(k, 11) - 0.5) * 50;
        const py = b.y - ph * 70;
        this.front.dot(px, py, 4 - ph * 3, (b.appear ? (k % 3 ? 0xfad4ff : 0xffe082) : 0xc455ee));
      }
    }

    // 強化のまとい: 重ねた数だけ、体のまわりを紫の光の粒が回る
    for (const p of world.players) {
      if (!p.skillBuff || world.tick >= p.skillBuff.untilTick || p.down) continue;
      const n = p.skillBuff.stacks;
      // 足元の輪（重ねた数で大きく）と、体のまわりを回る光の粒（重ねた数だけ）
      const ring = this.pool.image('m2p-ring', this.floorDepth);
      ring.setPosition(p.x, p.y + 6).setScale(DOT * (0.9 + n * 0.18) * (1 + Math.sin(timeMs / 150) * 0.05));
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2 + timeMs / 300;
        const px = p.x + Math.cos(ang) * 34;
        const py = p.y - 14 + Math.sin(ang) * 16;
        this.front.dot(px, py, 10, (0xe040fb));
        this.front.dot(px, py, 5, (0xfff4ff));
      }
    }

    // 行き先の印（本人が SPACE を押している間）
    const me = world.players.find((p) => p.id === localId);
    const slot = aimSlot !== null ? me?.skills?.[aimSlot] : undefined;
    if (me && slot && !me.down) {
      const to = teleportDestination(world, me, slot.skill);
      const ready = slot.charges > 0;
      const mark = this.pool.image('m2p-mark', this.floorDepth);
      const pulse = 1 + Math.sin(timeMs / 120) * 0.08;
      mark.setPosition(to.x, to.y + 4).setScale(DOT * 2.2 * pulse).setRotation(0);
      if (!ready) mark.setVisible(on(0.5, Math.floor(timeMs / 120), 0));
      // 点の軌跡
      const n = 12;
      for (let k = 1; k < n; k++) {
        const tt = k / n;
        const lift = Math.sin(tt * Math.PI) * 26;
        const px = me.x + (to.x - me.x) * tt;
        const py = me.y + (to.y - me.y) * tt - lift;
        if ((k + Math.floor(timeMs / 90)) % 3 === 0) continue;
        this.front.dot(px, py, 6, (ready ? (k % 2 ? 0xfad4ff : 0xe68cff) : 0x7a3a74));
      }
    }

    this.pool.end();
    this.front.end();
  }
}
