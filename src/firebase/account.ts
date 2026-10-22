import { FirebaseError } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  linkWithPopup,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCredential,
  signOut,
  type Auth,
  type OAuthCredential,
  type User,
} from 'firebase/auth';
import { Timestamp, deleteDoc, doc, getDoc, getFirestore, runTransaction, setDoc, type Firestore } from 'firebase/firestore';
import { parseSave, type SaveData } from '../meta/saveData';
import { newTransferCode } from '../meta/transferCode';
import { saveConfig } from '../data';
import type { SaveBackend, SaveStore } from '../meta/saveStore';
import { firebaseApp } from './app';

/** Firestore の saves/{uid} に保存する（本人だけが読み書きできる。firestore.rules） */
class FirestoreSaves implements SaveBackend {
  constructor(readonly db: Firestore) {}

  async read(uid: string): Promise<SaveData | null> {
    const snap = await getDoc(doc(this.db, 'saves', uid));
    if (!snap.exists()) return null;
    const data = parseSave(snap.data());
    if (!data) console.warn('[save] Firestore のセーブデータの形が正しくありません。空のデータから始めます');
    return data;
  }

  async write(uid: string, data: SaveData): Promise<void> {
    await setDoc(doc(this.db, 'saves', uid), data);
  }
}

export type AccountKind = 'guest' | 'google';

/** セーブデータを読み込めなかったときのエラー（画面では翻訳した文章を出す） */
export const SAVE_READ_FAILED = 'save-read-failed';

/** 引き継ぎコードで受け取るデータを見せて、今のデータを置き換えてよいかを本人に確かめる */
export type TransferConfirm = (incoming: Readonly<SaveData>, current: Readonly<SaveData>) => Promise<boolean>;

/** ゲストのデータと Google のデータが両方あるとき、どちらを残すかを本人に選んでもらう */
export type SaveChooser = (guest: Readonly<SaveData>, google: Readonly<SaveData>) => Promise<'guest' | 'google'>;

/**
 * ログインとセーブデータの切り替え（03_network.md 1.1）。
 * - 起動時はゲスト（匿名ログイン）。前回 Google でログインしていれば、そのまま Google
 * - Google ログインは、ゲストのアカウントに Google を紐づける（ユーザー ID が変わらないのでデータもそのまま）
 * - その Google がすでに別のアカウントで使われていたら（前に Google で遊んでいた）、どちらのデータを残すか選ぶ
 * メールアドレスは保存も表示もしない。
 */
export class Account {
  /** ログインの切り替え中（その間の状態の知らせでデータを切り替えない） */
  private busy = false;

  private constructor(
    private readonly auth: Auth,
    private readonly saves: FirestoreSaves,
    private readonly store: SaveStore,
  ) {}

  static async start(store: SaveStore): Promise<Account> {
    const app = firebaseApp();
    const auth = getAuth(app);
    const account = new Account(auth, new FirestoreSaves(getFirestore(app)), store);
    await auth.authStateReady();
    const user = auth.currentUser ?? (await signInAnonymously(auth)).user;
    if (!(await store.switchUser(user.uid, account.saves))) throw new Error(SAVE_READ_FAILED);
    // 別のタブでログアウトした場合など
    onAuthStateChanged(auth, (u) => {
      if (u && !account.busy && u.uid !== store.userId) void store.switchUser(u.uid, account.saves);
    });
    return account;
  }

  get kind(): AccountKind {
    return this.auth.currentUser && !this.auth.currentUser.isAnonymous ? 'google' : 'guest';
  }

  /** Google でログインする。閉じた・キャンセルしたときは false */
  async signInWithGoogle(choose: SaveChooser): Promise<boolean> {
    const user = this.auth.currentUser;
    if (!user || !user.isAnonymous) return false;
    await this.store.flush();
    const provider = new GoogleAuthProvider();
    this.busy = true;
    try {
      await linkWithPopup(user, provider);
      return true;
    } catch (err) {
      if (!(err instanceof FirebaseError)) throw err;
      if (err.code === 'auth/credential-already-in-use') {
        const credential = GoogleAuthProvider.credentialFromError(err);
        if (!credential) throw err;
        await this.switchToExisting(user, credential, choose);
        return true;
      }
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return false;
      throw err;
    } finally {
      this.busy = false;
    }
  }

