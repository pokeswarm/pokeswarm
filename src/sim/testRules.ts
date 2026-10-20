import type { SimRules } from './rules';

/** テスト用の定義。data/ に依存させず、テストの意図が読めるように値を直接書く */
export function testRules(
  overrides: { spawn?: Partial<SimRules['spawn']>; attack?: Partial<SimRules['attack']>; pickups?: Partial<SimRules['pickups']> } = {},
): SimRules {
  return {
    enemies: { kinds: [{ id: 'test', hp: 20, moveSpeed: 60, radius: 10 }] },
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
    attack: {
      cooldownSeconds: 0.2,
      range: 400,
      damage: 10,
      pierce: 1,
      projectileSpeed: 500,
      projectileRadius: 5,
      projectileLifetimeSeconds: 1.2,
      maxProjectiles: 128,
      hitMemory: 8,
      effect: 'test',
      ...overrides.attack,
    },
    status: {
      kinds: [
        { id: 'burn', damagePerSecond: 6, speedMultiplier: 1, damageTakenMultiplier: 1, color: '#ff0000' },
        { id: 'freeze', damagePerSecond: 0, speedMultiplier: 0, damageTakenMultiplier: 1, color: '#00ffff' },
        { id: 'defenseDown', damagePerSecond: 0, speedMultiplier: 1, damageTakenMultiplier: 2, color: '#888888' },
      ],
    },
    pickups: { xpPerKill: 1, gemRadius: 6, maxGems: 50, magnetSpeed: 420, bigGemValue: 10, ...overrides.pickups },
  };
}
