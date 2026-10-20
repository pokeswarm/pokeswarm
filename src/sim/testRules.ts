import type { MoveStats, SimMoveDef } from './moves';
import type { SimRules } from './rules';

/** テスト用の技の性能（一番近い敵へ1発ずつ撃つ、仮の自動攻撃と同じ動き） */
export const TEST_MOVE: MoveStats = {
  power: 10,
  cooldownSeconds: 0.2,
  count: 1,
  intervalSeconds: 0,
  speed: 500,
  size: 5,
  range: 400,
  durationSeconds: 1.2,
  pierce: 1,
  hitIntervalSeconds: 0,
  knockback: 0,
  knockbackSeconds: 0,
  status: -1,
  statusChance: 0,
  statusSeconds: 0,
};

/** テスト用のタイプ: 0 ノーマル、1 ほのお、2 くさ、3 みず（ほのお → くさ がばつぐん、など） */
const TYPES = {
  names: ['normal', 'fire', 'grass', 'water'],
  chart: [
    [1, 1, 1, 1],
    [1, 0.5, 2, 0.5],
    [1, 0.5, 0.5, 2],
    [1, 2, 0.5, 0.5],
  ],
};

/** テスト用の定義。data/ に依存させず、テストの意図が読めるように値を直接書く */
export function testRules(
  overrides: {
    spawn?: Partial<SimRules['spawn']>;
    /** 技（番号0、ノーマルタイプ）の性能の上書き */
    move?: Partial<MoveStats>;
    pickups?: Partial<SimRules['pickups']>;
    /** 追加の技 */
    extraMoves?: SimMoveDef[];
  } = {},
): SimRules {
  const testMove: SimMoveDef = {
    key: 'test-shot',
    pattern: 'nearest',
    type: 0,
    damageClass: 'special',
    levels: [{ ...TEST_MOVE, ...overrides.move }],
    effect: 'test',
  };
  return {
    enemies: { kinds: [{ id: 'test', hp: 20, moveSpeed: 60, radius: 10, types: [0] }] },
    spawn: {
      spawnPerSecond: 0,
      spawnDistanceMin: 450,
      spawnDistanceMax: 550,
      relocateDistance: 900,
      relocateSideSpread: 400,
      capGlobal: 100,
      capPerPlayer: 100,
      separation: { strength: 0.5, maxNeighbors: 6 },
      spatialCellSize: 64,
      retireOldWaveKinds: true,
      waves: [{ startSeconds: 0, hpMultiplier: 1, kinds: ['test'] }],
      ...overrides.spawn,
    },
    status: {
      kinds: [
        { id: 'burn', damagePerSecond: 6, speedMultiplier: 1, damageTakenMultiplier: 1, color: '#ff0000' },
        { id: 'freeze', damagePerSecond: 0, speedMultiplier: 0, damageTakenMultiplier: 1, color: '#00ffff' },
        { id: 'defenseDown', damagePerSecond: 0, speedMultiplier: 1, damageTakenMultiplier: 2, color: '#888888' },
      ],
    },
    pickups: { xpPerKill: 1, gemRadius: 6, maxGems: 50, magnetSpeed: 420, bigGemValue: 10, ...overrides.pickups },
    combat: {
      maxProjectiles: 128,
      hitMemory: 8,
      typeMultipliers: { stab: 1.1, superEffective: 1.2, notVeryEffective: 0.8 },
      maxMoveSlots: 4,
    },
    moves: [testMove, ...(overrides.extraMoves ?? [])],
    types: TYPES,
  };
}

/** テスト用: 指定の出し方・性能の技を作る */
export function testMove(key: string, pattern: SimMoveDef['pattern'], stats: Partial<MoveStats>, type = 0): SimMoveDef {
  return { key, pattern, type, damageClass: 'special', levels: [{ ...TEST_MOVE, ...stats }], effect: 'test' };
}
