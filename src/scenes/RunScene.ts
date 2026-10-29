import Phaser from 'phaser';
import { achievementsConfig, derivedStatSources, playablesConfig, effectRecipes, moveSprites, generated, iconConfig, itemIcons, itemSprites, obstacleSprites, networkConfig, placeholderRender, playerConfig, saveConfig, regionStage, shopConfig, simulationConfig, spriteRender, stageConfig, uiConfig, type RegionStage } from '../data';
import { buildSimRules, localName, mergeModifiers, permanentModifiers, playableLoadout } from '../data/simRules';
import { permanentBonus } from '../meta/shop';
import { emptySave } from '../meta/saveData';
import type { EffectRecipe, SpriteAnims } from '../data/schema';
import { getLocale, t, tMaybe } from '../i18n';
import type { NatureStat } from '../data/schema';
import type { SimRules } from '../sim/rules';
import type { LeaveReason, Room, RoomPlayer } from '../net/room';
import { SyncSession } from '../net/sync';
import { hexColor } from '../render/color';
import { EdgeArrows, type EdgeTarget } from '../render/EdgeArrows';
import { EffectRenderer } from '../render/effects/EffectRenderer';
import { audio } from '../audio';
import { RunSounds } from '../audio/runSounds';
import { MoveSprites, moveSpriteTexture, type SpriteItem, type SpriteSpec } from '../render/effects/MoveSprites';
import { HitShapes } from '../render/effects/HitShapes';
import { ensurePixelTextures, pixelTextureKey } from '../render/PixelArt';
import { ObstacleView } from '../render/ObstacleView';
import { HudIcons } from '../render/HudIcons';
import { ensureIconTextures, iconDataUrl, itemIconKey, moveIconKey } from '../render/Icons';
import { HudCard } from './hudCard';
import { GroundTiles, preloadGroundTiles } from '../render/GroundTiles';
import { KeyboardInput } from '../render/KeyboardInput';
import { orientationGuard } from '../render/OrientationGuard';
import { isTouchDevice, TouchJoystick } from '../render/TouchJoystick';
import { PlayerView } from '../render/PlayerView';
import { PooledCircles, PooledSprites } from '../render/PooledCircles';
import { compactScreen, px } from '../render/pixelUi';
import { preloadPokemonAtlas, registerPokemonAnimations } from '../render/sprites/PokemonSprite';
import { EnemySprites } from '../render/sprites/EnemySprites';
import { SpriteStreamer } from '../render/sprites/SpriteStreamer';
import { loadPokemonAtRuntime } from '../render/sprites/runtimeLoad';
import { addSpriteGallery } from '../render/sprites/SpriteGallery';
import type { Axis, InputCommand, PlayerId } from '../sim/commands';
import { SHAPE_BOX, SHAPE_CIRCLE, SHAPE_LINE, SHAPE_SECTOR } from '../sim/entities/projectiles';
import { abilityOf, pinchMods } from '../sim/ability';
import { FixedStepClock } from '../sim/fixedStep';
import { Simulation } from '../sim/simulation';
import { currentWaveIndex, elapsedSeconds, enemyCap, findEnemyIndex, type Hazard, type SimRole, type World, gateDeadlineTick } from '../sim/world';
import { applyDebugOverrides, parseGodParam, parseLegendParam, parseIntruderParam, parseWingsParam, parseLevelParam, parseMovesParam, parseItemsParam, parseSectionParam, parseTimeParam } from './debugOverrides';
import { addXp, applyOffer, itemFits, moveMaxLevel, recomputeModifiers } from '../sim/systems/leveling';
import { shinySpriteKey } from '../meta/loadoutOptions';
import { achievementPerks, regionAchieved } from '../meta/achievementPerks';
import { regionStats, regionUpgradesOf } from '../meta/regionScope';
import { meets } from '../meta/progress';
import { addDiscovery } from '../meta/discoveries';
import { achievementName, achievementRewardById } from '../meta/achievementText';
import { RunRecorder } from '../meta/runRecorder';
import { clearRunProbe, writeRunProbe } from '../meta/runProbe';
import { session } from '../meta/session';
import { LevelUpPanel, offerText } from './levelUpPanel';
import { activeField, activeLegendField, currentWeather, startIntruder, startLegendary, legendRoundKinds } from '../sim/systems/stage';
import { PausePanel } from './pausePanel';
import { EvolutionCutscene } from './evolutionCutscene';
import { NetPanel } from './netPanel';
import { formatTime, type ResultSceneData } from './ResultScene';
import { atlasKey } from '../render/sprites/PokemonSprite';
import { holdScreenAwake } from '../render/screenWakeLock';
import { DamageNumbers } from '../render/DamageNumbers';
import { displaySettings } from '../render/displaySettings';

/** ソロとホストのプレイヤーの番号（ゲストは部屋でもらった番号 2〜） */
const HOST_PLAYER_ID: PlayerId = 1;

/** 協力プレイのラン（待合室で決まったもの） */
export interface CoopRun {
  room: Room;
  /** 参加者とポケモン（番号の順） */
  players: RoomPlayer[];
  /** スプライトのキー（色違いは <キー>-shiny）ごとのスプライト（待合室で読み込んだもの） */
  sprites: Map<string, SpriteAnims | null>;
}

export interface RunSceneData {
  /** 自分のポケモン（data/game/playables.json のキー） */
  pokemon: string;
  /** 遊ぶ地方（data/game/regions.json の id。区間・ボスは data/regions/<地方>.json）。省くとカントー */
  region?: string;
  /** 自分のスプライト。取得していなければ null（仮の円で描く） */
  playerSprite: SpriteAnims | null;
  /** 協力プレイ。ソロなら null */
  coop: CoopRun | null;
  /** ソロ: 最初に持っていく持ち物（無ければ null）と、色違いで遊ぶか。協力プレイでは players の各自の値を使う */
  startItem?: string | null;
  shiny?: boolean;
  /** タマゴからかえった（pokemon はかえったベイビィポケモン、hatchedFrom は選んだタマゴ。最初にかえる演出を見せる。07 の57章） */
  hatchedFrom?: string;
}

/**
 * ラン中のシーン。
 * 入力 → コマンド → 固定間隔でシミュレーションを進める → 補間して描く、の流れを担う。
 * 協力プレイでは、届いたメッセージもコマンドに直して同じ流れに乗せる。
 */
/** ボスの HP バーを並べる数の上限 */
const BOSS_BARS_MAX = 4;

export class RunScene extends Phaser.Scene {
  private sim!: Simulation;
  /** 自分の攻撃のダメージの数字（設定でオンのときだけ作る） */
  private damageNumbers: DamageNumbers | null = null;
  private clock!: FixedStepClock;
  private keyboard!: KeyboardInput;
  /** スマホのジョイスティック（タッチの端末だけ） */
  private joystick: TouchJoystick | null = null;
  private playerViews = new Map<PlayerId, PlayerView>();
  /** 持ち主の残像として飛ぶ技（ゴッドバード）の絵 */
  private ghostImages: Phaser.GameObjects.Image[] = [];
  /** 通った道を残る範囲にする技（芯を描かない） */
  private pathMoves = new Set<number>();
  /** 効き方から出た円を光らせる技（10まんボルト）。技の番号 → 色の切り替え */
  private flashMoves = new Map<number, NonNullable<EffectRecipe['burstFlash']>>();
  /** 落雷の稲妻を描く技（かみなり）と、その絵 */
  private boltMoves = new Map<number, NonNullable<EffectRecipe['bolt']>>();
  private boltView: Phaser.GameObjects.Graphics | null = null;
  /** 空から塊が落ちてくる技（つららおとし）と、その絵・落ちている塊の通し番号・塊の影 */
  private fallMoves = new Map<number, NonNullable<EffectRecipe['fall']>>();
  private fallSprites: MoveSprites | null = null;
  private falling = new Map<number, { x: number; y: number; radius: number; move: number }>();
  private fallShadows: Phaser.GameObjects.Graphics | null = null;
  /** 稲妻の線で描く技 */
  private lightningMoves = new Set<number>();
  /** 技のドット絵 */
  private moveSprites: MoveSprites | null = null;
  /** ボスの範囲技が落ちたときのドット絵（案 F） */
  private strikeSprites: MoveSprites | null = null;
  private strikes: { item: Omit<SpriteItem, 'elapsed' | 'alpha'>; start: number; seconds: number }[] = [];
  /** 画面をうっすら光らせた当たり判定の通し番号（同じものでは1回だけ） */
  private flashedSerials = new Set<number>();
  private enemyView!: PooledCircles;
  private gemView!: PooledSprites;
  /** 敵をスプライトで描く（読み込み済みの種類だけ。まだの種類は円で描く） */
  private enemySpriteView!: EnemySprites;
  private streamer!: SpriteStreamer;
  /** 1フレームの処理時間（シミュレーション・描画の命令を含む。移動平均, ms） */
  private frameMs = 0;
  private statusColors: number[] = [];
  private effects!: EffectRenderer;
  private sounds!: RunSounds;
  /** 遊ぶ地方のステージ（区間ごとの地面・曲・夜） */
  private stageOfRegion!: RegionStage;
  private hitShapes!: HitShapes;
  /** 技ごとの縁取りの色（明るい線・暗い線）。描かない技は null */
  private shapeColors: ({ color: number; alpha: number } | null)[] = [];
  private ground!: GroundTiles;
  /** F3 の詳しい表示（ふだんは出さない） */
  private hud!: Phaser.GameObjects.Text;
  /** 画面上部: 経験値のバー（中にレベル）・コイン（作者の決定。2026年10月22日） */
  private topBar!: Phaser.GameObjects.Graphics;
  private levelText!: Phaser.GameObjects.Text;
  private coinIcon!: Phaser.GameObjects.Image;
  /** 右上の自分の性格（ホウエン。07 の89.3）。性格の無い地方では出さない */
  private natureText!: Phaser.GameObjects.Text;
  /** 自分の特性（ホウエン。07 の133章）。HP が少なくて効いている間は色を変える */
  private abilityText!: Phaser.GameObjects.Text;
  private coinText!: Phaser.GameObjects.Text;
  /** 倒れているときの案内（真ん中の下） */
  private downText!: Phaser.GameObjects.Text;
  /** 持っている技・持ち物・パッシブのアイコンとレベルの星 */
  private hudIcons!: HudIcons;
  /** アイコンにマウスを乗せたときの詳細カード（PC だけ） */
  private hudCard!: HudCard;
  /** タッチ: タップして出している詳細カードのアイコン（07 の111章） */
  private pinnedCard: { kind: 'move' | 'item'; slot: number } | null = null;
  /** 画面の外の大事なものの方向を示す矢印 */
  private edgeArrows!: EdgeArrows;
  /** アイコンの列の上端（画面の y） */
  private hudTop = 0;
  private lastSent: { dx: Axis; dy: Axis } = { dx: 0, dy: 0 };
  private lastSteps = 0;
  /** シミュレーション1回あたりの処理時間（移動平均, ms） */
  private simMs = 0;
  private playerSprite: SpriteAnims | null = null;
  private pokemon = '';
  /** ソロの、最初の持ち物と色違い */
  private startItem: string | null = null;
  private shiny = false;
  /** 色違いで遊んでいるプレイヤー（進化したときの見た目に使う） */
  private shinyPlayers = new Set<PlayerId>();
  private coop: CoopRun | null = null;
  private panel: NetPanel | null = null;
  private sync: SyncSession | null = null;
  /** 届いたメッセージを直したコマンド（次の更新で適用する） */
  private inbox: InputCommand[] = [];
  private localId: PlayerId = HOST_PLAYER_ID;
  private netStartedAt = 0;
  /** タブが隠れている間にシミュレーションを進めるタイマー */
  private hiddenTimer: ReturnType<typeof setInterval> | null = null;
  /** 最後に描画のタイミングが来た時刻 */
  private lastFrameAt = 0;
  private levelUpPanel!: LevelUpPanel;
  /** ポーズの画面（Esc）と、ゲストが止めずに開いている設定の画面 */
  private pausePanel!: PausePanel;
  private settingsOpen = false;
  /** テストプレイ: 最初から戦う伝説（無ければ null）・無敵・無敵の間に受けたはずのダメージの合計 */
  private testLegend: number | null = null;
  /** ?legendafter: この更新回数になったら伝説戦を始める（-1 なら始めた後） */
  private testLegendTick = -1;
  /** ?intruder・?wings を付けたラン（記録を保存しない） */
  private testRun = false;
  private god = false;
  private godDamage = 0;
  private godText: Phaser.GameObjects.Text | null = null;
  /** 伝説戦のマップの効果で画面に重ねる色（サンダーで暗く・フリーザーで白っぽく） */
  private fieldOverlay: Phaser.GameObjects.Rectangle | null = null;
  /** サンダーの空の明滅: 最後に光った時刻・次に光る時刻（ms） */
  private skyFlashAt = -1e9;
  private nextSkyFlashAt = 0;
  /** 進化の演出（自分が進化したとき。ソロでは演出の間ゲームを止める） */
  private evolutionCutscene = new EvolutionCutscene();
  /** 協力プレイのレベルアップで、ほかの人の選択を待っている間の表示 */
  private waitingOverlay: HTMLDivElement | null = null;
  /** ラン中の記録（撃破数など）をセーブデータに足す */
  private recorder!: RunRecorder;
  private runRecorded = false;
  /** 画面の操作（レベルアップの選択など）から作ったコマンド。次の更新で渡す */
  private uiCommands: InputCommand[] = [];
  /** ボスの範囲技の予告 */
  private hazardView!: Phaser.GameObjects.Graphics;
  /** マップに落ちている道具（きずぐすり・マグネット・ふしぎなアメ）の影と、道具ごとのドット絵 */
  private itemView!: Phaser.GameObjects.Graphics;
  private readonly itemImages = new Map<number, Phaser.GameObjects.Image>();
  /** マップの箱の絵（箱の id → 絵）と、右上の一時的な強化のアイコン */
  private readonly boxImages = new Map<number, Phaser.GameObjects.Image>();
  private buffIcons: { icon: Phaser.GameObjects.Image; text: Phaser.GameObjects.Text }[] = [];
  /** マップの障害物 */
  private obstacleView!: ObstacleView;
  /** 画面上の真ん中: 経過時間、中ボス・ボスの HP、お知らせ */
  private timerText!: Phaser.GameObjects.Text;
  private bossBar!: Phaser.GameObjects.Graphics;
  /** ボスの名前（HP バーごと。大ボスが何体もいるときは、バーを縦に並べて左に名前） */
  private readonly bossNames: Phaser.GameObjects.Text[] = [];
  /** 今並べているボスの HP バーの本数 */
  private bossRows = 0;
  private announceText!: Phaser.GameObjects.Text;
  /** HP のバーを出している中ボス・ボス（最後に出たもの） */
  private bossId: number | null = null;
  /** 出た中ボス・ボス（ホウエンのタッグは2体とも HP のバーを出す）。倒れたものは描くときに外す */
  private bossIds: number[] = [];
  /** 詳しい情報（確認用）を出すか。F3 で切り替える */
  private showDebug = false;
  /** ランが終わって結果画面へ移る時刻（performance.now） */
  private resultAt: number | null = null;
  private runData!: RunSceneData;

  constructor() {
    super('run');
  }

  init(data: RunSceneData): void {
    // 結果画面から「もう一度」で同じシーンを始め直すので、前のランの状態を残さない
    this.runData = data;
    this.playerViews = new Map();
    this.ghostImages = [];
    // 地面の道具・箱の絵と右上の強化のアイコン: 前のランの絵はシーンを閉じたときに壊れているので、持ち越さない
    // （持ち越すと、2回目以降のランで☆を拾ったときに壊れた絵を触って例外になり、描画が止まった。作者の報告 2026年10月26日）
    this.itemImages.clear();
    this.boxImages.clear();
    this.buffIcons = [];
    this.fieldOverlay = null;
    this.godText = null;
    this.boltView = null;
    this.flashedSerials = new Set();
    this.inbox = [];
    this.uiCommands = [];
    this.lastSent = { dx: 0, dy: 0 };
    this.sync = null;
    this.lastHeard = new Map();
    this.hiddenTimer = null;
    this.bossId = null;
    this.bossIds = [];
    this.bossRows = 0;
    this.resultAt = null;
    this.runRecorded = false;
    this.probeTrend = [];
    this.probeTrendAt = 0;
    this.newAchievements = [];
    this.newUnlocks = [];
    this.legendaryResult = null;
    // 回復とコインの自動選択はランごと（前のランの設定を引き継がない）
    this.autoFallback = null;
    this.autoNext = 'heal';
    this.autoRequested = -1;
    this.settingsOpen = false;
    this.showDebug = new URLSearchParams(window.location.search).has('debug');
    this.playerSprite = data.playerSprite;
    this.pokemon = data.pokemon;
    this.stageOfRegion = regionStage(data.coop?.room.region || data.region);
    this.startItem = data.startItem ?? null;
    this.shiny = !!data.shiny;
    this.shinyPlayers = new Set();
    this.coop = data.coop;
    this.panel = null;
  }

