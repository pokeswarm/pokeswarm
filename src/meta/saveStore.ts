import { shopConfig } from '../data';
import { emptySave, parseSave, type SaveData } from './saveData';

/** セーブデータの保存先（Firestore。テストでは置き換える） */
export interface SaveBackend {
  read(uid: string): Promise<SaveData | null>;
  write(uid: string, data: SaveData): Promise<void>;
}

/** ブラウザへの一時保存（localStorage。テストでは置き換える） */
export interface LocalStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const LOCAL_KEY = 'pokeswarm.save';

/**
 * セーブデータを持ち、ブラウザと Firestore に保存する（02_architecture.md 8章）。
 * - 変更はすぐブラウザに一時保存する（タブを閉じても・通信が切れても失われない）
 * - Firestore へはまとめて書く（ラン終了時・数分ごと。flush）。変更が無ければ書かない
 * - 読み込み時は Firestore とブラウザの新しい方を使う（前回、Firestore に書く前に閉じた場合）
 * セーブを消さないための決まり（作者の報告 2026年10月27日: テストのランの後、アカウントのデータが全部リセットされていた）:
 * - Firestore から読めず、ブラウザの一時保存も無いときの空のデータは「仮」とし、ブラウザにも Firestore にも書かない
 *   （前は空のデータを自分の一時保存として書き、次に開いたとき「ブラウザの方が新しい」として Firestore を空で上書きしていた）
 * - ログインする前（ユーザーが決まる前）の変更で、ログインしていた人の一時保存を上書きしない
 * - 何も進んでいない空のデータが、進み具合のあるデータを上書きしない（古い版で作られた空の一時保存が残っていても）
 */
export class SaveStore {
  private data: SaveData;
  private uid: string | null = null;
  /** Firestore にまだ書いていない変更があるか */
  private dirty = false;
  private writing: Promise<void> | null = null;
  /** 仮のデータ（Firestore から読めず、一時保存も無かった）。ブラウザにも Firestore にも書かない */
  private provisional = false;
  private readonly listeners = new Set<(data: Readonly<SaveData>) => void>();

  constructor(
    private backend: SaveBackend | null,
    private readonly local: LocalStorageLike | null,
    private readonly now: () => number = Date.now,
  ) {
    this.data = this.readLocal(null) ?? emptySave(now(), shopConfig.startingCoins);
  }

  get current(): Readonly<SaveData> {
    return this.data;
  }

  get userId(): string | null {
    return this.uid;
  }

  get hasUnsavedChanges(): boolean {
    return this.dirty;
  }

