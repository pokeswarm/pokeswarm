import { z } from 'zod';

/** data/ 以下の JSON の型（スキーマ）。読み込み時に検証する。 */

const colorString = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const simulationConfigSchema = z.object({
  /** 1秒あたりのシミュレーション更新回数 */
  tickRate: z.number().int().min(1).max(240),
  /** 1フレームで追いつく最大の更新回数（タブ復帰時などの暴走防止） */
  maxTicksPerFrame: z.number().int().min(1),
  /**
   * タブが裏に回っている間の1回の呼び出しで追いつく最大の更新回数。
   * 裏のタブではブラウザがタイマーを1秒に1回程度まで間引くため、まとめて進める
   */
  hiddenMaxTicksPerCall: z.number().int().min(1),
  /** 協力プレイ中、描画のタイミングがこの時間来なければ、タブが裏に回ったとみなしてタイマーで進める（ms） */
  stalledFrameMs: z.number().int().positive(),
  defaultSeed: z.number().int().nonnegative(),
});
export type SimulationConfig = z.infer<typeof simulationConfigSchema>;

export const playerConfigSchema = z.object({
  /** 1秒あたりの移動量（ピクセル相当のワールド単位） */
  moveSpeed: z.number().positive(),
  radius: z.number().positive(),
  /** 経験値の玉を吸い寄せ始める距離（ステータス。パッシブ等で伸ばす） */
  pickupRange: z.number().nonnegative(),
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
  gemColor: colorString,
  bigGemColor: colorString,
});
export type PlaceholderRenderConfig = z.infer<typeof placeholderRenderSchema>;

export const enemyKindSchema = z.object({
  id: z.string().min(1),
  /** 表示に使うスプライト（public/sprites/<key>）。無ければ仮の円で描く */
  sprite: z.string().optional(),
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
    /** 敵同士の簡易的な押し合い */
    separation: z.object({
      strength: z.number().min(0).max(1),
      maxNeighbors: z.number().int().nonnegative(),
    }),
    /** 空間ハッシュの格子の大きさ */
    spatialCellSize: z.number().positive(),
    /** 前の時間帯の種類の敵は、離れすぎたら移し替えずに消す（時間帯が進むと前の種類が自然にいなくなる） */
    retireOldWaveKinds: z.boolean(),
    /**
     * 時間帯ごとに出す雑魚の種類（data/game/enemies.json の id）。startSeconds の小さい順に並べ、最初は 0。
     * その時間帯の種類から等しい確率で選ぶ。
     * hpMultiplier はその時間帯に出る敵の HP の倍率（後の時間帯ほど強い = 原作で後に出るポケモンほどレベルが高い感覚）。
     * 同じ種類は続いた時間帯にだけ出せる（一度いなくなった種類は後で戻らない）
     */
    waves: z
      .array(
        z.object({
          startSeconds: z.number().nonnegative(),
          hpMultiplier: z.number().positive(),
          kinds: z.array(z.string()).min(1),
        }),
      )
      .min(1),
  })
  .refine((s) => s.spawnDistanceMin <= s.spawnDistanceMax, { message: 'spawnDistanceMin <= spawnDistanceMax' })
  .refine((s) => s.spawnDistanceMax < s.relocateDistance, { message: 'spawnDistanceMax < relocateDistance' })
  .refine((s) => s.waves[0]!.startSeconds === 0, { message: 'waves の最初は startSeconds: 0' })
  .refine((s) => s.waves.every((w, i) => i === 0 || w.startSeconds > s.waves[i - 1]!.startSeconds), {
    message: 'waves は startSeconds の小さい順に並べる',
  })
  .superRefine((s, ctx) => {
    const problem = findReappearingKind(s.waves);
    if (problem) {
      ctx.addIssue({
        code: 'custom',
        message: `waves: "${problem.kind}" が時間帯 ${problem.leftAt + 1} でいなくなった後、時間帯 ${problem.backAt + 1} で再び出ている（一度いなくなった種類は後で戻さない）`,
      });
    }
  });
export type SpawnConfig = z.infer<typeof spawnConfigSchema>;

/** 一度いなくなった種類が後の時間帯で再び出ていれば、その種類と時間帯の番号を返す */
export function findReappearingKind(
  waves: readonly { kinds: readonly string[] }[],
): { kind: string; leftAt: number; backAt: number } | null {
  const lastSeen = new Map<string, number>();
  for (let i = 0; i < waves.length; i++) {
    for (const kind of waves[i]!.kinds) {
      const last = lastSeen.get(kind);
      if (last !== undefined && last < i - 1) return { kind, leftAt: last + 1, backAt: i };
      lastSeen.set(kind, i);
    }
  }
  return null;
}

