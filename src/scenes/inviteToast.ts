import type { InviteView } from '../firebase/social';
import { t } from '../i18n';
import { formatTag } from '../meta/nickname';
import { session } from '../meta/session';

// 原作をまねた白い窓のボタン（作者の決定。2026年10月22日。src/render/pixelUi.ts の windowCss と同じ見た目）
const BUTTON = 'padding:6px 14px;cursor:pointer;font:inherit;font-size:16px;background:#f8f8f8;color:#383848;border:4px solid #383848;border-radius:6px;box-shadow:inset 0 0 0 3px #f8f8f8,inset 0 0 0 5px #a8b8c8';

/**
 * フレンドからの招待の知らせ（画面の右上。どの画面でも出す）。
 * 「参加する」で待合室へ移る。ラン中は参加できない（ランを途中で抜けないように）。
 */
export class InviteToast {
  private readonly root: HTMLDivElement;
  private offSocial: (() => void) | null = null;

  constructor(
    /** 待合室へ移る。ラン中なら false を返す */
    private readonly join: (roomId: string) => boolean,
    /** 今ラン中か（参加のボタンを押せなくする） */
    private readonly inRun: () => boolean,
  ) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;right:16px;top:16px;display:flex;flex-direction:column;gap:8px;z-index:40;font-family:inherit;font-size:16px;line-height:1.5;color:#fff;max-width:min(420px,90vw)';
    document.body.appendChild(this.root);
    session.onStatus(() => this.bind());
    this.bind();
    // ラン中かどうかが変わったら、ボタンを押せるかを更新する
    setInterval(() => this.render(), 1000);
  }

  private bind(): void {
    this.offSocial?.();
    this.offSocial = session.social?.onChange(() => this.render()) ?? null;
    this.render();
  }

  private render(): void {
    const social = session.social;
    const invites: InviteView[] = social?.invites ?? [];
    const running = this.inRun();
    this.root.replaceChildren(
      ...invites.map((inv) => {
        const box = document.createElement('div');
        box.style.cssText = 'padding:12px 14px;border-radius:6px;background:rgba(8,14,8,0.94);border:2px solid #ffb300';
        const text = document.createElement('div');
        text.textContent = t('invite.received', { tag: formatTag(inv.nickname, inv.tag) }) + (running ? t('invite.busy') : '');
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;margin-top:8px';
        const join = document.createElement('button');
        join.style.cssText = BUTTON;
        join.textContent = t('invite.join');
        join.disabled = running;
        if (running) join.style.opacity = '0.5';
        join.onclick = () => {
          if (this.join(inv.roomId)) void social?.dismissInvite(inv.from);
        };
        const decline = document.createElement('button');
        decline.style.cssText = BUTTON;
        decline.textContent = t('invite.decline');
        decline.onclick = () => void social?.dismissInvite(inv.from);
        row.append(join, decline);
        box.append(text, row);
        return box;
      }),
    );
  }
}
