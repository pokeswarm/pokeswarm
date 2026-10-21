import Phaser from 'phaser';
import type { CircleSource } from '../PooledCircles';

/** 当たり判定の形: 円（length 0）か、両端の丸い直線（ビーム）か、扇形（half: 片側の開き。ラジアン） */
interface HitShape {
  x: number;
  y: number;
  radius: number;
  length: number;
  dirX: number;
  dirY: number;
  half: number | null;
}

/**
 * 技の当たり判定の形を、そのままの大きさで平らに塗る（作者の指摘。2026年10月21日）。
 * - 外へ向かって薄くなるグラデーションでは範囲を表さない（端がどこか分からず、縁取りをすると薄い端が囲まれて見づらかった）
 * - 当たり判定の内側を、レシピの光の色で薄く一色に塗り、外周に明るい線を1本引く。黒い（暗い）縁取りは使わない
 * - ポケモンのドット絵に合わせて、角ばったドットにするフィルターを掛ける
 */
export class HitShapes {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly layer: Phaser.GameObjects.Layer;

  constructor(
    scene: Phaser.Scene,
    depth: number,
    private readonly cfg: { pixel: number; edge: number; fillAlpha: number; edgeAlpha: number },
  ) {
    this.layer = scene.add.layer().setDepth(depth);
    this.g = scene.add.graphics();
    this.layer.add(this.g);
    if (cfg.pixel > 0 && scene.renderer.type === Phaser.WEBGL) {
      this.layer.enableFilters();
      this.layer.filters!.internal.addBlocky({ size: cfg.pixel });
    }
  }

  /**
   * 毎フレーム描き直す。colorOf は当たり判定ごとの 塗りの色・線の色（null なら描かない）。
   * view の外の当たり判定は描かない
   */
  draw(
    src: CircleSource,
    alpha: number,
    colorOf: (index: number) => { fill: number; edge: number } | null,
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
      const s: HitShape = {
        x,
        y,
        radius: src.radius[i]!,
        length: line?.length ?? 0,
        dirX: sector?.dirX ?? line?.dirX ?? 1,
        dirY: sector?.dirY ?? line?.dirY ?? 0,
        half: sector && sector.half < Math.PI ? sector.half : null,
      };
      const reach = s.radius + s.length + this.cfg.edge;
      if (x + reach < view.left || x - reach > view.right || y + reach < view.top || y - reach > view.bottom) continue;
      this.path(s);
      g.fillStyle(color.fill, this.cfg.fillAlpha);
      g.fillPath();
      g.lineStyle(this.cfg.edge, color.edge, this.cfg.edgeAlpha);
      g.strokePath();
    }
  }

  /** 形の外周の道筋を作る */
  private path(s: HitShape): void {
    const g = this.g;
    const base = Math.atan2(s.dirY, s.dirX);
    g.beginPath();
    if (s.half !== null) {
      // 扇形: 中心 → 弧 → 中心
      g.moveTo(s.x, s.y);
      g.arc(s.x, s.y, s.radius, base - s.half, base + s.half, false);
      g.closePath();
      return;
    }
    if (s.length <= 0) {
      g.arc(s.x, s.y, s.radius, 0, Math.PI * 2, false);
      g.closePath();
      return;
    }
    // 両端の丸い直線: 始点の半円 → 終点の半円
    const ex = s.x + s.dirX * s.length;
    const ey = s.y + s.dirY * s.length;
    g.arc(s.x, s.y, s.radius, base + Math.PI / 2, base + (Math.PI * 3) / 2, false);
    g.arc(ex, ey, s.radius, base - Math.PI / 2, base + Math.PI / 2, false);
    g.closePath();
  }

  destroy(): void {
    this.layer.destroy();
  }
}
