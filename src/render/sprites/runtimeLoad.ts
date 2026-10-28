import type Phaser from 'phaser';
import type { SpriteAnims } from '../../data/schema';
import { animKey, atlasKey, registerPokemonAnimations } from './PokemonSprite';
import { loadSpriteManifest, spriteBaseUrl } from './spriteManifest';

/**
 * ゲームの途中でポケモンのスプライトを読み込み、アニメーションを登録する（時間帯ごとの雑魚・進化した後の見た目）。
 * スプライトを取得していなければ null。
 */
export async function loadPokemonAtRuntime(scene: Phaser.Scene, key: string): Promise<{ manifest: SpriteAnims; gpuBytes: number } | null> {
  const manifest = await loadSpriteManifest(key);
  if (!manifest) return null;
  const base = spriteBaseUrl(key);
  const [image, atlas] = await Promise.all([
    (async () => {
      const img = new Image();
      img.src = `${base}atlas.png`;
      await img.decode();
      return img;
    })(),
    fetch(`${base}atlas.json`).then((r) => r.json() as Promise<object>),
  ]);
  // 読み込みの間にシーンが終わっていたら何もしない
  if (!scene.sys.isActive()) return null;
  if (!scene.textures.exists(atlasKey(key))) scene.textures.addAtlasJSONHash(atlasKey(key), image, atlas);
  registerPokemonAnimations(scene, manifest);
  return { manifest, gpuBytes: image.naturalWidth * image.naturalHeight * 4 };
}

/** 読み込んだポケモンのスプライトを GPU のメモリから解放する（アニメーションも消す） */
export function unloadPokemonAtRuntime(scene: Phaser.Scene, key: string, manifest: SpriteAnims): void {
  for (const name of Object.keys(manifest.animations)) {
    for (let dir = 0; dir < manifest.directions.length; dir++) scene.anims.remove(animKey(key, name, dir));
  }
  if (scene.textures.exists(atlasKey(key))) scene.textures.remove(atlasKey(key));
}
