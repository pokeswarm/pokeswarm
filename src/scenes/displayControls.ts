import { audio } from '../audio';
import { t } from '../i18n';
import { compactScreen } from '../render/pixelUi';
import { displaySettings } from '../render/displaySettings';

// 原作をまねた白い窓のボタン（作者の決定。2026年10月22日。src/render/pixelUi.ts の windowCss と同じ見た目）
// 低い画面（横向きのスマホ）では低く・細く
const BUTTON_BASE = 'cursor:pointer;font:inherit;font-size:16px;background:#f8f8f8;color:#383848;border:4px solid #383848;border-radius:6px;box-shadow:inset 0 0 0 3px #f8f8f8,inset 0 0 0 5px #a8b8c8';
const SELECTED = ';border-color:#d8a020;box-shadow:inset 0 0 0 3px #f8f8f8,inset 0 0 0 5px #d8a020';
export const settingsButtonCss = (selected = false): string =>
  (compactScreen() ? 'min-height:36px;padding:2px 10px;' : 'min-height:44px;padding:8px 14px;') + BUTTON_BASE + (selected ? SELECTED : '');

/**
 * ダメージの数字の 出す・出さない（作者の決定 2026年10月28日: 初めは出さない。07 の102章）を root に足す。
 * 設定の画面（タイトルの O）と、ランのポーズの画面（Esc。07 の110章）で同じものを使う。onChange は切り替えたとき（ランの画面ですぐ効かせる）
 */
export function appendDamageNumbersControl(root: HTMLElement, onChange?: (on: boolean) => void): void {
  const row = document.createElement('div');
  row.style.cssText = `display:flex;align-items:center;gap:${compactScreen() ? 6 : 10}px;flex-wrap:wrap`;
  const label = document.createElement('span');
  label.style.cssText = 'width:8em';
  label.textContent = t('settings.damageNumbers');
  row.append(label);
  const buttons = ([true, false] as const).map((on) => {
    const b = document.createElement('button');
    b.textContent = t(on ? 'settings.damageNumbers.on' : 'settings.damageNumbers.off');
    b.onclick = () => {
      if (displaySettings.current.damageNumbers === on) return;
      displaySettings.update({ damageNumbers: on });
      audio.sfx.play('ui.select');
      paint();
      onChange?.(on);
    };
    row.append(b);
    return { b, on };
  });
  const paint = (): void => {
    for (const { b, on } of buttons) b.style.cssText = settingsButtonCss(displaySettings.current.damageNumbers === on);
  };
  paint();
  root.append(row);
}
