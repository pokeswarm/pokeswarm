import { z } from 'zod';

/** data/ 以下の JSON の型（スキーマ）。読み込み時に検証する。 */

const colorString = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const simulationConfigSchema = z.object({
  /** 1秒あたりのシミュレーション更新回数 */
  tickRate: z.number().int().min(1).max(240),
  /** 1フレームで追いつく最大の更新回数（タブ復帰時などの暴走防止） */
  maxTicksPerFrame: z.number().int().min(1),
  defaultSeed: z.number().int().nonnegative(),
});
export type SimulationConfig = z.infer<typeof simulationConfigSchema>;

export const playerConfigSchema = z.object({
  /** 1秒あたりの移動量（ピクセル相当のワールド単位） */
  moveSpeed: z.number().positive(),
  radius: z.number().positive(),
  spawnX: z.number(),
  spawnY: z.number(),
});
export type PlayerConfig = z.infer<typeof playerConfigSchema>;

export const placeholderRenderSchema = z.object({
  backgroundColor: colorString,
  gridSize: z.number().int().positive(),
  gridColor: colorString,
  playerColor: colorString,
  playerFacingColor: colorString,
  enemyColor: colorString,
  enemyEmpoweredColor: colorString,
});
export type PlaceholderRenderConfig = z.infer<typeof placeholderRenderSchema>;

export const enemyKindSchema = z.object({
  id: z.string().min(1),
  hp: z.number().positive(),
  moveSpeed: z.number().nonnegative(),
  radius: z.number().positive(),
});
export type EnemyKind = z.infer<typeof enemyKindSchema>;

export const enemiesConfigSchema = z.object({
  kinds: z.array(enemyKindSchema).min(1),
});
export type EnemiesConfig = z.infer<typeof enemiesConfigSchema>;

export const spawnConfigSchema = z
  .object({
    /** 1秒あたりの出現数 */
    spawnPerSecond: z.number().nonnegative(),
    /** プレイヤーからこの距離の輪の中に出す（画面外になる距離） */
    spawnDistanceMin: z.number().positive(),
    spawnDistanceMax: z.number().positive(),
    /** 一番近いプレイヤーからこれより離れた敵は、進行方向側へ移し替える */
    relocateDistance: z.number().positive(),
    /** 移し替え先の、進行方向に対する横方向のばらつき */
    relocateSideSpread: z.number().nonnegative(),
    /** 全体の上限 */
    capGlobal: z.number().int().positive(),
    /** プレイヤー1人あたりの上限（実際の上限は min(全体, 1人あたり × 人数)） */
    capPerPlayer: z.number().int().positive(),
    /** 上限に達したときの挙動（仮）: 新しく出す代わりに既存の敵を強化する */
    overflow: z.object({
      empowerHpMultiplier: z.number().min(1),
      maxEmpowerLevel: z.number().int().nonnegative(),
    }),
    /** 敵同士の簡易的な押し合い */
    separation: z.object({
      strength: z.number().min(0).max(1),
      maxNeighbors: z.number().int().nonnegative(),
    }),
    /** 空間ハッシュの格子の大きさ */
    spatialCellSize: z.number().positive(),
  })
  .refine((s) => s.spawnDistanceMin <= s.spawnDistanceMax, { message: 'spawnDistanceMin <= spawnDistanceMax' })
  .refine((s) => s.spawnDistanceMax < s.relocateDistance, { message: 'spawnDistanceMax < relocateDistance' });
export type SpawnConfig = z.infer<typeof spawnConfigSchema>;

/** 仮の自動攻撃（技の仕組みができたら置き換える） */
export const attackConfigSchema = z.object({
  cooldownSeconds: z.number().positive(),
  range: z.number().positive(),
  damage: z.number().positive(),
  /** 1つの発射体が当たれる敵の数。"infinite" なら貫通無限（近接攻撃など） */
  pierce: z.union([z.number().int().positive(), z.literal('infinite')]),
  projectileSpeed: z.number().positive(),
  projectileRadius: z.number().positive(),
  projectileLifetimeSeconds: z.number().positive(),
  maxProjectiles: z.number().int().positive(),
  /**
   * 1つの発射体が覚えておける「当てた敵」の数。同じ敵に2回当たらないようにするため。
   * これを超えて当てると古いものから忘れる（その敵には再び当たりうる）
   */
  hitMemory: z.number().int().positive(),
  /** 見た目のレシピ（data/effects/recipes.json のキー）。シミュレーションは使わない */
  effect: z.string(),
});
export type AttackConfig = z.infer<typeof attackConfigSchema>;

// ---- スプライト（SpriteCollab からの取得・変換） ----

/** SpriteCollab のシートの行の並び（下から時計回りではなく、PMD の並び） */
export const SPRITE_DIRECTIONS = ['down', 'downRight', 'right', 'upRight', 'up', 'upLeft', 'left', 'downLeft'] as const;
export type SpriteDirection = (typeof SPRITE_DIRECTIONS)[number];

