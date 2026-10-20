import { t, type MessageKey } from '../i18n';

/**
 * 協力プレイの接続中に出す案内（技術検証用の簡単な DOM の表示）。
 * 参加用 URL をコピーできるよう、Phaser の画面ではなく HTML で出す。
 */
export class NetPanel {
  private readonly root: HTMLDivElement;

  constructor() {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'fixed',
      left: '50%',
      top: '40%',
      transform: 'translate(-50%, -50%)',
      maxWidth: '90vw',
      padding: '16px 20px',
      background: 'rgba(0,0,0,0.85)',
      color: '#fff',
      font: '14px/1.6 sans-serif',
      borderRadius: '8px',
      zIndex: '10',
    });
    document.body.appendChild(this.root);
  }

  show(key: MessageKey, params?: Record<string, string | number>): void {
    this.root.replaceChildren(document.createTextNode(t(key, params)));
    this.root.style.display = 'block';
  }

  /** 参加用 URL とコピーのボタンを出す */
  showJoinUrl(url: string): void {
    const text = document.createElement('div');
    text.textContent = t('net.waitingGuest');
    const link = document.createElement('input');
    Object.assign(link, { value: url, readOnly: true });
    Object.assign(link.style, { width: '100%', margin: '8px 0', font: '14px monospace' });
    const button = document.createElement('button');
    button.textContent = t('net.copy');
    button.onclick = () => {
      void navigator.clipboard.writeText(url).then(() => (button.textContent = t('net.copied')));
    };
    this.root.replaceChildren(text, link, button);
    this.root.style.display = 'block';
  }

  hide(): void {
    this.root.style.display = 'none';
  }
}
