import { bgmConfig, sfxConfig } from '../data';
import { BgmPlayer } from './bgm';
import { AudioSettingsStore } from './settings';
import { Synth } from './synth';

/**
 * 音（効果音・BGM・音量の設定）の入り口。画面から `audio.sfx.play('levelUp')`・`audio.bgm.play('title')` のように使う。
 * シミュレーション（src/sim）からは使わない（出来事を見て画面の側で鳴らす）。
 */
export const audio = {
  settings: new AudioSettingsStore(),
  sfx: new Synth(sfxConfig),
  bgm: new BgmPlayer(bgmConfig),
};

function applyVolume(): void {
  audio.sfx.setVolume(audio.settings.volumeOf('sfx'));
  audio.bgm.setVolume(audio.settings.volumeOf('bgm'));
}

/** 最初のクリックかキーで音を鳴らせるようにする（ブラウザの決まり） */
export function installAudioUnlock(): void {
  audio.settings.onChange(applyVolume);
  const unlock = (): void => {
    audio.sfx.unlock();
    audio.bgm.unlock();
    applyVolume();
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}
