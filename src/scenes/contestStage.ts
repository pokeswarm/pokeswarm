import { effectRecipes, moveSprites } from '../data';
import type { ContestState } from '../sim/contest';
import type { World } from '../sim/world';

/** 部門の色（舞台の幕と光） */
const CATEGORY_COLOR: Record<string, string> = { cool: '#e53935', beauty: '#1e88e5', cute: '#ec407a', smart: '#43a047', tough: '#fdd835' };
const W = 320;
const H = 180;
/** 立ち位置（4人まで。奥の段） */
const SLOT_X = [58, 124, 196, 262];
const SLOT_Y = 106;
const FRONT_Y = 136;
/** 客の髪の色（後ろ姿の頭のてっぺん。暗い客席の中で一人ずつ見分けられるように） */
const HAIR = ['#5b3a29', '#2f2f46', '#8a6a2f', '#6b2f4f', '#3f5a6b', '#4a3a6b'];

interface Atlas {
  image: HTMLImageElement;
  frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
  blank?: Map<string, number>;
  counts?: Map<string, number>;
}

/** 舞台の上の 1 コマの動き */
interface Motion {
  /** 使う絵の動き（先に見つかったもの。無ければ歩き） */
  anim: readonly string[];
  /** 向き（0 が正面。絵は 8 方向） */
  dir: number;
  /** その動きの進み（0〜1） */
  progress: number;
  /** 体の回転（ラジアン）と、持ち上げる高さ */
  rotate: number;
  lift: number;
  /** 絵のコマを時間で回し続ける */
  loop: boolean;
}

const REST: Motion = { anim: ['Idle', 'Walk'], dir: 0, progress: 0, rotate: 0, lift: 0, loop: true };

/**
 * アピールの動き: strut（左右に体を揺らして歩く）・spin（その場で 8 方向を回る）・hop（跳ねる）・
 * flip（跳びながら縦に 1 回転）・pose（決めポーズ。絵に攻撃やためがあれば使う。無ければ胸を張って止まる）
 */
function shapeMotion(kind: string, p: number, lift: number): Motion {
  const arc = 4 * p * (1 - p);
  if (kind === 'spin') return { anim: ['Walk'], dir: Math.floor(p * 8) % 8, progress: p, rotate: 0, lift: lift * arc, loop: true };
  if (kind === 'hop') return { anim: ['Walk'], dir: 0, progress: p, rotate: 0, lift: lift * Math.abs(Math.sin(p * Math.PI * 2)), loop: true };
  if (kind === 'flip') return { anim: ['Walk'], dir: 0, progress: p, rotate: -p * Math.PI * 2, lift: lift * arc, loop: true };
  if (kind === 'pose') return { anim: ['Charge', 'Attack', 'Idle'], dir: 0, progress: p, rotate: 0, lift: lift * arc, loop: false };
  return { anim: ['Walk'], dir: 0, progress: p, rotate: Math.sin(p * Math.PI * 2) * 0.16, lift: lift * Math.abs(Math.sin(p * Math.PI * 4)), loop: true };
}

/**
 * ポケモンコンテストの舞台（07 の192章）: 会場は自作の絵をコードで描く。Phaser と別に DOM の canvas へ描くので、
 * 止まっているゲームの画面の上に出せる。ポケモンは public/sprites の絵、技は技のドット絵（data/render/move-sprites.json）をそのまま使う
 */