  preload(): void {
    preloadGroundTiles(this, this.stageOfRegion.ground);
    // ポケモン選択の画面で読み込み済みなら読み直さない
    if (this.playerSprite && !this.textures.exists(atlasKey(this.playerSprite.key))) preloadPokemonAtlas(this, this.playerSprite);
  }

  create(): void {
    // スマホで画面が消えて通信が止まらないように、この画面の間は画面を点けたままにする（作者の報告 2026年10月28日）
    const releaseWakeLock = holdScreenAwake();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, releaseWakeLock);
    if (this.playerSprite) registerPokemonAnimations(this, this.playerSprite);
    const rules = applyDebugOverrides(buildSimRules(this.stageOfRegion.id), window.location.search);
    this.pathMoves = new Set(rules.moves.flatMap((m, k) => (m.effects.some((fx) => fx.puddle?.path) ? [k] : [])));
    this.lightningMoves = new Set(rules.moves.flatMap((m, k) => (effectRecipes[m.effect]?.lightningLine ? [k] : [])));
    this.boltMoves = new Map(rules.moves.flatMap((m, k) => { const b = effectRecipes[m.effect]?.bolt; return b ? [[k, b] as const] : []; }));
    this.flashMoves = new Map(rules.moves.flatMap((m, k) => { const f = effectRecipes[m.effect]?.burstFlash; return f ? [[k, f] as const] : []; }));
    this.fallMoves = new Map(rules.moves.flatMap((m, k) => { const f = effectRecipes[m.effect]?.fall; return f ? [[k, f] as const] : []; }));
    // 技は確認用に URL で指定できる（?moves=ember:8,fire-spin:3）。協力プレイでは参加用 URL に引き継ぐので2人とも同じになる
    const role: SimRole = this.coop?.room.role ?? 'solo';
    this.localId = this.coop?.room.localId ?? HOST_PLAYER_ID;
    this.sim = new Simulation({
      tickRate: simulationConfig.tickRate,
      seed: this.coop?.room.seed ?? simulationConfig.defaultSeed,
      rules,
      role,
      localPlayerId: this.localId,
    });
    const roster: RoomPlayer[] = this.coop?.players ?? [
      { id: HOST_PLAYER_ID, pokemon: this.pokemon, upgrades: regionUpgradesOf(session.store.current, this.stageOfRegion.id), achievements: session.store.current.achievements, startItem: this.startItem, shiny: this.shiny },
    ];
    // 伝説戦の相性で選ぶ候補（色違いの御三家）: 参加者のだれかが条件の実績を達成していれば足す（どのブラウザでも同じ）
    const counter = rules.stage.legendary?.counter;
    this.sim.world.legendaryCounter = !!counter && roster.some((r) => counter.achievements.some((a) => r.achievements.includes(a)));
    // 決まった伝説（ミュウ）: 抽選はソロ・ホストだけなので、このブラウザの記録で決める
    const force = rules.stage.legendary?.forceKind;
    const myStats = regionStats(session.store.current.stats, this.stageOfRegion.id);
    this.sim.world.legendaryForce = !!force && !meets(myStats, force.until);
    // 会えないほど会いやすく: クリアの回数ごとに、伝説戦の起きる確率を上げる
    if (this.sim.world.legendaryForce && force?.chanceUp) this.sim.world.legendaryChanceBonus = force.chanceUp.step * (myStats[force.chanceUp.stat] ?? 0);
    // はね（ルギア・ホウオウ戦の権利）: 参加者のだれかが条件の実績を達成していれば、箱から出るようになる（どのブラウザでも同じ）
    for (const b of rules.stage.legendary?.bonusRounds ?? []) if (roster.some((r) => r.achievements.includes(b.achievement))) this.sim.world.wingsEnabled.add(b.item);
    // 実績の報酬（07 23・24章）: 各自の達成した実績から、解放した持ち物・特殊なバフを計算する。協力プレイの経験値は部屋の全員に
    // 報酬は、遊ぶ地方の実績のぶんだけ（02 の17章）
    const perksOf = new Map(roster.map((r) => [r.id, achievementPerks(achievementsConfig, regionAchieved(achievementsConfig, r.achievements, this.stageOfRegion.id), this.stageOfRegion.id)]));
    const coopXpPct = role === 'solo' ? 0 : Math.max(0, ...[...perksOf.values()].map((x) => x.coopXpPct));
    // 確認用の ?moves= はソロのときだけ
    const debugMoves = this.coop ? null : parseMovesParam(rules, window.location.search);
    const debugItems = this.coop ? null : parseItemsParam(rules, window.location.search);
    for (const { id, pokemon, upgrades, startItem, shiny } of roster) {
      const loadout = playableLoadout(rules, pokemon);
      const perks = perksOf.get(id)!;
      // 最初の技のレベル（クリアの実績の報酬）
      const startLevel = perks.startMoveLevel[loadout.line] ?? 1;
      const startMoves = loadout.moves.map((m) => ({ ...m, level: Math.max(m.level, Math.min(startLevel, rules.moves[m.move]!.levels.length)) }));
      // 永続の効果: ショップ ＋ 実績のバフ ＋ 協力プレイの経験値
      const permanent = mergeModifiers(rules, permanentModifiers(rules, permanentBonus({ ...emptySave(), upgrades: { ...upgrades } }, shopConfig).levels), {
        ...perks.mods,
        xpPct: (perks.mods.xpPct ?? 0) + coopXpPct,
      });
      // フレンドリィショップの強化（01_game_design.md 8.3）。協力プレイでは各自の強化を待合室で受け取っている
      const bonus = permanentBonus({ ...emptySave(), upgrades: { ...upgrades } }, shopConfig);
      this.sim.world.revives += bonus.revives;
      const p = this.sim.addPlayer({
        id,
        x: playerConfig.spawnX + (id - 1) * networkConfig.guestSpawnOffsetX,
        y: playerConfig.spawnY,
        radius: playerConfig.radius,
        moveSpeed: playerConfig.moveSpeed,
        remote: id !== this.localId,
        pickupRange: playerConfig.pickupRange,
        types: loadout.types,
        moveTypes: loadout.moveTypes,
        fixedMoves: loadout.fixedMoves,
        learnsAll: loadout.learnsAll,
        moves: debugMoves ?? startMoves,
        line: loadout.line,
        species: loadout.species,
        rerolls: rules.leveling.initialRerolls + bonus.rerolls,
        permanent,
        bans: bonus.bans,
        unlockedItems: new Set(rules.items.flatMap((it, i) => (perks.items.has(it.key) ? [i] : []))),
        extraItemSlots: perks.itemSlots,
        candyWeight: perks.candyWeight,
      });
      // 最初の持ち物（作者の決定 2026年10月24日: そのポケモンでクリアすると選べる）。候補に出ないもの（解放していない・タイプが合わない）は持たない
      const start = startItem ? rules.items.findIndex((it) => it.key === startItem) : -1;
      if (start >= 0 && itemFits(rules, p, start)) applyOffer(this.sim.world, p, { kind: 'itemNew', item: start });
      // 確認用の ?items= もソロのときだけ
      if (debugItems) {
        for (const it of debugItems) if (!p.items.some((x) => x.item === it.item)) p.items.push({ ...it });
        recomputeModifiers(this.sim.world, p);
      }
      if (shiny) this.shinyPlayers.add(id);
      const spriteKey = playablesConfig.pokemon[pokemon]?.sprite ?? pokemon;
      const sprite = id === this.localId ? this.playerSprite : (this.coop?.sprites.get(shiny ? shinySpriteKey(spriteKey) : spriteKey) ?? null);
      const view = new PlayerView(this, p, placeholderRender, spriteRender, sprite, true);
      // 自分をほかのプレイヤーより手前に
      view.container.setDepth(spriteRender.depths.players + (id === this.localId ? 0.1 : 0));
      // 相手のプレイヤーは少し透かして見分ける
      if (p.remote) view.container.setAlpha(0.7);
      this.playerViews.set(id, view);
    }
    // 確認用: ?level=15 で、そのレベルから始める（選択は飛ばす。進化の条件は最初の更新で判定される）
    const startLevel = parseLevelParam(window.location.search);
    if (startLevel) {
      const w = this.sim.world;
      let need = 0;
      for (let l = 1; l < Math.min(startLevel, w.rules.leveling.maxLevel); l++) need += w.rules.leveling.xpToNext[l]!;
      addXp(w, need);
      w.pendingLevelUps = 0;
      w.maxLevelUps = 0;
      w.events.length = 0;
    }
    // 確認用: ?time=880 で、ランの途中の時刻から始める（それより前のスウォームは出さない）。
    // ?section=3 で、その区間から始める（それより前の区間の中ボスは出さない）
    const startTime = parseTimeParam(window.location.search);
    if (startTime) {
      const w = this.sim.world;
      w.tick = Math.round(startTime * simulationConfig.tickRate);
      w.sectionStartTick = w.tick;
      while (w.nextSwarm < w.swarmSchedule.length && w.swarmSchedule[w.nextSwarm]!.tick < w.tick) w.nextSwarm++;
    }
    const startSection = parseSectionParam(window.location.search);
    if (startSection) {
      const w = this.sim.world;
      w.section = Math.min(startSection, w.waves.length - 1);
      while (w.nextBoss < w.bossSchedule.length && w.bossSchedule[w.nextBoss]!.wave < w.section) w.nextBoss++;
    }
    // テストプレイ（ソロだけ）: ?legend=mewtwo で最初から伝説と戦う。?god で無敵。どちらかを付けたランは記録を保存しない
    this.testLegend = this.coop ? null : parseLegendParam(this.sim.world.rules, window.location.search);
    this.god = !this.coop && parseGodParam(window.location.search);
    this.godDamage = 0;
    // ?legendafter=8 で、伝説戦を始めるのを8秒後にする（雑魚の中に「DANGER」。宣伝の動画。作者の依頼 2026年10月30日）
    const legendAfter = Number(new URLSearchParams(window.location.search).get('legendafter')) || 0;
    if (this.testLegend !== null) {
      if (legendAfter > 0) this.testLegendTick = this.sim.world.tick + Math.round(legendAfter * simulationConfig.tickRate);
      else startLegendary(this.sim.world, this.testLegend);
    }
    // テストプレイ（ソロだけ）: ?intruder=raikou で三犬が乱入する。?wings ではねを持っている。どちらも記録を保存しない
    const testIntruder = this.coop ? null : parseIntruderParam(this.sim.world.rules, window.location.search);
    if (testIntruder !== null) startIntruder(this.sim.world, testIntruder);
    if (!this.coop && parseWingsParam(window.location.search)) for (const w of ['silver-wing', 'rainbow-wing'] as const) this.sim.world.wings.add(w);
    this.testRun = testIntruder !== null || (!this.coop && parseWingsParam(window.location.search));
    if (this.coop) this.setupNet(this.coop.room);

