import Phaser from 'phaser';
import { compactScreen } from '../render/pixelUi';
import { audio } from '../audio';
import { getLocale, LOCALES, setLocale, t } from '../i18n';
import { appendAudioControls } from './audioControls';
import { appendDamageNumbersControl, settingsButtonCss as buttonCss } from './displayControls';

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
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(480px,92vw);max-height:96vh;overflow:auto;padding:24px;background:#000;color:#f8f8f8;border:4px solid #f8f8f8;box-shadow:inset 0 0 0 2px #000,inset 0 0 0 4px #f8f8f8;font-family:inherit;font-size:16px;line-height:1.6;border-radius:6px;z-index:20;box-sizing:border-box;display:flex;flex-direction:column;gap:14px';
    // 低い画面（横向きのスマホ）では余白と間をつめる
    if (compactScreen()) root.style.cssText += ';padding:10px 14px;gap:6px';
    document.body.appendChild(root);
    const title = document.createElement('div');
    title.style.cssText = 'font-size:24px;font-weight:bold';
    title.textContent = t('settings.title');
    root.append(title);

    appendAudioControls(root);

    // 言語（作者の決定 2026年10月22日）: 押すとすぐに切り替え、この画面を作り直す
    const lang = document.createElement('div');
    lang.style.cssText = `display:flex;align-items:center;gap:${compactScreen() ? 6 : 10}px;flex-wrap:wrap`;
    const langLabel = document.createElement('span');
    langLabel.style.cssText = 'width:8em';
    langLabel.textContent = t('settings.language');
    lang.append(langLabel);
    for (const locale of LOCALES) {
      const b = document.createElement('button');
      const selected = locale === getLocale();
      b.style.cssText = buttonCss(selected);
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

    // ダメージの数字（ランのポーズの画面と同じもの）
    appendDamageNumbersControl(root);

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:10px;justify-content:flex-end';
    const test = document.createElement('button');
    test.style.cssText = buttonCss();
    test.textContent = t('settings.test');
    test.onclick = () => audio.sfx.play('candy.hit');
    const back = document.createElement('button');
    back.style.cssText = buttonCss();
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
