import { describe, expect, it } from 'vitest';
import { addStat, emptySave, parseSave, type SaveData } from './saveData';
import { SaveStore, type LocalStorageLike, type SaveBackend } from './saveStore';

class MemoryLocal implements LocalStorageLike {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

class MemoryBackend implements SaveBackend {
  readonly docs = new Map<string, SaveData>();
  writes = 0;
  fail = false;
  async read(uid: string): Promise<SaveData | null> {
    return this.docs.get(uid) ?? null;
  }
  async write(uid: string, data: SaveData): Promise<void> {
    if (this.fail) throw new Error('offline');
    this.writes++;
    this.docs.set(uid, structuredClone(data));
  }
}

function clock(): () => number {
  let t = 1000;
  return () => (t += 10);
}

describe('セーブデータ', () => {
  it('形の違うデータは読み込まない', () => {
    expect(parseSave({ version: 1 })).toBeNull();
    expect(parseSave(emptySave())).not.toBeNull();
  });

  it('変更はまとめて書き、変更が無ければ書かない', async () => {
    const backend = new MemoryBackend();
    const store = new SaveStore(backend, new MemoryLocal(), clock());
    await store.switchUser('u1');
    store.update((d) => addStat(d, 'kills', 10));
    store.update((d) => addStat(d, 'kills', 5));
    expect(backend.writes).toBe(0);
    await store.flush();
    await store.flush();
    expect(backend.writes).toBe(1);
    expect(backend.docs.get('u1')!.stats.kills).toBe(15);
  });

  it('書き込みに失敗したら変更ありのまま残し、次に書き直す', async () => {
    const backend = new MemoryBackend();
    const store = new SaveStore(backend, new MemoryLocal(), clock());
    await store.switchUser('u1');
    store.update((d) => (d.coins = 3));
    backend.fail = true;
    expect(await store.flush()).toBe(false);
    expect(store.hasUnsavedChanges).toBe(true);
    backend.fail = false;
    expect(await store.flush()).toBe(true);
    expect(backend.docs.get('u1')!.coins).toBe(3);
  });

  it('ブラウザの一時保存の方が新しければ、それを使って書き直す（前回、書く前に閉じた場合）', async () => {
    const backend = new MemoryBackend();
    const local = new MemoryLocal();
    const now = clock();
    const first = new SaveStore(backend, local, now);
    await first.switchUser('u1');
    first.update((d) => (d.coins = 1));
    await first.flush();
    first.update((d) => (d.coins = 2));
    // ここでタブを閉じた（flush していない）
    const second = new SaveStore(backend, local, now);
    await second.switchUser('u1');
    expect(second.current.coins).toBe(2);
    await second.flush();
    expect(backend.docs.get('u1')!.coins).toBe(2);
  });

  it('Firestore から読めなければ、上書きしないよう Firestore へは書かずにブラウザだけで続ける', async () => {
    const backend = new MemoryBackend();
    backend.read = () => new Promise(() => undefined);
    const store = new SaveStore(backend, new MemoryLocal(), clock());
    expect(await store.switchUser('u1', backend, 10)).toBe(false);
    store.update((d) => (d.coins = 5));
    expect(await store.flush()).toBe(false);
    expect(backend.writes).toBe(0);
    expect(store.current.coins).toBe(5);
  });

  it('別のユーザーの一時保存は使わない', async () => {
    const backend = new MemoryBackend();
    const local = new MemoryLocal();
    const now = clock();
    const a = new SaveStore(backend, local, now);
    await a.switchUser('u1');
    a.update((d) => (d.coins = 9));
    const b = new SaveStore(backend, local, now);
    await b.switchUser('u2');
    expect(b.current.coins).toBe(0);
  });
});
