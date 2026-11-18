import Phaser from 'phaser';
import { uiConfig } from '../data';
import type { Player } from '../sim/entities/player';
import type { World } from '../sim/world';
import { maxCharges, rechargeTicksOf, skillDef } from '../sim/activeSkills';
import { px } from './pixelUi';
import { skillIconKey } from './skillIcons';
import { isTouchDevice } from './TouchJoystick';

/** アイコンの倍率（32 ドットのアイコンを 64 で出す） */
const ICON_SCALE = 2;
const GAP = 10;

/**
 * アクティブスキルのボタン（画面の右下。07 の305章）: スキルのアイコン・キー（SPACE / Q / E）・ためている回数のひし形・
 * 次の 1 回が戻るまでのゲージ。スマホではこのボタンを押している間が SPACE を押している間（離すと使う）
 */
export class SkillHud {
  readonly container: Phaser.GameObjects.Container;
  private shownKey = '';
  private readonly bars: Phaser.GameObjects.Graphics;
  /** ボタンの場所（入れ物の中の座標）と枠の番号 */
  private cells: { slot: number; x: number; y: number; size: number }[] = [];
  width = 0;
  height = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly keys: readonly string[],
  ) {
    this.container = scene.add.container(0, 0).setScrollFactor(0).setDepth(1000);
    this.bars = scene.add.graphics();
  }

  update(world: World, p: Player, aiming: number | null): void {
    const skills = p.skills ?? [];
    const key = JSON.stringify(skills.map((s) => [s.skill, s.level, s.charges, maxCharges(world, p, s)])) + (aiming ?? '');
    if (key !== this.shownKey) {
      this.shownKey = key;
      this.container.remove(this.bars);
      this.container.removeAll(true);
      this.cells = [];
      this.bars.clear();
      this.container.add(this.bars);
      const touch = isTouchDevice();
      skills.forEach((s, slot) => {
        const def = skillDef(world, s.skill);
        const x = slot * (32 * ICON_SCALE + GAP);
        const icon = this.scene.add.image(x, 0, skillIconKey(def.key)).setOrigin(0, 0).setScale(ICON_SCALE);
        if (s.charges <= 0) icon.setTint(0x6a5a70);
        if (aiming === slot) icon.setTint(0xffd6ff);
        this.container.add(icon);
        const size = icon.displayWidth;
        this.cells.push({ slot, x, y: 0, size });
        // 回数: アイコンの下に「今 / 最大」
        const max = maxCharges(world, p, s);
        const n = this.scene.add.text(x + size / 2, size + 4, `${s.charges}/${max}`, px(16, s.charges > 0 ? '#ffffff' : '#9e8fa6', { outline: true })).setOrigin(0.5, 0);
        this.container.add(n);
        // キー（スマホは出さない）
        if (!touch) this.container.add(this.scene.add.text(x + 3, 3, this.keys[slot] ?? '', px(8, uiConfig.expBar.text, { outline: true })).setOrigin(0, 0));
      });
      this.container.bringToTop(this.bars);
      this.width = skills.length ? skills.length * (32 * ICON_SCALE + GAP) - GAP : 0;
      this.height = 32 * ICON_SCALE + 26;
    }
    // 次の 1 回が戻るまでのゲージ（毎フレーム）
    this.bars.clear();
    skills.forEach((s, slot) => {
      const cell = this.cells[slot];
      if (!cell) return;
      const max = maxCharges(world, p, s);
      if (s.charges >= max || s.rechargeTicks <= 0) return;
      const total = rechargeTicksOf(world, p, s);
      const t = 1 - s.rechargeTicks / total;
      // アイコンの下端の中に、次の 1 回が戻るまでのゲージ
      this.bars.fillStyle(0x1e1024, 1).fillRect(cell.x + 4, cell.size - 10, cell.size - 8, 6);
      this.bars.fillStyle(0xe040fb, 1).fillRect(cell.x + 4, cell.size - 10, Math.round((cell.size - 8) * t), 6);
    });
  }

  /** 入れ物の中の座標 (x, y) にあるボタンの枠の番号（無ければ null） */
  hit(x: number, y: number): number | null {
    const c = this.cells.find((c) => x >= c.x - 6 && x < c.x + c.size + 6 && y >= c.y - 6 && y < c.y + c.size + 20);
    return c ? c.slot : null;
  }
}
