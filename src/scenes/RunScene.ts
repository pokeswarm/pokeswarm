import Phaser from 'phaser';
import { achievementsConfig, effectRecipes, generated, groundConfig, iconConfig, itemIcons, itemSprites, obstacleSprites, networkConfig, placeholderRender, playerConfig, saveConfig, shopConfig, simulationConfig, spriteRender, stageConfig, uiConfig } from '../data';
import { buildSimRules, localName, mergeModifiers, permanentModifiers, playableLoadout } from '../data/simRules';
import { permanentBonus } from '../meta/shop';
import { emptySave } from '../meta/saveData';
import type { EffectRecipe, SpriteAnims } from '../data/schema';
import { getLocale, t, tMaybe } from '../i18n';
import type { Room, RoomPlayer } from '../net/room';
import { SyncSession } from '../net/sync';
import { hexColor } from '../render/color';
import { EdgeArrows, type EdgeTarget } from '../render/EdgeArrows';
import { EffectRenderer } from '../render/effects/EffectRenderer';
import { audio } from '../audio';
import { RunSounds } from '../audio/runSounds';
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
import { px } from '../render/pixelUi';
import { preloadPokemonAtlas, registerPokemonAnimations } from '../render/sprites/PokemonSprite';
import { EnemySprites } from '../render/sprites/EnemySprites';
import { SpriteStreamer } from '../render/sprites/SpriteStreamer';
import { loadPokemonAtRuntime } from '../render/sprites/runtimeLoad';
import { addSpriteGallery } from '../render/sprites/SpriteGallery';
import type { Axis, InputCommand, PlayerId } from '../sim/commands';
import { SHAPE_CIRCLE, SHAPE_LINE, SHAPE_SECTOR } from '../sim/entities/projectiles';
import { FixedStepClock } from '../sim/fixedStep';
import { Simulation } from '../sim/simulation';
import { currentWaveIndex, elapsedSeconds, enemyCap, findEnemyIndex, type Hazard, type SimRole, type World } from '../sim/world';
import { applyDebugOverrides, parseLevelParam, parseMovesParam, parseSectionParam, parseTimeParam } from './debugOverrides';
import { addXp, applyOffer } from '../sim/systems/leveling';
import { achievementPerks } from '../meta/achievementPerks';
import { addDiscovery } from '../meta/discoveries';
import { achievementName, achievementRewardById } from '../meta/achievementText';
import { RunRecorder } from '../meta/runRecorder';
import { session } from '../meta/session';
import { LevelUpPanel, offerText } from './levelUpPanel';
import { NetPanel } from './netPanel';
import { formatTime, type ResultSceneData } from './ResultScene';
import { atlasKey } from '../render/sprites/PokemonSprite';

/** ソロとホストのプレイヤーの番号（ゲストは部屋でもらった番号 2〜） */
const HOST_PLAYER_ID: PlayerId = 1;

/** 協力プレイのラン（待合室で決まったもの） */
export interface CoopRun {
  room: Room;
  /** 参加者とポケモン（番号の順） */
  players: RoomPlayer[];
  /** ポケモンごとのスプライト（待合室で読み込んだもの） */
  sprites: Map<string, SpriteAnims | null>;
}

export interface RunSceneData {
  /** 自分のポケモン（data/game/playables.json のキー） */
  pokemon: string;
  /** 自分のスプライト。取得していなければ null（仮の円で描く） */
  playerSprite: SpriteAnims | null;
  /** 協力プレイ。ソロなら null */
  coop: CoopRun | null;
}

/**
 * ラン中のシーン。
 * 入力 → コマンド → 固定間隔でシミュレーションを進める → 補間して描く、の流れを担う。
 * 協力プレイでは、届いたメッセージもコマンドに直して同じ流れに乗せる。
 */
