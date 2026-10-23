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
  playerColor: colorString,
  playerFacingColor: colorString,
  enemyColor: colorString,
  gemColor: colorString,
  bigGemColor: colorString,
});
export type PlaceholderRenderConfig = z.infer<typeof placeholderRenderSchema>;

/**
 * ドット調の画面の見た目（作者の決定。2026年10月22日）: 文字のフォント（英数字 Press Start 2P・日本語 美咲ゴシック第2）と、
 * 原作をまねた白い窓・黒い窓、画面上部の経験値のバー・経過時間・コイン
 */
export const uiConfigSchema = z.object({
  /** 画面の高さがこれより低いと、つめた表示にする（横向きのスマホ。作者の決定 2026年10月22日） */
  compactHeight: z.number().positive(),
  font: z.object({
    family: z.string(),
    faces: z.array(z.object({ family: z.string(), file: z.string() })),
    /** クレジットに出すフォントの権利表記 */
    credits: z.array(z.string()),
  }),
  window: z.object({ fill: colorString, border: colorString, inner: colorString, text: colorString, shadow: colorString, cursor: colorString }),
  dark: z.object({ fill: colorString, border: colorString, text: colorString }),
  expBar: z.object({ height: z.number().int().positive(), back: colorString, fill: colorString, border: colorString, text: colorString }),
  timer: z.object({ size: z.number().int().positive(), color: colorString }),
  coin: z.object({ size: z.number().int().positive(), color: colorString }),
  /**
   * タイトル画面の背景（作者の決定 2026年10月22日）: 真ん中を lead のポケモンが右へ歩き、マップが walkSpeed（px/秒）で流れる。
   * ほかの遊べるポケモン（進化の途中・進化先も）が passerEverySeconds の間隔で画面の端から現れ、passerSpeed で横切っていく
   * （真ん中のポケモンには近づかない。keepAway px より近くを通らない）。shade はマップを暗くする割合
   */
  /** 寄付（Ko-fi）のページの URL（作者の決定 2026年10月22日）。空なら寄付の窓のボタンは「準備中」 */
  donate: z.object({ url: z.string() }),
  /** スマホのジョイスティック（作者の決定 2026年10月22日）: 輪の半径・つまみの半径・止まったままの遊び（px） */
  joystick: z.object({ radius: z.number().positive(), knob: z.number().positive(), deadzone: z.number().nonnegative() }),
  /**
   * 画面の外にいる大事なもの（ボス・中ボス・伝説・ふしぎなアメ・味方）の方向を、画面の端に矢印で出す（作者の依頼 2026年10月22日）。
   * dot は矢印のドットの大きさ、margin* は画面の端からの距離（上は HUD をよけて広め）、iconGap は矢印から目印までの距離（px）
   */
  edgeArrows: z.object({
    dot: z.number().positive(),
    marginSide: z.number().nonnegative(),
    marginTop: z.number().nonnegative(),
    marginBottom: z.number().nonnegative(),
    iconGap: z.number().nonnegative(),
    colors: z.object({ boss: z.string(), midboss: z.string(), legendary: z.string(), candy: z.string(), ally: z.string(), allyDown: z.string() }),
  }),
  titleWalk: z.object({
    lead: z.string(),
    scale: z.number().positive(),
    walkSpeed: z.number().positive(),
    shade: z.number().min(0).max(1),
    passerEverySeconds: z.tuple([z.number().positive(), z.number().positive()]),
    passerSpeed: z.tuple([z.number().positive(), z.number().positive()]),
    maxPassers: z.number().int().positive(),
    keepAway: z.number().nonnegative(),
  }),
  /**
   * タイトル画面の配置（作者の指摘 2026年10月22日）: ロゴの幅（frameWidth まで）を枠にし、左にメニュー、右にログインの窓を同じ幅（blockWidth まで）で
   * 左右対称に置く。centerGap は真ん中に空ける幅の最小（ピカチュウが歩く）
   */
  titleLayout: z.object({ frameWidth: z.number().positive(), blockWidth: z.number().positive(), centerGap: z.number().nonnegative() }),
  /** ポケモンの一覧（ソロの選択・待合室。作者の案 2026年10月22日）: 1マスの大きさ（低い画面では compact）・まだ解放していないマスの色と黒塗りの色 */
  picker: z.object({
    cell: z.number().int().positive(),
    cellCompact: z.number().int().positive(),
    lockedFill: z.string(),
    silhouette: z.string(),
    selected: z.string(),
  }),
});
export type UiConfig = z.infer<typeof uiConfigSchema>;

/** マップの地面（繰り返しタイル）。時間帯（Wave）ごとに使うタイルをデータで切り替える */
export const groundConfigSchema = z
  .object({
    /** タイル画像の1ドットを画面（ワールド）の何ピクセルで描くか。ポケモンのドット絵の拡大率にそろえる */
    tileScale: z.number().positive(),
    /** タイルが切り替わるとき、新しいタイルへ徐々に変える秒数（0 なら即座に切り替える） */
    fadeSeconds: z.number().nonnegative(),
    /** タイル ID → 画像（public/ からのパス） */
    tiles: z.record(z.string(), z.object({ file: z.string() })),
    /** 区間（data/game/spawn.json の waves と同じ並び・同じ数）ごとのタイル */
    waves: z.array(z.object({ tile: z.string() })).min(1),
  })
  .refine((g) => g.waves.every((w) => w.tile in g.tiles), { message: 'ground の waves に tiles にないタイル ID がある' });
export type GroundConfig = z.infer<typeof groundConfigSchema>;

