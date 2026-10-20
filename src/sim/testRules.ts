import type { SimRules } from './rules';

/** テスト用の定義。data/ に依存させず、テストの意図が読めるように値を直接書く */
export function testRules(overrides: { spawn?: Partial<SimRules['spawn']>; attack?: Partial<SimRules['attack']> } = {}): SimRules {
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
      overflow: { empowerHpMultiplier: 1.5, maxEmpowerLevel: 5 },
      separation: { strength: 0.5, maxNeighbors: 6 },
      spatialCellSize: 64,
      retireOldWaveKinds: true,
      waves: [{ startSeconds: 0, kinds: ['test'] }],
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
  };
}
