import { randomUnit } from '../math';
import { currentWaveIndex, enemyCap, enemyHpScale, type World } from '../world';

/**
 * プレイヤーの周囲（画面外）に雑魚敵を出す。種類・出現数は今の区間、HP は区間とプレイヤーのレベルで決まる。
 * 時間帯の出現数で出し続け、最低数（人数分）より少なければ補充の速さを足す。上限に達していたら出さない。
 */
export function spawnEnemies(world: World): void {
  const { players, enemies, rng } = world;
  // ゲストは出現をホストから受け取る
  if (players.length === 0 || world.role === 'guest' || world.legendary) return;
  const s = world.rules.spawn;
  const kinds = world.rules.enemies.kinds;
  const wave = world.waves[currentWaveIndex(world)]!;
  const fill = enemies.count < wave.minimum * players.length ? (s.fillPerSecond ?? 0) : 0;
  world.spawnAccumulator += (wave.spawnPerSecond + fill) * world.dt;
  const cap = enemyCap(world);
  const hpScale = enemyHpScale(world);
  while (world.spawnAccumulator >= 1) {
    if (enemies.count >= cap) {
      // 空きができても一度にまとめて出さないよう、たまった分は捨てる
      world.spawnAccumulator = 0;
      break;
    }
    world.spawnAccumulator -= 1;
    const p = players[rng.int(players.length)]!;
    const [ux, uy] = randomUnit(rng);
    const dist = rng.range(s.spawnDistanceMin, s.spawnDistanceMax);
    const kindIndex = wave.kinds[rng.int(wave.kinds.length)]!;
    const kind = kinds[kindIndex]!;
    const id = world.nextEnemyId++;
    const x = p.x + ux * dist;
    const y = p.y + uy * dist;
    enemies.add(id, kindIndex, x, y, kind.hp * hpScale, kind.moveSpeed, kind.radius, kind.contactDamage * wave.damageMultiplier);
    world.events.push({ type: 'enemySpawned', id, kind: kindIndex, x, y });
  }
}
