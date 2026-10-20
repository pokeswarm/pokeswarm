import { randomUnit } from '../math';
import { enemyCap, type World } from '../world';

/** プレイヤーの周囲（画面外）に雑魚敵を出す。上限に達していたら既存の敵を強化する（仮） */
export function spawnEnemies(world: World): void {
  const { players, enemies, rng } = world;
  // ゲストは出現をホストから受け取る
  if (players.length === 0 || world.role === 'guest') return;
  const s = world.rules.spawn;
  const kinds = world.rules.enemies.kinds;
  world.spawnAccumulator += s.spawnPerSecond * world.dt;
  const cap = enemyCap(world);
  while (world.spawnAccumulator >= 1) {
    world.spawnAccumulator -= 1;
    if (enemies.count >= cap) {
      empowerRandomEnemy(world);
      continue;
    }
    const p = players[rng.int(players.length)]!;
    const [ux, uy] = randomUnit(rng);
    const dist = rng.range(s.spawnDistanceMin, s.spawnDistanceMax);
    const kindIndex = rng.int(kinds.length);
    const kind = kinds[kindIndex]!;
    const id = world.nextEnemyId++;
    const x = p.x + ux * dist;
    const y = p.y + uy * dist;
    enemies.add(id, kindIndex, x, y, kind.hp, kind.moveSpeed, kind.radius);
    world.events.push({ type: 'enemySpawned', id, kind: kindIndex, x, y });
  }
}

function empowerRandomEnemy(world: World): void {
  const { enemies, rng } = world;
  if (enemies.count === 0) return;
  const o = world.rules.spawn.overflow;
  const i = rng.int(enemies.count);
  if (enemies.empower[i]! >= o.maxEmpowerLevel) return;
  enemies.empower[i]!++;
  world.events.push({ type: 'enemyEmpowered', id: enemies.id[i]!, level: enemies.empower[i]! });
  enemies.maxHp[i]! *= o.empowerHpMultiplier;
  enemies.hp[i]! *= o.empowerHpMultiplier;
  world.stats.empowered++;
}