/** 区間の番号のときに使うタイル ID（区間が足りなければ最後のタイル） */
export function groundTileAt(ground: GroundConfig, wave: number): string {
  return ground.waves[Math.min(wave, ground.waves.length - 1)]!.tile;
}

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
  rank: z.enum(['normal', 'midboss', 'boss', 'legendary']).optional(),
  /** 倒したときに落とす経験値。省略時は pickups.json の xpPerKill（雑魚には時間帯の xpMultiplier を掛ける） */
  xp: z.number().nonnegative().optional(),
  /** 倒したときに落とす道具（中ボスのふしぎなアメ）。経験値の代わり */
  drop: z.enum(['potion', 'magnet', 'rare-candy']).optional(),
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
    /** 1秒あたりの出現数（時間帯で指定が無いとき） */
    spawnPerSecond: z.number().nonnegative(),
    /** 敵が最低数より少ないときに補充する、1秒あたりの数（省略時は 0 = 補充しない） */
    fillPerSecond: z.number().nonnegative().optional(),
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
    /**
     * 敵同士の押し合い（大きさの判定）。重ならないよう押し合い、群れが一点に固まらず画面に広がる。
     * strength は1回で重なりのどれだけを解消するか（1 で全部）、iterations は1回の更新で押し合う回数
     */
    separation: z.object({
      strength: z.number().min(0).max(1),
      maxNeighbors: z.number().int().nonnegative(),
      iterations: z.number().int().positive().optional(),
    }),
    /** 空間ハッシュの格子の大きさ */
    spatialCellSize: z.number().positive(),
    /** 前の時間帯の種類の敵は、離れすぎたら移し替えずに消す（時間帯が進むと前の種類が自然にいなくなる） */
    retireOldWaveKinds: z.boolean(),
    /**
     * 雑魚の HP をプレイヤーのレベル1つごとに何 % 上げるか（作者の決定。2026年10月）。
     * 序盤は最初の技の一撃で倒せる HP にし、強くなった分だけ固くする（時間がたっただけでは固くならない）
     */
    hpPerLevelPct: z.number().nonnegative(),
    /** ジムリーダー（区間の中ボス）を2人倒すごとに、雑魚の HP を何 % 上げるか（作者の指摘「ちょっと余裕すぎる」。2026年10月21日） */
    hpPerTwoGymsPct: z.number().nonnegative().default(0),
    /**
     * 協力プレイで、2人目以降1人につき（作者の指摘「人数に応じた難易度調整が簡単すぎる」。2026年10月21日）:
     * - spawnPct: 出現の速さを何 % 上げるか（上限は capPerPlayer × 人数で増えるので、速さも合わせないと画面が埋まらない）
     * - hpPct: 雑魚の HP を何 % 上げるか
     * - xpSharePct: 雑魚1体の経験値を減らす割合（経験値は全員で共有し、レベルが上がると全員が強化を選ぶので、
     *   倒す数が人数分に増えるとそのまま人数倍の速さで強くなる）。経験値 = 元の値 ÷ (1 + xpSharePct/100 × (人数 − 1))
     */
    perExtraPlayer: z.object({ spawnPct: z.number().min(0), hpPct: z.number().min(0), xpSharePct: z.number().min(0) }).default({ spawnPct: 0, hpPct: 0, xpSharePct: 0 }),
    /**
     * 区間（時間帯）ごとに出す雑魚の種類（data/game/enemies.json の id）。原作の旅の順に並べる。
     * 区間は、その区間の中ボス（data/game/stage.json の gate）を倒すと次へ進む（作者の決定。2026年10月）。
     * 中ボスがいない区間は durationSeconds 後に次へ進む。その時間帯の種類から等しい確率で選ぶ。
     * hpMultiplier はその時間帯に出る敵の HP の倍率（後の時間帯ほど強い = 原作で後に出るポケモンほどレベルが高い感覚）。
     * 同じ種類は続いた時間帯にだけ出せる（一度いなくなった種類は後で戻らない）
     */
    waves: z
      .array(
        z.object({
          /** 中ボスのいない区間の長さ（秒）。この時間がたつと次の区間へ */
          durationSeconds: z.number().positive().optional(),
          hpMultiplier: z.number().positive(),
          /** その時間帯に出る敵の接触ダメージの倍率 */
          damageMultiplier: z.number().positive(),
          /**
           * この時間帯だけ、ボス・スウォームのポケモン（とその進化前）も雑魚に出してよい
           * （作者の決定: 四天王ラッシュでは四天王の手持ちのイワーク・ゴースト・ハクリューも出す）
           */
          allowBossSpecies: z.boolean().optional(),
          /** その時間帯に出る雑魚が落とす経験値の倍率（省略時は 1） */
          xpMultiplier: z.number().positive().optional(),
          /** その時間帯の1秒あたりの出現数と、1人あたりの上限（省略時は全体の値）。後の時間帯ほど増やして群れの圧力を上げる */
          spawnPerSecond: z.number().nonnegative().optional(),
          capPerPlayer: z.number().int().positive().optional(),
          /**
           * 1人あたりの最低数。敵がこれより少なければ fillPerSecond の速さで補充する
           * （ヴァンパイアサバイバーズの「最低数」と同じ考え方。倒し続けても画面が空になりすぎない）
           */
          minimum: z.number().int().nonnegative().optional(),
          kinds: z.array(z.string()).min(1),
        }),
      )
      .min(1),
  })
  .refine((s) => s.spawnDistanceMin <= s.spawnDistanceMax, { message: 'spawnDistanceMin <= spawnDistanceMax' })
  .refine((s) => s.spawnDistanceMax < s.relocateDistance, { message: 'spawnDistanceMax < relocateDistance' })
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

// ---- 実績・ポケモンの解放 ----

/** 条件: 記録（src/meta/runRecorder.ts の名前）が数以上。all（すべて）・any（どれか）で組み合わせる */
export type StatCondition = { stat: string; atLeast: number } | { all: StatCondition[] } | { any: StatCondition[] };
export const statConditionSchema: z.ZodType<StatCondition> = z.lazy(() =>
  z.union([
    z.object({ stat: z.string().min(1), atLeast: z.number().positive() }),
    z.object({ all: z.array(statConditionSchema).min(1) }),
    z.object({ any: z.array(statConditionSchema).min(1) }),
  ]),
);

/**
 * 持ち物の効果（1段階あたり）。% の項目は足し合わせてから掛ける。
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
    /** 技の数（発射数・落雷の数など）に足す数（ポイントマックス） */
    amountBonus: z.number(),
    /** 技の持続の時間 */
    durationPct: z.number(),
  })
  .partial();
export type ModifierData = z.infer<typeof modifierSchema>;

/**
 * 実績（ポケモンの解放も実績に統合した。作者の決定 2026年10月22日）。
 * - 名前と説明は翻訳ファイルの achievement.<id>.name・desc。reward.pokemon の実績は、無ければ決まった文から作る
 * - reward: 達成したときにもらえるもの（pokemon = そのポケモンを解放する）。一覧では、達成するまで名前と報酬を伏せ、条件だけ見せる
 * - hidden は達成するまで条件も隠す（裏実績）。initialPokemon は最初から使えるポケモン
 */
export const achievementRewardSchema = z.object({
  /** そのポケモンを解放する */
  pokemon: z.string().min(1).optional(),
  /** その持ち物が候補に出るようになる（作者の決定 07 24章） */
  item: z.string().min(1).optional(),
  /** コインをもらう */
  coins: z.number().int().positive().optional(),
  /** 特殊なバフ（ショップでは買えない、小さな永続の効果。07 23章） */
  buff: z
    .object({
      /** その系統の最初の技を、このレベルで始める */
      startMoveLevel: z.object({ line: z.string(), level: z.number().int().min(2) }).optional(),
      /** 協力プレイで、部屋の全員の経験値 +% */
      coopXpPct: z.number().positive().optional(),
      /** ふしぎなアメの +3・+5 の重みに足す */
      candyWeight: z.number().positive().optional(),
      /** 持ち物の枠を増やす */
      itemSlots: z.number().int().positive().optional(),
      /** 持ち物と同じ形の効果 */
      mods: modifierSchema.optional(),
      /** 解放したステータスのアイテムを1つ（ランダム）持って始める */
      startStatItem: z.boolean().optional(),
    })
    .optional(),
});
export type AchievementReward = z.infer<typeof achievementRewardSchema>;
export const achievementsConfigSchema = z.object({
  initialPokemon: z.array(z.string().min(1)).min(1),
  /** 最初から候補に出る持ち物（ほかは実績で解放する） */
  initialItems: z.array(z.string().min(1)).min(1),
  achievements: z.array(
    z.object({ id: z.string().min(1), condition: statConditionSchema, hidden: z.boolean().default(false), reward: achievementRewardSchema.optional() }),
  ),
});
export type AchievementsConfig = z.infer<typeof achievementsConfigSchema>;

