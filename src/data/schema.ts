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
  /** なつきの進化に要る、ランで歩いた距離（07 の66.2。速さ 180 でずっと歩いて約3分） */
  friendshipDistance: z.number().positive(),
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
  /**
   * 画面の高さが低い（横向きのスマホ）ときの上の表示の大きさ（作者の指摘 2026年10月26日: 箱の強化のアイコンと同じ大きさにそろえる）。
   * iconScale は技・持ち物のアイコン（16 ドット）の倍率、cellWidth はアイコンの横の間隔、expBarHeight は経験値のバーの高さ、timerSize は時間の文字の大きさ
   */
  compactHud: z
    .object({ iconScale: z.number().positive(), cellWidth: z.number().positive(), expBarHeight: z.number().int().positive(), timerSize: z.union([z.literal(8), z.literal(16), z.literal(24), z.literal(32)]) })
    .default({ iconScale: 2, cellWidth: 38, expBarHeight: 14, timerSize: 16 }),
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
    /** 夜の区間に地面へ掛ける色（作者の決定 2026年10月27日: 区間の切り替えで暗くする。ポケモン・技は暗くしない）。切り替えは fadeSeconds かける */
    nightTint: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#7080b0'),
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
  /** 色違い（名前を「色違いの〇〇」にする。作者の決定 2026年10月24日: 色違いの御三家） */
  shiny: z.boolean().optional(),
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
    /** 技の射程（届く距離。ズームレンズ） */
    rangePct: z.number(),
    /** 技の貫通（何体まで当たるか）に足す数（するどいツメ。何体でも当たる技はそのまま） */
    pierceBonus: z.number(),
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
    })
    .optional(),
  /** その系統を色違いで遊べるようにする（data/game/playables.json のキー。見た目だけ。作者の決定 2026年10月24日） */
  shiny: z.string().min(1).optional(),
});
export type AchievementReward = z.infer<typeof achievementRewardSchema>;
export const achievementsConfigSchema = z.object({
  initialPokemon: z.array(z.string().min(1)).min(1),
  /** 最初から候補に出る持ち物（ほかは実績で解放する） */
  initialItems: z.array(z.string().min(1)).min(1),
  /** 最初の持ち物（作者の決定 2026年10月24日）: そのポケモンで clears 回クリアすると、ラン開始時に解放済みの持ち物を1つ選んで持っていける */
  startItem: z.object({ clears: z.number().int().positive() }),
  achievements: z.array(
    z.object({
      id: z.string().min(1),
      /** 実績の地方（02 の17章。省略時はカントー）。条件はその地方のランの記録だけで判定し、報酬もその地方のランだけに効く */
      region: z.string().default('kanto'),
      condition: statConditionSchema,
      hidden: z.boolean().default(false),
      reward: achievementRewardSchema.optional(),
    }),
  ),
  /**
   * 全員のセーブから一度だけ取り消すもの（伝説のリワークに合わせたリセットなど。作者の依頼 2026年10月27日）。
   * 起動時に、まだ当てていない tag のものを当て、記録 reset.<tag> で覚える。もらったコインは取り上げない
   */
  resets: z
    .array(z.object({ tag: z.string().min(1), achievements: z.array(z.string()).default([]), unlocked: z.array(z.string()).default([]), stats: z.array(z.string()).default([]) }))
    .optional(),
});
export type AchievementsConfig = z.infer<typeof achievementsConfigSchema>;

