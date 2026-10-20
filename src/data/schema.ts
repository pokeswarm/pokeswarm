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
  projectileColor: colorString,
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
  projectileSpeed: z.number().positive(),
  projectileRadius: z.number().positive(),
  projectileLifetimeSeconds: z.number().positive(),
  maxProjectiles: z.number().int().positive(),
});
export type AttackConfig = z.infer<typeof attackConfigSchema>;
