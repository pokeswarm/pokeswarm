import {
  get,
  onChildAdded,
  onChildRemoved,
  onDisconnect,
  onValue,
  push,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  type Database,
  type Unsubscribe,
} from 'firebase/database';
import type { NetworkConfig } from '../data/schema';
import { connectFirebase } from '../firebase/app';
import type { PlayerId } from '../sim/commands';
import { PeerTransport } from './peerTransport';
import { RelayTransport } from './relayTransport';
import type { NetMessage } from './protocol';
import type { Transport } from './transport';

/**
 * 協力プレイの部屋（最大 maxPlayers 人）。Realtime Database の rooms/<部屋ID> に次を置く:
 *   host, seed, region, createdAt … ホストが作る（region は遊ぶ地方）
 *   members/<番号>       … { uid, pokemon }。番号はプレイヤーの番号（ホストは1、ゲストは2〜）。切断すると消える
 *   started              … ホストが開始したときの参加者（[{ id, pokemon }]）。開始後は入れない
 *   peers/<ゲストの番号>  … ホストとそのゲストの WebRTC の接続情報（offer・answer・candidates・mode）
 *   relay/<ゲストの番号>  … 直接つながらないときの中継（toGuest・toHost）
 * つなぎ方はホストを中心にした形（ホスト ↔ 各ゲスト）。ホストが切断すると部屋ごと消える。
 */

export interface RoomPlayer {
  readonly id: PlayerId;
  readonly pokemon: string;
  /** フレンドリィショップの強化のレベル（ほかの人の画面でも同じ強さで動かすため） */
  readonly upgrades: Readonly<Record<string, number>>;
  /** 達成した実績の id（実績の報酬: 解放した持ち物・特殊なバフを、ほかの人の画面でも同じにするため） */
  readonly achievements: readonly string[];
  /** 最初に持っていく持ち物（そのポケモンでクリアしていれば選べる。無ければ null） */
  readonly startItem: string | null;
  /** 色違いで遊ぶ（見た目だけ） */
  readonly shiny: boolean;
}

export interface RoomMember {
  readonly id: PlayerId;
  readonly pokemon: string | null;
  readonly upgrades: Readonly<Record<string, number>>;
  readonly achievements: readonly string[];
  readonly startItem: string | null;
  readonly shiny: boolean;
  /** ホストとの通信がつながったか（ホスト自身は常に true） */
  readonly connected: boolean;
  /** 準備OK（ゲストが押す。ホストは常に true） */
  readonly ready: boolean;
}

export class RoomError extends Error {
  constructor(readonly code: 'notFound' | 'full' | 'started' | 'closed') {
    super(code);
  }
}

/** 部屋の参加者の、Realtime Database に置いた形（無いものは残らない） */
interface RawMember {
  pokemon?: string;
  upgrades?: Record<string, number>;
  achievements?: string[];
  startItem?: string;
  shiny?: boolean;
  ready?: boolean;
}

interface MemberData {
  pokemon: string | null;
  upgrades: Record<string, number>;
  achievements: string[];
  startItem: string | null;
  shiny: boolean;
  ready: boolean;
}