/** ポケモンの解放（実績の reward.pokemon から作る）。initial は最初から使える */
export interface UnlocksConfig {
  initial: readonly string[];
  unlocks: readonly { pokemon: string; condition: StatCondition }[];
}

// ---- セーブ ----

export const saveConfigSchema = z.object({
  /** ラン中に Firestore へ保存する間隔（書き込み回数を抑えるため、まとめて保存する） */
  autosaveSeconds: z.number().positive(),
  /** 引き継ぎコードの有効期限（時間。作者の決定 2026年10月22日: 24時間）。firestore.rules の上限（25時間）より短くする */
  transferHours: z.number().positive().max(24),
});
export type SaveConfig = z.infer<typeof saveConfigSchema>;

// ---- ステージ（ランの長さ・中ボス・ボス） ----

/**
 * ボス・伝説の範囲技（01_game_design.md 2.2）。範囲を予告し、telegraphSeconds 後にその範囲へダメージを与える。
 * 当たったかは受けたプレイヤーのブラウザで判定する（2.3）。
 * - shape: circle（円。radius が半径）・line（直線。radius が幅の半分、length が長さ）
 * - target: player（一番近いプレイヤーを狙う。円は足元と周りに count 個）・self（自分の周り・自分から向かう直線）
 * - dashSpeed: 直線の技で、落ちたときにボスが線に沿って突進する
 * 伝説ごとの技（作者の決定 2026年10月23日。案4）のための部品:
 * - shape: ring（輪。radius が外側の半径、rings.width が太さ）。target: self の rings で、外へ広がる輪を count 本、stagger 秒ずつ遅らせて出す
 * - stagger: 2つ目以降の範囲を、1つごとにこの秒数だけ遅らせて落とす（次々に降る）
 * - teleport: 予告の場所（狙ったプレイヤーの後ろ spread の距離）へ、落ちたときにボスが瞬間移動する
 * - leaves: 落ちた場所に、しばらく残る床を置く（slowPct で上にいるプレイヤーが遅くなる・damagePerSecond で削られる）。直線は線に沿って並べる
 */
export const bossMoveSchema = z.object({
  id: z.string().min(1),
  /** 技の名前に使う PokeAPI の技のキー（表示しない技は省略） */
  move: z.string().min(1).optional(),
  /** 範囲に落ちたときの演出（data/effects/recipes.json） */
  effect: z.string().min(1),
  shape: z.enum(['circle', 'line', 'ring']).default('circle'),
  target: z.enum(['player', 'self']).default('player'),
  telegraphSeconds: z.number().positive(),
  radius: z.number().positive(),
  length: z.number().positive().optional(),
  damage: z.number().nonnegative(),
  /** 1回に落とす範囲の数（target: player の円） */
  count: z.number().int().positive().default(1),
  /** 狙ったプレイヤーの位置からのばらつき（2つ目以降の範囲） */
  spread: z.number().nonnegative().default(0),
  dashSpeed: z.number().positive().optional(),
  /** 突進のあと、続けてもう一度狙い直して突進する回数（伝説。作者の決定 2026年10月23日） */
  chain: z.number().int().nonnegative().optional(),
  /** じばく: 予告した敵（ビリリダマ）は止まり、落ちたときにいなくなる */
  selfDestruct: z.boolean().optional(),
  stagger: z.number().nonnegative().optional(),
  rings: z.object({ count: z.number().int().positive(), step: z.number().nonnegative(), width: z.number().positive() }).optional(),
  teleport: z.boolean().optional(),
  leaves: z
    .object({
      seconds: z.number().positive(),
      slowPct: z.number().min(0).max(90).default(0),
      damagePerSecond: z.number().nonnegative().default(0),
      /** 床の色（#rrggbb） */
      color: z.string(),
    })
    .optional(),
});
export type BossMove = z.infer<typeof bossMoveSchema>;

/**
 * スウォームイベント（作者の決定。2026年10月）: 冗長なプレイにならないよう、気を付けないといけない群れを定期的に出す。
 * - rush: 画面の外から、まっすぐ高速で横切る群れ（count 体が spacing の間隔で並ぶ。プレイヤーを追わない）
 * - encircle: プレイヤーの周り（radius）にぐるりと出て、ゆっくり囲んでくる群れ
 * - bomber: 画面の外から count 体が転がってきて、プレイヤーに triggerRange まで近づくと、その場で
 *   範囲技 move（じばく）を予告して爆発する（作者の決定。ビリリダマ。プレイヤーより速いので自然と追いつかれる）
 */
export const swarmSchema = z.object({
  atSeconds: z.number().nonnegative(),
  everySeconds: z.number().positive(),
  untilSeconds: z.number().positive(),
  kind: z.string().min(1),
  pattern: z.enum(['rush', 'encircle', 'bomber']),
  count: z.number().int().positive(),
  spacing: z.number().positive().optional(),
  speed: z.number().positive().optional(),
  radius: z.number().positive().optional(),
  /** bomber: 爆発を始める距離と、使う範囲技（moves の id） */
  triggerRange: z.number().positive().optional(),
  move: z.string().optional(),
});
export type SwarmConfig = z.infer<typeof swarmSchema>;

