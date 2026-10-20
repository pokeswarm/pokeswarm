import Phaser from 'phaser';
import { t } from '../i18n';

/** タイトル画面（見た目の作り込みはフェーズ4）。Enter かクリックでポケモン選択へ */
export class TitleScene extends Phaser.Scene {
  constructor() {
    super('title');
  }

  create(): void {
    const layout = (): void => {
      this.children.removeAll(true);
      const { width, height } = this.scale;
      this.add
        .text(width / 2, height * 0.38, t('title.name'), { fontFamily: 'sans-serif', fontSize: `${Math.round(Math.min(width / 8, 96))}px`, fontStyle: 'bold', color: '#ffe082' })
        .setOrigin(0.5);
      this.add.text(width / 2, height * 0.38 + 70, t('title.subtitle'), { fontFamily: 'sans-serif', fontSize: '18px', color: '#cfd8dc' }).setOrigin(0.5);
      const start = this.add.text(width / 2, height * 0.7, t('title.start'), { fontFamily: 'sans-serif', fontSize: '24px', color: '#ffffff' }).setOrigin(0.5);
      this.tweens.add({ targets: start, alpha: 0.3, duration: 700, yoyo: true, repeat: -1 });
    };
    layout();
    this.scale.on('resize', layout);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off('resize', layout));
    const go = (): void => {
      this.scene.start('select');
    };
    this.input.keyboard?.once('keydown-ENTER', go);
    this.input.keyboard?.once('keydown-SPACE', go);
    this.input.once('pointerdown', go);
  }
}
