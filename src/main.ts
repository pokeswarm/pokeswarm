import Phaser from 'phaser';
import { networkConfig, placeholderRender, playablesConfig } from './data';
import { firebaseOptionsFromEnv } from './firebase/config';
import type { RoomConnection } from './net/room';
import { loadSpriteManifest } from './render/sprites/spriteManifest';
import { NetPanel } from './scenes/netPanel';
import { ResultScene } from './scenes/ResultScene';
import { RunScene, type RunSceneData } from './scenes/RunScene';
import { SelectScene } from './scenes/SelectScene';
import { TitleScene } from './scenes/TitleScene';
import { migrateOldDiscoveries } from './meta/discoveries';
import { session } from './meta/session';

/**
 * 協力プレイ（技術検証用）の入り口:
 *   ?host            … 部屋を作る（参加用 URL が表示される）
 *   ?host&relay      … 直接接続を試さず、Realtime Database の中継で始める
 *   ?host&p2pfail    … 直接接続をわざと失敗させ、時間切れで中継に切り替わることを確かめる
 *   ?join=<部屋ID>   … 部屋に入る
 * Firebase のコードは協力プレイのときだけ読み込む。
 */
async function connectIfRequested(panel: NetPanel): Promise<RoomConnection | null> {
  const q = new URLSearchParams(window.location.search);
  const joinId = q.get('join');
  if (!q.has('host') && !joinId) return null;
  if (!firebaseOptionsFromEnv()) {
    panel.show('net.firebaseMissing');
    return null;
  }
  const room = await import('./net/room');
  try {
    if (joinId) {
      return await room.joinRoom(networkConfig, joinId, { onStatus: (s) => panel.show(`net.${s}`) });
    }
    return await room.hostRoom(networkConfig, {
      forceRelay: q.has('relay'),
      simulateP2PFailure: q.has('p2pfail'),
      onStatus: (s, roomId) => {
        if (s === 'waitingGuest' && roomId) {
          const url = new URL(window.location.href);
          // 確認用のパラメータ（?status= など）はゲストにも引き継ぐ。部屋の作り方の指定は外す
          const params = new URLSearchParams(window.location.search);
          for (const k of ['host', 'relay', 'p2pfail']) params.delete(k);
          params.set('join', roomId);
          url.search = params.toString();
          panel.showJoinUrl(url.toString());
        } else {
          panel.show(`net.${s}`);
        }
      },
    });
  } catch (err) {
    if (err instanceof room.RoomError && err.code !== 'closed') panel.show(err.code === 'full' ? 'net.full' : 'net.notFound');
    else panel.show('net.failed', { message: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

/**
 * 通常はタイトル → ポケモン選択 → ラン → 結果画面の順に進む。
 * 確認用に ?pokemon=bulbasaur を付けるか、協力プレイ（?host・?join=）のときは、すぐにランを始める。
 */
async function start(): Promise<void> {
  // ログインとセーブデータの読み込みは待たずに始める（タイトル画面に状態を出す）
  const sessionReady = session.start().then(() => migrateOldDiscoveries(session.store));
  const panel = new NetPanel();
  panel.hide();
  const q = new URLSearchParams(window.location.search);
  const direct = q.has('pokemon') || q.has('host') || q.has('join');
  let data: RunSceneData | null = null;
  if (direct) {
    // 協力プレイの接続は同じログインを使うので、ログインを待ってから（匿名ログインを2回しないため）
    await sessionReady;
    // 雑魚のスプライトは起動時には読まず、時間帯に合わせて読む（SpriteStreamer）
    const requested = q.get('pokemon') ?? '';
    const pokemon = playablesConfig.pokemon[requested] ? requested : playablesConfig.default;
    const [playerSprite, net] = await Promise.all([loadSpriteManifest(playablesConfig.pokemon[pokemon]!.sprite), connectIfRequested(panel)]);
    panel.hide();
    data = { pokemon, playerSprite, net, panel };
  }
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: placeholderRender.backgroundColor,
    // ドット絵向け（ニアレストネイバー）の拡大
    pixelArt: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: '100%',
      height: '100%',
    },
  });
  game.scene.add('title', TitleScene, !data);
  game.scene.add('select', SelectScene, false);
  game.scene.add('run', RunScene, !!data, data ?? undefined);
  game.scene.add('result', ResultScene, false);
}

void start();
