import type { NetMessage } from './protocol';

export type TransportKind = 'p2p' | 'relay';

/** 相手のブラウザとの通信路。直接接続（WebRTC）と中継（Realtime Database）で同じ形にする */
export interface Transport {
  readonly kind: TransportKind;
  /** 1回の更新で送るものをまとめて送る */
  send(messages: NetMessage[]): void;
  /** 届いたメッセージ */
  onMessages: ((messages: NetMessage[]) => void) | null;
  /** 相手が切断した */
  onClose: (() => void) | null;
  /** 送受信した量（文字数。ほぼバイト数） */
  readonly stats: { sentBytes: number; receivedBytes: number };
  close(): void;
}