  /** すでに Google のアカウントがあった: そちらへログインし、残すデータを選ぶ。ゲストのアカウントは消す */
  private async switchToExisting(guestUser: User, credential: OAuthCredential, choose: SaveChooser): Promise<void> {
    const guestData = structuredClone(this.store.current) as SaveData;
    const googleUser = (await signInWithCredential(this.auth, credential)).user;
    const googleData = await this.saves.read(googleUser.uid);
    const keep = googleData ? await choose(guestData, googleData) : 'guest';
    await this.store.switchUser(googleUser.uid, this.saves);
    if (keep === 'guest') {
      this.store.replace(guestData);
      await this.store.flush();
    }
    // 使わなくなったゲストのアカウント（セーブデータは残るが、本人だけが読めるので誰も読めない）
    await guestUser.delete().catch(() => undefined);
  }

  /**
   * 引き継ぎコードを発行する（ゲストだけ。作者の決定 2026年10月22日）。今のデータを transfers/{コード} に写し、24時間で使えなくなる。
   * 元のブラウザのデータはそのまま残る。前に発行したコードは、使われていなければ消す
   */
  async issueTransferCode(): Promise<{ code: string; expireAt: number }> {
    const user = this.auth.currentUser;
    if (!user?.isAnonymous) throw new Error('guest only');
    await this.store.flush();
    if (this.issuedCode) await deleteTransfer(this.saves.db, this.issuedCode);
    const code = newTransferCode();
    const expireAt = Date.now() + saveConfig.transferHours * 60 * 60 * 1000;
    await setDoc(doc(this.saves.db, 'transfers', code), { from: user.uid, data: structuredClone(this.store.current), expireAt: Timestamp.fromMillis(expireAt) });
    this.issuedCode = code;
    return { code, expireAt };
  }

  private issuedCode: string | null = null;

  /**
   * 引き継ぎコードでデータを受け取る（ゲストだけ）。コードは1回だけ使える（受け取ったら消す）。
   * 見つからない・期限切れ・使用済みは 'notFound'、本人がやめたら 'cancelled'
   */
  async redeemTransferCode(code: string, confirm: TransferConfirm): Promise<'ok' | 'notFound' | 'cancelled'> {
    const user = this.auth.currentUser;
    if (!user?.isAnonymous) throw new Error('guest only');
    const ref = doc(this.saves.db, 'transfers', code);
    const first = await getDoc(ref).catch(() => null);
    const preview = first?.exists() ? parseSave(first.data().data) : null;
    if (!preview) return 'notFound';
    if (!(await confirm(preview, this.store.current))) return 'cancelled';
    // 確かめている間にほかの人が使っていないか、読み直してから消す（1回きり）
    const data = await runTransaction(this.saves.db, async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.exists() ? parseSave(snap.data().data) : null;
      if (d) tx.delete(ref);
      return d;
    }).catch(() => null);
    if (!data) return 'notFound';
    this.store.replace(data);
    await this.store.flush();
    return 'ok';
  }

  /** ログアウトして、新しいゲストで始める */
  async signOut(): Promise<void> {
    await this.store.flush();
    this.busy = true;
    try {
      await signOut(this.auth);
      const user = (await signInAnonymously(this.auth)).user;
      await this.store.switchUser(user.uid, this.saves);
    } finally {
      this.busy = false;
    }
  }
}

/** 引き継ぎコードを消す（もう無い・期限切れでも気にしない） */
async function deleteTransfer(db: Firestore, code: string): Promise<void> {
  await deleteDoc(doc(db, 'transfers', code)).catch(() => undefined);
}
