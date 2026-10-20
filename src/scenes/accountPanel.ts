import { t } from '../i18n';
import type { SaveData } from '../meta/saveData';
import { formatTag } from '../meta/nickname';
import { session } from '../meta/session';

const BUTTON = 'padding:8px 16px;border-radius:8px;cursor:pointer;font:inherit;border:1px solid #4a7a4a;background:#162416;color:#fff';

/** 記録の短いまとめ（タイトル画面と、データを選ぶ画面に出す） */
function summary(d: Readonly<SaveData>): string {
  return t('account.record', {
    runs: d.stats.runs ?? 0,
    clears: d.stats.clears ?? 0,
    kills: d.stats.kills ?? 0,
    coins: d.coins,
  });
}

/**
 * タイトル画面の下に出すログインの状態（DOM。見た目の作り込みはフェーズ4）。
 * ゲストなら「Google でログイン」、Google なら「ログアウト」のボタンを出す。
 */
export class AccountPanel {
  private readonly root: HTMLDivElement;
  private readonly unsubscribe: (() => void)[] = [];
  private busy = false;

  constructor() {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'fixed',
      left: '50%',
      bottom: '24px',
      transform: 'translateX(-50%)',
      padding: '12px 18px',
      background: 'rgba(8,14,8,0.85)',
      color: '#fff',
      font: '15px/1.6 sans-serif',
      borderRadius: '10px',
      textAlign: 'center',
      zIndex: '20',
      maxWidth: '90vw',
    });
    document.body.appendChild(this.root);
    this.unsubscribe.push(session.onStatus(() => this.render()), session.store.onChange(() => this.render()));
    this.render();
  }

  destroy(): void {
    for (const fn of this.unsubscribe) fn();
    this.root.remove();
  }

  private render(): void {
    const status = document.createElement('div');
    status.textContent = t(`account.status.${session.status}`);
    const profile = session.social?.profile;
    if (profile) status.textContent += `　${formatTag(profile.nickname, profile.tag)}`;
    const record = document.createElement('div');
    record.style.cssText = 'opacity:0.8;font-size:14px';
    record.textContent = summary(session.store.current);
    const children: HTMLElement[] = [status, record];
    if (session.error) {
      const err = document.createElement('div');
      err.style.cssText = 'color:#ef9a9a;font-size:13px';
      err.textContent = t('account.error', { message: session.error === 'save-read-failed' ? t('account.loadFailed') : session.error });
      children.push(err);
    }
    if (session.status === 'guest' || session.status === 'google') {
      const button = document.createElement('button');
      button.style.cssText = BUTTON + ';margin-top:8px';
      button.textContent = t(session.status === 'guest' ? 'account.signIn' : 'account.signOut');
      button.disabled = this.busy;
      // タイトル画面のクリックで始まらないように止める
      button.onpointerdown = (ev) => ev.stopPropagation();
      button.onclick = (ev) => {
        ev.stopPropagation();
        void this.run(() => (session.status === 'guest' ? session.signInWithGoogle(chooseSave) : session.signOut()));
      };
      children.push(button);
    }
    this.root.replaceChildren(...children);
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this.busy = true;
    this.render();
    try {
      await fn();
    } finally {
      this.busy = false;
      this.render();
    }
  }
}

/** ゲストのデータと Google のデータが両方あるとき、どちらを残すかを選ぶ画面 */
function chooseSave(guest: Readonly<SaveData>, google: Readonly<SaveData>): Promise<'guest' | 'google'> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:30;color:#fff;font:16px/1.6 sans-serif';
    const box = document.createElement('div');
    box.style.cssText = 'background:#0f1a0f;border:2px solid #4a7a4a;border-radius:14px;padding:24px;max-width:720px;width:90vw;text-align:center';
    const title = document.createElement('div');
    title.style.cssText = 'font-size:22px;font-weight:bold';
    title.textContent = t('account.chooseTitle');
    const hint = document.createElement('div');
    hint.style.cssText = 'opacity:0.8;margin-bottom:16px';
    hint.textContent = t('account.chooseHint');
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:16px';
    const option = (label: string, d: Readonly<SaveData>, value: 'guest' | 'google'): HTMLButtonElement => {
      const b = document.createElement('button');
      b.style.cssText = BUTTON + ';flex:1;padding:16px;text-align:left;line-height:1.7';
      const name = document.createElement('div');
      name.style.cssText = 'font-weight:bold;font-size:18px';
      name.textContent = label;
      const when = document.createElement('div');
      when.textContent = t('account.updatedAt', { date: new Date(d.updatedAt).toLocaleString() });
      const rec = document.createElement('div');
      rec.textContent = summary(d);
      b.append(name, when, rec);
      b.onclick = () => {
        overlay.remove();
        resolve(value);
      };
      return b;
    };
    row.append(option(t('account.guestData'), guest, 'guest'), option(t('account.googleData'), google, 'google'));
    box.append(title, hint, row);
    overlay.append(box);
    document.body.append(overlay);
  });
}
