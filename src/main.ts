import { loadPixelFonts } from './render/pixelUi';
import { startOrientationGuard } from './render/OrientationGuard';
import { checkSite, showSiteGuard } from './render/siteGuard';
import Phaser from 'phaser';
import { placeholderRender, playablesConfig, regionsConfig } from './data';
import { migrateOldDiscoveries } from './meta/discoveries';
import { session } from './meta/session';
import { loadSpriteManifest } from './render/sprites/spriteManifest';
import { shinySpriteKey } from './meta/loadoutOptions';
import { AchievementsScene } from './scenes/AchievementsScene';
import { ShopScene } from './scenes/ShopScene';
import { FriendsScene } from './scenes/FriendsScene';
import { InviteToast } from './scenes/inviteToast';
import { LobbyScene, type LobbySceneData } from './scenes/LobbyScene';
import { ResultScene } from './scenes/ResultScene';
import { RunScene, type RunSceneData } from './scenes/RunScene';
import { SelectScene } from './scenes/SelectScene';
import { RegionScene } from './scenes/RegionScene';
import { TitleScene } from './scenes/TitleScene';
import { SettingsScene } from './scenes/SettingsScene';
import { installAudioUnlock } from './audio';

/**
 * 入り口:
 * - 通常: タイトル → ポケモン選択 → ラン → 結果画面
 * - 協力プレイ: タイトルで C → 待合室（部屋を作る）。参加用 URL（?join=<部屋ID>）を開くと待合室に入る
 * - 確認用: ?pokemon=bulbasaur でタイトルを飛ばしてすぐソロのランを始める。
 *   ?host で部屋を作る（&relay で中継から始める、&p2pfail で直接接続をわざと失敗させる）
 */
async function start(): Promise<void> {
  installAudioUnlock();
  // ドットのフォントを先に読み込む（作者の決定。読み込む前の文字は、ふつうのフォントで描かれてしまう）
  await loadPixelFonts().catch((e: unknown) => console.warn('フォントを読み込めませんでした', e));
  // 公式のページ以外（ほかのサイトへの埋め込み・丸ごとコピー）では、ゲームを始めずに公式サイトを案内する
  const problem = checkSite();
  if (problem) {
    showSiteGuard(problem);
    return;
  }
  // スマホは横向きだけ（縦向きのときは案内を出す）
  startOrientationGuard();
  // ログインとセーブデータの読み込みは待たずに始める（タイトル画面に状態を出す）
  const sessionReady = session.start().then(() => {
    migrateOldDiscoveries(session.store);
    // 伝説のリワークに合わせて、伝説を倒した実績と解放を1回だけリセットする（実績の判定より前に）
    session.applyDataResets();
    // 実績の仕組みより前に遊んだ記録でも、条件を満たしていれば達成にする
    session.checkProgress();
    // ショップの強化の一覧を作り直したので、前の版の強化は使ったコインを全額返す
    session.refundLegacyUpgrades();
    // ジョウトのショップの解放に使う、ショップで使ったコインの合計（前のセーブは今の強化から数える）
    session.backfillShopSpent();
  });
  const q = new URLSearchParams(window.location.search);
  // 開発版だけ: ?restore=50000 で、伝説以外の実績を全部達成にし、コインをその数にする（セーブの読み込みが終わってから。公開版では効かない）
  if (import.meta.env.DEV && q.has('restore')) {
    void sessionReady.then(async () => {
      const { grantDevProgress } = await import('./meta/devGrant');
      let result = { achievements: 0, unlocked: 0 };
      session.store.update((d) => void (result = grantDevProgress(d, Number(q.get('restore')) || 50000)));
      await session.store.flush();
      console.info('[restore] 実績', result.achievements, '・解放', result.unlocked, '・コイン', session.store.current.coins, '・ユーザー', session.store.userId);
    });
  }
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
    // セーブの読み込みが終わってから始める（読み込みの途中でランの重い読み込みが重なると、読み込みが間に合わないことがあった。作者の報告 2026年10月27日）
    await sessionReady.catch(() => undefined);
    // 雑魚のスプライトは起動時には読まず、時間帯に合わせて読む（SpriteStreamer）
    const requested = q.get('pokemon') ?? '';
    const pokemon = playablesConfig.pokemon[requested] ? requested : playablesConfig.default;
    // 地方は ?region= か、そのポケモンを遊べる最初の地方（ヒノアラシならジョウト）
    const region = q.get('region') ?? regionsConfig.regions.find((r) => r.playables?.includes(pokemon))?.id;
    // テストプレイ: ?shiny で色違い（見た目だけ）
    const shiny = q.has('shiny');
    const sprite = playablesConfig.pokemon[pokemon]!.sprite;
    run = { pokemon, region, playerSprite: await loadSpriteManifest(shiny ? shinySpriteKey(sprite) : sprite), coop: null, shiny };
  }
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: placeholderRender.backgroundColor,
    // ドット絵向け（ニアレストネイバー）の拡大
    pixelArt: true,
    // ゲームの描く面の上のクリックだけを拾う。ページ全体のクリックを拾うと、ゲームの上に重ねた窓（DOM）のボタンを押したときに、
    // 真下にあるゲームのボタン（タイトルのメニューなど）まで押されてしまった（2026年10月22日）
    input: { windowEvents: false },
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: '100%',
      height: '100%',
    },
  });
  // 開発中だけ、ブラウザの開発者ツールから画面を確かめられるようにする（公開版には入らない）
  if (import.meta.env.DEV) (window as unknown as { game?: Phaser.Game }).game = game;
  game.scene.add('title', TitleScene, !lobby && !run);
  game.scene.add('region', RegionScene, false);
  game.scene.add('select', SelectScene, false);
  game.scene.add('lobby', LobbyScene, !!lobby, lobby ?? undefined);
  game.scene.add('run', RunScene, !!run, run ?? undefined);
  game.scene.add('result', ResultScene, false);
  game.scene.add('friends', FriendsScene, false);
  game.scene.add('achievements', AchievementsScene, false);
  game.scene.add('shop', ShopScene, false);
  game.scene.add('settings', SettingsScene, false);

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
