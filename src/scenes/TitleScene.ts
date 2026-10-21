import Phaser from 'phaser';
import { firebaseOptionsFromEnv } from '../firebase/config';
import { t } from '../i18n';
import { AccountPanel } from './accountPanel';
import { session } from '../meta/session';
import { audio } from '../audio';
import { bgmConfig, uiConfig } from '../data';
import { drawWindow, pixelButton, px } from '../render/pixelUi';

/**
 * タイトル画面（ドット調。作者の決定 2026年10月22日）。各画面へのボタンを並べる。
 * クリックのほか、↑↓ で選んで Enter（原作のメニューと同じ ▶ のカーソル）。前のキー（C・F・A・S・O）もそのまま使える。
 * 下にログインの状態と記録を出す
 */
export class TitleScene extends Phaser.Scene {
  constructor() {
    super('title');
  }

  create(): void {
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
      this.children.removeAll(true);
      const { width, height } = this.scale;
      // ロゴ: 黒い窓に大きなドットの文字
      const logoW = Math.min(width - 32, 640);
      const g = this.add.graphics();
      drawWindow(g, (width - logoW) / 2, height * 0.08, logoW, 136, 'dark');
      this.add.text(width / 2, height * 0.08 + 52, t('title.name'), px(width >= 640 ? 48 : 32, '#f8d030', { outline: true })).setOrigin(0.5);
      this.add.text(width / 2, height * 0.08 + 108, t('title.subtitle'), px(16, uiConfig.dark.text)).setOrigin(0.5);
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
