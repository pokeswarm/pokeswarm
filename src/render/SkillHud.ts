import Phaser from 'phaser';
import { uiConfig } from '../data';
import type { Player } from '../sim/entities/player';
import type { World } from '../sim/world';
import { maxCharges, rechargeTicksOf, skillDef } from '../sim/activeSkills';
import { compactScreen, px } from './pixelUi';
import { skillIconKey } from './skillIcons';
import { moveIconKey } from './Icons';
import { isTouchDevice } from './TouchJoystick';

/** パソコン: アイコンの倍率（32 ドットのアイコンを 64 で出す）と間隔 */
const ICON_SCALE = 2;
const GAP = 10;

/** ボタンの色（不透明。ボタンの地・ふち・押しているとき・戻るまでの輪） */
const BASE = 0x1b1530;
const BASE_EMPTY = 0x0e0b18;
const RIM = 0xd9d0f0;
const RIM_PRESSED = 0xffd54f;
const RING_BACK = 0x3a3150;
const RING = 0xe040fb;

type Cell = { slot: number; x: number; y: number; r: number; size: number };

/**
 * アクティブスキルのボタン（画面の右下。07 の305・308章）。
 * - パソコン: アイコンを横に並べ、キー（SPACE・Q・E）・「今 / 最大」・次の 1 回が戻るまでのゲージ。
 * - スマホ: モバイルゲームのように、右下の角に 1 つ目（SPACE）を大きな丸で、ほかを小さな丸で 1 つ目のまわりの弧に並べる。
 *   ボタンのまわりの輪が、次の 1 回が戻るまでを示し、右上の小さな丸が回数。押している間はふちが光って少し縮む
 */
