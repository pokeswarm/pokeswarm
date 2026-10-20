import Phaser from 'phaser';
import { attackConfig, enemiesConfig, placeholderRender, playerConfig, simulationConfig, spawnConfig } from '../data';
import { t } from '../i18n';
import { hexColor } from '../render/color';
import { GroundGrid } from '../render/GroundGrid';
import { KeyboardInput } from '../render/KeyboardInput';
import { PlayerView } from '../render/PlayerView';
import { PooledCircles } from '../render/PooledCircles';
import type { Axis, InputCommand, PlayerId } from '../sim/commands';
import { FixedStepClock } from '../sim/fixedStep';
import { Simulation } from '../sim/simulation';
import { enemyCap } from '../sim/world';
import { applyDebugOverrides } from './debugOverrides';

const LOCAL_PLAYER_ID: PlayerId = 1;

/**
 * ラン中のシーン。
 * 入力 → コマンド → 固定間隔でシミュレーションを進める → 補間して描く、の流れを担う。
 */
export class RunScene extends Phaser.Scene {
  private sim!: Simulation;
  private clock!: FixedStepClock;
  private keyboard!: KeyboardInput;
  private playerView!: PlayerView;
  private enemyView!: PooledCircles;
  private projectileView!: PooledCircles;
  private ground!: GroundGrid;
  private hud!: Phaser.GameObjects.Text;
  private lastSent: { dx: Axis; dy: Axis } = { dx: 0, dy: 0 };
  private lastSteps = 0;
  /** シミュレーション1回あたりの処理時間（移動平均, ms） */
  private simMs = 0;

  constructor() {
    super('run');
  }

  create(): void {
    const rules = applyDebugOverrides({ enemies: enemiesConfig, spawn: spawnConfig, attack: attackConfig }, window.location.search);
    this.sim = new Simulation({ tickRate: simulationConfig.tickRate, seed: simulationConfig.defaultSeed, rules });
    const player = this.sim.addPlayer({
      id: LOCAL_PLAYER_ID,
      x: playerConfig.spawnX,
      y: playerConfig.spawnY,
      radius: playerConfig.radius,
      moveSpeed: playerConfig.moveSpeed,
    });
    this.clock = new FixedStepClock(simulationConfig.tickRate, simulationConfig.maxTicksPerFrame);
    this.keyboard = new KeyboardInput(this);
    this.ground = new GroundGrid(this, placeholderRender);
    this.enemyView = new PooledCircles(this, 0);
    this.projectileView = new PooledCircles(this, 2);
    this.playerView = new PlayerView(this, player, placeholderRender);
    this.playerView.container.setDepth(1);
    this.hud = this.add.text(8, 8, '', { fontFamily: 'monospace', fontSize: '14px', color: '#ffffff', backgroundColor: '#00000080' }).setScrollFactor(0).setDepth(1000);
  }

  override update(_time: number, delta: number): void {
    const steps = this.clock.advance(delta);
    for (let i = 0; i < steps; i++) {
      const t0 = performance.now();
      this.sim.step(this.collectCommands());
      this.simMs = this.simMs * 0.95 + (performance.now() - t0) * 0.05;
    }
    this.lastSteps = steps;
    this.draw(this.clock.alpha);
  }

  /** ローカルの入力を、変化があったときだけコマンドにする（協力プレイでも同じものを送る） */
  private collectCommands(): InputCommand[] {
    const { dx, dy } = this.keyboard.read();
    if (dx === this.lastSent.dx && dy === this.lastSent.dy) return [];
    this.lastSent = { dx, dy };
    return [{ type: 'move', playerId: LOCAL_PLAYER_ID, dx, dy }];
  }

  private draw(alpha: number): void {
    const world = this.sim.world;
    const player = world.players[0];
    if (!player) return;
    this.playerView.update(player, alpha);
    const cam = this.cameras.main;
    const cx = this.playerView.container.x;
    const cy = this.playerView.container.y;
    cam.centerOn(cx, cy);
    this.ground.update(cam);

    const halfW = cam.width / 2 / cam.zoom;
    const halfH = cam.height / 2 / cam.zoom;
    const view = { left: cx - halfW, top: cy - halfH, right: cx + halfW, bottom: cy + halfH };
    const enemyColor = hexColor(placeholderRender.enemyColor);
    const empoweredColor = hexColor(placeholderRender.enemyEmpoweredColor);
    const e = world.enemies;
    const drawn = this.enemyView.update(e, alpha, view, (i) => (e.empower[i]! > 0 ? empoweredColor : enemyColor));
    const projectileColor = hexColor(placeholderRender.projectileColor);
    this.projectileView.update(world.projectiles, alpha, view, () => projectileColor);

    this.hud.setText([
      t('debug.controls'),
      t('debug.fps', { fps: this.game.loop.actualFps.toFixed(1), steps: this.lastSteps }),
      t('debug.enemies', { count: e.count, cap: enemyCap(world), drawn }),
      t('debug.combat', { kills: world.stats.kills, empowered: world.stats.empowered, projectiles: world.projectiles.count }),
      t('debug.simTime', { ms: this.simMs.toFixed(3) }),
      t('debug.tick', { tick: world.tick }),
      t('debug.position', { x: Math.round(player.x), y: Math.round(player.y) }),
    ]);
  }
}
