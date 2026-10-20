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
 */
export class SaveStore {
  private data: SaveData;
  private uid: string | null = null;
  /** Firestore にまだ書いていない変更があるか */
  private dirty = false;
  private writing: Promise<void> | null = null;
  private readonly listeners = new Set<(data: Readonly<SaveData>) => void>();

  constructor(
    private backend: SaveBackend | null,
    private readonly local: LocalStorageLike | null,
    private readonly now: () => number = Date.now,
  ) {
    this.data = this.readLocal(null) ?? emptySave(now());
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
    if (local && (!remote || local.updatedAt > remote.updatedAt)) {
      this.data = local;
      this.dirty = !!this.backend;
    } else {
      this.data = remote ?? emptySave(this.now());
      this.dirty = false;
    }
    this.writeLocal();
    this.emit();
    return ok;
  }

  /** ログアウトなどで、ユーザーを持たない状態にする（ブラウザだけに保存する） */
  detach(): void {
    this.uid = null;
    this.data = emptySave(this.now());
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
    if (!this.dirty || !this.backend || !this.uid) return false;
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
    try {
      this.local?.setItem(LOCAL_KEY, JSON.stringify({ uid: this.uid, data: this.data }));
    } catch {
      // 保存できない環境（プライベートブラウズなど）では、メモリの中だけで続ける
    }
  }
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
