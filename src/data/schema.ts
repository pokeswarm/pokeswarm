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
  /** プレイヤーに触れたときのダメージ（時間帯の damageMultiplier を掛ける） */
  contactDamage: z.number().nonnegative(),
  /** PokeAPI のポケモンのキー（タイプ・名前に使う）。省略時は id */
  species: z.string().optional(),
  /** 雑魚（normal・省略時）・中ボス（midboss）・ボス（boss）。中ボス・ボスは data/game/stage.json の予定で出す */
  rank: z.enum(['normal', 'midboss', 'boss']).optional(),
  /** 倒したときに落とす経験値。省略時は pickups.json の xpPerKill（雑魚には時間帯の xpMultiplier を掛ける） */
  xp: z.number().nonnegative().optional(),
  /** スプライトの大きさの倍率（省略時は 1。中ボス・ボスを大きく描く） */
  spriteScale: z.number().positive().optional(),
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
          /** その時間帯に出る敵の接触ダメージの倍率 */
          damageMultiplier: z.number().positive(),
          /** その時間帯に出る雑魚が落とす経験値の倍率（省略時は 1） */
          xpMultiplier: z.number().positive().optional(),
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

// ---- ステージ（ランの長さ・中ボス・ボス） ----

/**
 * ボスの範囲技。狙ったプレイヤーの足元に範囲を予告し、telegraphSeconds 後にその範囲へダメージを与える。
 * 当たったかは受けたプレイヤーのブラウザで判定する（01_game_design.md 2.3）。
 */
export const bossMoveSchema = z.object({
  /** 技の名前に使う PokeAPI の技のキー */
  move: z.string().min(1),
  /** 範囲に落ちたときの演出（data/effects/recipes.json） */
  effect: z.string().min(1),
  intervalSeconds: z.number().positive(),
  telegraphSeconds: z.number().positive(),
  radius: z.number().positive(),
  damage: z.number().nonnegative(),
  /** 1回に落とす範囲の数 */
  count: z.number().int().positive(),
  /** 狙ったプレイヤーの位置からのばらつき（2つ目以降の範囲） */
  spread: z.number().nonnegative(),
});
export type BossMove = z.infer<typeof bossMoveSchema>;

export const stageConfigSchema = z.object({
  /** ランの長さ。この時間でボスが出る */
  durationSeconds: z.number().positive(),
  /** 中ボスの出る時間と種類（data/game/enemies.json の rank: "midboss"） */
  midbosses: z.array(z.object({ atSeconds: z.number().nonnegative(), kind: z.string().min(1) })),
  /** ボス（rank: "boss"）。倒せばランクリア。null ならボスなし（テスト用） */
  boss: z.object({ kind: z.string().min(1), move: bossMoveSchema }).nullable(),
  bossRules: z.object({
    /** 中ボス・ボスのノックバックの倍率（0 で押されない） */
    knockbackMultiplier: z.number().min(0),
    /** 中ボス・ボスの、動きを止める状態異常（speedMultiplier が 0 のもの）の時間の倍率 */
    stopStatusMultiplier: z.number().min(0),
    /** 2人目以降の1人あたりの HP の増加（%） */
    hpPerExtraPlayerPct: z.number().min(0),
    /** プレイヤーからこの距離に出す */
    spawnDistance: z.number().positive(),
  }),
  /** クリア・失敗が決まってから結果画面に移るまでの時間 */
  endDelaySeconds: z.number().nonnegative(),
});
export type StageConfig = z.infer<typeof stageConfigSchema>;

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

// ---- 戦闘の共通設定 ----

export const combatConfigSchema = z.object({
  /** 発射体・攻撃の当たり判定の数の上限（全プレイヤー合計） */
  maxProjectiles: z.number().int().positive(),
  /**
   * 1つの攻撃が覚えておける「当てた敵」の数。同じ敵に当たり直しすぎないようにするため。
   * これを超えて当てると古いものから忘れる（その敵には再び当たりうる）
   */
  hitMemory: z.number().int().positive(),
  /** タイプ相性の倍率（01_game_design.md 4.5） */
  typeMultipliers: z.object({
    /** タイプ一致 */
    stab: z.number().positive(),
    /** 効果はばつぐん */
    superEffective: z.number().positive(),
    /** 効果はいまひとつ（原作の「効果がない」もこれにする） */
    notVeryEffective: z.number().positive(),
  }),
  /** 覚えられる技の数 */
  maxMoveSlots: z.number().int().positive(),
  /** 急所のダメージの倍率 */
  critMultiplier: z.number().min(1),
});
export type CombatConfig = z.infer<typeof combatConfigSchema>;

