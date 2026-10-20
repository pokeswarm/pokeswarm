import Phaser from 'phaser';
import { generated, playablesConfig, spriteRender, unlocksConfig } from '../data';
import { isPlayableUnlocked } from '../meta/progress';
import { session } from '../meta/session';
import { localName } from '../data/simRules';
import type { SpriteAnims } from '../data/schema';
import { getLocale, t } from '../i18n';
import { PokemonSpriteView } from '../render/sprites/PokemonSprite';
import { loadPokemonAtRuntime } from '../render/sprites/runtimeLoad';
import type { RunSceneData } from './RunScene';

/**
 * ポケモン選択（見た目の作り込みはフェーズ4）。プレイアブルのポケモンをカードで横に並べる。
 * 数字キーかクリックで選ぶとランが始まる。Esc でタイトルへ。
 */
export class SelectScene extends Phaser.Scene {
  private readonly manifests = new Map<string, SpriteAnims | null>();

  constructor() {
    super('select');
  }

  create(): void {
    const keys = Object.keys(playablesConfig.pokemon).filter((k) =>
      isPlayableUnlocked(session.store.current, unlocksConfig, k, playablesConfig.pokemon[k]!.unlock),
    );
    let chosen = false;
    const choose = (i: number): void => {
      const key = keys[i];
      if (!key || chosen) return;
      chosen = true;
      const data: RunSceneData = { pokemon: key, playerSprite: this.manifests.get(key) ?? null, coop: null };
      this.scene.start('run', data);
    };
    const layout = (): void => {
      this.children.removeAll(true);
      const { width, height } = this.scale;
      this.add.text(width / 2, height * 0.12, t('select.title'), { fontFamily: 'sans-serif', fontSize: '36px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5);
      this.add.text(width / 2, height * 0.12 + 44, t('select.hint'), { fontFamily: 'sans-serif', fontSize: '16px', color: '#b0bec5' }).setOrigin(0.5);
      const gap = width * 0.02;
      const cardW = (width - gap * (keys.length + 1)) / keys.length;
      const cardH = height * 0.6;
      const top = height * 0.25;
      keys.forEach((key, i) => {
        const x = gap + i * (cardW + gap);
        const card = this.add.rectangle(x + cardW / 2, top + cardH / 2, cardW, cardH, 0x162416).setStrokeStyle(2, 0x4a7a4a).setInteractive({ useHandCursor: true });
        card.on('pointerover', () => card.setStrokeStyle(3, 0xffb300));
        card.on('pointerout', () => card.setStrokeStyle(2, 0x4a7a4a));
        card.on('pointerdown', () => choose(i));
        const g = generated.pokemon[key];
        const types = (g?.types ?? []).map((ty) => localName(generated.types[ty]?.names, getLocale(), ty)).join(' / ');
        const move = playablesConfig.pokemon[key]!.startingMoves[0] ?? '';
        const style = { fontFamily: 'sans-serif', color: '#ffffff', align: 'center' as const };
        this.add.text(x + cardW / 2, top + 18, `${i + 1}`, { ...style, fontSize: '18px', color: '#b0bec5' }).setOrigin(0.5, 0);
        this.add.text(x + cardW / 2, top + cardH * 0.62, localName(g?.names, getLocale(), key), { ...style, fontSize: `${Math.round(Math.min(cardW / 8, 34))}px`, fontStyle: 'bold' }).setOrigin(0.5);
        this.add.text(x + cardW / 2, top + cardH * 0.62 + 40, types, { ...style, fontSize: '18px', color: '#cfd8dc' }).setOrigin(0.5);
        this.add
          .text(x + cardW / 2, top + cardH * 0.62 + 72, t('select.startingMove', { move: localName(generated.moves[move]?.names, getLocale(), move) }), { ...style, fontSize: '16px', color: '#cfd8dc' })
          .setOrigin(0.5);
        const manifest = this.manifests.get(key);
        if (manifest) {
          const view = new PokemonSpriteView(this, manifest, spriteRender.playerScale * 2);
          view.sprite.setPosition(x + cardW / 2, top + cardH * 0.32);
          view.play(spriteRender.idleAnimation, 0);
        }
      });
    };
    layout();
    // スプライトは読み込めたものから表示する（取得していなければ名前だけ）
    for (const key of keys) {
      if (this.manifests.has(key)) continue;
      void loadPokemonAtRuntime(this, playablesConfig.pokemon[key]!.sprite).then((loaded) => {
        this.manifests.set(key, loaded?.manifest ?? null);
        if (this.sys.isActive()) layout();
      });
    }
    this.scale.on('resize', layout);
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.repeat) return;
      const n = Number(ev.key);
      if (n >= 1 && n <= keys.length) choose(n - 1);
      else if (ev.key === 'Escape') this.scene.start('title');
    };
    window.addEventListener('keydown', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', layout);
      window.removeEventListener('keydown', onKey);
    });
  }
}
