import Phaser from 'phaser';
import { placeholderRender, spriteRender } from './data';
import { loadSpriteManifest } from './render/sprites/spriteManifest';
import { RunScene, type RunSceneData } from './scenes/RunScene';

async function start(): Promise<void> {
  const data: RunSceneData = { playerSprite: await loadSpriteManifest(spriteRender.playerSprite) };
  const game = new Phaser.Game({
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
  });
  game.scene.add('run', RunScene, true, data);
}

void start();
