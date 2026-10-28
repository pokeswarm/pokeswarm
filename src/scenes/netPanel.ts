import { t, type MessageKey } from '../i18n';

/**
 * 協力プレイのラン中に出す案内（切断など。簡単な DOM の表示）。
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
      fontFamily: 'inherit', fontSize: '16px', lineHeight: '1.6',
      borderRadius: '8px',
      zIndex: '10',
    });
    document.body.appendChild(this.root);
  }

  /** detail: 2行目に出す文（切断の理由など） */
  show(key: MessageKey, params?: Record<string, string | number>, detail?: string): void {
    this.root.replaceChildren(document.createTextNode(t(key, params)));
    if (detail) {
      const d = document.createElement('div');
      d.style.cssText = 'font-size:13px;opacity:0.85';
      d.textContent = detail;
      this.root.append(d);
    }
    this.root.style.display = 'block';
  }

  hide(): void {
    this.root.style.display = 'none';
  }
}