export const stageConfigSchema = z.object({
  /**
   * ランの長さ（制限時間）。required の付いたボス（四天王）がこの時間までに全員倒れていなければ失敗。
   * 全員倒した時点でクリア（報酬はこの時点で確定）
   */
  durationSeconds: z.number().positive(),
  /**
   * 中ボス（rank: midboss）・ボス（rank: boss）を出す予定。区間（data/game/spawn.json の waves の番号）が始まって
   * afterSeconds 後に出す。gate の付いた敵を倒すと次の区間へ進む。moves は使う範囲技（moves の id）を順に使う
   */
  bosses: z.array(
    z.object({
      wave: z.number().int().nonnegative(),
      afterSeconds: z.number().nonnegative(),
      /** 倒すと次の区間へ進む（ジムリーダーの相棒） */
      gate: z.boolean().default(false),
      kind: z.string().min(1),
      moves: z.array(z.string()).default([]),
      moveIntervalSeconds: z.number().positive().optional(),
      /** 倒すとクリアに必要（四天王） */
      required: z.boolean().default(false),
    }),
  ),
  /** 範囲技の定義 */
  moves: z.array(bossMoveSchema),
  /** クリア後の伝説の乱入。null なら無し */
  legendary: z
    .object({
      /** 乱入する確率（0〜1） */
      chance: z.number().min(0).max(1),
      /** 候補（rank: legendary）。1匹を選ぶ */
      kinds: z.array(z.string().min(1)).min(1),
      moves: z.array(z.string()).min(1),
      /** 伝説ごとの技（作者の決定 2026年10月23日。案4）。無い伝説は moves を順に使う。random なら毎回ランダムに選ぶ（ミュウ） */
      moveSets: z.record(z.string(), z.object({ moves: z.array(z.string()).min(1), random: z.boolean().default(false) })).default({}),
      moveIntervalSeconds: z.number().positive(),
      /** 「DANGER」の表示から出現までの時間 */
      warningSeconds: z.number().nonnegative(),
      /** この時間で倒せなければ、逃げられて終わる（クリアは確定済み） */
      timeLimitSeconds: z.number().positive(),
      /** 第2段階（作者の決定 2026年10月23日）: HP が hpRatio を切ったら「DANGER」をもう一度出し、技の間隔を短くし、doubleChance の確率で2つの技を同時に使う */
      enrage: z.object({ hpRatio: z.number().gt(0).lt(1), moveIntervalSeconds: z.number().positive(), doubleChance: z.number().min(0).max(1) }).optional(),
    })
    .nullable(),
  swarms: z.array(swarmSchema).default([]),
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
 * - screen: range の中の近い敵 count 体の足元に、同時に当たり判定を置く（画面じゅうの敵へ。ぜったいれいど・たたりめ など）
 * - metronome: 使うたびに、ほかの技からランダムに1つを、その技の最大レベルで出す（ゆびをふる。ミュウ）
 * 技の「型」（作者の決定。07_content_draft.md 18章。ヴァンパイアサバイバーズの武器のように、技ごとに長所と短所をはっきりさせる）:
 * - whip（横なぎ）: 左右へとても長い直線で払う（向いている側から。count 2 で反対側、3・4 で上下も、5〜8 で斜めも）
 * - lob（放物線）: 上へ投げ、重さで弧を描いて落ちる（貫通。近くの敵に当てにくい）
 * - strike（落雷）: range の中のランダムな敵 count 体の足元に、同時に当たり判定を置く
 * - chain（連鎖）: 一番近い敵から、近くの敵へ count 回飛び移る線（range の半分まで跳ぶ）
 * - bounce（跳ね返り）: ランダムな方向へ飛び、自分の周りの画面くらいの範囲（range × 0.56 の高さ）の端で跳ね返る
 * - trail（足あと）: 歩いていると、自分の足元にしばらく残る当たり判定を置く（止まっていると出ない）
 * - cross（十字）: 向いている方向から等しい角度で count 方向へ同時に撃つ（4 で十字、8 で全方向）
 * - scatter（水たまり）: 自分の周り range の中のランダムな場所に、しばらく残る当たり判定を置く
 * - spin（回転）: 自分のまわりに開き arcDegrees の扇形を、使うたびに時計回りへ arcDegrees ずつずらして出す（count 枚を等しい角度で。
 *   2 枚は向かい合わせ、3 枚は正三角形と逆三角形の向きが交互になる）。再使用が短いほど速く回る（こうそくスピン。作者の決定 2026年10月23日）
 * - eruption（爆炎の柱）: 自分を中心に count 方向へ、円の柱を stages 段に分けて、interval ごとに外へ向かって順に出す。
 *   いちばん外の段が range の距離。外の段ほど半径が sizeGrowth の割合ずつ大きい（ブラストバーン。作者の決定 2026年10月23日）
 */
export const MOVE_PATTERNS = [
  'nearest',
  'facing',
  'melee',
  'orbit',
  'beam',
  'boomerang',
  'ground',
  'nova',
  'homing',
  'screen',
  'metronome',
  'whip',
  'lob',
  'strike',
  'chain',
  'bounce',
  'trail',
  'cross',
  'scatter',
  'stream',
  'eruption',
  'spin',
] as const;
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
  /** この技だけの急所の確率（%。持ち物・パッシブの急所に足す。はっぱカッター・ストーンエッジなど） */
  critChancePct: z.number().nonnegative().default(0),
  /** 雑魚を一撃で倒す確率（0〜1。じわれ。中ボス・ボス・伝説には効かない） */
  instakillChance: z.number().min(0).max(1).default(0),
  /**
   * 近接（melee）の当たり判定を、自分を中心にした扇形にする角度（度）。0 なら今までどおり前に置く円。
   * 扇の半径は range + size。360 で自分の周り全部（たいあたり → のしかかり は扇が全方向に広がる）
   */
  arcDegrees: z.number().min(0).max(360).default(0),
  /** 状態異常の敵へのダメージを何 % 上げるか（たたりめ） */
  statusBonusPct: z.number().nonnegative().default(0),
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
    critChancePct: z.number(),
    instakillChance: z.number(),
    arcDegrees: z.number(),
    statusBonusPct: z.number(),
  })
  .partial();
export type MoveLevelDelta = z.infer<typeof moveLevelDeltaSchema>;

const fxSize = { sizeMultiplier: z.number().positive(), powerMultiplier: z.number().nonnegative() };
/**
 * 技の「効き方」（07_content_draft.md 22.4）。trigger で起こるときを決め、部品を組み合わせる。
 * - trigger: cast（技を使ったとき。自分の位置・向いている方向）、hit（当たり判定が初めて敵に当たったとき。当たった敵の位置）、
 *   end（当たり判定が消えたとき・落ちたとき。その位置）、every（当たり判定が残っている間 everySeconds ごと。その位置。
 *   流れ stream は流れが最初に当たる敵の位置）
 * - 大きさ・威力は、もとの当たり判定の大きさ（半径）・威力に掛ける倍率
 * - eachHit: 当たった敵ごとに（その敵の位置で）起こす（かみなり: 落雷を受けた敵それぞれから電気が連鎖する）
 */
export const moveEffectSchema = z.object({
  trigger: z.enum(['cast', 'hit', 'end', 'every', 'eachHit']),
  everySeconds: z.number().positive().optional(),
  /** 起こる確率（0〜1。省略で必ず） */
  chance: z.number().min(0).max(1).optional(),
  /** 爆発: その場で弾ける円。delaySeconds があれば、印を置いて少し後に弾ける。pull は中心へ引き寄せる強さ */
  explode: z.object({ ...fxSize, delaySeconds: z.number().positive().optional(), pull: z.number().positive().optional() }).optional(),
  /**
   * 残る範囲（炎・水たまり・毒）。直線の当たり判定なら alongSpacing ごとに線に沿って並べる。
   * path なら円を置かず、通った道そのものを範囲にする（ビームは線1本。every で呼ぶ動く技は、通った道を線でつなぐ）
   */
  puddle: z
    .object({
      ...fxSize,
      durationSeconds: z.number().positive(),
      hitIntervalSeconds: z.number().positive(),
      alongSpacing: z.number().positive().optional(),
      path: z.boolean().optional(),
    })
    .optional(),
  /** 分裂: 小さな弾が飛び散る（spreadDegrees は向きを中心にした広がり。360 で全方向） */
  split: z
    .object({
      ...fxSize,
      count: z.number().int().positive(),
      speed: z.number().positive(),
      durationSeconds: z.number().positive(),
      spreadDegrees: z.number().positive().default(360),
      boomerang: z.boolean().default(false),
    })
    .optional(),
  /** 連鎖: その場から近くの敵へ count 回飛び移る */
  chain: z.object({ ...fxSize, count: z.number().int().positive(), range: z.number().positive() }).optional(),
  /** 周回: 自分の周りを回る当たり判定（speed は 度/秒） */
  orbit: z
    .object({ ...fxSize, count: z.number().int().positive(), radius: z.number().positive(), speed: z.number(), durationSeconds: z.number().positive(), hitIntervalSeconds: z.number().positive() })
    .optional(),
  /** 突き出す: その場から count 方向へ、しばらく残る直線 */
  spikes: z
    .object({ ...fxSize, count: z.number().int().positive(), length: z.number().positive(), durationSeconds: z.number().positive(), hitIntervalSeconds: z.number().positive() })
    .optional(),
  /** 波: その場から radius まで広がる輪 */
  wave: z.object({ powerMultiplier: z.number().nonnegative(), radius: z.number().positive(), durationSeconds: z.number().positive() }).optional(),
});
export type MoveEffect = z.infer<typeof moveEffectSchema>;

