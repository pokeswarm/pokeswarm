import Phaser from 'phaser';
import type { Player } from '../sim/entities/player';
import type { World } from '../sim/world';
import type { IconTier } from './iconPixels';
import { itemIconKey, moveIconKey, moveTier, passiveIconKey, pipKey } from './Icons';

/** アイコンの表示の倍率・横の間隔・行の間隔 */
const ICON_SCALE = 4;
const CELL = 72;
const ROW_GAP = 6;
/** レベルのひし形の倍率と、1行に並べる数（技の最大レベル 8 まで1行に収める） */
const PIP_SCALE = 1;
const PIPS_PER_ROW = 8;

/**
 * プレイ画面の、持っている技・持ち物・パッシブのアイコン（作者の決定: 文字ではなくアイコンで出す）。
 * レベルはアイコンの下に小さなひし形を最大レベルの数だけ並べ、今のレベルまでを光らせる（作者の決定: 星は小さいと崩れるのでひし形）。
 * 光る色は技の段階で変わる（タイプの技 → 派生技 → 固有技。派生するとレベルは1からで、色が変わる）。
 * 1行目が技、2行目が持ち物、3行目がパッシブ。内容が変わったときだけ作り直す
 */
export class HudIcons {
  readonly container: Phaser.GameObjects.Container;
  private shownKey = '';

  constructor(private readonly scene: Phaser.Scene) {
    this.container = scene.add.container(0, 0).setScrollFactor(0).setDepth(1000);
  }

  update(world: World, p: Player): void {
    const r = world.rules;
    const rows: { key: string; level: number; max: number; tier: IconTier }[][] = [
      p.moves.map((m) => ({ key: moveIconKey(r, m.move), level: m.level, max: r.moves[m.move]!.levels.length, tier: moveTier(r, m.move) })),
      p.items.map((it) => ({ key: itemIconKey(r, it.item), level: it.level, max: r.items[it.item]!.maxLevel, tier: 'base' as const })),
      p.passives.map((ps) => ({ key: passiveIconKey(r, ps.passive), level: ps.level, max: r.passives[ps.passive]!.maxLevel, tier: 'base' as const })),
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
        const size = icon.displayWidth;
        // ひし形: 最大レベルの数だけ、アイコンの幅に収まるよう中央に並べる
        const pip = this.scene.textures.get(pipKey(false, 'base')).getSourceImage().width * PIP_SCALE;
        const step = Math.min(pip + 1, size / Math.min(cell.max, PIPS_PER_ROW));
        const left = x + (size - step * Math.min(cell.max, PIPS_PER_ROW) + (step - pip)) / 2;
        for (let k = 0; k < cell.max; k++) {
          const px = left + (k % PIPS_PER_ROW) * step;
          const py = y + size + 3 + Math.floor(k / PIPS_PER_ROW) * (pip + 1);
          this.container.add(this.scene.add.image(Math.round(px), py, pipKey(k < cell.level, cell.tier)).setOrigin(0, 0).setScale(PIP_SCALE));
        }
        rowHeight = Math.max(rowHeight, size + 3 + Math.ceil(cell.max / PIPS_PER_ROW) * (pip + 1));
      });
      y += rowHeight + ROW_GAP;
    }
  }
}
