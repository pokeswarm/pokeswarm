import {
  get,
  onChildAdded,
  onDisconnect,
  onValue,
  push,
  ref,
  serverTimestamp,
  set,
  type Database,
  type Unsubscribe,
} from 'firebase/database';
import type { NetworkConfig } from '../data/schema';
import { connectFirebase } from '../firebase/app';
import { PeerTransport } from './peerTransport';
import { RelayTransport } from './relayTransport';
import type { Transport } from './transport';

/**
 * 部屋（2人の技術検証用）。Realtime Database の rooms/<部屋ID> に次を置く:
 *   host, guest      … 匿名ログインのユーザー ID（切断すると消える）
 *   seed             … シミュレーションのシード（ホストが決める）
 *   mode             … 'pending' | 'p2p' | 'relay'（ホストが決める）
 *   offer, answer    … WebRTC の接続情報
 *   candidates/host, candidates/guest … WebRTC の経路の候補
 *   relay/toGuest, relay/toHost       … 中継時のメッセージ
 * ホストが切断すると部屋ごと消える。
 */

export type RoomStatus = 'signingIn' | 'creating' | 'waitingGuest' | 'joining' | 'connecting';

export interface RoomConnection {
  role: 'host' | 'guest';
  roomId: string;
  seed: number;
  transport: Transport;
}

export class RoomError extends Error {
  constructor(readonly code: 'notFound' | 'full' | 'closed') {
    super(code);
  }
}

const ROOM_ID_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

function randomRoomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => ROOM_ID_CHARS[b % ROOM_ID_CHARS.length]).join('');
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

/** 片付け用に、購読の解除をまとめて持つ */
class Subscriptions {
  private list: Unsubscribe[] = [];
  add(u: Unsubscribe): void {
    this.list.push(u);
  }
  clear(): void {
    this.list.forEach((u) => u());
    this.list = [];
  }
}

/** 相手の経路の候補を受け取る。相手の接続情報を設定する前に届いた候補は、設定後に足す */
function receiveCandidates(db: Database, pc: RTCPeerConnection, path: string, subs: Subscriptions): () => void {
  const pending: RTCIceCandidateInit[] = [];
  let ready = false;
  subs.add(
    onChildAdded(ref(db, path), (snap) => {
      const c = snap.val() as RTCIceCandidateInit;
      if (ready) void pc.addIceCandidate(c);
      else pending.push(c);
    }),
  );
  return () => {
    ready = true;
    pending.splice(0).forEach((c) => void pc.addIceCandidate(c));
  };
}

/** 相手がいなくなったら（切断で ID が消えたら）知らせる */
function watchPresence(db: Database, path: string, transport: Transport): void {
  let seen = false;
  onValue(ref(db, path), (snap) => {
    if (snap.exists()) seen = true;
    else if (seen) transport.onClose?.();
  });
}

