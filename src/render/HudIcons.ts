import Phaser from 'phaser';
import type { Player } from '../sim/entities/player';
import type { World } from '../sim/world';
import { itemIconKey, moveIconKey, passiveIconKey, STAR_OFF, STAR_ON } from './Icons';

/** アイコンの表示の大きさ（倍率）・間隔、星の倍率と1行の数 */
const ICON_SCALE = 3;
const STAR_SCALE = 2;
const STARS_PER_ROW = 4;
const CELL = 66;
const ROW_GAP = 6;

/**
 * プレイ画面の、持っている技・持ち物・パッシブのアイコン（作者の決定: 文字ではなくアイコンで出す）。
 * レベルはアイコンの下に ★★☆☆ のように、最大のうちどれくらいかを星で出す。1行目が技、2行目が持ち物、3行目がパッシブ。
 * 内容が変わったときだけ作り直す
 */
export class HudIcons {
  readonly container: Phaser.GameObjects.Container;
  private shownKey = '';
  private height = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.container = scene.add.container(0, 0).setScrollFactor(0).setDepth(1000);
  }

  /** 画面での高さ（ピクセル） */
  get displayHeight(): number {
    return this.height;
  }

  update(world: World, p: Player): void {
    const r = world.rules;
    const rows: { key: string; level: number; max: number }[][] = [
      p.moves.map((m) => ({ key: moveIconKey(r, m.move), level: m.level, max: r.moves[m.move]!.levels.length })),
      p.items.map((it) => ({ key: itemIconKey(r, it.item), level: it.level, max: r.items[it.item]!.maxLevel })),
      p.passives.map((ps) => ({ key: passiveIconKey(r, ps.passive), level: ps.level, max: r.passives[ps.passive]!.maxLevel })),
    ];
    const key = JSON.stringify(rows);
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.container.removeAll(true);
    let y = 0;
    for (const row of rows) {
      if (row.length === 0) continue;
      let rowHeight = 0;
      row.forEach((cell, i) => {
        const x = i * CELL;
        const icon = this.scene.add.image(x, y, cell.key).setOrigin(0, 0).setScale(ICON_SCALE);
        this.container.add(icon);
        const iconSize = icon.displayWidth;
        // 星: 最大レベルの数だけ並べ、今のレベルまでを明るく
        const starW = 7 * STAR_SCALE + 1;
        for (let k = 0; k < cell.max; k++) {
          const sx = x + (k % STARS_PER_ROW) * starW + Math.max(0, (iconSize - Math.min(cell.max, STARS_PER_ROW) * starW) / 2);
          const sy = y + iconSize + 2 + Math.floor(k / STARS_PER_ROW) * starW;
          this.container.add(this.scene.add.image(sx, sy, k < cell.level ? STAR_ON : STAR_OFF).setOrigin(0, 0).setScale(STAR_SCALE));
        }
        rowHeight = Math.max(rowHeight, iconSize + 2 + Math.ceil(cell.max / STARS_PER_ROW) * starW);
      });
      y += rowHeight + ROW_GAP;
    }
    this.height = y;
  }
}