export class RunScene extends Phaser.Scene {
  private sim!: Simulation;
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
  private coinText!: Phaser.GameObjects.Text;
  /** 倒れているときの案内（真ん中の下） */
  private downText!: Phaser.GameObjects.Text;
  /** 持っている技・持ち物・パッシブのアイコンとレベルの星 */
  private hudIcons!: HudIcons;
  /** アイコンにマウスを乗せたときの詳細カード（PC だけ） */
  private hudCard!: HudCard;
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
  /** マップの障害物 */
  private obstacleView!: ObstacleView;
  /** 画面上の真ん中: 経過時間、中ボス・ボスの HP、お知らせ */
  private timerText!: Phaser.GameObjects.Text;
  private bossBar!: Phaser.GameObjects.Graphics;
  private bossName!: Phaser.GameObjects.Text;
  private announceText!: Phaser.GameObjects.Text;
  /** HP のバーを出している中ボス・ボス（最後に出たもの） */
  private bossId: number | null = null;
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
    this.boltView = null;
    this.flashedSerials = new Set();
    this.inbox = [];
    this.uiCommands = [];
    this.lastSent = { dx: 0, dy: 0 };
    this.sync = null;
    this.lastHeard = new Map();
    this.hiddenTimer = null;
    this.bossId = null;
    this.resultAt = null;
    this.runRecorded = false;
    this.newAchievements = [];
    this.newUnlocks = [];
    this.legendaryResult = null;
    this.showDebug = new URLSearchParams(window.location.search).has('debug');
    this.playerSprite = data.playerSprite;
    this.pokemon = data.pokemon;
    this.coop = data.coop;
    this.panel = null;
  }

  preload(): void {
    preloadGroundTiles(this, groundConfig);
    // ポケモン選択の画面で読み込み済みなら読み直さない
    if (this.playerSprite && !this.textures.exists(atlasKey(this.playerSprite.key))) preloadPokemonAtlas(this, this.playerSprite);
  }

  create(): void {
    if (this.playerSprite) registerPokemonAnimations(this, this.playerSprite);
    const rules = applyDebugOverrides(buildSimRules(), window.location.search);
    this.pathMoves = new Set(rules.moves.flatMap((m, k) => (m.effects.some((fx) => fx.puddle?.path) ? [k] : [])));
    this.boltMoves = new Map(rules.moves.flatMap((m, k) => { const b = effectRecipes[m.effect]?.bolt; return b ? [[k, b] as const] : []; }));
    this.flashMoves = new Map(rules.moves.flatMap((m, k) => { const f = effectRecipes[m.effect]?.burstFlash; return f ? [[k, f] as const] : []; }));
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
    const roster: RoomPlayer[] = this.coop?.players ?? [{ id: HOST_PLAYER_ID, pokemon: this.pokemon, upgrades: session.store.current.upgrades, achievements: session.store.current.achievements }];
    // 実績の報酬（07 23・24章）: 各自の達成した実績から、解放した持ち物・特殊なバフを計算する。協力プレイの経験値は部屋の全員に
    const perksOf = new Map(roster.map((r) => [r.id, achievementPerks(achievementsConfig, r.achievements)]));
    const coopXpPct = role === 'solo' ? 0 : Math.max(0, ...[...perksOf.values()].map((x) => x.coopXpPct));
    // 確認用の ?moves= はソロのときだけ
    const debugMoves = this.coop ? null : parseMovesParam(rules, window.location.search);
    for (const { id, pokemon, upgrades } of roster) {
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
      // 伝説を倒した実績の報酬: 解放したステータスのアイテムを1つ持って始める（共有の乱数なので、どのブラウザでも同じ）
      if (perks.startStatItem) {
        const pool = rules.items.flatMap((it, i) => (it.category === 'stat' && p.unlockedItems?.has(i) ? [i] : []));
        if (pool.length) applyOffer(this.sim.world, p, { kind: 'itemNew', item: pool[this.sim.world.rng.int(pool.length)]! });
      }
      const sprite = id === this.localId ? this.playerSprite : (this.coop?.sprites.get(pokemon) ?? null);
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
    if (this.coop) this.setupNet(this.coop.room);

    this.clock = new FixedStepClock(simulationConfig.tickRate, simulationConfig.maxTicksPerFrame);
    this.keyboard = new KeyboardInput(this);
    if (isTouchDevice()) {
      const stick = new TouchJoystick(this.game.canvas);
      this.joystick = stick;
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        stick.destroy();
        this.joystick = null;
      });
    }
    this.ground = new GroundTiles(this, groundConfig, currentWaveIndex(this.sim.world));
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
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.levelUpPanel.hide());
    this.statusColors = this.sim.world.statusKinds.map((k) => hexColor(k.color));
    this.effects = new EffectRenderer(this, effectRecipes, depths.effects, spriteRender.effectPixel);
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
    this.timerText = this.add.text(0, 10, '', px(24, uiConfig.timer.color, { outline: true })).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1000);
    this.bossBar = this.add.graphics().setScrollFactor(0).setDepth(1000);
    this.bossName = this.add.text(0, 50, '', px(16, '#ffffff', { outline: true })).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1000).setVisible(false);
    this.announceText = this.add.text(0, 0, '', px(32, '#ffffff', { outline: true, align: 'center', lineSpacing: 8 })).setOrigin(0.5).setScrollFactor(0).setDepth(1001);
    this.downText = this.add.text(0, 0, '', px(16, '#ffffff', { outline: true, align: 'center' })).setOrigin(0.5).setScrollFactor(0).setDepth(1001);
    this.input.keyboard?.on('keydown-F3', () => {
      this.showDebug = !this.showDebug;
    });
    // M で音を消す・戻す（音量は タイトルの O の設定）
    this.input.keyboard?.on('keydown-M', () => {
      audio.settings.update({ muted: !audio.settings.current.muted });
      this.announce(t(audio.settings.current.muted ? 'audio.muted' : 'audio.unmuted'), '#cfd8dc');
    });
    this.sounds = new RunSounds(this.localId);
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
    const watchdog = setInterval(() => {
      const now = performance.now();
      for (const [id, at] of this.lastHeard) {
        if (now - at > networkConfig.silenceTimeoutSeconds * 1000) {
          this.lastHeard.delete(id);
          room.disconnect(id);
        }
      }
    }, 1000);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => clearInterval(watchdog));
    room.onLeave = (id) => {
      if (id === HOST_PLAYER_ID) {
        // ホストとの接続が切れたら、ランを終えて（ここまでの記録を保存して）結果画面へ
        this.panel?.show('net.hostLeft');
        this.inbox.push({ type: 'endRun', outcome: 'disconnected' });
      } else {
        // ホスト: 抜けたプレイヤーを外して続ける（ゲストへも知らせる）
        this.inbox.push({ type: 'removePlayer', playerId: id });
      }
    };
    this.netStartedAt = performance.now();
  }

  /** 相手ごとの、最後に通信が届いた時刻 */
  private lastHeard = new Map<PlayerId, number>();

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
    const paused = !this.coop && (orientationGuard?.blocked ?? false);
    const steps = paused ? 0 : this.clock.advance(delta);
    this.runSteps(steps, true);
    this.lastSteps = steps;
    // 止まっている間（レベルアップの選択・ランの終わり）は前回と今回の位置の間を補間しない（補間の割合だけが毎フレーム変わり、画面全体が震えて見えた）
    const w = this.sim.world;
    this.draw(w.levelUp || w.outcome ? 1 : this.clock.alpha, delta, time);
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
    this.recorder = new RunRecorder(session.store, this.pokemon, shopConfig);
    const autosave = this.time.addEvent({
      delay: saveConfig.autosaveSeconds * 1000,
      loop: true,
      callback: () => {
        this.recorder.commit(this.sim.world);
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
    this.recorder.finish(this.sim.world);
    this.noteProgress();
    void session.store.flush();
  }

  /** 伝説戦の結果（結果画面に出す） */
  private legendaryResult: { kind: number; result: 'won' | 'lost' | 'timeUp' | null } | null = null;

  private enemyName(kind: number): string {
    const k = this.sim.world.rules.enemies.kinds[kind];
    return k ? localName(generated.pokemon[k.species ?? k.id]?.names, getLocale(), k.id) : '';
  }

  /** このランで新しく達成した実績・解放したポケモン（結果画面に出す） */
  private newAchievements: string[] = [];
  private newUnlocks: string[] = [];

  /** 記録を足した後: 新しく達成した実績を知らせ、結果画面のために覚えておく */
  private noteProgress(): void {
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
    for (const ev of w.events) {
      if (ev.type === 'bossAppeared') {
        const kind = w.rules.enemies.kinds[ev.kind]!;
        this.bossId = ev.id;
        const name = localName(generated.pokemon[kind.species ?? kind.id]?.names, getLocale(), kind.id);
        this.announce(t(kind.rank === 'boss' ? 'run.bossAppeared' : 'run.midbossAppeared', { name }), kind.rank === 'boss' ? '#ff8a65' : '#ffe082');
      } else if (ev.type === 'itemCollected') {
        const it = ev;
        if (it.kind === 'rare-candy') this.playCandy(it.levels);
        else if (it.kind === 'magnet') this.announce(t('item.magnet'), '#ef9a9a');
        else if (it.by === this.localId) this.announce(localName(generated.items.potion?.names, getLocale(), ''), '#ce93d8');
      } else if (ev.type === 'bodyAttack') {
        this.playerViews.get(ev.playerId)?.lunge(ev.dirX, ev.dirY, ev.distance, ev.afterimages);
      } else if (ev.type === 'playerLeft') {
        this.playerViews.get(ev.playerId)?.container.destroy();
        this.playerViews.delete(ev.playerId);
        this.announce(t('net.playerLeft', { n: ev.playerId }), '#ef9a9a');
      } else if (ev.type === 'hazardStruck') {
        if (ev.shape === 'line') {
          // 直線は、線に沿っていくつか演出を出す
          for (let d = 0; d <= ev.length; d += Math.max(60, ev.length / 6)) this.effects.playImpact(ev.effect, ev.x + ev.dirX * d, ev.y + ev.dirY * d);
        } else if (ev.shape === 'ring') {
          // 輪は、輪に沿っていくつか演出を出す
          for (let k = 0; k < 8; k++) this.effects.playImpact(ev.effect, ev.x + Math.cos((k * Math.PI) / 4) * ev.radius, ev.y + Math.sin((k * Math.PI) / 4) * ev.radius);
        } else {
          this.effects.playImpact(ev.effect, ev.x, ev.y);
        }
      } else if (ev.type === 'legendaryWarning') {
        // 伝説の乱入（01_game_design.md 7.1 の「DANGER」）
        this.tweens.killTweensOf(this.announceText);
        this.announceText.setText(t('run.danger')).setColor('#ff5252').setAlpha(1);
        this.tweens.add({ targets: this.announceText, alpha: 0.2, duration: 250, yoyo: true, repeat: 5, onComplete: () => this.announceText.setAlpha(0) });
      } else if (ev.type === 'swarmStarted') {
        const s = w.rules.stage.swarms[ev.swarm];
        if (s) this.announce(tMaybe(`swarm.${s.pattern}`, { name: localName(generated.pokemon[s.kind.replace(/^swarm-/, '')]?.names, getLocale(), s.kind) }), '#ffcc80');
      } else if (ev.type === 'runEnded') {
        const clear = ev.outcome === 'clear';
        this.tweens.killTweensOf(this.announceText);
        this.announceText.setText(t(`run.${ev.outcome}`)).setColor(clear ? '#ffe082' : '#ef9a9a').setAlpha(1);
        this.legendaryResult = ev.legendary;
        this.resultAt = performance.now() + stageConfig.endDelaySeconds * 1000;
      }
    }
  }

  /** ためる光: 再使用の残りが決まった秒数を切った技があれば、その光（いちばん出す直前のもの） */
  private chargeOf(world: World, p: World['players'][number]): { color: number; radius: number; alpha: number; t: number } | null {
    if (p.down) return null;
    let best: { color: number; radius: number; alpha: number; t: number } | null = null;
    for (const pm of p.moves) {
      const c = this.effects.chargeGlow(world.rules.moves[pm.move]!.effect);
      if (!c || pm.cooldown <= 0 || pm.cooldown > c.seconds) continue;
      const t = 1 - pm.cooldown / c.seconds;
      if (!best || t > best.t) best = { color: hexColor(c.color), radius: c.radius, alpha: c.alpha, t };
    }
    return best;
  }

  /** 色を切り替えて光らせる円（10まんボルトの自分の周り・かみなりの落雷） */
  private flashing(i: number, pr: World['projectiles']): boolean {
    return pr.stage[i] !== 3 && pr.shape[i] === SHAPE_CIRCLE && this.flashMoves.has(pr.move[i]!);
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

  /** 落雷（かみなり）: 当たり判定が出てからしばらく、上からジグザグの稲妻を落とす。形は毎フレーム変えて、ちらつかせる */
  private drawBolts(world: World): void {
    if (!this.boltView) this.boltView = this.add.graphics().setDepth(spriteRender.depths.effects + 0.3);
    const g = this.boltView;
    g.clear();
    const pr = world.projectiles;
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
    const base = this.shapeColors[pr.move[i]!] ?? null;
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
      const x = pr.prevX[i]! + (pr.x[i]! - pr.prevX[i]!) * alpha;
      const y = pr.prevY[i]! + (pr.y[i]! - pr.prevY[i]!) * alpha;
      // 1回の更新で進む量。後ろの残像は、それを spacingTicks 回ぶんずつ戻した所に置く
      const stepX = pr.x[i]! - pr.prevX[i]!;
      const stepY = pr.y[i]! - pr.prevY[i]!;
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
          .setTint(hexColor(ghost.tint))
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
    // 範囲技が残した床（凍った床・燃える地面）。消える前は薄くする
    for (const z of this.sim.world.zones) {
      const fade = Math.min(1, z.ticksLeft / 30);
      g.fillStyle(hexColor(z.color), 0.3 * fade).fillCircle(z.x, z.y, z.radius);
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
    const barH = eb.height;
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
    this.levelText.setText(`Lv${w.level}`);
    this.placeUi(this.levelText, 8, barH / 2);
    // 経過時間（伝説戦の間は、逃げられるまでの残り時間を赤で）
    const lg = w.legendary;
    const legendLeft = lg && lg.endTick > 0 ? Math.max(0, (lg.endTick - w.tick) * w.dt) : null;
    this.timerText.setText(formatTime(legendLeft ?? Math.min(now, limit))).setColor(legendLeft !== null ? '#ff5252' : uiConfig.timer.color);
    this.placeUi(this.timerText, cx, top);
    // コイン（もらえる見込みがあるときだけ）
    const coins = this.recorder.liveCoins(w);
    this.coinText.setText(String(coins)).setVisible(coins > 0);
    this.coinIcon.setVisible(coins > 0);
    this.placeUi(this.coinText, cam.width - 8, top + 12);
    this.placeUi(this.coinIcon, cam.width - 16 - this.coinText.width, top + 12);
    this.coinIcon.setScale(2 / cam.zoom);
    this.placeUi(this.bossName, cx, 50);
    this.placeUi(this.bossBar, 0, 0);
    this.placeUi(this.announceText, cx, cam.height * 0.3);
    this.placeUi(this.downText, cx, cam.height * 0.7);
    this.placeUi(this.hudIcons.container, 8, top);
    this.hudTop = top;
    this.placeUi(this.hud, 8, top + this.hudIcons.container.getBounds().height + 8);
    this.bossBar.clear();
    const i = this.bossId === null ? -1 : findEnemyIndex(w, this.bossId);
    if (i === -1 || w.enemies.hp[i]! <= 0) {
      this.bossName.setText('');
      return;
    }
    const kind = w.rules.enemies.kinds[w.enemies.kind[i]!]!;
    const barW = Math.min(480, cam.width * 0.6);
    const ratio = Math.max(0, w.enemies.hp[i]! / w.enemies.maxHp[i]!);
    const by = top + uiConfig.timer.size + 12;
    this.bossBar.fillStyle(hexColor(eb.border)).fillRect(Math.round(cx - barW / 2 - 2), by, Math.round(barW + 4), 12);
    this.bossBar.fillStyle(hexColor(eb.back)).fillRect(Math.round(cx - barW / 2), by + 2, Math.round(barW), 8);
    this.bossBar.fillStyle(kind.rank === 'boss' ? 0xf85838 : 0xf8c830).fillRect(Math.round(cx - barW / 2), by + 2, Math.round(barW * ratio), 8);
    this.bossName.setText(localName(generated.pokemon[kind.species ?? kind.id]?.names, getLocale(), kind.id));
  }

  private runSteps(steps: number, visible: boolean): void {
    for (let i = 0; i < steps; i++) {
      const t0 = performance.now();
      this.sim.step([...this.collectCommands(), ...this.inbox.splice(0)]);
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
        if (ev.type === 'evolved') this.onEvolved(ev.playerId, ev.to);
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

  /** 状態異常の色（data/game/status.json の並びで先にあるものを優先）。かかっていなければ null */
  private statusTint(i: number): number | null {
    const e = this.sim.world.enemies;
    const kinds = this.sim.world.statusKinds;
    for (let s = 0; s < kinds.length; s++) {
      if (e.hasStatus(i, s)) return this.statusColors[s]!;
    }
    return null;
  }

  /** 進化したら、光の演出を出して見た目を差し替える（スプライトは途中で読み込む） */
  private onEvolved(playerId: PlayerId, species: number): void {
    const view = this.playerViews.get(playerId);
    const p = this.sim.world.players.find((x) => x.id === playerId);
    if (!view || !p) return;
    this.effects.playImpact('evolution', p.x, p.y);
    const key = this.sim.world.rules.species[species]?.key;
    if (!key) return;
    void loadPokemonAtRuntime(this, key).then((loaded) => {
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

  /**
   * 技・持ち物のアイコンにマウスを乗せたら、詳細カードを出す（作者の案。PC だけ。タッチでは出さない）。
   * カードは持ち物の列のすぐ下の決まった場所に出す（技でも持ち物でも同じ場所。持ち物がまだ無くても、その列のぶんを空ける）。レベルアップの選択中・ランの終わりは出さない
   */
  private updateHudCard(): void {
    const w = this.sim.world;
    const local = w.players.find((p) => p.id === this.localId);
    const ptr = this.input.activePointer;
    if (!local || w.levelUp || w.outcome || ptr.wasTouch) {
      this.hudCard.hide();
      return;
    }
    const cam = this.cameras.main;
    const target = this.hudIcons.hit(ptr.x - cam.x - 8, ptr.y - cam.y - this.hudTop);
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
      this.enemySpriteView.update(e, alpha, view, (i) => this.statusTint(i)) +
      this.enemyView.update(
        e,
        alpha,
        view,
        (i) => this.statusTint(i) ?? enemyColor,
        (i) => this.streamer.manifestOf(e.kind[i]!) === null,
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
      (i) => pr.band[i]! > 0 || (pr.stage[i] === 1 && pr.shape[i] === SHAPE_LINE && this.pathMoves.has(pr.move[i]!)) || this.flashing(i, pr),
    );
    this.drawGhosts(world, alpha);
    this.drawBolts(world);
    this.drawScreenFlashes(world);
    this.hitShapes.draw(
      pr,
      alpha,
      (i) => this.shapeColorOf(pr, i, timeMs),
      (i) => (pr.shape[i] === SHAPE_LINE ? { length: pr.length[i]!, dirX: pr.dirX[i]!, dirY: pr.dirY[i]! } : null),
      view,
      (i) => (pr.shape[i] === SHAPE_SECTOR ? { dirX: pr.dirX[i]!, dirY: pr.dirY[i]!, half: pr.length[i]! } : null),
      (i) => pr.band[i]!,
    );

    this.drawHazards(world.hazards);
    this.drawItems(timeMs);
    this.obstacleView.update(world, view);
    this.drawTopCenter();
    if (world.outcome || (world.levelUp && !world.levelUp.done.has(this.localId))) this.edgeArrows.hide();
    else this.edgeArrows.update(this.edgeTargets(), this.cameras.main);

    const lu = world.levelUp;
    if (lu && !lu.done.has(this.localId) && !world.outcome) {
      const offers = (lu.offers.get(this.localId) ?? []).map((o) => offerText(world, local, o, new Set(session.store.current.discoveries)));
      this.levelUpPanel.show(lu.level, offers, local.rerolls, Math.ceil(lu.ticksLeft * world.dt), local.bans, Math.max(0, world.level - lu.level));
    } else {
      this.levelUpPanel.hide();
    }

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
            return `${name} Lv${m.level}/${def.levels.length}`;
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

