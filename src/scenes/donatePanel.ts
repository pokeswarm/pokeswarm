import { uiConfig } from '../data';
import { t } from '../i18n';
import { windowCss } from '../render/pixelUi';

/**
 * 寄付の窓（作者の決定 2026年10月22日。00_vision.md 5章・05_operations.md 3章）: ひとりで作っていること、
 * いただいた支援の使い道（サーバー代・アップデートの開発）、**寄付はゲーム内の有利に一切つながらない**ことを書き、Ko-fi のページを開くボタンを出す。
 * Ko-fi のページの URL は data/render/ui.json の donate.url（空なら「準備中」）
 */
export function openDonatePanel(): void {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:40;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center';
  const box = document.createElement('div');
  box.style.cssText = `${windowCss('dark')};width:min(640px,92vw);max-height:86vh;overflow:auto;padding:20px 24px;font-size:16px;line-height:1.8;box-sizing:border-box;display:flex;flex-direction:column;gap:12px`;
  overlay.append(box);
  const close = (): void => {
    overlay.remove();
    window.removeEventListener('keydown', onKey);
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') close();
  };
  window.addEventListener('keydown', onKey);
  overlay.onpointerdown = (ev) => {
    ev.stopPropagation();
    if (ev.target === overlay) close();
  };
  const title = document.createElement('div');
  title.style.cssText = 'font-size:24px';
  title.textContent = t('donate.title');
  const body = document.createElement('div');
  body.style.cssText = 'white-space:pre-line;overflow-wrap:anywhere';
  body.textContent = t('donate.body');
  const note = document.createElement('div');
  note.style.cssText = 'color:#f8d030;overflow-wrap:anywhere';
  note.textContent = t('donate.noAdvantage');
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap';
  const url = uiConfig.donate.url;
  const go = document.createElement('button');
  go.style.cssText = `${windowCss('light', '#d8a020')};min-height:44px;padding:6px 16px;cursor:pointer;font:inherit;font-size:16px${url ? '' : ';opacity:0.45;cursor:default'}`;
  go.textContent = url ? t('donate.open') : t('donate.notReady');
  go.disabled = !url;
  // 別のタブで開く（ゲームの状態を残すため）
  go.onclick = () => {
    if (url) window.open(url, '_blank', 'noopener');
  };
  const back = document.createElement('button');
  back.style.cssText = `${windowCss('light')};min-height:44px;padding:6px 16px;cursor:pointer;font:inherit;font-size:16px`;
  back.textContent = t('credits.close');
  back.onclick = close;
  row.append(go, back);
  box.append(title, body, note, row);
  document.body.append(overlay);
}
