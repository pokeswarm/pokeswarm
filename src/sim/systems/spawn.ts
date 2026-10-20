import { randomUnit } from '../math';
import { enemyCap, type World } from '../world';

/** プレイヤーの周囲（画面外）に雑魚敵を出す。上限に達していたら既存の敵を強化する（仮） */
export function spawnEnemies(world: World): void {
  const { players, enemies, rng } = world;
  if (players.length === 0) return;
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
    enemies.add(world.nextEnemyId++, kindIndex, p.x + ux * dist, p.y + uy * dist, kind.hp, kind.moveSpeed, kind.radius);
  }
}

function empowerRandomEnemy(world: World): void {
  const { enemies, rng } = world;
  if (enemies.count === 0) return;
  const o = world.rules.spawn.overflow;
  const i = rng.int(enemies.count);
  if (enemies.empower[i]! >= o.maxEmpowerLevel) return;
  enemies.empower[i]!++;
  enemies.maxHp[i]! *= o.empowerHpMultiplier;
  enemies.hp[i]! *= o.empowerHpMultiplier;
  world.stats.empowered++;
}