  onChange(fn: (data: Readonly<SaveData>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * ログインしたユーザーのデータに切り替える。Firestore とブラウザの新しい方を使い、
   * ブラウザの方が新しければ（前回書き込めなかった変更）Firestore へ書き直す。
   * Firestore から読めなかったら（時間切れを含む）、Firestore の方が新しいかもしれないので書き込まず、
   * ブラウザだけに保存して続け、false を返す。
   */
  async switchUser(uid: string, backend: SaveBackend | null = this.backend, timeoutMs = 10000): Promise<boolean> {
    this.backend = backend;
    this.uid = uid;
    const local = this.readLocal(uid);
    let remote: SaveData | null = null;
    let ok = true;
    if (backend) {
      try {
        remote = await withTimeout(backend.read(uid), timeoutMs);
      } catch (err) {
        console.warn('[save] 読み込みに失敗しました。ブラウザの一時保存で続けます', err);
        this.backend = null;
        ok = false;
      }
    }
    // 空の一時保存（何も進んでいない）は、進み具合のある Firestore のデータより新しくても使わない
    const localWins = !!local && (!remote || (local.updatedAt > remote.updatedAt && !(isBlankSave(local) && !isBlankSave(remote))));
    this.provisional = false;
    if (local && localWins) {
      this.data = local;
      this.dirty = !!this.backend;
    } else if (remote || ok) {
      this.data = remote ?? emptySave(this.now(), shopConfig.startingCoins);
      this.dirty = false;
    } else {
      // Firestore から読めず、一時保存も無い: 仮の空のデータで続けるが、どこにも書かない（Firestore の本当のデータを守る）
      this.data = emptySave(this.now(), shopConfig.startingCoins);
      this.dirty = false;
      this.provisional = true;
    }
    this.writeLocal();
    this.emit();
    return ok;
  }

  /** ログアウトなどで、ユーザーを持たない状態にする（ブラウザだけに保存する） */
  detach(): void {
    this.uid = null;
    this.data = emptySave(this.now(), shopConfig.startingCoins);
    this.dirty = false;
    this.emit();
  }

  /** データを変更する。ブラウザにはすぐ保存し、Firestore へは flush で書く */
  update(fn: (data: SaveData) => void): void {
    fn(this.data);
    this.data.updatedAt = this.now();
    this.dirty = true;
    this.writeLocal();
    this.emit();
  }

  /** データを丸ごと置き換える（2つのデータから選んだとき） */
  replace(data: SaveData): void {
    this.data = { ...data, updatedAt: this.now() };
    this.dirty = true;
    this.writeLocal();
    this.emit();
  }

  /** Firestore へ書く（変更が無ければ何もしない）。失敗したら変更ありのまま残し、次の機会に書く */
  async flush(): Promise<boolean> {
    if (this.writing) await this.writing;
    if (!this.dirty || !this.backend || !this.uid || this.provisional) return false;
    const snapshot = structuredClone(this.data);
    this.dirty = false;
    this.writing = this.backend.write(this.uid, snapshot).catch((err: unknown) => {
      console.warn('[save] 保存に失敗しました。次の機会に保存し直します', err);
      this.dirty = true;
    });
    await this.writing;
    this.writing = null;
    return !this.dirty;
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.data);
  }

  /** ブラウザの一時保存の持ち主（無ければ null） */
  private storedUid(): string | null {
    try {
      const raw = JSON.parse(this.local?.getItem(LOCAL_KEY) ?? 'null') as { uid?: unknown } | null;
      return typeof raw?.uid === 'string' ? raw.uid : null;
    } catch {
      return null;
    }
  }

  private readLocal(uid: string | null): SaveData | null {
    if (!this.local) return null;
    try {
      const raw: unknown = JSON.parse(this.local.getItem(LOCAL_KEY) ?? 'null');
      if (!raw || typeof raw !== 'object') return null;
      const entry = raw as { uid?: unknown; data?: unknown };
      // 別のユーザーの一時保存は使わない（同じブラウザで別のアカウントにログインした場合）
      if ((entry.uid ?? null) !== uid) return null;
      return parseSave(entry.data);
    } catch {
      return null;
    }
  }

  private writeLocal(): void {
    // 仮のデータは書かない。ログインする前（uid が無い）の変更で、ログインしていた人の一時保存を上書きしない
    if (this.provisional) return;
    if (this.uid === null && this.storedUid() !== null) return;
    try {
      this.local?.setItem(LOCAL_KEY, JSON.stringify({ uid: this.uid, data: this.data }));
    } catch {
      // 保存できない環境（プライベートブラウズなど）では、メモリの中だけで続ける
    }
  }
}

/** 何も進んでいない空のデータか（コイン・実績・解放・強化・記録・見つけた技が、新しいアカウントのまま） */
export function isBlankSave(d: Readonly<SaveData>): boolean {
  const progress = Object.keys(d.stats).filter((k) => !k.startsWith('reset.') && !k.startsWith('shopRepriced.'));
  return d.achievements.length === 0 && d.unlocked.length === 0 && Object.keys(d.upgrades).length === 0 && progress.length === 0 && d.discoveries.length === 0 && d.coins <= shopConfig.startingCoins;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${ms} ms 以内に応答がありませんでした`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