export class ContestStage {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly atlases = new Map<string, Atlas | 'loading' | 'none'>();
  private readonly moveCache = new Map<string, { frames: HTMLCanvasElement[]; frameMs: number }>();
  private readonly backdrop: HTMLCanvasElement;
  private backdropColor = '';
  /** 飛ぶ紙吹雪・ハート（見た目だけ。乱数はシミュレーションと別） */
  private readonly bits: { x: number; y: number; vx: number; vy: number; life: number; color: string; heart: boolean }[] = [];
  private lastKey = '';
  private keyAt = 0;
  /** 前のコマの空気（高まっている途中か、冷めている途中か） */
  private prevAir = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.style.cssText = 'width:100%;aspect-ratio:16/9;image-rendering:pixelated;display:block;border:2px solid #000;box-sizing:border-box;touch-action:manipulation';
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    this.backdrop = document.createElement('canvas');
    this.backdrop.width = W;
    this.backdrop.height = H;
  }

  /**
   * 観客の空気（0〜1。1 が一番盛り上がった瞬間）。自分の番に画面と同じ値を送る。
   * 静かな所からゆっくり高まり（riseShare の間）、頂点の後は早く冷める。1 回の長さは番ごとに変わるので、拍子を覚えるのでなく客を見る
   */
  static airAt(seconds: number, periodSeconds: number, riseShare: number): number {
    const f = (seconds / periodSeconds) % 1;
    return f < riseShare ? f / riseShare : (1 - f) / (1 - riseShare);
  }

  /** 舞台を1コマ描く。spriteKeyOf は舞台の人のポケモンのキー。air があれば自分の番の観客の空気 */
  draw(world: World, c: ContestState, spriteKeyOf: (playerId: number) => string, air: number | null, nowMs: number): void {
    const g = this.ctx;
    const category = c.entrants.find((e) => e.category)?.category ?? 'cool';
    this.paintBackdrop(category);
    g.drawImage(this.backdrop, 0, 0);
    this.drawLights(g, c, nowMs, category);
    const key = `${c.phase}:${c.round}:${c.turn}:${c.shown}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.keyAt = nowMs;
      if (c.shown && c.lastAppeal) this.burst(c, c.turn, c.lastAppeal.cheer);
      if (c.phase === 'result') this.confetti();
    }
    const winner = c.phase === 'result' ? c.results?.[0] : undefined;
    c.entrants.forEach((e, k) => {
      const active = c.phase === 'appeal' && k === c.turn;
      const isWinner = !!winner && winner.playerId === e.playerId && winner.npc === e.npc;
      const x = isWinner ? W / 2 : SLOT_X[k % SLOT_X.length]!;
      const y = active || isWinner ? FRONT_Y : SLOT_Y;
      const dim = c.phase === 'result' && !isWinner ? 0.45 : 1;
      // 技を出している間は技の形。それ以外はずっとアピールの動きを続ける。自分の番は客の空気と一緒に大きくなる
      const motion = active && c.shown ? this.castMotion(nowMs - this.keyAt) : active && air !== null ? this.climaxMotion(air, nowMs) : c.phase === 'result' && !isWinner ? REST : this.routineMotion(world, k, nowMs);
      this.drawPokemon(g, e.playerId !== null ? spriteKeyOf(e.playerId) : e.npc!, x, y, active || isWinner ? 2 : 1.5, motion, nowMs + k * 130, dim);
      // これまでのハートの数を足元に（一次審査の後から見せる）
      if (c.phase !== 'branch' && c.phase !== 'entry') this.drawHearts(g, x, y + 7, e.primary + e.appeals.reduce((a, b) => a + b, 0), c.phase === 'primary' ? (nowMs - this.keyAt) / 180 : 99);
    });
    // 披露している技
    if (c.phase === 'appeal' && c.shown && c.lastAppeal?.move !== null && c.lastAppeal) {
      const x = SLOT_X[c.turn % SLOT_X.length]!;
      this.drawMoveArt(g, world, c.lastAppeal.move!, x, FRONT_Y - 62, nowMs - this.keyAt);
    }
    this.prevAir = air ?? 0;
    this.drawAudience(g, this.airOf(c, air, nowMs), category, nowMs);
    this.drawCrowdMeter(g, c, world);
    this.drawBits(g);
  }

  /** 紙吹雪: 結果の 1 回だけ。点滅はさせない */
  private confetti(): void {
    const colors = ['#ffeb3b', '#f06292', '#4fc3f7', '#aed581', '#ffffff'];
    for (let k = 0; k < 60; k++) this.bits.push({ x: Math.random() * W, y: -Math.random() * 60, vx: (Math.random() - 0.5) * 12, vy: 22 + Math.random() * 30, life: 3.5, color: colors[k % colors.length]!, heart: false });
  }

  private burst(c: ContestState, turn: number, cheer: boolean): void {
    const x = SLOT_X[turn % SLOT_X.length]!;
    const n = cheer ? 24 : 7;
    for (let k = 0; k < n; k++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * (cheer ? 2.4 : 1.2);
      const v = 30 + Math.random() * (cheer ? 70 : 30);
      this.bits.push({ x, y: FRONT_Y - 20, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, color: '#ff5c8a', heart: true });
    }
    if (c.lastAppeal?.points === 0) this.bits.length = 0;
  }

  private drawBits(g: CanvasRenderingContext2D): void {
    const dt = 1 / 60;
    for (let k = this.bits.length - 1; k >= 0; k--) {
      const b = this.bits[k]!;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.y > H) {
        this.bits.splice(k, 1);
        continue;
      }
      g.fillStyle = b.color;
      if (b.heart) {
        const x = Math.round(b.x);
        const y = Math.round(b.y);
        g.fillRect(x - 2, y - 1, 2, 2);
        g.fillRect(x + 1, y - 1, 2, 2);
        g.fillRect(x - 2, y, 5, 1);
        g.fillRect(x - 1, y + 1, 3, 1);
        g.fillRect(x, y + 2, 1, 1);
      } else g.fillRect(Math.round(b.x), Math.round(b.y), 2, 2);
    }
  }

  /** 会場の変わらない部分（幕・床）。部門が変わったときだけ描き直す */
  private paintBackdrop(category: string): void {
    if (this.backdropColor === category) return;
    this.backdropColor = category;
    const g = this.backdrop.getContext('2d')!;
    const accent = CATEGORY_COLOR[category] ?? '#e53935';
    g.fillStyle = '#1a1030';
    g.fillRect(0, 0, W, H);
    // 奥の幕（ひだを縦の帯で）
    for (let x = 0; x < W; x += 8) {
      g.fillStyle = x % 16 === 0 ? '#7a1f2e' : '#5e1623';
      g.fillRect(x, 16, 8, 68);
    }
    // 奥の幕の裾の金の線
    g.fillStyle = '#e8c15a';
    g.fillRect(0, 82, W, 2);
    // 床（板張り。手前ほど広い）
    for (let y = 84; y < H; y += 6) {
      g.fillStyle = (y / 6) % 2 < 1 ? '#a8733f' : '#94622f';
      g.fillRect(0, y, W, 6);
    }
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let k = -8; k <= 8; k++) {
      g.beginPath();
      g.moveTo(W / 2 + k * 22, 84);
      g.lineTo(W / 2 + k * 44, H);
      g.lineTo(W / 2 + k * 44 + 1, H);
      g.lineTo(W / 2 + k * 22 + 1, 84);
      g.fill();
    }
    // 両脇の幕
    for (const side of [0, 1]) {
      for (let k = 0; k < 4; k++) {
        const x = side === 0 ? k * 7 : W - (k + 1) * 7;
        g.fillStyle = k % 2 ? '#a02634' : '#c23346';
        g.fillRect(x, 0, 7, 104 - k * 8);
        // 幕の裾の丸み
        g.fillRect(x + 1, 104 - k * 8, 5, 2);
      }
    }
    // 上の垂れ幕（部門の色の飾りと金の房）
    g.fillStyle = '#c23346';
    g.fillRect(0, 0, W, 14);
    g.fillStyle = accent;
    g.fillRect(0, 10, W, 4);
    for (let x = 0; x < W; x += 12) {
      g.fillStyle = '#e8c15a';
      g.fillRect(x + 4, 14, 4, 3);
      g.fillRect(x + 5, 17, 2, 2);
    }
    // 真ん中のリボンの飾り
    g.fillStyle = '#e8c15a';
    g.fillRect(W / 2 - 15, 2, 30, 12);
    g.fillStyle = accent;
    g.fillRect(W / 2 - 13, 4, 26, 8);
    g.fillStyle = '#fff';
    g.fillRect(W / 2 - 2, 6, 4, 4);
  }

  /** ゆっくり動くスポットライト。盛り上がると広くなる（明滅はさせない） */
  private drawLights(g: CanvasRenderingContext2D, c: ContestState, nowMs: number, category: string): void {
    const accent = CATEGORY_COLOR[category] ?? '#ffffff';
    g.save();
    const aim = c.phase === 'appeal' ? SLOT_X[c.turn % SLOT_X.length]! : W / 2;
    g.globalAlpha = 0.22;
    g.fillStyle = '#fff6c8';
    g.beginPath();
    g.moveTo(aim - 5, 14);
    g.lineTo(aim + 5, 14);
    g.lineTo(aim + 30, FRONT_Y + 10);
    g.lineTo(aim - 30, FRONT_Y + 10);
    g.fill();
    g.globalAlpha = 0.1 + 0.02 * c.crowd;
    g.fillStyle = accent;
    for (const side of [0, 1]) {
      const swing = Math.sin(nowMs / 1400 + side * 2) * 40;
      const tx = (side ? W - 70 : 70) + swing;
      g.beginPath();
      g.moveTo(side ? W - 24 : 24, 14);
      g.lineTo((side ? W - 24 : 24) + 6, 14);
      g.lineTo(tx + 22, 120);
      g.lineTo(tx - 22, 120);
      g.fill();
    }
    g.restore();
  }

  /** 今の客の空気: 自分の番はその値。アピールの直後は出来に応じて沸いて冷める。ほかは今までの盛り上がりの分だけ */
  private airOf(c: ContestState, air: number | null, nowMs: number): number {
    if (air !== null) return air;
    const base = 0.08 + c.crowd * 0.08;
    if (c.phase === 'result') return 0.9;
    if (c.phase !== 'appeal' || !c.shown || !c.lastAppeal) return base;
    const a = c.lastAppeal;
    const peak = a.cheer || a.rating === 'great' ? 1 : a.rating === 'npc' || a.rating === 'good' ? 0.72 : 0.35;
    return Math.max(base, peak * Math.max(0, 1 - (nowMs - this.keyAt) / 900));
  }

  /**
   * 客席（タイミングの手がかりはここだけ。バーや数字は出さない）: 空気が高まると、ざわつき → 身を乗り出す → 1人ずつ手が上がる →
   * 全員が跳ねてペンライトを振り、ハートが飛ぶ。一番盛り上がると全員の拍がそろう。光は点滅させず、動きで見せる
   */
  private drawAudience(g: CanvasRenderingContext2D, air: number, category: string, nowMs: number): void {
    const accent = CATEGORY_COLOR[category] ?? '#ffffff';
    const person = (x: number, base: number, k: number, size: number, colors: readonly string[]): void => {
      // 手を上げ始める空気は人によって違う（0.3〜0.8）。1 に近づくと全員
      const threshold = 0.3 + (((k * 7) % 11) / 11) * 0.5;
      const raised = air >= threshold;
      // 静かな間はほとんど動かない。高まるほど速く大きく。頂点は全員の拍がそろう
      const together = Math.min(1, Math.max(0, (air - 0.8) / 0.15));
      const speed = 500 - air * 340;
      const phase = ((k * 2.399) % (Math.PI * 2)) * (1 - together);
      const amp = 0.4 + air * air * 7 * size;
      const bob = Math.abs(Math.sin(nowMs / speed + phase)) * amp;
      // 身を乗り出す: 空気で頭が前（上）へ出る
      const lean = air * 3 * size;
      const y = Math.round(base - bob - lean);
      const px = Math.round(x);
      const w = Math.round(6 * size);
      const headR = Math.round(3.5 * size);
      const headH = Math.round(7 * size);
      const color = colors[k % colors.length]!;
      g.fillStyle = color;
      // 肩と胴（角を落として人に見せる）
      g.fillRect(px - w + 1, y + headH + 1, w * 2 - 2, 2);
      g.fillRect(px - w, y + headH + 2, w * 2, H - y);
      // 丸い頭と、髪の色
      g.fillRect(px - headR, y + 1, headR * 2, headH - 1);
      g.fillRect(px - headR + 1, y, headR * 2 - 2, headH + 1);
      g.fillStyle = HAIR[k % HAIR.length]!;
      g.fillRect(px - headR + 1, y, headR * 2 - 2, Math.max(1, Math.round(size)));
      g.fillRect(px - headR, y + 1, headR * 2, Math.max(1, Math.round(size)));
      if (!raised) return;
      // 腕は空気の高さの分だけ伸びる。頂点でまっすぐ上
      const reach = Math.round((4 + (air - threshold) * 22) * size);
      const swing = Math.round(Math.sin(nowMs / (speed * 0.8) + phase) * air * 2 * size);
      const armW = Math.max(2, Math.round(2 * size));
      for (const side of [-1, 1]) {
        const ax = px + side * (w + 1) + swing - (side < 0 ? armW : 0);
        g.fillStyle = color;
        g.fillRect(ax, y + headH - reach, armW, reach + 4);
        // ペンライト（手が高くなるほど見える）
        if (air > 0.55) {
          g.fillStyle = k % 2 ? accent : '#fff3b0';
          g.fillRect(ax, y + headH - reach - Math.round(4 * size), armW, Math.round(4 * size));
        }
      }
    };
    const back = ['#3a2d5c', '#34284f', '#413366'];
    const front = ['#231838', '#1d142f', '#2a1e42'];
    for (let k = 0; k < 19; k++) person(8 + k * 17, H - 24, k, 0.9, back);
    for (let k = 0; k < 13; k++) person(14 + k * 24.5, H - 14, k + 40, 1.35, front);
    // 高まったら客席からハートが上がる（空気が高いほど多い）
    if (air > 0.7 && Math.random() < (air - 0.7) * 1.4) {
      this.bits.push({ x: 10 + Math.random() * (W - 20), y: H - 34, vx: (Math.random() - 0.5) * 10, vy: -30 - Math.random() * 25, life: 1, color: '#ff5c8a', heart: true });
    }
  }

  /** 集めた点をハートで見せる（点そのものは結果まで出さない）。1 列 8 個 */
  private drawHearts(g: CanvasRenderingContext2D, x: number, y: number, score: number, upTo: number): void {
    const n = Math.min(16, Math.ceil(score / 30), Math.floor(upTo));
    for (let k = 0; k < n; k++) {
      const hx = Math.round(x - 16 + (k % 8) * 4.5);
      const hy = y + Math.floor(k / 8) * 5;
      g.fillStyle = '#3a1020';
      g.fillRect(hx - 1, hy - 1, 6, 5);
      g.fillStyle = '#ff5c8a';
      g.fillRect(hx, hy, 1, 1);
      g.fillRect(hx + 2, hy, 2, 1);
      g.fillRect(hx, hy + 1, 4, 1);
      g.fillRect(hx + 1, hy + 2, 2, 1);
    }
  }

  private drawCrowdMeter(g: CanvasRenderingContext2D, c: ContestState, world: World): void {
    const max = world.rules.contest?.crowdMax ?? 5;
    if (c.phase !== 'appeal') return;
    for (let k = 0; k < max; k++) {
      const x = W - 14 - (max - 1 - k) * 12;
      g.fillStyle = k < c.crowd ? '#ffd54f' : '#3b2f55';
      // 小さな星
      g.fillRect(x - 1, 22, 3, 7);
      g.fillRect(x - 3, 24, 7, 3);
    }
  }

  /** ふだんのアピールの動きの並び（data の motions）を、人ごとにずらして順に回す */
  private routineMotion(world: World, k: number, nowMs: number): Motion {
    const list = world.rules.contest?.motions ?? [];
    const total = list.reduce((sum, m) => sum + m.seconds, 0);
    if (!total) return REST;
    let t = (nowMs / 1000 + k * 1.37) % total;
    // 人ごとに始める動きも変える
    for (let i = 0; i < list.length; i++) {
      const m = list[(i + k) % list.length]!;
      if (t < m.seconds) return shapeMotion(m.kind, t / m.seconds, m.lift ?? 0);
      t -= m.seconds;
    }
    return REST;
  }

  /** 自分の番: 客の空気が高まるのに合わせて動きが大きくなり、頂点でバク転を決める。冷めると決めポーズ */
  private climaxMotion(air: number, nowMs: number): Motion {
    const rising = air >= this.prevAir;
    if (!rising) return shapeMotion('pose', 1 - air, 0);
    if (air < 0.3) return shapeMotion('strut', (nowMs / 900) % 1, 2);
    if (air < 0.6) return shapeMotion('spin', ((air - 0.3) / 0.3) * 2 % 1, 3);
    return shapeMotion('flip', (air - 0.6) / 0.4, 26);
  }

  /** 技を出している間 */
  private castMotion(ageMs: number): Motion {
    return { anim: ['Attack', 'Charge'], dir: 0, progress: Math.min(0.999, ageMs / 700), rotate: 0, lift: Math.max(0, 6 - ageMs / 40), loop: false };
  }

  private drawPokemon(g: CanvasRenderingContext2D, key: string, x: number, y: number, scale: number, motion: Motion, nowMs: number, alpha: number): void {
    const atlas = this.atlas(key);
    g.save();
    g.globalAlpha = alpha;
    // 足元の影（高く上がるほど小さい）
    const shrink = Math.max(0.55, 1 - motion.lift / 60);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    g.ellipse(x, y + 2, 13 * scale * shrink, 4 * scale * shrink, 0, 0, Math.PI * 2);
    g.fill();
    if (atlas && atlas !== 'loading' && atlas !== 'none') {
      // 絵にある動きを使う。無ければ歩きの絵（動かし方は同じ）
      const anim = motion.anim.find((a) => atlas.frames[`${a}/0/0`]) ?? 'Walk';
      const count = this.frameCount(atlas, anim);
      const index = motion.loop ? Math.floor(nowMs / 150) % count : Math.min(count - 1, Math.floor(motion.progress * count));
      const frame = atlas.frames[`${anim}/${motion.dir}/${index}`] ?? atlas.frames[`${anim}/0/${index}`] ?? atlas.frames['Walk/0/0'] ?? Object.values(atlas.frames)[0];
      if (frame) {
        const f = frame.frame;
        const dw = f.w * scale;
        const dh = f.h * scale;
        // 枠の下の余白を除いて、足を影の上に置く。回る動きは体の真ん中を軸に回す
        const blank = this.bottomBlank(atlas, f) * scale;
        const left = Math.round(x - dw / 2);
        const top = Math.round(y - dh + blank + 2 - motion.lift);
        const cx = left + dw / 2;
        const cy = top + dh - blank - (dh - blank) / 2;
        g.translate(cx, cy);
        g.rotate(motion.rotate);
        g.drawImage(atlas.image, f.x, f.y, f.w, f.h, left - cx, top - cy, Math.round(dw), Math.round(dh));
      }
    }
    g.restore();
  }

  /** その動きの、向き 0 のコマの数（1 回だけ数える） */
  private frameCount(atlas: Atlas, anim: string): number {
    const cache = (atlas.counts ??= new Map());
    const hit = cache.get(anim);
    if (hit !== undefined) return hit;
    let n = 0;
    while (atlas.frames[`${anim}/0/${n}`]) n++;
    cache.set(anim, Math.max(1, n));
    return Math.max(1, n);
  }

  /** 絵の枠の下の、透明な行の数（1 回だけ数える） */
  private bottomBlank(atlas: Atlas, f: { x: number; y: number; w: number; h: number }): number {
    const key = `${f.x},${f.y}`;
    const atlasCache = (atlas.blank ??= new Map());
    const hit = atlasCache.get(key);
    if (hit !== undefined) return hit;
    const c = document.createElement('canvas');
    c.width = f.w;
    c.height = f.h;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(atlas.image, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    const data = g.getImageData(0, 0, f.w, f.h).data;
    let blank = 0;
    for (let y = f.h - 1; y >= 0; y--) {
      let any = false;
      for (let x = 0; x < f.w; x++) if (data[(y * f.w + x) * 4 + 3]! > 0) any = true;
      if (any) break;
      blank++;
    }
    atlasCache.set(key, blank);
    return blank;
  }

  /** ポケモンの絵（プレイヤーの形か敵の形を探す） */
  private atlas(key: string): Atlas | 'loading' | 'none' {
    const got = this.atlases.get(key);
    if (got) return got;
    this.atlases.set(key, 'loading');
    void this.loadAtlas(key);
    return 'loading';
  }

  private async loadAtlas(key: string): Promise<void> {
    for (const dir of [key, `enemy/${key}`]) {
      try {
        const base = `${import.meta.env.BASE_URL}sprites/${dir}/`;
        const res = await fetch(`${base}atlas.json`);
        if (!res.ok) continue;
        const json = (await res.json()) as { frames: Atlas['frames'] };
        const image = new Image();
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error('image'));
          image.src = `${base}atlas.png`;
        });
        this.atlases.set(key, { image, frames: json.frames });
        return;
      } catch {
        /* 次の場所を見る */
      }
    }
    this.atlases.set(key, 'none');
  }

  /** 技のドット絵の id（技のレシピの絵。無ければタイプの光） */
  private moveArtId(world: World, move: number): string | null {
    const def = world.rules.moves[move];
    const recipe = effectRecipes[def?.effect ?? ''];
    const candidates = [recipe?.sprite?.id, recipe?.effectSprite?.id, recipe?.fall?.id, recipe?.bossActive?.id, recipe?.strike?.id, recipe?.lingerSprite?.id, recipe?.castSprite?.id];
    // 絵の無い技（能力を上げる技など）はタイプの絵
    candidates.push(world.rules.contest?.typeArt[world.rules.types.names[def?.type ?? -1] ?? '']);
    return candidates.find((id) => id && moveSprites.sprites[id]) ?? null;
  }

  private drawMoveArt(g: CanvasRenderingContext2D, world: World, move: number, x: number, y: number, ageMs: number): void {
    const id = this.moveArtId(world, move);
    if (!id) return;
    const art = this.moveFrames(id);
    if (!art) return;
    const frame = art.frames[Math.floor(ageMs / art.frameMs) % art.frames.length]!;
    // ぽんと出て少し大きくなる
    const pop = Math.min(1, ageMs / 160);
    const size = 72 * (0.6 + 0.4 * pop);
    // 絵の後ろの淡い光（どの技でも舞台の上で読めるように。明滅はしない）
    g.save();
    g.globalAlpha = 0.35;
    g.fillStyle = '#fff8d6';
    g.beginPath();
    g.arc(x, y, size * 0.55, 0, Math.PI * 2);
    g.fill();
    g.restore();
    const r = size / Math.max(frame.width, frame.height);
    const dw = frame.width * r;
    const dh = frame.height * r;
    g.drawImage(frame, Math.round(x - dw / 2), Math.round(y - dh / 2), Math.round(dw), Math.round(dh));
  }

  private moveFrames(id: string): { frames: HTMLCanvasElement[]; frameMs: number } | null {
    const hit = this.moveCache.get(id);
    if (hit) return hit;
    const sp = moveSprites.sprites[id];
    if (!sp) return null;
    const rows = sp.parts.main ?? sp.parts.middle ?? Object.values(sp.parts)[0];
    if (!rows?.length) return null;
    const frames = rows.map((frame) => {
      const c = document.createElement('canvas');
      c.height = frame.length;
      c.width = frame[0]?.length ?? 1;
      const g = c.getContext('2d')!;
      frame.forEach((row, yy) => {
        for (let xx = 0; xx < row.length; xx++) {
          const ch = row[xx]!;
          if (ch === '.') continue;
          g.fillStyle = sp.palette[Number.parseInt(ch, 36)] ?? '#fff';
          g.fillRect(xx, yy, 1, 1);
        }
      });
      return c;
    });
    const out = { frames, frameMs: sp.frameMs };
    this.moveCache.set(id, out);
    return out;
  }
}
