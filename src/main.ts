import Phaser from 'phaser';
import { placeholderRender, playablesConfig } from './data';
import { migrateOldDiscoveries } from './meta/discoveries';
import { session } from './meta/session';
import { loadSpriteManifest } from './render/sprites/spriteManifest';
import { AchievementsScene } from './scenes/AchievementsScene';
import { FriendsScene } from './scenes/FriendsScene';
import { InviteToast } from './scenes/inviteToast';
import { LobbyScene, type LobbySceneData } from './scenes/LobbyScene';
import { ResultScene } from './scenes/ResultScene';
import { RunScene, type RunSceneData } from './scenes/RunScene';
import { SelectScene } from './scenes/SelectScene';
import { TitleScene } from './scenes/TitleScene';

/**
 * 入り口:
 * - 通常: タイトル → ポケモン選択 → ラン → 結果画面
 * - 協力プレイ: タイトルで C → 待合室（部屋を作る）。参加用 URL（?join=<部屋ID>）を開くと待合室に入る
 * - 確認用: ?pokemon=bulbasaur でタイトルを飛ばしてすぐソロのランを始める。
 *   ?host で部屋を作る（&relay で中継から始める、&p2pfail で直接接続をわざと失敗させる）
 */
async function start(): Promise<void> {
  // ログインとセーブデータの読み込みは待たずに始める（タイトル画面に状態を出す）
  const sessionReady = session.start().then(() => {
    migrateOldDiscoveries(session.store);
    // 実績の仕組みより前に遊んだ記録でも、条件を満たしていれば達成にする
    session.checkProgress();
  });
  const q = new URLSearchParams(window.location.search);
  const joinId = q.get('join');
  let lobby: LobbySceneData | null = null;
  let run: RunSceneData | null = null;
  if (joinId || q.has('host')) {
    // 部屋の接続は同じログインを使うので、ログインを待ってから（匿名ログインを2回しないため）
    await sessionReady;
    lobby = joinId
      ? { mode: 'join', roomId: joinId }
      : { mode: 'host', forceRelay: q.has('relay'), simulateP2PFailure: q.has('p2pfail') };
  } else if (q.has('pokemon')) {
    // 雑魚のスプライトは起動時には読まず、時間帯に合わせて読む（SpriteStreamer）
    const requested = q.get('pokemon') ?? '';
    const pokemon = playablesConfig.pokemon[requested] ? requested : playablesConfig.default;
    run = { pokemon, playerSprite: await loadSpriteManifest(playablesConfig.pokemon[pokemon]!.sprite), coop: null };
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
  game.scene.add('title', TitleScene, !lobby && !run);
  game.scene.add('select', SelectScene, false);
  game.scene.add('lobby', LobbyScene, !!lobby, lobby ?? undefined);
  game.scene.add('run', RunScene, !!run, run ?? undefined);
  game.scene.add('result', ResultScene, false);
  game.scene.add('friends', FriendsScene, false);
  game.scene.add('achievements', AchievementsScene, false);

  // フレンドからの招待: ラン中でなければ、今の画面を閉じて待合室へ移る
  const running = (): boolean => game.scene.isActive('run');
  new InviteToast((roomId) => {
    if (running()) return false;
    for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
    game.scene.start('lobby', { mode: 'join', roomId } satisfies LobbySceneData);
    return true;
  }, running);
}

void start();
