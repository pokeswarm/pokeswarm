import Phaser from 'phaser';
import {
  attackConfig,
  effectRecipes,
  enemiesConfig,
  networkConfig,
  placeholderRender,
  playerConfig,
  simulationConfig,
  spawnConfig,
  spriteRender,
} from '../data';
import type { SpriteAnims } from '../data/schema';
import { t } from '../i18n';
import type { RoomConnection } from '../net/room';
import { SyncSession } from '../net/sync';
import { hexColor } from '../render/color';
import { EffectRenderer } from '../render/effects/EffectRenderer';
import { GroundGrid } from '../render/GroundGrid';
import { KeyboardInput } from '../render/KeyboardInput';
import { PlayerView } from '../render/PlayerView';
import { PooledCircles } from '../render/PooledCircles';
import { preloadPokemonAtlas, registerPokemonAnimations } from '../render/sprites/PokemonSprite';
import { addSpriteGallery } from '../render/sprites/SpriteGallery';
import type { Axis, InputCommand, PlayerId } from '../sim/commands';
import { FixedStepClock } from '../sim/fixedStep';
import { Simulation } from '../sim/simulation';
import { enemyCap, type SimRole } from '../sim/world';
import { applyDebugOverrides } from './debugOverrides';
import type { NetPanel } from './netPanel';

/** ソロとホストは 1、ゲストは 2 */
const HOST_PLAYER_ID: PlayerId = 1;
const GUEST_PLAYER_ID: PlayerId = 2;

export interface RunSceneData {
  /** プレイヤーのスプライト。取得していなければ null（仮の円で描く） */
  playerSprite: SpriteAnims | null;
  /** 協力プレイの接続。ソロなら null */
  net: RoomConnection | null;
  /** 接続の案内（切断の表示に使う） */
  panel: NetPanel | null;
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
  private effects!: EffectRenderer;
  private ground!: GroundGrid;
  private hud!: Phaser.GameObjects.Text;
  private lastSent: { dx: Axis; dy: Axis } = { dx: 0, dy: 0 };
  private lastSteps = 0;
  /** シミュレーション1回あたりの処理時間（移動平均, ms） */
  private simMs = 0;
  private playerSprite: SpriteAnims | null = null;
  private net: RoomConnection | null = null;
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

  constructor() {
    super('run');
  }

  init(data: RunSceneData): void {
    this.playerSprite = data.playerSprite;
    this.net = data.net;
    this.panel = data.panel;
  }

  preload(): void {
    if (this.playerSprite) preloadPokemonAtlas(this, this.playerSprite);
  }

  create(): void {
    if (this.playerSprite) registerPokemonAnimations(this, this.playerSprite);
    const rules = applyDebugOverrides({ enemies: enemiesConfig, spawn: spawnConfig, attack: attackConfig }, window.location.search);
    const role: SimRole = this.net?.role ?? 'solo';
    this.localId = role === 'guest' ? GUEST_PLAYER_ID : HOST_PLAYER_ID;
    this.sim = new Simulation({
      tickRate: simulationConfig.tickRate,
      seed: this.net?.seed ?? simulationConfig.defaultSeed,
      rules,
      role,
      localPlayerId: this.localId,
    });
    const ids = this.net ? [HOST_PLAYER_ID, GUEST_PLAYER_ID] : [HOST_PLAYER_ID];
    for (const id of ids) {
      const p = this.sim.addPlayer({
        id,
        x: playerConfig.spawnX + (id === GUEST_PLAYER_ID ? networkConfig.guestSpawnOffsetX : 0),
        y: playerConfig.spawnY,
        radius: playerConfig.radius,
        moveSpeed: playerConfig.moveSpeed,
        remote: id !== this.localId,
      });
      const view = new PlayerView(this, p, placeholderRender, spriteRender, this.playerSprite);
      view.container.setDepth(id === this.localId ? 1.1 : 1);
      // 相手のプレイヤーは少し透かして見分ける
      if (p.remote) view.container.setAlpha(0.7);
      this.playerViews.set(id, view);
    }
    if (this.net) this.setupNet(this.net);

    this.clock = new FixedStepClock(simulationConfig.tickRate, simulationConfig.maxTicksPerFrame);
    this.keyboard = new KeyboardInput(this);
    this.ground = new GroundGrid(this, placeholderRender);
    this.enemyView = new PooledCircles(this, 0);
    this.effects = new EffectRenderer(this, effectRecipes, 2);
    const local = this.sim.world.players.find((p) => p.id === this.localId)!;
    if (this.playerSprite && new URLSearchParams(window.location.search).has('gallery')) {
      addSpriteGallery(this, this.playerSprite, spriteRender, local.x, local.y - 200);
    }
    this.hud = this.add
      .text(8, 8, '', { fontFamily: 'monospace', fontSize: '14px', color: '#ffffff', backgroundColor: '#00000080' })
      .setScrollFactor(0)
      .setDepth(1000);
    // 時計を作った後で始める
    if (this.net) this.keepRunningWhenHidden();
  }

