import type { PlayerId } from './commands';
import type { Obstacle } from './obstacles';
import { EnemyStore } from './entities/enemies';
import { GemStore } from './entities/gems';
import type { Player } from './entities/player';
import { ProjectileStore } from './entities/projectiles';
import type { SimEvent } from './events';
import { Rng } from './rng';
import type { StatusKind } from '../data/schema';
import type { SimRules } from './rules';
import { SpatialHash } from './spatial/spatialHash';

/**
 * このブラウザの役割。
 * - solo: すべてをこのブラウザで決める
 * - host: 敵の出現・HP の集計・撃破の確定を担い、結果をゲストへ送る
 * - guest: 敵の出現と撃破はホストから受け取り、自分の攻撃の命中はホストへ伝える
 */
export type SimRole = 'solo' | 'host' | 'guest';

/** レベルアップの候補1つ */
export type UpgradeOffer =
  | { readonly kind: 'moveNew'; readonly move: number }
  | { readonly kind: 'moveUp'; readonly slot: number }
  | { readonly kind: 'itemNew'; readonly item: number }
  | { readonly kind: 'itemUp'; readonly slot: number }
  /** 派生・固有技: slot の技を to に置き換える（材料の持ち物が消える持ち物ならなくなる） */
  | { readonly kind: 'derive'; readonly slot: number; readonly to: number; readonly item: number; readonly unique: boolean }
  /** 候補が1つも無いときだけ出す: HP の回復・コイン（leveling.json の fallback） */
  | { readonly kind: 'heal' }
  | { readonly kind: 'coins' };

/** レベルアップの選択の状態 */
export interface LevelUpState {
  /** レベルアップの回の通し番号（最大レベルの後は level が同じまま続くので、回の区別に使う） */
  readonly serial: number;
  /** 上がった後のレベル */
  readonly level: number;
  /** プレイヤーごとの候補 */
  readonly offers: Map<PlayerId, UpgradeOffer[]>;
  /** 選び終えた（または見送った）プレイヤー */
  readonly done: Set<PlayerId>;
  /** 時間切れまでの残り（更新回数） */
  ticksLeft: number;
  /** 最大レベルの後の回（候補は回復とコインだけ） */
  readonly overMax?: boolean;
  /** 協力プレイで全員が選び終えた後、再開するまでの残り（更新回数） */
  closingTicks?: number;
}

/** マップに落ちる道具の種類 */
export type ItemKind = 'potion' | 'magnet' | 'rare-candy' | 'buff' | 'silver-wing' | 'rainbow-wing';
/** はね（ルギア・ホウオウ戦の権利。箱から出る） */
export type WingKind = 'silver-wing' | 'rainbow-wing';

/** マップの箱（攻撃を当てると開いて、一時的な強化を落とす）。hits は当たった技の当たり判定の通し番号（同じ技で何度も数えない） */
export interface Box {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  hp: number;
  hits: number[];
}

/** ランの結果（disconnected: ホストとの接続が切れて終わった） */
export type RunOutcome = 'clear' | 'fail' | 'disconnected';

/** 伝説戦の結果（won 倒した・lost 全員倒れた・timeUp 逃げられた） */
export type LegendaryResult = 'won' | 'lost' | 'timeUp';

/** ボスの範囲技の予告中の範囲。ticksLeft が 0 になったときに中にいたらダメージを受ける */
/** 範囲技が残した床 */
export interface Zone {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  ticksLeft: number;
  /** 上にいると遅くなる割合（%） */
  readonly slowPct: number;
  /** 上にいると受けるダメージ（1秒あたり。0.5 秒ごとに分けて受ける） */
  readonly damagePerSecond: number;
  readonly color: string;
  /** 残した技の演出（data/effects/recipes.json。控えめな演出を残す） */
  readonly effect: string;
}

export interface Hazard {
  /** 技の番号（stage.moves の並び） */
  readonly move: number;
  readonly shape: 'circle' | 'line' | 'ring';
  /** 輪の内側の半径（輪だけ） */
  readonly innerRadius?: number;
  /** 円の中心・直線の始点（追いかける予告・飛ぶ玉は動く） */
  x: number;
  y: number;
  /** 円の半径・直線の幅の半分 */
  readonly radius: number;
  /** 直線の向き（長さ1）と長さ（追いかける直線は向きが変わる） */
  dirX: number;
  dirY: number;
  readonly length: number;
  /** 突進する敵（直線の技。落ちたときに線に沿って進む。-1 なら突進しない） */
  readonly dasher: number;
  readonly damage: number;
  /** 突進のあと、続けて狙い直す残りの回数 */
  chainLeft?: number;
  ticksLeft: number;
  readonly totalTicks: number;
  /** 落ちた後、まだ当たる残りの更新回数（落ちる前は使わない） */
  activeTicks?: number;
  /** 落ちた後: 自分のプレイヤーにもう当たったか */
  hitLocal?: boolean;
  /** 予告が追いかけるプレイヤー（必中。-1 なら追わない） */
  follow?: number;
}

