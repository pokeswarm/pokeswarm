import Phaser from 'phaser';
import type { SimRules } from '../sim/rules';
import { c, makeTexture, on, rnd } from './effects/dotArt';

/** アクティブスキルのアイコン（32 ドット。技のアイコンと同じ決まり: 黒の輪郭線を使わない・起きることを描く。07 の305章） */
export function skillIconKey(key: string): string {
  return `icon:skill:${key}`;
}

const N = 32;

/**
 * テレポート: 左下の薄れる輪（消えた所）から、弧を描く光の点の軌跡が右上へ伸び、右上で明るい輪と十字の光が開く（現れた所）。
 * 背景はエスパーの色を暗くしたもの。黒の輪郭線は使わない
 */
function teleportPixel(x: number, y: number): number {
  if (x < 2 || y < 2 || x >= N - 2 || y >= N - 2) return 0;
  const bg = c(0x4a1a3c);
  // 現れる所: 十字の光（中心 22,11）
  const sx = Math.abs(x + 0.5 - 22);
  const sy = Math.abs(y + 0.5 - 11);
  if ((sx < 0.8 && sy < 6.5) || (sy < 0.8 && sx < 6.5)) return sx + sy < 2.2 ? c(0xffffff) : sx + sy < 4.5 ? c(0xfad4ff) : c(0xe68cff);
  if (sx < 1.6 && sy < 1.6) return c(0xfad4ff);
  // 現れる所の輪（楕円・明るい）
  const ar = Math.hypot((x + 0.5 - 22) / 7.5, (y + 0.5 - 13) / 3.4);
  if (ar > 0.8 && ar < 1.18) return y + 0.5 < 13 ? c(0xc455ee) : c(0xf6b6ff);
  // 消えた所の輪（楕円・ディザで薄く）
  const br = Math.hypot((x + 0.5 - 9) / 6.5, (y + 0.5 - 25) / 2.8);
  if (br > 0.75 && br < 1.2) return on(0.5, x, y) ? c(0x8e3fbf) : bg;
  // 消えた所から立ちのぼる粒
  if ((x === 7 && y === 20) || (x === 11 && y === 18) || (x === 9 && y === 15)) return c(0x9c4dcc);
  // 弧の軌跡（左下 → 右上。先ほど明るく大きい）
  for (let k = 1; k <= 6; k++) {
    const t = k / 7;
    const px = 9 + (22 - 9) * t;
    const py = 24 - (24 - 13) * t - Math.sin(t * Math.PI) * 7;
    const r = 0.55 + t * 0.6;
    if (Math.abs(x + 0.5 - px) < r && Math.abs(y + 0.5 - py) < r) return t > 0.6 ? c(0xfad4ff) : t > 0.3 ? c(0xe68cff) : c(0xb05ad8);
  }
  if (rnd(x, y) > 0.985) return c(0x7a3a74);
  return bg;
}

/** スキルのアイコンを作る（一度だけ） */
export function ensureSkillIcons(scene: Phaser.Scene, rules: SimRules): void {
  for (const d of rules.activeSkills?.defs ?? []) {
    const key = skillIconKey(d.key);
    if (scene.textures.exists(key)) continue;
    if (d.kind === 'teleport') makeTexture(scene, key, N, N, teleportPixel);
  }
}
