import { onChildAdded, push, ref, remove, type Database, type Unsubscribe } from 'firebase/database';
import { decode, encode, latestKey, type NetMessage } from './protocol';
import type { Transport } from './transport';

/**
 * Realtime Database を経由した中継（直接つながらないとき）。
 * 書き込み回数と通信量を抑えるため、一定間隔でまとめて1回書き込む。
 * 位置や補正のように「最新だけあればよい」ものは、まとめる間に古いものを捨てる。
 */
export class RelayTransport implements Transport {
  readonly kind = 'relay' as const;
  onMessages: ((messages: NetMessage[]) => void) | null = null;
  onClose: (() => void) | null = null;
  readonly stats = { sentBytes: 0, receivedBytes: 0 };
  private buffer: NetMessage[] = [];
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly unsubscribe: Unsubscribe;
  private readonly outPath: string;

  constructor(
    private readonly db: Database,
    /** この2人の間の中継の場所（rooms/<部屋ID>/relay/<ゲストの番号>） */
    base: string,
    role: 'host' | 'guest',
    flushIntervalMs: number,
  ) {
    this.outPath = `${base}/${role === 'host' ? 'toGuest' : 'toHost'}`;
    const inPath = `${base}/${role === 'host' ? 'toHost' : 'toGuest'}`;
    this.unsubscribe = onChildAdded(ref(db, inPath), (snap) => {
      const text = (snap.val() as { m?: string } | null)?.m;
      // 読んだものはすぐ消す（作者の報告 2026年10月28日: スマホの協力プレイで急にトップに戻された。
      // 消さないと、ランの間ずっと受け取った分がこのブラウザの Firebase の中に残り、メモリを使い続ける。データベースの量も増え続ける）
      void remove(snap.ref).catch(() => undefined);
      if (!text) return;
      this.stats.receivedBytes += text.length;
      this.onMessages?.(decode(text));
    });
    this.timer = setInterval(() => this.flush(), flushIntervalMs);
  }

  send(messages: NetMessage[]): void {
    this.buffer.push(...messages);
  }

  buffered(): number {
    return this.buffer.length === 0 ? 0 : encode(this.buffer).length;
  }

  private flush(): void {
    if (this.buffer.length === 0) return;
    // 最新だけあればよいもの（自分の位置・敵の位置の補正）は最後の1つだけ残す
    const latest = new Map<string, number>();
    this.buffer.forEach((m, i) => {
      if (m.t === 'p' || m.t === 'c') latest.set(latestKey(m), i);
    });
    const batch = this.buffer.filter((m, i) => (m.t !== 'p' && m.t !== 'c') || latest.get(latestKey(m)) === i);
    this.buffer = [];
    const text = encode(batch);
    this.stats.sentBytes += text.length;
    void push(ref(this.db, this.outPath), { m: text });
  }

  close(): void {
    clearInterval(this.timer);
    this.unsubscribe();
  }
}
