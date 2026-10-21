import Phaser from 'phaser';
import { audio } from '../audio';
import { t } from '../i18n';

const BUTTON = 'padding:8px 14px;border-radius:8px;cursor:pointer;font:inherit;border:2px solid #4a7a4a;background:#162416;color:#fff';

/**
 * 設定（DOM）: 全体・BGM・効果音の音量とミュート（07_content_draft.md 14.4）。ブラウザに保存する。
 * タイトルの O で開き、Esc か「もどる」でタイトルへ
 */
export class SettingsScene extends Phaser.Scene {
  constructor() {
    super('settings');
  }

  create(): void {
    const root = document.createElement('div');
    root.style.cssText =
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(480px,92vw);padding:24px;background:rgba(8,14,8,0.94);color:#fff;font:16px/1.6 sans-serif;border-radius:14px;z-index:20;box-sizing:border-box;display:flex;flex-direction:column;gap:14px';
    document.body.appendChild(root);
    const title = document.createElement('div');
    title.style.cssText = 'font-size:24px;font-weight:bold';
    title.textContent = t('settings.title');
    root.append(title);

    const slider = (label: string, key: 'master' | 'bgm' | 'sfx'): void => {
      const row = document.createElement('label');
      row.style.cssText = 'display:grid;grid-template-columns:8em 1fr 3em;align-items:center;gap:10px';
      const name = document.createElement('span');
      name.textContent = label;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.value = String(Math.round(audio.settings.current[key] * 100));
      const value = document.createElement('span');
      value.textContent = input.value;
      input.oninput = () => {
        value.textContent = input.value;
        audio.settings.update({ [key]: Number(input.value) / 100 });
      };
      // 効果音の音量を変えたら、その大きさで鳴らして確かめられるように
      if (key !== 'bgm') input.onchange = () => audio.sfx.play('levelUp');
      row.append(name, input, value);
      root.append(row);
    };
    slider(t('settings.master'), 'master');
    slider(t('settings.bgm'), 'bgm');
    slider(t('settings.sfx'), 'sfx');

    const mute = document.createElement('label');
    mute.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = audio.settings.current.muted;
    box.onchange = () => audio.settings.update({ muted: box.checked });
    const muteText = document.createElement('span');
    muteText.textContent = t('settings.muted');
    mute.append(box, muteText);
    root.append(mute);

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:10px;justify-content:flex-end';
    const test = document.createElement('button');
    test.style.cssText = BUTTON;
    test.textContent = t('settings.test');
    test.onclick = () => audio.sfx.play('candy.hit');
    const back = document.createElement('button');
    back.style.cssText = BUTTON;
    back.textContent = t('settings.back');
    const leave = (): void => {
      audio.sfx.play('ui.select');
      this.scene.start('title');
    };
    back.onclick = leave;
    buttons.append(test, back);
    root.append(buttons);

    this.input.keyboard?.once('keydown-ESC', leave);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => root.remove());
  }
}
