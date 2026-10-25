import Phaser from 'phaser';
import { NicknameError, type Social } from '../firebase/social';
import { t, type MessageKey } from '../i18n';
import { formatTag, NICKNAME_MAX } from '../meta/nickname';
import { session } from '../meta/session';

// 原作をまねた白い窓のボタン（作者の決定。2026年10月22日。src/render/pixelUi.ts の windowCss と同じ見た目）
const BUTTON = 'min-height:44px;padding:8px 14px;cursor:pointer;font:inherit;font-size:16px;background:#f8f8f8;color:#383848;border:4px solid #383848;border-radius:6px;box-shadow:inset 0 0 0 3px #f8f8f8,inset 0 0 0 5px #a8b8c8';
const INPUT = 'flex:1;min-width:0;padding:8px;font:inherit;border-radius:6px;border:4px solid #383848;background:#f8f8f8;color:#383848';

/**
 * フレンドの画面（DOM。見た目の作り込みはフェーズ4）。Google でログインした人だけが使える。
 * - 自分のニックネーム#タグの登録・変更
 * - 「ニックネーム#1234」でフレンド申請、届いた申請の承認・お断り
 * - フレンドの一覧（オンライン状態）
 */
export class FriendsScene extends Phaser.Scene {
  private root!: HTMLDivElement;
  private message: { key: MessageKey; params?: Record<string, string | number>; error?: boolean } | null = null;
  private busy = false;
  /** 入力中の文字（作り直しても消えないように） */
  private nicknameDraft = '';
  private tagDraft = '';

  constructor() {
    super('friends');
  }