/** シミュレーションの全状態 */
export interface World {
  tick: number;
  readonly role: SimRole;
  /** このブラウザで操作しているプレイヤー */
  readonly localPlayerId: PlayerId;
  readonly seed: number;
  /** 1回の更新の秒数 */
  readonly dt: number;
  readonly rules: SimRules;
  readonly players: Player[];
  readonly enemies: EnemyStore;
  readonly projectiles: ProjectileStore;
  /** 経験値の玉 */
  readonly gems: GemStore;
  nextGemId: number;
  /** マップに落ちている道具（少ないので配列で持つ）。pending は拾ってホストの確定を待っている（ゲスト） */
  readonly items: { id: number; kind: ItemKind; x: number; y: number; pending: boolean }[];
  nextItemId: number;
  /** マップの箱と、次の箱を出すまでの残り（更新回数。ソロ・ホスト） */
  boxes: Box[];
  /**
   * 伝説がプレイヤーと同じ技を出すための術者（見えないプレイヤー。伝説の敵の id → 術者）と、出す技の残りの時間・甲羅の形か。
   * どのブラウザでも同じように動かす（当たったかは自分のプレイヤーで決める）
   */
  casters: Map<number, Player>;
  /** プレイヤーと同じ技を使う伝説の動き（伝説の敵 id ごと。レッド戦は同時に何体も出る） */
  readonly legendAis: Map<number, { timers: number[]; shellTimers: number[]; shell: boolean; holdTicks?: number }>;
  nextBoxId: number;
  boxTimer: number;
  /** 拾ったふしぎなアメ: 抽選の演出が終わるまでの残りと、上がるレベルの数 */
  readonly candies: { levels: number; ticksLeft: number; by: PlayerId }[];
  /** 全員で共有する経験値の合計（ホストが確定する） */
  xp: number;
  /** 全員で共有するレベルと、次のレベルまでに貯めた経験値 */
  level: number;
  xpIntoLevel: number;
  /** 選択を待っているレベルアップの数（maxLevelUps も含む） */
  pendingLevelUps: number;
  /** そのうち、最大レベルの後に経験値がたまった回（回復かコインを選ぶ） */
  maxLevelUps: number;
  /** 最後に開いたレベルアップの回の通し番号 */
  levelUpSerial: number;
  /** レベルアップの選択中（ゲームは止まっている）。null なら選択中でない */
  levelUp: LevelUpState | null;
  /** ポーズ中（ゲームは止まっている。ソロは自分、協力プレイはホストが決める） */
  paused: boolean;
  /** 敵の空間ハッシュ（毎回作り直す） */
  readonly enemyHash: SpatialHash;
  readonly rng: Rng;
  nextEnemyId: number;
  /** 出現数の端数 */
  spawnAccumulator: number;
  /** この更新で起きた出来事（更新のたびに空にする） */
  readonly events: SimEvent[];
  /** 自分の攻撃のダメージの数字の出来事（damageNumber）を出すか（見た目だけの設定。ランの進み方は変わらない） */
  damageNumbers: boolean;
  readonly stats: { kills: number };
  /** 状態異常の種類（番号は data/game/status.json の並び） */
  readonly statusKinds: readonly StatusKind[];
  /** 区間（時間帯）ごとに出す敵の種類（rules.spawn.waves を種類の番号に直したもの） */
  readonly waves: readonly {
    /** 中ボスのいない区間の長さ（更新回数）。中ボスを倒して進む区間は null */
    readonly durationTicks: number | null;
    readonly hpMultiplier: number;
    readonly damageMultiplier: number;
    readonly xpMultiplier: number;
    readonly spawnPerSecond: number;
    readonly capPerPlayer: number;
    readonly minimum: number;
    readonly kinds: readonly number[];
  }[];
  /** 全員で共有する復活可能数（協力プレイではホストが管理する） */
  revives: number;
  /** 協力プレイ: 倒れたプレイヤーごとの、味方が触れている時間（更新回数） */
  readonly reviveTouch: Map<PlayerId, number>;
  /** ホスト: 復活させた直後のプレイヤー（本人からの「倒れている」がまだ届くので、しばらく無視する。残りの更新回数） */
  readonly reviveGrace: Map<PlayerId, number>;
  /** 回復の円（つきのひかり）。どのブラウザでも出した人の技から作り、中にいる自分のプレイヤーを自分のブラウザで回復する */
  readonly healZones: { x: number; y: number; radius: number; ticks: number; pct: number }[];
  /** ランの結果。決まったらシミュレーションは進まない */
  outcome: RunOutcome | null;
  /** 今の区間（waves の番号）と、始まった更新回数。中ボス（gate）を倒すと次へ進む（ソロ・ホストが決める） */
  section: number;
  sectionStartTick: number;
  /** 出ていて、まだ倒していない、区間を進める中ボスの番号 */
  readonly gateIds: Set<number>;
  /** 出ているタッグのボス（敵の番号 → 区間の番号。同じ区間どうしが組。ソロ・ホスト） */
  readonly tagIds: Map<number, number>;
  /** 中ボス・ボスを出す予定（区間・時間の順）。nextBoss は次に出す予定の番号 */
  readonly bossSchedule: readonly BossEntry[];
  nextBoss: number;
  /** 出ている、範囲技を使う敵（ボス・伝説）と、次の技までの残り・次に使う技（ソロ・ホスト） */
  readonly bosses: {
    id: number;
    cooldown: number;
    interval: number;
    moves: readonly number[];
    next: number;
    random?: boolean;
    /** moves の -1 は、毎回ここからランダムに選ぶ（ミュウ） */
    pool?: readonly number[];
    /** マップの効果の落雷までの残り（更新回数） */
    lightningTimer?: number;
    /** 第2段階（四天王） */
    enrage?: BossEntry['enrage'];
    enraged?: boolean;
  }[];
  /** クリアに必要で、まだ倒していない敵の種類（四天王）。最初の数は requiredTotal */
  readonly requiredLeft: Set<number>;
  readonly requiredTotal: number;
  /** クリアが確定した（四天王を全員倒した）。伝説戦の間も true */
  cleared: boolean;
  /** 伝説戦（クリア後の乱入）。始まっていなければ null */
  legendary: {
    kind: number;
    appearTick: number;
    endTick: number;
    spawned: boolean;
    result: LegendaryResult | null;
    /** 第2段階に入った */
    enraged?: boolean;
    /** 続けて戦うラウンドの番号（stage.json の legendary.rounds の後に bonusRounds が続く）。ラウンドの無い伝説戦は 0 */
    round?: number;
  } | null;
  /** 伝説の乱入（三犬）: 出ている伝説（出る前は id -1）と逃げる時刻。乱入が終わったら done。次に確かめる乱入の分の番号 */
  intruder: { kind: number; id: number; appearTick: number; endTick: number; done: boolean } | null;
  nextIntruderCheck: number;
  /** はねが箱から出るようになっている（参加者のだれかが実績を達成）。ランを始める前に入れる */
  wingsEnabled: Set<WingKind>;
  /** このランで拾ったはね（ルギア・ホウオウ戦の権利） */
  readonly wings: Set<WingKind>;
  /** 伝説戦に、相性で選ぶ候補（stage.json の legendary.counter。色違いの御三家）を足す（参加者のだれかが条件の実績を達成している）。ランを始める前に入れる */
  legendaryCounter: boolean;
  /** スウォームイベントの予定（更新回数の順）と、次に出す番号 */
  readonly swarmSchedule: readonly { readonly tick: number; readonly swarm: number }[];
  nextSwarm: number;
  /** 予告中の範囲 */
  readonly hazards: Hazard[];
  /** 範囲技が残した床（凍った床・燃える地面）。どのブラウザでも範囲技から同じものを作る */
  readonly zones: Zone[];
  /** マップの障害物（マスごと。シードから計算したものを覚えておく） */
  readonly obstacleCache: Map<number, Obstacle | null>;
  /** 転がってきている、まだ爆発を始めていない敵（ビリリダマ）→ スウォームの番号（ソロ・ホスト） */
  readonly bombers: Map<number, number>;
  /** 近傍検索の作業用（更新中にメモリを確保しないため） */
  readonly scratch: Int32Array;
  /** 発射体の命中候補の作業用 */
  readonly hitScratch: Int32Array;
  /** 押し合いの近傍検索の作業用（小さくして、密集時に集めすぎないようにする） */
  readonly neighborScratch: Int32Array;
}

