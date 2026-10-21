import Phaser from 'phaser';
import { firebaseOptionsFromEnv } from '../firebase/config';
import { t } from '../i18n';
import { AccountPanel } from './accountPanel';
import { session } from '../meta/session';
import { audio } from '../audio';
import { bgmConfig, generated, groundConfig, iconConfig, itemIcons, playablesConfig, spriteRender, uiConfig } from '../data';
import { buildSimRules } from '../data/simRules';
import type { SpriteAnims } from '../data/schema';
import { FilmStrip, type FilmEntry } from '../render/FilmStrip';
import { GroundTiles, preloadGroundTiles } from '../render/GroundTiles';
import { ensureIconTextures, itemIconKey } from '../render/Icons';
import { drawWindow, pixelButton, px } from '../render/pixelUi';
import { directionIndex, PokemonSpriteView } from '../render/sprites/PokemonSprite';
import { loadPokemonAtRuntime } from '../render/sprites/runtimeLoad';

/**
 * タイトル画面（ドット調。作者の決定 2026年10月22日）。各画面へのボタンを並べる。
 * クリックのほか、↑↓ で選んで Enter（原作のメニューと同じ ▶ のカーソル）。前のキー（C・F・A・S・O）もそのまま使える。
 * 下にログインの状態と記録を出す
 */
export class TitleScene extends Phaser.Scene {
  constructor() {
    super('title');
  }

  preload(): void {
    preloadGroundTiles(this, groundConfig);
  }

  /**
   * 背景: ゲームのマップ（ゆっくり流れる）と、映写機のフィルムのように交差して流れるたくさんの帯（作者の案 2026年10月22日）。
   * 帯には、実装予定の遊べるポケモンすべて（進化の途中・進化先も。流れる向きへ歩く姿）と、持ち物のアイコンが流れる。
   * ポケモンは読み込めたものから帯に加わる（読み込みを待たずに始める）
   */
  private createBackdrop(): { update: (deltaMs: number) => void; layout: () => void } {
    const ground = new GroundTiles(this, groundConfig, 0);
    const shade = this.add.rectangle(0, 0, 10, 10, 0x000000, 0.35).setOrigin(0).setDepth(-500);
    const film = uiConfig.titleFilm;
    const rules = buildSimRules();
    ensureIconTextures(this, iconConfig, rules, itemIcons);
    const items = rules.items.map((_, i) => itemIconKey(rules, i));
    const pokemon: SpriteAnims[] = [];
    // 帯ごとに、ポケモンと持ち物を順にずらして出す（同じ並びが重ならないように）
    const strips = film.strips.map((cfg, k) => {
      let n = k * 5;
      const next = (): FilmEntry | null => {
        n++;
        if (pokemon.length === 0 || n % film.itemEvery === 0) return { texture: items[(n * 7 + k) % items.length]!, scale: film.itemScale };
        const m = pokemon[(n * 3 + k * 11) % pokemon.length]!;
        const dirX = cfg.speed < 0 ? -1 : 1;
        return {
          make: (scene) => {
            const v = new PokemonSpriteView(scene, m, film.pokemonScale);
            v.play(spriteRender.walkAnimation, directionIndex(dirX, 0));
            // 大きなポケモン（コマの絵が大きい）は小さく、小さなポケモンは大きく描いて、だいたい同じ大きさでコマに収める
            v.sprite.setScale(Math.max(1, Math.round(((film.pokemonScale * film.pokemonFrame) / Math.max(1, v.sprite.height)) * 2) / 2));
            return v.sprite;
          },
        };
      };
      return new FilmStrip(this, next, { ...cfg, cell: film.cell, height: film.height, depth: -100 + k, alpha: film.alpha });
    });
    let camX = 0;
    let camY = 0;
    const layout = (): void => {
      shade.setSize(this.scale.width, this.scale.height);
      for (const st of strips) st.layout();
    };
    layout();
    // 遊べるポケモンと、その進化の途中・進化先（進化しない遊べるポケモンは、その姿だけ）
    const keys = new Set<string>();
    for (const [key, p] of Object.entries(playablesConfig.pokemon)) {
      const stack = [key];
      while (stack.length) {
        const k = stack.pop()!;
        if (keys.has(k) || !generated.pokemon[k]) continue;
        keys.add(k);
        if (p.evolves !== false) for (const e of generated.pokemon[k]!.evolvesTo) stack.push(e.to);
      }
    }
    // 全部読み込めたら、帯のコマを入れ直す（それまでは、流れてきたコマから順にポケモンが加わる）
    void Promise.all(
      [...keys].map((k) =>
        loadPokemonAtRuntime(this, k).then((r) => {
          if (r && this.sys.isActive()) pokemon.push(r.manifest);
        }),
      ),
    ).then(() => {
      if (this.sys.isActive()) layout();
    });
    return {
      layout,
      update: (deltaMs) => {
        // マップはゆっくり斜めに流す（カメラを動かすと上のメニューも動くので、模様だけずらす）
        camX += (deltaMs / 1000) * 24;
        camY += (deltaMs / 1000) * 12;
        ground.update({ scrollX: camX, scrollY: camY } as Phaser.Cameras.Scene2D.Camera, 0, deltaMs);
        for (const st of strips) st.update(deltaMs);
      },
    };
  }