  private setupNet(net: RoomConnection): void {
    const remoteId = net.role === 'host' ? GUEST_PLAYER_ID : HOST_PLAYER_ID;
    this.sync = new SyncSession(remoteId, net.transport.kind === 'p2p' ? networkConfig.p2p : networkConfig.relay, networkConfig.pingIntervalTicks);
    net.transport.onMessages = (messages) => {
      if (this.sync) this.inbox.push(...this.sync.incoming(this.sim.world, messages));
    };
    net.transport.onClose = () => this.panel?.show('net.disconnected');
    this.netStartedAt = performance.now();
  }

  override update(time: number, delta: number): void {
    this.lastFrameAt = performance.now();
    const steps = this.clock.advance(delta);
    this.runSteps(steps, true);
    this.lastSteps = steps;
    this.draw(this.clock.alpha, delta, time);
  }

  private runSteps(steps: number, visible: boolean): void {
    for (let i = 0; i < steps; i++) {
      const t0 = performance.now();
      this.sim.step([...this.collectCommands(), ...this.inbox.splice(0)]);
      this.simMs = this.simMs * 0.95 + (performance.now() - t0) * 0.05;
      if (visible) {
        for (const ev of this.sim.world.events) {
          if (ev.type === 'projectileHit') this.effects.playImpact(attackConfig.effect, ev.x, ev.y);
        }
      }
      if (this.net && this.sync) this.net.transport.send(this.sync.outgoing(this.sim.world));
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

  /** ローカルの入力を、変化があったときだけコマンドにする */
  private collectCommands(): InputCommand[] {
    const { dx, dy } = this.keyboard.read();
    if (dx === this.lastSent.dx && dy === this.lastSent.dy) return [];
    this.lastSent = { dx, dy };
    return [{ type: 'move', playerId: this.localId, dx, dy }];
  }

  private draw(alpha: number, deltaMs: number, timeMs: number): void {
    const world = this.sim.world;
    for (const p of world.players) this.playerViews.get(p.id)?.update(p, alpha);
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
    const empoweredColor = hexColor(placeholderRender.enemyEmpoweredColor);
    const e = world.enemies;
    const drawn = this.enemyView.update(e, alpha, view, (i) => (e.empower[i]! > 0 ? empoweredColor : enemyColor));
    this.effects.drawProjectiles(world.projectiles, alpha, attackConfig.effect, deltaMs, timeMs);

    const lines = [
      t('debug.controls'),
      t('debug.fps', { fps: this.game.loop.actualFps.toFixed(1), steps: this.lastSteps }),
      t('debug.enemies', { count: e.count, cap: enemyCap(world), drawn }),
      t('debug.combat', { kills: world.stats.kills, empowered: world.stats.empowered, projectiles: world.projectiles.count }),
      t('debug.simTime', { ms: this.simMs.toFixed(3) }),
      t('debug.tick', { tick: world.tick }),
      t('debug.position', { x: Math.round(local.x), y: Math.round(local.y) }),
    ];
    if (this.net && this.sync) {
      const stats = this.net.transport.stats;
      lines.push(
        t('debug.net', {
          role: t(this.net.role === 'host' ? 'net.role.host' : 'net.role.guest'),
          room: this.net.roomId,
          mode: t(this.net.transport.kind === 'p2p' ? 'net.mode.p2p' : 'net.mode.relay'),
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