export function createWorld(tickRate: number, seed: number, rules: SimRules, role: SimRole, localPlayerId: PlayerId): World {
  // ゲストは、ホストで倒されたが撃破の知らせがまだ届いていない敵を持つため、上限より多くなりうる。
  // 入れ物があふれて出現を取りこぼさないよう、余裕を持たせる
  const capacity = role === 'guest' ? rules.spawn.capGlobal * 2 : rules.spawn.capGlobal;
  return {
    tick: 0,
    role,
    localPlayerId,
    seed,
    dt: 1 / tickRate,
    rules,
    players: [],
    enemies: new EnemyStore(capacity, rules.status.kinds.length),
    statusKinds: rules.status.kinds,
    // ゲストは、拾ってホストの確定を待っている玉の分だけホストより多くなりうるので余裕を持たせる
    gems: new GemStore(role === 'guest' ? rules.pickups.maxGems * 2 : rules.pickups.maxGems),
    nextGemId: 1,
    items: [],
    nextItemId: 1,
    boxes: [],
    casters: new Map(),
    legendAis: new Map(),
    nextBoxId: 1,
    boxTimer: Math.round((rules.pickups.boxes?.firstSpawnSeconds ?? 0) * tickRate),
    candies: [],
    xp: 0,
    revives: rules.stats.revive.initialCount,
    outcome: null,
    reviveTouch: new Map(),
    reviveGrace: new Map(),
    healZones: [],
    section: 0,
    sectionStartTick: 0,
    gateIds: new Set(),
    tagIds: new Map(),
    bossSchedule: buildBossSchedule(rules, tickRate),
    nextBoss: 0,
    bosses: [],
    requiredLeft: new Set(rules.stage.bosses.filter((b) => b.required).map((b) => kindIndexOf(rules, b.kind))),
    requiredTotal: rules.stage.bosses.filter((b) => b.required).length,
    cleared: false,
    legendary: null,
    legendaryCounter: false,
    intruder: null,
    nextIntruderCheck: 0,
    wingsEnabled: new Set(),
    wings: new Set(),
    swarmSchedule: buildSwarmSchedule(rules, tickRate),
    nextSwarm: 0,
    hazards: [],
    zones: [],
    obstacleCache: new Map(),
    bombers: new Map(),
    level: 1,
    xpIntoLevel: 0,
    pendingLevelUps: 0,
    maxLevelUps: 0,
    levelUpSerial: 0,
    levelUp: null,
    paused: false,
    projectiles: new ProjectileStore(rules.combat.maxProjectiles, rules.combat.hitMemory),
    enemyHash: new SpatialHash(rules.spawn.spatialCellSize, capacity),
    rng: new Rng(seed),
    nextEnemyId: 1,
    spawnAccumulator: 0,
    events: [],
    damageNumbers: false,
    stats: { kills: 0 },
    waves: rules.spawn.waves.map((w) => ({
      durationTicks: w.durationSeconds ? Math.round(w.durationSeconds * tickRate) : null,
      hpMultiplier: w.hpMultiplier,
      damageMultiplier: w.damageMultiplier,
      xpMultiplier: w.xpMultiplier ?? 1,
      spawnPerSecond: w.spawnPerSecond ?? rules.spawn.spawnPerSecond,
      capPerPlayer: w.capPerPlayer ?? rules.spawn.capPerPlayer,
      minimum: w.minimum ?? 0,
      kinds: w.kinds.map((id) => {
        const i = rules.enemies.kinds.findIndex((k) => k.id === id);
        if (i === -1) throw new Error(`敵の種類 ${id} がありません`);
        return i;
      }),
    })),
    scratch: new Int32Array(capacity * 2),
    hitScratch: new Int32Array(capacity * 2),
    neighborScratch: new Int32Array(Math.max(8, rules.spawn.separation.maxNeighbors * 4)),
  };
}