export const moveDefSchema = z.object({
  pattern: z.enum(MOVE_PATTERNS),
  /** 見た目のレシピ（data/effects/recipes.json のキー） */
  effect: z.string(),
  /** レベル1の性能 */
  base: moveStatsSchema,
  /** レベル2以降で足す量。最大レベルは levels の数 + 1 */
  levels: z.array(moveLevelDeltaSchema),
  /**
   * 自分の体で攻撃する技（たいあたり・でんこうせっか など）の見た目: 使うたびに、向いている方向へ一瞬
   * lungeDistance だけ体を出して戻す。afterimages があれば、その数の残像を前方に残す（でんこうせっか）
   */
  body: z.object({ lungeDistance: z.number().positive(), afterimages: z.number().int().nonnegative().default(0) }).optional(),
  /** eruption（爆炎の柱）の段の数と、外の段ほど半径を大きくする割合（1段ごと） */
  eruption: z.object({ stages: z.number().int().positive(), sizeGrowth: z.number().nonnegative() }).optional(),
  /** 「効き方」の部品（07_content_draft.md 22.4）。進化するたびに増やす */
  effects: z.array(moveEffectSchema).optional(),
  /** 飛ぶ弾が曲がる速さ（度/秒）。十字・向いている方向の弾が渦を巻くように回る（ふぶき・エアスラッシュ） */
  curve: z.number().optional(),
  /**
   * 外へ進む攻撃（たいあたり・のしかかり・じしん）: 当たり判定を、中心から外へ進む帯にする（内側は当たらない）。
   * 値は帯の厚さで、届く距離いっぱいに対する割合。近接（扇形・自分の周り）と広がる輪（nova）で使う
   */
  sweep: z.number().gt(0).max(1).optional(),
  /** 跳ね返る技（bounce）を出す向き: 向いている方向から何度ずらすか（まっすぐだと、向かいの壁との間で同じ線を往復するだけになる） */
  bounceAngle: z.number().optional(),
});
export type MoveDefData = z.infer<typeof moveDefSchema>;

/** 技の定義。キーは PokeAPI の技の名前（タイプ・分類・名前は data/generated/moves.json から） */
export const movesConfigSchema = z.object({ moves: z.record(z.string(), moveDefSchema) });
export type MovesConfig = z.infer<typeof movesConfigSchema>;

/** プレイアブルのポケモン。キーは PokeAPI のポケモンの名前 */
/**
 * 公式サイト（作者の相談 2026年10月22日。広告付きのページへの埋め込み・丸ごとコピーへの対策）。
 * officialUrl はタイトルの下と注意の画面に出す公式のアドレス。公開版は、allowedHosts のどれか、
 * または allowedHostSuffixes のどれかで終わるアドレス（Cloudflare の開発用アドレスと、その版ごとのプレビュー）でだけ動く
 */
export const siteConfigSchema = z.object({
  officialUrl: z.string().url(),
  allowedHosts: z.array(z.string()).min(1),
  allowedHostSuffixes: z.array(z.string()).default([]),
});

/**
 * 地方（マップの選択。作者の案 2026年10月22日）: 遊ぶ前に地方を選び、地方ごとにプレイアブルと出てくるポケモンを変える。
 * 並びはマップの選択の順。available が false の地方は「Coming soon」で選べない
 */
export const regionsConfigSchema = z.object({
  regions: z
    .array(
      z.object({
        /** PokeAPI の地方のキー（名前は data/generated/regions.json） */
        id: z.string(),
        available: z.boolean(),
        /** この地方で選べるプレイアブル（playables.json のキー）。遊べる地方だけ */
        playables: z.array(z.string()).default([]),
      }),
    )
    .min(1),
});
export type RegionsConfig = z.infer<typeof regionsConfigSchema>;

