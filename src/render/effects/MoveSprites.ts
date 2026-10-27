import Phaser from 'phaser';
import type { EffectRecipe, MoveSpritesData } from '../../data/schema';
import { MOTION_SNAKE, snakeOffset, type ProjectileStore } from '../../sim/entities/projectiles';
import { drawMoveArt, type SpriteOut } from '../moveArt';

export type SpriteSpec = NonNullable<EffectRecipe['sprite']>;

/** 描く1枚（または1組）の位置と大きさ。radius は円の半径・線の太さの半分・扇の半径、length は線の長さ（扇では開きの角度） */
export interface SpriteItem {
  readonly spec: SpriteSpec;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** 輪の帯の厚さ（0 なら半径の 3 割） */
  readonly band: number;
  readonly dirX: number;
  readonly dirY: number;
  readonly length: number;
  /** 前のフレームからの動き（velocity の向き） */
  readonly vx: number;
  readonly vy: number;
  /** 出てからの秒数（コマを進める） */
  readonly elapsed: number;
  readonly alpha: number;
  /** varyTiles のずらし */
  readonly seed: number;
  /** 蛇行して進むもの（snake）: 出した場所・速度・振れ幅・角速度・出てからの秒数（通った道を描く） */
  readonly snake?: { readonly ox: number; readonly oy: number; readonly vx: number; readonly vy: number; readonly amp: number; readonly omega: number; readonly t: number };
}

/** テクスチャの名前（絵・細かさの段・部品・コマごと） */
/**
 * 向きで描き分ける絵（fit front の directional）の部品: 向き（画面は y が下）を 8 方向に分け、
 * 横 main・正面 front（下）・後ろ back（上）・斜め前 diag（右下）・斜め後ろ diagBack（右上）。左側は右側の絵の左右を返す
 */
export function directionalPart(dirX: number, dirY: number): { name: 'main' | 'front' | 'back' | 'diag' | 'diagBack'; flip: boolean } {
  const deg = (Math.atan2(dirY, Math.abs(dirX)) * 180) / Math.PI;
  const flip = dirX < -1e-6;
  if (deg > 67.5) return { name: 'front', flip };
  if (deg < -67.5) return { name: 'back', flip };
  if (deg > 22.5) return { name: 'diag', flip };
  if (deg < -22.5) return { name: 'diagBack', flip };
  return { name: 'main', flip };
}

function frameKey(id: string, step: number, part: string, frame: number): string {
  return `msprite:${id}:${step}:${part}:${frame}`;
}

/** 細かさの段: 段 n の細かさは 2^(n / STEPS_PER_DOUBLE)（約 12% 刻み） */
const STEPS_PER_DOUBLE = 6;
/** 描き直す絵の一辺の上限（実際のマス数。大きな範囲の技でも重くなりすぎないように） */
const MAX_SIDE = 320;
/** 1フレームに描き直しに使う時間の目安（ミリ秒。少なくとも1つは描く） */
const BUDGET_MS = 4;

/**
 * 描き直した絵の置き場（どの MoveSprites からも同じ。テクスチャはゲーム全体で共有される）。
 * 段ごとの絵（描き終えたもの）と、描くのを待っている段
 */
const ready = new Map<string, SpriteOut>();
const queued = new Set<string>();
const queue: { id: string; step: number }[] = [];
/** 別の処理で描き終えて、テクスチャにするのを待っている絵 */
const arrived: { id: string; step: number; sp: SpriteOut | null }[] = [];
/**
 * 描き直しを頼む別の処理（Web Worker）。使えなければ null（ゲームの処理の中で、決まった時間の分だけ描く）。
 * まだ作っていなければ undefined
 */
let worker: Worker | null | undefined;

function artWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('../moveArtWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: string; step: number; sp: SpriteOut | null }>) => void arrived.push(e.data);
    worker.onerror = () => {
      // 動かなければ、ゲームの処理の中で描く（頼んだものは描き直す）
      worker = null;
      for (const key of queued) {
        const [id, step] = key.split(':');
        queue.push({ id: id!, step: Number(step) });
      }
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** 消える前に薄くしていく時間（秒） */
const FADE_SECONDS = 0.35;

/**
 * 技のドット絵（作者の案 2026年10月23日。data/render/move-sprites.json。npm run move-sprites で作る）。
 * 光の円・線の代わりに、当たり判定の位置と大きさに合わせてドット絵を置く（見た目だけ）。
 * - circle: 1枚の絵（main）を、当たり判定の円の直径に合わせて拡大する（ハードプラントの根）
 * - line: 始まり（start）・途中（middle を並べる）・終わり（end）を、線の長さに合わせて並べる（ハイドロポンプの水流）。
 *   太さは当たり判定の直径に合わせる
 * コマは、当たり判定が出てからの時間で進め、loopFrom があれば最後まで行ったらそこから繰り返す。消える直前は薄くする。
 * 光ではないので、加算で重ねる演出の入れ物（EffectRenderer）とは別に、ふつうに重ねて描く
 */
export class MoveSprites {
  private readonly images: Phaser.GameObjects.Image[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly data: MoveSpritesData,
    private readonly depth: number,
    /**
     * 1ドットの大きさ（ワールドの単位。作者の決定 2026年10月24日: ポケモン・マップと同じ 2）。
     * 絵はこの細かさになるよう、当たり判定の大きさに合わせたマス数で描き直す
     */
    private readonly dot: number,
  ) {
    // 基準の細かさ（段 0）は data/render/move-sprites.json の絵をそのまま使う
    for (const [id, sp] of Object.entries(data.sprites)) this.store(id, 0, sp as SpriteOut);
  }

  /** 描いた絵をテクスチャにして置き場に入れる */
  private store(id: string, step: number, sp: SpriteOut): void {
    for (const [part, frames] of Object.entries(sp.parts)) {
      frames.forEach((rows, k) => this.addTexture(frameKey(id, step, part, k), rows, sp.palette));
    }
    ready.set(`${id}:${step}`, sp);
  }

  private addTexture(key: string, rows: readonly string[], palette: readonly string[]): void {
    if (this.scene.textures.exists(key)) return;
    const w = rows[0]!.length;
    const h = rows.length;
    const tex = this.scene.textures.createCanvas(key, w, h);
    if (!tex) return;
    // 1マスずつ塗ると大きな絵で遅いので、画素の配列にまとめて書く
    const rgb = palette.map((hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)));
    const ctx = tex.getContext();
    const img = ctx.createImageData(w, h);
    rows.forEach((row, y) => {
      for (let x = 0; x < w; x++) {
        const ch = row.charCodeAt(x) - 48;
        if (ch < 0 || ch > 9) continue;
        const c = rgb[ch] ?? [255, 0, 255];
        img.data.set([c[0]!, c[1]!, c[2]!, 255], (y * w + x) * 4);
      }
    });
    ctx.putImageData(img, 0, 0);
    tex.refresh();
  }

  /** 別の処理で描き終えた絵をテクスチャにし、別の処理が使えなければ、待っている段を決まった時間の分だけ描く（少なくとも1つ） */
  private pump(): void {
    const start = performance.now();
    while (arrived.length > 0) {
      const { id, step, sp } = arrived.shift()!;
      queued.delete(`${id}:${step}`);
      if (sp) this.store(id, step, sp);
      if (performance.now() - start > BUDGET_MS) return;
    }
    while (queue.length > 0) {
      const { id, step } = queue.shift()!;
      const sp = drawMoveArt(id, 2 ** (step / STEPS_PER_DOUBLE));
      queued.delete(`${id}:${step}`);
      if (sp) this.store(id, step, sp);
      if (performance.now() - start > BUDGET_MS) break;
    }
  }

  /**
   * 絵 id を、基準の大きさ base（基準の絵のマス数）の向きに desired マスで描きたいときの絵と段。
   * その段がまだ無ければ描くのを頼み、それまでは描き終えた一番近い段を使う
   */
  private pick(id: string, base: number, desired: number): { sp: SpriteOut; step: number } | null {
    const maxStep = Math.floor(Math.log2(MAX_SIDE / Math.max(1, this.biggestSide(id))) * STEPS_PER_DOUBLE);
    const want = Math.min(maxStep, Math.round(Math.log2(Math.max(1e-3, desired / Math.max(1, base))) * STEPS_PER_DOUBLE));
    const key = `${id}:${want}`;
    const hit = ready.get(key);
    if (hit) return { sp: hit, step: want };
    if (!queued.has(key)) {
      queued.add(key);
      const w = artWorker();
      if (w) w.postMessage({ id, step: want, k: 2 ** (want / STEPS_PER_DOUBLE) });
      else queue.push({ id, step: want });
    }
    for (let d = 1; d < 64; d++) {
      for (const step of [want - d, want + d]) {
        const sp = ready.get(`${id}:${step}`);
        if (sp) return { sp, step };
      }
    }
    return null;
  }

  /** 基準の絵の、部品の中で一番長い辺 */
  private biggestSide(id: string): number {
    const sp = this.data.sprites[id];
    if (!sp) return 1;
    let m = 1;
    for (const frames of Object.values(sp.parts)) {
      const rows = frames[0];
      if (rows) m = Math.max(m, rows.length, rows[0]!.length);
    }
    return m;
  }

  /** 部品の、今のコマの番号（出てからの秒数で進める） */
  private frameOf(id: string, part: string, elapsed: number): number {
    const sp = this.data.sprites[id]!;
    const n = sp.parts[part]!.length;
    const k = Math.floor((elapsed * 1000) / sp.frameMs);
    if (k < n) return k;
    const from = Math.min(sp.loopFrom ?? 0, n - 1);
    return from + ((k - from) % (n - from));
  }

  /** 毎フレーム描き直す。specOf は当たり判定ごとのドット絵の指定（無ければ描かない。重ねて描くものは配列） */
  draw(pr: ProjectileStore, alpha: number, specOf: (i: number) => SpriteSpec | readonly SpriteSpec[] | null): void {
    const items: SpriteItem[] = [];
    for (let i = 0; i < pr.count; i++) {
      const got = specOf(i);
      if (!got) continue;
      const elapsed = pr.maxLife[i]! - pr.life[i]!;
      const snake =
        pr.motion[i] === MOTION_SNAKE ? { ox: pr.ox[i]!, oy: pr.oy[i]!, vx: pr.vx[i]!, vy: pr.vy[i]!, amp: pr.orbitRadius[i]!, omega: pr.angularSpeed[i]!, t: elapsed } : undefined;
      for (const one of Array.isArray(got) ? (got as readonly SpriteSpec[]) : [got as SpriteSpec]) items.push({
        // 絵を選ぶ技（ばくれつパンチ）は、出した順の通し番号で選ぶ
        spec: one.variants?.length ? { ...one, id: one.variants[pr.serial[i]! % one.variants.length]! } : one,
        x: pr.prevX[i]! + (pr.x[i]! - pr.prevX[i]!) * alpha,
        y: pr.prevY[i]! + (pr.y[i]! - pr.prevY[i]!) * alpha,
        radius: pr.radius[i]!,
        band: pr.band[i]!,
        dirX: pr.dirX[i]!,
        dirY: pr.dirY[i]!,
        length: pr.length[i]!,
        vx: pr.x[i]! - pr.prevX[i]!,
        vy: pr.y[i]! - pr.prevY[i]!,
        elapsed,
        // 短い技（はっぱカッターなど 0.2 秒ほど）は、出ている時間の最後の 3 割だけで薄くする
        alpha: Math.min(1, pr.life[i]! / Math.min(FADE_SECONDS, pr.maxLife[i]! * 0.3)),
        seed: i,
        ...(snake ? { snake } : {}),
      });
    }
    this.drawItems(items);
  }

  /** 位置と大きさを指定して描く（当たり判定のほか、ボスの技が落ちた所の絵にも使う） */
  drawItems(items: readonly SpriteItem[]): void {
    let used = 0;
    const put = (key: string, x: number, y: number, rot: number, sx: number, sy: number, a: number, originX = 0.5): void => {
      let img = this.images[used];
      if (!img) {
        img = this.scene.add.image(0, 0, key).setDepth(this.depth);
        this.images.push(img);
      }
      img.setTexture(key).setOrigin(originX, 0.5).setPosition(x, y).setRotation(rot).setScale(sx, sy).setAlpha(a).setVisible(true);
      used++;
    };
    this.pump();
    for (const it of items) {
      const spec = it.spec;
      const base = this.data.sprites[spec.id];
      if (!base) continue;
      const { elapsed } = it;
      // 揺れる地面: 描く位置を毎フレーム少しずらす（見た目だけなので Math.random でよい）
      const x = it.x + (spec.shake > 0 ? (Math.random() * 2 - 1) * spec.shake : 0);
      const y = it.y + (spec.shake > 0 ? (Math.random() * 2 - 1) * spec.shake : 0);
      const a = it.alpha * spec.alpha;
      const r = it.radius * spec.size;
      // 1ドットが dot になるマス数: 円・扇は横の長さ、線は太さ、輪は帯の厚さで決める
      const mainRows = base.parts.main?.[0];
      const midRows = base.parts.middle?.[0];
      const [baseLen, desired] =
        spec.fit === 'circle'
          ? [mainRows?.[0]?.length ?? 1, (r * 2) / this.dot]
          : spec.fit === 'front'
            ? [mainRows?.[0]?.length ?? 1, (it.radius * spec.size) / this.dot]
            : spec.fit === 'cone'
              ? [mainRows?.[0]?.length ?? 1, it.radius / this.dot]
              : spec.fit === 'snake'
                ? [midRows?.length ?? 1, (r * 2) / this.dot]
              : spec.fit === 'ring'
                ? [midRows?.length ?? 1, ((it.band > 0 ? it.band : it.radius * 0.3) * spec.size) / this.dot]
                : [midRows?.length ?? 1, (r * 2) / this.dot];
      const picked = this.pick(spec.id, baseLen, desired);
      if (!picked) continue;
      const { sp, step } = picked;
      const fk = (part: string, frame: number): string => frameKey(spec.id, step, part, frame);
      if (spec.fit === 'circle') {
        const rows = sp.parts.main?.[0];
        if (!rows) continue;
        const s = (r * 2) / rows[0]!.length;
        if (spec.directional) {
          // 向きで描き分ける絵（かみくだく の口）: 進む向き（止まっていれば技の向き）で部品を選び、回さずに置く
          const moving = it.vx !== 0 || it.vy !== 0;
          const part = directionalPart(moving ? it.vx : it.dirX, moving ? it.vy : it.dirY);
          const name = sp.parts[part.name] ? part.name : 'main';
          put(fk(name, this.frameOf(spec.id, name, elapsed)), x, y, 0, part.flip ? -s : s, s, a);
          continue;
        }
        // 向き: 進む向き（絵は右向きに描く）か、回し続けるか
        const rot =
          spec.rotate === 'velocity' ? (it.vx !== 0 || it.vy !== 0 ? Math.atan2(it.vy, it.vx) : Math.atan2(it.dirY, it.dirX)) : spec.rotate === 'spin' ? (elapsed * spec.spinDegPerSec * Math.PI) / 180 : 0;
        // 地面から噴き上がる絵は、根元（originY）を当たり判定の中心に合わせる（回す絵は真ん中のまま）
        const oy = rot === 0 ? (spec.originY - 0.5) * rows.length * s : 0;
        put(fk('main', this.frameOf(spec.id, 'main', elapsed)), x, y - oy, rot, s, s, a);
        continue;
      }
      if (spec.fit === 'snake') {
        this.drawSnake(it, sp, fk, r, a, put);
        continue;
      }
      if (spec.fit === 'front') {
        // 扇形の先（ほのおのキバ・フレアドライブ）: 向きの先、半径の 6 割の所に、扇の半径に合わせた1枚（右向きの絵）
        const rows = sp.parts.main?.[0];
        if (!rows) continue;
        const reach = it.radius;
        const s = (reach * spec.size) / rows[0]!.length;
        const px = x + it.dirX * reach * 0.6;
        const py = y + it.dirY * reach * 0.6;
        if (spec.directional) {
          // 向きを 8 方向に分けて、その向きの絵を回さずに置く（左向きは右向きの絵の左右を返す）
          const part = directionalPart(it.dirX, it.dirY);
          const name = sp.parts[part.name] ? part.name : 'main';
          put(fk(name, this.frameOf(spec.id, name, elapsed)), px, py, 0, part.flip ? -s : s, s, a);
          continue;
        }
        put(fk('main', this.frameOf(spec.id, 'main', elapsed)), px, py, Math.atan2(it.dirY, it.dirX), s, s, a);
        continue;
      }
      if (spec.fit === 'ring') {
        // 輪（じしん）: 帯の真ん中の円に沿って、途中の部品を接する向きに並べる（太さは帯の厚さ）
        const rows = sp.parts.middle?.[0];
        if (!rows) continue;
        const outer = it.radius;
        const band = (it.band > 0 ? it.band : outer * 0.3) * spec.size;
        const rc = Math.max(1, outer - band / 2);
        // 少なくとも 16 枚並べて、角ばった多角形に見えないようにする
        const n = Math.max(16, Math.round((Math.PI * 2 * rc) / ((rows[0]!.length * band) / rows.length)));
        const sx = (Math.PI * 2 * rc) / n / rows[0]!.length;
        const sy = band / rows.length;
        const midFrame = this.frameOf(spec.id, 'middle', elapsed);
        const midCount = sp.parts.middle!.length;
        for (let k = 0; k < n; k++) {
          const ang = (k / n) * Math.PI * 2;
          // varyTiles: 1枚ずつ違うコマ（だいばくはつの端の炎が、そろわずに揺れる）
          const frame = fk('middle', spec.varyTiles ? (midFrame + k * 3 + it.seed) % midCount : midFrame);
          put(frame, x + Math.cos(ang) * rc, y + Math.sin(ang) * rc, spec.upright ? 0 : ang + Math.PI / 2, spec.upright ? sy : sx, sy, a);
        }
        continue;
      }
      if (spec.fit === 'cone') {
        // 扇形（かえんほうしゃ・バブルこうせん）: 1枚の絵（右向き）の左端を根元に置き、長さを扇の半径、幅を扇の先の幅に合わせて引き伸ばす
        const rows = sp.parts.main?.[0];
        if (!rows) continue;
        const reach = it.radius;
        const width = Math.max(24, 2 * reach * Math.tan(Math.min(1.2, it.length)) * spec.size);
        put(fk('main', this.frameOf(spec.id, 'main', elapsed)), x, y, Math.atan2(it.dirY, it.dirX), reach / rows[0]!.length, width / rows.length, a, 0);
        continue;
      }
      // 線: 始まり → 途中を並べる → 終わり（太さは当たり判定の直径）
      const start = sp.parts.start?.[0];
      const middle = sp.parts.middle?.[0];
      const end = sp.parts.end?.[0];
      if (!start || !middle || !end) continue;
      const s = (r * 2) / middle.length;
      const dx = it.dirX;
      const dy = it.dirY;
      const rot = Math.atan2(dy, dx);
      // 伸びていく線（突き出す根）: 根元から先へ growSeconds で伸ばす
      const len = it.length * (spec.growSeconds ? Math.min(1, elapsed / spec.growSeconds) : 1);
      const startLen = start[0]!.length * s;
      const endLen = end[0]!.length * s;
      const tileLen = middle[0]!.length * s;
      const at = (d: number): [number, number] => [x + dx * d, y + dy * d];
      const midFrame = this.frameOf(spec.id, 'middle', elapsed);
      // 途中: 始まりの後ろから終わりの手前まで並べる（最後の1枚は終わりの下に少し重なってよい）
      const midCount = sp.parts.middle!.length;
      for (let d = startLen, k = 0; d < len - endLen; d += tileLen, k++) {
        const [px, py] = at(d + tileLen / 2);
        const fr = spec.varyTiles ? (midFrame + k * 3 + it.seed) % midCount : midFrame;
        put(fk('middle', fr), px, py, rot, s, s, a);
      }
      const [sx, sy] = at(Math.min(startLen, len) / 2);
      put(fk('start', this.frameOf(spec.id, 'start', elapsed)), sx, sy, rot, s, s, a);
      const [ex, ey] = at(Math.max(startLen, len - endLen / 2));
      put(fk('end', this.frameOf(spec.id, 'end', elapsed)), ex, ey, rot, s, s, a);
    }
    for (let k = used; k < this.images.length; k++) this.images[k]!.setVisible(false);
  }

  /**
   * 蛇行して進むもの: 出した場所から今の位置までの道（tail があれば先から tail の長さまで）に、途中の部品を道の向きに並べ、
   * 先に終わりの部品を置く。太さは当たり判定の直径
   */
  private drawSnake(
    it: SpriteItem,
    sp: SpriteOut,
    fk: (part: string, frame: number) => string,
    r: number,
    a: number,
    put: (key: string, x: number, y: number, rot: number, sx: number, sy: number, a: number) => void,
  ): void {
    const sn = it.snake;
    const middle = sp.parts.middle?.[0];
    const end = sp.parts.end?.[0];
    if (!sn || !middle || !end) return;
    const s = (r * 2) / middle.length;
    const tileLen = Math.max(1, middle[0]!.length * s);
    const endLen = end[0]!.length * s;
    // 道を細かく区切った点（出した場所 → 今の位置）
    const n = Math.max(8, Math.ceil(sn.t * 60));
    const pts: [number, number][] = [];
    for (let k = 0; k <= n; k++) {
      const [dx, dy] = snakeOffset(sn.vx, sn.vy, sn.amp, sn.omega, (sn.t * k) / n);
      pts.push([sn.ox + dx, sn.oy + dy]);
    }
    // 先から後ろへ d だけ戻った点と、その所の進む向き
    const lens: number[] = [0];
    for (let k = n; k > 0; k--) lens.push(lens[lens.length - 1]! + Math.hypot(pts[k]![0] - pts[k - 1]![0], pts[k]![1] - pts[k - 1]![1]));
    const total = lens[lens.length - 1]!;
    const at = (d: number): [number, number, number] => {
      let j = 1;
      while (j < lens.length - 1 && lens[j]! < d) j++;
      const k1 = n - (j - 1);
      const k0 = n - j;
      const seg = lens[j]! - lens[j - 1]! || 1;
      const t = Math.max(0, Math.min(1, (d - lens[j - 1]!) / seg));
      const [x1, y1] = pts[k1]!;
      const [x0, y0] = pts[k0]!;
      return [x1 + (x0 - x1) * t, y1 + (y0 - y1) * t, Math.atan2(y1 - y0, x1 - x0)];
    };
    const limit = it.spec.tail > 0 ? Math.min(total, it.spec.tail) : total;
    const midCount = sp.parts.middle!.length;
    const midFrame = this.frameOf(it.spec.id, 'middle', it.elapsed);
    for (let d = endLen, k = 0; d < limit; d += tileLen, k++) {
      const [px, py, rot] = at(Math.min(limit, d + tileLen / 2));
      // 後ろほど薄くする（尾を引く）
      const fade = it.spec.tail > 0 ? 1 - (d / limit) * 0.6 : 1;
      put(fk('middle', it.spec.varyTiles ? (midFrame + k * 3 + it.seed) % midCount : midFrame), px, py, rot, s, s, a * fade);
    }
    const [hx, hy, hr] = at(Math.min(total, endLen / 2));
    put(fk('end', this.frameOf(it.spec.id, 'end', it.elapsed)), hx, hy, hr, s, s, a);
  }

  destroy(): void {
    for (const img of this.images) img.destroy();
    this.images.length = 0;
  }
}
