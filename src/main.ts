import Phaser from 'phaser';
import { enemiesConfig, networkConfig, placeholderRender, spriteRender } from './data';
import type { SpriteAnims } from './data/schema';
import { firebaseOptionsFromEnv } from './firebase/config';
import type { RoomConnection } from './net/room';
import { loadSpriteManifest } from './render/sprites/spriteManifest';
import { NetPanel } from './scenes/netPanel';
import { RunScene, type RunSceneData } from './scenes/RunScene';

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
          url.search = new URLSearchParams({ join: roomId }).toString();
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

async function start(): Promise<void> {
  const panel = new NetPanel();
  panel.hide();
  // スプライトの定義は種類ごとに1回だけ読む
  const manifests = new Map<string, Promise<SpriteAnims | null>>();
  const manifest = (key: string): Promise<SpriteAnims | null> => {
    if (!manifests.has(key)) manifests.set(key, loadSpriteManifest(key));
    return manifests.get(key)!;
  };
  const [playerSprite, enemySprites, net] = await Promise.all([
    manifest(spriteRender.playerSprite),
    Promise.all(enemiesConfig.kinds.map((k) => (k.sprite ? manifest(k.sprite) : Promise.resolve(null)))),
    connectIfRequested(panel),
  ]);
  panel.hide();
  const data: RunSceneData = { playerSprite, enemySprites, net, panel };
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
  game.scene.add('run', RunScene, true, data);
}

void start();
