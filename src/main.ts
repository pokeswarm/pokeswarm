import Phaser from 'phaser';
import { placeholderRender } from './data';
import { RunScene } from './scenes/RunScene';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: placeholderRender.backgroundColor,
  // ドット絵向け（ニアレストネイバー）の拡大
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%',
  },
  scene: [RunScene],
});