// ---- 技 ----

/**
 * 技の出し方（01_game_design.md 4.1）:
 * - nearest: 一番近い敵へ発射体を飛ばす（count 発を interval ごとに）
 * - facing: 向いている方向へ発射体を飛ばす（count 発を interval ごとに。spreadDegrees で広がる。360 でランダムな方向）
 * - melee: 向いている方向の近くに当たり判定を出し、持ち主に付いていく（count 2 で反対側にも。range 0 で自分の周り全体 = オーラ）
 * - orbit: 自分の周りを count 個の当たり判定が回る（duration の間）
 * - beam: 一番近い敵（いなければ向いている方向）へ長さ range・太さ size の直線を出す
 * - boomerang: 向いている方向へ飛び、減速して戻ってくる
 * - ground: 一番近い敵の位置（いなければ前方）に、地面に残る当たり判定を置く（count 2 以上は周りに散らす）
 * - nova: 自分を中心に、size から range まで広がる輪
 * - homing: 一番近い敵を追いかける発射体
 */
export const MOVE_PATTERNS = ['nearest', 'facing', 'melee', 'orbit', 'beam', 'boomerang', 'ground', 'nova', 'homing'] as const;
export type MovePattern = (typeof MOVE_PATTERNS)[number];

const pierceValue = z.union([z.number().int().positive(), z.literal('infinite')]);

/** 技の性能（レベルごとに変わる部分） */
export const moveStatsSchema = z.object({
  /** 威力（ダメージの元。ポケモンのステータスとタイプ相性を掛ける） */
  power: z.number().nonnegative(),
  /** 再使用までの時間（秒） */
  cooldownSeconds: z.number().positive(),
  /** 1回に出す数 */
  count: z.number().int().positive(),
  /** 複数出すときの間隔（秒。nearest・facing） */
  intervalSeconds: z.number().nonnegative(),
  /** 発射体の速さ（ワールド単位/秒）。orbit では回る速さ */
  speed: z.number().nonnegative(),
  /** 当たり判定の大きさ（半径） */
  size: z.number().positive(),
  /** 狙える距離（nearest）・前に出る距離（melee）・回る半径（orbit） */
  range: z.number().nonnegative(),
  /** 当たり判定が残る時間（秒） */
  durationSeconds: z.number().positive(),
  /** 貫通可能数。"infinite" で無限 */
  pierce: pierceValue,
  /** 同じ敵に当たり直すまでの間隔（秒）。0 なら1回だけ当たる */
  hitIntervalSeconds: z.number().nonnegative(),
  /** ノックバックの速さと時間 */
  knockback: z.number().nonnegative(),
  knockbackSeconds: z.number().nonnegative(),
  /** 状態異常（data/game/status.json の id）。無ければ付けない */
  statusId: z.string().optional(),
  statusChance: z.number().min(0).max(1),
  statusSeconds: z.number().nonnegative(),
  /** 発射の向きのばらつき（度）。360 で全方向 */
  spreadDegrees: z.number().min(0).max(360).default(0),
  /** 与えたダメージのうち回復する割合（%）。HP は区切り3で作るので、今は効果なし */
  lifestealPct: z.number().nonnegative().default(0),
});
export type MoveStatsData = z.infer<typeof moveStatsSchema>;

/** レベルが1上がるごとに足す量（数値の項目だけ。pierce も数で足す） */
export const moveLevelDeltaSchema = z
  .object({
    power: z.number(),
    cooldownSeconds: z.number(),
    count: z.number().int(),
    intervalSeconds: z.number(),
    speed: z.number(),
    size: z.number(),
    range: z.number(),
    durationSeconds: z.number(),
    pierce: z.number().int(),
    hitIntervalSeconds: z.number(),
    knockback: z.number(),
    knockbackSeconds: z.number(),
    statusChance: z.number(),
    statusSeconds: z.number(),
    spreadDegrees: z.number(),
    lifestealPct: z.number(),
  })
  .partial();
export type MoveLevelDelta = z.infer<typeof moveLevelDeltaSchema>;