    this.clock = new FixedStepClock(simulationConfig.tickRate, simulationConfig.maxTicksPerFrame);
    this.keyboard = new KeyboardInput(this);
    if (isTouchDevice()) {
      // 技・持ち物のアイコンを触ったときはジョイスティックを出さない（タップで詳細カード。07 の111章）
      const stick = new TouchJoystick(this.game.canvas, (x, y) => this.hudIconAt(x, y) !== null);
      this.joystick = stick;
      this.pinnedCard = null;
      // タッチ: アイコンをタップすると詳細カードを出し、同じアイコンかほかの場所をタップすると閉じる
      const onTap = (ev: PointerEvent): void => {
        if (ev.pointerType === 'mouse' || ev.target !== this.game.canvas) return;
        const target = this.hudIconAt(ev.clientX, ev.clientY);
        const same = target && this.pinnedCard && target.kind === this.pinnedCard.kind && target.slot === this.pinnedCard.slot;
        this.pinnedCard = same ? null : target;
      };
      window.addEventListener('pointerdown', onTap);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => window.removeEventListener('pointerdown', onTap));
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        stick.destroy();
        this.joystick = null;
      });
    }
    // 地面の色: ホウエンの天気の色、夜の区間は夜の色
    const night = this.stageOfRegion.night;
    this.ground = new GroundTiles(this, this.stageOfRegion.ground, currentWaveIndex(this.sim.world), (wave) =>
      currentWeather(this.sim.world)?.field.groundTint ?? (night[Math.min(wave, night.length - 1)] ? this.stageOfRegion.ground.nightTint : null),
    );
    // 重なりの順は data/render/sprites.json の depths（プレイヤー ＞ 技 ＞ ボス ＞ 雑魚 ＞ アイテム）
    const depths = spriteRender.depths;
    this.enemyView = new PooledCircles(this, depths.enemies);
    this.gemView = new PooledSprites(this, depths.gems, itemSprites.dot);
    this.itemView = this.add.graphics().setDepth(depths.items);
    ensurePixelTextures(this, itemSprites);
    this.edgeArrows = new EdgeArrows(this, uiConfig.edgeArrows, (obj, x, y) => this.placeUi(obj, x, y));
    // 障害物は地面の飾りなので、アイテムより奥
    this.obstacleView = new ObstacleView(this, obstacleSprites, depths.obstacles);
    this.streamer = new SpriteStreamer(
      this,
      rules.enemies.kinds.map((k) => k.sprite),
      Math.round(spriteRender.enemyPreloadSeconds * simulationConfig.tickRate),
    );
    // 雑魚の絵はランが終わったら解放する（07 の114章）
    const streamer = this.streamer;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => streamer.unloadAll());
    this.enemySpriteView = new EnemySprites(
      this,
      (kind) => this.streamer.manifestOf(kind),
      spriteRender.enemyScale,
      spriteRender.enemyAnimation,
      depths.enemies,
      (kind) => rules.enemies.kinds[kind]?.spriteScale ?? 1,
      (kind) => enemyLayer(rules, kind),
      // 中ボス・ボス・伝説は技より手前（作者の決定 2026年10月23日）
      (kind) => ((rules.enemies.kinds[kind]?.rank ?? 'normal') !== 'normal' ? depths.bosses : null),
    );
    this.hazardView = this.add.graphics().setDepth(depths.hazards);
    this.measureFrameTime();
    // ゲストの選択はホストが確定するので、要望としてホストへ送る
    const guest = role === 'guest';
    ensureIconTextures(this, iconConfig, rules, itemIcons);
    this.levelUpPanel = new LevelUpPanel({
      iconUrl: (key) => iconDataUrl(this, key),
      choose: (index) => (guest ? this.sync?.requestUpgrade('c', index) : this.uiCommands.push({ type: 'chooseUpgrade', playerId: this.localId, index })),
      reroll: () => (guest ? this.sync?.requestUpgrade('r') : this.uiCommands.push({ type: 'rerollUpgrades', playerId: this.localId })),
      skip: () => (guest ? this.sync?.requestUpgrade('s') : this.uiCommands.push({ type: 'skipUpgrade', playerId: this.localId })),
      ban: (index) => (guest ? this.sync?.requestUpgrade('b', index) : this.uiCommands.push({ type: 'banUpgrade', playerId: this.localId, index })),
      auto: (mode) => {
        this.autoFallback = mode;
        this.autoNext = mode === 'coins' ? 'coins' : 'heal';
      },
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.levelUpPanel.hide());
    this.statusColors = this.sim.world.statusKinds.map((k) => hexColor(k.color));
    this.effects = new EffectRenderer(this, effectRecipes, depths.effects, spriteRender.effectPixel);
    // ダメージの数字（設定でオン。07 の102章）: プレイヤーより上・画面の表示より下
    this.damageNumbers = null;
    this.setDamageNumbers(displaySettings.current.damageNumbers);
    // 技のドット絵は光の演出の少し下（光の粒が上に重なる）
    this.moveSprites = new MoveSprites(this, moveSprites, depths.effects - 0.1, spriteRender.dot);
    this.strikeSprites = new MoveSprites(this, moveSprites, depths.effects - 0.05, spriteRender.dot);
    this.fallSprites = new MoveSprites(this, moveSprites, depths.effects + 0.25, spriteRender.dot);
    this.strikes = [];
    const shape = spriteRender.hitShape;
    this.hitShapes = new HitShapes(this, depths.hitShapes, shape);
    this.shapeColors = rules.moves.map((m) => {
      if (shape.moves && !shape.moves.includes(m.key)) return null;
      const body = effectRecipes[m.effect]?.projectile;
      return { color: hexColor(body?.glowColor ?? '#ffffff'), alpha: body?.shapeAlpha ?? shape.fillAlpha };
    });
    const local = this.sim.world.players.find((p) => p.id === this.localId)!;
    if (this.playerSprite && new URLSearchParams(window.location.search).has('gallery')) {
      addSpriteGallery(this, this.playerSprite, spriteRender, local.x, local.y - 200);
    }
    this.hud = this.add
      .text(8, 8, '', px(8, '#ffffff', { backgroundColor: '#000000a0', lineSpacing: 4 }))
      .setScrollFactor(0)
      .setDepth(1000);
    this.hudIcons = new HudIcons(this);
    const card = new HudCard((key) => iconDataUrl(this, key));
    this.hudCard = card;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => card.destroy());
    this.topBar = this.add.graphics().setScrollFactor(0).setDepth(1000);
    this.levelText = this.add.text(0, 0, '', px(16, uiConfig.expBar.text, { outline: true })).setOrigin(0, 0.5).setScrollFactor(0).setDepth(1001);
    this.coinIcon = this.add.image(0, 0, pixelTextureKey('coin')).setOrigin(1, 0.5).setScale(2).setScrollFactor(0).setDepth(1001);
    this.coinText = this.add.text(0, 0, '', px(16, uiConfig.coin.color, { outline: true })).setOrigin(1, 0.5).setScrollFactor(0).setDepth(1001);
    this.natureText = this.add.text(0, 0, '', px(16, '#ffffff', { outline: true })).setOrigin(1, 0.5).setScrollFactor(0).setDepth(1001);
    this.abilityText = this.add.text(0, 0, '', px(16, '#ffffff', { outline: true })).setOrigin(1, 0.5).setScrollFactor(0).setDepth(1001);
    this.timerText = this.add.text(0, 10, '', px(compactScreen() ? uiConfig.compactHud.timerSize : 24, uiConfig.timer.color, { outline: true })).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1000);
    this.bossBar = this.add.graphics().setScrollFactor(0).setDepth(1000);
    this.bossNames.length = 0;
    this.announceText = this.add.text(0, 0, '', px(32, '#ffffff', { outline: true, align: 'center', lineSpacing: 8 })).setOrigin(0.5).setScrollFactor(0).setDepth(1001);
    this.downText = this.add.text(0, 0, '', px(16, '#ffffff', { outline: true, align: 'center' })).setOrigin(0.5).setScrollFactor(0).setDepth(1001);
    this.input.keyboard?.on('keydown-F3', () => {
      this.showDebug = !this.showDebug;
    });
    // Esc でポーズ（作者の決定 2026年10月25日）: ソロとホストは全員のゲームを止める。ホスト以外は止めずに設定の画面だけ。
    // レベルアップの選択中（Esc は除外のモードをやめるのに使う）とランの終わりには使わない
    this.pausePanel = new PausePanel(
      () => this.togglePause(),
      (on) => this.setDamageNumbers(on),
      () => this.natureRows(),
    );
    this.evolutionCutscene = new EvolutionCutscene();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.evolutionCutscene.destroy());
    // タマゴからかえった: 最初にかえる演出（07 の57章）。ソロは演出の間ゲームを止め、協力プレイは止めずに薄く重ねる
    const egg = this.runData.hatchedFrom;
    if (egg) {
      const eggSprite = playablesConfig.pokemon[egg]?.sprite ?? egg;
      const babySprite = playablesConfig.pokemon[this.pokemon]?.sprite ?? this.pokemon;
      const baby = localName(generated.pokemon[this.pokemon]?.names, getLocale(), this.pokemon);
      this.evolutionCutscene.playHatch(eggSprite, this.shinyPlayers.has(this.localId) ? shinySpriteKey(babySprite) : babySprite, baby, this.coop ? 0.3 : 0.65);
    }
    // 協力プレイで自分が選び終えた後: 画面を少しだけ暗くして、ほかの人を待っていることを出す
    this.waitingOverlay = document.createElement('div');
    this.waitingOverlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.3);display:none;align-items:center;justify-content:center;pointer-events:none;z-index:15;color:#f8f8f8;font-size:22px;text-shadow:0 2px 0 #000';
    document.body.append(this.waitingOverlay);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.waitingOverlay?.remove());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.pausePanel.destroy());
    this.input.keyboard?.on('keydown-ESC', () => this.togglePause());
    // M で音を消す・戻す（音量は タイトルの O の設定）
    this.input.keyboard?.on('keydown-M', () => {
      audio.settings.update({ muted: !audio.settings.current.muted });
      this.announce(t(audio.settings.current.muted ? 'audio.muted' : 'audio.unmuted'), '#cfd8dc');
    });
    this.sounds = new RunSounds(this.localId, this.stageOfRegion.bgmRun);
    this.applyZoom();
    this.scale.on('resize', this.applyZoom, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.applyZoom, this);
      // ほかの画面は画面いっぱいに描く
      const parent = this.game.canvas.parentElement;
      if (parent) {
        parent.style.width = '';
        parent.style.margin = '';
        this.scale.getParentBounds();
        this.scale.refresh();
      }
    });
    // 時計を作った後で始める
    if (this.coop) this.keepRunningWhenHidden();
    this.setupSaving();
    session.setPresence('run');
  }

  /**
   * 協力プレイの通信をつなぐ。ホストは各ゲストと、ゲストはホストとだけ通信する。
   * 1つでも中継の通信路があれば、送る頻度を中継に合わせて下げる
   */
  private setupNet(room: Room): void {
    const relay = [...room.transports.values()].some((t) => t.kind === 'relay');
    this.sync = new SyncSession(relay ? networkConfig.relay : networkConfig.p2p, networkConfig.pingIntervalMs);
    this.panel = new NetPanel();
    this.panel.hide();
    const panel = this.panel;
    // ランの画面を離れたら部屋を出る（ホストなら部屋ごと消える）
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      panel.hide();
      room.onLeave = null;
      void room.leave();
    });
    const start = performance.now();
    for (const id of room.transports.keys()) {
      this.lastHeard.set(id, start);
      room.attach(id, (messages) => {
        this.lastHeard.set(id, performance.now());
        if (this.sync) this.inbox.push(...this.sync.incoming(this.sim.world, messages, id));
      });
    }
    // なにも届かない時間が続いたら、切断したものとみなす
    let watchedAt = performance.now();
    const watchdog = setInterval(() => {
      const now = performance.now();
      // このブラウザ自身がしばらく止まっていた（スマホの画面が消えた・アプリを切り替えた）: 止まっていた間に届かなかったのは相手のせいではないので、待ち直す
      const gap = (now - watchedAt) / 1000;
      watchedAt = now;
      if (gap >= networkConfig.freezeDetectSeconds) {
        this.lastFreeze = { at: now, seconds: gap };
        console.info('[net] このブラウザが止まっていた', gap.toFixed(1), '秒');
        for (const id of this.lastHeard.keys()) this.lastHeard.set(id, now);
      }
      for (const [id, at] of this.lastHeard) {
        if (now - at > networkConfig.silenceTimeoutSeconds * 1000) {
          this.lastHeard.delete(id);
          room.disconnect(id);
        }
      }
    }, 1000);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => clearInterval(watchdog));
    room.onLeave = (id, reason) => {
      const why = this.leaveReasonText(reason);
      if (id === HOST_PLAYER_ID) {
        // ランの終わりを受け取った後なら、ホストが先に結果画面へ移って部屋を出ただけ（切断ではない。作者の報告 2026年10月30日）
        if (this.sim.world.outcome || this.inbox.some((c) => c.type === 'endRun')) return;
        // ホストとの接続が切れたら、ランを終えて（ここまでの記録を保存して）結果画面へ
        this.disconnectReason = why;
        this.panel?.show('net.hostLeft', undefined, why);
        this.inbox.push({ type: 'endRun', outcome: 'disconnected' });
      } else {
        // ランが終わった後に抜けたゲストは、先に結果画面へ移っただけ
        if (this.sim.world.outcome) return;
        // ホスト: 抜けたプレイヤーを外して続ける（ゲストへも知らせる）
        this.leaveReasons.set(id, why);
        this.inbox.push({ type: 'removePlayer', playerId: id });
      }
    };
    this.netStartedAt = performance.now();
  }

  /** 回復とコインしか出ないときの自動選択（null なら選ぶ画面を出す）・次に選ぶもの・最後に頼んだレベルアップの回（通し番号） */
  private autoFallback: 'heal' | 'coins' | 'alternate' | null = null;
  private autoNext: 'heal' | 'coins' = 'heal';
  private autoRequested = -1;

  /** Esc・ポーズの画面のボタン: ソロとホストは止める・再開する（ホストは全員へ送る）。ゲストは設定の画面を開く・閉じる */
  /** ダメージの数字を出す・出さない（ランの最初と、ポーズの画面で切り替えたとき。07 の102章・110章） */
  private setDamageNumbers(on: boolean): void {
    this.sim.world.damageNumbers = on;
    if (on) this.damageNumbers ??= new DamageNumbers(this, spriteRender.depths.candy + 1);
    else this.damageNumbers?.clear();
  }

  private togglePause(): void {
    const w = this.sim.world;
    if (w.outcome) return;
    if (w.role === 'guest') {
      // ホストが止めている間は、ゲストは閉じられない
      if (w.paused) return;
      this.settingsOpen = !this.settingsOpen;
      return;
    }
    if (w.levelUp) return;
    this.uiCommands.push({ type: 'setPause', paused: !w.paused });
  }

  /** 相手ごとの、最後に通信が届いた時刻 */
  private lastHeard = new Map<PlayerId, number>();
  /** このブラウザが最後に止まっていた時（画面が消えた・アプリを切り替えたなどでタイマーごと止まった。performance.now）と秒数 */
  private lastFreeze: { at: number; seconds: number } | null = null;
  /** 抜けたプレイヤーの切断の理由（文。ホストの知らせに付ける） */
  private leaveReasons = new Map<PlayerId, string>();
  /** ゲスト: ホストとの接続が切れた理由（結果画面に出す） */
  private disconnectReason: string | null = null;

  /**
   * 切断の理由の文（作者の報告 2026年10月28日: スマホの協力プレイでよく切れる。どれで切れたかを見て対策する）。
   * 少し前にこのブラウザが止まっていたら、それも書き添える
   */
  private leaveReasonText(reason: LeaveReason): string {
    const f = this.lastFreeze;
    const text = t(`net.reason.${reason}`, { seconds: networkConfig.silenceTimeoutSeconds });
    return f && performance.now() - f.at < networkConfig.freezeNoteSeconds * 1000 ? `${text} ${t('net.reason.localFrozen', { seconds: Math.round(f.seconds) })}` : text;
  }

  /** 1回の更新の結果を送る。ホストは各ゲストへ（ほかのゲストの状態の中継を含む）、ゲストはホストへ */
  private sendNet(): void {
    const room = this.coop?.room;
    if (!room || !this.sync) return;
    const out = this.sync.outgoing(this.sim.world);
    if (room.role === 'guest') {
      room.transports.get(HOST_PLAYER_ID)?.send(out);
      return;
    }
    const forwards = this.sync.takeForwards();
    for (const [id, transport] of room.transports) {
      const relayed = forwards.filter((f) => f.from !== id).flatMap((f) => f.messages);
      transport.send(relayed.length ? [...out, ...relayed] : out);
    }
  }

  override update(time: number, delta: number): void {
    this.lastFrameAt = performance.now();
    // スマホが縦向きの間は、ソロのランを止める（協力プレイは止められない）
    // 自分の進化の演出の間も、ソロは止める
    const paused = !this.coop && ((orientationGuard?.blocked ?? false) || this.evolutionCutscene.active);
    const steps = paused ? 0 : this.clock.advance(delta);
    this.runSteps(steps, true);
    this.lastSteps = steps;
    // 止まっている間（レベルアップの選択・ランの終わり）は前回と今回の位置の間を補間しない（補間の割合だけが毎フレーム変わり、画面全体が震えて見えた）
    const w = this.sim.world;
    this.draw(w.levelUp || w.outcome ? 1 : this.clock.alpha, delta, time);
    this.damageNumbers?.update(performance.now());
    // タブが裏にあって終わりの知らせを描画で受け取れなかった場合も、結果画面へ移る
    if (this.sim.world.outcome && this.resultAt === null) this.resultAt = performance.now() + stageConfig.endDelaySeconds * 1000;
    if (this.sim.world.outcome && !this.runRecorded) this.recordRunEnd();
    if (this.resultAt !== null && performance.now() >= this.resultAt) this.showResult();
  }

  /**
   * 記録の保存: ラン中は数分ごとに記録を足して Firestore へ書き、ラン終了時にまとめて書く。
   * タブが裏に回ったら、ブラウザへの一時保存と Firestore への書き込みをしておく
   */
  private setupSaving(): void {
    this.recorder = new RunRecorder(session.store, this.pokemon, shopConfig, derivedStatSources, this.stageOfRegion.id, this.runData.hatchedFrom ?? null);
    // ランの途中の様子をブラウザに書いておく（ページが落ちたら、次に開いたときに知らせて、記録を失敗として終える。07 の112章）
    const probe = window.setInterval(() => this.writeProbe(false), saveConfig.probeSeconds * 1000);
    const onPageHide = (): void => this.writeProbe(true);
    window.addEventListener('pagehide', onPageHide);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.clearInterval(probe);
      window.removeEventListener('pagehide', onPageHide);
      clearRunProbe();
    });
    // テストプレイ（?legend・?god）のランは記録を保存しない（コイン・実績・解放が進まないように）
    if (this.isTestRun()) return;
    const autosave = this.time.addEvent({
      delay: saveConfig.autosaveSeconds * 1000,
      loop: true,
      callback: () => {
        this.recorder.commit(this.sim.world);
        // 足した分を写しからも外す（落ちたときに同じ分を2回足さない）
        this.writeProbe(false);
        this.noteProgress();
        void session.store.flush();
      },
    });
    const onHidden = (): void => {
      if (document.visibilityState === 'hidden') this.recorder.commit(this.sim.world);
    };
    document.addEventListener('visibilitychange', onHidden);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      autosave.remove();
      document.removeEventListener('visibilitychange', onHidden);
    });
  }

  /** ランが終わった: 記録をまとめてセーブデータに足し、保存する */
  private recordRunEnd(): void {
    this.runRecorded = true;
    clearRunProbe();
    if (this.isTestRun()) return;
    this.recorder.finish(this.sim.world);
    this.noteProgress();
    void session.store.flush();
  }

  /** ランの途中の様子をブラウザに書く（07 の112章）。closed はページを閉じた・移ったとき（落ちたときは書かれない） */
  /** 数の移り変わり（30 秒ごと。07 の118章） */
  private probeTrend: { seconds: number; counts: Record<string, number> }[] = [];
  private probeTrendAt = 0;

  /** 増え続けていないかを見る数（画面の物・粒・アニメーション・DOM・届いて待っているコマンド など） */
  private probeCounts(): Record<string, number> {
    const w = this.sim.world;
    let particles = 0;
    let emitters = 0;
    let objs = 0;
    // 入れ物（Container・Layer）の中まで数える
    const walk = (list: readonly Phaser.GameObjects.GameObject[]): void => {
      for (const o of list) {
        objs++;
        if (o instanceof Phaser.GameObjects.Particles.ParticleEmitter) {
          emitters++;
          particles += o.getAliveParticleCount() + o.getDeadParticleCount();
        }
        if (o instanceof Phaser.GameObjects.Container) walk(o.list);
        else if (o instanceof Phaser.GameObjects.Layer) walk(o.getChildren());
      }
    };
    walk(this.children.list);
    return {
      objs,
      emitters,
      particles,
      tweens: this.tweens.getTweens().length,
      anims: this.anims.toJSON().anims.length,
      textures: Object.keys(this.textures.list).length,
      dom: document.getElementsByTagName('*').length,
      inbox: this.inbox.length,
      strikes: this.strikes.length,
      enemies: w.enemies.count,
      gems: w.gems.count,
      projectiles: w.projectiles.count,
      hazards: w.hazards.length,
      items: w.items.length,
      players: this.playerViews.size,
    };
  }

  private writeProbe(closed: boolean): void {
    const w = this.sim.world;
    if (w.outcome || this.runRecorded) return;
    const nowSec = Math.floor(elapsedSeconds(w));
    if (this.probeTrend.length === 0 || nowSec - this.probeTrendAt >= saveConfig.trendSeconds) {
      this.probeTrendAt = nowSec;
      this.probeTrend.push({ seconds: nowSec, counts: this.probeCounts() });
      if (this.probeTrend.length > saveConfig.trendSamples) this.probeTrend.shift();
    }
    let px = 0;
    let n = 0;
    const seen = new Set<unknown>();
    for (const tex of Object.values(this.textures.list)) {
      for (const src of tex.source) {
        if (seen.has(src)) continue;
        seen.add(src);
        px += (src.width || 0) * (src.height || 0);
        n++;
      }
    }
    const transports = this.coop ? [...this.coop.room.transports.values()] : [];
    const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
    writeRunProbe({
      at: Date.now(),
      version: __APP_VERSION__,
      seconds: Math.floor(elapsedSeconds(w)),
      section: w.section,
      enemies: w.enemies.count,
      projectiles: w.projectiles.count,
      players: w.players.length,
      transport: this.coop ? (transports.some((tr) => tr.kind === 'relay') ? 'relay' : 'p2p') : null,
      bufferedKB: Math.round(transports.reduce((s, tr) => s + tr.buffered(), 0) / 1024),
      maxBufferedKB: Math.round(transports.reduce((m, tr) => Math.max(m, tr.buffered()), 0) / 1024),
      sentKB: Math.round(transports.reduce((s, tr) => s + tr.stats.sentBytes, 0) / 1024),
      receivedKB: Math.round(transports.reduce((s, tr) => s + tr.stats.receivedBytes, 0) / 1024),
      textureMB: Math.round((px * 4) / 1048576),
      textures: n,
      heapMB: heap ? Math.round(heap / 1048576) : null,
      fps: Math.round(this.game.loop.actualFps),
      trend: this.probeTrend,
      closed,
      snapshot: this.isTestRun() ? null : this.recorder.snapshot(w),
    });
  }

  /** テストプレイのラン（記録を保存しない） */
  private isTestRun(): boolean {
    return this.god || this.testLegend !== null || this.testRun;
  }

  /** 伝説戦の結果（結果画面に出す） */
  private legendaryResult: { kind: number; result: 'won' | 'lost' | 'timeUp' | null } | null = null;

  private enemyName(kind: number): string {
    const k = this.sim.world.rules.enemies.kinds[kind];
    if (!k) return '';
    const name = localName(generated.pokemon[k.species ?? k.id]?.names, getLocale(), k.id);
    // 色違い（色違いの御三家）は「色違いの〇〇」
    return k.shiny ? t('run.shinyName', { name }) : name;
  }

  /** このランで新しく達成した実績・解放したポケモン（結果画面に出す） */
  private newAchievements: string[] = [];
  private newUnlocks: string[] = [];

  /** 記録を足した後: 新しく達成した実績を知らせ、結果画面のために覚えておく */
  private noteProgress(): void {
    if (this.isTestRun()) return;
    const found = session.checkProgress();
    this.newAchievements.push(...found.achievements);
    this.newUnlocks.push(...found.unlocks);
    if (found.achievements.length && !this.sim.world.outcome) {
      // 実績の名前と報酬（作者の決定: 報酬は達成したときに分かる）
      this.announce(
        found.achievements
          .map((id) => {
            const reward = achievementRewardById(id);
            return t('run.achievement', { name: achievementName(id) }) + (reward ? `\n${reward}` : '');
          })
          .join('\n'),
        '#a5d6a7',
      );
    }
  }

  /** 結果画面へ移る */
  private showResult(): void {
    const w = this.sim.world;
    const local = w.players.find((p) => p.id === this.localId);
    const data: ResultSceneData = {
      summary: {
        outcome: w.outcome ?? 'fail',
        seconds: elapsedSeconds(w),
        level: w.level,
        kills: w.stats.kills,
        pokemonName: localName(generated.pokemon[w.rules.species[local?.species ?? -1]?.key ?? '']?.names, getLocale(), ''),
        moves: (local?.moves ?? []).map((m) => {
          const def = w.rules.moves[m.move]!;
          return `${localName(generated.moves[def.key]?.names, getLocale(), def.key)} Lv${m.level}`;
        }),
        // ポケモンの解放の実績は「新しく解放したポケモン」の欄に出すので、実績の欄には重ねて出さない
        newAchievements: this.newAchievements.filter((id) => !achievementsConfig.achievements.find((x) => x.id === id)?.reward?.pokemon).map((id) => achievementName(id)),
        newUnlocks: this.newUnlocks.map((key) => localName(generated.pokemon[key]?.names, getLocale(), key)),
        // 達成した実績の報酬（持ち物・コイン・バフ。解放したポケモンは newUnlocks に出す）
        rewards: this.newAchievements.flatMap((id) => {
          if (achievementsConfig.achievements.find((x) => x.id === id)?.reward?.pokemon) return [];
          const reward = achievementRewardById(id);
          return reward ? [reward] : [];
        }),
        coins: this.recorder.coinsEarned,
        legendary: this.legendaryResult?.result
          ? { name: this.enemyName(this.legendaryResult.kind), result: this.legendaryResult.result }
          : null,
        ...(this.disconnectReason ? { disconnectReason: this.disconnectReason } : {}),
      },
      // 協力プレイはもう一度を出さない（部屋を作り直す必要がある）
      retry: this.coop ? null : { ...this.runData },
    };
    this.resultAt = null;
    this.scene.start('result', data);
  }

  /**
   * 見える範囲をそろえる（作者の決定。07 25.3 の B 案）: 見えるワールドの縦の広さを、どの端末でも viewHeight にする
   * （拡大率は 画面の高さ ÷ viewHeight。丸めない）。横は端末の比率に合わせて広げるが、maxAspect（16:9）まで。
   * それより横長の画面は、ゲームの描く面（canvas の親）の幅を 16:9 に縮めて真ん中に置き、左右を黒い帯にする（ページの背景が黒）。
   * カメラの描く範囲をずらして帯を作ると、フィルターを掛けた技の光と範囲だけが帯の幅だけ左にずれた（2026年10月22日）ため、カメラはずらさない
   */
  private applyZoom(): void {
    const c = spriteRender.camera;
    const parent = this.game.canvas.parentElement;
    if (parent) {
      const w = Math.min(window.innerWidth, Math.round(window.innerHeight * c.maxAspect));
      if (parent.style.width !== `${w}px`) {
        parent.style.width = `${w}px`;
        parent.style.margin = '0 auto';
        // canvas の大きさを親に合わせる（変わったら resize でもう一度ここに来る）。resize の処理の途中で大きさを変えると、
        // 外側の処理が元の大きさで上書きしたので、次のフレームで行う
        requestAnimationFrame(() => {
          if (!this.sys.isActive()) return;
          this.scale.getParentBounds();
          this.scale.refresh();
        });
      }
    }
    const { width, height } = this.scale;
    const cam = this.cameras.main;
    cam.setViewport(0, 0, width, height);
    cam.setZoom(height / c.viewHeight);
    // 光の演出・当たり判定の塗りの1ドットも、拡大率に合わせてワールドの dot にそろえる
    this.effects?.setZoom(cam.zoom);
    this.hitShapes?.setZoom(cam.zoom);
  }

  /**
   * 画面に固定する表示（文字・バー）を、カメラの拡大率に関係なく画面の (x, y) に等倍で置く。
   * カメラは画面の中心を基準に拡大するので、その分を戻す
   */
  private placeUi(obj: Phaser.GameObjects.Components.Transform, x: number, y: number): void {
    const cam = this.cameras.main;
    const z = cam.zoom;
    obj.setScale(1 / z);
    obj.setPosition(cam.width / 2 + (x - cam.width / 2) / z, cam.height / 2 + (y - cam.height / 2) / z);
  }

  /**
   * 画面の端に矢印で方向を出すもの（作者の依頼 2026年10月22日）: ボス・中ボス・伝説、落ちているふしぎなアメ、ほかのプレイヤー。
   * 倒れている味方は色を変えて点滅させる（助けに行けるように）
   */
  private edgeTargets(): EdgeTarget[] {
    const w = this.sim.world;
    const c = uiConfig.edgeArrows.colors;
    const out: EdgeTarget[] = [];
    const e = w.enemies;
    for (let i = 0; i < e.count; i++) {
      const rank = w.rules.enemies.kinds[e.kind[i]!]?.rank ?? 'normal';
      if (rank === 'normal') continue;
      out.push({ x: e.x[i]!, y: e.y[i]!, color: c[rank], icon: { texture: 'edge-boss', tint: true } });
    }
    for (const it of w.items) {
      if (it.kind === 'rare-candy' && !it.pending) out.push({ x: it.x, y: it.y, color: c.candy, icon: { texture: 'rare-candy', tint: false } });
    }
    const blink = Math.floor(this.time.now / 400) % 2 === 0;
    for (const p of w.players) {
      if (p.id === this.localId) continue;
      out.push({ x: p.x, y: p.y, color: p.down && blink ? c.allyDown : c.ally, icon: { text: `${p.id}P` } });
    }
    return out;
  }

  /** 画面の真ん中に、しばらくお知らせを出す */
  private announce(text: string, color: string): void {
    this.tweens.killTweensOf(this.announceText);
    this.announceText.setText(text).setColor(color).setAlpha(1);
    this.tweens.add({ targets: this.announceText, alpha: 0, delay: 2500, duration: 600 });
  }

  private onSimEvents(): void {
    const w = this.sim.world;
    // 同じ更新で出たボス（ホウエンのタッグ）は、まとめて知らせる
    const appeared: number[] = [];
    for (const ev of w.events) {
      if (ev.type === 'bossAppeared') {
        this.bossId = ev.id;
        this.bossIds.push(ev.id);
        appeared.push(ev.kind);
      } else if (ev.type === 'playerFrozen' && ev.playerId === this.localId) {
        this.announce(t('run.frozen'), '#80deea');
      } else if (ev.type === 'boxHit' || ev.type === 'boxRemoved') {
        this.onBoxEvent(ev);
      } else if (ev.type === 'itemCollected') {
        const it = ev;
        if (it.kind === 'rare-candy') this.playCandy(it.levels);
        else if (it.kind === 'buff') {
          // 箱の一時的な強化: 拾った人に、道具の名前と効いている時間
          const def = w.rules.pickups.items.buff?.buffs[it.levels];
          if (def && it.by === this.localId) this.announce(t('item.buff', { name: localName(generated.items[def.item]?.names, getLocale(), def.item), seconds: def.seconds }), '#ffe082');
        }
        else if (it.kind === 'magnet') this.announce(t('item.magnet'), '#ef9a9a');
        // はね: だれが拾っても全員に知らせる（全員のランでルギア・ホウオウと戦える）
        else if (it.kind === 'silver-wing' || it.kind === 'rainbow-wing') this.announce(t('run.wingGot', { name: localName(generated.items[it.kind]?.names, getLocale(), it.kind) }), it.kind === 'silver-wing' ? '#e0e0e0' : '#ffcc80');
        else if (it.by === this.localId) this.announce(localName(generated.items.potion?.names, getLocale(), ''), '#ce93d8');
      } else if (ev.type === 'runStatReached' && ev.playerId === this.localId) {
        // ランの記録（固有技の条件）: 自分の世界に付け、ゲストはホストへも伝える（07 の134章）
        this.uiCommands.push({ type: 'runStat', playerId: this.localId, stat: ev.stat, value: ev.value });
        if (this.sync && w.role === 'guest') this.sync.requestRunStat(ev.stat, ev.value);
      } else if (ev.type === 'bodyAttack') {
        this.playerViews.get(ev.playerId)?.lunge(ev.dirX, ev.dirY, ev.distance, ev.afterimages);
      } else if (ev.type === 'moveTaught' && ev.playerId === this.localId) {
        // 持ち物で技を覚えた（ワンリキー）
        this.announce(t('run.moveTaught', { name: localName(generated.moves[w.rules.moves[ev.move]!.key]?.names, getLocale(), w.rules.moves[ev.move]!.key) }), '#ffcc80');
      } else if (ev.type === 'moveUsed') {
        // 使った瞬間の絵（しおふき: 真上へ噴き上がる潮）
        const cs = this.effects.castSprite(w.rules.moves[ev.move]!.effect);
        const p = cs ? w.players.find((q) => q.id === ev.playerId) : undefined;
        if (cs && p) this.addStrike(cs, cs.lineLength ? p.x - cs.lineLength / 2 : p.x, p.y, cs.radius, cs.seconds, cs.lineLength ?? 0);
      } else if (ev.type === 'projectileHit') {
        // 当たった所の絵（ぜったいれいど: 氷の像）
        const hs = this.effects.hitSprite(w.rules.moves[ev.move]!.effect);
        if (hs) this.addStrike(hs, ev.x, ev.y, hs.radius, hs.seconds);
      } else if (ev.type === 'playerLeft') {
        this.playerViews.get(ev.playerId)?.container.destroy();
        this.playerViews.delete(ev.playerId);
        const why = this.leaveReasons.get(ev.playerId);
        this.announce(why ? `${t('net.playerLeft', { n: ev.playerId })}\n${why}` : t('net.playerLeft', { n: ev.playerId }), '#ef9a9a');
      } else if (ev.type === 'hazardStruck') {
        // 落ちた範囲に合わせたドット絵（案 F）
        const strike = effectRecipes[ev.effect]?.strike;
        if (strike) {
          this.strikes.push({
            item: { spec: strike, x: ev.x, y: ev.y, radius: ev.radius, band: ev.shape === 'ring' ? ev.radius - ev.innerRadius : 0, dirX: ev.dirX, dirY: ev.dirY, length: ev.length, vx: 0, vy: 0, seed: this.strikes.length },
            start: this.time.now / 1000,
            seconds: strike.seconds,
          });
        }
        if (strike) {
          // 絵があるときは、光の演出は1つだけ（重ねると絵が白く飛ぶ）。直線は真ん中
          this.effects.playImpact(ev.effect, ev.x + (ev.dirX * ev.length) / 2, ev.y + (ev.dirY * ev.length) / 2);
        } else if (ev.shape === 'line') {
          // 直線は、線に沿っていくつか演出を出す
          for (let d = 0; d <= ev.length; d += Math.max(60, ev.length / 6)) this.effects.playImpact(ev.effect, ev.x + ev.dirX * d, ev.y + ev.dirY * d);
        } else if (ev.shape === 'ring') {
          // 輪は、輪に沿っていくつか演出を出す
          for (let k = 0; k < 8; k++) this.effects.playImpact(ev.effect, ev.x + Math.cos((k * Math.PI) / 4) * ev.radius, ev.y + Math.sin((k * Math.PI) / 4) * ev.radius);
        } else {
          this.effects.playImpact(ev.effect, ev.x, ev.y);
        }
      } else if (ev.type === 'legendaryWarning' || ev.type === 'intruderWarning') {
        // 伝説の乱入（01_game_design.md 7.1 の「DANGER」。三犬の乱入も同じ）
        this.tweens.killTweensOf(this.announceText);
        this.announceText.setText(t('run.danger')).setColor('#ff5252').setAlpha(1);
        this.tweens.add({ targets: this.announceText, alpha: 0.2, duration: 250, yoyo: true, repeat: 5, onComplete: () => this.announceText.setAlpha(0) });
      } else if (ev.type === 'swarmStarted') {
        const s = w.rules.stage.swarms[ev.swarm];
        if (s) this.announce(tMaybe(`swarm.${s.pattern}`, { name: localName(generated.pokemon[s.kind.replace(/^swarm-/, '')]?.names, getLocale(), s.kind) }), '#ffcc80');
      } else if (ev.type === 'runEnded') {
        const clear = ev.outcome === 'clear';
        this.tweens.killTweensOf(this.announceText);
        // 伝説戦の時間切れ（作者の依頼 2026年10月28日）: クリアの表示で倒したと思わないよう、「〇〇は 去っていった…」を大きく出してから結果画面へ
        const escaped = ev.legendary?.result === 'timeUp';
        if (escaped) this.announceText.setText(t('run.legendEscaped', { name: this.enemyName(ev.legendary!.kind) })).setColor('#b3e5fc').setAlpha(1);
        // 中ボスを制限時間で倒せなかった（07 の106章）
        else if (ev.gateTimeUp !== undefined) this.announceText.setText(t('run.gateTimeUp', { name: this.enemyName(ev.gateTimeUp) })).setColor('#ef9a9a').setAlpha(1);
        else this.announceText.setText(t(`run.${ev.outcome}`)).setColor(clear ? '#ffe082' : '#ef9a9a').setAlpha(1);
        this.legendaryResult = ev.legendary;
        this.resultAt = performance.now() + (escaped || ev.gateTimeUp !== undefined ? (stageConfig.legendEscapeDelaySeconds ?? stageConfig.endDelaySeconds) : stageConfig.endDelaySeconds) * 1000;
      }
    }
    if (appeared.length > 0) {
      const boss = w.rules.enemies.kinds[appeared[0]!]!.rank === 'boss';
      const text =
        appeared.length >= 2
          ? t(boss ? 'run.tagBossAppeared' : 'run.tagAppeared', { a: this.enemyName(appeared[0]!), b: this.enemyName(appeared[1]!) })
          : t(boss ? 'run.bossAppeared' : 'run.midbossAppeared', { name: this.enemyName(appeared[0]!) });
      this.announce(text, boss ? '#ff8a65' : '#ffe082');
    }
  }

  /** その場に決まった秒数だけ出す絵（使った瞬間の絵・当たった所の絵）。ボスの技が落ちた所の絵と同じ置き場に入れる */
  /** length があれば (x, y) から右へその長さの線に並べる（fit line。リーフブレードの剣筋） */
  private addStrike(spec: SpriteSpec, x: number, y: number, radius: number, seconds: number, length = 0): void {
    this.strikes.push({
      item: { spec, x, y, radius, band: 0, dirX: 1, dirY: 0, length, vx: 0, vy: 0, seed: this.strikes.length },
      start: this.time.now / 1000,
      seconds,
    });
  }

  /** ためる光: 再使用の残りが決まった秒数を切った技があれば、その光（いちばん出す直前のもの） */
  private chargeOf(world: World, p: World['players'][number]): { color: number; radius: number; alpha: number; t: number } | null {
    if (p.down) return null;
    let best: { color: number; radius: number; alpha: number; t: number } | null = null;
    for (const pm of p.moves) {
      const def = world.rules.moves[pm.move]!;
      const c = this.effects.chargeGlow(def.effect);
      if (!c) continue;
      // 溜める技（リーフブレード）は溜めている間、ほかは再使用の終わりの c.seconds の間
      const windup = def.windupSeconds && pm.windup !== undefined;
      if (!windup && (pm.cooldown <= 0 || pm.cooldown > c.seconds)) continue;
      const t = windup ? 1 - pm.windup! / def.windupSeconds! : 1 - pm.cooldown / c.seconds;
      if (!best || t > best.t) best = { color: hexColor(c.color), radius: c.radius, alpha: c.alpha, t };
    }
    return best;
  }

  /** 稲妻の線（芯・範囲の塗りを描かない） */
  private isLightning(world: World, i: number): boolean {
    return world.projectiles.shape[i] === SHAPE_LINE && this.lightningMoves.has(world.projectiles.move[i]!);
  }

  /** 色を切り替えて光らせる円（10まんボルトの自分の周り・かみなりの落雷） */
  private flashing(i: number, pr: World['projectiles']): boolean {
    if (pr.stage[i] === 3) return false;
    const f = this.flashMoves.get(pr.move[i]!);
    if (!f) return false;
    // はかいこうせん: 技そのものの線も光らせる
    return pr.shape[i] === SHAPE_CIRCLE || (f.lines && pr.stage[i] === 0 && pr.shape[i] === SHAPE_LINE);
  }

  /** とっておき: 技が出た瞬間に、画面全体をうっすら光らせる（目に優しいよう薄く短く。作者の決定で画面は揺らさない） */
  private drawScreenFlashes(world: World): void {
    const pr = world.projectiles;
    const alive = new Set<number>();
    for (let i = 0; i < pr.count; i++) {
      if (pr.stage[i] !== 0) continue;
      const serial = pr.serial[i]!;
      alive.add(serial);
      if (this.flashedSerials.has(serial)) continue;
      const f = this.effects.screenFlash(world.rules.moves[pr.move[i]!]!.effect);
      if (!f) continue;
      this.flashedSerials.add(serial);
      const cam = this.cameras.main;
      // 拡大・縮小しても画面を覆うように、画面の中心に大きく置く
      const rect = this.add.rectangle(cam.width / 2, cam.height / 2, cam.width * 4, cam.height * 4, hexColor(f.color), f.alpha).setScrollFactor(0).setDepth(spriteRender.depths.candy + 1);
      this.tweens.add({ targets: rect, alpha: 0, duration: f.durationMs, onComplete: () => rect.destroy() });
    }
    for (const s of this.flashedSerials) if (!alive.has(s)) this.flashedSerials.delete(s);
  }

  /**
   * 空から落ちてくる塊（つららおとし。作者の指摘 2026年10月27日）: 当たり判定が出るのを待つ間（stage 3）、塊の絵を上から落とし
   * （だんだん速く）、落ちる所に影を出す。待ちが終わって当たり判定が出たら、破片を飛び散らせる
   */
  private drawFalls(world: World): void {
    if (this.fallMoves.size === 0) return;
    if (!this.fallShadows) this.fallShadows = this.add.graphics().setDepth(spriteRender.depths.effects - 0.2);
    const g = this.fallShadows;
    g.clear();
    const pr = world.projectiles;
    const items: SpriteItem[] = [];
    const now = new Map<number, { x: number; y: number; radius: number; move: number }>();
    for (let i = 0; i < pr.count; i++) {
      const f = this.fallMoves.get(pr.move[i]!);
      if (!f) continue;
      const serial = pr.serial[i]!;
      if (pr.stage[i] !== 3) {
        // 着いた: 破片を散らす（1回だけ）
        if (pr.stage[i] === 0 && this.falling.has(serial) && f.shards) this.burstShards(f.shards, pr.x[i]!, pr.y[i]!, pr.radius[i]!);
        continue;
      }
      const t = pr.maxLife[i]! > 0 ? 1 - pr.life[i]! / pr.maxLife[i]! : 1;
      const x = pr.x[i]!;
      const y = pr.y[i]!;
      now.set(serial, { x, y, radius: pr.radius[i]!, move: pr.move[i]! });
      g.fillStyle(0x000000, 0.12 + 0.18 * t).fillEllipse(x, y, pr.radius[i]! * (0.8 + 0.8 * t), pr.radius[i]! * (0.4 + 0.4 * t));
      items.push({
        spec: { id: f.id, fit: 'circle', size: f.size, alpha: 1, rotate: 'none', spinDegPerSec: 0, varyTiles: false, upright: false, directional: false, originY: 1, shake: 0, tail: 0, afterimages: 0, afterimageGap: 2 },
        x,
        y: y - f.height * (1 - t * t),
        radius: pr.radius[i]!,
        band: 0,
        dirX: 0,
        dirY: 1,
        length: 0,
        vx: 0,
        vy: 0,
        elapsed: 0,
        alpha: Math.min(1, t * 4),
        seed: i,
      });
    }
    this.falling = now;
    this.fallSprites?.drawItems(items);
  }

  /** 破片を、着いた所から外へ飛び散らせる（見た目だけなので Math.random でよい） */
  private burstShards(sh: NonNullable<NonNullable<EffectRecipe['fall']>['shards']>, x: number, y: number, radius: number): void {
    const key = moveSpriteTexture(sh.id);
    if (!this.textures.exists(key)) return;
    const w = this.textures.get(key).getSourceImage().width;
    for (let k = 0; k < sh.count; k++) {
      const a = (k / sh.count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const d = sh.distance * (0.6 + Math.random() * 0.6);
      const s = (radius * sh.size * (0.6 + Math.random() * 0.6)) / Math.max(1, w);
      const img = this.add.image(x, y, key).setDepth(spriteRender.depths.effects + 0.2).setScale(s).setRotation(a);
      this.tweens.add({ targets: img, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.7, alpha: 0, duration: sh.seconds * 1000, ease: 'Quad.easeOut', onComplete: () => img.destroy() });
    }
  }

  /** 落雷（かみなり）: 当たり判定が出てからしばらく、上からジグザグの稲妻を落とす。形は毎フレーム変えて、ちらつかせる */
  private drawBolts(world: World): void {
    if (!this.boltView) this.boltView = this.add.graphics().setDepth(spriteRender.depths.effects + 0.3);
    const g = this.boltView;
    g.clear();
    const pr = world.projectiles;
    // 稲妻の線: 端から端まで1本のジグザグ（毎フレーム形を変えて、ちらつかせる）
    for (let i = 0; i < pr.count; i++) {
      if (pr.shape[i] !== SHAPE_LINE || pr.stage[i] === 2 || pr.stage[i] === 3) continue;
      const ln = this.effects.lightningLine(world.rules.moves[pr.move[i]!]!.effect);
      if (!ln) continue;
      const len = pr.length[i]!;
      const dx = pr.dirX[i]!;
      const dy = pr.dirY[i]!;
      const steps = Math.max(2, Math.round(len / 16));
      const pts: [number, number][] = [];
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const off = k === 0 || k === steps ? 0 : (Math.random() * 2 - 1) * ln.width * ln.jitter;
        pts.push([pr.x[i]! + dx * len * t - dy * off, pr.y[i]! + dy * len * t + dx * off]);
      }
      for (const [w, color, a] of [[ln.width * 3, ln.glowColor, 0.45], [ln.width, ln.color, 1]] as const) {
        g.lineStyle(w, hexColor(color), a).beginPath();
        g.moveTo(pts[0]![0], pts[0]![1]);
        for (const [px, py] of pts.slice(1)) g.lineTo(px, py);
        g.strokePath();
      }
    }
    for (let i = 0; i < pr.count; i++) {
      if (pr.stage[i] !== 0) continue;
      const b = this.boltMoves.get(pr.move[i]!);
      if (!b || pr.maxLife[i]! - pr.life[i]! > b.seconds) continue;
      const x = pr.x[i]!;
      const y = pr.y[i]!;
      const steps = 7;
      const pts: [number, number][] = [];
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const jitter = k === 0 || k === steps ? 0 : (Math.random() * 2 - 1) * b.width * 4;
        pts.push([x + jitter, y - b.height * (1 - t)]);
      }
      for (const [w, color, a] of [[b.width * 3, b.glowColor, 0.5], [b.width, b.color, 1]] as const) {
        g.lineStyle(w, hexColor(color), a).beginPath();
        g.moveTo(pts[0]![0], pts[0]![1]);
        for (const [px, py] of pts.slice(1)) g.lineTo(px, py);
        g.strokePath();
      }
    }
  }

  /**
   * 範囲の塗りの色。通った道に残る範囲は、残り時間に合わせて薄くして消していく。
   * 光らせる円は、決まった色を順に切り替える
   */
  private shapeColorOf(pr: World['projectiles'], i: number, timeMs: number): { color: number; alpha: number } | null {
    if (pr.stage[i] === 3) return null;
    // 範囲を塗らない技（天気: 画面じゅうに降る雪で見せる）
    if (this.effects.hideShape(this.sim.world.rules.moves[pr.move[i]!]!.effect)) return null;
    // 稲妻の線は、ジグザグの稲妻だけを見せる（範囲を塗ると管のように見える）
    if (this.lightningMoves.has(pr.move[i]!) && pr.shape[i] === SHAPE_LINE) return null;
    let base = this.shapeColors[pr.move[i]!] ?? null;
    // 残る範囲は、塗りをうすくする（控えめな粒で見せる）
    if (base && pr.linger[i] === 1) {
      const lg = this.effects.linger(this.sim.world.rules.moves[pr.move[i]!]!.effect);
      if (lg) base = { color: base.color, alpha: lg.fillAlpha };
    }
    if (this.flashing(i, pr)) {
      const f = this.flashMoves.get(pr.move[i]!)!;
      return { color: hexColor(f.colors[Math.floor(timeMs / f.periodMs) % f.colors.length]!), alpha: f.alpha };
    }
    if (base && pr.stage[i] === 1 && pr.shape[i] === SHAPE_LINE && this.pathMoves.has(pr.move[i]!) && pr.maxLife[i]! > 0) {
      return { color: base.color, alpha: base.alpha * Math.min(1, pr.life[i]! / pr.maxLife[i]!) };
    }
    return base;
  }

  /** 持ち主の残像として飛ぶ技（ゴッドバード）: 発射体の位置に、持ち主のポケモンの姿を薄く描き、後ろに残像を連ねる */
  private drawGhosts(world: World, alpha: number): void {
    const pr = world.projectiles;
    const depth = spriteRender.depths.effects + 0.2;
    let used = 0;
    for (let i = 0; i < pr.count; i++) {
      if (pr.stage[i] !== 0) continue;
      const ghost = this.effects.ownerGhost(world.rules.moves[pr.move[i]!]!.effect);
      if (!ghost) continue;
      const frame = this.playerViews.get(pr.owner[i]!)?.ghostFrame();
      if (!frame) continue;
      let x = pr.prevX[i]! + (pr.x[i]! - pr.prevX[i]!) * alpha;
      let y = pr.prevY[i]! + (pr.y[i]! - pr.prevY[i]!) * alpha;
      // 1回の更新で進む量。後ろの残像は、それを spacingTicks 回ぶんずつ戻した所に置く
      let stepX = pr.x[i]! - pr.prevX[i]!;
      let stepY = pr.y[i]! - pr.prevY[i]!;
      if (pr.shape[i] === SHAPE_LINE) {
        // 線の技（しんそく・ドラゴンダイブ）: 残像が線の根元から先へ、出ている時間の前半で走り抜ける
        const t = Math.min(1, (pr.maxLife[i]! - pr.life[i]!) / Math.max(world.dt, pr.maxLife[i]! * 0.5));
        const len = pr.length[i]!;
        x = pr.x[i]! + pr.dirX[i]! * len * t;
        y = pr.y[i]! + pr.dirY[i]! * len * t;
        // 残像の間隔: 線の長さの 1 割ずつ（根元より後ろには置かない）
        stepX = pr.dirX[i]! * Math.min(len * 0.1, len * t / Math.max(1, ghost.afterimages * ghost.spacingTicks));
        stepY = pr.dirY[i]! * Math.min(len * 0.1, len * t / Math.max(1, ghost.afterimages * ghost.spacingTicks));
      }
      for (let k = 0; k <= ghost.afterimages; k++) {
        let img = this.ghostImages[used];
        if (!img) {
          img = this.add.image(0, 0, frame.key, frame.frame);
          this.ghostImages.push(img);
        }
        img
          .setTexture(frame.key, frame.frame)
          .setPosition(x - stepX * ghost.spacingTicks * k, y - stepY * ghost.spacingTicks * k)
          .setScale(frame.scaleX, frame.scaleY)
          .setFlipX(frame.flipX)
          .setTint(hexColor(ghost.colors ? ghost.colors[(Math.floor(performance.now() / ghost.periodMs) + k) % ghost.colors.length]! : ghost.tint))
          .setAlpha(ghost.alpha * (1 - k / (ghost.afterimages + 1)))
          .setDepth(depth - k * 0.001)
          .setVisible(true);
        used++;
      }
    }
    for (let k = used; k < this.ghostImages.length; k++) this.ghostImages[k]!.setVisible(false);
  }

  /** ボスの範囲技の予告: 範囲の円と、落ちるまでの残りを内側から広がる円で見せる */
  private drawHazards(hazards: readonly Hazard[]): void {
    const g = this.hazardView;
    g.clear();
    for (const h of hazards) {
      // 飛ぶ玉（サンダーの電気の玉）: 飛んでいる間は黄色い玉
      if (h.activeTicks !== undefined && this.sim.world.rules.stage.moves[h.move]?.bullets) {
        g.fillStyle(0xfff176, 0.35).fillCircle(h.x, h.y, h.radius * 1.6);
        g.fillStyle(0xffeb3b, 1).fillCircle(h.x, h.y, h.radius);
        g.fillStyle(0xffffff, 1).fillCircle(h.x, h.y, h.radius * 0.45);
        // 避けるべきものと分かるよう、赤い縁（ほかの範囲技の予告と同じ色）
        g.lineStyle(2, 0xff1744, 1).strokeCircle(h.x, h.y, h.radius + 1);
        continue;
      }
      // 落ちた後に少し当たる時間（activeTicks）は、予告を描かない（落ちた所の絵が出ている）
      if (h.activeTicks !== undefined) continue;
      const progress = 1 - h.ticksLeft / h.totalTicks;
      if (h.shape === 'line') {
        // 直線: 幅 radius*2 の帯。落ちるまでの残りは、始点から伸びる帯で見せる
        const nx = -h.dirY * h.radius;
        const ny = h.dirX * h.radius;
        const band = (len: number): Phaser.Math.Vector2[] => [
          new Phaser.Math.Vector2(h.x + nx, h.y + ny),
          new Phaser.Math.Vector2(h.x + nx + h.dirX * len, h.y + ny + h.dirY * len),
          new Phaser.Math.Vector2(h.x - nx + h.dirX * len, h.y - ny + h.dirY * len),
          new Phaser.Math.Vector2(h.x - nx, h.y - ny),
        ];
        g.fillStyle(0xff1744, 0.12).fillPoints(band(h.length), true);
        g.fillStyle(0xff1744, 0.25).fillPoints(band(h.length * progress), true);
        g.lineStyle(2, 0xff5252, 0.9).strokePoints(band(h.length), true);
        continue;
      }
      if (h.shape === 'ring') {
        // 輪: 太い線で描く。落ちるまでの残りは、輪の濃さで見せる
        const inner = h.innerRadius ?? 0;
        const mid = (h.radius + inner) / 2;
        g.lineStyle(h.radius - inner, 0xff1744, 0.12 + 0.18 * progress).strokeCircle(h.x, h.y, mid);
        g.lineStyle(2, 0xff5252, 0.9).strokeCircle(h.x, h.y, h.radius);
        g.lineStyle(2, 0xff5252, 0.9).strokeCircle(h.x, h.y, inner);
        continue;
      }
      g.fillStyle(0xff1744, 0.12).fillCircle(h.x, h.y, h.radius);
      g.fillStyle(0xff1744, 0.25).fillCircle(h.x, h.y, h.radius * progress);
      g.lineStyle(2, 0xff5252, 0.9).strokeCircle(h.x, h.y, h.radius);
    }
    // 伝説の周りの炎の輪（ファイヤーのほのおのうず）: 触れると削られる範囲
    const active = activeLegendField(this.sim.world);
    if (active?.field.aura) {
      const e = this.sim.world.enemies;
      const a = active.field.aura;
      const pulse = 0.5 + 0.5 * Math.sin(this.time.now / 120);
      g.fillStyle(hexColor(a.color), 0.22 + 0.12 * pulse).fillCircle(e.x[active.index]!, e.y[active.index]!, a.radius);
      g.lineStyle(4, hexColor(a.color), 0.95).strokeCircle(e.x[active.index]!, e.y[active.index]!, a.radius);
    }
    // 範囲技が残した床（凍った床・燃える地面）。消える前は薄くする
    for (const z of this.sim.world.zones) {
      const fade = Math.min(1, z.ticksLeft / 30);
      // 控えめな粒を出す技は、塗りをうすくする
      g.fillStyle(hexColor(z.color), (this.effects.linger(z.effect)?.fillAlpha ?? 0.3) * fade).fillCircle(z.x, z.y, z.radius);
    }
  }

  /**
   * マップに落ちている道具を、自作のドット絵（data/render/items.json）で描く。
   * きずぐすり＝紫のスプレー、マグネット＝赤い U 字、ふしぎなアメ＝青いアメ。ふわふわ上下させて目立たせる
   */
  private drawItems(timeMs: number): void {
    const g = this.itemView;
    g.clear();
    const seen = new Set<number>();
    for (const it of this.sim.world.items) {
      if (it.pending) continue;
      seen.add(it.id);
      let img = this.itemImages.get(it.id);
      if (!img) {
        img = this.add.image(it.x, it.y, pixelTextureKey(it.kind)).setScale(itemSprites.dot).setDepth(spriteRender.depths.items + 0.05);
        this.itemImages.set(it.id, img);
      }
      // ふわふわ上下させて目立たせる。足元に影
      img.setPosition(it.x, it.y + Math.sin(timeMs / 250 + it.id) * 3);
      g.fillStyle(0x000000, 0.25).fillEllipse(it.x, it.y + 14, 18, 6);
    }
    for (const [id, img] of this.itemImages) {
      if (seen.has(id)) continue;
      img.destroy();
      this.itemImages.delete(id);
    }
  }

  /** テストプレイの無敵: 受けたダメージを数えて HP を戻す（倒れない・凍らない） */
  private applyGod(): void {
    const me = this.sim.world.players.find((p) => p.id === this.localId);
    if (!me) return;
    for (const ev of this.sim.world.events) if (ev.type === 'playerDamaged' && ev.playerId === me.id) this.godDamage += ev.amount;
    me.hp = me.maxHp;
    me.down = false;
    me.frozenTicks = 0;
  }

  /** テストプレイの表示: 無敵であることと、受けたはずのダメージ（最大 HP の何回分か） */
  private drawGodText(cam: Phaser.Cameras.Scene2D.Camera, y: number): void {
    if (!this.god && this.testLegend === null) return;
    const me = this.sim.world.players.find((p) => p.id === this.localId);
    if (!me) return;
    this.godText ??= this.add.text(0, 0, '', px(16, '#ffcc80', { outline: true })).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1001);
    const text = this.god ? t('run.godMode', { damage: Math.round(this.godDamage), times: (this.godDamage / Math.max(1, me.maxHp)).toFixed(1) }) : t('run.testMode');
    if (this.godText.text !== text) this.godText.setText(text);
    this.placeUi(this.godText, cam.width / 2, y);
  }

  /** 伝説戦のマップの効果: 画面に色を重ねる（サンダーで暗く・フリーザーで白っぽく） */
  private drawFieldOverlay(): void {
    const overlay = activeField(this.sim.world)?.field.overlay;
    if (!overlay) {
      this.fieldOverlay?.setVisible(false);
      return;
    }
    const cam = this.cameras.main;
    this.fieldOverlay ??= this.add.rectangle(0, 0, 10, 10, 0x000000, 1).setOrigin(0, 0).setScrollFactor(0).setDepth(999);
    // 暗い空が、ときどき雷の光で明滅する（サンダー。見た目だけなので、乱数はシミュレーションのものを使わない）
    const flash = activeLegendField(this.sim.world)?.field.flash;
    const now = this.time.now;
    if (flash && now >= this.nextSkyFlashAt) {
      this.skyFlashAt = now;
      this.nextSkyFlashAt = now + flash.everySeconds * 1000 * (0.4 + Math.random() * 1.2);
    }
    const since = now - this.skyFlashAt;
    // 2回ちらつく光（0〜90ms と 140〜260ms）
    const lit = flash && (since < 90 || (since > 140 && since < 260));
    if (lit) this.fieldOverlay.setFillStyle(hexColor(flash.color), flash.alpha);
    else this.fieldOverlay.setFillStyle(hexColor(overlay.color), overlay.alpha);
    this.fieldOverlay.setSize(cam.width, cam.height).setVisible(true);
    this.placeUi(this.fieldOverlay, 0, 0);
  }

  /** マップの箱（攻撃を当てると開いて、一時的な強化を落とす） */
  private drawBoxes(): void {
    const seen = new Set<number>();
    for (const b of this.sim.world.boxes) {
      seen.add(b.id);
      if (this.boxImages.has(b.id)) continue;
      this.boxImages.set(b.id, this.add.image(b.x, b.y, pixelTextureKey('buff-box')).setScale(itemSprites.dot * 1.25).setDepth(spriteRender.depths.items));
    }
    for (const [id, img] of this.boxImages) {
      if (seen.has(id)) continue;
      img.destroy();
      this.boxImages.delete(id);
    }
  }

  /** 箱に攻撃が当たった（揺らす）・開いた（ふたが飛んで消える） */
  private onBoxEvent(ev: { type: 'boxHit'; id: number } | { type: 'boxRemoved'; id: number; x: number; y: number; opened: boolean }): void {
    if (ev.type === 'boxHit') {
      const img = this.boxImages.get(ev.id);
      if (img) this.tweens.add({ targets: img, angle: { from: -12, to: 0 }, duration: 160, ease: 'Back.Out' });
      return;
    }
    if (!ev.opened) return;
    const open = this.add.image(ev.x, ev.y, pixelTextureKey('buff-box-open')).setScale(itemSprites.dot * 1.25).setDepth(spriteRender.depths.items);
    this.tweens.add({ targets: open, alpha: 0, y: ev.y - 10, duration: 700, delay: 250, onComplete: () => open.destroy() });
    this.effects.playImpact('evolution', ev.x, ev.y);
  }

  /** ポーズの画面の、参加者の性格の一覧（番号の順。性格の無い地方は空。07 の89.3） */
  private natureRows(): string[] {
    const w = this.sim.world;
    return w.players
      .filter((p) => p.nature !== undefined)
      .map((p) => {
        const nature = natureLabel(w.rules, p.nature);
        const ability = abilityName(w, p);
        return t('pause.natureRow', { id: p.id, pokemon: localName(generated.pokemon[w.rules.species[p.species]?.key ?? '']?.names, getLocale(), ''), nature: ability ? t('pause.natureAbility', { nature, ability }) : nature });
      });
  }

  /** 右上（コインの下）に、自分の一時的な強化のアイコンと残りの秒数 */
  private drawBuffIcons(cam: Phaser.Cameras.Scene2D.Camera, top: number): void {
    const w = this.sim.world;
    const me = w.players.find((p) => p.id === this.localId);
    const buffs = me?.buffs ?? [];
    while (this.buffIcons.length < buffs.length) {
      this.buffIcons.push({
        icon: this.add.image(0, 0, '__DEFAULT').setOrigin(1, 0.5).setScrollFactor(0).setDepth(1001),
        text: this.add.text(0, 0, '', px(16, '#ffffff', { outline: true })).setOrigin(1, 0.5).setScrollFactor(0).setDepth(1001),
      });
    }
    this.buffIcons.forEach((v, k) => {
      const b = buffs[k];
      const def = b ? w.rules.pickups.items.buff?.buffs[b.index] : undefined;
      v.icon.setVisible(!!def);
      v.text.setVisible(!!def);
      if (!b || !def) return;
      const key = `icon:item:${def.item}`;
      if (v.icon.texture.key !== key && this.textures.exists(key)) v.icon.setTexture(key);
      // 残りが少ないと点滅
      const left = b.ticksLeft * w.dt;
      v.icon.setAlpha(left < 3 && Math.floor(left * 4) % 2 === 0 ? 0.35 : 1);
      v.text.setText(`${Math.ceil(left)}`);
      const y = top + 40 + k * 32;
      this.placeUi(v.text, cam.width - 8, y);
      this.placeUi(v.icon, cam.width - 14 - v.text.width, y);
      v.icon.setScale(2 / cam.zoom);
    });
  }

  /**
   * ふしぎなアメの抽選の演出: 「+1 / +3 / +5」を回してから、当たった数を出す（シミュレーションは演出の時間の後に上げる）。
   * 連続でレベルアップの選択が出る
   */
  private playCandy(levels: number): void {
    const choices = this.sim.world.rules.pickups.items['rare-candy'].levels.map((x) => x.levels);
    const reveal = this.sim.world.rules.pickups.items['rare-candy'].revealSeconds * 1000;
    const name = localName(generated.items['rare-candy']?.names, getLocale(), '');
    this.tweens.killTweensOf(this.announceText);
    this.announceText.setColor('#90caf9').setAlpha(1);
    // 自分の頭の上に箱を出し、抽選の間は揺らす
    const me = this.sim.world.players.find((p) => p.id === this.localId);
    const bx = me?.x ?? 0;
    const by = (me?.y ?? 0) - 56;
    const box = this.add.image(bx, by, pixelTextureKey('candy-box')).setScale(itemSprites.dot * 1.5).setDepth(spriteRender.depths.candy);
    const shake = this.tweens.add({ targets: box, angle: { from: -10, to: 10 }, duration: 90, yoyo: true, repeat: -1 });
    let k = 0;
    const timer = this.time.addEvent({
      delay: 70,
      loop: true,
      callback: () => {
        this.announceText.setText(t('candy.rolling', { name, levels: choices[k++ % choices.length]! }));
        audio.sfx.play('candy.roll');
      },
    });
    this.time.delayedCall(Math.max(0, reveal - 100), () => {
      timer.remove();
      shake.remove();
      box.setAngle(0).setTexture(pixelTextureKey('candy-box-open'));
      // 当たりの数は箱の上に大きく出す（上の文字と重ならないよう、抽選中の文字は消す）
      this.announceText.setAlpha(0);
      this.cameras.main.flash(250, 255, 255, 255);
      audio.sfx.play('candy.hit');
      this.burstCandies(bx, by, levels);
      this.showCandyLevels(bx, by, levels);
      this.tweens.add({ targets: box, alpha: 0, delay: 1400, duration: 400, onComplete: () => box.destroy() });
    });
  }

  /**
   * ふしぎなアメ: 当たりを箱のすぐ上に大きく出す（作者の指摘: 何レベル分の当たりか分かりづらい）。
   * 「GOTCHA!」「GOTCHA!!!」「GOTCHA!!!!!」（! の数 = 上がるレベル）をレアリティの色で出し、下に「レベル +N」を添える
   */
  private showCandyLevels(x: number, y: number, levels: number): void {
    const tier = candyTier(levels);
    const style = { fontFamily: uiConfig.font.family, stroke: '#000000', align: 'center' };
    // 「GOTCHA!」の ! の数とレアリティの色（青 RARE・紫 EPIC・橙 LEGENDARY）で当たりの大きさを表す（作者の決定。2026年10月21日）
    const big = this.add
      .text(x, y - 40, tMaybe(`candy.tier.${tier.levels}`), { ...style, fontSize: `${tier.fontSize}px`, color: tier.color, strokeThickness: Math.round(tier.fontSize / 6) })
      .setOrigin(0.5, 1)
      .setDepth(spriteRender.depths.candy + 0.2)
      .setScale(0.2);
    const label = this.add
      .text(x, y - 22, t('candy.big', { levels }), { ...style, fontSize: '16px', color: '#ffffff', strokeThickness: 4 })
      .setOrigin(0.5, 1)
      .setDepth(spriteRender.depths.candy + 0.2)
      .setAlpha(0);
    this.tweens.add({ targets: big, scale: 1, duration: 260, ease: 'Back.easeOut' });
    this.tweens.add({ targets: label, alpha: 1, delay: 180, duration: 200 });
    this.tweens.add({ targets: [big, label], y: '-=24', alpha: 0, delay: 1600, duration: 500, onComplete: () => (big.destroy(), label.destroy()) });
  }

  /**
   * ふしぎなアメ: 箱からアメがあふれ出る（作者の決定: 上がるレベルが多いほどたくさん出る。+1 ちょっと・+3 たくさん・+5 大量）
   */
  private burstCandies(x: number, y: number, levels: number): void {
    const count = candyTier(levels).count;
    for (let i = 0; i < count; i++) {
      const candy = this.add.image(x, y - 8, pixelTextureKey('rare-candy')).setScale(itemSprites.dot).setDepth(spriteRender.depths.candy + 0.1);
      // 上へ扇形に飛び出し、落ちながら消える
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * (count > 10 ? 1.4 : 0.9);
      const speed = 60 + Math.random() * (count > 10 ? 140 : 80);
      const delay = (i / count) * (count > 10 ? 500 : 200);
      const dx = Math.cos(a) * speed;
      const peak = Math.sin(a) * speed;
      this.tweens.add({ targets: candy, x: x + dx, delay, duration: 900, ease: 'Linear' });
      this.tweens.add({
        targets: candy,
        y: { from: y - 8, to: y - 8 + peak },
        delay,
        duration: 350,
        ease: 'Quad.easeOut',
        onComplete: () => this.tweens.add({ targets: candy, y: y + 40 + Math.random() * 30, alpha: 0, duration: 550, ease: 'Quad.easeIn', onComplete: () => candy.destroy() }),
      });
      this.tweens.add({ targets: candy, angle: (Math.random() - 0.5) * 360, delay, duration: 900 });
    }
  }


  /**
   * 画面上部（作者の決定。2026年10月22日）: いちばん上に経験値のバー（中にレベル）、その下の真ん中に経過時間（分母は出さない）、
   * 右にもらえるコイン、左に技・持ち物のアイコン。数字以外の文字は出さない。中ボス・ボスは HP のバーだけ
   */
  private drawTopCenter(): void {
    const w = this.sim.world;
    const cam = this.cameras.main;
    const cx = cam.width / 2;
    const now = elapsedSeconds(w);
    const limit = w.rules.stage.durationSeconds;
    const eb = uiConfig.expBar;
    // スマホ（画面の高さが低い）では細く（箱の強化のアイコンと大きさをそろえる）
    const barH = compactScreen() ? uiConfig.compactHud.expBarHeight : eb.height;
    const top = barH + 8;
    // 経験値のバー
    const g = this.topBar;
    g.clear();
    this.placeUi(g, 0, 0);
    const need = w.rules.leveling.xpToNext[w.level] ?? 0;
    const xpRatio = need > 0 ? Math.min(1, w.xpIntoLevel / need) : 1;
    g.fillStyle(hexColor(eb.border)).fillRect(0, 0, cam.width, barH);
    g.fillStyle(hexColor(eb.back)).fillRect(2, 2, cam.width - 4, barH - 4);
    g.fillStyle(hexColor(eb.fill)).fillRect(2, 2, Math.round((cam.width - 4) * xpRatio), barH - 4);
    this.levelText.setText(w.level >= w.rules.leveling.maxLevel ? t('run.levelMax') : `Lv${w.level}`);
    this.placeUi(this.levelText, 8, barH / 2);
    // 経過時間（伝説戦の間は、逃げられるまでの残り時間を赤で。中ボスが出ている間は、倒す締め切りまでの残り時間を赤で。07 の106章）
    const lg = w.legendary;
    const gateEnd = gateDeadlineTick(w);
    const gateLimit = w.rules.stage.bossRules.gateTimeLimitSeconds ?? 0;
    const gateLeft = gateEnd !== null && !w.outcome && w.tick >= gateEnd - Math.round(gateLimit / w.dt) ? Math.max(0, (gateEnd - w.tick) * w.dt) : null;
    const legendLeft = lg && lg.endTick > 0 ? Math.max(0, (lg.endTick - w.tick) * w.dt) : gateLeft;
    this.timerText.setText(formatTime(legendLeft ?? Math.min(now, limit))).setColor(legendLeft !== null ? '#ff5252' : uiConfig.timer.color);
    this.placeUi(this.timerText, cx, top);
    // テストの表示は、ボスの HP バーを何本も並べたときはその下へ
    this.drawGodText(cam, top + 56 + Math.max(0, this.bossRows - 1) * 20);
    // 自分の性格（ホウエン。07 の89.3）。あればコインと強化のアイコンをその下へずらす
    const nature = natureLabel(w.rules, w.players.find((p) => p.id === this.localId)?.nature);
    this.natureText.setText(nature).setVisible(nature !== '');
    this.placeUi(this.natureText, cam.width - 8, top + 12);
    // 自分の特性（07 の133章）: 性格の下。HP が少なくて効いている間（しんりょく など）は色を変える
    const me = w.players.find((p) => p.id === this.localId);
    const ability = me ? abilityName(w, me) : '';
    this.abilityText.setText(ability ? t('run.ability', { name: ability }) : '').setVisible(ability !== '');
    this.abilityText.setColor(me && pinchMods(w, me) ? '#ffab40' : '#ffffff');
    this.placeUi(this.abilityText, cam.width - 8, top + (nature ? 36 : 12));
    const rightTop = top + (nature ? 32 : 0) + (ability ? 24 : 0);
    // コイン（もらえる見込みがあるときだけ）
    const coins = this.recorder.liveCoins(w);
    this.coinText.setText(String(coins)).setVisible(coins > 0);
    this.coinIcon.setVisible(coins > 0);
    this.placeUi(this.coinText, cam.width - 8, rightTop + 12);
    this.placeUi(this.coinIcon, cam.width - 16 - this.coinText.width, rightTop + 12);
    this.coinIcon.setScale(2 / cam.zoom);
    this.drawBuffIcons(cam, rightTop);
    this.placeUi(this.bossBar, 0, 0);
    this.placeUi(this.announceText, cx, cam.height * 0.3);
    this.placeUi(this.downText, cx, cam.height * 0.7);
    this.placeUi(this.hudIcons.container, 8, top);
    this.hudTop = top;
    this.placeUi(this.hud, 8, top + this.hudIcons.container.getBounds().height + 8);
    this.drawBossBars(cam, cx, top + uiConfig.timer.size + 12);
  }

  /**
   * ボスの HP バー: 最後に出たボスと、同時に戦っている大ボス・伝説（レッド戦のエーフィとカビゴンなど）。
   * 1体なら今までどおり真ん中に1本、何体もいれば縦に並べ、それぞれの左に名前を出す（作者の依頼 2026年10月27日: だれの体力か分かるように）
   */
  private drawBossBars(cam: Phaser.Cameras.Scene2D.Camera, cx: number, top: number): void {
    const w = this.sim.world;
    const eb = uiConfig.expBar;
    this.bossBar.clear();
    const list: number[] = [];
    const add = (id: number): void => {
      const i = findEnemyIndex(w, id);
      if (i !== -1 && w.enemies.hp[i]! > 0 && !list.includes(i)) list.push(i);
    };
    if (this.bossId !== null) add(this.bossId);
    // タッグの相手（同時に出て、まだ倒れていない中ボス・ボス）
    this.bossIds = this.bossIds.filter((id) => {
      const i = findEnemyIndex(w, id);
      return i !== -1 && w.enemies.hp[i]! > 0;
    });
    for (const id of this.bossIds) add(id);
    for (const b of w.bosses) {
      const rank = w.rules.enemies.kinds[w.enemies.kind[findEnemyIndex(w, b.id)] ?? -1]?.rank;
      if (rank === 'boss' || rank === 'legendary') add(b.id);
    }
    const shown = list.slice(0, BOSS_BARS_MAX);
    this.bossRows = shown.length;
    const multi = shown.length > 1;
    const barW = multi ? Math.min(320, cam.width * 0.42) : Math.min(480, cam.width * 0.6);
    // 何体もいるときは、名前の分だけバーを右へずらす
    const left = multi ? Math.round(cx - barW / 2 + 60) : Math.round(cx - barW / 2);
    shown.forEach((i, k) => {
      const kind = w.rules.enemies.kinds[w.enemies.kind[i]!]!;
      const ratio = Math.max(0, w.enemies.hp[i]! / w.enemies.maxHp[i]!);
      const by = top + k * 20;
      this.bossBar.fillStyle(hexColor(eb.border)).fillRect(left - 2, by, Math.round(barW + 4), 12);
      this.bossBar.fillStyle(hexColor(eb.back)).fillRect(left, by + 2, Math.round(barW), 8);
      this.bossBar.fillStyle(kind.rank === 'boss' ? 0xf85838 : 0xf8c830).fillRect(left, by + 2, Math.round(barW * ratio), 8);
      let label = this.bossNames[k];
      if (!label) {
        label = this.add.text(0, 0, '', px(16, '#ffffff', { outline: true })).setOrigin(1, 0.5).setScrollFactor(0).setDepth(1000);
        this.bossNames.push(label);
      }
      const name = this.enemyName(w.enemies.kind[i]!);
      if (label.text !== name) label.setText(name);
      label.setVisible(multi);
      this.placeUi(label, left - 8, by + 6);
    });
    for (let k = shown.length; k < this.bossNames.length; k++) this.bossNames[k]!.setVisible(false);
  }

  private runSteps(steps: number, visible: boolean): void {
    for (let i = 0; i < steps; i++) {
      const t0 = performance.now();
      this.sim.step([...this.collectCommands(), ...this.inbox.splice(0)]);
      if (this.testLegendTick >= 0 && this.sim.world.tick >= this.testLegendTick && this.testLegend !== null) {
        this.testLegendTick = -1;
        if (!this.sim.world.outcome) startLegendary(this.sim.world, this.testLegend);
      }
      if (this.god) this.applyGod();
      this.simMs = this.simMs * 0.95 + (performance.now() - t0) * 0.05;
      // 記録は、タブが裏にあって描画しないときも数える
      this.recorder.observe(this.sim.world);
      for (const ev of this.sim.world.events) {
        // 派生・固有技を達成したら記録する（次からの「おや……？」の表示に使う）
        if (ev.type === 'upgradeChosen' && ev.playerId === this.localId && ev.offer.kind === 'derive') {
          addDiscovery(session.store, this.sim.world.rules.moves[ev.offer.to]!.key);
        }
        if (!visible) continue;
        if (ev.type === 'projectileHit') this.effects.playImpact(this.sim.world.rules.moves[ev.move]!.effect, ev.x, ev.y);
        if (ev.type === 'damageNumber') this.damageNumbers?.add(ev, performance.now());
        if (ev.type === 'evolved') this.onEvolved(ev.playerId, ev.from, ev.to, ev.asked ?? false);
        if (ev.type === 'evolveAsk' && ev.playerId === this.localId) this.onEvolveAsk(ev.from, ev.to);
      }
      if (visible) {
        this.onSimEvents();
        this.sounds.onEvents(this.sim.world);
      }
      this.sendNet();
    }
  }

  /**
   * 協力プレイ中は、タブが裏に回ってもシミュレーションを止めない（ホストが止まると全員が止まるため）。
   * 裏のタブでは描画のタイミング（requestAnimationFrame）が止まるので、描画が一定時間来なければタイマーで進める。
   * 「隠れているか」ではなく「描画が止まっているか」で判断する（隠れていると判定されないまま止まる環境があるため）。
   * ブラウザはタイマーも1秒に1回程度まで間引くため、まとめて追いつく。描画はしない。
   */
  private keepRunningWhenHidden(): void {
    this.lastFrameAt = performance.now();
    let timerLast = this.lastFrameAt;
    this.hiddenTimer = setInterval(() => {
      const now = performance.now();
      if (now - this.lastFrameAt > simulationConfig.stalledFrameMs) {
        const steps = this.clock.advance(now - Math.max(timerLast, this.lastFrameAt), simulationConfig.hiddenMaxTicksPerCall);
        this.runSteps(steps, false);
        timerLast = now;
      }
    }, this.clock.stepMs);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.hiddenTimer) clearInterval(this.hiddenTimer);
    });
  }

  /** 伝説のふつうと違う動き（カメックスの甲羅でくるくる回る・ためている間の動き）。ふつうなら null */
  private legendPose(i: number): { anim: string; spin: boolean } | null {
    const w = this.sim.world;
    const lg = w.legendary;
    if (!lg || !legendRoundKinds(w, lg.kind).includes(w.enemies.kind[i]!)) return null;
    const set = w.rules.stage.legendary?.moveSets[w.rules.enemies.kinds[w.enemies.kind[i]!]?.id ?? ''];
    if (!set) return null;
    const id = w.enemies.id[i]!;
    const charging = w.hazards.some((h) => h.dasher === id && h.activeTicks === undefined && w.rules.stage.moves[h.move]?.rooted);
    const ai = w.legendAis.get(id);
    const holding = !!ai?.holdTicks;
    if ((charging || holding) && set.chargePose) return { anim: set.chargePose, spin: false };
    if (set.shell && ai?.shell) return { anim: set.shell.pose, spin: set.shell.spin };
    return null;
  }

  /** 状態異常の色（data/game/status.json の並びで先にあるものを優先）。かかっていなければ null */
  private statusTint(i: number): number | null {
    const e = this.sim.world.enemies;
    const kinds = this.sim.world.statusKinds;
    // 遅れて爆発する印（みらいよち）: 黒く点滅（爆発が近いほど速く）
    if (e.markTicks[i]! > 0) {
      const period = e.markTicks[i]! > 20 ? 8 : 4;
      if (Math.floor(e.markTicks[i]! / period) % 2 === 0) return 0x111111;
    }
    for (let s = 0; s < kinds.length; s++) {
      if (e.hasStatus(i, s)) return this.statusColors[s]!;
    }
    return null;
  }

  /** 進化したら、光の演出を出して見た目を差し替える（スプライトは途中で読み込む） */
  /**
   * 時間帯のなつきの進化（イーブイ）: 「おや……？」の演出を見せ、移動をたくさん入れればキャンセル。答えをシミュレーションへ送る（07 の81章）
   */
  private onEvolveAsk(fromSpecies: number, species: number): void {
    const key = (n: number): string => this.sim.world.rules.species[n]?.key ?? '';
    const sprite = (k: string): string => (this.shinyPlayers.has(this.localId) ? shinySpriteKey(k) : k);
    const name = (k: string): string => localName(generated.pokemon[k]?.names, getLocale(), k);
    this.evolutionCutscene.play(sprite(key(fromSpecies)), sprite(key(species)), name(key(fromSpecies)), name(key(species)), this.coop ? 0.3 : 0.65, {
      presses: uiConfig.evolutionCancelPresses,
      readStick: () => this.joystick?.read() ?? { dx: 0, dy: 0 },
      onEnd: (accept) => this.uiCommands.push({ type: 'answerEvolve', playerId: this.localId, accept }),
    });
  }

  private onEvolved(playerId: PlayerId, fromSpecies: number, species: number, asked: boolean): void {
    const view = this.playerViews.get(playerId);
    const p = this.sim.world.players.find((x) => x.id === playerId);
    if (!view || !p) return;
    this.effects.playImpact('evolution', p.x, p.y);
    const key = this.sim.world.rules.species[species]?.key;
    if (!key) return;
    // 自分の進化: 進化前・進化後の姿が交互に点滅する演出（作者の決定 2026年10月25日）。協力プレイは止めないので薄く重ねる
    const fromKey = this.sim.world.rules.species[fromSpecies]?.key;
    if (playerId === this.localId && fromKey && !asked) {
      const sprite = (k: string): string => (this.shinyPlayers.has(playerId) ? shinySpriteKey(k) : k);
      const name = (k: string): string => localName(generated.pokemon[k]?.names, getLocale(), k);
      this.evolutionCutscene.play(sprite(fromKey), sprite(key), name(fromKey), name(key), this.coop ? 0.3 : 0.65);
    }
    void loadPokemonAtRuntime(this, this.shinyPlayers.has(playerId) ? shinySpriteKey(key) : key).then((loaded) => {
      if (loaded) view.setSprite(loaded.manifest);
    });
  }

  /** 1フレームの処理時間を測る（更新の始まりから描画の命令を出し終えるまで） */
  private measureFrameTime(): void {
    let start = 0;
    const onPre = (): void => {
      start = performance.now();
    };
    const onPost = (): void => {
      if (start > 0) this.frameMs = this.frameMs * 0.95 + (performance.now() - start) * 0.05;
    };
    this.game.events.on(Phaser.Core.Events.PRE_STEP, onPre);
    this.game.events.on(Phaser.Core.Events.POST_RENDER, onPost);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(Phaser.Core.Events.PRE_STEP, onPre);
      this.game.events.off(Phaser.Core.Events.POST_RENDER, onPost);
    });
  }

  /** 画面の座標 (clientX, clientY) にある技・持ち物のアイコン（無ければ null） */
  private hudIconAt(clientX: number, clientY: number): { kind: 'move' | 'item'; slot: number } | null {
    const rect = this.game.canvas.getBoundingClientRect();
    const cam = this.cameras.main;
    return this.hudIcons.hit(clientX - rect.left - cam.x - 8, clientY - rect.top - cam.y - this.hudTop);
  }

  /**
   * 技・持ち物のアイコンにマウスを乗せたら、詳細カードを出す（作者の案）。
   * タッチ（スマホ）では、タップしたアイコンのカードを、もう一度タップするかほかの場所をタップするまで出す（作者の依頼 2026年10月28日。07 の111章）。
   * カードは持ち物の列のすぐ下の決まった場所に出す（技でも持ち物でも同じ場所。持ち物がまだ無くても、その列のぶんを空ける）。レベルアップの選択中・ランの終わりは出さない
   */
  private updateHudCard(): void {
    const w = this.sim.world;
    const local = w.players.find((p) => p.id === this.localId);
    const ptr = this.input.activePointer;
    if (!local || w.levelUp || w.outcome) {
      this.pinnedCard = null;
      this.hudCard.hide();
      return;
    }
    const cam = this.cameras.main;
    const target = ptr.wasTouch ? this.pinnedCard : this.hudIcons.hit(ptr.x - cam.x - 8, ptr.y - cam.y - this.hudTop);
    const iconKey = !target
      ? null
      : target.kind === 'move'
        ? local.moves[target.slot]
          ? moveIconKey(w.rules, local.moves[target.slot]!.move)
          : null
        : local.items[target.slot]
          ? itemIconKey(w.rules, local.items[target.slot]!.item)
          : null;
    const rect = this.game.canvas.getBoundingClientRect();
    this.hudCard.show(w, local, target, iconKey, rect.left + cam.x + 8, rect.top + cam.y + this.hudTop + this.hudIcons.fullHeight + 4);
  }

  /** ローカルの入力を、変化があったときだけコマンドにする */
  private collectCommands(): InputCommand[] {
    const out = this.uiCommands.splice(0);
    // キーボードを優先し、押していなければジョイスティック
    const key = this.keyboard.read();
    const { dx, dy } = key.dx || key.dy || !this.joystick ? key : this.joystick.read();
    if (dx === this.lastSent.dx && dy === this.lastSent.dy) return out;
    this.lastSent = { dx, dy };
    return [...out, { type: 'move', playerId: this.localId, dx, dy }];
  }

  private draw(alpha: number, deltaMs: number, timeMs: number): void {
    const world = this.sim.world;
    const reviveNeed = Math.round(world.rules.stats.revive.touchSeconds / world.dt);
    for (const p of world.players) {
      const view = this.playerViews.get(p.id);
      view?.update(p, alpha, (world.reviveTouch.get(p.id) ?? 0) / reviveNeed);
      view?.setCharge(this.chargeOf(world, p));
    }
    const local = world.players.find((p) => p.id === this.localId);
    const localView = this.playerViews.get(this.localId);
    if (!local || !localView) return;
    const cam = this.cameras.main;
    const cx = localView.container.x;
    const cy = localView.container.y;
    cam.centerOn(cx, cy);
    this.ground.update(cam, currentWaveIndex(world), deltaMs);

    const halfW = cam.width / 2 / cam.zoom;
    const halfH = cam.height / 2 / cam.zoom;
    const view = { left: cx - halfW, top: cy - halfH, right: cx + halfW, bottom: cy + halfH };
    const enemyColor = hexColor(placeholderRender.enemyColor);
    const e = world.enemies;
    const gems = world.gems;
    this.gemView.update(
      gems,
      alpha,
      view,
      (i) => pixelTextureKey(gems.value[i]! >= world.rules.pickups.bigGemValue ? 'gem-big' : 'gem'),
      // 拾ってホストの確定を待っている玉は、自分の画面では消して見せる
      (i) => gems.pending[i] === 0,
    );
    this.streamer.update(world);
    const drawn =
      this.enemySpriteView.update(e, alpha, view, (i) => this.statusTint(i), (i) => this.legendPose(i)) +
      this.enemyView.update(
        e,
        alpha,
        view,
        (i) => this.statusTint(i) ?? enemyColor,
        (i) => e.hp[i]! > 0 && this.streamer.manifestOf(e.kind[i]!) === null,
      );
    const sprites = this.streamer.stats();
    const pr = world.projectiles;
    this.effects.drawProjectiles(
      pr,
      alpha,
      (i) => world.rules.moves[pr.move[i]!]!.effect,
      deltaMs,
      timeMs,
      (i) => (pr.shape[i] === SHAPE_LINE ? { length: pr.length[i]!, dirX: pr.dirX[i]!, dirY: pr.dirY[i]! } : null),
      (i) => (pr.shape[i] === SHAPE_SECTOR ? { dirX: pr.dirX[i]!, dirY: pr.dirY[i]!, half: pr.length[i]! } : null),
      // 出番を待っている当たり判定（爆炎の柱）は、現れるまで描かない
      (i) => pr.stage[i] === 3,
      // 外へ進む帯と、通った道に残る範囲には芯を描かない（道が光の線に見えてしまう）
      (i) => pr.band[i]! > 0 || (pr.stage[i] === 1 && pr.shape[i] === SHAPE_LINE && this.pathMoves.has(pr.move[i]!)) || this.flashing(i, pr) || this.isLightning(world, i),
      (i) => pr.stage[i] === 0,
      (i) => pr.linger[i] === 1,
    );
    // 技が落ちた後に残る範囲（効き方の puddle・ボスの技が残す床）から、控えめな粒を出す（作者の案 2026年10月24日）
    const lingerItems: Parameters<EffectRenderer['drawLinger']>[0][number][] = [];
    for (let i = 0; i < pr.count; i++) {
      if (pr.linger[i] !== 1) continue;
      lingerItems.push({
        recipeId: world.rules.moves[pr.move[i]!]!.effect,
        x: pr.x[i]!,
        y: pr.y[i]!,
        radius: pr.radius[i]!,
        line: pr.shape[i] === SHAPE_LINE ? { length: pr.length[i]!, dirX: pr.dirX[i]!, dirY: pr.dirY[i]! } : null,
      });
    }
    for (const z of world.zones) lingerItems.push({ recipeId: z.effect, x: z.x, y: z.y, radius: z.radius, line: null });
    this.effects.drawLinger(lingerItems, deltaMs);
    // 技のドット絵（技そのものだけ。効き方から出たものは今までどおり）
    this.moveSprites?.draw(pr, alpha, (i) => {
      const effect = world.rules.moves[pr.move[i]!]!.effect;
      if (pr.stage[i] === 0) {
        // 技そのものの絵と、重ねるもう1枚（だいばくはつの端の炎）
        const main = this.effects.sprite(effect);
        const edge = this.effects.edgeSprite(effect);
        return main && edge ? [main, edge] : (main ?? edge ?? null);
      }
      // 回復の技（なまける・ドわすれ）の見た目だけの円（遅れて弾ける印と同じ stage 2）
      if (pr.stage[i] === 2 && world.rules.moves[pr.move[i]!]!.pattern === 'heal') return this.effects.sprite(effect) ?? null;
      // 効き方から出た外へ進む輪（じしんの続く揺れ）も、輪の絵の技なら同じ絵
      if (pr.stage[i] === 1 && pr.band[i]! > 0) {
        const sp = this.effects.sprite(effect);
        if (sp?.fit === 'ring') return sp;
      }
      // 効き方から出た線: 通った道に残る範囲（ストーンエッジの岩の亀裂）と、突き出す線（じわれの亀裂・ストーンエッジの岩）
      if (pr.stage[i] === 1 && pr.shape[i] === SHAPE_LINE) {
        if (pr.linger[i] === 1 && this.pathMoves.has(pr.move[i]!)) return this.effects.pathSprite(effect) ?? null;
        return this.effects.effectLineSprite(effect) ?? null;
      }
      // 効き方から出た円・飛ぶもの（ブラストバーンの火の粉・ハードプラントの根・10まんボルトの周りの電気）
      if (pr.stage[i] === 1 && pr.band[i] === 0) return this.effects.effectSprite(effect) ?? null;
      return null;
    });
    // ボスの範囲技が落ちた所の絵: 出てからの時間でコマを進め、最後の 3 割で薄くする
    const now = this.time.now / 1000;
    this.strikes = this.strikes.filter((s) => now - s.start < s.seconds);
    this.strikeSprites?.drawItems(
      this.strikes.map((s) => {
        const elapsed = now - s.start;
        return { ...s.item, elapsed, alpha: Math.min(1, (s.seconds - elapsed) / (s.seconds * 0.3)) };
      }),
    );
    // 天気（こなゆき・ふぶき）: 出ている間、画面じゅうに雪を降らせる
    const weathers = new Set<string>();
    for (let i = 0; i < pr.count; i++) {
      if (pr.stage[i] !== 0) continue;
      const effect = world.rules.moves[pr.move[i]!]!.effect;
      if (effectRecipes[effect]?.weather) weathers.add(effect);
    }
    // 伝説戦のマップの効果の天気（フリーザーのふぶき）: プレイヤーの技と同じ雪を画面じゅうに
    const fieldWeather = activeField(world)?.field.weather;
    if (fieldWeather && effectRecipes[fieldWeather]?.weather) weathers.add(fieldWeather);
    this.effects.drawWeather(weathers, this.cameras.main.worldView, deltaMs);
    this.drawGhosts(world, alpha);
    this.drawFalls(world);
    this.drawBolts(world);
    this.drawScreenFlashes(world);
    this.hitShapes.draw(
      pr,
      alpha,
      (i) => this.shapeColorOf(pr, i, timeMs),
      (i) => (pr.shape[i] === SHAPE_LINE ? { length: pr.length[i]!, dirX: pr.dirX[i]!, dirY: pr.dirY[i]! } : null),
      view,
      (i) =>
        pr.shape[i] === SHAPE_SECTOR
          ? { dirX: pr.dirX[i]!, dirY: pr.dirY[i]!, half: pr.length[i]! }
          : pr.shape[i] === SHAPE_BOX
            ? { dirX: pr.dirX[i]!, dirY: pr.dirY[i]!, half: 0, box: boxShape(world, i) }
            : null,
      (i) => pr.band[i]!,
    );

    this.drawHazards(world.hazards);
    this.drawFieldOverlay();
    this.drawItems(timeMs);
    this.drawBoxes();
    this.obstacleView.update(world, view);
    this.drawTopCenter();
    if (world.outcome || (world.levelUp && !world.levelUp.done.has(this.localId))) this.edgeArrows.hide();
    else this.edgeArrows.update(this.edgeTargets(), this.cameras.main);

    const lu = world.levelUp;
    if (lu && !lu.done.has(this.localId) && !world.outcome) {
      const raw = lu.offers.get(this.localId) ?? [];
      // 回復とコインしか出ないとき: 自動で選ぶ設定なら、画面を出さずに選ぶ（同じ回は1回だけ頼む）
      const fallback = raw.length > 0 && raw.every((o) => o.kind === 'heal' || o.kind === 'coins');
      if (fallback && this.autoFallback) {
        // 回は通し番号で区別する（最大レベルの後はレベルが同じまま続くので、レベルでは区別できない）
        if (this.autoRequested !== lu.serial) {
          this.autoRequested = lu.serial;
          const want = this.autoNext;
          if (this.autoFallback === 'alternate') this.autoNext = want === 'heal' ? 'coins' : 'heal';
          const index = Math.max(0, raw.findIndex((o) => o.kind === want));
          if (this.sim.world.role === 'guest') this.sync?.requestUpgrade('c', index);
          else this.uiCommands.push({ type: 'chooseUpgrade', playerId: this.localId, index });
        }
        this.levelUpPanel.hide();
      } else {
        const offers = raw.map((o) => offerText(world, local, o, new Set(session.store.current.discoveries)));
        this.levelUpPanel.show(lu.level, offers, local.rerolls, Math.ceil(lu.ticksLeft * world.dt), local.bans, Math.max(0, world.level - lu.level), fallback, lu.serial);
      }
    } else {
      this.levelUpPanel.hide();
    }
    // 協力プレイのレベルアップ: 自分は選び終えて、ほかの人を待っている（全員が選んだら、再開までの短い間）
    const waiting = !!lu && lu.done.has(this.localId) && world.players.length > 1 && !world.outcome;
    if (this.waitingOverlay) {
      this.waitingOverlay.style.display = waiting ? 'flex' : 'none';
      if (waiting) {
        const text = world.players.every((pl) => lu.done.has(pl.id)) ? t('levelUp.resuming') : t('levelUp.waitingOthers');
        if (this.waitingOverlay.textContent !== text) this.waitingOverlay.textContent = text;
      }
    }
    // ポーズの画面: 止まっていれば（ゲストにはホストが止めたことを）出す。ゲストは止めずに設定だけを開ける
    const guestView = world.role === 'guest';
    if (world.paused) this.pausePanel.show(guestView ? 'hostPaused' : 'paused');
    else if (this.settingsOpen && guestView) this.pausePanel.show('settings');
    else this.pausePanel.hide();

    const debugLines = [
      t('debug.fps', { fps: this.game.loop.actualFps.toFixed(1), steps: this.lastSteps }),
      t('debug.enemies', { count: e.count, cap: enemyCap(world), drawn }),
      t('debug.combat', { kills: world.stats.kills, projectiles: world.projectiles.count }),
      t('debug.xp', { xp: Math.round(world.xp), gems: gems.count }),
      t('debug.simTime', { ms: this.simMs.toFixed(3) }),
      t('debug.frameTime', { ms: this.frameMs.toFixed(2) }),
      t('debug.enemySprites', { wave: currentWaveIndex(world) + 1, count: sprites.count, mb: (sprites.gpuBytes / 1048576).toFixed(2) }),
      t('debug.tick', { tick: world.tick }),
      t('debug.position', { x: Math.round(local.x), y: Math.round(local.y) }),
    ];
    // 倒れているときの案内だけは、ふだんも出す（真ん中の下）
    this.downText.setText(local.down ? t(this.coop ? 'run.downCoop' : 'debug.down', { revives: world.revives }) : '');
    const lines = [
      `${t('debug.controls')}　${t('run.debugToggle')}`,
      t('debug.player', {
        name: localName(generated.pokemon[world.rules.species[local.species]?.key ?? '']?.names, getLocale(), ''),
        hp: Math.ceil(local.hp),
        maxHp: Math.round(local.maxHp),
        revives: world.revives,
      }),
      t('debug.level', { level: world.level, xp: Math.floor(world.xpIntoLevel), need: world.rules.leveling.xpToNext[world.level] ?? 0, rerolls: local.rerolls }),
      // 技・持ち物・パッシブはアイコンで出す（文字は F3 の詳しい表示のときだけ）
      ...(this.showDebug ? [t('debug.moves', {
        moves: local.moves
          .map((m) => {
            const def = world.rules.moves[m.move]!;
            const name = localName(generated.moves[def.key]?.names, getLocale(), def.key);
            return `${name} Lv${m.level}/${moveMaxLevel(world.rules, m)}`;
          })
          .join(' / '),
      }),
      t('debug.items', {
        items: local.items.map((it) => localName(generated.items[world.rules.items[it.item]!.key]?.names, getLocale(), '') + ' Lv' + it.level).join(' / '),
      })] : []),
      ...(this.showDebug ? debugLines : []),
    ];
    if (this.coop && this.sync) {
      const transports = [...this.coop.room.transports.values()];
      const stats = transports.reduce((a, tr) => ({ sentBytes: a.sentBytes + tr.stats.sentBytes, receivedBytes: a.receivedBytes + tr.stats.receivedBytes }), { sentBytes: 0, receivedBytes: 0 });
      lines.push(
        t('debug.net', {
          role: t(this.coop.room.role === 'host' ? 'net.role.host' : 'net.role.guest'),
          room: this.coop.room.roomId,
          mode: t(transports.some((tr) => tr.kind === 'relay') ? 'net.mode.relay' : 'net.mode.p2p'),
          rtt: this.sync.rttMs === null ? '-' : Math.round(this.sync.rttMs),
        }),
        t('debug.netTraffic', {
          sent: (stats.sentBytes / 1024).toFixed(1),
          received: (stats.receivedBytes / 1024).toFixed(1),
          seconds: Math.round((performance.now() - this.netStartedAt) / 1000),
        }),
      );
    }
    // 左上の文字は F3 の詳しい表示のときだけ（作者の決定: 左上の UI はほかの場所へ移した）
    this.hud.setText(lines).setVisible(this.showDebug);
    this.hudIcons.update(world, local);
    this.updateHudCard();
  }
}

