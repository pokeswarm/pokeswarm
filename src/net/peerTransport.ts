import { decode, encode, latestKey, type NetMessage } from './protocol';
import type { Transport } from './transport';

/**
 * 落ちても次が来ればよいメッセージ（自分の位置・敵の位置の補正・往復時間の計測）。
 * 順番を待たず・送り直さないチャンネルで送る（1つ落ちたときに、後ろのメッセージまで待たされないように）
 */
const LOSSY = new Set<NetMessage['t']>(['p', 'c', 'ping', 'pong']);

/**
 * WebRTC の DataChannel による直接接続。
 * 出来事（出現・撃破・命中・レベルアップなど）は順番どおりに確実に届くチャンネル（game）、
 * 落ちてもよいもの（LOSSY）は順番を待たず送り直さないチャンネル（fast）で送る。fast が開くまでは game で送る
 */
export class PeerTransport implements Transport {
  readonly kind = 'p2p' as const;
  onMessages: ((messages: NetMessage[]) => void) | null = null;
  onClose: (() => void) | null = null;
  readonly stats = { sentBytes: 0, receivedBytes: 0 };
  private fast: RTCDataChannel | null = null;

  /** まとめて送るのを待っているもの（batchTicks 回ぶん） */
  private pending: NetMessage[] = [];
  private pendingCalls = 0;

  constructor(
    private readonly pc: RTCPeerConnection,
    private readonly channel: RTCDataChannel,
    /** この回数の send をまとめて1回に送る（1 ならそのつど送る） */
    private readonly batchTicks = 1,
  ) {
    this.listen(channel);
    channel.onclose = () => this.onClose?.();
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.onClose?.();
    };
  }

  /** 落ちてもよいもののチャンネルが開いたら使う */
  attachFast(channel: RTCDataChannel): void {
    this.fast = channel;
    this.listen(channel);
  }

  private listen(channel: RTCDataChannel): void {
    channel.onmessage = (ev: MessageEvent<string>) => {
      this.stats.receivedBytes += ev.data.length;
      this.onMessages?.(decode(ev.data));
    };
  }

  send(messages: NetMessage[]): void {
    if (this.channel.readyState !== 'open') return;
    // batchTicks 回ぶんをまとめる。最新だけあればよいもの（自分の位置・敵の位置の補正）は、まとめる間に古いものを捨てる
    if (this.batchTicks > 1) {
      this.pending.push(...messages);
      if (++this.pendingCalls < this.batchTicks) return;
      this.pendingCalls = 0;
      const latest = new Map<string, number>();
      this.pending.forEach((m, i) => {
        if (m.t === 'p' || m.t === 'c') latest.set(latestKey(m), i);
      });
      messages = this.pending.filter((m, i) => (m.t !== 'p' && m.t !== 'c') || latest.get(latestKey(m)) === i);
      this.pending = [];
    }
    if (messages.length === 0) return;
    const fastOpen = this.fast?.readyState === 'open';
    const lossy = fastOpen ? messages.filter((m) => LOSSY.has(m.t)) : [];
    const reliable = fastOpen ? messages.filter((m) => !LOSSY.has(m.t)) : messages;
    if (reliable.length) this.write(this.channel, reliable);
    if (lossy.length) this.write(this.fast!, lossy);
  }

  buffered(): number {
    return this.channel.bufferedAmount + (this.fast?.bufferedAmount ?? 0);
  }

  private write(channel: RTCDataChannel, messages: NetMessage[]): void {
    const text = encode(messages);
    this.stats.sentBytes += text.length;
    channel.send(text);
  }

  close(): void {
    this.fast?.close();
    this.channel.close();
    this.pc.close();
  }
}