export class SkillHud {
  readonly container: Phaser.GameObjects.Container;
  private shownKey = '';
  private readonly bars: Phaser.GameObjects.Graphics;
  private cells: Cell[] = [];
  private readonly touch = isTouchDevice();
  width = 0;
  height = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly keys: readonly string[],
  ) {
    this.container = scene.add.container(0, 0).setScrollFactor(0).setDepth(1000);
    this.bars = scene.add.graphics();
  }

  /** 画面の端からの距離（スマホは広め） */
  get margin(): number {
    return this.touch ? uiConfig.skillButtons.margin : 16;
  }

  update(world: World, p: Player, aiming: number | null, pressed: readonly boolean[] = []): void {
    const skills = p.skills ?? [];
    const compact = compactScreen();
    const key = JSON.stringify(skills.map((s) => [s.skill, s.level, s.charges, maxCharges(world, p, s)])) + `|${aiming}|${pressed.join(',')}|${compact}`;
    if (key !== this.shownKey) {
      this.shownKey = key;
      this.container.remove(this.bars);
      this.container.removeAll(true);
      this.cells = [];
      this.container.add(this.bars);
      if (this.touch) this.buildTouch(world, p, aiming, pressed, compact);
      else this.buildDesktop(world, p, aiming);
      // スマホ: 戻るまでの輪はボタンの外側なので、回数の丸の下に描く。パソコン: ゲージはアイコンの上
      if (this.touch) this.container.sendToBack(this.bars);
      else this.container.bringToTop(this.bars);
    }
    this.drawRecharge(world, p);
  }

  private iconOf(world: World, skill: number): string {
    const def = skillDef(world, skill);
    // 技の枠の技を使うスキル（スイクン）は、その技のアイコン
    return def.move >= 0 ? moveIconKey(world.rules, def.move) : skillIconKey(def.key);
  }

  private buildDesktop(world: World, p: Player, aiming: number | null): void {
    const skills = p.skills ?? [];
    skills.forEach((s, slot) => {
      const x = slot * (32 * ICON_SCALE + GAP);
      const icon = this.scene.add.image(x, 0, this.iconOf(world, s.skill)).setOrigin(0, 0).setScale(ICON_SCALE);
      if (s.charges <= 0) icon.setTint(0x6a5a70);
      if (aiming === slot) icon.setTint(0xffd6ff);
      this.container.add(icon);
      const size = icon.displayWidth;
      this.cells.push({ slot, x, y: 0, r: 0, size });
      // 回数: アイコンの下に「今 / 最大」
      const max = maxCharges(world, p, s);
      this.container.add(this.scene.add.text(x + size / 2, size + 4, `${s.charges}/${max}`, px(16, s.charges > 0 ? '#ffffff' : '#9e8fa6', { outline: true })).setOrigin(0.5, 0));
      this.container.add(this.scene.add.text(x + 3, 3, this.keys[slot] ?? '', px(8, uiConfig.expBar.text, { outline: true })).setOrigin(0, 0));
    });
    this.width = skills.length ? skills.length * (32 * ICON_SCALE + GAP) - GAP : 0;
    this.height = 32 * ICON_SCALE + 26;
  }

  private buildTouch(world: World, p: Player, aiming: number | null, pressed: readonly boolean[], compact: boolean): void {
    const skills = p.skills ?? [];
    const cfg = uiConfig.skillButtons;
    const k = compact ? cfg.compactScale : 1;
    // 1 つ目の中心を (0, 0) にした置き場所。あとで左上が (0, 0) になるようにずらす
    const spots = skills.map((_, slot) => {
      if (slot === 0) return { x: 0, y: 0, r: cfg.main * k };
      const a = ((cfg.angles[(slot - 1) % cfg.angles.length] ?? 225) * Math.PI) / 180;
      return { x: Math.cos(a) * cfg.distance * k, y: Math.sin(a) * cfg.distance * k, r: cfg.sub * k };
    });
    const minX = Math.min(...spots.map((s) => s.x - s.r));
    const minY = Math.min(...spots.map((s) => s.y - s.r));
    const maxX = Math.max(...spots.map((s) => s.x + s.r));
    const maxY = Math.max(...spots.map((s) => s.y + s.r));
    const g = this.scene.add.graphics();
    this.container.add(g);
    skills.forEach((s, slot) => {
      const sp = spots[slot]!;
      const x = sp.x - minX;
      const y = sp.y - minY;
      const down = !!pressed[slot] || aiming === slot;
      const r = sp.r * (down ? 0.92 : 1);
      const empty = s.charges <= 0;
      // 地とふち
      g.fillStyle(empty ? BASE_EMPTY : BASE, 1).fillCircle(x, y, r);
      g.lineStyle(Math.max(2, r * 0.08), down ? RIM_PRESSED : RIM, 1).strokeCircle(x, y, r - r * 0.04);
      // アイコン（丸の中に収める）
      const icon = this.scene.add.image(x, y, this.iconOf(world, s.skill));
      icon.setScale((r * 1.25) / icon.width);
      if (empty) icon.setTint(0x6a5a70);
      this.container.add(icon);
      // 回数: 右上の小さな丸
      const max = maxCharges(world, p, s);
      if (max > 1 || empty) {
        const bx = x + r * 0.72;
        const by = y - r * 0.72;
        const br = Math.max(9, r * 0.3);
        g.fillStyle(empty ? 0x5d4f6a : 0x7b1fa2, 1).fillCircle(bx, by, br);
        g.lineStyle(2, RIM, 1).strokeCircle(bx, by, br);
        this.container.add(this.scene.add.text(bx, by, String(s.charges), px(8, '#ffffff', { outline: true })).setOrigin(0.5, 0.5));
      }
      this.cells.push({ slot, x, y, r: sp.r, size: sp.r * 2 });
    });
    this.width = maxX - minX;
    this.height = maxY - minY;
  }

  /** 次の 1 回が戻るまで（毎フレーム）: パソコンはアイコンの下端のゲージ、スマホはボタンのまわりの輪 */
  private drawRecharge(world: World, p: Player): void {
    const skills = p.skills ?? [];
    this.bars.clear();
    skills.forEach((s, slot) => {
      const cell = this.cells[slot];
      if (!cell) return;
      const max = maxCharges(world, p, s);
      if (s.charges >= max || s.rechargeTicks <= 0) return;
      const t = 1 - s.rechargeTicks / rechargeTicksOf(world, p, s);
      if (this.touch) {
        const w = Math.max(3, cell.r * 0.12);
        const rr = cell.r + w * 0.9;
        this.bars.lineStyle(w, RING_BACK, 1).beginPath().arc(cell.x, cell.y, rr, 0, Math.PI * 2).strokePath();
        this.bars.lineStyle(w, RING, 1).beginPath().arc(cell.x, cell.y, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t).strokePath();
        return;
      }
      this.bars.fillStyle(0x1e1024, 1).fillRect(cell.x + 4, cell.size - 10, cell.size - 8, 6);
      this.bars.fillStyle(0xe040fb, 1).fillRect(cell.x + 4, cell.size - 10, Math.round((cell.size - 8) * t), 6);
    });
  }

  /** 入れ物の中の座標 (x, y) にあるボタンの枠の番号（無ければ null） */
  hit(x: number, y: number): number | null {
    if (this.touch) {
      // 指は大きいので、丸より少し広く取る。重なるときは近い方
      let best: number | null = null;
      let bestD = Infinity;
      for (const c of this.cells) {
        const d = Math.hypot(x - c.x, y - c.y);
        if (d <= c.r + 10 && d < bestD) {
          best = c.slot;
          bestD = d;
        }
      }
      return best;
    }
    const c = this.cells.find((c) => x >= c.x - 6 && x < c.x + c.size + 6 && y >= c.y - 6 && y < c.y + c.size + 20);
    return c ? c.slot : null;
  }
}
