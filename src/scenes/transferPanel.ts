import { saveConfig } from '../data';
import { t } from '../i18n';
import type { SaveData } from '../meta/saveData';
import { session } from '../meta/session';
import { formatTransferCode, normalizeTransferCode } from '../meta/transferCode';
import { windowCss } from '../render/pixelUi';
import { saveSummary } from './accountPanel';

const BUTTON = `${windowCss('light')};min-height:44px;padding:8px 16px;cursor:pointer;font:inherit;font-size:16px`;

function overlayBox(z: number): { overlay: HTMLDivElement; box: HTMLDivElement } {
  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:${z};padding:16px;box-sizing:border-box`;
  // タイトル画面のクリックで先へ進まないように止める
  overlay.onpointerdown = (ev) => ev.stopPropagation();
  const box = document.createElement('div');
  box.style.cssText = `${windowCss('dark')};padding:20px 24px;width:min(640px,92vw);max-height:90vh;overflow:auto;font-size:16px;line-height:1.7;box-sizing:border-box;display:flex;flex-direction:column;gap:12px;overflow-wrap:anywhere`;
  overlay.append(box);
  return { overlay, box };
}

function div(text: string, css = ''): HTMLDivElement {
  const d = document.createElement('div');
  d.style.cssText = css;
  d.textContent = text;
  return d;
}

/**
 * 引き継ぎコードの窓（作者の決定 2026年10月22日。ゲストだけ）。メールアドレスなしで、別のブラウザ・PC へデータを移す。
 * 発行: 今のデータの写しをコードで置く（24時間・1回きり。このブラウザのデータはそのまま）。受け取り: コードを入れ、確かめてから今のデータを置き換える
 */
export function openTransferPanel(): void {
  const { overlay, box } = overlayBox(30);
  const close = (): void => {
    overlay.remove();
    window.removeEventListener('keydown', onKey);
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') close();
  };
  window.addEventListener('keydown', onKey);

  // 発行
  const issued = document.createElement('div');
  issued.style.cssText = 'display:flex;flex-direction:column;gap:6px';
  const issue = document.createElement('button');
  issue.style.cssText = BUTTON + ';align-self:flex-start';
  issue.textContent = t('transfer.issue');
  issue.onclick = async () => {
    issue.disabled = true;
    issued.replaceChildren(div(t('transfer.working')));
    const r = await session.issueTransferCode();
    issue.disabled = false;
    if (!r) {
      issued.replaceChildren(div(t('transfer.issueFailed'), 'color:#f87878'));
      return;
    }
    issue.textContent = t('transfer.reissue');
    const code = div(formatTransferCode(r.code), 'font-size:32px;letter-spacing:2px;user-select:text;-webkit-user-select:text');
    const copy = document.createElement('button');
    copy.style.cssText = BUTTON + ';align-self:flex-start';
    copy.textContent = t('net.copy');
    copy.onclick = () => void navigator.clipboard.writeText(formatTransferCode(r.code)).then(() => (copy.textContent = t('net.copied')));
    issued.replaceChildren(
      code,
      div(t('transfer.expires', { date: new Date(r.expireAt).toLocaleString(), hours: saveConfig.transferHours })),
      copy,
      div(t('transfer.secret'), 'color:#f8d030'),
    );
  };

  // 受け取り
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
  const input = document.createElement('input');
  input.placeholder = 'XXXX-XXXX-XXXX';
  input.maxLength = 20;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.style.cssText = 'flex:1;min-width:12em;font:inherit;font-size:20px;padding:6px 8px;text-transform:uppercase';
  // 入力中のキーで、ゲームの操作（Enter でメニューなど）が動かないように止める
  input.onkeydown = (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') void redeem();
    if (ev.key === 'Escape') close();
  };
  const receive = document.createElement('button');
  receive.style.cssText = BUTTON;
  receive.textContent = t('transfer.receive');
  const result = document.createElement('div');
  const redeem = async (): Promise<void> => {
    const code = normalizeTransferCode(input.value);
    if (!code) {
      result.replaceChildren(div(t('transfer.badCode'), 'color:#f87878'));
      return;
    }
    receive.disabled = true;
    result.replaceChildren(div(t('transfer.working')));
    const r = await session.redeemTransferCode(code, confirmReplace);
    receive.disabled = false;
    if (r === 'ok') {
      result.replaceChildren(div(t('transfer.received'), 'color:#78c878'));
      input.value = '';
    } else if (r === 'cancelled') result.replaceChildren();
    else result.replaceChildren(div(t(r === 'notFound' ? 'transfer.notFound' : 'transfer.receiveFailed'), 'color:#f87878'));
  };
  receive.onclick = () => void redeem();
  row.append(input, receive);

  const back = document.createElement('button');
  back.style.cssText = BUTTON + ';align-self:flex-end';
  back.textContent = t('credits.close');
  back.onclick = close;

  box.append(
    div(t('transfer.title'), 'font-size:24px'),
    div(t('transfer.about'), 'white-space:pre-line'),
    div(t('transfer.issueTitle'), 'font-size:20px;margin-top:8px'),
    div(t('transfer.issueAbout'), 'white-space:pre-line;opacity:0.85'),
    issue,
    issued,
    div(t('transfer.receiveTitle'), 'font-size:20px;margin-top:8px'),
    div(t('transfer.receiveAbout'), 'white-space:pre-line;opacity:0.85'),
    row,
    result,
    back,
  );
  document.body.append(overlay);
  input.focus();
}

/** 受け取るデータと今のデータを並べて、置き換えてよいかを確かめる */
function confirmReplace(incoming: Readonly<SaveData>, current: Readonly<SaveData>): Promise<boolean> {
  return new Promise((resolve) => {
    const { overlay, box } = overlayBox(31);
    const done = (ok: boolean): void => {
      overlay.remove();
      resolve(ok);
    };
    const card = (label: string, d: Readonly<SaveData>): HTMLDivElement => {
      const c = document.createElement('div');
      c.style.cssText = `${windowCss('light')};padding:10px 14px`;
      c.append(div(label), div(t('account.updatedAt', { date: new Date(d.updatedAt).toLocaleString() })), div(saveSummary(d)));
      return c;
    };
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap';
    const ok = document.createElement('button');
    ok.style.cssText = BUTTON;
    ok.textContent = t('transfer.replace');
    ok.onclick = () => done(true);
    const cancel = document.createElement('button');
    cancel.style.cssText = BUTTON;
    cancel.textContent = t('account.signInCancel');
    cancel.onclick = () => done(false);
    row.append(ok, cancel);
    box.append(
      div(t('transfer.confirmTitle'), 'font-size:24px'),
      card(t('transfer.incoming'), incoming),
      card(t('transfer.current'), current),
      div(t('transfer.confirmNote'), 'color:#f8d030'),
      row,
    );
    document.body.append(overlay);
  });
}