function kindIndexOf(rules: SimRules, id: string): number {
  const i = rules.enemies.kinds.findIndex((k) => k.id === id);
  if (i === -1) throw new Error(`敵の種類 ${id} がありません`);
  return i;
}

/** 中ボス・ボスを出す予定の1つ */
export interface BossEntry {
  /** 区間の番号と、区間が始まってから出すまでの更新回数 */
  readonly wave: number;
  readonly afterTicks: number;
  /** 倒すと次の区間へ */
  readonly gate: boolean;
  readonly kind: number;
  /** 使う範囲技（stage.moves の番号）を順に使う */
  readonly moves: readonly number[];
  readonly interval: number;
  /** 第2段階（HP の割合・技の間隔の更新回数・2つ同時に使う確率）。無ければ null */
  readonly enrage: { readonly hpRatio: number; readonly interval: number; readonly doubleChance: number } | null;
  /** タッグバトル（ホウエン）: 同じ区間の tag のボスと組になる */
  readonly tag: boolean;
}

export function moveIndexOfStage(rules: SimRules, id: string): number {
  const i = rules.stage.moves.findIndex((m) => m.id === id);
  if (i === -1) throw new Error(`範囲技 ${id} がありません`);
  return i;
}

/** 中ボス・ボスを出す予定（stage.bosses）。区間・時間の順 */
function buildBossSchedule(rules: SimRules, tickRate: number): BossEntry[] {
  return rules.stage.bosses
    .map((b) => ({
      wave: b.wave,
      afterTicks: Math.round(b.afterSeconds * tickRate),
      gate: b.gate,
      kind: kindIndexOf(rules, b.kind),
      moves: b.moves.map((id) => moveIndexOfStage(rules, id)),
      interval: Math.round((b.moveIntervalSeconds ?? 4) * tickRate),
      enrage: b.enrage ? { hpRatio: b.enrage.hpRatio, interval: Math.round(b.enrage.moveIntervalSeconds * tickRate), doubleChance: b.enrage.doubleChance } : null,
      tag: b.tag ?? false,
    }))
    .sort((a, b) => a.wave - b.wave || a.afterTicks - b.afterTicks);
}

