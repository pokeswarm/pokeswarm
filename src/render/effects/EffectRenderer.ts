import Phaser from 'phaser';
import type { EffectParticle, EffectRecipe } from '../../data/schema';
import { hexColor } from '../color';
import type { CircleSource } from '../PooledCircles';
import { moveSpriteTexture } from './MoveSprites';

const GLOW_TEXTURE = 'effect-glow';
const GLOW_SIZE = 64;
/** 発射体の芯の大きさ（当たり判定の直径に対する割合。レシピの coreScale に掛ける） */
const CORE_RATIO = 0.35;

type ParticleDef = EffectParticle;

const BLEND: Record<ParticleDef['blend'], string> = {
  normal: 'NORMAL',
  add: 'ADD',
  screen: 'SCREEN',
  multiply: 'MULTIPLY',
};

/** 縁のはっきりした円（発射体の芯。当たり判定の範囲はグラデーションで表さない。HitShapes を参照） */
const CORE_TEXTURE = 'effect-core';
function ensureCoreTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(CORE_TEXTURE)) return;
  const tex = scene.textures.createCanvas(CORE_TEXTURE, GLOW_SIZE, GLOW_SIZE);
  if (!tex) return;
  const ctx = tex.getContext();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(GLOW_SIZE / 2, GLOW_SIZE / 2, GLOW_SIZE / 2, 0, Math.PI * 2);
  ctx.fill();
  tex.refresh();
}