export const moveDefSchema = z.object({
  pattern: z.enum(MOVE_PATTERNS),
  /** 見た目のレシピ（data/effects/recipes.json のキー） */
  effect: z.string(),
  /** レベル1の性能 */
  base: moveStatsSchema,
  /** レベル2以降で足す量。最大レベルは levels の数 + 1 */
  levels: z.array(moveLevelDeltaSchema),
});
export type MoveDefData = z.infer<typeof moveDefSchema>;

/** 技の定義。キーは PokeAPI の技の名前（タイプ・分類・名前は data/generated/moves.json から） */
export const movesConfigSchema = z.object({ moves: z.record(z.string(), moveDefSchema) });
export type MovesConfig = z.infer<typeof movesConfigSchema>;

/** プレイアブルのポケモン。キーは PokeAPI のポケモンの名前 */
export const playablesConfigSchema = z.object({
  pokemon: z.record(
    z.string(),
    z.object({
      /** スプライトのキー（public/sprites/<key>） */
      sprite: z.string(),
      /** 最初に覚えている技 */
      startingMoves: z.array(z.string()).min(1),
    }),
  ),
  /** 指定が無いときのポケモン */
  default: z.string(),
});
export type PlayablesConfig = z.infer<typeof playablesConfigSchema>;

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
  /** ダメージを受けると治る（ねむり） */
  breaksOnDamage: z.boolean().default(false),
  /** 継続ダメージの分だけ、付けたプレイヤーが回復する（やどりぎ。HP は区切り3で作るので、今は効果なし） */
  healsAttacker: z.boolean().default(false),
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

// ---- PokeAPI から生成するデータ（data/generated/。scripts/fetch-pokeapi.ts） ----

export const pokeapiTargetsSchema = z.object({
  pokemon: z.array(z.string()),
  moves: z.array(z.string()),
  items: z.array(z.string()),
});

const localizedNames = z.object({ ja: z.string().min(1), en: z.string().min(1) });
export type LocalizedNames = z.infer<typeof localizedNames>;

export const generatedPokemonEntrySchema = z.object({
  dex: z.number().int().positive(),
  names: localizedNames,
  /** タイプのキー（1つ目が主のタイプ） */
  types: z.array(z.string()).min(1).max(2),
  baseStats: z.object({
    hp: z.number().int(),
    attack: z.number().int(),
    defense: z.number().int(),
    specialAttack: z.number().int(),
    specialDefense: z.number().int(),
    speed: z.number().int(),
  }),
  /** 次の進化（原作の条件。赤・緑の条件があればそれ） */
  evolvesTo: z.array(
    z.object({
      to: z.string(),
      trigger: z.enum(['level', 'item', 'trade', 'other']),
      level: z.number().int().optional(),
      item: z.string().optional(),
    }),
  ),
});
export type GeneratedPokemon = z.infer<typeof generatedPokemonEntrySchema>;
export const generatedPokemonSchema = z.record(z.string(), generatedPokemonEntrySchema);

export const generatedMoveEntrySchema = z.object({
  names: localizedNames,
  type: z.string(),
  /** 原作の分類。physical / special / status */
  damageClass: z.enum(['physical', 'special', 'status']),
});
export type GeneratedMove = z.infer<typeof generatedMoveEntrySchema>;
export const generatedMovesSchema = z.record(z.string(), generatedMoveEntrySchema);

export const generatedItemsSchema = z.record(z.string(), z.object({ names: localizedNames }));

export const generatedTypeEntrySchema = z.object({
  names: localizedNames,
  /** 攻撃側として、効果ばつぐん・いまひとつ・効果なしになる相手のタイプ */
  doubleDamageTo: z.array(z.string()),
  halfDamageTo: z.array(z.string()),
  noDamageTo: z.array(z.string()),
});
export type GeneratedType = z.infer<typeof generatedTypeEntrySchema>;
export const generatedTypesSchema = z.record(z.string(), generatedTypeEntrySchema);

// ---- レベルアップ・持ち物・パッシブ・派生 ----

export const levelingConfigSchema = z.object({
  maxLevel: z.number().int().positive(),
  /** レベル L から L+1 に必要な経験値 = base × L^exponent（区切り4で、強化なしで15分レベル50になるよう調整する） */
  xpCurve: z.object({ base: z.number().positive(), exponent: z.number().positive() }),
  /** レベルアップで出る候補の数 */
  offerCount: z.number().int().positive(),
  /** 選ぶまでの制限時間（秒）。時間切れは見送ると同じ */
  choiceSeconds: z.number().positive(),
  /** ランの始めのリロール権（永続強化で増やす） */
  initialRerolls: z.number().int().nonnegative(),
  /** 再開したときの無敵時間（秒） */
  resumeInvincibleSeconds: z.number().nonnegative(),
  /** 持ち物の枠 */
  maxItemSlots: z.number().int().positive(),
});
export type LevelingConfig = z.infer<typeof levelingConfigSchema>;

