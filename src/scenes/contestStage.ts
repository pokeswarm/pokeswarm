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

interface Atlas {
  image: HTMLImageElement;
  frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
  blank?: Map<string, number>;
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

  /** 針の値（0〜1。真ん中で 1）。自分の番に画面と同じ値を送る */
  static gaugeAt(seconds: number, periodSeconds: number): number {
    const f = (seconds / periodSeconds) % 1;
    return 1 - Math.abs(2 * f - 1);
  }

  /** 舞台を1コマ描く。spriteKeyOf は舞台の人のポケモンのキー。gauge があれば自分の番の針を描く */
  draw(world: World, c: ContestState, spriteKeyOf: (playerId: number) => string, gauge: number | null, nowMs: number): void {
    const g = this.ctx;
    const category = (gauge !== null || c.phase !== 'branch' ? c.entrants.find((e) => e.category)?.category : null) ?? 'cool';
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
      this.drawPokemon(g, e.playerId !== null ? spriteKeyOf(e.playerId) : e.npc!, x, y, active || isWinner ? 2 : 1.5, nowMs + k * 130, dim);
      // これまでのハートの数を足元に（一次審査の後から見せる）
      if (c.phase !== 'branch' && c.phase !== 'entry') this.drawHearts(g, x, y + 7, e.primary + e.appeals.reduce((a, b) => a + b, 0), c.phase === 'primary' ? (nowMs - this.keyAt) / 180 : 99);
    });
    // 披露している技
    if (c.phase === 'appeal' && c.shown && c.lastAppeal?.move !== null && c.lastAppeal) {
      const x = SLOT_X[c.turn % SLOT_X.length]!;
      this.drawMoveArt(g, world, c.lastAppeal.move!, x, FRONT_Y - 62, nowMs - this.keyAt);
    }
    this.drawAudience(g, c, nowMs);
    this.drawCrowdMeter(g, c, world);
    this.drawBits(g);
    if (gauge !== null) this.drawGauge(g, gauge, world);
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

  private drawAudience(g: CanvasRenderingContext2D, c: ContestState, nowMs: number): void {
    // 手前の客席の頭。盛り上がるほど大きく跳ねて手を上げる
    const jump = 0.6 + c.crowd * 0.7;
    for (let k = 0; k < 24; k++) {
      const x = 6 + k * 13.4;
      const phase = (k * 2.399) % (Math.PI * 2);
      const bob = Math.abs(Math.sin(nowMs / 260 + phase)) * jump;
      const y = Math.round(H - 12 - bob);
      g.fillStyle = k % 3 === 0 ? '#2b1f46' : k % 3 === 1 ? '#23193a' : '#312451';
      g.fillRect(Math.round(x) - 5, y + 2, 10, 14);
      g.fillRect(Math.round(x) - 3, y - 3, 7, 6);
      if (c.crowd >= 2 && k % 4 === Math.floor(nowMs / 400) % 4) {
        g.fillRect(Math.round(x) - 7, y - 7, 2, 9);
        g.fillRect(Math.round(x) + 5, y - 7, 2, 9);
      }
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

  private drawGauge(g: CanvasRenderingContext2D, gauge: number, world: World): void {
    const t = world.rules.contest?.timing;
    const x0 = 60;
    const w = W - 120;
    const y = 150;
    g.fillStyle = '#000';
    g.fillRect(x0 - 2, y - 2, w + 4, 12);
    g.fillStyle = '#3f51b5';
    g.fillRect(x0, y, w, 8);
    if (t) {
      const zone = (a: number, color: string): void => {
        g.fillStyle = color;
        const half = ((1 - a) * w) / 2;
        g.fillRect(x0 + w / 2 - half, y, half * 2, 8);
      };
      zone(t.good, '#fbc02d');
      zone(t.great, '#ff5252');
    }
    // 針は左右に振れる。真ん中で gauge = 1
    const pos = x0 + (w / 2) * (1 + (this.needleSide ? 1 : -1) * (1 - gauge));
    g.fillStyle = '#fff';
    g.fillRect(Math.round(pos) - 1, y - 4, 3, 16);
  }

  /** 針が真ん中のどちら側か（RunScene の時間から決める） */
  needleSide = false;

  private drawPokemon(g: CanvasRenderingContext2D, key: string, x: number, y: number, scale: number, nowMs: number, alpha: number): void {
    const atlas = this.atlas(key);
    g.save();
    g.globalAlpha = alpha;
    // 足元の影
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    g.ellipse(x, y + 2, 13 * scale, 4 * scale, 0, 0, Math.PI * 2);
    g.fill();
    if (atlas && atlas !== 'loading' && atlas !== 'none') {
      const frame = atlas.frames[`Walk/0/${Math.floor(nowMs / 180) % 4}`] ?? atlas.frames['Walk/0/0'] ?? Object.values(atlas.frames)[0];
      if (frame) {
        const f = frame.frame;
        const dw = f.w * scale;
        const dh = f.h * scale;
        // 枠の下の余白を除いて、足を影の上に置く
        const blank = this.bottomBlank(atlas, f) * scale;
        g.drawImage(atlas.image, f.x, f.y, f.w, f.h, Math.round(x - dw / 2), Math.round(y - dh + blank + 2), Math.round(dw), Math.round(dh));
      }
    }
    g.restore();
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
    for (const dir of [`enemy/${key}`, key]) {
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
