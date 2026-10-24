import Phaser from 'phaser';
import { uiConfig } from '../data';
import { hexColor } from './color';

/**
 * ドット調の画面の部品（作者の決定。2026年10月22日）: ドットのフォント、原作をまねた白い窓・黒い窓、▶ のカーソルが付くボタン。
 * フォントは英数字が Press Start 2P、日本語が美咲ゴシック第2（どちらも 8 ドットの字なので、大きさは 8 の倍数にする）。
 */

/** 文字の大きさ（8 の倍数にすると、ドットがにじまない） */
export type PxSize = 8 | 16 | 24 | 32 | 40 | 48;

/** 高さの低い画面（横向きのスマホなど）か。つめた表示にする（data/render/ui.json の compactHeight） */
export function compactScreen(height = window.innerHeight): boolean {
  return height < uiConfig.compactHeight;
}

/** フォントを読み込む（読み込む前に文字を描くと、ふつうのフォントで描かれてしまう） */
export async function loadPixelFonts(): Promise<void> {
  const base = import.meta.env.BASE_URL ?? '/';
  await Promise.all(
    uiConfig.font.faces.map(async (f) => {
      const face = new FontFace(f.family, `url(${base}${f.file})`);
      document.fonts.add(await face.load());
    }),
  );
  // DOM の画面（レベルアップの選択など）も同じフォントにする。ドットをなめらかにしない
  document.body.style.fontFamily = uiConfig.font.family;
  document.body.style.setProperty('-webkit-font-smoothing', 'none');
}

/** ドットの文字の書式。outline を付けると、黒いふちで背景に埋もれない */
export function px(size: PxSize, color: string, extra: Phaser.Types.GameObjects.Text.TextStyle & { outline?: boolean } = {}): Phaser.Types.GameObjects.Text.TextStyle {
  const { outline, ...rest } = extra;
  return {
    fontFamily: uiConfig.font.family,
    fontSize: `${size}px`,
    color,
    ...(outline ? { stroke: '#000000', strokeThickness: Math.max(2, size / 4) } : {}),
    ...rest,
  };
}

/**
 * 原作をまねた窓: light は白い窓（濃い枠と、その内側の細い色の線）、dark は黒い窓に白い枠。角は1ドット欠く。
 * 1ドットは unit（画面の px）
 */
export function drawWindow(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, kind: 'light' | 'dark' = 'light', unit = 2): void {
  const c = kind === 'light' ? uiConfig.window : { ...uiConfig.dark, inner: uiConfig.dark.border };
  const u = unit;
  x = Math.round(x);
  y = Math.round(y);
  w = Math.round(w);
  h = Math.round(h);
  // 枠（角を欠いた四角を2つ重ねる）
  g.fillStyle(hexColor(c.border));
  g.fillRect(x + u, y, w - 2 * u, h);
  g.fillRect(x, y + u, w, h - 2 * u);
  // 中
  g.fillStyle(hexColor(c.fill));
  g.fillRect(x + 2 * u, y + 2 * u, w - 4 * u, h - 4 * u);
  // 白い窓は、内側にもう1本の細い線
  if (kind === 'light') {
    g.lineStyle(u, hexColor(c.inner));
    g.strokeRect(x + 3.5 * u, y + 3.5 * u, w - 7 * u, h - 7 * u);
  }
}

/** ボタン: 窓の中に文字。上に乗ると左に ▶ が出る（原作のメニュー） */
export function pixelButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  onClick: () => void,
  opts: { kind?: 'light' | 'dark'; size?: PxSize; depth?: number; /** 文字の左に置くアイコン（文字の色で塗る。テクスチャのキーを色から作る） */ icon?: (color: string) => string } = {},
): Phaser.GameObjects.Container {
  const kind = opts.kind ?? 'light';
  const color = kind === 'light' ? uiConfig.window.text : uiConfig.dark.text;
  const g = scene.add.graphics();
  drawWindow(g, -w / 2, -h / 2, w, h, kind);
  const size = opts.size ?? 16;
  const text = scene.add.text(size * 0.75, 0, label, px(size, color)).setOrigin(0.5);
  const cursor = scene.add.text(-w / 2 + 12, 0, '▶', px(size, color)).setOrigin(0, 0.5).setVisible(false);
  const parts: Phaser.GameObjects.GameObject[] = [g, text, cursor];
  if (opts.icon) {
    // アイコンはカーソルの右。文字はアイコンの右に左寄せ（メニューの頭がそろう）
    const iconLeft = -w / 2 + 12 + size + 6;
    const icon = scene.add.image(iconLeft, 0, opts.icon(color)).setOrigin(0, 0.5);
    icon.setScale(Math.max(1, Math.round((size * 1.5) / icon.height)));
    text.setOrigin(0, 0.5).setX(iconLeft + icon.displayWidth + 8);
    // 長い言葉（フランス語・ドイツ語など）で右の端からはみ出すときは、文字を一段小さくする（ドットの字は半端な倍率にしない）
    if (size > 8 && text.x + text.width > w / 2 - 6) text.setStyle(px(size === 16 ? 8 : 16, color));
    parts.push(icon);
  }
  const box = scene.add.container(Math.round(x), Math.round(y), parts).setSize(w, h).setDepth(opts.depth ?? 0);
  box.setInteractive({ useHandCursor: true });
  box.on('pointerover', () => cursor.setVisible(true));
  box.on('pointerout', () => cursor.setVisible(false));
  box.on('pointerdown', onClick);
  return box;
}

/** DOM の画面（レベルアップの選択など）用の、原作をまねた窓の CSS（drawWindow と同じ見た目） */
export function windowCss(kind: 'light' | 'dark' = 'light', accent?: string): string {
  if (kind === 'dark') {
    const c = uiConfig.dark;
    return `background:${c.fill};color:${c.text};border:4px solid ${accent ?? c.border};border-radius:6px;box-shadow:inset 0 0 0 2px ${c.fill},inset 0 0 0 4px ${accent ?? c.border}`;
  }
  const c = uiConfig.window;
  return `background:${c.fill};color:${c.text};border:4px solid ${accent ?? c.border};border-radius:6px;box-shadow:inset 0 0 0 3px ${c.fill},inset 0 0 0 5px ${c.inner}`;
}
