import type { Account, SaveChooser } from '../firebase/account';
import type { PresenceState, Social } from '../firebase/social';
import { firebaseOptionsFromEnv } from '../firebase/config';
import { SaveStore } from './saveStore';

export type AccountStatus = 'offline' | 'connecting' | 'guest' | 'google' | 'error';

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * ゲーム全体で1つのセーブデータとログインの状態。
 * Firebase の設定値が無ければ「オフライン」（ブラウザだけに保存）で遊べる。
 * Firebase のコードはここから必要になったときに読み込む（起動を遅くしないため）。
 */
class Session {
  readonly store = new SaveStore(null, browserStorage());
  private account: Account | null = null;
  private statusValue: AccountStatus = 'offline';
  private errorMessage = '';
  private readonly listeners = new Set<() => void>();
  /** ニックネーム#タグ・フレンド・招待（Google でログインしているときだけ） */
  private socialValue: Social | null = null;
  private presence: PresenceState = 'menu';

  get social(): Social | null {
    return this.socialValue;
  }

  /** オンライン状態（タイトルなど・待合室・ラン中）をフレンドに知らせる */
  setPresence(state: PresenceState): void {
    this.presence = state;
    void this.socialValue?.setPresence(state).catch(() => undefined);
  }

  get status(): AccountStatus {
    return this.statusValue;
  }

  get error(): string {
    return this.errorMessage;
  }

  onStatus(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 起動時に1回呼ぶ。ゲストとしてログインし、セーブデータを読み込む（待たずにゲームを始めてよい） */
  async start(): Promise<void> {
    if (!firebaseOptionsFromEnv()) return;
    this.setStatus('connecting');
    try {
      const { Account } = await import('../firebase/account');
      this.account = await Account.start(this.store);
      this.setStatus(this.account.kind);
      // ブラウザの一時保存の方が新しかった（前回 Firestore に書く前に閉じた）なら、すぐ書いておく
      void this.store.flush();
    } catch (err) {
      console.warn('[account] ログインに失敗しました。ブラウザだけに保存して続けます', err);
      this.fail(err);
    }
    // タブを閉じる・裏に回すときに書いておく（書き終わる保証は無いが、ブラウザにも一時保存してある）
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.store.flush();
    });
  }

  async signInWithGoogle(choose: SaveChooser): Promise<void> {
    if (!this.account) return;
    try {
      await this.account.signInWithGoogle(choose);
      this.setStatus(this.account.kind);
    } catch (err) {
      console.warn('[account] Google ログインに失敗しました', err);
      this.fail(err);
      this.setStatus(this.account.kind, false);
    }
  }

  async signOut(): Promise<void> {
    if (!this.account) return;
    this.socialValue?.dispose();
    this.socialValue = null;
    await this.account.signOut();
    this.setStatus(this.account.kind);
  }

  private fail(err: unknown): void {
    this.errorMessage = err instanceof Error ? err.message : String(err);
    this.setStatus('error', false);
  }

  private setStatus(status: AccountStatus, clearError = true): void {
    if (clearError) this.errorMessage = '';
    this.statusValue = status === 'error' && this.account ? this.account.kind : status;
    void this.syncSocial();
    for (const fn of this.listeners) fn();
  }

  /** Google でログインしたらフレンドの機能を始め、ログアウトしたら止める */
  private async syncSocial(): Promise<void> {
    const google = this.statusValue === 'google';
    if (google && !this.socialValue && !this.socialStarting) {
      this.socialStarting = true;
      try {
        const { Social } = await import('../firebase/social');
        this.socialValue = await Social.start();
        void this.socialValue.setPresence(this.presence);
      } catch (err) {
        console.warn('[social] フレンドの機能を始められませんでした', err);
      } finally {
        this.socialStarting = false;
      }
      for (const fn of this.listeners) fn();
    } else if (!google && this.socialValue) {
      this.socialValue.dispose();
      this.socialValue = null;
    }
  }

  private socialStarting = false;
}

export const session = new Session();
