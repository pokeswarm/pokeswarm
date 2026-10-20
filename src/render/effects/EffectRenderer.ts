import Phaser from 'phaser';
import type { EffectParticle, EffectRecipe } from '../../data/schema';
import { hexColor } from '../color';
import type { CircleSource } from '../PooledCircles';

const GLOW_TEXTURE = 'effect-glow';
const GLOW_SIZE = 64;

type ParticleDef = EffectParticle;

const BLEND: Record<ParticleDef['blend'], string> = {
  normal: 'NORMAL',
  add: 'ADD',
  screen: 'SCREEN',
  multiply: 'MULTIPLY',
};

/** 中心が明るく外へ向かって消える円（光・火の粉・破裂の共通素材）。画像素材は使わず実行時に作る */
function ensureGlowTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(GLOW_TEXTURE)) return;
  const tex = scene.textures.createCanvas(GLOW_TEXTURE, GLOW_SIZE, GLOW_SIZE);
  if (!tex) return;
  const ctx = tex.getContext();
  const r = GLOW_SIZE / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, GLOW_SIZE, GLOW_SIZE);
  tex.refresh();
}

function emitterConfig(def: ParticleDef): Phaser.Types.GameObjects.Particles.ParticleEmitterConfig {
  return {
    lifespan: { min: def.lifespanMs[0], max: def.lifespanMs[1] },
    speed: { min: def.speed[0], max: def.speed[1] },
    scale: { start: def.scale[0], end: def.scale[1] },
    alpha: { start: def.alpha[0], end: def.alpha[1] },
    color: def.colors.map(hexColor),
    gravityY: def.gravityY,
    blendMode: BLEND[def.blend],
    emitting: false,
  };
}

function scatter(spread: number): number {
  // 見た目だけの揺らぎなので、シミュレーションの乱数は使わない
  return (Math.random() * 2 - 1) * spread;
}

/**
 * 技エフェクトの描画。data/effects/recipes.json のレシピから、発射体・軌跡・命中時の演出を作る。
 * 見た目だけを担当し、当たり判定はシミュレーション側で行う。
 */
export class EffectRenderer {
  private readonly cores: Phaser.GameObjects.Image[] = [];
  private readonly glows: Phaser.GameObjects.Image[] = [];
  private visible = 0;
  private readonly trailEmitters = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>();
  private readonly burstEmitters = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>();
  /** 軌跡のパーティクルを出す間隔の端数 */
  private trailBudgetMs = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly recipes: Record<string, EffectRecipe>,
    private readonly depth: number,
  ) {
    ensureGlowTexture(scene);
  }

  private recipe(id: string): EffectRecipe {
    const r = this.recipes[id];
    if (!r) throw new Error(`エフェクトのレシピ ${id} がありません`);
    return r;
  }

  private emitter(
    cache: Map<string, Phaser.GameObjects.Particles.ParticleEmitter>,
    id: string,
    def: ParticleDef,
    depth: number,
  ): Phaser.GameObjects.Particles.ParticleEmitter {
    let em = cache.get(id);
    if (!em) {
      em = this.scene.add.particles(0, 0, GLOW_TEXTURE, emitterConfig(def)).setDepth(depth);
      cache.set(id, em);
    }
    return em;
  }

  /** 発射体の本体と軌跡を描く（毎フレーム） */
  drawProjectiles(src: CircleSource, alpha: number, recipeId: string, deltaMs: number, timeMs: number): void {
    const recipe = this.recipe(recipeId);
    const body = recipe.projectile;
    const trail = recipe.trail;

    this.trailBudgetMs += deltaMs;
    const trailCount = trail ? Math.floor(this.trailBudgetMs / trail.intervalMs) : 0;
    if (trail) this.trailBudgetMs -= trailCount * trail.intervalMs;
    const trailEmitter = trail ? this.emitter(this.trailEmitters, recipeId, trail, this.depth - 0.5) : null;

    const pulse = body?.pulse ? 1 + Math.sin((timeMs / body.pulse.periodMs) * Math.PI * 2) * body.pulse.amount : 1;
    let used = 0;
    for (let i = 0; i < src.count; i++) {
      const x = src.prevX[i]! + (src.x[i]! - src.prevX[i]!) * alpha;
      const y = src.prevY[i]! + (src.y[i]! - src.prevY[i]!) * alpha;
      const r = src.radius[i]!;
      if (trail && trailEmitter) {
        for (let k = 0; k < trailCount; k++) trailEmitter.emitParticleAt(x + scatter(trail.spread), y + scatter(trail.spread), 1);
      }
      if (!body) continue;
      let glow = this.glows[used];
      let core = this.cores[used];
      if (!glow || !core) {
        glow = this.scene.add.image(0, 0, GLOW_TEXTURE).setDepth(this.depth).setBlendMode(Phaser.BlendModes.ADD);
        core = this.scene.add.image(0, 0, GLOW_TEXTURE).setDepth(this.depth + 0.1).setBlendMode(Phaser.BlendModes.ADD);
        this.glows.push(glow);
        this.cores.push(core);
      }
      const unit = (r * 2) / GLOW_SIZE;
      glow
        .setPosition(x, y)
        .setScale(unit * body.glowScale * 2 * pulse)
        .setTint(hexColor(body.glowColor))
        .setAlpha(body.glowAlpha)
        .setVisible(true);
      core.setPosition(x, y).setScale(unit * body.coreScale * 2).setTint(hexColor(body.coreColor)).setVisible(true);
      used++;
    }
    for (let k = used; k < this.visible; k++) {
      this.glows[k]!.setVisible(false);
      this.cores[k]!.setVisible(false);
    }
    this.visible = used;
  }

  /** 命中時の演出 */
  playImpact(recipeId: string, x: number, y: number): void {
    const impact = this.recipe(recipeId).impact;
    if (!impact) return;
    if (impact.burst && impact.burst.count > 0) {
      const em = this.emitter(this.burstEmitters, recipeId, impact.burst, this.depth + 1);
      for (let k = 0; k < impact.burst.count; k++) {
        em.emitParticleAt(x + scatter(impact.burst.spread), y + scatter(impact.burst.spread), 1);
      }
    }
    if (impact.flash) {
      const f = impact.flash;
      const img = this.scene.add
        .image(x, y, GLOW_TEXTURE)
        .setDepth(this.depth + 1)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(hexColor(f.color))
        .setAlpha(f.alpha)
        .setScale((f.radius * 2) / GLOW_SIZE * 0.5);
      this.scene.tweens.add({
        targets: img,
        scale: (f.radius * 2) / GLOW_SIZE,
        alpha: 0,
        duration: f.durationMs,
        ease: 'Quad.easeOut',
        onComplete: () => img.destroy(),
      });
    }
    if (impact.shake && impact.shake.intensity > 0 && impact.shake.durationMs > 0) {
      this.scene.cameras.main.shake(impact.shake.durationMs, impact.shake.intensity);
    }
  }
}
