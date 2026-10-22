import Phaser from 'phaser';
import type { UiConfig } from '../data/schema';
import { hexColor } from './color';
import { pixelTextureKey } from './PixelArt';
import { px } from './pixelUi';

/** 矢印で示すもの。icon はドット絵のキー（色を掛ける）か、文字 */
export interface EdgeTarget {
  x: number;
  y: number;
  color: string;
  icon: { texture: string; tint: boolean } | { text: string };
}

interface Slot {
  arrow: Phaser.GameObjects.Image;
  icon: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
}

/**
 * 画面の外にいる大事なもの（ボス・中ボス・伝説・ふしぎなアメ・味方）の方向を、画面の端に矢印で出す（作者の依頼 2026年10月22日）。
 * 矢印は自作のドット絵（data/render/items.json の edge-arrow・edge-arrow-diag）。ドットが崩れないよう、向きは8方向に丸め、
 * 90度ずつ回すだけにする（斜めは斜め用の絵）。置く場所は、画面の真ん中から対象へ向かう線が画面の端（余白の内側）と交わる所
 */
export class EdgeArrows {
  private readonly slots: Slot[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly cfg: UiConfig['edgeArrows'],
    /** 画面の (x, y) に等倍で置く（RunScene.placeUi） */
    private readonly place: (obj: Phaser.GameObjects.Components.Transform, x: number, y: number) => void,
  ) {}

  update(targets: readonly EdgeTarget[], cam: Phaser.Cameras.Scene2D.Camera): void {
    const { width: w, height: h, zoom } = cam;
    const view = cam.worldView;
    const cx = w / 2;
    const cy = h / 2;
    let used = 0;
    for (const t of targets) {
      const sx = (t.x - view.x) * zoom;
      const sy = (t.y - view.y) * zoom;
      // 画面の中に見えていれば出さない
      if (sx >= 0 && sx <= w && sy >= 0 && sy <= h) continue;
      const dx = sx - cx;
      const dy = sy - cy;
      if (dx === 0 && dy === 0) continue;
      const halfW = cx - this.cfg.marginSide;
      const halfH = dy < 0 ? cy - this.cfg.marginTop : h - cy - this.cfg.marginBottom;
      const k = Math.min(dx !== 0 ? halfW / Math.abs(dx) : Infinity, dy !== 0 ? halfH / Math.abs(dy) : Infinity);
      const ex = cx + dx * k;
      const ey = cy + dy * k;
      const slot = this.slot(used++);
      // 8方向に丸める（0 = 右、1 = 右下、… y は下が正）
      const octant = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
      const diag = octant % 2 === 1;
      slot.arrow.setTexture(pixelTextureKey(diag ? 'edge-arrow-diag' : 'edge-arrow'));
      slot.arrow.setAngle(diag ? ((octant - 1) / 2) * 90 : (octant / 2) * 90);
      slot.arrow.setTint(hexColor(t.color)).setVisible(true);
      this.place(slot.arrow, ex, ey);
      slot.arrow.setScale(this.cfg.dot / zoom);
      // 目印は矢印の少し内側（画面の真ん中寄り）
      const len = Math.hypot(dx, dy);
      const ix = ex - (dx / len) * this.cfg.iconGap;
      const iy = ey - (dy / len) * this.cfg.iconGap;
      if ('texture' in t.icon) {
        slot.label.setVisible(false);
        slot.icon.setTexture(pixelTextureKey(t.icon.texture)).setVisible(true);
        if (t.icon.tint) slot.icon.setTint(hexColor(t.color));
        else slot.icon.clearTint();
        this.place(slot.icon, ix, iy);
        slot.icon.setScale(this.cfg.dot / zoom / (slot.icon.width > 8 ? 2 : 1));
      } else {
        slot.icon.setVisible(false);
        slot.label.setText(t.icon.text).setColor(t.color).setVisible(true);
        this.place(slot.label, ix, iy);
      }
    }
    for (let i = used; i < this.slots.length; i++) {
      const s = this.slots[i]!;
      s.arrow.setVisible(false);
      s.icon.setVisible(false);
      s.label.setVisible(false);
    }
  }

  hide(): void {
    for (const s of this.slots) {
      s.arrow.setVisible(false);
      s.icon.setVisible(false);
      s.label.setVisible(false);
    }
  }

  private slot(i: number): Slot {
    let s = this.slots[i];
    if (!s) {
      const depth = 999;
      s = {
        arrow: this.scene.add.image(0, 0, pixelTextureKey('edge-arrow')).setScrollFactor(0).setDepth(depth),
        icon: this.scene.add.image(0, 0, pixelTextureKey('edge-boss')).setScrollFactor(0).setDepth(depth),
        label: this.scene.add.text(0, 0, '', px(16, '#ffffff', { outline: true })).setOrigin(0.5).setScrollFactor(0).setDepth(depth),
      };
      this.slots[i] = s;
    }
    return s;
  }
}
