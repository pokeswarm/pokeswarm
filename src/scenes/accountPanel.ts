import { t, tMaybe } from '../i18n';
import type { SaveData } from '../meta/saveData';
import { formatTag } from '../meta/nickname';
import { session } from '../meta/session';
import { windowCss, compactScreen } from '../render/pixelUi';
import { openTransferPanel } from './transferPanel';

/** ドット調のボタン（原作をまねた白い窓。作者の決定 2026年10月22日） */
const BUTTON = `${windowCss('light')};min-height:44px;padding:8px 16px;cursor:pointer;font:inherit;font-size:16px`;

/** 記録の短いまとめ（タイトル画面と、データを選ぶ画面に出す） */
export function saveSummary(d: Readonly<SaveData>): string {
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

  /** ボタンの高さ（タイトルのメニューのボタンにそろえる） */
  private buttonHeight = 44;

  constructor() {
    this.root = document.createElement('div');
    // 黒い窓。置く場所はタイトル画面が決める（place）
    this.root.style.cssText = `${windowCss('dark')};position:fixed;padding:${compactScreen() ? '6px 10px' : '12px 16px'};font-size:16px;line-height:1.5;text-align:left;z-index:20;overflow-wrap:anywhere;overflow:auto;box-sizing:border-box;display:flex;flex-direction:column;gap:6px`;
    document.body.appendChild(this.root);
    this.unsubscribe.push(session.onStatus(() => this.render()), session.store.onChange(() => this.render()));
    this.render();
  }

  /** タイトル画面の配置にそろえて置く（left・top・width は画面の px、bottom は画面の下から空ける高さ） */
  place(r: { left: number; top: number; width: number; bottom: number; buttonHeight: number }): void {
    Object.assign(this.root.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, maxHeight: `calc(100vh - ${r.top + r.bottom}px)` });
    if (r.buttonHeight !== this.buttonHeight) {
      this.buttonHeight = r.buttonHeight;
      this.render();
    }
  }

  destroy(): void {
    for (const fn of this.unsubscribe) fn();
    this.root.remove();
  }

  private render(): void {
    const status = document.createElement('div');
    // 低い画面では短い文（無ければふつうの文）
    status.textContent = (compactScreen() && tMaybe(`account.statusShort.${session.status}`)) || t(`account.status.${session.status}`);
    const profile = session.social?.profile;
    if (profile) status.textContent += `　${formatTag(profile.nickname, profile.tag)}`;
    const record = document.createElement('div');
    record.style.cssText = 'opacity:0.85;font-size:16px';
    record.textContent = saveSummary(session.store.current);
    const children: HTMLElement[] = [status, record];
    if (session.error) {
      const err = document.createElement('div');
      err.style.cssText = 'color:#f87878;font-size:16px';
      err.textContent = t('account.error', { message: session.error === 'save-read-failed' ? t('account.loadFailed') : session.error });
      children.push(err);
    }
    if (session.status === 'guest' || session.status === 'google') {
      const button = document.createElement('button');
      // ボタンは窓の幅いっぱいで縦に並べ、高さはメニューのボタンにそろえる
      const fitted = `${windowCss('light')};width:100%;height:${this.buttonHeight}px;padding:0 12px;cursor:pointer;font:inherit;font-size:16px;flex:none`;
      button.style.cssText = fitted;
      button.textContent = t(session.status === 'guest' ? 'account.signIn' : 'account.signOut');
      button.disabled = this.busy;
      // タイトル画面のクリックで始まらないように止める
      button.onpointerdown = (ev) => ev.stopPropagation();
      button.onclick = (ev) => {
        ev.stopPropagation();
        if (session.status === 'google') {
          void this.run(() => session.signOut());
          return;
        }
        // 先に、Google から何が届き、ゲームでどう扱うかを見せる（作者の決定 2026年10月22日）
        confirmSignIn(() => void this.run(() => session.signInWithGoogle(chooseSave)));
      };
      if (session.status === 'guest') {
        // ゲストは、メールアドレスなしで別のブラウザへデータを移せる（引き継ぎコード）
        const transfer = document.createElement('button');
        transfer.style.cssText = fitted;
        transfer.textContent = t('transfer.open');
        transfer.onpointerdown = (ev) => ev.stopPropagation();
        transfer.onclick = (ev) => {
          ev.stopPropagation();
          openTransferPanel();
        };
        children.push(button, transfer);
      } else {
        children.push(button);
      }
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

/**
 * Google でログインする前の説明（作者の決定 2026年10月22日）。Google の画面には「名前・メールアドレス・プロフィール写真を共有」と出るが、
 * これはログインの仕組み（Firebase）の決まりで外せない。ゲームでは使わず、保存も表示もしないことを先に伝え、ログインするかを選んでもらう。
 * 「ログインする」を押したときにそのまま Google の窓を開く（ブラウザは、押した操作の中でないと窓を開かせないため）
 */
function confirmSignIn(go: () => void): void {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:30;padding:16px;box-sizing:border-box';
  const box = document.createElement('div');
  box.style.cssText = `${windowCss('dark')};padding:20px 24px;width:min(640px,92vw);max-height:90vh;overflow:auto;font-size:16px;line-height:1.7;box-sizing:border-box;display:flex;flex-direction:column;gap:12px`;
  const title = document.createElement('div');
  title.style.fontSize = '24px';
  title.textContent = t('account.signInTitle');
  const body = document.createElement('div');
  body.style.cssText = 'white-space:pre-line;overflow-wrap:anywhere';
  body.textContent = t('account.signInBody');
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap';
  const close = (): void => {
    overlay.remove();
    window.removeEventListener('keydown', onKey);
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') close();
  };
  window.addEventListener('keydown', onKey);
  const ok = document.createElement('button');
  ok.style.cssText = BUTTON;
  ok.textContent = t('account.signInGo');
  ok.onclick = () => {
    close();
    go();
  };
  const cancel = document.createElement('button');
  cancel.style.cssText = BUTTON;
  cancel.textContent = t('account.signInCancel');
  cancel.onclick = close;
  // タイトル画面のクリックで先へ進まないように止める
  overlay.onpointerdown = (ev) => {
    ev.stopPropagation();
    if (ev.target === overlay) close();
  };
  row.append(ok, cancel);
  box.append(title, body, row);
  overlay.append(box);
  document.body.append(overlay);
}

/** ゲストのデータと Google のデータが両方あるとき、どちらを残すかを選ぶ画面 */
function chooseSave(guest: Readonly<SaveData>, google: Readonly<SaveData>): Promise<'guest' | 'google'> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:30;color:#fff;font-family:inherit;font-size:16px;line-height:1.6';
    const box = document.createElement('div');
    box.style.cssText = `${windowCss('dark')};padding:24px;max-width:720px;width:90vw;text-align:center`;
    const title = document.createElement('div');
    title.style.cssText = 'font-size:24px';
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
      name.style.cssText = 'font-size:16px';
      name.textContent = label;
      const when = document.createElement('div');
      when.textContent = t('account.updatedAt', { date: new Date(d.updatedAt).toLocaleString() });
      const rec = document.createElement('div');
      rec.textContent = saveSummary(d);
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