/** 前方の長方形（キバの技）の当たり判定の、向きに沿った始まり・終わりと片側の幅（ワールドの長さ） */
function boxShape(world: World, i: number): { from: number; to: number; half: number } {
  const pr = world.projectiles;
  const box = world.rules.moves[pr.move[i]!]!.frontBox;
  const reach = pr.radius[i]!;
  return { from: reach * (box?.start ?? 0), to: reach * (box?.end ?? 1), half: pr.length[i]! };
}

/** 重なったときの表示の順（作者の決定）: ボス（中ボス・伝説も）2 > スウォーム（ビリリダマなど）1 > 雑魚 0 */
function enemyLayer(rules: { enemies: { kinds: readonly { id: string; rank?: string }[] }; stage: { swarms: readonly { kind: string }[] } }, kind: number): number {
  const k = rules.enemies.kinds[kind];
  if (!k) return 0;
  if ((k.rank ?? 'normal') !== 'normal') return 2;
  return rules.stage.swarms.some((s) => s.kind === k.id) ? 1 : 0;
}

/** ふしぎなアメの当たりの見た目（data/render/items.json の candyBurst。同じ数が無ければ一番近いもの） */
function candyTier(levels: number): { levels: number; count: number; color: string; fontSize: number } {
  const table = itemSprites.candyBurst ?? [{ levels: 1, count: 4, color: '#ffffff', fontSize: 28 }];
  return table.find((c) => c.levels === levels) ?? table.reduce((a, b) => (Math.abs(b.levels - levels) < Math.abs(a.levels - levels) ? b : a));
}