/** ポケモンの解放（実績の reward.pokemon から作る）。initial は最初から使える */
export interface UnlocksConfig {
  initial: readonly string[];
  /** region は条件を判定する地方（その地方の記録で見る） */
  unlocks: readonly { pokemon: string; condition: StatCondition; region: string }[];
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
 * 伝説の強化（作者の案 2026年10月26日）のための部品:
 * - target: random（だれかの周り spread の中のランダムな場所に count 個）
 * - targetPick: 狙うプレイヤー（nearest 一番近い・random ランダム・highestHp 一番 HP の多い）
 * - then: 落ちた直後に、続けて使う技（ミュウツー: テレポートの直後に自分の周り）
 * - homing: 予告が狙ったプレイヤーを追いかける（必中。ファイヤーのゴッドバード）。rooted: 予告の間、ボスは止まる
 * - bullets: 自分から count 方向（ランダム）へ、speed で seconds の間まっすぐ飛ぶ玉（サンダーの電気の玉）。触れると1回当たる
 * - playerMove: 落ちたときに、ボスの場所から**プレイヤーと同じ技**を出す（色違いの御三家。作者の依頼 2026年10月27日）。count・spreadDegrees で数と広がりを上書きできる
 */
/**
 * 伝説戦の間ずっと続くマップの効果（作者の案 2026年10月26日）:
 * - damagePctPerSecond・slowPct: 毎秒、最大 HP の % のダメージ・移動が遅くなる（フリーザーのふぶき）
 * - freezeBelowHpPct・freezeSeconds: HP がこの % を切ったプレイヤーは凍る（動けず、技も出ない。ぜったいれいど）
 * - defenseMultiplier: プレイヤーの防御の倍率（ファイヤーのにらみつける）
 * - overlay: 画面を少し暗く・色を付ける（サンダー・フリーザー）
 * - lightning: everySeconds ごとに技 move（target: random の範囲）を落とす（サンダーの落雷）
 * - aura: 伝説の周り radius に入ると、毎秒 damagePerSecond のダメージ（ファイヤーのほのおのうず）
 */
/**
 * 伝説がプレイヤーと同じ技を使う（作者の依頼 2026年10月27日）: moves.json の技 move を、レベル level で出す。
 * everySeconds は出す間隔（省略でその技の再使用）。count・spreadDegrees で数と広がりを上書きできる（カメックス: ハイドロカノンを一周）
 */
export const casterMoveSchema = z.object({
  move: z.string().min(1),
  level: z.number().int().positive(),
  everySeconds: z.number().positive().optional(),
  count: z.number().int().positive().optional(),
  spreadDegrees: z.number().nonnegative().optional(),
  /** 流れ（stream）の技を、向いている方向を追わずに、この速さ（度/秒）で回し続ける（カメックス: ハイドロカノンを一周） */
  sweepDegreesPerSecond: z.number().optional(),
  /** うず（spiral）の技を、広げずにこの距離で回し続ける（色違いのフシギバナ: はなびらのまいを距離200で周回） */
  orbitRadius: z.number().positive().optional(),
});
export type CasterMoveData = z.infer<typeof casterMoveSchema>;

export const legendFieldSchema = z.object({
  damagePctPerSecond: z.number().nonnegative().optional(),
  slowPct: z.number().min(0).max(90).optional(),
  freezeBelowHpPct: z.number().min(0).max(100).optional(),
  freezeSeconds: z.number().positive().optional(),
  defenseMultiplier: z.number().positive().optional(),
  overlay: z.object({ color: z.string(), alpha: z.number().min(0).max(1) }).optional(),
  lightning: z.object({ move: z.string().min(1), everySeconds: z.number().positive() }).optional(),
  aura: z.object({ radius: z.number().positive(), damagePerSecond: z.number().nonnegative(), color: z.string() }).optional(),
  /** 画面じゅうに降らせる天気（プレイヤーの技のレシピ。フリーザー: ふぶき） */
  weather: z.string().optional(),
  /** 暗い空が、ときどき雷の光で明滅する（サンダー。見た目だけ。everySeconds は平均の間隔） */
  flash: z.object({ color: z.string(), alpha: z.number().min(0).max(1), everySeconds: z.number().positive() }).optional(),
});
export type LegendField = z.infer<typeof legendFieldSchema>;

export const bossMoveSchema = z.object({
  id: z.string().min(1),
  /** 技の名前に使う PokeAPI の技のキー（表示しない技は省略） */
  move: z.string().min(1).optional(),
  /** 範囲に落ちたときの演出（data/effects/recipes.json） */
  effect: z.string().min(1),
  shape: z.enum(['circle', 'line', 'ring']).default('circle'),
  target: z.enum(['player', 'self', 'random']).default('player'),
  targetPick: z.enum(['nearest', 'random', 'highestHp']).optional(),
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
  then: z.string().min(1).optional(),
  homing: z.boolean().optional(),
  rooted: z.boolean().optional(),
  bullets: z.object({ count: z.number().int().positive(), speed: z.number().positive(), seconds: z.number().positive() }).optional(),
  playerMove: z.lazy(() => casterMoveSchema).optional(),
  /** 狙う相手がこの距離より遠いときだけ使う（フシギバナのソーラービーム: はなびらのまいの外に出たら。作者の指摘 2026年10月27日） */
  minTargetDistance: z.number().nonnegative().optional(),
  /** 狙う相手がこの距離より近いときだけ使う（カメックスのハイドロカノン: 触れるまで近づいたら） */
  maxTargetDistance: z.number().positive().optional(),
  /** 落ちた後、ボスがこの秒数止まったまま（ため の動きのまま）でいる（カメックス: ハイドロカノンを出している間） */
  holdSeconds: z.number().positive().optional(),
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
      /**
       * 第2段階（四天王。作者の決定 2026年10月24日）: HP が hpRatio を切ったら「DANGER」を出し、技の間隔を moveIntervalSeconds にし、
       * doubleChance の確率で2つの技を同時に使う
       */
      enrage: z.object({ hpRatio: z.number().gt(0).lt(1), moveIntervalSeconds: z.number().positive(), doubleChance: z.number().min(0).max(1) }).optional(),
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
      /**
       * 伝説ごとの技。moveIntervalSeconds・enrageMoveIntervalSeconds はその伝説だけの技の間隔（ミュウ: ゆびをふる のように固有技を乱射する。作者の決定 2026年10月25日）
       */
      moveSets: z
        .record(
          z.string(),
          z.object({
            moves: z.array(z.string()).min(1),
            random: z.boolean().default(false),
            moveIntervalSeconds: z.number().positive().optional(),
            enrageMoveIntervalSeconds: z.number().positive().optional(),
            /** moves の "*" は、毎回 pool からランダムに選ぶ（ミュウ: テレポートとゆびをふるを交互に。作者の案 2026年10月26日） */
            pool: z.array(z.string()).optional(),
            /** 戦いの間ずっと続くマップの効果（伝説の強化。作者の案 2026年10月26日） */
            field: legendFieldSchema.optional(),
            /**
             * プレイヤーと同じ技を、戦いの間ずっと出す（色違いの御三家。作者の依頼 2026年10月27日）。casterPower はその技の威力の倍率。
             * shell: 一番近いプレイヤーが farDistance より離れると甲羅の形になり（近づくと nearDistance で戻る）、速さ speedMultiplier 倍で moves を出しながら追う（カメックス）。
             * pose はそのときの動き（ドット絵の動作の名前）。spin なら向きをくるくる回す。chargePose は予告の間止まる技（rooted）の間の動き
             */
            casters: z.array(casterMoveSchema).optional(),
            casterPower: z.number().positive().optional(),
            shell: z
              .object({
                farDistance: z.number().nonnegative(),
                nearDistance: z.number().nonnegative(),
                speedMultiplier: z.number().positive(),
                pose: z.string(),
                spin: z.boolean().default(false),
                moves: z.array(casterMoveSchema).default([]),
              })
              .optional(),
            chargePose: z.string().optional(),
          }),
        )
        .default({}),
      moveIntervalSeconds: z.number().positive(),
      /** 「DANGER」の表示から出現までの時間 */
      warningSeconds: z.number().nonnegative(),
      /** この時間で倒せなければ、逃げられて終わる（クリアは確定済み） */
      timeLimitSeconds: z.number().positive(),
      /** 第2段階（作者の決定 2026年10月23日）: HP が hpRatio を切ったら「DANGER」をもう一度出し、技の間隔を短くし、doubleChance の確率で2つの技を同時に使う */
      enrage: z.object({ hpRatio: z.number().gt(0).lt(1), moveIntervalSeconds: z.number().positive(), doubleChance: z.number().min(0).max(1) }).optional(),
      /**
       * 相性で選ぶ候補（作者の決定 2026年10月24日: 色違いの御三家）。ランの参加者のだれかが achievements のどれかを達成していれば、
       * kinds のうち、参加者のポケモンに一番不利な1体（こちらの技が通りにくく、向こうの技がよく効く）を候補に足す
       */
      counter: z.object({ kinds: z.array(z.string().min(1)).min(1), achievements: z.array(z.string().min(1)).min(1) }).optional(),
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
    /**
     * 範囲技が落ちた後も、この秒数は範囲に触れると当たる（作者の指摘 2026年10月25日: はかいこうせんの光に触れても当たらなかった。
     * 落ちた瞬間だけだった）。1つの範囲技で当たるのは1回
     */
    hazardActiveSeconds: z.number().nonnegative(),
    /** 範囲技の威力を、プレイヤーの最大 HP の伸び（stats の perLevelPct.maxHp）に合わせてレベルで上げるか（後半でも痛いように） */
    hazardDamageScalesWithLevel: z.boolean(),
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
  /** 光線（beam）: 数が1増えるごとに、幅をこの割合だけ広げる（本数は増やさない。作者の指摘 2026年10月27日） */
  beamWidthPerExtraCount: z.number().nonnegative().default(0.5),
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
 * - passive（いつも効く）: 攻撃しない。レベルごとに、持ち物と同じ形の効果を足す（技の passive。ポリゴンの かくばる・テクスチャー）
 * - heal（回復）: 攻撃しない。使うたびに最大 HP の healPct % を回復し、guardPct があれば duration の間、受けるダメージを減らす
 *   （なまける・ドわすれ。作者の決定 2026年10月23日）。自分の周りに size の円を見た目だけ出す
 * - spiral（うず）: 自分を中心に count 個を等しい角度に並べ、curve（度/秒）で回りながら、duration の間に range まで広がる
 *   （はなびらのまい。作者の決定 2026年10月23日）
 * - sweep（往復するなぎ払い）: 向いている方向を中心に、開き arcDegrees の細い扇形を、spreadDegrees の幅で行って戻る
 *   （おうふくビンタ）。行きと戻りの両方で当たる（当たり直しの間隔は duration の半分）
 * - eruption（爆炎の柱）: 自分を中心に count 方向へ、円の柱を stages 段に分けて、interval ごとに外へ向かって順に出す。
 *   いちばん外の段が range の距離。外の段ほど半径が sizeGrowth の割合ずつ大きい（ブラストバーン。作者の決定 2026年10月23日）
 * - pulse（広がって縮む輪）: 自分を中心に、厚さ size の輪が range まで広がってから縮む（duration の間）。count 2 以上は interval ごとに続けて出す
 *   （スパーク・ワイルドボルト。作者の決定 2026年10月25日）
 * - weather（天気）: duration の間、自分の周り半径 size（画面くらい）の敵すべてに、当たり直しの間隔ごとに当たる（こなゆき・ふぶき。
 *   作者の決定 2026年10月25日）。範囲は塗らず、画面に雪を降らせて見せる
 * - barrage（連打）: 向いている方向を中心にした開き arcDegrees・距離 range の中のランダムな場所に、外へ押し出す小さな当たり判定（拳・蹴り）を
 *   count 発、interval ごとに出す（ばくれつパンチ: ゴムゴムのガトリングのように。にどげり: 近くのランダムな向きへ2連撃。作者の決定 2026年10月25日）
 * - rest（ねむる）: 攻撃しない。歩いていない時間が duration 続くと眠り、眠っている間は毎秒 最大 HP の healPct % を回復するが、ほかの技は出ない。
 *   動くと起き、interval 秒の起きる動き（その間は動けず、技も出ない）を挟む（カビゴン。作者の決定 2026年10月25日）
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
  'heal',
  'passive',
  'sweep',
  'spiral',
  'pulse',
  'weather',
  'barrage',
  'rest',
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
  /** heal（回復）: 使うたびに最大 HP の何 % を回復するか（なまける・ドわすれ） */
  healPct: z.number().nonnegative().default(0),
  /** heal（回復）: 使ってから duration の間、受けるダメージを何 % 減らすか（ドわすれ） */
  guardPct: z.number().min(0).max(100).default(0),
  /** 自分が覚えているほかの技 1つにつき、威力を何 % 上げるか（とっておき） */
  perMovePowerPct: z.number().nonnegative().default(0),
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
    healPct: z.number(),
    guardPct: z.number(),
    perMovePowerPct: z.number(),
  })
  .partial();
export type MoveLevelDelta = z.infer<typeof moveLevelDeltaSchema>;

const fxSize = { sizeMultiplier: z.number().positive(), powerMultiplier: z.number().nonnegative() };
/** 蛇行: 進む向きに対して横へ、振れ幅 amplitude・波長 wavelength（どちらもワールドの単位）で揺れながら進む */
const snakeSchema = z.object({ amplitude: z.number().positive(), wavelength: z.number().positive() });
/**
 * 技の「効き方」（07_content_draft.md 22.4）。trigger で起こるときを決め、部品を組み合わせる。
 * - trigger: cast（技を使ったとき。自分の位置・向いている方向）、hit（当たり判定が初めて敵に当たったとき。当たった敵の位置）、
 *   end（当たり判定が消えたとき・落ちたとき。その位置）、every（当たり判定が残っている間 everySeconds ごと。その位置。
 *   流れ stream は流れが最初に当たる敵の位置）、spawn（当たり判定が現れたとき。その位置。遅れて現れる爆炎の柱は現れたとき）
 * - 大きさ・威力は、もとの当たり判定の大きさ（半径）・威力に掛ける倍率
 * - eachHit: 当たった敵ごとに（その敵の位置で）起こす（かみなり: 落雷を受けた敵それぞれから電気が連鎖する）
 */
export const moveEffectSchema = z.object({
  /** kill は、この技（技そのもの）で敵を倒したとき。その敵の位置（ぜったいれいど: 凍った敵が氷の破片を飛ばす） */
  trigger: z.enum(['cast', 'hit', 'end', 'every', 'eachHit', 'spawn', 'kill']),
  /** 今の姿がこのどれかのときだけ起こる（しんそく: ウィンディなら残像が炎をまとう。作者の案 2026年10月25日。PokeAPI のポケモンの名前） */
  forms: z.array(z.string()).optional(),
  everySeconds: z.number().positive().optional(),
  /** 起こる確率（0〜1。省略で必ず） */
  chance: z.number().min(0).max(1).optional(),
  /** 爆発: その場で弾ける円。delaySeconds があれば、印を置いて少し後に弾ける。pull は中心へ引き寄せる強さ */
  /** asMove なら、その技（moves.json のキー）として弾ける（見た目もタイプもその技。ばくれつパンチの 炎・雷 のスプラッシュ） */
  explode: z.object({ ...fxSize, delaySeconds: z.number().positive().optional(), pull: z.number().positive().optional(), asMove: z.string().optional() }).optional(),
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
  /**
   * 分裂: 小さな弾が飛び散る（spreadDegrees は向きを中心にした広がり。360 で全方向）。
   * jitter（0〜1）で向きと速さをばらつかせる（その場ごとに決まる。ブラストバーンの火の粉）。
   * lob なら上へ放り上げて重さで落とす（いわなだれ: 当たると小さな岩が飛び散る）。snake なら蛇行して進む（ハードプラントの根）。
   * pierce・hitIntervalSeconds を省くと、3体まで・同じ敵には1回
   */
  split: z
    .object({
      ...fxSize,
      count: z.number().int().positive(),
      speed: z.number().positive(),
      durationSeconds: z.number().positive(),
      spreadDegrees: z.number().positive().default(360),
      boomerang: z.boolean().default(false),
      jitter: z.number().min(0).max(1).optional(),
      /** 向きを、もとの向きからこの角度（度）ずらす（シザークロス: 45° で X 字に） */
      angleOffsetDegrees: z.number().optional(),
      lob: z.boolean().optional(),
      snake: snakeSchema.optional(),
      /** レベルが1上がるごとに延ばす持続（秒。ハードプラント: 強化で根が遠くまで伸びる） */
      durationPerLevel: z.number().nonnegative().optional(),
      pierce: pierceValue.optional(),
      hitIntervalSeconds: z.number().positive().optional(),
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
    .object({
      ...fxSize,
      count: z.number().int().positive(),
      length: z.number().positive(),
      durationSeconds: z.number().positive(),
      hitIntervalSeconds: z.number().positive(),
      /** レベルが1上がるごとに伸ばす長さ（ハードプラント: 強化で根が遠くまで伸びる。作者の決定 2026年10月23日） */
      lengthPerLevel: z.number().nonnegative().default(0),
      /** 向きをばらばらにする（等しい角度に並べず、その場ごとにランダム。ハードプラントの根） */
      randomAngles: z.boolean().default(false),
      /** 長さのばらつき（0〜1。1本ごとに 1 − この割合 〜 1 倍） */
      lengthJitter: z.number().min(0).max(1).default(0),
    })
    .optional(),
  /** 岩の群れ: その場のまわり radius の中のランダムな場所に、count 個の残る当たり判定を置く（ストーンエッジの突き出す岩。作者の指摘 2026年10月25日） */
  cluster: z
    .object({ ...fxSize, count: z.number().int().positive(), radius: z.number().nonnegative(), durationSeconds: z.number().positive(), hitIntervalSeconds: z.number().positive() })
    .optional(),
  /**
   * 伸びる亀裂: その場から count 本の亀裂が外へ伸びる。1本は長さ segment の線を steps 本つないだもので、つなぐたびに向きを
   * 最初の向きから turnDegrees までの中でランダムに選び直し、segmentSeconds ごとに1本ずつ伸びる（じわれ。作者の案 2026年10月25日）
   */
  crack: z
    .object({
      ...fxSize,
      count: z.number().int().positive(),
      steps: z.number().int().positive(),
      segment: z.number().positive(),
      turnDegrees: z.number().nonnegative(),
      segmentSeconds: z.number().nonnegative(),
      durationSeconds: z.number().positive(),
      hitIntervalSeconds: z.number().positive(),
    })
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
  /**
   * metronome（ランダムな技）で選ぶ技の集まり: starting（遊べるポケモンの最初の技。ものまね）・unique（固有技。ゆびをふる）・
   * common（固有技・伝説の技を除く、ふつうの技と派生技。ベイビィ用の ゆびをふる。自分のレベルの割合で出す。07 の66.4）。
   * 作者の決定 2026年10月23日
   */
  randomPool: z.enum(['starting', 'unique', 'common']).optional(),
  /** 当たったときの状態異常を、この中からランダムに選ぶ（トライアタック: やけど・こおり・まひ）。statusChance で付くかどうかを決める */
  randomStatuses: z.array(z.string()).optional(),
  /** chain（連鎖）: 1回跳ぶごとに遅らせる秒数（10まんボルト: 敵から敵へ跳んでいくのが見える。0 なら全部同時） */
  chainHopSeconds: z.number().nonnegative().optional(),
  /** chain（連鎖）: 次に跳ぶ敵は、今の場所からこの距離より離れた敵を選ぶ（いなければ一番近い敵。しんそく: 広く倒す。作者の案 2026年10月25日） */
  chainMinHop: z.number().nonnegative().optional(),
  /**
   * この技を候補に出す系統（data/game/playables.json のキー）。省略ならタイプが合えばだれでも。
   * ノーマルの技を、原作で覚えるポケモンたちに絞る（作者の決定 2026年10月24日。どのタイプの技も覚えるミュウは別）
   */
  learners: z.array(z.string()).optional(),
  /** 跳ね返る技（bounce）を出す向き: 向いている方向から何度ずらすか（まっすぐだと、向かいの壁との間で同じ線を往復するだけになる）。spreadDegrees があれば、その幅でランダムにずらす */
  bounceAngle: z.number().optional(),
  /** 出した技が消えるまで、次を出さない（再使用は少なくとも持続の長さ。ボルテッカー: 次のピカチュウが重ならない。作者の決定 2026年10月25日） */
  waitForEnd: z.boolean().optional(),
  /**
   * 使うたびに自分の HP を使う技（だいばくはつ。作者の決定 2026年10月25日・26日）: 最大 HP の pct % 相当の**ダメージ**を自分が受ける
   * （防御・ディフェンダーなどの軽減が効く）。HP が最大 HP の minHpPct % を下回っていれば出さない（たまるまで待つ）
   */
  hpCost: z.object({ pct: z.number().positive(), minHpPct: z.number().min(0).max(100) }).optional(),
  /**
   * 当たった敵に印を付け、seconds 後にその敵の位置で爆発させる（みらいよち。作者の決定 2026年10月26日）。
   * 爆発の大きさ・威力は、当たった攻撃の大きさ・威力に掛ける倍率。印が付いている敵には付け直さない
   */
  delayedBlast: z.object({ seconds: z.number().positive(), sizeMultiplier: z.number().positive(), powerMultiplier: z.number().nonnegative() }).optional(),
  /**
   * 使うたびに、ランの終わりにもらうコインを perUse + perLevel × (レベル − 1) 枚増やす（ネコにこばん。作者の決定 2026年10月26日）。
   * 端数はためて、ランの終わりに切り捨てる
   */
  coinGain: z.object({ perUse: z.number().nonnegative(), perLevel: z.number().nonnegative() }).optional(),
  /** heal: すぐに回復せず、自分を中心にした円（大きさ size）を出している間（durationSeconds）、中にいるプレイヤーを毎秒 最大 HP の healPct % 回復する（つきのひかり。07 の57章） */
  healZone: z.boolean().optional(),
  /** cross（十字）: 向きを等しい角度に並べず、1発ごとにランダムにする（うたう: 音符がふわふわ散る） */
  crossRandom: z.boolean().optional(),
  /** 扇（melee の arcDegrees）を、向いている方向ではなく左右の両方へ1つずつ出す（ハイパーボイス） */
  sideways: z.boolean().optional(),
  /** この技に（1秒以上あけて）この回数当たった雑魚は、確定で倒れる（ほろびのうた。ボスには効かない） */
  perishHits: z.number().int().positive().optional(),
  /** 扇（melee の arcDegrees）: 数が1増えるごとに、扇の角度をこの度数だけ広げる（本数は増やさない。かえんほうしゃ・バブルこうせん。作者の指摘 2026年10月27日） */
  countWidens: z.number().positive().optional(),
  /** 扇（melee の arcDegrees）: 出ている間、向いている方向をこの速さ（度/秒）で追う（かえんほうしゃ） */
  followFacing: z.number().positive().optional(),
  /** 射程の強化（ズームレンズ）の効き方の倍率（ねんりき: 0.5 で半分だけ伸びる）。省略で 1 */
  rangeBonusScale: z.number().nonnegative().optional(),
  /**
   * lob（放物線）の落とす場所: random（自分の周り range の中のランダムな場所）・nearest（一番近い敵。いなければランダム）。
   * どちらも真上寄りに投げ上げ、持続の秒数でちょうどその場所に落ちる（しおふき・ヘドロばくだん）。省略なら向いている側へ放る
   */
  lobTarget: z.enum(['random', 'nearest']).optional(),
  /** scatter（置く）の数と大きさを、使うたびにランダムにする: 数は countMin〜count、半径は size × sizeMin〜sizeMax（マグニチュード） */
  scatterJitter: z.object({ countMin: z.number().int().positive(), sizeMin: z.number().positive(), sizeMax: z.number().positive() }).optional(),
  /** sweep（なぎ払い）を片道だけにする（はたく: 1回払う。おうふくビンタは行って戻る） */
  sweepOnce: z.boolean().optional(),
  /**
   * barrage（連打）を長方形にする: 自分を通り向きに直角な、横幅 barrageWidth の辺から、向いている方向へ range の奥行きまで
   * 拳をまっすぐ乱打する（ばくれつパンチ: 自分の真横から当たる。作者の決定 2026年10月25日）。省略なら扇形の中のランダムな場所
   */
  barrageWidth: z.number().positive().optional(),
  /** レベルが1上がるごとに広げる横幅（ばくれつパンチ: 強化で出る範囲が広がる） */
  barrageWidthPerLevel: z.number().nonnegative().optional(),
  /** 向きを、使うたびにランダムに選ぶ（にどげり・まわしげり: 近くのランダムな向きへ。barrage・sweep で使う） */
  randomAim: z.boolean().optional(),
  /** 再使用を、出した技が消えてから数える（こなゆき・ふぶき: 雪が止んでから cooldown の間はダメージが起きない。作者の決定 2026年10月25日） */
  restAfterEnd: z.boolean().optional(),
  /** 狙う敵: 一番近い敵ではなく、届く範囲で HP の一番高い敵（ゴッドバード: ボスへ。作者の決定 2026年10月25日）。beam で使う */
  aimStrongest: z.boolean().optional(),
  /**
   * ためている間に出す技（moves.json のキー。最大レベルで出す）と、この技を出してから止めておく秒数
   * （きあいパンチ: ためている間はマッハパンチが出て、きあいパンチを出している間は止まる。作者の決定 2026年10月25日）
   */
  chargeMove: z.object({ move: z.string(), pauseSeconds: z.number().nonnegative() }).optional(),
  /** 候補に出さない（持ち物を持つと覚える技。ほのおのパンチ・かみなりパンチ） */
  teachOnly: z.boolean().optional(),
  /** 名前・タイプ・分類を借りる原作の技（PokeAPI の名前）。同じ名前で中身の違う技（ベイビィ用の ゆびをふる。07 の77章） */
  nameOf: z.string().optional(),
  /**
   * 同じ group の技は、同時に出さず順番に出す（ワンリキーのパンチ。作者の決定 2026年10月25日）。
   * 1つ出すと、次の技はその技の再使用 ÷ group の技の数 の後に出せる
   */
  group: z.string().optional(),
  /** 飛ぶ弾（cross・nearest など）を蛇行させる（ヘドロウェーブ・りゅうのいかり） */
  snake: snakeSchema.optional(),
  /**
   * passive（いつも効く技）: レベルごとに足す効果（持ち物と同じ形）。[0] がレベル1で、レベル L ではここまでの合計が効く。
   * 数は最大レベル（levels の数 + 1）と同じ（作者の決定 2026年10月24日: ポリゴンの かくばる・テクスチャー）
   */
  passive: z.array(modifierSchema).optional(),
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
  /** 連絡先（権利者からの削除の申し入れ・不具合の連絡。作者の決定 2026年10月25日: X のアカウント）。クレジットの窓に出す */
  contactUrl: z.string().url(),
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
        /** 解放の条件（記録の数。作者の決定 2026年10月25日: ジョウトは伝説のミュウを倒す）。案内は翻訳ファイルの region.unlock.<id> */
        unlock: z.lazy(() => statConditionSchema).optional(),
      }),
    )
    .min(1),
});
export type RegionsConfig = z.infer<typeof regionsConfigSchema>;