  create(): void {
    this.message = null;
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(720px,92vw);max-height:90vh;overflow:auto;padding:24px;background:#000;color:#f8f8f8;border:4px solid #f8f8f8;box-shadow:inset 0 0 0 2px #000,inset 0 0 0 4px #f8f8f8;font-family:inherit;font-size:16px;line-height:1.6;border-radius:6px;z-index:20;box-sizing:border-box';
    document.body.appendChild(this.root);
    const unsubscribe = [session.onStatus(() => this.render())];
    let offSocial: (() => void) | null = null;
    const bindSocial = (): void => {
      offSocial?.();
      offSocial = session.social?.onChange(() => this.render()) ?? null;
    };
    bindSocial();
    unsubscribe.push(session.onStatus(bindSocial));
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') this.scene.start('title');
    };
    window.addEventListener('keydown', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const u of unsubscribe) u();
      offSocial?.();
      window.removeEventListener('keydown', onKey);
      this.root.remove();
    });
    this.render();
  }

  private async run(fn: (social: Social) => Promise<void>): Promise<void> {
    const social = session.social;
    if (!social || this.busy) return;
    this.busy = true;
    this.render();
    try {
      await fn(social);
    } catch (err) {
      if (err instanceof NicknameError) this.message = { key: `friends.nickname.${err.problem}`, params: { max: NICKNAME_MAX }, error: true };
      else this.message = { key: 'friends.failed', params: { message: err instanceof Error ? err.message : String(err) }, error: true };
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private render(): void {
    const social = session.social;
    const title = document.createElement('div');
    title.style.cssText = 'font-size:24px;font-weight:bold;margin-bottom:12px';
    title.textContent = t('friends.title');
    const children: HTMLElement[] = [title];
    const section = (key: MessageKey): HTMLDivElement => {
      const h = document.createElement('div');
      h.style.cssText = 'font-weight:bold;margin:16px 0 6px';
      h.textContent = t(key);
      children.push(h);
      const body = document.createElement('div');
      children.push(body);
      return body;
    };
    const button = (label: string, onClick: () => void, disabled = false): HTMLButtonElement => {
      const b = document.createElement('button');
      b.style.cssText = BUTTON;
      b.textContent = label;
      b.disabled = disabled || this.busy;
      if (b.disabled) b.style.opacity = '0.5';
      b.onclick = onClick;
      return b;
    };
    const row = (...els: HTMLElement[]): HTMLDivElement => {
      const r = document.createElement('div');
      r.style.cssText = 'display:flex;gap:8px;align-items:center;margin:4px 0';
      r.append(...els);
      return r;
    };
    const text = (s: string, style = ''): HTMLSpanElement => {
      const e = document.createElement('span');
      e.style.cssText = style;
      e.textContent = s;
      return e;
    };

    if (!social) {
      children.push(text(t(session.status === 'google' ? 'lobby.connecting' : 'friends.googleOnly')));
    } else {
      // 自分のニックネーム
      const me = section('friends.me');
      if (social.profile) {
        // 自分のタグと、ワンクリックでコピーするボタン（相手に送るため）
        const tag = formatTag(social.profile.nickname, social.profile.tag);
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:12px;align-items:center;flex-wrap:wrap';
        const copy = button(t('friends.copyTag'), () => void navigator.clipboard.writeText(tag).then(() => (copy.textContent = t('friends.copied'))));
        row.append(text(tag, 'font-size:24px;font-weight:bold'), copy);
        me.append(row);
      } else me.append(text(t('friends.needNickname'), 'opacity:0.85'));
      const nick = document.createElement('input');
      nick.style.cssText = INPUT;
      nick.placeholder = t('friends.nicknamePlaceholder', { max: NICKNAME_MAX });
      nick.maxLength = NICKNAME_MAX * 2;
      nick.value = this.nicknameDraft;
      nick.dataset.field = 'nickname';
      nick.oninput = () => (this.nicknameDraft = nick.value);
      me.append(
        row(
          nick,
          button(t(social.profile ? 'friends.changeNickname' : 'friends.setNickname'), () =>
            void this.run(async (s) => {
              const p = await s.setNickname(this.nicknameDraft);
              this.nicknameDraft = '';
              this.message = { key: 'friends.nicknameSet', params: { tag: formatTag(p.nickname, p.tag) } };
            }),
          ),
        ),
      );

      // 申請を送る
      const add = section('friends.add');
      const tagInput = document.createElement('input');
      tagInput.style.cssText = INPUT;
      tagInput.placeholder = t('friends.tagPlaceholder');
      tagInput.value = this.tagDraft;
      tagInput.dataset.field = 'tag';
      tagInput.oninput = () => (this.tagDraft = tagInput.value);
      add.append(
        row(
          tagInput,
          button(
            t('friends.send'),
            () =>
              void this.run(async (s) => {
                const result = await s.sendRequest(this.tagDraft);
                if (result === 'sent' || result === 'accepted') this.tagDraft = '';
                this.message = { key: `friends.result.${result}`, error: result !== 'sent' && result !== 'accepted' };
              }),
            !social.profile,
          ),
        ),
      );

      // 届いた申請
      if (social.requests.length > 0) {
        const req = section('friends.requests');
        for (const r of social.requests) {
          req.append(
            row(
              text(formatTag(r.nickname, r.tag), 'flex:1'),
              button(t('friends.accept'), () => void this.run((s) => s.accept(r.uid))),
              button(t('friends.decline'), () => void this.run((s) => s.decline(r.uid))),
            ),
          );
        }
      }

      // フレンド
      const list = section('friends.list');
      if (social.friends.length === 0) list.append(text(t('friends.none'), 'opacity:0.75'));
      for (const f of social.friends) {
        const state = text(t(f.presence ? `friends.presence.${f.presence}` : 'friends.offline'), `width:9em;font-size:16px;${f.presence ? 'color:#81c784' : 'opacity:0.6'}`);
        list.append(
          row(
            text(formatTag(f.nickname, f.tag), 'flex:1'),
            state,
            button(t('friends.remove'), () => {
              if (window.confirm(t('friends.removeConfirm', { tag: formatTag(f.nickname, f.tag) }))) void this.run((s) => s.removeFriend(f.uid));
            }),
          ),
        );
      }
    }

    if (this.message) {
      const msg = document.createElement('div');
      msg.style.cssText = `margin-top:14px;${this.message.error ? 'color:#ef9a9a' : 'color:#a5d6a7'}`;
      msg.textContent = t(this.message.key, this.message.params);
      children.push(msg);
    }
    const back = document.createElement('button');
    back.style.cssText = BUTTON + ';margin-top:16px';
    back.textContent = t('friends.back');
    back.onclick = () => this.scene.start('title');
    children.push(back);

    // 入力中に作り直しても、同じ欄で続けて入力できるようにする
    const field = (document.activeElement as HTMLElement | null)?.dataset?.field;
    this.root.replaceChildren(...children);
    const again = field ? this.root.querySelector<HTMLInputElement>(`input[data-field="${field}"]`) : null;
    if (again) {
      again.focus();
      again.setSelectionRange(again.value.length, again.value.length);
    }
  }
}
