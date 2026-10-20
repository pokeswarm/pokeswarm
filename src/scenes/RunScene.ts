import Phaser from 'phaser';
import { effectRecipes, generated, networkConfig, placeholderRender, playerConfig, saveConfig, simulationConfig, spriteRender, stageConfig } from '../data';
import { buildSimRules, localName, playableLoadout } from '../data/simRules';
import type { SpriteAnims } from '../data/schema';
import { getLocale, t } from '../i18n';
import type { Room, RoomPlayer } from '../net/room';
import { SyncSession } from '../net/sync';
import { hexColor } from '../render/color';
import { EffectRenderer } from '../render/effects/EffectRenderer';
import { GroundGrid } from '../render/GroundGrid';
import { KeyboardInput } from '../render/KeyboardInput';
import { PlayerView } from '../render/PlayerView';
import { PooledCircles } from '../render/PooledCircles';
import { preloadPokemonAtlas, registerPokemonAnimations } from '../render/sprites/PokemonSprite';
import { EnemySprites } from '../render/sprites/EnemySprites';
import { SpriteStreamer } from '../render/sprites/SpriteStreamer';
import { loadPokemonAtRuntime } from '../render/sprites/runtimeLoad';
import { addSpriteGallery } from '../render/sprites/SpriteGallery';
import type { Axis, InputCommand, PlayerId } from '../sim/commands';
import { SHAPE_LINE } from '../sim/entities/projectiles';
import { FixedStepClock } from '../sim/fixedStep';
import { Simulation } from '../sim/simulation';
import { currentWaveIndex, elapsedSeconds, enemyCap, findEnemyIndex, type Hazard, type SimRole } from '../sim/world';
import { applyDebugOverrides, parseLevelParam, parseMovesParam, parseTimeParam } from './debugOverrides';
import { addXp } from '../sim/systems/leveling';
import { addDiscovery } from '../meta/discoveries';
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
  private playerViews = new Map<PlayerId, PlayerView>();
  private enemyView!: PooledCircles;
  private gemView!: PooledCircles;
  /** 敵をスプライトで描く（読み込み済みの種類だけ。まだの種類は円で描く） */
  private enemySpriteView!: EnemySprites;
  private streamer!: SpriteStreamer;
  /** 1フレームの処理時間（シミュレーション・描画の命令を含む。移動平均, ms） */
  private frameMs = 0;
  private statusColors: number[] = [];
  private effects!: EffectRenderer;
  private ground!: GroundGrid;
  private hud!: Phaser.GameObjects.Text;
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
    this.inbox = [];
    this.uiCommands = [];
    this.lastSent = { dx: 0, dy: 0 };
    this.sync = null;
    this.lastHeard = new Map();
    this.hiddenTimer = null;
    this.bossId = null;
    this.resultAt = null;
    this.runRecorded = false;
    this.showDebug = new URLSearchParams(window.location.search).has('debug');
    this.playerSprite = data.playerSprite;
    this.pokemon = data.pokemon;
    this.coop = data.coop;
    this.panel = null;
  }

  preload(): void {
    // ポケモン選択の画面で読み込み済みなら読み直さない
    if (this.playerSprite && !this.textures.exists(atlasKey(this.playerSprite.key))) preloadPokemonAtlas(this, this.playerSprite);
  }

  create(): void {
    if (this.playerSprite) registerPokemonAnimations(this, this.playerSprite);
    const rules = applyDebugOverrides(buildSimRules(), window.location.search);
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
    const roster: RoomPlayer[] = this.coop?.players ?? [{ id: HOST_PLAYER_ID, pokemon: this.pokemon }];
    // 確認用の ?moves= はソロのときだけ
    const debugMoves = this.coop ? null : parseMovesParam(rules, window.location.search);
    for (const { id, pokemon } of roster) {
      const loadout = playableLoadout(rules, pokemon);
      const p = this.sim.addPlayer({
        id,
        x: playerConfig.spawnX + (id - 1) * networkConfig.guestSpawnOffsetX,
        y: playerConfig.spawnY,
        radius: playerConfig.radius,
        moveSpeed: playerConfig.moveSpeed,
        remote: id !== this.localId,
        pickupRange: playerConfig.pickupRange,
        types: loadout.types,
        moves: debugMoves ?? loadout.moves,
        line: loadout.line,
        species: loadout.species,
      });
      const sprite = id === this.localId ? this.playerSprite : (this.coop?.sprites.get(pokemon) ?? null);
      const view = new PlayerView(this, p, placeholderRender, spriteRender, sprite, true);
      view.container.setDepth(id === this.localId ? 1.1 : 1);
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
    // 確認用: ?time=880 で、ランの途中から始める（それより前の中ボスは出さない）
    const startTime = parseTimeParam(window.location.search);
    if (startTime) {
      const w = this.sim.world;
      w.tick = Math.round(startTime * simulationConfig.tickRate);
      while (w.nextBoss < w.bossSchedule.length && w.bossSchedule[w.nextBoss]!.tick < w.tick) w.nextBoss++;
    }
    if (this.coop) this.setupNet(this.coop.room);

    this.clock = new FixedStepClock(simulationConfig.tickRate, simulationConfig.maxTicksPerFrame);
    this.keyboard = new KeyboardInput(this);
    this.ground = new GroundGrid(this, placeholderRender);
    this.enemyView = new PooledCircles(this, 0);
    this.gemView = new PooledCircles(this, -1);
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
      0,
      (kind) => rules.enemies.kinds[kind]?.spriteScale ?? 1,
    );
    this.hazardView = this.add.graphics().setDepth(0.5);
    this.measureFrameTime();
    // ゲストの選択はホストが確定するので、要望としてホストへ送る
    const guest = role === 'guest';
    this.levelUpPanel = new LevelUpPanel({
      choose: (index) => (guest ? this.sync?.requestUpgrade('c', index) : this.uiCommands.push({ type: 'chooseUpgrade', playerId: this.localId, index })),
      reroll: () => (guest ? this.sync?.requestUpgrade('r') : this.uiCommands.push({ type: 'rerollUpgrades', playerId: this.localId })),
      skip: () => (guest ? this.sync?.requestUpgrade('s') : this.uiCommands.push({ type: 'skipUpgrade', playerId: this.localId })),
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.levelUpPanel.hide());
    this.statusColors = this.sim.world.statusKinds.map((k) => hexColor(k.color));
    this.effects = new EffectRenderer(this, effectRecipes, 2, spriteRender.effectPixel);
    const local = this.sim.world.players.find((p) => p.id === this.localId)!;
    if (this.playerSprite && new URLSearchParams(window.location.search).has('gallery')) {
      addSpriteGallery(this, this.playerSprite, spriteRender, local.x, local.y - 200);
    }
    this.hud = this.add
      .text(8, 8, '', { fontFamily: 'monospace', fontSize: '14px', color: '#ffffff', backgroundColor: '#00000080' })
      .setScrollFactor(0)
      .setDepth(1000);
    const center = { fontFamily: 'sans-serif', color: '#ffffff', stroke: '#000000', strokeThickness: 4 };
    this.timerText = this.add.text(0, 10, '', { ...center, fontSize: '28px', fontStyle: 'bold' }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1000);
    this.bossBar = this.add.graphics().setScrollFactor(0).setDepth(1000);
    this.bossName = this.add.text(0, 50, '', { ...center, fontSize: '16px' }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1000);
    this.announceText = this.add.text(0, 0, '', { ...center, fontSize: '40px', fontStyle: 'bold', align: 'center' }).setOrigin(0.5).setScrollFactor(0).setDepth(1001);
    this.input.keyboard?.on('keydown-F3', () => {
      this.showDebug = !this.showDebug;
    });
    this.applyZoom();
    this.scale.on('resize', this.applyZoom, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off('resize', this.applyZoom, this));
    // 時計を作った後で始める
    if (this.coop) this.keepRunningWhenHidden();
    this.setupSaving();
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
    const steps = this.clock.advance(delta);
    this.runSteps(steps, true);
    this.lastSteps = steps;
    this.draw(this.clock.alpha, delta, time);
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
    this.recorder = new RunRecorder(session.store, this.pokemon);
    const autosave = this.time.addEvent({
      delay: saveConfig.autosaveSeconds * 1000,
      loop: true,
      callback: () => {
        this.recorder.commit(this.sim.world);
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
    void session.store.flush();
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
      },
      // 協力プレイはもう一度を出さない（部屋を作り直す必要がある）
      retry: this.coop ? null : { ...this.runData },
    };
    this.resultAt = null;
    this.scene.start('result', data);
  }

  /**
   * 画面に見えるワールドの高さをおおよそ一定にする（大きな画面で見え過ぎると、画面の外から出るはずの敵が見えてしまう）。
   * ドット絵が崩れにくいよう、拡大率は決まった刻みにする
   */
  private applyZoom(): void {
    const c = spriteRender.camera;
    const zoom = Math.max(1, Math.round(this.scale.height / c.viewHeight / c.zoomStep) * c.zoomStep);
    this.cameras.main.setZoom(zoom);
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
      } else if (ev.type === 'playerLeft') {
        this.playerViews.get(ev.playerId)?.container.destroy();
        this.playerViews.delete(ev.playerId);
        this.announce(t('net.playerLeft', { n: ev.playerId }), '#ef9a9a');
      } else if (ev.type === 'hazardStruck') {
        this.effects.playImpact(ev.effect, ev.x, ev.y);
      } else if (ev.type === 'runEnded') {
        const clear = ev.outcome === 'clear';
        this.tweens.killTweensOf(this.announceText);
        this.announceText.setText(t(`run.${ev.outcome}`)).setColor(clear ? '#ffe082' : '#ef9a9a').setAlpha(1);
        this.resultAt = performance.now() + stageConfig.endDelaySeconds * 1000;
      }
    }
  }

  /** ボスの範囲技の予告: 範囲の円と、落ちるまでの残りを内側から広がる円で見せる */
  private drawHazards(hazards: readonly Hazard[]): void {
    const g = this.hazardView;
    g.clear();
    for (const h of hazards) {
      const progress = 1 - h.ticksLeft / h.totalTicks;
      g.fillStyle(0xff1744, 0.12).fillCircle(h.x, h.y, h.radius);
      g.fillStyle(0xff1744, 0.25).fillCircle(h.x, h.y, h.radius * progress);
      g.lineStyle(2, 0xff5252, 0.9).strokeCircle(h.x, h.y, h.radius);
    }
  }

  /** 経過時間と、中ボス・ボスの HP のバー */
  private drawTopCenter(): void {
    const w = this.sim.world;
    const cam = this.cameras.main;
    const cx = cam.width / 2;
    const now = elapsedSeconds(w);
    const limit = w.rules.stage.durationSeconds;
    this.placeUi(this.timerText, cx, 10);
    this.placeUi(this.bossName, cx, 50);
    this.placeUi(this.bossBar, 0, 0);
    this.placeUi(this.announceText, cx, cam.height * 0.3);
    this.placeUi(this.hud, 8, 8);
    this.timerText.setText(now < limit ? t('run.timer', { time: formatTime(now), limit: formatTime(limit) }) : t('run.bossTime', { time: formatTime(now - limit) }));
    this.bossBar.clear();
    const i = this.bossId === null ? -1 : findEnemyIndex(w, this.bossId);
    if (i === -1 || w.enemies.hp[i]! <= 0) {
      this.bossName.setText('');
      return;
    }
    const kind = w.rules.enemies.kinds[w.enemies.kind[i]!]!;
    const barW = Math.min(480, cam.width * 0.6);
    const ratio = Math.max(0, w.enemies.hp[i]! / w.enemies.maxHp[i]!);
    this.bossBar.fillStyle(0x000000, 0.6).fillRect(cx - barW / 2 - 2, 70, barW + 4, 14);
    this.bossBar.fillStyle(kind.rank === 'boss' ? 0xff7043 : 0xffca28).fillRect(cx - barW / 2, 72, barW * ratio, 10);
    this.bossName.setText(localName(generated.pokemon[kind.species ?? kind.id]?.names, getLocale(), kind.id));
  }

  private runSteps(steps: number, visible: boolean): void {
    for (let i = 0; i < steps; i++) {
      const t0 = performance.now();
      this.sim.step([...this.collectCommands(), ...this.inbox.splice(0)]);
      this.simMs = this.simMs * 0.95 + (performance.now() - t0) * 0.05;
      if (visible) {
        for (const ev of this.sim.world.events) {
          if (ev.type === 'projectileHit') this.effects.playImpact(this.sim.world.rules.moves[ev.move]!.effect, ev.x, ev.y);
          if (ev.type === 'evolved') this.onEvolved(ev.playerId, ev.to);
          // 派生・固有技を達成したら記録する（次からの「進化できる！」の表示に使う）
          if (ev.type === 'upgradeChosen' && ev.playerId === this.localId && ev.offer.kind === 'derive') {
            addDiscovery(session.store, this.sim.world.rules.moves[ev.offer.to]!.key);
          }
        }
      }
      if (visible) this.onSimEvents();
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

  /** ローカルの入力を、変化があったときだけコマンドにする */
  private collectCommands(): InputCommand[] {
    const out = this.uiCommands.splice(0);
    const { dx, dy } = this.keyboard.read();
    if (dx === this.lastSent.dx && dy === this.lastSent.dy) return out;
    this.lastSent = { dx, dy };
    return [...out, { type: 'move', playerId: this.localId, dx, dy }];
  }

  private draw(alpha: number, deltaMs: number, timeMs: number): void {
    const world = this.sim.world;
    const reviveNeed = Math.round(world.rules.stats.revive.touchSeconds / world.dt);
    for (const p of world.players) this.playerViews.get(p.id)?.update(p, alpha, (world.reviveTouch.get(p.id) ?? 0) / reviveNeed);
    const local = world.players.find((p) => p.id === this.localId);
    const localView = this.playerViews.get(this.localId);
    if (!local || !localView) return;
    const cam = this.cameras.main;
    const cx = localView.container.x;
    const cy = localView.container.y;
    cam.centerOn(cx, cy);
    this.ground.update(cam);

    const halfW = cam.width / 2 / cam.zoom;
    const halfH = cam.height / 2 / cam.zoom;
    const view = { left: cx - halfW, top: cy - halfH, right: cx + halfW, bottom: cy + halfH };
    const enemyColor = hexColor(placeholderRender.enemyColor);
    const e = world.enemies;
    const gems = world.gems;
    const gemColor = hexColor(placeholderRender.gemColor);
    const bigGemColor = hexColor(placeholderRender.bigGemColor);
    this.gemView.update(
      gems,
      alpha,
      view,
      (i) => (gems.value[i]! >= world.rules.pickups.bigGemValue ? bigGemColor : gemColor),
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
    );

    this.drawHazards(world.hazards);
    this.drawTopCenter();

    const lu = world.levelUp;
    if (lu && !lu.done.has(this.localId) && !world.outcome) {
      const offers = (lu.offers.get(this.localId) ?? []).map((o) => offerText(world, local, o, new Set(session.store.current.discoveries)));
      this.levelUpPanel.show(lu.level, offers, local.rerolls, Math.ceil(lu.ticksLeft * world.dt));
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
    const lines = [
      `${t('debug.controls')}　${t('run.debugToggle')}`,
      t('debug.player', {
        name: localName(generated.pokemon[world.rules.species[local.species]?.key ?? '']?.names, getLocale(), ''),
        hp: Math.ceil(local.hp),
        maxHp: Math.round(local.maxHp),
        revives: world.revives,
      }),
      ...(local.down ? [t(this.coop ? 'run.downCoop' : 'debug.down', { revives: world.revives })] : []),
      t('debug.level', { level: world.level, xp: Math.floor(world.xpIntoLevel), need: world.rules.leveling.xpToNext[world.level] ?? 0, rerolls: local.rerolls }),
      t('debug.moves', {
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
      }),
      t('debug.passives', {
        passives: local.passives.map((ps) => localName(generated.items[world.rules.passives[ps.passive]!.key]?.names, getLocale(), '') + ' Lv' + ps.level).join(' / '),
      }),
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
    this.hud.setText(lines);
  }
}
