import { siteConfig } from '../data';
import { t } from '../i18n';
import { isOfficialHost } from '../meta/officialSite';
import { windowCss } from './pixelUi';

export type SiteProblem = 'framed' | 'unofficial';

/**
 * 公式のページで遊ばれているかを確かめる（作者の相談 2026年10月22日。広告付きのページへの埋め込み・丸ごとコピーへの対策）。
 * - framed: ほかのページの枠（iframe）の中で開かれている。配信のヘッダー（public/_headers）で止まらなかったときの保険
 * - unofficial: 公式以外のアドレスで動いている（ファイルを丸ごとコピーして配っている）
 * 開発中（npm run dev）は確かめない（スマホの実機確認で LAN のアドレスを使うため）
 */
export function checkSite(location: Pick<Location, 'hostname'> = window.location): SiteProblem | null {
  if (isFramed()) return 'framed';
  if (import.meta.env.DEV) return null;
  return isOfficialHost(location.hostname, siteConfig) ? null : 'unofficial';
}

function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // ほかのサイトの枠の中では、上のページを読めずに例外になる
    return true;
  }
}

/** ゲームを始めずに、公式サイトで遊ぶよう案内する */
export function showSiteGuard(problem: SiteProblem): void {
  const root = document.createElement('div');
  root.style.cssText = 'position:fixed;inset:0;z-index:50;background:#000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  const box = document.createElement('div');
  box.style.cssText = `${windowCss('dark')};width:min(640px,92vw);padding:20px 24px;font-size:16px;line-height:1.8;box-sizing:border-box;display:flex;flex-direction:column;gap:12px`;
  const title = document.createElement('div');
  title.style.fontSize = '24px';
  title.textContent = t('guard.title');
  const body = document.createElement('div');
  body.style.cssText = 'white-space:pre-line;overflow-wrap:anywhere';
  body.textContent = t(problem === 'framed' ? 'guard.framed' : 'guard.unofficial', { url: siteConfig.officialUrl });
  const link = document.createElement('a');
  link.href = siteConfig.officialUrl;
  // 枠の中からでも、新しいタブで公式サイトを開く
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = t('guard.open');
  link.style.cssText = `${windowCss('light')};align-self:flex-end;padding:8px 16px;text-decoration:none;font-size:16px`;
  box.append(title, body, link);
  root.append(box);
  document.body.append(root);
}