/** スウォームイベントの予定（atSeconds から everySeconds ごと、untilSeconds まで） */
function buildSwarmSchedule(rules: SimRules, tickRate: number): { tick: number; swarm: number }[] {
  const out: { tick: number; swarm: number }[] = [];
  rules.stage.swarms.forEach((s, swarm) => {
    for (let at = s.atSeconds; at <= s.untilSeconds; at += s.everySeconds) out.push({ tick: Math.round(at * tickRate), swarm });
  });
  return out.sort((a, b) => a.tick - b.tick);
}

/** ランの経過秒数（レベルアップの選択で止まっている間は進まない） */
export function elapsedSeconds(world: World): number {
  return world.tick * world.dt;
}

export function findPlayer(world: World, id: PlayerId): Player | undefined {
  return world.players.find((p) => p.id === id);
}

/** 実際の敵の上限: min(全体の上限, 今の時間帯の1人あたりの上限 × 人数) */
export function enemyCap(world: World): number {
  const wave = world.waves[currentWaveIndex(world)]!;
  return Math.min(world.rules.spawn.capGlobal, wave.capPerPlayer * world.players.length);
}

export function findEnemyIndex(world: World, id: number): number {
  const e = world.enemies;
  for (let i = 0; i < e.count; i++) if (e.id[i] === id) return i;
  return -1;
}

/** 今の区間（時間帯）の番号 */
export function currentWaveIndex(world: World): number {
  return world.section;
}

/**
 * 次の区間に進むまでの目安の更新回数（スプライトの先読み用）。中ボスで進む区間は中ボスが出るまで、
 * 時間で進む区間は残り時間。最後の区間は null
 */
export function ticksUntilNextSection(world: World): number | null {
  if (world.section >= world.waves.length - 1) return null;
  const inSection = world.tick - world.sectionStartTick;
  const duration = world.waves[world.section]!.durationTicks;
  if (duration !== null) return Math.max(0, duration - inSection);
  const gate = world.bossSchedule.find((b) => b.wave === world.section && b.gate);
  return gate ? Math.max(0, gate.afterTicks - inSection) : null;
}

/** 雑魚の HP の倍率: 区間の倍率 × プレイヤーのレベル（全員で共有）による倍率 */
export function enemyHpScale(world: World): number {
  const wave = world.waves[world.section]!;
  const extra = Math.max(0, world.players.length - 1);
  // 倒したジムリーダーの数（区間は中ボスを倒すと進む。四天王の区間は数えない）
  const gyms = Math.min(world.section, world.rules.stage.bosses.filter((b) => b.gate).length);
  const gymScale = 1 + (world.rules.spawn.hpPerTwoGymsPct * Math.floor(gyms / 2)) / 100;
  return gymScale * wave.hpMultiplier * (1 + (world.rules.spawn.hpPerLevelPct * (world.level - 1)) / 100) * (1 + (world.rules.spawn.perExtraPlayer.hpPct * extra) / 100);
}
