import { decode, encode, type NetMessage } from './protocol';
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

  constructor(
    private readonly pc: RTCPeerConnection,
    private readonly channel: RTCDataChannel,
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
    if (messages.length === 0 || this.channel.readyState !== 'open') return;
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
