import { getAuth } from 'firebase/auth';
import { getDatabase, onDisconnect, onValue, ref as dbRef, remove, serverTimestamp as dbTimestamp, set, type Database, type Unsubscribe as DbUnsubscribe } from 'firebase/database';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  writeBatch,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import { nicknameKey, parseTag, randomTag, tagId, validateNickname, type NicknameProblem } from '../meta/nickname';
import { firebaseApp } from './app';

/**
 * ニックネーム#タグ・フレンド・オンライン状態・招待（03_network.md 1.2・2章）。Google でログインした人だけが使う。
 * Firestore:
 *   profiles/{uid}                 … { nickname, tag }（Google でログインした人が読める）
 *   tags/{照合用のニックネーム#4桁} … { uid, nickname, tag }（タグからユーザーを探す。重複を防ぐ）
 *   users/{uid}/requests/{送った人} … フレンド申請（本人が読む）
 *   users/{uid}/friends/{フレンド}   … フレンド（両方に置く）
 * Realtime Database（すぐ届く・切断で消える）:
 *   presence/{uid}            … { state }（オンライン状態。切断すると消える）
 *   invites/{招待された人}/{招待した人} … { roomId, nickname, tag }
 * メールアドレスはどこにも置かない。
 */

export type PresenceState = 'menu' | 'lobby' | 'run';

export interface Profile {
  readonly nickname: string;
  readonly tag: string;
}

export interface FriendView extends Profile {
  readonly uid: string;
  /** オンラインならその状態。オフラインなら null */
  readonly presence: PresenceState | null;
}

export interface RequestView extends Profile {
  readonly uid: string;
}

export interface InviteView extends Profile {
  readonly from: string;
  readonly roomId: string;
}

export type SendRequestResult = 'sent' | 'accepted' | 'notFound' | 'self' | 'already' | 'noProfile';

export class NicknameError extends Error {
  constructor(readonly problem: NicknameProblem | 'busy') {
    super(problem);
  }
}