export const playablesConfigSchema = z.object({
  pokemon: z.record(
    z.string(),
    z.object({
      /** スプライトのキー（public/sprites/<key>） */
      sprite: z.string(),
      /** 最初に覚えている技 */
      startingMoves: z.array(z.string()).min(1),
      /** false なら進化しない（ピカチュウ: 原作へのオマージュで、ライチュウにならずボルテッカーを覚える） */
      evolves: z.boolean().default(true),
      /**
       * 解放の名前（data/game/achievements.json の reward.pokemon）。省略時はこのキー。
       * 解放したポケモンは進化前の姿から始めるので、ヒトデマンはスターミーの解放で遊べるようになる
       */
      unlock: z.string().optional(),
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
  /**
   * 技の演出をドット絵に合わせる（WebGL のときだけ）。演出をまとめて描いた後で、
   * size（ワールドの長さ。スプライトの拡大率と同じにすると1ドットがそろう）ごとの四角に区切り、
   * 色と透明度を colorSteps・alphaSteps 段階に減らす。size 0 で使わない
   */
  /**
   * 見える範囲（作者の決定 2026年10月22日。07 25.3 の B 案）: 見えるワールドの縦の広さを、どの端末でも viewHeight にそろえる。
   * 横は端末の比率に合わせて広げるが、maxAspect（横 ÷ 縦。16:9）まで。それより横長の画面は、左右を黒い帯にする
   */
  camera: z.object({ viewHeight: z.number().positive(), maxAspect: z.number().positive() }),
  effectPixel: z.object({
    size: z.number().int().nonnegative(),
    colorSteps: z.number().int().min(2),
    alphaSteps: z.number().int().min(2),
  }),
  /**
   * 技の当たり判定の形（作者の指摘。2026年10月21日）。グラデーションではなく、当たり判定の形を平らに塗る（外周の線は引かない。2026年10月22日）。
   * pixel は角ばったドットにするフィルターの大きさ、fillAlpha は塗りの不透明度。moves を書くとその技だけ（試すとき）、省略で全部
   */
  /**
   * 重なりの順（大きいほど手前。作者の決定 2026年10月22日、23日に変更: プレイヤー ＞ ボス ＞ 技 ＞ 雑魚 ＞ アイテム）。
   * 敵は種類ごとに enemies + 0.1 × 層（群れ 1）。中ボス・ボス・伝説は bosses（技より手前）。技は hitShapes（範囲の塗り）と effects（光。軌跡は -0.5、当たりのはじけは +1）。
   * candy はふしぎなアメの箱と当たりの演出（プレイヤーより手前）
   */
  depths: z.object({
    obstacles: z.number(),
    gems: z.number(),
    items: z.number(),
    enemies: z.number(),
    bosses: z.number(),
    hazards: z.number(),
    hitShapes: z.number(),
    effects: z.number(),
    players: z.number(),
    candy: z.number(),
  }),
  hitShape: z.object({
    pixel: z.number().int().nonnegative(),
    fillAlpha: z.number().min(0).max(1),
    /** 近接の扇形は、弧の近くの帯だけを描く。帯の太さ（半径に対する割合。作者の指摘 2026年10月22日） */
    sectorBand: z.number().gt(0).max(1).default(0.3),
    /** 開きがこれより狭い扇形は、帯ではなく全体を塗る（かえんほうしゃのような細長い炎。作者の指摘 2026年10月23日） */
    sectorFullBelowDegrees: z.number().nonnegative().default(60),
    moves: z.array(z.string()).optional(),
  }),
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
      /** 範囲の塗りの濃さ（省略で sprites.json の hitShape.fillAlpha）。暖色を草の上に薄く重ねると茶色く濁るので、炎の噴射は濃くする */
      shapeAlpha: z.number().min(0).max(1).optional(),
      /** 光の明滅 */
      pulse: z.object({ amount: z.number().nonnegative(), periodMs: z.number().positive() }).optional(),
    })
    .optional(),
  /**
   * 持ち主の残像として飛ぶ（ゴッドバード）: 発射体の芯の代わりに、持ち主のポケモンの姿を薄く描く。
   * afterimages は後ろに連ねる残像の数、spacingTicks はその間隔（更新回数ぶんの移動）
   */
  ownerGhost: z
    .object({ tint: colorString, alpha: z.number().min(0).max(1), afterimages: z.number().int().nonnegative(), spacingTicks: z.number().positive() })
    .optional(),
  /**
   * 効き方から出た円の範囲（10まんボルトの自分の周りの電気）を、色を切り替えて光らせる。
   * colors を periodMs ごとに順に使い、塗りの濃さは alpha
   */
  /** 落雷の見た目: 当たり判定が出てから seconds の間、上から稲妻を落とす（かみなり）。height は稲妻の長さ、width は太さ */
  bolt: z.object({ color: colorString, glowColor: colorString, height: z.number().positive(), width: z.number().positive(), seconds: z.number().positive() }).optional(),
  burstFlash: z.object({ colors: z.array(colorString).min(1), periodMs: z.number().positive(), alpha: z.number().min(0).max(1) }).optional(),
  /** 発射体の軌跡に出すパーティクル */
  trail: particleSchema.extend({ intervalMs: z.number().positive() }).optional(),
  /** 命中時 */
  impact: z
    .object({
      burst: particleSchema.extend({ count: z.number().int().nonnegative() }).optional(),
      flash: z
        .object({ color: colorString, radius: z.number().positive(), durationMs: z.number().positive(), alpha: z.number().min(0).max(1) })
        .optional(),
      // 画面を揺らす演出は使わない（具合が悪くなる人がいたため。作者の決定 2026年10月21日）
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

/**
 * 届いた位置をなめらかに見せる（作者の指摘「ゲストで敵も味方もワープする」。03_network.md 6.4）。
 * - 相手のプレイヤー: 届いた位置から、押している方向へ predictTicks 回分まで先に進めた位置を目標にし、毎回 playerBlend の割合で寄せる
 * - 敵の位置の補正: ずれを一度に直さず、毎回 enemyBlend の割合ずつ寄せる
 * - ずれが snapDistance を超えたら（移し替え・復活など）一度に合わせる
 */
export const netSmoothingSchema = z.object({
  playerBlend: z.number().gt(0).max(1),
  predictTicks: z.number().int().nonnegative(),
  enemyBlend: z.number().gt(0).max(1),
  snapDistance: z.number().positive(),
});
export type NetSmoothing = z.infer<typeof netSmoothingSchema>;

export const networkConfigSchema = z.object({
  /** WebRTC の接続に使う STUN サーバー */
  iceServers: z.array(z.object({ urls: z.union([z.string(), z.array(z.string())]) })),
  /** この時間内に直接つながらなければ Realtime Database の中継に切り替える */
  p2pTimeoutMs: z.number().int().positive(),
  p2p: syncRateSchema,
  /** 中継時は送る頻度を下げ、まとめて書き込む（通信量と書き込み回数を抑える） */
  relay: syncRateSchema.extend({ flushIntervalMs: z.number().int().positive() }),
  /** 往復時間を測る間隔（更新回数） */
  pingIntervalMs: z.number().int().positive(),
  /**
   * 相手からこの秒数なにも届かなければ、切断したものとみなす（タブを閉じた・回線が切れたときに、
   * Realtime Database の切断の知らせが遅れても気づけるように）。往復時間の計測を実際の時間で送るので、
   * レベルアップで止まっている間も通信は途切れない
   */
  silenceTimeoutSeconds: z.number().positive(),
  /** ゲストの出現位置（ホストからの横のずれ。プレイヤーの番号ごとにずらす） */
  guestSpawnOffsetX: z.number(),
  /** 部屋の最大人数（ホストを含む） */
  maxPlayers: z.number().int().min(2),
  smoothing: netSmoothingSchema,
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
  /** マップに落ちる道具（きずぐすり・マグネット・ふしぎなアメ）の当たりの大きさと、同時に落ちている数の上限 */
  itemRadius: z.number().positive(),
  maxItems: z.number().int().positive(),
  items: z.object({
    /** 雑魚を倒したときに落とす確率（1体あたり）と、回復する量（最大HPの %） */
    potion: z.object({ dropChance: z.number().min(0).max(1), healPct: z.number().positive() }),
    /** 雑魚を倒したときに落とす確率と、玉を吸い寄せる速さ */
    magnet: z.object({ dropChance: z.number().min(0).max(1), speed: z.number().positive() }),
    /** 中ボスが落とす。上がるレベルの数とその重み、抽選の演出の時間 */
    'rare-candy': z.object({
      revealSeconds: z.number().nonnegative(),
      /** 当たりを見せてからレベルアップの選択を出すまでの時間（すぐ選択の画面が出ると、何レベル分の当たりか見えないため。作者の指摘 2026年10月21日） */
      holdSeconds: z.number().nonnegative(),
      levels: z.array(z.object({ levels: z.number().int().positive(), weight: z.number().positive() })).min(1),
    }),
  }),
});
export type PickupConfig = z.infer<typeof pickupConfigSchema>;

// ---- PokeAPI から生成するデータ（data/generated/。scripts/fetch-pokeapi.ts） ----

export const pokeapiTargetsSchema = z.object({
  pokemon: z.array(z.string()),
  moves: z.array(z.string()),
  items: z.array(z.string()),
  /** 地方（名前だけ。マップの選択で使う） */
  regions: z.array(z.string()),
});

/** 名前（PokeAPI の各言語）。ヨーロッパの言語は、無ければ英語を使う */
const localizedNames = z.object({
  ja: z.string().min(1),
  en: z.string().min(1),
  fr: z.string().min(1).optional(),
  de: z.string().min(1).optional(),
  es: z.string().min(1).optional(),
  it: z.string().min(1).optional(),
});
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
  /** 進化前（系統の根から順に。ピカチュウなら ["pichu"]）。取得していない段階も含む */
  preEvolutions: z.array(z.string()).default([]),
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
export const generatedRegionsSchema = z.record(z.string(), z.object({ names: localizedNames }));

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
  /** 候補を選ぶときの技の重み（持ち物を1とする） */
  moveOfferWeight: z.number().positive(),
  /**
   * 候補が1つも無いとき（技も持ち物も強化しきった・枠が埋まった）に出すもの（作者の決定 2026年10月23日）:
   * 最大HP の healPct % 回復、またはコインを coins 枚
   */
  fallback: z.object({ healPct: z.number().positive(), coins: z.number().int().positive() }),
});
export type LevelingConfig = z.infer<typeof levelingConfigSchema>;



const upgradeDefSchema = z.object({
  /** 種類（07_content_draft.md 21.2）: stat = ステータスのアイテム、type = タイプのアイテム（自分のタイプとノーマルだけ候補に出る）、evolution = 進化の道具など */
  category: z.enum(["stat", "type", "evolution"]),
  maxLevel: z.number().int().positive(),
  /** 進化・派生に使うとなくなる（進化の石・つながりのヒモ） */
  consumable: z.boolean().default(false),
  perLevel: modifierSchema,
  /** この系統（data/game/playables.json のキー）だけが持てる（でんきだま = ピカチュウ） */
  lines: z.array(z.string()).optional(),
  /** 持っているあいだ、技の威力に掛ける倍率（でんきだま 2） */
  powerMultiplier: z.number().positive().optional(),
  /** 今の姿がこのどれかのときだけ持てる（でんきだま = 進化していないピカチュウ。PokeAPI のポケモンの名前） */
  forms: z.array(z.string()).optional(),
  /** 一緒に持てない持ち物（でんきだま と かみなりのいし: ライチュウに進化するか、ピカチュウのまま強くするかを選ぶ） */
  excludes: z.array(z.string()).optional(),
});

/** 持ち物。キーは PokeAPI の持ち物の名前 */
export const itemsConfigSchema = z.object({ items: z.record(z.string(), upgradeDefSchema) });
export type ItemsConfig = z.infer<typeof itemsConfigSchema>;

/**
 * フレンドリィショップ（永続強化。01_game_design.md 8.3）。少し有利になる程度にとどめる。
 * - coins: ラン終了時のコイン（生きていた秒数・自分が倒した数ごと、中ボス・四天王（全員）、クリア、伝説）
 * - upgrades: perLevel はパッシブと同じ形の効果。grants は効果の代わりに増える回数（復活・リロール・候補の除外）
 *   費用は baseCost × 次のレベル。名前と説明は翻訳ファイルの shop.<id>.name・desc
 */
export const shopConfigSchema = z.object({
  coins: z.object({
    perSecondsSurvived: z.number().positive(),
    perKills: z.number().positive(),
    midboss: z.number().nonnegative(),
    boss: z.number().nonnegative(),
    clear: z.number().nonnegative(),
    legendary: z.number().nonnegative(),
  }),
  upgrades: z.array(
    z.object({
      id: z.string().min(1),
      maxLevel: z.number().int().positive(),
      baseCost: z.number().int().positive(),
      perLevel: modifierSchema.optional(),
      /** 効果の代わりに増えるもの（復活・リロール・除外の回数、もらえるコインの %）。amount は1レベルあたり（省略時は 1） */
      grants: z.enum(['revives', 'rerolls', 'bans', 'coinPct']).optional(),
      amount: z.number().positive().optional(),
    }),
  ),
  /** 前の版の強化（今は無いもの）の基本の費用。起動時に、使ったコインを全額返して消す */
  legacyBaseCosts: z.record(z.string(), z.number().int().positive()).default({}),
});
export type ShopConfig = z.infer<typeof shopConfigSchema>;

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
      /** このレベル以上でないと覚えられない（ボルテッカー: レベル50を超える） */
      minLevel: z.number().int().positive().optional(),
      /** 今の姿がこのどれかのときだけ覚えられる（かみなり = ライチュウ。PokeAPI のポケモンの名前） */
      forms: z.array(z.string()).optional(),
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
    /**
     * 復活: 全員で共有する回数の初期値・復活時の HP（最大の %）・無敵時間。
     * 協力プレイでは、倒れた味方の touchRange 以内に touchSeconds いると復活させられる
     */
    revive: z.object({
      initialCount: z.number().int().nonnegative(),
      hpPct: z.number().positive(),
      invincibleSeconds: z.number().nonnegative(),
      touchSeconds: z.number().positive(),
      touchRange: z.number().positive(),
    }),
  })
  .refine((s) => s.rankMultipliers.length === s.rankThresholds.length + 1, { message: 'rankMultipliers は rankThresholds より1つ多くする' });
export type StatsConfig = z.infer<typeof statsConfigSchema>;

// ---- 音（効果音・BGM。作者の決定: 効果音はコードで鳴らす 8bit 音、BGM は作者が用意したファイル） ----

/** 効果音の1つの音の部品。from → to へ音の高さを動かしながら、duration 秒鳴らす */
export const sfxPartSchema = z.object({
  /** square（矩形波。duty で音色）・triangle（三角波）・sawtooth（のこぎり波）・noise（雑音。from は雑音を削る周波数） */
  wave: z.enum(['square', 'triangle', 'sawtooth', 'noise']),
  from: z.number().positive(),
  to: z.number().positive().optional(),
  duration: z.number().positive(),
  /** 鳴らし始めを遅らせる秒数（和音・アルペジオ） */
  delay: z.number().nonnegative().default(0),
  volume: z.number().min(0).max(1).default(0.5),
  /** 矩形波の幅（0.125・0.25・0.5。ファミコンの音色） */
  duty: z.number().min(0.05).max(0.5).default(0.5),
});
export type SfxPart = z.infer<typeof sfxPartSchema>;

export const sfxConfigSchema = z.object({
  /** 全体の音量（設定の音量に掛ける） */
  volume: z.number().min(0).max(1),
  /** 同時に鳴らす音の上限（たくさん倒しても音が割れないように） */
  maxVoices: z.number().int().positive(),
  sounds: z.record(
    z.string(),
    z.object({
      /** 同じ音を続けて鳴らすまでの最短の間隔（ミリ秒） */
      minIntervalMs: z.number().nonnegative().default(0),
      parts: z.array(sfxPartSchema).min(1),
    }),
  ),
});
export type SfxConfig = z.infer<typeof sfxConfigSchema>;

/**
 * BGM（作者が用意した音声ファイル。public/ からのパス）。ファイルが無い曲は鳴らさない（エラーにしない）。
 * scenes は画面ごと、run.sections は区間（data/game/spawn.json の waves）ごとの曲。null は無音
 */
export const bgmConfigSchema = z.object({
  /** 曲が変わるときに、前の曲を小さくして次の曲を大きくする秒数 */
  fadeSeconds: z.number().nonnegative(),
  tracks: z.record(
    z.string(),
    z.object({
      /** 作者が用意したファイル（public/ からのパス）。score より先に使う */
      file: z.string().optional(),
      /** コードで鳴らす曲（data/audio/music/<score>.json）。ファイルが無いときに使う */
      score: z.string().optional(),
      volume: z.number().min(0).max(1).default(1),
      /** 出典と利用条件（クレジットに出す） */
      credit: z.string().default(''),
    }),
  ),
  scenes: z.object({ title: z.string().nullable(), result: z.string().nullable() }),
  run: z.object({
    sections: z.array(z.string().nullable()),
    /** 伝説戦 */
    legendary: z.string().nullable(),
  }),
});
export type BgmConfig = z.infer<typeof bgmConfigSchema>;

/**
 * コードで鳴らす 8bit の曲（楽譜）。1つの記号が1ステップ（stepsPerBeat で1拍を分ける）。
 * 音符は C4・F#5・Bb3 のように書き、"-" で前の音を伸ばし、"." で休む。drums は k（バスドラム）・s（スネア）・h（ハイハット）・"."。
 * patterns をつないだ順（order）で1曲になり、最後まで行ったら最初に戻る（ループ）
 */
export const musicScoreSchema = z.object({
  bpm: z.number().positive(),
  stepsPerBeat: z.number().int().positive(),
  channels: z.record(
    z.string(),
    z.object({
      wave: z.enum(['square', 'triangle', 'sawtooth', 'noise']),
      duty: z.number().min(0.05).max(0.5).default(0.5),
      volume: z.number().min(0).max(1),
    }),
  ),
  patterns: z.record(z.string(), z.record(z.string(), z.string())),
  order: z.array(z.string()).min(1),
});
export type MusicScore = z.infer<typeof musicScoreSchema>;

/**
 * 自作のドット絵（道具・アメの箱など）。1文字が1ドット（"." は透明）、色は palette。dot は1ドットのワールドの長さ。
 * candyBurst は、ふしぎなアメで上がるレベルの数ごとに、箱からあふれ出るアメの数（作者の決定: +1 ちょっと・+3 たくさん・+5 大量）と、箱の上に出す「+N」の見た目
 */
export const pixelSpritesSchema = z
  .object({
    dot: z.number().positive(),
    /** #rrggbb（#rrggbbaa で半透明。影など） */
    palette: z.record(z.string().length(1), z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/)),
    sprites: z.record(z.string(), z.array(z.string()).min(1)),
    candyBurst: z
      .array(
        z.object({
          levels: z.number().int().positive(),
          count: z.number().int().positive(),
          /** 箱の上に出す「+N」の色と文字の大きさ（当たりの大きさが一目で分かるように。作者の指摘 2026年10月21日） */
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
          fontSize: z.number().positive(),
        }),
      )
      .min(1)
      .optional(),
  })
  .superRefine((d, ctx) => {
    for (const [name, rows] of Object.entries(d.sprites)) {
      if (rows.some((r) => r.length !== rows[0]!.length)) ctx.addIssue({ code: 'custom', message: `ドット絵 ${name} の行の長さがそろっていません` });
      for (const ch of rows.join('')) if (ch !== '.' && !d.palette[ch]) ctx.addIssue({ code: 'custom', message: `ドット絵 ${name} の色 "${ch}" が palette にありません` });
    }
  });
