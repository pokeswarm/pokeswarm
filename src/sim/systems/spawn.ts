import { randomUnit } from '../math';
import type { Player } from '../entities/player';
import { currentWaveIndex, enemyCap, enemyHpScale, type World } from '../world';

/**
 * (x, y) が、どのプレイヤーからも r 以上離れているか（全員の周りの半径 r の円の和集合の外か）。
 * 協力プレイで、別のプレイヤーの目の前に雑魚が出ないようにする（作者の指摘 2026年10月28日）
 */
export function clearOfPlayers(players: readonly Player[], x: number, y: number, r: number): boolean {
  const r2 = r * r;
  return players.every((p) => (p.x - x) ** 2 + (p.y - y) ** 2 >= r2);
}

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
  // 協力プレイでは人数に応じて出現を速くする（上限も人数分に増える）
  const extra = (s.perExtraPlayer.spawnPct * (players.length - 1)) / 100;
  world.spawnAccumulator += (wave.spawnPerSecond * (1 + extra) + fill) * world.dt;
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
    let [ux, uy] = randomUnit(rng);
    let dist = rng.range(s.spawnDistanceMin, s.spawnDistanceMax);
    // ほかのプレイヤーの近くになったら選び直す（選び直せなければ最後の場所）
    for (let k = 0; players.length > 1 && k < (s.spawnRetries ?? 0) && !clearOfPlayers(players, p.x + ux * dist, p.y + uy * dist, s.spawnDistanceMin); k++) {
      [ux, uy] = randomUnit(rng);
      dist = rng.range(s.spawnDistanceMin, s.spawnDistanceMax);
    }
    const kindIndex = wave.kinds[rng.int(wave.kinds.length)]!;
    const kind = kinds[kindIndex]!;
    const id = world.nextEnemyId++;
    const x = p.x + ux * dist;
    const y = p.y + uy * dist;
    enemies.add(id, kindIndex, x, y, kind.hp * hpScale, kind.moveSpeed, kind.radius, kind.contactDamage * wave.damageMultiplier);
    world.events.push({ type: 'enemySpawned', id, kind: kindIndex, x, y });
  }
}