/** 使用するポケモンの一覧 */
export const spritePokemonListSchema = z.object({
  pokemon: z.array(
    z.object({
      /** ゲーム内で使うキー（PokeAPI の名前に合わせる） */
      key: z.string().regex(/^[a-z0-9-]+$/),
      /** 全国図鑑番号 */
      dex: z.number().int().positive(),
      /** フォルムのフォルダ（例: "0001"）。通常の姿なら省略 */
      form: z.string().optional(),
    }),
  ),
});
export type SpritePokemonList = z.infer<typeof spritePokemonListSchema>;

export const spritePipelineSchema = z.object({
  source: z.object({
    repo: z.string(),
    /** 取得するコミット。固定して何度実行しても同じ結果にする */
    ref: z.string().min(1),
  }),
  /** 取り出す動作（AnimData.xml の Name） */
  animations: z.array(z.string().min(1)).min(1),
  /** 動作が欠けているときの代わり（代わりも欠けていればさらにたどる） */
  fallbacks: z.record(z.string(), z.string()),
  maxAtlasSize: z.number().int().positive(),
});
export type SpritePipeline = z.infer<typeof spritePipelineSchema>;

/** 変換後のアニメーション定義（public/sprites/<key>/anims.json） */
export const spriteAnimsSchema = z.object({
  key: z.string(),
  dex: z.number().int(),
  /** 1コマの表示時間の単位（PMD は 1/60 秒） */
  durationUnitMs: z.number().positive(),
  directions: z.array(z.enum(SPRITE_DIRECTIONS)).length(8),
  animations: z.record(
    z.string(),
    z.object({
      /** 実際に使った SpriteCollab の動作名（代わりを使った場合は元と異なる） */
      source: z.string(),
      frameWidth: z.number().int().positive(),
      frameHeight: z.number().int().positive(),
      durations: z.array(z.number().int().positive()).min(1),
      /** アトラス内のコマの名前: `${name}/${方向の番号}/${コマ番号}` */
      frameKeyPrefix: z.string(),
    }),
  ),
  /** 欠けていた動作と、代わりに使った動作 */
  missing: z.array(z.object({ animation: z.string(), usedInstead: z.string().nullable() })),
});
export type SpriteAnims = z.infer<typeof spriteAnimsSchema>;

/** スプライトの表示設定 */
export const spriteRenderSchema = z.object({
  /** プレイヤーに使うスプライト（public/sprites/<key>）。無ければ仮の円で表示する */
  playerSprite: z.string(),
  /** 拡大率（ドット絵向けにニアレストネイバーで拡大する） */
  playerScale: z.number().positive(),
  idleAnimation: z.string(),
  walkAnimation: z.string(),
  /** 確認用の一覧表示（?gallery）の間隔 */
  gallerySpacing: z.number().positive(),
});
export type SpriteRenderConfig = z.infer<typeof spriteRenderSchema>;

// ---- 技エフェクトのレシピ（見た目だけ。当たり判定はシミュレーション側） ----

const range = z.tuple([z.number(), z.number()]);
const blendMode = z.enum(['normal', 'add', 'screen', 'multiply']);

/** パーティクルの出し方 */
const particleSchema = z.object({
  /** 時間とともに変わる色（先頭が出た直後） */
  colors: z.array(colorString).min(1),
  /** 寿命（ms）。[最小, 最大] */
  lifespanMs: range,
  speed: range,
  /** [出た直後, 消える直前] */
  scale: range,
  alpha: range,
  gravityY: z.number(),
  /** 出現位置のばらつき（半径） */
  spread: z.number().nonnegative(),
  blend: blendMode,
});

export type EffectParticle = z.infer<typeof particleSchema>;

export const effectRecipeSchema = z.object({
  /** 発射体の本体: 芯と光の2枚重ね */
  projectile: z
    .object({
      coreColor: colorString,
      /** 発射体の当たり判定の半径に対する倍率 */
      coreScale: z.number().nonnegative(),
      glowColor: colorString,
      glowScale: z.number().nonnegative(),
      glowAlpha: z.number().min(0).max(1),
      /** 光の明滅 */
      pulse: z.object({ amount: z.number().nonnegative(), periodMs: z.number().positive() }).optional(),
    })
    .optional(),
  /** 発射体の軌跡に出すパーティクル */
  trail: particleSchema.extend({ intervalMs: z.number().positive() }).optional(),
  /** 命中時 */
  impact: z
    .object({
      burst: particleSchema.extend({ count: z.number().int().nonnegative() }).optional(),
      flash: z
        .object({ color: colorString, radius: z.number().positive(), durationMs: z.number().positive(), alpha: z.number().min(0).max(1) })
        .optional(),
      /** 画面の揺れ。intensity が 0 なら揺らさない */
      shake: z.object({ durationMs: z.number().nonnegative(), intensity: z.number().nonnegative() }).optional(),
    })
    .optional(),
});
export type EffectRecipe = z.infer<typeof effectRecipeSchema>;

/**
 * レシピの元データ。extends で別のレシピを元にし、書いた項目だけを上書きできる
 * （タイプごとの基本レシピから技ごとのレシピを量産するため）。
 */
export const effectRecipeFileSchema = z.object({
  recipes: z.record(z.string(), z.object({ extends: z.string().optional() }).catchall(z.unknown())),
});
