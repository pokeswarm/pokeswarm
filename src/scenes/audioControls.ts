import { audio } from '../audio';
import { t } from '../i18n';

/**
 * 音量の設定（全体・BGM・効果音のスライダーとミュート）を root に足す。
 * 設定の画面（タイトルの O）と、ランのポーズの画面で同じものを使う
 */
export function appendAudioControls(root: HTMLElement): void {
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
}