/**
 * 地方のステージ（data/regions/<地方>.json。ジョウトの J2 で地方ごとに分けた。02 の16章）。
 * 区間ごとに 雑魚（wave）・地面（tile）・曲（bgm）・障害物の見た目（obstacles）・夜か（night）を並べる。
 * wave・bosses・swarms・legendary の中身は、共通の設定（spawn.json・stage.json）と合わせてから spawnConfigSchema・stageConfigSchema で検証する
 */
export const regionStageSchema = z.object({
  durationSeconds: z.number().positive(),
  sections: z
    .array(
      z.object({
        /** 地面（data/render/ground.json の tiles の ID） */
        tile: z.string(),
        /** 曲（data/audio/bgm.json の tracks の ID）。null は無音 */
        bgm: z.string().nullable(),
        /** 障害物の見た目（data/render/obstacles.json のドット絵のキー） */
        obstacles: z.array(z.string()).min(1),
        /** 夜の区間（作者の決定 2026年10月27日: 区間の切り替えで画面を暗くする） */
        night: z.boolean().default(false),
        /** 雑魚（前の spawn.json の waves の1つ） */
        wave: z.record(z.string(), z.unknown()),
      }),
    )
    .min(1),
  bosses: z.array(z.unknown()),
  swarms: z.array(z.unknown()).default([]),
  /** 伝説戦（stage.json の legendary の形）。書かなければ伝説戦は無し */
  legendary: z.unknown().optional(),
  /** 伝説戦の曲 */
  legendaryBgm: z.string().nullable().default(null),
});
export type RegionStageFile = z.infer<typeof regionStageSchema>;