export type PixelSpritesConfig = z.infer<typeof pixelSpritesSchema>;

/**
 * マップの障害物（作者の決定: 通り抜けられない。プレイヤーも敵も技も遮る。少なく置いて、まっすぐ進むだけの単調なプレイを崩す）。
 * 地面を cellSize のマスに区切り、マスごとに chance で1つ置く。sections は区間（spawn.json の waves）ごとの見た目の種類
 * （data/render/obstacles.json のドット絵のキー）。場所は区間によらず同じで、見た目だけが変わる
 */
export const obstacleConfigSchema = z.object({
  cellSize: z.number().positive(),
  chance: z.number().min(0).max(1),
  margin: z.number().nonnegative(),
  radius: z.number().positive(),
  safeRadius: z.number().nonnegative(),
  sections: z.array(z.array(z.string()).min(1)),
});
export type ObstacleConfig = z.infer<typeof obstacleConfigSchema>;

/**
 * 技・持ち物・パッシブのアイコン（自作のドット絵。作者の決定: プレイ画面は文字ではなくアイコンで出す）。
 * glyphs は白い絵柄（"#" 明るい部分・"+" ふち・"." 透明）。技は出し方ごとの絵柄をタイプの色で、枠で タイプの技・派生技・固有技 を分ける。
 * 持ち物・パッシブは絵柄と色（"type:fire" でタイプの色）。stars はレベルの表示（作者の決定: 小さなひし形を、アイコンの下に最大8個並べる）。
 * pipColors は、レベルの済んだひし形の色を段階ごとに変える（タイプの技 → 派生技 → 固有技。派生するとレベルは1からやり直し、色が変わる）
 */