/** 性格の名前と、上がる・下がる能力（「いじっぱり こうげき↑ とくこう↓」）。性格が無ければ空 */
/** プレイヤーの特性の名前（特性の無い地方・系統は空。トレースは写した特性も。07 の133章） */
function abilityName(world: World, p: World['players'][number]): string {
  const line = world.rules.abilities?.lines[p.line];
  if (!line) return '';
  const key = line.forms[p.species] ?? line.key;
  const name = (k: string): string => localName(generated.abilities[k]?.names, getLocale(), k);
  const now = abilityOf(world, p)?.key;
  return now && now !== key ? `${name(key)}（${name(now)}）` : name(key);
}

function natureLabel(rules: SimRules, nature: number | undefined): string {
  const n = nature === undefined ? undefined : rules.natures?.[nature];
  if (!n) return '';
  const name = localName(generated.natures[n.key]?.names, getLocale(), n.key);
  const stat = (s: NatureStat): string => t(`select.stat.${STAT_KEYS[s]}`);
  return n.up && n.down ? t('run.nature', { name, up: stat(n.up), down: stat(n.down) }) : t('run.natureNeutral', { name });
}

/** 性格の能力 → 翻訳ファイルの select.stat.<キー> */
const STAT_KEYS: Record<NatureStat, 'attack' | 'defense' | 'specialAttack' | 'specialDefense' | 'speed'> = { attack: 'attack', defense: 'defense', 'special-attack': 'specialAttack', 'special-defense': 'specialDefense', speed: 'speed' };
