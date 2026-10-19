import Phaser from 'phaser';
import { placeholderRender, playerConfig, simulationConfig } from '../data';
import { t } from '../i18n';
import { GroundGrid } from '../render/GroundGrid';
import { KeyboardInput } from '../render/KeyboardInput';
import { PlayerView } from '../render/PlayerView';
import type { Axis, InputCommand, PlayerId } from '../sim/commands';
import { FixedStepClock } from '../sim/fixedStep';
import { Simulation } from '../sim/simulation';

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
  private ground!: GroundGrid;
  private hud!: Phaser.GameObjects.Text;
  private lastSent: { dx: Axis; dy: Axis } = { dx: 0, dy: 0 };

  constructor() {
    super('run');
  }

  create(): void {
    this.sim = new Simulation({ tickRate: simulationConfig.tickRate, seed: simulationConfig.defaultSeed });
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
    this.playerView = new PlayerView(this, player, placeholderRender);
    this.hud = this.add.text(8, 8, '', { fontFamily: 'monospace', fontSize: '14px', color: '#ffffff' }).setScrollFactor(0).setDepth(1000);
  }

  override update(_time: number, delta: number): void {
    const steps = this.clock.advance(delta);
    for (let i = 0; i < steps; i++) {
      this.sim.step(this.collectCommands());
    }
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
    const player = this.sim.world.players[0];
    if (!player) return;
    this.playerView.update(player, alpha);
    const cam = this.cameras.main;
    cam.centerOn(this.playerView.container.x, this.playerView.container.y);
    this.ground.update(cam);
    this.hud.setText([
      t('debug.controls'),
      t('debug.tick', { tick: this.sim.world.tick }),
      t('debug.position', { x: Math.round(player.x), y: Math.round(player.y) }),
    ]);
  }
}
