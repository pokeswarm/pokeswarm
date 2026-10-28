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
});
