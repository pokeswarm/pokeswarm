import type Phaser from 'phaser';
import type { CircleSource } from '../PooledCircles';

/** 縁取りの線の形: 円（length 0）か、両端の丸い直線（ビーム）か、扇形（half: 片側の開き。ラジアン） */
interface OutlineShape {
  x: number;
  y: number;
  radius: number;
  length: number;
  dirX: number;
  dirY: number;
  half: number | null;
}

/**
 * 技の当たり判定の形の縁取り（作者の指摘: 光の演出だけでは当たり判定の輪郭が無く、当てている感じが少ない）。
 * ポケモンのドット絵と同じ大きさのドットで、当たり判定の外周に「明るい線 + 外側の暗い線」を描く。
 * 光の演出（EffectRenderer）とは別に、ふつうの合成で上に重ねる。
 */
export class HitOutlines {
  private readonly g: Phaser.GameObjects.Graphics;
  /** 同じドットを2回描かないための作業用 */
  private readonly seen = new Set<number>();

  constructor(
    scene: Phaser.Scene,
    depth: number,
    /** 1ドットのワールドの長さ（スプライトの拡大率と同じにする） */
    private readonly dot: number,
    private readonly alpha: number,
  ) {
    this.g = scene.add.graphics().setDepth(depth);
  }

  /**
   * 毎フレーム描き直す。colorOf は当たり判定ごとの明るい色（null なら描かない）。
   * view の外の当たり判定は描かない
   */
  draw(
    src: CircleSource,
    alpha: number,
    colorOf: (index: number) => { light: number; dark: number } | null,
    lineOf: (index: number) => { length: number; dirX: number; dirY: number } | null,
    view: { left: number; top: number; right: number; bottom: number },
    sectorOf: (index: number) => { dirX: number; dirY: number; half: number } | null = () => null,
  ): void {
    const g = this.g;
    g.clear();
    for (let i = 0; i < src.count; i++) {
      const color = colorOf(i);
      if (!color) continue;
      const x = src.prevX[i]! + (src.x[i]! - src.prevX[i]!) * alpha;
      const y = src.prevY[i]! + (src.y[i]! - src.prevY[i]!) * alpha;
      const line = lineOf(i);
      const sector = sectorOf(i);
      const shape: OutlineShape = {
        x,
        y,
        radius: src.radius[i]!,
        length: line?.length ?? 0,
        dirX: sector?.dirX ?? line?.dirX ?? 1,
        dirY: sector?.dirY ?? line?.dirY ?? 0,
        half: sector && sector.half < Math.PI ? sector.half : null,
      };
      const reach = shape.radius + shape.length + this.dot * 2;
      if (x + reach < view.left || x - reach > view.right || y + reach < view.top || y - reach > view.bottom) continue;
      // 外側の暗い線 → 内側の明るい線の順（明るい線を上に）
      this.ring(shape, shape.radius + this.dot, color.dark);
      this.ring(shape, shape.radius, color.light);
    }
  }

  /** 形の外周を、半径 r でドットにして塗る */
  private ring(s: OutlineShape, r: number, color: number): void {
    const d = this.dot;
    const seen = this.seen;
    seen.clear();
    this.g.fillStyle(color, this.alpha);
    const plot = (px: number, py: number): void => {
      const gx = Math.round(px / d);
      const gy = Math.round(py / d);
      const key = (gx + 1e6) * 2e6 + (gy + 1e6);
      if (seen.has(key)) return;
      seen.add(key);
      this.g.fillRect(gx * d - d / 2, gy * d - d / 2, d, d);
    };
    // ドットが途切れないよう、ドットの半分ほどの間隔で外周をなぞる
    const step = d * 0.5;
    const nx = -s.dirY;
    const ny = s.dirX;
    // 両端の半円（円なら一周）
    const arcSteps = Math.max(8, Math.ceil((Math.PI * r) / step));
    const base = Math.atan2(s.dirY, s.dirX);
    if (s.half !== null) {
      // 扇形: 弧と、中心から弧の両端への2本の線
      const n = Math.max(4, Math.ceil((2 * s.half * r) / step));
      for (let k = 0; k <= n; k++) {
        const a = base - s.half + (k / n) * 2 * s.half;
        plot(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r);
      }
      for (const a of [base - s.half, base + s.half]) {
        for (let t = 0; t <= r; t += step) plot(s.x + Math.cos(a) * t, s.y + Math.sin(a) * t);
      }
      return;
    }
    if (s.length <= 0) {
      for (let k = 0; k < arcSteps * 2; k++) {
        const a = (k / (arcSteps * 2)) * Math.PI * 2;
        plot(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r);
      }
      return;
    }
    const ex = s.x + s.dirX * s.length;
    const ey = s.y + s.dirY * s.length;
    for (let k = 0; k <= arcSteps; k++) {
      const a = base + Math.PI / 2 + (k / arcSteps) * Math.PI;
      plot(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r);
      plot(ex + Math.cos(a + Math.PI) * r, ey + Math.sin(a + Math.PI) * r);
    }
    // 両側の直線
    for (let t = 0; t <= s.length; t += step) {
      const cx = s.x + s.dirX * t;
      const cy = s.y + s.dirY * t;
      plot(cx + nx * r, cy + ny * r);
      plot(cx - nx * r, cy - ny * r);
    }
  }

  destroy(): void {
    this.g.destroy();
  }
}
