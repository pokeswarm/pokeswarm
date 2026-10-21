import type Phaser from 'phaser';
import type { IconConfig, ItemIcons } from '../data/schema';
import type { SimRules } from '../sim/rules';
import { iconColor, iconPixels, itemIconPixels, starPixels, type IconTier } from './iconPixels';

/** レベルの表示のひし形（済んだもの: 段階ごとの色、まだのもの） */
export function pipKey(on: boolean, tier: IconTier): string {
  return on ? `icon:pip-${tier}` : 'icon:pip-off';
}

/** 技の段階（タイプの技・派生技・固有技） */
export function moveTier(rules: SimRules, move: number): IconTier {
  const d = rules.derivations.find((x) => x.to === move);
  return !d ? 'base' : d.line === null ? 'derived' : 'unique';
}

export function moveIconKey(rules: SimRules, move: number): string {
  return `icon:move:${rules.moves[move]!.key}`;
}
export function itemIconKey(rules: SimRules, item: number): string {
  return `icon:item:${rules.items[item]!.key}`;
}

function addTexture(scene: Phaser.Scene, key: string, width: number, height: number, pixels: Uint8ClampedArray): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, width, height);
  if (!tex) return;
  tex.getContext().putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
  tex.refresh();
}

/**
 * 技・持ち物のアイコンと、レベルのひし形のテクスチャを作る（一度だけ）。
 * 技は出し方の絵柄をタイプの色で塗り、枠で タイプの技・派生技・固有技 を分ける
 */
export function ensureIconTextures(scene: Phaser.Scene, data: IconConfig, rules: SimRules, items?: ItemIcons): void {
  const n = data.size;
  rules.moves.forEach((m, i) => {
    const type = rules.types.names[m.type] ?? 'normal';
    addTexture(scene, moveIconKey(rules, i), n, n, iconPixels(data, data.moves[m.pattern] ?? 'nearest', data.typeColors[type] ?? '#888888', moveTier(rules, i)));
  });
  rules.items.forEach((it, i) => {
    const def = data.items[it.key] ?? { glyph: 'orb', color: '#9e9e9e' };
    const sprite = items?.items[it.key];
    // 公式のアイテム画像を縮めたドット絵（背景はタイプのアイテムならタイプの色）。無ければ自作の絵柄
    addTexture(scene, itemIconKey(rules, i), n, n, sprite ? itemIconPixels(data, sprite, iconColor(data, def.color)) : iconPixels(data, def.glyph, iconColor(data, def.color), 'base'));
  });
  for (const tier of ['base', 'derived', 'unique'] as const) {
    const s = starPixels(data, true, tier);
    addTexture(scene, pipKey(true, tier), s.width, s.height, s.pixels);
  }
  const off = starPixels(data, false);
  addTexture(scene, pipKey(false, 'base'), off.width, off.height, off.pixels);
}

/** DOM（レベルアップの画面）で使う画像の URL */
export function iconDataUrl(scene: Phaser.Scene, key: string): string {
  const tex = scene.textures.get(key);
  const src = tex.getSourceImage() as HTMLCanvasElement;
  return typeof src.toDataURL === 'function' ? src.toDataURL() : '';
}