function parseMember(v: RawMember): MemberData {
  return { pokemon: v.pokemon || null, upgrades: v.upgrades ?? {}, achievements: v.achievements ?? [], startItem: v.startItem || null, shiny: !!v.shiny, ready: !!v.ready };
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

export interface RoomOptions {
  /** 直接接続を試さず、中継で始める（確認用） */
  forceRelay?: boolean;
  /** 確認用: 直接接続をわざと失敗させ、中継への自動切り替えを試す */
  simulateP2PFailure?: boolean;
}

/**
 * 部屋（待合室からランの終わりまで）。ホストとゲストで同じ形。
 * - 待合室: 参加者とポケモンの選択を onChange で知らせる。ホストが start で開始し、全員に onStart が届く
 * - ラン中: transports（ホストは各ゲストとの、ゲストはホストとの通信路）で同期する
 */
/**
 * 相手が抜けた理由（作者の報告 2026年10月28日: スマホの協力プレイでよく切れる。どれで切れたかを画面に出して調べる）
 * - closed: 通信路が閉じた（WebRTC の接続が切れた・相手がページを閉じた）
 * - left: 部屋の参加者の記録が消えた（相手のブラウザと Realtime Database の接続が切れた・部屋を出た）
 * - roomGone: 部屋が消えた（ホストのページが閉じた・ホストの回線が切れた）
 * - silence: 相手から決まった秒数なにも届かない（相手の画面が消えた・アプリを切り替えた・回線が弱い）
 */
export type LeaveReason = 'closed' | 'left' | 'roomGone' | 'silence';

export class Room {
  readonly transports = new Map<PlayerId, Transport>();
  /** 参加者が変わった・選択が変わった・通信がつながった */
  onChange: (() => void) | null = null;
  /** ホストが開始した */
  onStart: ((players: RoomPlayer[]) => void) | null = null;
  /** ある参加者が抜けた（ゲストから見たホストの切断を含む） */
  onLeave: ((id: PlayerId, reason: LeaveReason) => void) | null = null;
  private readonly members = new Map<PlayerId, MemberData>();
  private readonly subs = new Subscriptions();
  private readonly peerSubs = new Map<PlayerId, Subscriptions>();
  private startedPlayers: RoomPlayer[] | null = null;
  /** ランの画面がつなぐまでに届いたメッセージ（待合室の間にホストが送り始めた分を落とさない） */
  private readonly pending = new Map<PlayerId, NetMessage[][]>();
  private closed = false;

  private constructor(
    private readonly db: Database,
    private readonly config: NetworkConfig,
    readonly role: 'host' | 'guest',
    readonly roomId: string,
    readonly seed: number,
    /** 遊ぶ地方（ホストがマップの選択で決める） */
    readonly region: string,
    readonly localId: PlayerId,
    private readonly options: RoomOptions,
  ) {}

  private get base(): string {
    return `rooms/${this.roomId}`;
  }

  /** 部屋を作る（ホスト） */
  static async create(config: NetworkConfig, region: string, options: RoomOptions = {}): Promise<Room> {
    const { db, uid } = await connectFirebase();
    const roomId = randomRoomId();
    const seed = randomSeed();
    const room = new Room(db, config, 'host', roomId, seed, region, 1, options);
    await onDisconnect(ref(db, room.base)).remove();
    await set(ref(db, room.base), { host: uid, seed, region, createdAt: serverTimestamp(), members: { 1: { uid, pokemon: '' } } });
    room.members.set(1, parseMember({}));
    room.watchMembers();
    return room;
  }

  /** 部屋に入る（ゲスト）。空いている一番小さい番号をもらう */
  static async join(config: NetworkConfig, roomId: string, options: RoomOptions = {}): Promise<Room> {
    const { db, uid } = await connectFirebase();
    const base = `rooms/${roomId}`;
    const snap = await get(ref(db, base));
    if (!snap.exists()) throw new RoomError('notFound');
    const data = snap.val() as { seed: number; region?: string; started?: unknown };
    if (data.started) throw new RoomError('started');
    let slot = 0;
    const result = await runTransaction(ref(db, `${base}/members`), (current: Record<string, unknown> | null) => {
      // 最初の呼び出しは手元にデータが無いと null になる。そのまま書いてみて、サーバーの値と違えば
      // サーバーの値でもう一度呼ばれる（部屋が本当に無かった場合は、書いた後で確かめて消す）
      const members = current ?? {};
      slot = 0;
      for (let id = 2; id <= config.maxPlayers; id++) {
        if (!members[id]) {
          slot = id;
          break;
        }
      }
      if (slot === 0) return undefined;
      return { ...members, [slot]: { uid, pokemon: '' } };
    });
    if (!result.committed || slot === 0) throw new RoomError(result.snapshot.exists() ? 'full' : 'notFound');
    // ホスト（番号1）がいなければ、部屋は無かった（書いてしまった分を消す）
    if (!result.snapshot.child('1').exists()) {
      await remove(ref(db, `${base}/members/${slot}`));
      throw new RoomError('notFound');
    }
    const room = new Room(db, config, 'guest', roomId, data.seed, data.region ?? '', slot, options);
    await onDisconnect(ref(db, `${base}/members/${slot}`)).remove();
    await onDisconnect(ref(db, `${base}/peers/${slot}`)).remove();
    await onDisconnect(ref(db, `${base}/relay/${slot}`)).remove();
    room.watchMembers();
    room.watchHost();
    void room.connectAsGuest();
    return room;
  }

  /** 待合室の参加者（番号の順） */
  get memberList(): RoomMember[] {
    return [...this.members.entries()]
      .sort(([a], [b]) => a - b)
      .map(([id, m]) => ({ id, ...m, connected: id === this.localId || this.connectedTo(id), ready: id === 1 || m.ready }));
  }

  private connectedTo(id: PlayerId): boolean {
    // ゲストは、ホストとつながっていればほかのゲストともホストの中継でつながっている
    if (this.role === 'guest') return this.transports.has(1);
    return this.transports.has(id);
  }

  /** 自分のポケモンを選ぶ（待合室）。選び直したら準備OKは取り消す */
  async choosePokemon(pokemon: string): Promise<void> {
    await set(ref(this.db, `${this.base}/members/${this.localId}/pokemon`), pokemon);
    if (this.role === 'guest') await this.setReady(false);
  }

  /** ゲスト: 準備OK を切り替える（待合室） */
  async setReady(ready: boolean): Promise<void> {
    await set(ref(this.db, `${this.base}/members/${this.localId}/ready`), ready);
  }

  /** 最初に持っていく持ち物と色違いを知らせる（待合室） */
  async setLoadoutOptions(startItem: string | null, shiny: boolean): Promise<void> {
    await Promise.all([
      set(ref(this.db, `${this.base}/members/${this.localId}/startItem`), startItem),
      set(ref(this.db, `${this.base}/members/${this.localId}/shiny`), shiny),
    ]);
  }

  /** 自分の強化のレベルと達成した実績を知らせる（待合室に入ったとき） */
  async setUpgrades(upgrades: Readonly<Record<string, number>>, achievements: readonly string[]): Promise<void> {
    await Promise.all([
      set(ref(this.db, `${this.base}/members/${this.localId}/upgrades`), { ...upgrades }),
      set(ref(this.db, `${this.base}/members/${this.localId}/achievements`), [...achievements]),
    ]);
  }

  /** ホスト: 全員がポケモンを選び、通信がつながり、ゲストが準備OKなら開始できる */
  get canStart(): boolean {
    return this.role === 'host' && this.memberList.every((m) => m.pokemon && m.connected && m.ready);
  }

  /** ホスト: 開始する。開始後は誰も入れない */
  async start(): Promise<void> {
    if (!this.canStart) return;
    const players: RoomPlayer[] = this.memberList.map((m) => ({ id: m.id, pokemon: m.pokemon!, upgrades: m.upgrades, achievements: m.achievements, startItem: m.startItem, shiny: m.shiny }));
    await set(ref(this.db, `${this.base}/started`), players);
  }

  /** 部屋を出る。ホストなら部屋ごと消す */
  async leave(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.subs.clear();
    for (const s of this.peerSubs.values()) s.clear();
    for (const t of this.transports.values()) t.close();
    this.transports.clear();
    if (this.role === 'host') await remove(ref(this.db, this.base));
    else {
      await remove(ref(this.db, `${this.base}/members/${this.localId}`));
      await remove(ref(this.db, `${this.base}/peers/${this.localId}`));
      await remove(ref(this.db, `${this.base}/relay/${this.localId}`));
    }
  }

  private changed(): void {
    this.onChange?.();
  }

  private watchMembers(): void {
    const membersRef = ref(this.db, `${this.base}/members`);
    this.subs.add(
      onChildAdded(membersRef, (snap) => {
        const id = Number(snap.key);
        this.members.set(id, parseMember(snap.val() as RawMember));
        if (this.role === 'host' && id !== 1 && !this.startedPlayers) void this.connectAsHost(id);
        this.changed();
      }),
    );
    this.subs.add(
      onValue(membersRef, (snap) => {
        const all = (snap.val() ?? {}) as Record<string, RawMember>;
        for (const [key, v] of Object.entries(all)) {
          const id = Number(key);
          if (this.members.has(id)) this.members.set(id, parseMember(v));
        }
        this.changed();
      }),
    );
    this.subs.add(
      onChildRemoved(membersRef, (snap) => {
        const id = Number(snap.key);
        this.members.delete(id);
        this.dropPeer(id, 'left');
        this.changed();
      }),
    );
    this.subs.add(
      onValue(ref(this.db, `${this.base}/started`), (snap) => {
        if (!snap.exists() || this.startedPlayers) return;
        // 空の配列・null は Realtime Database に残らないので、無いものはそろえる
        this.startedPlayers = (snap.val() as RoomPlayer[]).map((p) => ({ ...p, upgrades: p.upgrades ?? {}, achievements: p.achievements ?? [], startItem: p.startItem ?? null, shiny: !!p.shiny }));
        this.onStart?.(this.startedPlayers);
      }),
    );
  }

  /** ゲスト: ホストがいなくなったら（部屋が消えたら）知らせる */
  private watchHost(): void {
    let seen = false;
    this.subs.add(
      onValue(ref(this.db, `${this.base}/host`), (snap) => {
        if (snap.exists()) seen = true;
        else if (seen && !this.closed) this.dropPeer(1, 'roomGone');
      }),
    );
  }

  /** 相手を切断したものとして外す（なにも届かない時間が続いたときなど） */
  disconnect(id: PlayerId): void {
    this.dropPeer(id, 'silence');
  }

  private dropPeer(id: PlayerId, reason: LeaveReason): void {
    this.peerSubs.get(id)?.clear();
    this.peerSubs.delete(id);
    const t = this.transports.get(id);
    if (!t) return;
    this.transports.delete(id);
    t.onClose = null;
    t.close();
    console.info('[net] 切断', id, reason);
    this.onLeave?.(id, reason);
  }

  private addTransport(id: PlayerId, transport: Transport): void {
    if (this.closed || (this.role === 'host' && !this.members.has(id))) {
      transport.close();
      return;
    }
    this.transports.set(id, transport);
    const queue: NetMessage[][] = [];
    this.pending.set(id, queue);
    transport.onMessages = (messages) => queue.push(messages);
    // 通信路が切れた（相手のブラウザが閉じた・回線が切れた）: その相手が抜けたものとして扱う
    transport.onClose = () => this.dropPeer(id, 'closed');
    this.changed();
  }

  /** ランの画面が届いたメッセージを受け取る。それまでにたまっていた分を先に渡す */
  attach(id: PlayerId, handler: (messages: NetMessage[]) => void): void {
    const transport = this.transports.get(id);
    if (!transport) return;
    for (const m of this.pending.get(id)?.splice(0) ?? []) handler(m);
    transport.onMessages = handler;
  }

  /** ホスト: あるゲストと直接つなぐ。時間内につながらなければ中継に切り替える */
  private async connectAsHost(slot: PlayerId): Promise<void> {
    const db = this.db;
    const peer = `${this.base}/peers/${slot}`;
    const relayBase = `${this.base}/relay/${slot}`;
    const subs = new Subscriptions();
    this.peerSubs.get(slot)?.clear();
    this.peerSubs.set(slot, subs);
    const relay = async (): Promise<void> => {
      await set(ref(db, `${peer}/mode`), 'relay');
      this.addTransport(slot, new RelayTransport(db, relayBase, 'host', this.config.relay.flushIntervalMs));
    };
    if (this.options.forceRelay) return relay();

    const pc = new RTCPeerConnection({ iceServers: this.config.iceServers });
    const channel = pc.createDataChannel('game', { ordered: true });
    // 落ちてもよいもの（位置・補正）用: 順番を待たず、送り直さない（03_network.md 6.4）
    const fast = pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 });
    pc.onicecandidate = (ev) => {
      if (ev.candidate) void push(ref(db, `${peer}/candidates/host`), ev.candidate.toJSON());
    };
    const candidatesReady = receiveCandidates(db, pc, `${peer}/candidates/guest`, subs);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await set(ref(db, `${peer}/offer`), { type: offer.type, sdp: offer.sdp });
    subs.add(
      onValue(ref(db, `${peer}/answer`), (snap) => {
        if (!snap.exists() || pc.remoteDescription || this.options.simulateP2PFailure) return;
        void pc.setRemoteDescription(snap.val() as RTCSessionDescriptionInit).then(candidatesReady);
      }),
    );
    const opened = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), this.config.p2pTimeoutMs);
      channel.onopen = () => {
        clearTimeout(timer);
        resolve(true);
      };
    });
    subs.clear();
    if (!opened) {
      pc.close();
      return relay();
    }
    await set(ref(db, `${peer}/mode`), 'p2p');
    const transport = new PeerTransport(pc, channel);
    if (fast.readyState === 'open') transport.attachFast(fast);
    else fast.onopen = () => transport.attachFast(fast);
    this.addTransport(slot, transport);
  }

  /** ゲスト: ホストとつなぐ（ホストが中継に切り替えたら合わせる） */
  private async connectAsGuest(): Promise<void> {
    const db = this.db;
    const peer = `${this.base}/peers/${this.localId}`;
    const relayBase = `${this.base}/relay/${this.localId}`;
    const subs = new Subscriptions();
    this.peerSubs.set(1, subs);
    const pc = new RTCPeerConnection({ iceServers: this.config.iceServers });
    pc.onicecandidate = (ev) => {
      if (ev.candidate) void push(ref(db, `${peer}/candidates/guest`), ev.candidate.toJSON());
    };
    const candidatesReady = receiveCandidates(db, pc, `${peer}/candidates/host`, subs);
    let done = false;
    const finish = (t: Transport): void => {
      if (done) return;
      done = true;
      subs.clear();
      this.addTransport(1, t);
    };
    // ホストが作る2本のチャンネル: game（確実に届く）と fast（落ちてもよいもの）。fast は開いたら使う
    let transport: PeerTransport | null = null;
    let fast: RTCDataChannel | null = null;
    pc.ondatachannel = (ev) => {
      const channel = ev.channel;
      if (channel.label === 'fast') {
        fast = channel;
        channel.onopen = () => transport?.attachFast(channel);
        return;
      }
      channel.onopen = () => {
        transport = new PeerTransport(pc, channel);
        if (fast?.readyState === 'open') transport.attachFast(fast);
        finish(transport);
      };
    };
    subs.add(
      onValue(ref(db, `${peer}/mode`), (m) => {
        if (m.val() !== 'relay') return;
        pc.close();
        finish(new RelayTransport(db, relayBase, 'guest', this.config.relay.flushIntervalMs));
      }),
    );
    subs.add(
      onValue(ref(db, `${peer}/offer`), (o) => {
        if (!o.exists() || pc.remoteDescription) return;
        void (async () => {
          await pc.setRemoteDescription(o.val() as RTCSessionDescriptionInit);
          candidatesReady();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await set(ref(db, `${peer}/answer`), { type: answer.type, sdp: answer.sdp });
        })();
      }),
    );
  }
}
