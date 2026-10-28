import { describe, expect, it, vi } from 'vitest';

/** 中継（Realtime Database）: 読んだものはすぐ消す（作者の報告 2026年10月28日: スマホの協力プレイで急にトップに戻された。07 の108章） */
const removed: unknown[] = [];
let childAdded: ((snap: { val(): unknown; ref: unknown }) => void) | null = null;
vi.mock('firebase/database', () => ({
  ref: (_db: unknown, path: string) => ({ path }),
  push: vi.fn(),
  remove: (r: unknown) => {
    removed.push(r);
    return Promise.resolve();
  },
  onChildAdded: (_r: unknown, fn: typeof childAdded) => {
    childAdded = fn;
    return () => undefined;
  },
}));

describe('中継', () => {
  it('受け取った書き込みは、読んだらデータベースから消す', async () => {
    const { RelayTransport } = await import('./relayTransport');
    const { encode } = await import('./protocol');
    const t = new RelayTransport({} as never, 'rooms/r/relay/2', 'guest', 100);
    const got: unknown[] = [];
    t.onMessages = (m) => got.push(...m);
    const msgRef = { path: 'rooms/r/relay/2/toGuest/-a' };
    childAdded!({ val: () => ({ m: encode([{ t: 'sa', s: 1 }]) }), ref: msgRef });
    expect(got).toEqual([{ t: 'sa', s: 1 }]);
    expect(removed).toEqual([msgRef]);
    t.close();
  });
});
