import { decode, encode, type NetMessage } from './protocol';
import type { Transport } from './transport';

/**
 * WebRTC の DataChannel による直接接続。
 * 技術検証では、順番どおりに確実に届く設定のチャンネル1本にすべてを流す。
 */
export class PeerTransport implements Transport {
  readonly kind = 'p2p' as const;
  onMessages: ((messages: NetMessage[]) => void) | null = null;
  onClose: (() => void) | null = null;
  readonly stats = { sentBytes: 0, receivedBytes: 0 };

  constructor(
    private readonly pc: RTCPeerConnection,
    private readonly channel: RTCDataChannel,
  ) {
    channel.onmessage = (ev: MessageEvent<string>) => {
      this.stats.receivedBytes += ev.data.length;
      this.onMessages?.(decode(ev.data));
    };
    channel.onclose = () => this.onClose?.();
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.onClose?.();
    };
  }

  send(messages: NetMessage[]): void {
    if (messages.length === 0 || this.channel.readyState !== 'open') return;
    const text = encode(messages);
    this.stats.sentBytes += text.length;
    this.channel.send(text);
  }

  close(): void {
    this.channel.close();
    this.pc.close();
  }
}