export async function hostRoom(
  config: NetworkConfig,
  options: {
    forceRelay: boolean;
    /** 確認用: 相手の接続情報を無視して直接接続をわざと失敗させ、中継への自動切り替えを試す */
    simulateP2PFailure: boolean;
    onStatus: (s: RoomStatus, roomId?: string) => void;
  },
): Promise<RoomConnection> {
  options.onStatus('signingIn');
  const { db, uid } = await connectFirebase();
  const roomId = randomRoomId();
  const seed = randomSeed();
  const room = `rooms/${roomId}`;
  options.onStatus('creating');
  await onDisconnect(ref(db, room)).remove();
  await set(ref(db, room), { host: uid, seed, mode: options.forceRelay ? 'relay' : 'pending', createdAt: serverTimestamp() });
  options.onStatus('waitingGuest', roomId);

  const subs = new Subscriptions();
  await new Promise<void>((resolve) => {
    subs.add(
      onValue(ref(db, `${room}/guest`), (snap) => {
        if (snap.exists()) resolve();
      }),
    );
  });
  subs.clear();
  options.onStatus('connecting', roomId);

  const relay = (): RoomConnection => {
    const transport = new RelayTransport(db, roomId, 'host', config.relay.flushIntervalMs);
    watchPresence(db, `${room}/guest`, transport);
    return { role: 'host', roomId, seed, transport };
  };
  if (options.forceRelay) return relay();

  const pc = new RTCPeerConnection({ iceServers: config.iceServers });
  const channel = pc.createDataChannel('game', { ordered: true });
  pc.onicecandidate = (ev) => {
    if (ev.candidate) void push(ref(db, `${room}/candidates/host`), ev.candidate.toJSON());
  };
  const candidatesReady = receiveCandidates(db, pc, `${room}/candidates/guest`, subs);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await set(ref(db, `${room}/offer`), { type: offer.type, sdp: offer.sdp });
  subs.add(
    onValue(ref(db, `${room}/answer`), (snap) => {
      if (!snap.exists() || pc.remoteDescription || options.simulateP2PFailure) return;
      void pc.setRemoteDescription(snap.val() as RTCSessionDescriptionInit).then(candidatesReady);
    }),
  );

  const opened = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), config.p2pTimeoutMs);
    channel.onopen = () => {
      clearTimeout(timer);
      resolve(true);
    };
  });
  subs.clear();
  if (!opened) {
    // 時間内に直接つながらなければ中継に切り替える（ゲストは mode を見て合わせる）
    pc.close();
    await set(ref(db, `${room}/mode`), 'relay');
    return relay();
  }
  await set(ref(db, `${room}/mode`), 'p2p');
  const transport = new PeerTransport(pc, channel);
  watchPresence(db, `${room}/guest`, transport);
  return { role: 'host', roomId, seed, transport };
}

export async function joinRoom(
  config: NetworkConfig,
  roomId: string,
  options: { onStatus: (s: RoomStatus) => void },
): Promise<RoomConnection> {
  options.onStatus('signingIn');
  const { db, uid } = await connectFirebase();
  const room = `rooms/${roomId}`;
  options.onStatus('joining');
  const snap = await get(ref(db, room));
  if (!snap.exists()) throw new RoomError('notFound');
  const data = snap.val() as { seed: number; guest?: string };
  if (data.guest) throw new RoomError('full');
  await onDisconnect(ref(db, `${room}/guest`)).remove();
  await set(ref(db, `${room}/guest`), uid);
  options.onStatus('connecting');

  const subs = new Subscriptions();
  const relay = (): RoomConnection => {
    const transport = new RelayTransport(db, roomId, 'guest', config.relay.flushIntervalMs);
    watchPresence(db, `${room}/host`, transport);
    return { role: 'guest', roomId, seed: data.seed, transport };
  };

  const pc = new RTCPeerConnection({ iceServers: config.iceServers });
  pc.onicecandidate = (ev) => {
    if (ev.candidate) void push(ref(db, `${room}/candidates/guest`), ev.candidate.toJSON());
  };
  const candidatesReady = receiveCandidates(db, pc, `${room}/candidates/host`, subs);

  const result = await new Promise<RoomConnection>((resolve) => {
    pc.ondatachannel = (ev) => {
      const channel = ev.channel;
      channel.onopen = () => {
        const transport = new PeerTransport(pc, channel);
        watchPresence(db, `${room}/host`, transport);
        resolve({ role: 'guest', roomId, seed: data.seed, transport });
      };
    };
    subs.add(
      onValue(ref(db, `${room}/mode`), (m) => {
        if (m.val() === 'relay') {
          pc.close();
          resolve(relay());
        }
      }),
    );
    subs.add(
      onValue(ref(db, `${room}/offer`), (o) => {
        if (!o.exists() || pc.remoteDescription) return;
        void (async () => {
          await pc.setRemoteDescription(o.val() as RTCSessionDescriptionInit);
          candidatesReady();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await set(ref(db, `${room}/answer`), { type: answer.type, sdp: answer.sdp });
        })();
      }),
    );
  });
  subs.clear();
  return result;
}
