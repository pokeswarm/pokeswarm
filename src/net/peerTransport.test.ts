import { describe, expect, it } from 'vitest';
import { PeerTransport } from './peerTransport';
import { decode, type NetMessage } from './protocol';

/** 直接接続で何回か分をまとめて送る（作者の報告 2026年10月29日: スマホの協力プレイが数分で落ちる。07 の119章） */
function fakeChannel() {
  const sent: NetMessage[][] = [];
  const ch = { readyState: 'open', bufferedAmount: 0, send: (text: string) => sent.push(decode(text)), onmessage: null, onclose: null, close: () => undefined };
  return { ch: ch as unknown as RTCDataChannel, sent };
}

describe('直接接続のまとめ送り', () => {
  it('batchTicks 回ごとに1回だけ送り、位置はプレイヤーごとに最新だけ、出来事はすべて残す', () => {
    const { ch, sent } = fakeChannel();
    const t = new PeerTransport({ close: () => undefined } as unknown as RTCPeerConnection, ch, 2);
    const p = (i: number, x: number): NetMessage => ({ t: 'p', i, x, y: 0, fx: 1, fy: 0, ix: 0, iy: 0, h: 1, m: 1, dn: 0 });
    t.send([p(1, 1), p(2, 1), { t: 'sa', s: 1 }]);
    expect(sent).toHaveLength(0);
    t.send([p(1, 2), { t: 'sa', s: 2 }]);
    expect(sent).toHaveLength(1);
    const got = sent[0]!;
    // 出来事は2つとも、位置はプレイヤー1は新しいほう・プレイヤー2もそのまま残る
    expect(got.filter((m) => m.t === 'sa')).toHaveLength(2);
    const pos = got.filter((m): m is Extract<NetMessage, { t: 'p' }> => m.t === 'p');
    expect(pos.map((m) => [m.i, m.x])).toEqual([[2, 1], [1, 2]]);
  });

  it('送り直さないチャンネルは、上限を超えないように区切って送る。小分けの補正は番号ごとに残す（07 の346章）', () => {
    const game = fakeChannel();
    const fast = fakeChannel();
    const texts: string[] = [];
    const send = fast.ch.send.bind(fast.ch);
    (fast.ch as unknown as { send: (text: string) => void }).send = (text) => {
      texts.push(text);
      send(text);
    };
    const t = new PeerTransport({ close: () => undefined } as unknown as RTCPeerConnection, game.ch, 2, 300);
    t.attachFast(fast.ch);
    const c = (n: number, k: number): NetMessage => ({ t: 'c', e: Array.from({ length: 30 }, (_, i) => 1000 + i), k, n });
    t.send([c(0, 30), c(1, 30), c(2, 30), { t: 'sa', s: 1 }]);
    t.send([{ t: 'ping', s: 1 }]);
    // 出来事は確実に届くチャンネルへ。補正は 3 つとも残り、1 通ずつに分かれる
    expect(game.sent).toEqual([[{ t: 'sa', s: 1 }]]);
    expect(texts.every((x) => x.length <= 300)).toBe(true);
    const got = fast.sent.flat();
    expect(got.filter((m) => m.t === 'c').map((m) => (m as Extract<NetMessage, { t: 'c' }>).n)).toEqual([0, 1, 2]);
    expect(got.filter((m) => m.t === 'ping')).toHaveLength(1);
    expect(fast.sent.length).toBeGreaterThanOrEqual(3);
  });
});
