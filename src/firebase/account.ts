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
import { doc, getDoc, getFirestore, setDoc, type Firestore } from 'firebase/firestore';
import { parseSave, type SaveData } from '../meta/saveData';
import type { SaveBackend, SaveStore } from '../meta/saveStore';
import { firebaseApp } from './app';

/** Firestore の saves/{uid} に保存する（本人だけが読み書きできる。firestore.rules） */
class FirestoreSaves implements SaveBackend {
  constructor(private readonly db: Firestore) {}

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
