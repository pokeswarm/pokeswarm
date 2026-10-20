import { randomUnit } from '../math';
import { findEnemyIndex, type World } from '../world';
import { hurtPlayer } from './health';

/** 敵の種類が中ボス・ボスか */
export function isBossKind(world: World, kind: number): boolean {
  return (world.rules.enemies.kinds[kind]?.rank ?? 'normal') !== 'normal';
}

/**
 * 予定の時間になったら中ボス・ボスを出す（ソロ・ホスト。ゲストは出現の知らせで受け取る）。
 * HP は参加人数に応じて上げる（01_game_design.md 2.2）。
 */
export function spawnBosses(world: World): void {
  if (world.role === 'guest' || world.players.length === 0) return;
  const rules = world.rules.stage.bossRules;
  while (world.nextBoss < world.bossSchedule.length && world.bossSchedule[world.nextBoss]!.tick <= world.tick) {
    const { kind: kindIndex } = world.bossSchedule[world.nextBoss++]!;
    const kind = world.rules.enemies.kinds[kindIndex]!;
    const p = world.players[world.rng.int(world.players.length)]!;
    const [ux, uy] = randomUnit(world.rng);
    const x = p.x + ux * rules.spawnDistance;
    const y = p.y + uy * rules.spawnDistance;
    const hp = kind.hp * (1 + (rules.hpPerExtraPlayerPct * (world.players.length - 1)) / 100);
    const id = world.nextEnemyId++;
    if (world.enemies.add(id, kindIndex, x, y, hp, kind.moveSpeed, kind.radius, kind.contactDamage) === -1) continue;
    world.events.push({ type: 'enemySpawned', id, kind: kindIndex, x, y });
    world.events.push({ type: 'bossAppeared', id, kind: kindIndex });
    if (kind.rank === 'boss' && world.rules.stage.boss) {
      world.bosses.push({ id, cooldown: Math.round(world.rules.stage.boss.move.intervalSeconds / world.dt) });
    }
  }
}

/**
 * ボスの範囲技: 一番近いプレイヤーの足元に範囲を予告し、時間が来たら落とす。
 * 予告を作るのはソロ・ホスト。落ちたときに中にいたかは自分のブラウザで判定する。
 */
export function bossAttacks(world: World): void {
  const move = world.rules.stage.boss?.move;
  if (move && world.role !== 'guest') {
    for (let b = world.bosses.length - 1; b >= 0; b--) {
      const boss = world.bosses[b]!;
      const i = findEnemyIndex(world, boss.id);
      if (i === -1 || world.enemies.hp[i]! <= 0) {
        world.bosses.splice(b, 1);
        continue;
      }
      if (--boss.cooldown > 0) continue;
      boss.cooldown = Math.round(move.intervalSeconds / world.dt);
      const target = nearestPlayer(world, world.enemies.x[i]!, world.enemies.y[i]!);
      if (!target) continue;
      for (let c = 0; c < move.count; c++) {
        // 1つ目は足元、2つ目以降はばらつかせる（動かないと当たり、動けば避けられる）
        const [ux, uy] = c === 0 ? [0, 0] : randomUnit(world.rng);
        const dist = c === 0 ? 0 : world.rng.range(move.radius, move.spread + move.radius);
        addHazard(world, target.x + ux * dist, target.y + uy * dist);
      }
    }
  }
  const me = world.players.find((p) => p.id === world.localPlayerId);
  for (let h = world.hazards.length - 1; h >= 0; h--) {
    const hz = world.hazards[h]!;
    if (--hz.ticksLeft > 0) continue;
    world.hazards.splice(h, 1);
    world.events.push({ type: 'hazardStruck', x: hz.x, y: hz.y, radius: hz.radius, effect: hz.effect });
    if (!me || me.down || me.invincibleTicks > 0) continue;
    const r = hz.radius + me.radius;
    if ((me.x - hz.x) ** 2 + (me.y - hz.y) ** 2 <= r * r) hurtPlayer(world, me, hz.damage);
  }
}

/** ボスの範囲技の予告を置く（ホストが決め、ゲストには知らせで届く） */
export function addHazard(world: World, x: number, y: number): void {
  const move = world.rules.stage.boss?.move;
  if (!move) return;
  const ticks = Math.round(move.telegraphSeconds / world.dt);
  world.hazards.push({ x, y, radius: move.radius, damage: move.damage, ticksLeft: ticks, totalTicks: ticks, effect: move.effect });
  world.events.push({ type: 'hazardTelegraphed', x, y, radius: move.radius });
}

function nearestPlayer(world: World, x: number, y: number): World['players'][number] | null {
  let best = Infinity;
  let out: World['players'][number] | null = null;
  for (const p of world.players) {
    if (p.down) continue;
    const d2 = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d2 < best) {
      best = d2;
      out = p;
    }
  }
  return out;
}

/**
 * ランの終わりを判定する。倒れた敵が取り除かれる前に呼ぶ。
 * - クリア: ボスを倒した
 * - 失敗: 全員が倒れた（復活可能数が残っていれば自動で復活するので、倒れている = 残っていない）
 */
export function checkRunEnd(world: World): void {
  // ゲストはホストの決定（endRun）に合わせる
  if (world.outcome || world.role === 'guest') return;
  for (const ev of world.events) {
    if (ev.type !== 'enemyKilled') continue;
    const i = findEnemyIndex(world, ev.enemyId);
    if (i !== -1 && world.rules.enemies.kinds[world.enemies.kind[i]!]?.rank === 'boss') {
      endRun(world, 'clear');
      return;
    }
  }
  if (world.players.length > 0 && world.players.every((p) => p.down)) endRun(world, 'fail');
}

export function endRun(world: World, outcome: 'clear' | 'fail' | 'disconnected'): void {
  if (world.outcome) return;
  world.outcome = outcome;
  world.hazards.length = 0;
  world.events.push({ type: 'runEnded', outcome });
}