/** 中心が明るく外へ向かって消える円（火の粉・破裂・命中の光など、パーティクルの共通素材）。画像素材は使わず実行時に作る */
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
  private visible = 0;
  private readonly trailEmitters = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>();
  private readonly burstEmitters = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>();
  /** 軌跡のパーティクルを出す間隔の端数（レシピごと） */
  private readonly trailBudgets = new Map<string, number>();
  /** 残る範囲の控えめな粒（レシピごと） */
  private readonly lingerEmitters = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>();
  /** 天気の粒（レシピごと）・出す数の端数・画面の色づけ */
  private readonly weatherEmitters = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>();
  private readonly weatherBudget = new Map<string, number>();
  private weatherTint: Phaser.GameObjects.Rectangle | null = null;
  /** 演出をまとめる入れ物（まとめてドット絵風のフィルターを掛ける） */
  private readonly layer: Phaser.GameObjects.Layer;
  /** 角ばったドットにするフィルター（大きさはカメラの拡大率に合わせて変える） */
  private blocky: Phaser.Filters.Blocky | null = null;
  private readonly pixelSize: number;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly recipes: Record<string, EffectRecipe>,
    private readonly depth: number,
    pixel: { size: number; colorSteps: number; alphaSteps: number } = { size: 0, colorSteps: 2, alphaSteps: 2 },
  ) {
    this.pixelSize = pixel.size;
    ensureGlowTexture(scene);
    ensureCoreTexture(scene);
    // 演出は光なので、まとめた絵を背景に足し合わせる（中で加算した色が、透明の上で暗く濁らないように）
    this.layer = scene.add.layer().setDepth(depth).setBlendMode(Phaser.BlendModes.ADD);
    // ポケモンのドット絵に合わせて、なめらかな光を角ばった少ない色の形にする
    if (pixel.size > 0 && scene.renderer.type === Phaser.WEBGL) {
      this.layer.enableFilters();
      const f = this.layer.filters!.internal;
      this.blocky = f.addBlocky({ size: pixel.size });
      f.addQuantize({ steps: [pixel.colorSteps, pixel.colorSteps, pixel.colorSteps, pixel.alphaSteps] });
    }
  }

  /** カメラの拡大率が変わったとき: 1ドットをワールドの pixel.size にする（画面のマスで、少なくとも 1） */
  setZoom(zoom: number): void {
    if (!this.blocky) return;
    const n = Math.max(1, Math.round(this.pixelSize * zoom));
    this.blocky.size = { x: n, y: n };
  }

  private add<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.layer.add(obj);
    return obj;
  }

  /** ためる光の見た目（無ければ null） */
  chargeGlow(id: string): EffectRecipe['chargeGlow'] | null {
    return this.recipe(id).chargeGlow ?? null;
  }

  /** 技が出た瞬間に画面をうっすら光らせる見た目（無ければ null） */
  screenFlash(id: string): EffectRecipe['screenFlash'] | null {
    return this.recipe(id).screenFlash ?? null;
  }

  /** 効き方から出た線のドット絵の指定（無ければ null） */
  effectLineSprite(id: string): EffectRecipe['effectLineSprite'] | null {
    return this.recipe(id).effectLineSprite ?? null;
  }

  /** 技のドット絵の指定（無ければ null） */
  sprite(id: string): EffectRecipe['sprite'] | null {
    return this.recipe(id).sprite ?? null;
  }

  /** 技そのものに重ねるもう1枚の絵・効き方から出た円の絵・通った道の絵・使った瞬間の絵・当たった所の絵（無ければ null） */
  edgeSprite(id: string): EffectRecipe['edgeSprite'] | null {
    return this.recipe(id).edgeSprite ?? null;
  }

  effectSprite(id: string): EffectRecipe['effectSprite'] | null {
    return this.recipe(id).effectSprite ?? null;
  }

  pathSprite(id: string): EffectRecipe['pathSprite'] | null {
    return this.recipe(id).pathSprite ?? null;
  }

  castSprite(id: string): EffectRecipe['castSprite'] | null {
    return this.recipe(id).castSprite ?? null;
  }

  hitSprite(id: string): EffectRecipe['hitSprite'] | null {
    return this.recipe(id).hitSprite ?? null;
  }

  /** 範囲を塗らない技か（天気） */
  hideShape(id: string): boolean {
    return this.recipe(id).hideShape;
  }

  /** 稲妻の線の見た目（無ければ null） */
  lightningLine(id: string): EffectRecipe['lightningLine'] | null {
    return this.recipe(id).lightningLine ?? null;
  }

  /** 落雷の見た目（無ければ null） */
  bolt(id: string): EffectRecipe['bolt'] | null {
    return this.recipe(id).bolt ?? null;
  }

  /** 効き方から出た円を光らせる色（無ければ null） */
  burstFlash(id: string): EffectRecipe['burstFlash'] | null {
    return this.recipe(id).burstFlash ?? null;
  }

  /** 技が落ちた後に残る範囲の見た目（無ければ null） */
  linger(id: string): EffectRecipe['linger'] | null {
    return this.recipes[id]?.linger ?? null;
  }

  /**
   * 残る範囲（効き方の puddle・ボスの技が残す床）から、控えめな粒を出す（毎フレーム）。
   * 出す数は広さに比例させ、端数は確率で出す（見た目だけなので、乱数はシード付きでなくてよい）
   */
  drawLinger(items: readonly { recipeId: string; x: number; y: number; radius: number; line: { length: number; dirX: number; dirY: number } | null }[], deltaMs: number): void {
    for (const it of items) {
      const lg = this.recipes[it.recipeId]?.linger;
      if (!lg) continue;
      const area = it.line ? it.radius * 2 * it.line.length + Math.PI * it.radius * it.radius : Math.PI * it.radius * it.radius;
      const expected = (Math.min(lg.maxPerSecond, (lg.perSecond * area) / 10000) * deltaMs) / 1000;
      const n = Math.floor(expected) + (Math.random() < expected % 1 ? 1 : 0);
      if (n === 0) continue;
      const em = this.emitter(this.lingerEmitters, it.recipeId, lg, this.depth - 0.6);
      for (let k = 0; k < n; k++) {
        // 範囲の中のあちこち（円は面積が一様になるよう、半径は平方根で）
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * it.radius;
        const along = it.line ? Math.random() * it.line.length : 0;
        const lx = it.line ? it.line.dirX * along : 0;
        const ly = it.line ? it.line.dirY * along : 0;
        em.emitParticleAt(it.x + lx + Math.cos(a) * d, it.y + ly + Math.sin(a) * d, 1);
      }
    }
  }

  /**
   * 天気（こなゆき・ふぶき）: 出ている技のレシピごとに、画面（view）じゅうに粒を降らせ、画面を薄く色づける（毎フレーム）。
   * 粒は画面の上の外から、真下から angle 度傾いた向きへ落とす。見た目だけなので乱数はシード付きでなくてよい
   */
  drawWeather(active: ReadonlySet<string>, view: { x: number; y: number; width: number; height: number }, deltaMs: number): void {
    let tint: { color: string; alpha: number } | null = null;
    for (const id of active) {
      const w = this.recipes[id]?.weather;
      if (!w) continue;
      if (w.tint && (!tint || w.tint.alpha > tint.alpha)) tint = w.tint;
      let em = this.weatherEmitters.get(id);
      if (!em) {
        // 向き（Phaser の角度は 90 が真下）を真下から angle 度傾ける。粒の絵（しずく・砂粒）は、落ちる向きに合わせて回す
        const texture = w.texture ? moveSpriteTexture(w.texture) : GLOW_TEXTURE;
        const spreadDeg = w.texture ? 3 : 6;
        const made = this.scene.add
          .particles(0, 0, texture, { ...emitterConfig({ ...w, spread: 0 }), angle: { min: 90 - spreadDeg + w.angle, max: 90 + spreadDeg + w.angle }, ...(w.texture ? { rotate: w.angle } : {}) })
          .setDepth(this.depth + 0.4);
        // ふつうに重ねる粒（砂・雨）は、光を足し合わせる入れ物に入れない（茶色が白っぽく光って、雪に見えた。作者の指摘 2026年10月27日）
        em = w.blend === 'normal' ? made : this.add(made);
        this.weatherEmitters.set(id, em);
      }
      const expected = (w.perSecond * deltaMs) / 1000 + (this.weatherBudget.get(id) ?? 0);
      const n = Math.floor(expected);
      this.weatherBudget.set(id, expected - n);
      // 流れる分だけ、出す場所を風上へ広げる（画面の端まで降る・吹くように）。落ちる向き（dx, dy）に、画面を横切るくらい進む
      const rad = ((90 + w.angle) * Math.PI) / 180;
      const dx = Math.cos(rad);
      const dy = Math.sin(rad);
      const reachX = Math.abs(dx) * view.width * 0.6;
      const reachY = Math.abs(dy) * view.height * 0.6;
      for (let k = 0; k < n; k++) {
        const x = view.x - (dx > 0 ? reachX : 0) + Math.random() * (view.width + reachX);
        const y = view.y - (dy > 0 ? reachY : 0) + Math.random() * (view.height + reachY);
        em.emitParticleAt(x, y, 1);
      }
    }
    // 画面を薄く色づける（出ている間だけ。消えるときは少しずつ）
    if (!this.weatherTint) {
      this.weatherTint = this.scene.add.rectangle(0, 0, 1, 1, 0xffffff, 1).setScrollFactor(0).setDepth(this.depth + 0.45).setAlpha(0);
    }
    const cam = this.scene.cameras.main;
    const want = tint ? tint.alpha : 0;
    const cur = this.weatherTint.alpha;
    const next = cur + (want - cur) * Math.min(1, deltaMs / 400);
    if (tint) this.weatherTint.setFillStyle(hexColor(tint.color), 1);
    // 拡大・縮小しても画面を覆うように、画面の中心に大きく置く
    this.weatherTint.setPosition(cam.width / 2, cam.height / 2).setSize(cam.width * 4, cam.height * 4).setAlpha(next < 0.002 ? 0 : next).setVisible(next >= 0.002);
  }

  /** 持ち主の残像として飛ぶ技の見た目（無ければ null） */
  ownerGhost(id: string): EffectRecipe['ownerGhost'] | null {
    return this.recipe(id).ownerGhost ?? null;
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
      em = this.add(this.scene.add.particles(0, 0, GLOW_TEXTURE, emitterConfig(def)).setDepth(depth));
      cache.set(id, em);
    }
    return em;
  }

  /** 発射体・攻撃の当たり判定の見た目と軌跡を描く（毎フレーム）。レシピは当たり判定ごとに recipeOf で引く */
  drawProjectiles(
    src: CircleSource,
    alpha: number,
    recipeOf: (index: number) => string,
    deltaMs: number,
    timeMs: number,
    /** 直線の当たり判定（ビーム）なら長さと向き。円なら null */
    lineOf: (index: number) => { length: number; dirX: number; dirY: number } | null = () => null,
    /** 扇形の当たり判定なら向きと片側の開き（ラジアン）。円なら null */
    sectorOf: (index: number) => { dirX: number; dirY: number; half: number } | null = () => null,
    /** 描かないもの（出番を待っている爆炎の柱など） */
    hidden: (index: number) => boolean = () => false,
    /** 外へ進む攻撃の帯（中が空いている）なら true。真ん中に芯を描かない */
    hollow: (index: number) => boolean = () => false,
    /** 技そのもの（効き方から出たものでない） */
    isMain: (index: number) => boolean = () => true,
    /** 技が落ちた後に残る範囲。レシピに linger があれば、軌跡の粒と芯を出さない（drawLinger が控えめな粒を出す） */
    lingering: (index: number) => boolean = () => false,
  ): void {
    // 軌跡のパーティクルを出す数は、レシピごとの間隔で決める
    const trailCounts = new Map<string, number>();
    const trailCountOf = (id: string, trail: NonNullable<EffectRecipe['trail']>): number => {
      let n = trailCounts.get(id);
      if (n === undefined) {
        const budget = (this.trailBudgets.get(id) ?? 0) + deltaMs;
        n = Math.floor(budget / trail.intervalMs);
        this.trailBudgets.set(id, budget - n * trail.intervalMs);
        trailCounts.set(id, n);
      }
      return n;
    };
    let used = 0;
    for (let i = 0; i < src.count; i++) {
      if (hidden(i)) continue;
      const recipeId = recipeOf(i);
      const recipe = this.recipe(recipeId);
      const body = recipe.projectile;
      const trail = recipe.trail;
      let x = src.prevX[i]! + (src.x[i]! - src.prevX[i]!) * alpha;
      let y = src.prevY[i]! + (src.y[i]! - src.prevY[i]!) * alpha;
      const r = src.radius[i]!;
      const sector = sectorOf(i);
      const line = lineOf(i);
      if (recipe.linger && lingering(i)) continue;
      if (trail) {
        const em = this.emitter(this.trailEmitters, recipeId, trail, this.depth - 0.5);
        const n = trailCountOf(recipeId, trail);
        if (sector && sector.half < Math.PI) {
          // 扇形（かえんほうしゃなど）は、扇の中のあちこちから出す（根元だけだと、炎が噴き出して見えない。作者の指摘 2026年10月23日）。
          // 広いほど多く出す
          const base = Math.atan2(sector.dirY, sector.dirX);
          const many = n * Math.min(8, Math.max(1, Math.round((r * sector.half) / 40)));
          for (let k = 0; k < many; k++) {
            const a = base + (Math.random() * 2 - 1) * sector.half;
            const d = Math.sqrt(Math.random()) * r;
            em.emitParticleAt(x + Math.cos(a) * d, y + Math.sin(a) * d, 1);
          }
        } else if (hollow(i) && !sector) {
          // 中が空いた輪（とっておき・うたう）は、輪の縁から出す
          for (let k = 0; k < n * 4; k++) {
            const a = Math.random() * Math.PI * 2;
            const pt = em.emitParticleAt(x + Math.cos(a) * r, y + Math.sin(a) * r, 1);
            // 外へ押し出す（だくりゅう・ふんえん）
            if (pt && trail.outward) {
              const v = trail.speed[0] + Math.random() * (trail.speed[1] - trail.speed[0]);
              pt.velocityX = Math.cos(a) * v;
              pt.velocityY = Math.sin(a) * v;
            }
          }
        } else if (line && line.length > 0) {
          // 線（通った道に残る範囲など）は、線のあちこちから出す。長いほど多く出す
          const many = n * Math.min(8, Math.max(1, Math.round(line.length / 60)));
          for (let k = 0; k < many; k++) {
            const d = Math.random() * line.length;
            em.emitParticleAt(x + line.dirX * d + scatter(trail.spread), y + line.dirY * d + scatter(trail.spread), 1);
          }
        } else {
          for (let k = 0; k < n; k++) em.emitParticleAt(x + scatter(trail.spread), y + scatter(trail.spread), 1);
        }
      }
      // 範囲そのもの（光の色）は HitShapes が平らに塗る。ここでは発射体の芯だけを、当たり判定の内側に小さく描く。扇形は芯を出さない
      // 持ち主の残像として飛ぶもの（ゴッドバード）は、芯の代わりに RunScene が姿を描く
      // ドット絵で描く技（ハードプラント・ハイドロポンプ）も芯を描かない（MoveSprites が描く）
      if (!body || sector || hollow(i) || recipe.hideShape || (recipe.ownerGhost && !line) || (recipe.sprite && isMain(i)) || (recipe.effectLineSprite && line && !isMain(i)) || (recipe.effectSprite && !line && !isMain(i))) continue;
      const pulse = body.pulse ? 1 + Math.sin((timeMs / body.pulse.periodMs) * Math.PI * 2) * body.pulse.amount : 1;
      let core = this.cores[used];
      if (!core) {
        core = this.add(this.scene.add.image(0, 0, CORE_TEXTURE).setDepth(this.depth + 0.1).setBlendMode(Phaser.BlendModes.ADD));
        this.cores.push(core);
      }
      // 芯の直径は当たり判定の直径 × coreScale × CORE_RATIO（当たり判定からはみ出さない）
      const unit = (r * 2) / GLOW_SIZE;
      const size = Math.min(1, body.coreScale * CORE_RATIO * pulse);
      if (line) {
        // ビーム: 芯の円を線の長さに引き伸ばし、向きに合わせて回す
        const cx = x + (line.dirX * line.length) / 2;
        const cy = y + (line.dirY * line.length) / 2;
        core.setPosition(cx, cy).setRotation(Math.atan2(line.dirY, line.dirX)).setScale((line.length + r * 2 * size) / GLOW_SIZE, unit * size);
      } else {
        core.setPosition(x, y).setRotation(0).setScale(unit * size);
      }
      core.setTint(hexColor(body.coreColor)).setAlpha(body.glowAlpha).setVisible(true);
      used++;
    }
    for (let k = used; k < this.visible; k++) this.cores[k]!.setVisible(false);
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
      const img = this.add(this.scene.add.image(x, y, GLOW_TEXTURE))
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
  }
}