export const playablesConfigSchema = z.object({
  pokemon: z.record(
    z.string(),
    z.object({
      /** スプライトのキー（public/sprites/<key>） */
      sprite: z.string(),
      /** 最初に覚えている技（タマゴは無し） */
      startingMoves: z.array(z.string()).default([]),
      /**
       * タマゴ（07 の57章・66.4）: 選ぶと、ランを始めるときにこの中から1匹がかえる（ソロは選ぶたびに、協力プレイは部屋のシードと人で決める）。
       * sprite は data/render/items.json の自作の絵
       */
      hatch: z.array(z.string()).optional(),
      /** この姿に進化したら覚える技（技が埋まっていれば覚えない。ピィ: ピッピで ゆびをふる、ピクシーで つきのひかり。07 の57章） */
      formMoves: z.array(z.object({ form: z.string(), move: z.string() })).default([]),
      /**
       * この姿に進化したら、その遊べるポケモンの系統になる（固有技・持ち物・技を覚えない などの決まりを引き継ぎ、最初の技を覚えていなければ覚える）。
       * ピチュー → ピカチュウ、ププリン → プリン（07 の66.4「進化した後の技は、カントーの同じポケモンと同じ決まり」）
       */
      becomes: z.array(z.object({ form: z.string(), line: z.string() })).default([]),
      /** この姿の間は新しい技を覚えない（トゲピー: 進化するまで。07 の57章） */
      fixedForms: z.array(z.string()).default([]),
      /** この姿の間、この技を使うたびに HP を使う（ピチュー: でんきショックで最大 HP の 1%。10% を切ると撃たない） */
      formHpCost: z.object({ forms: z.array(z.string()), move: z.string(), pct: z.number().positive(), minHpPct: z.number().min(0).max(100) }).optional(),
      /** この姿の間、歩いた距離 everyDistance ごとに seconds 秒止まって泣く（動けない。技は出る。トゲピー。07 の66.4） */
      cry: z.object({ forms: z.array(z.string()), everyDistance: z.number().positive(), seconds: z.number().positive() }).optional(),
      /** false なら進化しない（コダック） */
      evolves: z.boolean().default(true),
      /** タイプを決める（進化した姿も同じ。プリン: ノーマルだけ）。省略時は PokeAPI のタイプ */
      types: z.array(z.string()).optional(),
      /** 自分のタイプのほかに、候補に出る技のタイプ（コダック: エスパー） */
      moveTypes: z.array(z.string()).optional(),
      /** 新しい技を覚えない（プリン: 最初の2つだけで戦う） */
      fixedMoves: z.boolean().default(false),
      /** 持つと技を覚える持ち物（ワンリキー: ほのおのいし → ほのおのパンチ、かみなりのいし → かみなりパンチ）。消費された技は覚え直さない */
      itemMoves: z.array(z.object({ item: z.string(), move: z.string() })).default([]),
      /** どのタイプの技も覚えられる（ミュウ） */
      allMoveTypes: z.boolean().default(false),
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
      /** full のときに、pipeline の動作のほかに取り込む動作（カビゴン: 寝ている Sleep。作者の決定 2026年10月25日） */
      extraAnimations: z.array(z.string()).default([]),
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
   * 1ドットの大きさ（ワールドの単位。作者の決定 2026年10月24日: ポケモン・マップ・技の絵・光の演出・当たり判定の塗りを、すべて 2 にそろえる）。
   * 技のドット絵は、この細かさになるマス数で描き直す
   */
  dot: z.number().positive(),
  /**
   * 技の演出をドット絵に合わせる（WebGL のときだけ）。演出をまとめて描いた後で、
   * size（ワールドの長さ。画面ではカメラの拡大率を掛けた大きさ。dot と同じにすると1ドットがそろう）ごとの四角に区切り、
   * 色と透明度を colorSteps・alphaSteps 段階に減らす。size 0 で使わない
   */
  /**
   * 見える範囲（作者の決定 2026年10月22日。07 25.3 の B 案）: 見えるワールドの縦の広さを、どの端末でも viewHeight にそろえる。
   * 横は端末の比率に合わせて広げるが、maxAspect（横 ÷ 縦。16:9）まで。それより横長の画面は、左右を黒い帯にする
   */
  camera: z.object({ viewHeight: z.number().positive(), maxAspect: z.number().positive() }),
  effectPixel: z.object({
    size: z.number().nonnegative(),
    colorSteps: z.number().int().min(2),
    alphaSteps: z.number().int().min(2),
  }),
  /**
   * 技の当たり判定の形（作者の指摘。2026年10月21日）。グラデーションではなく、当たり判定の形を平らに塗る（外周の線は引かない。2026年10月22日）。
   * pixel は角ばったドットにするフィルターの大きさ（ワールドの長さ。画面ではカメラの拡大率を掛ける）、fillAlpha は塗りの不透明度。moves を書くとその技だけ（試すとき）、省略で全部
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

/** 技のドット絵の指定。growSeconds があれば、線を根元から先へその秒数で伸ばして見せる */
const moveSpriteSpec = z.object({
  id: z.string(),
  /**
   * circle（円に合わせて1枚）・line（線に 始まり・途中・終わり を並べる）・cone（扇形に1枚を引き伸ばす。かえんほうしゃ）・
   * ring（外へ進む帯の輪に沿って、途中の部品を並べる。じしんの地割れ）・
   * front（扇形の向きの先に1枚を置く。大きさは扇の半径。ほのおのキバの牙・フレアドライブの炎）・
   * snake（蛇行して進むものの通った道に 途中 を並べ、先に 終わり を置く。太さは当たり判定の直径。ヘドロウェーブ・ハードプラントの根）
   */
  fit: z.enum(['circle', 'line', 'cone', 'ring', 'front', 'snake']),
  size: z.number().positive().default(1),
  /** 絵の濃さ（煙など、下が少し透けてほしいもの） */
  alpha: z.number().min(0).max(1).default(1),
  growSeconds: z.number().positive().optional(),
  /** circle の絵の向き: none（そのまま）・velocity（進む向きに向ける。絵は右向きに描く）・spin（回し続ける） */
  rotate: z.enum(['none', 'velocity', 'spin']).default('none'),
  /** spin の回る速さ（度/秒） */
  spinDegPerSec: z.number().default(720),
  /** line・ring・snake の途中の部品を、1枚ずつ違うコマで描く（はっぱカッター・はなびらのまい: 1枚ずつ向きが違って舞って見える。水流のように つなぎ目が大事な絵では使わない） */
  varyTiles: z.boolean().default(false),
  /** ring の部品を輪の向きに回さず、いつも立てて置く（うたうの音符: 回すと輪の上側で逆さになる） */
  upright: z.boolean().default(false),
  /**
   * front・circle の絵を、向きで描き分ける（回さない。circle は進む向き。かみつく: 下を向いたとき、横の絵を回すとクワガタのつのに見えた。作者の指摘 2026年10月27日）。
   * 絵の部品 main = 横（右。左は左右を返す）・front = 正面（下）・back = 後ろ（上）・diag = 斜め前（右下）・diagBack = 斜め後ろ（右上）
   */
  directional: z.boolean().default(false),
  /** circle の絵の、当たり判定の中心に合わせる高さ（0 = 絵の上端、1 = 下端）。地面から噴き上がる絵は、根元を中心に合わせる（ブラストバーン） */
  originY: z.number().min(0).max(1).default(0.5),
  /** 描く位置を毎フレーム、この大きさ（ワールドの単位）までランダムにずらす（揺れる地面。画面は揺らさない） */
  shake: z.number().nonnegative().default(0),
  /** snake: 先から後ろへ描く道の長さ（ワールドの単位）。0 なら出した場所から全部 */
  tail: z.number().nonnegative().default(0),
  /** 当たり判定ごとに、この中から絵を順に選ぶ（ばくれつパンチ: ふつう・炎・電気のこぶし）。省略なら id だけ */
  variants: z.array(z.string()).optional(),
});

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
    .object({
      tint: colorString,
      alpha: z.number().min(0).max(1),
      afterimages: z.number().int().nonnegative(),
      spacingTicks: z.number().positive(),
      /** 色を periodMs ごとに順に切り替える（ボルテッカー: 10まんボルトのような黒・白・黄。作者の指摘 2026年10月25日）。省略なら tint のまま */
      colors: z.array(colorString).min(1).optional(),
      periodMs: z.number().positive().default(60),
    })
    .optional(),
  /**
   * 効き方から出た円の範囲（10まんボルトの自分の周りの電気）を、色を切り替えて光らせる。
   * colors を periodMs ごとに順に使い、塗りの濃さは alpha
   */
  /** 落雷の見た目: 当たり判定が出てから seconds の間、上から稲妻を落とす（かみなり）。height は稲妻の長さ、width は太さ */
  bolt: z.object({ color: colorString, glowColor: colorString, height: z.number().positive(), width: z.number().positive(), seconds: z.number().positive() }).optional(),
  /**
   * 技のドット絵（data/render/move-sprites.json の id）を、光の芯の代わりに描く。circle は当たり判定の円に合わせて1枚、
   * line は線の長さに合わせて 始まり・途中・終わり を並べる。size は当たり判定の大きさに掛ける倍率
   */
  sprite: moveSpriteSpec.optional(),
  /** 効き方から出た線（ハードプラントの突き出す根）を、光の線の代わりにこのドット絵で描く */
  effectLineSprite: moveSpriteSpec.optional(),
  /** 効き方から出た円・飛ぶもの（ブラストバーンの火の粉・ハードプラントの根・10まんボルトの周りの電気）を、このドット絵で描く */
  effectSprite: moveSpriteSpec.optional(),
  /** 通った道に残る範囲（ストーンエッジの岩の亀裂）を、このドット絵で描く（線に合わせる） */
  pathSprite: moveSpriteSpec.optional(),
  /** 技そのものに、もう1枚重ねる絵（だいばくはつ: 広がる爆発の端に、派手な炎の帯を輪に沿って並べる） */
  edgeSprite: moveSpriteSpec.optional(),
  /** 技を使った瞬間に、使ったポケモンの位置に seconds の間出す絵（しおふき: 真上へ噴き上がる潮）。radius はワールドの単位 */
  castSprite: moveSpriteSpec.extend({ seconds: z.number().positive(), radius: z.number().positive() }).optional(),
  /** 技が敵に当たった所に seconds の間出す絵（ぜったいれいど: 氷の像）。radius はワールドの単位 */
  hitSprite: moveSpriteSpec.extend({ seconds: z.number().positive(), radius: z.number().positive() }).optional(),
  /** 当たり判定の範囲を塗らない（天気: 画面全体なので、降る雪だけで見せる） */
  hideShape: z.boolean().default(false),
  /**
   * 天気（こなゆき・ふぶき）: 技が出ている間、画面じゅうに粒を降らせる。perSecond は 1 秒に出す数、angle は真下から何度傾けるか
   * （風で流れる）。tint は画面を薄く色づける色と濃さ
   */
  weather: particleSchema
    .omit({ spread: true })
    .extend({ perSecond: z.number().positive(), angle: z.number(), tint: z.object({ color: colorString, alpha: z.number().min(0).max(0.3) }).optional() })
    .optional(),
  /**
   * ボス・伝説の範囲技が落ちたときのドット絵（作者の案 2026年10月24日。案 F）。落ちた範囲（円・輪・直線）に合わせて seconds の間出す。
   * 予告の赤い範囲はそのまま（避けやすさのため）
   */
  strike: moveSpriteSpec.extend({ seconds: z.number().positive() }).optional(),
  /**
   * 稲妻の線（10まんボルト・でんきショック・かみなりの連鎖）: 線の端から端まで1本のジグザグを、毎フレーム形を変えて描く
   * （同じ形の絵を並べると鎖のように見えた。作者の指摘 2026年10月24日）。jitter は折れ目のずれ（太さの何倍か）
   */
  lightningLine: z.object({ color: colorString, glowColor: colorString, width: z.number().positive(), jitter: z.number().nonnegative().default(3) }).optional(),
  /** 技を出す seconds 秒前から、持ち主の体を光らせる（ためる。ギガインパクト）。radius は光の半径、alpha は出す直前の濃さ */
  chargeGlow: z.object({ color: colorString, seconds: z.number().positive(), radius: z.number().positive(), alpha: z.number().min(0).max(1) }).optional(),
  /** 技が出た瞬間に、画面全体をうっすら光らせる（とっておき）。目に優しいよう薄く短く */
  screenFlash: z.object({ color: colorString, alpha: z.number().min(0).max(0.5), durationMs: z.number().positive() }).optional(),
  burstFlash: z
    .object({
      colors: z.array(colorString).min(1),
      periodMs: z.number().positive(),
      alpha: z.number().min(0).max(1),
      /** 技そのものの線（はかいこうせんのレーザー）も光らせる */
      lines: z.boolean().default(false),
    })
    .optional(),
  /** 発射体の軌跡に出すパーティクル */
  trail: particleSchema.extend({ intervalMs: z.number().positive() }).optional(),
  /**
   * 技が落ちた後に残る範囲（効き方の puddle・ボスの技が残す床）の見た目（作者の案 2026年10月24日）。
   * 範囲の塗りは fillAlpha の濃さにうすくし、範囲の中のあちこちから控えめな粒を出す（水面のきらめき・残る火種など）。
   * perSecond は 100×100 の広さあたり 1 秒に出す数（1つの範囲で maxPerSecond まで。広い範囲で多くなりすぎないように）。残る範囲では軌跡の粒（trail）と芯は出さない
   */
  linger: particleSchema.extend({ perSecond: z.number().positive(), maxPerSecond: z.number().positive().default(20), fillAlpha: z.number().min(0).max(1) }).optional(),
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
  /**
   * ゲストが自分の攻撃で雑魚を倒したと見込んだら、ホストの撃破の知らせを待たずに先に消して見せる（作者の依頼 2026年10月25日）。
   * この秒数のうちに知らせが来なければ（見込みが外れた）、見せ直す
   */
  predictKillSeconds: z.number().positive(),
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
    /**
     * 箱を開けると出る一時的な強化（作者の決定 2026年10月25日）。拾うと buffs から重みで1つ選び、seconds のあいだ mods が効く。
     * item は名前とアイコンに使う原作の道具（プラスパワーなど、原作でも戦闘の間だけ効く道具）
     */
    buff: z
      .object({
        buffs: z.array(z.object({ item: z.string(), seconds: z.number().positive(), mods: modifierSchema, weight: z.number().positive() })).min(1),
      })
      .optional(),
  }),
  /**
   * マップの箱（作者の決定 2026年10月25日）: 攻撃を hits 回当てると開き、一時的な強化（items.buff）を落とす。
   * ソロ・ホストが、だれかの周り distanceMin〜distanceMax に spawnSeconds ごとに出す（同時に max 個まで）。全員から despawnDistance より離れたら消す
   */
  boxes: z
    .object({
      max: z.number().int().nonnegative(),
      hits: z.number().int().positive(),
      radius: z.number().positive(),
      spawnSeconds: z.number().positive(),
      firstSpawnSeconds: z.number().nonnegative(),
      distanceMin: z.number().nonnegative(),
      distanceMax: z.number().positive(),
      despawnDistance: z.number().positive(),
    })
    .optional(),
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
      trigger: z.enum(['level', 'item', 'trade', 'friendship', 'other']),
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
  /** 協力プレイで全員が選び終えてから再開するまでの間（秒。作者の決定 2026年10月25日: ほんの少しだけ間を取る） */
  coopResumeDelaySeconds: z.number().nonnegative().default(0),
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
  /** 今の姿がこの持ち物で進化できるときだけ候補に出す（つながりのヒモ: ゴーリキーになってから。作者の決定 2026年10月25日） */
  onlyWhenEvolves: z.boolean().optional(),
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
  /** コインで買えるポケモン（作者の決定 2026年10月23日）。key は data/game/playables.json のキー。買うと解放される（払い戻しの対象外） */
  pokemon: z.array(z.object({ key: z.string(), cost: z.number().int().positive(), /** 売る地方のショップ（省略時はカントー） */ region: z.string().default('kanto') })).default([]),
  /**
   * カントー以外の地方のショップの解放の条件（作者の決定 07 の48.4: ジョウトはカントーのショップで 50000 コイン以上使う）。
   * 書いていない地方のショップは、その地方が遊べるようになったら開く。強化の種類と値段は全地方で共通（レベルは地方ごと）
   */
  regions: z.record(z.string(), z.object({ unlock: z.lazy(() => statConditionSchema) })).default({}),
  /** 新しいアカウントが最初に持っているコイン（作者の決定 2026年10月25日: 500） */
  startingCoins: z.number().int().nonnegative().default(0),
  /**
   * 値段を変えた強化の、前の基本の費用。起動時に1回だけ（tag ごと。記録 shopRepriced.<tag> で覚える）、
   * 前の値段で使ったコインを全額返してレベルを 0 に戻す（新しい値段で払い戻すと多すぎ・少なすぎになるため）
   */
  repriced: z.object({ tag: z.string().min(1), baseCosts: z.record(z.string(), z.number().int().positive()) }).optional(),
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
      /** 材料の持ち物。省略すると持ち物はいらない（ポリゴン: レベル42で、スピードスターが最大ならトライアタックへ） */
      item: z.string().optional(),
      to: z.string(),
      /** 系統（data/game/playables.json のキー） */
      line: z.string(),
      /** このレベル以上でないと覚えられない（ボルテッカー: レベル50を超える） */
      minLevel: z.number().int().positive().optional(),
      /** 今の姿がこのどれかのときだけ覚えられる（かみなり = ライチュウ。PokeAPI のポケモンの名前） */
      forms: z.array(z.string()).optional(),
      /**
       * ほかにも最大レベルで持っていないといけない技。進化するとき、これらの技は消費されて（なくなって）新しい技に入る
       * （ばくれつパンチ: きあいパンチ・ほのおのパンチ・かみなりパンチ が全部最大。作者の決定 2026年10月25日）
       */
      withMoves: z.array(z.string()).optional(),
      /** 進化するとき、持っていれば消費する（なくなる）技。持っていなくても進化できる（ばくれつパンチ: ほのおのパンチ・かみなりパンチ） */
      consumes: z.array(z.string()).optional(),
      /**
       * 材料にした技（元の技・withMoves・consumes で消費した技）の強化分（レベル − 1）を、すべて新しい技のレベルに足す（最大まで）。
       * ばくれつパンチ: きあいパンチ・ほのおのパンチ・かみなりパンチ の強化を受け継ぐ（作者の決定 2026年10月25日）
       */
      inheritLevels: z.boolean().optional(),
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
 * scenes は画面ごとの曲。ランの区間ごとの曲は地方のステージ（data/regions/<地方>.json）。null は無音
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
});
export type BgmConfig = z.infer<typeof bgmConfigSchema>;
/** ランの曲（地方のステージ data/regions/<地方>.json の sections[].bgm と legendaryBgm から作る） */
export interface BgmRun {
  /** 区間ごとの曲。null は無音 */
  sections: (string | null)[];
  /** 伝説戦 */
  legendary: string | null;
}

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

/**
 * 技のドット絵（自作。npm run move-sprites で計算して作る。作者の案 2026年10月23日）。
 * palette の番号（0〜9）で1文字1ドット（. は透明）。parts は部品（main・start・middle・end）ごとのコマの並び。
 * frameMs ごとに次のコマへ進み、loopFrom があれば最後まで行ったらそのコマから繰り返す
 */
export const moveSpritesSchema = z.object({
  credit: z.string(),
  sprites: z.record(
    z.string(),
    z.object({
      palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).min(1).max(10),
      frameMs: z.number().positive(),
      loopFrom: z.number().int().nonnegative().optional(),
      parts: z.record(z.string(), z.array(z.array(z.string()).min(1)).min(1)),
    }),
  ),
});
export type MoveSpritesData = z.infer<typeof moveSpritesSchema>;

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
  /** 技ごとの絵柄（技の名前・効果から選ぶ。作者の依頼 2026年10月25日）。無い技は出し方（moves）の絵柄 */
  moveGlyphs: z.record(z.string(), z.string()).default({}),
  items: z.record(z.string(), z.object({ glyph: z.string(), color: z.string() })),
  /** タイトルのメニューのアイコン（# の所を文字の色で塗る。作者の依頼 2026年10月24日: 言語を選ぶ設定に、文字が読めなくてもたどり着けるように） */
  menuGlyphs: z.record(z.string(), z.array(z.string())),
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
  /** 段階を決める技（派生のつながりから決まる段階の代わり。プリンの はたく・うたう は最初から覚える技だが、派生技の強さにする） */
  /** 「重い一撃」の技: 同じ出し方の進化でも、再使用が元の技より長くてよい（威力が高い代わりに再使用が長い。ギガインパクト） */
  heavyHitters: z.array(z.string()).default([]),
  tierOverrides: z.record(z.string(), z.enum(['base', 'derived', 'unique'])).default({}),
});
export type MoveBalanceConfig = z.infer<typeof moveBalanceSchema>;
