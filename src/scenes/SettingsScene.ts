import Phaser from 'phaser';
import { audio } from '../audio';
import { getLocale, LOCALES, setLocale, t } from '../i18n';

// 原作をまねた白い窓のボタン（作者の決定。2026年10月22日。src/render/pixelUi.ts の windowCss と同じ見た目）
const BUTTON = 'min-height:44px;padding:8px 14px;cursor:pointer;font:inherit;font-size:16px;background:#f8f8f8;color:#383848;border:4px solid #383848;border-radius:6px;box-shadow:inset 0 0 0 3px #f8f8f8,inset 0 0 0 5px #a8b8c8';

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
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(480px,92vw);padding:24px;background:#000;color:#f8f8f8;border:4px solid #f8f8f8;box-shadow:inset 0 0 0 2px #000,inset 0 0 0 4px #f8f8f8;font-family:inherit;font-size:16px;line-height:1.6;border-radius:6px;z-index:20;box-sizing:border-box;display:flex;flex-direction:column;gap:14px';
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

    // 言語（作者の決定 2026年10月22日）: 押すとすぐに切り替え、この画面を作り直す
    const lang = document.createElement('div');
    lang.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap';
    const langLabel = document.createElement('span');
    langLabel.style.cssText = 'width:8em';
    langLabel.textContent = t('settings.language');
    lang.append(langLabel);
    for (const locale of LOCALES) {
      const b = document.createElement('button');
      const selected = locale === getLocale();
      b.style.cssText = BUTTON + (selected ? ';border-color:#d8a020;box-shadow:inset 0 0 0 3px #f8f8f8,inset 0 0 0 5px #d8a020' : '');
      // 言語の名前は、その言語自身の書き方で（どの言語を選んでいても読めるように）
      b.textContent = t(`settings.language.${locale}`);
      b.onclick = () => {
        if (locale === getLocale()) return;
        setLocale(locale);
        audio.sfx.play('ui.select');
        this.scene.restart();
      };
      lang.append(b);
    }
    root.append(lang);

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