  create(): void {
    const backdrop = this.createBackdrop();
    const onUpdate = (_t: number, delta: number): void => backdrop.update(delta);
    this.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.UPDATE, onUpdate));
    let ui: Phaser.GameObjects.Container | null = null;
    const coop = !!firebaseOptionsFromEnv();
    const items: { label: string; key: string | null; go: () => void }[] = [
      { label: t('title.menu.start'), key: null, go: () => this.scene.start('select') },
      ...(coop ? [{ label: t('title.menu.coop'), key: 'C', go: () => this.scene.start('lobby', { mode: 'host' }) }] : []),
      ...(coop ? [{ label: t('title.menu.friends'), key: 'F', go: () => this.scene.start('friends') }] : []),
      { label: t('title.menu.achievements'), key: 'A', go: () => this.scene.start('achievements') },
      { label: t('title.menu.shop'), key: 'S', go: () => this.scene.start('shop') },
      { label: t('title.menu.settings'), key: 'O', go: () => this.scene.start('settings') },
    ];
    let selected = 0;
    let buttons: Phaser.GameObjects.Container[] = [];
    let leaving = false;
    const go = (i: number): void => {
      if (leaving) return;
      leaving = true;
      items[i]!.go();
    };
    const showCursor = (): void => buttons.forEach((b, i) => (b.list[2] as Phaser.GameObjects.Text).setVisible(i === selected));
    const layout = (): void => {
      // メニューとタイトルだけを作り直す（背景のマップとフィルムは残す）
      ui?.destroy();
      ui = this.add.container(0, 0).setDepth(10);
      backdrop.layout();
      const { width, height } = this.scale;
      // ロゴ: 黒い窓に大きなドットの文字
      const logoW = Math.min(width - 32, 640);
      const g = this.add.graphics();
      drawWindow(g, (width - logoW) / 2, height * 0.08, logoW, 136, 'dark');
      ui.add([
        g,
        this.add.text(width / 2, height * 0.08 + 52, t('title.name'), px(width >= 640 ? 48 : 32, '#f8d030', { outline: true })).setOrigin(0.5),
        this.add.text(width / 2, height * 0.08 + 108, t('title.subtitle'), px(16, uiConfig.dark.text)).setOrigin(0.5),
      ]);
      // メニュー。狭い画面では左に寄せる（右下のログインの窓と重ならないように）
      const bw = Math.min(width - 32, 360);
      const bh = height < 700 ? 40 : 48;
      const gap = height < 700 ? 6 : 8;
      const top = height * 0.08 + 136 + (height < 700 ? 16 : 32);
      const mx = width >= 1100 ? width / 2 : Math.min(width / 2, 16 + bw / 2);
      buttons = items.map((it, i) =>
        pixelButton(this, mx, top + bh / 2 + i * (bh + gap), bw, bh, it.label, () => go(i)).on('pointerover', () => {
          selected = i;
          showCursor();
        }),
      );
      ui.add(buttons);
      showCursor();
    };
    layout();
    this.scale.on('resize', layout);
    const account = new AccountPanel();
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.repeat || leaving) return;
      if (ev.key === 'ArrowDown') {
        selected = (selected + 1) % items.length;
        audio.sfx.play('ui.select');
        showCursor();
      } else if (ev.key === 'ArrowUp') {
        selected = (selected + items.length - 1) % items.length;
        audio.sfx.play('ui.select');
        showCursor();
      } else if (ev.key === 'Enter' || ev.key === ' ') {
        go(selected);
      } else {
        const i = items.findIndex((it) => it.key !== null && it.key === ev.key.toUpperCase());
        if (i !== -1) go(i);
      }
    };
    window.addEventListener('keydown', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', layout);
      window.removeEventListener('keydown', onKey);
      account.destroy();
    });
    audio.bgm.play(bgmConfig.scenes.title);
    session.setPresence('menu');
  }
}
