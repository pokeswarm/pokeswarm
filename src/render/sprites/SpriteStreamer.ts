import type Phaser from 'phaser';
import type { SpriteAnims } from '../../data/schema';
import { currentWaveIndex, type World } from '../../sim/world';
import { animKey, atlasKey, registerPokemonAnimations } from './PokemonSprite';
import { loadSpriteManifest, spriteBaseUrl } from './spriteManifest';

/**
 * 雑魚敵のスプライトを、時間帯に合わせて読み込み・解放する。
 * 読み込むのは「今の時間帯」と「もうすぐ始まる次の時間帯」の種類と、まだ生きている敵の種類だけ。
 * それ以外は GPU のメモリから解放する（ステージ全体の種類を一度に読み込まない）。
 */
export class SpriteStreamer {
  private readonly loaded = new Map<string, SpriteAnims>();
  private readonly loading = new Set<string>();
  /** 読み込めなかった（スプライトを取得していない）もの。何度も試さない */
  private readonly failed = new Set<string>();
  private readonly gpuBytes = new Map<string, number>();

  constructor(
    private readonly scene: Phaser.Scene,
    /** 敵の種類（data/game/enemies.json の並び）ごとのスプライトのキー */
    private readonly spriteOfKind: readonly (string | undefined)[],
    /** 次の時間帯の何回前の更新から読み込み始めるか */
    private readonly lookaheadTicks: number,
  ) {}

  update(world: World): void {
    const needed = new Set<string>();
    const add = (kind: number): void => {
      const key = this.spriteOfKind[kind];
      if (key) needed.add(key);
    };
    const now = currentWaveIndex(world);
    world.waves[now]?.kinds.forEach(add);
    const next = world.waves[now + 1];
    if (next && next.startTick - world.tick <= this.lookaheadTicks) next.kinds.forEach(add);
    const e = world.enemies;
    for (let i = 0; i < e.count; i++) add(e.kind[i]!);

    for (const key of needed) {
      if (!this.loaded.has(key) && !this.loading.has(key) && !this.failed.has(key)) void this.load(key);
    }
    for (const key of [...this.loaded.keys()]) {
      if (!needed.has(key)) this.unload(key);
    }
  }

  /** 読み込み済みならその種類のスプライト。まだなら null（呼び出し側は仮の円で描く） */
  manifestOf(kind: number): SpriteAnims | null {
    const key = this.spriteOfKind[kind];
    return key ? (this.loaded.get(key) ?? null) : null;
  }

  stats(): { count: number; gpuBytes: number } {
    let bytes = 0;
    for (const key of this.loaded.keys()) bytes += this.gpuBytes.get(key) ?? 0;
    return { count: this.loaded.size, gpuBytes: bytes };
  }

  private async load(key: string): Promise<void> {
    this.loading.add(key);
    try {
      const manifest = await loadSpriteManifest(key);
      if (!manifest) {
        this.failed.add(key);
        return;
      }
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
      if (!this.scene.sys.isActive()) return;
      if (!this.scene.textures.exists(atlasKey(key))) this.scene.textures.addAtlasJSONHash(atlasKey(key), image, atlas);
      registerPokemonAnimations(this.scene, manifest);
      this.gpuBytes.set(key, image.naturalWidth * image.naturalHeight * 4);
      this.loaded.set(key, manifest);
    } catch (err) {
      console.warn(`[sprites] ${key} を読み込めませんでした`, err);
      this.failed.add(key);
    } finally {
      this.loading.delete(key);
    }
  }

  private unload(key: string): void {
    const manifest = this.loaded.get(key);
    if (!manifest) return;
    for (const name of Object.keys(manifest.animations)) {
      for (let dir = 0; dir < manifest.directions.length; dir++) this.scene.anims.remove(animKey(key, name, dir));
    }
    if (this.scene.textures.exists(atlasKey(key))) this.scene.textures.remove(atlasKey(key));
    this.loaded.delete(key);
  }
}