/**
 * 持ち物のアイコンのドット絵（npm run item-icons で PokeAPI の公式のアイテム画像から作る。作者の決定 2026年10月21日）。
 * rows は1文字が1ドット（. は透明）、palette はその色。credit はクレジットに出す権利の表記
 */
export const itemIconsSchema = z.object({
  size: z.number().int().positive(),
  source: z.string(),
  credit: z.string(),
  items: z.record(
    z.string(),
    z.object({ palette: z.record(z.string().length(1), z.string().regex(/^#[0-9a-fA-F]{6}$/)), rows: z.array(z.string()) }),
  ),
});
export type ItemIcons = z.infer<typeof itemIconsSchema>;

export const iconConfigSchema = z.object({
  size: z.number().int().positive(),
  dot: z.number().positive(),
  frame: z.object({ base: z.string(), derived: z.string(), unique: z.string() }),
  starColors: z.object({ on: z.string(), off: z.string() }),
  pipColors: z.object({ base: z.string(), derived: z.string(), unique: z.string() }),
  typeColors: z.record(z.string(), z.string().regex(/^#[0-9a-fA-F]{6}$/)),
  glyphs: z.record(z.string(), z.array(z.string())),
  stars: z.object({ on: z.array(z.string()).min(1), off: z.array(z.string()).min(1) }),
  moves: z.record(z.string(), z.string()),
  items: z.record(z.string(), z.object({ glyph: z.string(), color: z.string() })),
});
export type IconConfig = z.infer<typeof iconConfigSchema>;

/**
 * 技の強さをそろえる目安（作者の決定。07_content_draft.md 16.2）。最大レベルの総合の強さ（√(単体 × 群れ)）を段階ごとの max にそろえ、
 * Lv1 は max × firstRatio。tolerancePct の幅を許す。exempt は帯の外（ねむりごな・ゆびをふる）。
 * 数値をそろえるのは npm run balance-moves（威力だけを変える）
 */
export const moveBalanceSchema = z.object({
  tiers: z.object({
    base: z.object({ max: z.number().positive(), firstRatio: z.number().positive().max(1) }),
    derived: z.object({ max: z.number().positive(), firstRatio: z.number().positive().max(1) }),
    unique: z.object({ max: z.number().positive(), firstRatio: z.number().positive().max(1) }),
  }),
  tolerancePct: z.number().nonnegative(),
  exempt: z.array(z.string()),
});
export type MoveBalanceConfig = z.infer<typeof moveBalanceSchema>;