/**
 * 持ち物・パッシブの効果（1段階あたり）。% の項目は足し合わせてから掛ける。
 * typePowerPct・typeAreaPct はタイプ（PokeAPI のキー）ごと。
 */
export const modifierSchema = z
  .object({
    powerPct: z.number(),
    physicalPowerPct: z.number(),
    specialPowerPct: z.number(),
    typePowerPct: z.record(z.string(), z.number()),
    areaPct: z.number(),
    typeAreaPct: z.record(z.string(), z.number()),
    cooldownPct: z.number(),
    projectileSpeedPct: z.number(),
    critChancePct: z.number(),
    damageTakenPct: z.number(),
    defensePct: z.number(),
    maxHpPct: z.number(),
    regenPerSecond: z.number(),
    moveSpeedPct: z.number(),
    pickupRangePct: z.number(),
    xpPct: z.number(),
  })
  .partial();
export type ModifierData = z.infer<typeof modifierSchema>;

const upgradeDefSchema = z.object({
  maxLevel: z.number().int().positive(),
  /** 進化・派生に使うとなくなる（進化の石・つながりのヒモ） */
  consumable: z.boolean().default(false),
  perLevel: modifierSchema,
});

/** 持ち物。キーは PokeAPI の持ち物の名前 */
export const itemsConfigSchema = z.object({ items: z.record(z.string(), upgradeDefSchema) });
export type ItemsConfig = z.infer<typeof itemsConfigSchema>;
/** パッシブ（枠を使わない強化）。キーは PokeAPI の持ち物の名前（名前を借りる） */
export const passivesConfigSchema = z.object({ passives: z.record(z.string(), upgradeDefSchema) });
export type PassivesConfig = z.infer<typeof passivesConfigSchema>;

/** 派生（技 + 持ち物 → 派生技）と固有技（派生技 + 持ち物 → 固有技。その系統だけ） */
export const derivationsConfigSchema = z.object({
  derivations: z.array(z.object({ from: z.string(), item: z.string(), to: z.string() })),
  unique: z.array(
    z.object({
      from: z.string(),
      item: z.string(),
      to: z.string(),
      /** 系統（data/game/playables.json のキー） */
      line: z.string(),
    }),
  ),
});
export type DerivationsConfig = z.infer<typeof derivationsConfigSchema>;

// ---- プレイヤーのステータス ----

/**
 * ゲーム内の値 = 基準値 × 種族値のランクによる倍率 × レベルによる伸び（01_game_design.md 5.1）。
 * ランク: 種族値が rankThresholds のどこに入るかで rankMultipliers の倍率を選ぶ（区切りの数 + 1 個）。
 * 防御は ぼうぎょ と とくぼう の高い方。受けるダメージ = ダメージ × 100 / (100 + 防御)。
 */
export const statsConfigSchema = z
  .object({
    rankThresholds: z.array(z.number()).min(1),
    rankMultipliers: z.array(z.number().positive()),
    /** レベル1・ランク倍率 1 のときの値。威力は技のダメージに掛ける倍率 */
    base: z.object({ maxHp: z.number().positive(), power: z.number().positive(), defense: z.number().nonnegative() }),
    /** レベルが1上がるごとに伸びる割合（%） */
    perLevelPct: z.object({ maxHp: z.number(), power: z.number(), defense: z.number() }),
    /** 敵に触れてダメージを受けた後の無敵時間（秒） */
    hurtInvincibleSeconds: z.number().nonnegative(),
    /** 倒れたときの自動復活（ソロ）。復活可能数は全員で共有し、永続強化で増やす */
    revive: z.object({ initialCount: z.number().int().nonnegative(), hpPct: z.number().positive(), invincibleSeconds: z.number().nonnegative() }),
  })
  .refine((s) => s.rankMultipliers.length === s.rankThresholds.length + 1, { message: 'rankMultipliers は rankThresholds より1つ多くする' });
export type StatsConfig = z.infer<typeof statsConfigSchema>;
