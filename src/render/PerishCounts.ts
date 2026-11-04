import Phaser from 'phaser';
import type { World } from '../sim/world';
import { hexColor } from './color';
import { DAMAGE_FONT_KEY, ensureDamageFont } from './DamageNumbers';

/** 同時に出す数字の上限（多いと画面が数字で埋まるので、超えた分は出さない） */
const MAX_COUNTS = 48;
const COUNT_COLOR = hexColor('#ce93d8');

/**
 * ほろびのうた: 歌を聞いた敵の頭の上に、倒れるまでの秒数（3 → 2 → 1）を出す（07 の180章）。
 * 数字はダメージの数字と同じドットの字で、先に作った決まった数を使い回す
 */
export class PerishCounts {
  private readonly texts: Phaser.GameObjects.BitmapText[] = [];

  constructor(scene: Phaser.Scene, depth: number) {
    ensureDamageFont(scene);
    for (let k = 0; k < MAX_COUNTS; k++) {
      this.texts.push(scene.add.bitmapText(0, 0, DAMAGE_FONT_KEY, '').setOrigin(0.5, 1).setScale(2).setTint(COUNT_COLOR).setDepth(depth).setVisible(false));
    }
  }

  update(world: World, alpha: number, view: { left: number; top: number; right: number; bottom: number }): void {
    const e = world.enemies;
    let used = 0;
    for (let i = 0; i < e.count && used < MAX_COUNTS; i++) {
      if (e.markTicks[i] === 0 || e.hp[i]! <= 0 || !world.rules.moves[e.markMove[i]!]?.delayedBlast?.perish) continue;
      const x = e.prevX[i]! + (e.x[i]! - e.prevX[i]!) * alpha;
      const y = e.prevY[i]! + (e.y[i]! - e.prevY[i]!) * alpha;
      if (x < view.left || x > view.right || y < view.top || y > view.bottom) continue;
      const text = this.texts[used++]!;
      const left = String(Math.max(1, Math.ceil(e.markTicks[i]! * world.dt)));
      if (text.text !== left) text.setText(left);
      text.setPosition(x, y - e.radius[i]! * 1.6).setVisible(true);
    }
    for (let k = used; k < MAX_COUNTS; k++) {
      if (this.texts[k]!.visible) this.texts[k]!.setVisible(false);
    }
  }
}