/** 仮の自動攻撃（技の仕組みができたら置き換える） */
export const attackConfigSchema = z.object({
  cooldownSeconds: z.number().positive(),
  range: z.number().positive(),
  damage: z.number().positive(),
  /** 1つの発射体が当たれる敵の数。"infinite" なら貫通無限（近接攻撃など） */
  pierce: z.union([z.number().int().positive(), z.literal('infinite')]),
  /** ノックバック: 当たった敵を、攻撃の向きへ speed（ワールド単位/秒）で durationSeconds 秒押し返す。無ければ押し返さない */
  knockback: z.object({ speed: z.number().nonnegative(), durationSeconds: z.number().nonnegative() }).optional(),
  /** 状態異常: 当たったとき chance の確率で id の状態異常を durationSeconds 秒付ける。無ければ付けない */
  status: z
    .object({ id: z.string(), chance: z.number().min(0).max(1), durationSeconds: z.number().positive() })
    .optional(),
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
      /**
       * 作る画像の種類（省略時は full）
       * - full: 全動作（プレイアブル・中ボス・ボス）。public/sprites/<key>/
       * - enemy: 雑魚用。enemyAnimations の動作だけ。public/sprites/enemy/<key>/
       */
      uses: z.array(z.enum(['full', 'enemy'])).min(1).default(['full']),
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
  /** 雑魚用に取り出す動作（GPU のメモリを抑えるため最小限にする） */
  enemyAnimations: z.array(z.string().min(1)).min(1),
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
  /** 敵の拡大率と、敵に使う動作 */
  enemyScale: z.number().positive(),
  enemyAnimation: z.string(),
  /** 次の時間帯の雑魚のスプライトを、始まる何秒前から読み込むか */
  enemyPreloadSeconds: z.number().nonnegative(),
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

// ---- 協力プレイの通信 ----

const syncRateSchema = z.object({
  /** 自分のプレイヤーの位置を送る間隔（更新回数） */
  playerStateIntervalTicks: z.number().int().positive(),
  /** ホストが敵の位置を補正する間隔（更新回数） */
  correctionIntervalTicks: z.number().int().positive(),
});

export const networkConfigSchema = z.object({
  /** WebRTC の接続に使う STUN サーバー */
  iceServers: z.array(z.object({ urls: z.union([z.string(), z.array(z.string())]) })),
  /** この時間内に直接つながらなければ Realtime Database の中継に切り替える */
  p2pTimeoutMs: z.number().int().positive(),
  p2p: syncRateSchema,
  /** 中継時は送る頻度を下げ、まとめて書き込む（通信量と書き込み回数を抑える） */
  relay: syncRateSchema.extend({ flushIntervalMs: z.number().int().positive() }),
  /** 往復時間を測る間隔（更新回数） */
  pingIntervalTicks: z.number().int().positive(),
  /** ゲストの出現位置（ホストからの横のずれ） */
  guestSpawnOffsetX: z.number(),
});
export type NetworkConfig = z.infer<typeof networkConfigSchema>;

// ---- 状態異常 ----

/**
 * 状態異常の種類ごとの効果。効果の部品の組み合わせで表す（技術検証では次の3つ）:
 * - damagePerSecond: 継続ダメージ（やけど・どく）
 * - speedMultiplier: 移動の速さの倍率。0 で止まる（まひ・こおり）
 * - damageTakenMultiplier: 受けるダメージの倍率（ぼうぎょダウン）
 * 違う状態異常は同時にかかる。速さは一番遅いもの、受けるダメージは掛け合わせ。
 * 同じ状態異常を重ねたら、残り時間の長いほうにする（重ねがけで強くしない）。
 */
export const statusKindSchema = z.object({
  id: z.string().min(1),
  damagePerSecond: z.number().nonnegative(),
  speedMultiplier: z.number().min(0),
  damageTakenMultiplier: z.number().positive(),
  /** かかっている間の敵の色（見た目だけ） */
  color: colorString,
});
export type StatusKind = z.infer<typeof statusKindSchema>;

export const statusConfigSchema = z.object({
  /** 種類の数は 255 まで（通信で番号を送るため） */
  kinds: z.array(statusKindSchema).min(1).max(255),
});
export type StatusConfig = z.infer<typeof statusConfigSchema>;

// ---- 経験値の玉 ----

export const pickupConfigSchema = z.object({
  /** 雑魚1体が落とす経験値 */
  xpPerKill: z.number().positive(),
  gemRadius: z.number().positive(),
  /** 玉の数の上限。超えたら新しい玉を作らず、一番古い玉に経験値をまとめる */
  maxGems: z.number().int().positive(),
  /** 吸い寄せられる速さ（ワールド単位/秒） */
  magnetSpeed: z.number().positive(),
  /** この経験値以上の玉は大きい玉として表示する（見た目だけ） */
  bigGemValue: z.number().positive(),
});
export type PickupConfig = z.infer<typeof pickupConfigSchema>;
