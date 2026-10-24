import Phaser from 'phaser';
import type { EffectRecipe, MoveSpritesData } from '../../data/schema';
import type { ProjectileStore } from '../../sim/entities/projectiles';

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
}

/** テクスチャの名前（絵・部品・コマごと） */
function frameKey(id: string, part: string, frame: number): string {
  return `msprite:${id}:${part}:${frame}`;
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
  ) {
    for (const [id, sp] of Object.entries(data.sprites)) {
      for (const [part, frames] of Object.entries(sp.parts)) {
        frames.forEach((rows, k) => this.addTexture(frameKey(id, part, k), rows, sp.palette));
      }
    }
  }

  private addTexture(key: string, rows: readonly string[], palette: readonly string[]): void {
    if (this.scene.textures.exists(key)) return;
    const w = rows[0]!.length;
    const h = rows.length;
    const tex = this.scene.textures.createCanvas(key, w, h);
    if (!tex) return;
    const ctx = tex.getContext();
    rows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === '.') return;
        ctx.fillStyle = palette[Number(ch)] ?? '#ff00ff';
        ctx.fillRect(x, y, 1, 1);
      }),
    );
    tex.refresh();
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

  /** 毎フレーム描き直す。specOf は当たり判定ごとのドット絵の指定（無ければ描かない） */
  draw(pr: ProjectileStore, alpha: number, specOf: (i: number) => SpriteSpec | null): void {
    const items: SpriteItem[] = [];
    for (let i = 0; i < pr.count; i++) {
      const spec = specOf(i);
      if (!spec) continue;
      const elapsed = pr.maxLife[i]! - pr.life[i]!;
      items.push({
        spec,
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
    for (const it of items) {
      const spec = it.spec;
      const sp = this.data.sprites[spec.id];
      if (!sp) continue;
      const { x, y, elapsed } = it;
      const a = it.alpha * spec.alpha;
      const r = it.radius * spec.size;
      if (spec.fit === 'circle') {
        const rows = sp.parts.main?.[0];
        if (!rows) continue;
        const s = (r * 2) / rows[0]!.length;
        // 向き: 進む向き（絵は右向きに描く）か、回し続けるか
        const rot =
          spec.rotate === 'velocity' ? (it.vx !== 0 || it.vy !== 0 ? Math.atan2(it.vy, it.vx) : Math.atan2(it.dirY, it.dirX)) : spec.rotate === 'spin' ? (elapsed * spec.spinDegPerSec * Math.PI) / 180 : 0;
        put(frameKey(spec.id, 'main', this.frameOf(spec.id, 'main', elapsed)), x, y, rot, s, s, a);
        continue;
      }
      if (spec.fit === 'front') {
        // 扇形の先（ほのおのキバ・フレアドライブ）: 向きの先、半径の 6 割の所に、扇の半径に合わせた1枚（右向きの絵）
        const rows = sp.parts.main?.[0];
        if (!rows) continue;
        const reach = it.radius;
        const s = (reach * spec.size) / rows[0]!.length;
        put(frameKey(spec.id, 'main', this.frameOf(spec.id, 'main', elapsed)), x + it.dirX * reach * 0.6, y + it.dirY * reach * 0.6, Math.atan2(it.dirY, it.dirX), s, s, a);
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
        const frame = frameKey(spec.id, 'middle', this.frameOf(spec.id, 'middle', elapsed));
        for (let k = 0; k < n; k++) {
          const ang = (k / n) * Math.PI * 2;
          put(frame, x + Math.cos(ang) * rc, y + Math.sin(ang) * rc, ang + Math.PI / 2, sx, sy, a);
        }
        continue;
      }
      if (spec.fit === 'cone') {
        // 扇形（かえんほうしゃ・バブルこうせん）: 1枚の絵（右向き）の左端を根元に置き、長さを扇の半径、幅を扇の先の幅に合わせて引き伸ばす
        const rows = sp.parts.main?.[0];
        if (!rows) continue;
        const reach = it.radius;
        const width = Math.max(24, 2 * reach * Math.tan(Math.min(1.2, it.length)) * spec.size);
        put(frameKey(spec.id, 'main', this.frameOf(spec.id, 'main', elapsed)), x, y, Math.atan2(it.dirY, it.dirX), reach / rows[0]!.length, width / rows.length, a, 0);
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
        put(frameKey(spec.id, 'middle', fr), px, py, rot, s, s, a);
      }
      const [sx, sy] = at(Math.min(startLen, len) / 2);
      put(frameKey(spec.id, 'start', this.frameOf(spec.id, 'start', elapsed)), sx, sy, rot, s, s, a);
      const [ex, ey] = at(Math.max(startLen, len - endLen / 2));
      put(frameKey(spec.id, 'end', this.frameOf(spec.id, 'end', elapsed)), ex, ey, rot, s, s, a);
    }
    for (let k = used; k < this.images.length; k++) this.images[k]!.setVisible(false);
  }

  destroy(): void {
    for (const img of this.images) img.destroy();
    this.images.length = 0;
  }
}