export class Social {
  profile: Profile | null = null;
  friends: FriendView[] = [];
  requests: RequestView[] = [];
  invites: InviteView[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribes: (Unsubscribe | DbUnsubscribe)[] = [];
  private readonly friendWatch = new Map<string, { profile: Profile | null; presence: PresenceState | null; off: DbUnsubscribe }>();
  /** 招待を送った相手（部屋を出たら消す） */
  private readonly sentInvites = new Set<string>();

  private constructor(
    private readonly fs: Firestore,
    private readonly db: Database,
    readonly uid: string,
  ) {}

  /** Google でログインしたユーザーで始める。自分のプロフィールを読み、オンライン状態を出す */
  static async start(): Promise<Social> {
    const app = firebaseApp();
    const user = getAuth(app).currentUser;
    if (!user || user.isAnonymous) throw new Error('google-only');
    // Google を紐づけた直後は、ルールが Google のログインを確かめられるよう、ログインの情報を取り直す
    await user.getIdToken(true);
    const social = new Social(getFirestore(app), getDatabase(app), user.uid);
    const snap = await getDoc(doc(social.fs, 'profiles', user.uid));
    social.profile = snap.exists() ? (snap.data() as Profile) : null;
    social.watch();
    await social.setPresence('menu');
    return social;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  dispose(): void {
    for (const u of this.unsubscribes) u();
    for (const w of this.friendWatch.values()) w.off();
    this.friendWatch.clear();
    void this.cancelInvites();
    void remove(dbRef(this.db, `presence/${this.uid}`));
  }

  /** オンライン状態（切断すると消える） */
  async setPresence(state: PresenceState): Promise<void> {
    const r = dbRef(this.db, `presence/${this.uid}`);
    await onDisconnect(r).remove();
    await set(r, { state, at: dbTimestamp() });
  }

  /**
   * ニックネームを登録・変更する。4桁はまだ使われていないものを選ぶ（同じニックネームで9999人まで）。
   * 照合用の形が同じ（大文字・小文字の違いだけなど）なら、4桁はそのまま
   */
  async setNickname(raw: string): Promise<Profile> {
    const v = validateNickname(raw);
    if (!v.ok) throw new NicknameError(v.problem);
    const nickname = v.nickname;
    const old = this.profile;
    const profile = await runTransaction(this.fs, async (tx) => {
      let tag = old && nicknameKey(old.nickname) === nicknameKey(nickname) ? old.tag : '';
      if (!tag) {
        for (let attempt = 0; attempt < 20 && !tag; attempt++) {
          const candidate = randomTag(Math.random);
          if (!(await tx.get(doc(this.fs, 'tags', tagId(nickname, candidate)))).exists()) tag = candidate;
        }
        if (!tag) throw new NicknameError('busy');
      }
      if (old && tagId(old.nickname, old.tag) !== tagId(nickname, tag)) tx.delete(doc(this.fs, 'tags', tagId(old.nickname, old.tag)));
      tx.set(doc(this.fs, 'tags', tagId(nickname, tag)), { uid: this.uid, nickname, tag });
      tx.set(doc(this.fs, 'profiles', this.uid), { nickname, tag, updatedAt: serverTimestamp() });
      return { nickname, tag };
    });
    this.profile = profile;
    this.changed();
    return profile;
  }

  /** 「ニックネーム#1234」の人にフレンド申請を送る。相手からも申請が来ていれば、そのままフレンドになる */
  async sendRequest(text: string): Promise<SendRequestResult> {
    if (!this.profile) return 'noProfile';
    const parsed = parseTag(text);
    if (!parsed) return 'notFound';
    const snap = await getDoc(doc(this.fs, 'tags', tagId(parsed.nickname, parsed.tag)));
    if (!snap.exists()) return 'notFound';
    const to = (snap.data() as { uid: string }).uid;
    if (to === this.uid) return 'self';
    if (this.friends.some((f) => f.uid === to)) return 'already';
    if (this.requests.some((r) => r.uid === to)) {
      await this.accept(to);
      return 'accepted';
    }
    const batch = writeBatch(this.fs);
    batch.set(doc(this.fs, 'users', to, 'requests', this.uid), { nickname: this.profile.nickname, tag: this.profile.tag, at: serverTimestamp() });
    await batch.commit();
    return 'sent';
  }

  /** 申請を承認する（両方のフレンドに入れ、申請を消す） */
  async accept(from: string): Promise<void> {
    const batch = writeBatch(this.fs);
    batch.set(doc(this.fs, 'users', this.uid, 'friends', from), { at: serverTimestamp() });
    batch.set(doc(this.fs, 'users', from, 'friends', this.uid), { at: serverTimestamp() });
    batch.delete(doc(this.fs, 'users', this.uid, 'requests', from));
    await batch.commit();
  }

  async decline(from: string): Promise<void> {
    await deleteDoc(doc(this.fs, 'users', this.uid, 'requests', from));
  }

  /** フレンドをやめる（両方から消す） */
  async removeFriend(uid: string): Promise<void> {
    const batch = writeBatch(this.fs);
    batch.delete(doc(this.fs, 'users', this.uid, 'friends', uid));
    batch.delete(doc(this.fs, 'users', uid, 'friends', this.uid));
    await batch.commit();
  }

  /** フレンドを部屋に招待する */
  async invite(uid: string, roomId: string): Promise<void> {
    if (!this.profile) return;
    const r = dbRef(this.db, `invites/${uid}/${this.uid}`);
    // 自分が切断したら招待も消える
    await onDisconnect(r).remove();
    await set(r, { roomId, nickname: this.profile.nickname, tag: this.profile.tag, at: dbTimestamp() });
    this.sentInvites.add(uid);
  }

  /** 送った招待を取り消す（部屋を出た・開始した） */
  async cancelInvites(): Promise<void> {
    const list = [...this.sentInvites];
    this.sentInvites.clear();
    await Promise.all(list.map((uid) => remove(dbRef(this.db, `invites/${uid}/${this.uid}`))));
  }

  /** 届いた招待を消す（参加した・断った） */
  async dismissInvite(from: string): Promise<void> {
    await remove(dbRef(this.db, `invites/${this.uid}/${from}`));
  }

  private watch(): void {
    this.unsubscribes.push(
      onSnapshot(collection(this.fs, 'users', this.uid, 'requests'), (snap) => {
        this.requests = snap.docs.map((d) => ({ uid: d.id, ...(d.data() as Profile) }));
        this.changed();
      }),
      onSnapshot(collection(this.fs, 'users', this.uid, 'friends'), (snap) => {
        const ids = new Set(snap.docs.map((d) => d.id));
        for (const [uid, w] of this.friendWatch) {
          if (ids.has(uid)) continue;
          w.off();
          this.friendWatch.delete(uid);
        }
        for (const uid of ids) if (!this.friendWatch.has(uid)) this.watchFriend(uid);
        this.rebuildFriends();
      }),
      onValue(dbRef(this.db, `invites/${this.uid}`), (snap) => {
        const all = (snap.val() ?? {}) as Record<string, { roomId: string; nickname: string; tag: string }>;
        this.invites = Object.entries(all).map(([from, v]) => ({ from, roomId: v.roomId, nickname: v.nickname, tag: v.tag }));
        this.changed();
      }),
    );
  }

  private watchFriend(uid: string): void {
    const entry = {
      profile: null as Profile | null,
      presence: null as PresenceState | null,
      off: onValue(dbRef(this.db, `presence/${uid}`), (snap) => {
        entry.presence = (snap.val() as { state?: PresenceState } | null)?.state ?? null;
        this.rebuildFriends();
      }),
    };
    this.friendWatch.set(uid, entry);
    void getDoc(doc(this.fs, 'profiles', uid)).then((snap) => {
      entry.profile = snap.exists() ? (snap.data() as Profile) : null;
      this.rebuildFriends();
    });
  }

  private rebuildFriends(): void {
    this.friends = [...this.friendWatch.entries()]
      .filter(([, w]) => w.profile)
      .map(([uid, w]) => ({ uid, nickname: w.profile!.nickname, tag: w.profile!.tag, presence: w.presence }))
      // オンラインの人を先に、名前の順
      .sort((a, b) => Number(!!b.presence) - Number(!!a.presence) || a.nickname.localeCompare(b.nickname));
    this.changed();
  }
}
