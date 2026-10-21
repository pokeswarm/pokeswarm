import type Phaser from 'phaser';
import type { IconConfig } from '../data/schema';
import type { SimRules } from '../sim/rules';
import { iconColor, iconPixels, starPixels, type IconTier } from './iconPixels';

export const STAR_ON = 'icon:star-on';
export const STAR_OFF = 'icon:star-off';

export function moveIconKey(rules: SimRules, move: number): string {
  return `icon:move:${rules.moves[move]!.key}`;
}
export function itemIconKey(rules: SimRules, item: number): string {
  return `icon:item:${rules.items[item]!.key}`;
}
export function passiveIconKey(rules: SimRules, passive: number): string {
  return `icon:passive:${rules.passives[passive]!.key}`;
}

function addTexture(scene: Phaser.Scene, key: string, width: number, height: number, pixels: Uint8ClampedArray): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, width, height);
  if (!tex) return;
  tex.getContext().putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
  tex.refresh();
}

/**
 * 技・持ち物・パッシブのアイコンと星のテクスチャを作る（一度だけ）。
 * 技は出し方の絵柄をタイプの色で塗り、枠で タイプの技・派生技・固有技 を分ける
 */
export function ensureIconTextures(scene: Phaser.Scene, data: IconConfig, rules: SimRules): void {
  const n = data.size;
  const derivedTo = new Map<number, IconTier>();
  for (const d of rules.derivations) derivedTo.set(d.to, d.line === null ? 'derived' : 'unique');
  rules.moves.forEach((m, i) => {
    const type = rules.types.names[m.type] ?? 'normal';
    addTexture(scene, moveIconKey(rules, i), n, n, iconPixels(data, data.moves[m.pattern] ?? 'nearest', data.typeColors[type] ?? '#888888', derivedTo.get(i) ?? 'base'));
  });
  rules.items.forEach((it, i) => {
    const def = data.items[it.key] ?? { glyph: 'orb', color: '#9e9e9e' };
    addTexture(scene, itemIconKey(rules, i), n, n, iconPixels(data, def.glyph, iconColor(data, def.color), 'base'));
  });
  rules.passives.forEach((ps, i) => {
    const def = data.passives[ps.key] ?? { glyph: 'orb', color: '#9e9e9e' };
    addTexture(scene, passiveIconKey(rules, i), n, n, iconPixels(data, def.glyph, iconColor(data, def.color), 'base'));
  });
  for (const [key, on] of [[STAR_ON, true], [STAR_OFF, false]] as const) {
    const s = starPixels(data, on);
    addTexture(scene, key, s.width, s.height, s.pixels);
  }
}

/** DOM（レベルアップの画面）で使う画像の URL */
export function iconDataUrl(scene: Phaser.Scene, key: string): string {
  const tex = scene.textures.get(key);
  const src = tex.getSourceImage() as HTMLCanvasElement;
  return typeof src.toDataURL === 'function' ? src.toDataURL() : '';
}
