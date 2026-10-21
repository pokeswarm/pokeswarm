import type { BossMove } from '../../data/schema';
import { randomUnit } from '../math';
import { currentWaveIndex, enemyHpScale, findEnemyIndex, type LegendaryResult, type World } from '../world';
import { hurtPlayer } from './health';

/**
 * ステージの進行（01_game_design.md 7章。2026年10月の作者の決定）:
 * - 中ボス（ジムリーダーの相棒）を2分ごと、四天王を17:00〜18:30 に30秒ごとに出す（data/game/stage.json の bosses）
 * - 四天王（required）を全員倒したらクリア。制限時間（20分）までに倒せなければ失敗
 * - クリアしたら、確率で伝説が乱入する（「DANGER」の後、雑魚が消えて伝説と戦う。負けても失うものはない）
 * - スウォームイベント（突進してくる群れ・囲んでくる群れ）を定期的に出す
 * 敵を出す・技を使う・進行を決めるのはソロ・ホスト。ゲストは知らせで受け取る。
 */

/** 敵の種類が中ボス・ボス・伝説か */
export function isBossKind(world: World, kind: number): boolean {
  return (world.rules.enemies.kinds[kind]?.rank ?? 'normal') !== 'normal';
}

/** ボス・伝説を出す。HP は参加人数に応じて上げる（2.2）。出せなければ -1 */
function spawnBoss(world: World, kindIndex: number, moves: readonly number[], interval: number): number {
  const rules = world.rules.stage.bossRules;
  const kind = world.rules.enemies.kinds[kindIndex]!;
  const p = world.players[world.rng.int(world.players.length)]!;
  const [ux, uy] = randomUnit(world.rng);
  const x = p.x + ux * rules.spawnDistance;
  const y = p.y + uy * rules.spawnDistance;
  const hp = kind.hp * (1 + (rules.hpPerExtraPlayerPct * (world.players.length - 1)) / 100);
  const id = world.nextEnemyId++;
  if (world.enemies.add(id, kindIndex, x, y, hp, kind.moveSpeed, kind.radius, kind.contactDamage) === -1) return -1;
  world.events.push({ type: 'enemySpawned', id, kind: kindIndex, x, y });
  world.events.push({ type: 'bossAppeared', id, kind: kindIndex });
  if (moves.length > 0) world.bosses.push({ id, cooldown: interval, interval, moves, next: 0 });
  return id;
}

/** 区間が始まって予定の時間がたったら中ボス・ボスを出す。伝説戦では伝説を出す */
export function spawnBosses(world: World): void {
  if (world.role === 'guest' || world.players.length === 0) return;
  const lg = world.legendary;
  if (lg) {
    if (!lg.spawned && world.tick >= lg.appearTick) {
      lg.spawned = true;
      const cfg = world.rules.stage.legendary!;
      spawnBoss(
        world,
        lg.kind,
        cfg.moves.map((id) => world.rules.stage.moves.findIndex((m) => m.id === id)),
        Math.round(cfg.moveIntervalSeconds / world.dt),
      );
    }
    return;
  }
  const inSection = world.tick - world.sectionStartTick;
  while (world.nextBoss < world.bossSchedule.length) {
    const b = world.bossSchedule[world.nextBoss]!;
    if (b.wave > world.section || (b.wave === world.section && b.afterTicks > inSection)) break;
    world.nextBoss++;
    const id = spawnBoss(world, b.kind, b.moves, b.interval);
    // 出せなかった（敵の上限）中ボスは、次の更新で出し直す
    if (id === -1 && b.gate) {
      world.nextBoss--;
      break;
    }
    if (b.gate) world.gateIds.add(id);
  }
}

/**
 * 区間の進行（作者の決定。2026年10月）: その区間の中ボス（gate）を倒したら次の区間へ進む。
 * 雑魚の種類・地面・次の中ボスがまとめて進む。中ボスのいない区間は時間で進む。ソロ・ホストが決める
 */
export function advanceSection(world: World): void {
  if (world.role === 'guest' || world.legendary || world.section >= world.waves.length - 1) return;
  for (const ev of world.events) if (ev.type === 'enemyKilled') world.gateIds.delete(ev.enemyId);
  const duration = world.waves[world.section]!.durationTicks;
  let done: boolean;
  if (duration !== null) {
    done = world.tick - world.sectionStartTick >= duration;
  } else {
    // この区間の中ボスがすべて出て、すべて倒れた
    const pending = world.bossSchedule.some((b, i) => b.wave === world.section && b.gate && i >= world.nextBoss);
    done = !pending && world.gateIds.size === 0;
  }
  if (!done) return;
  world.section++;
  world.sectionStartTick = world.tick;
  world.events.push({ type: 'sectionAdvanced', section: world.section });
}

/** スウォームイベント（ソロ・ホスト）。伝説戦の間は出さない */
export function spawnSwarms(world: World): void {
  if (world.role === 'guest' || world.players.length === 0 || world.legendary) return;
  while (world.nextSwarm < world.swarmSchedule.length && world.swarmSchedule[world.nextSwarm]!.tick <= world.tick) {
    const swarm = world.swarmSchedule[world.nextSwarm++]!.swarm;
    const s = world.rules.stage.swarms[swarm]!;
    const kindIndex = world.rules.enemies.kinds.findIndex((k) => k.id === s.kind);
    const kind = world.rules.enemies.kinds[kindIndex];
    if (!kind) continue;
    const wave = world.waves[currentWaveIndex(world)]!;
    const hpScale = enemyHpScale(world);
    const p = world.players[world.rng.int(world.players.length)]!;
    const [ux, uy] = randomUnit(world.rng);
    const add = (x: number, y: number, vx = 0, vy = 0): void => {
      const id = world.nextEnemyId++;
      const hp = kind.hp * hpScale;
      if (world.enemies.add(id, kindIndex, x, y, hp, kind.moveSpeed, kind.radius, kind.contactDamage * wave.damageMultiplier, vx, vy) === -1) return;
      world.events.push({ type: 'enemySpawned', id, kind: kindIndex, x, y, vx, vy });
    };
    if (s.pattern === 'rush') {
      // 画面の外（ux, uy の向き）から、プレイヤーのいる場所を通り抜ける向きにまっすぐ進む。横に並べて群れにする
      const dist = world.rules.spawn.spawnDistanceMin;
      const speed = s.speed ?? kind.moveSpeed;
      const spacing = s.spacing ?? kind.radius * 2;
      const cols = Math.ceil(Math.sqrt(s.count));
      for (let k = 0; k < s.count; k++) {
        const side = ((k % cols) - (cols - 1) / 2) * spacing;
        const back = Math.floor(k / cols) * spacing;
        // 横方向（-uy, ux）に並べ、後ろの列は少し遠くから
        add(p.x + ux * (dist + back) - uy * side, p.y + uy * (dist + back) + ux * side, -ux * speed, -uy * speed);
      }
    } else {
      // プレイヤーの周りにぐるりと出す
      const radius = s.radius ?? world.rules.spawn.spawnDistanceMin;
      const start = Math.atan2(uy, ux);
      for (let k = 0; k < s.count; k++) {
        const a = start + (k / s.count) * Math.PI * 2;
        add(p.x + Math.cos(a) * radius, p.y + Math.sin(a) * radius);
      }
    }
    world.events.push({ type: 'swarmStarted', swarm });
  }
}

/**
 * ボス・伝説の範囲技: 技を順に使い、範囲を予告して、時間が来たら落とす。
 * 予告を作るのはソロ・ホスト。落ちたときに中にいたかは自分のブラウザで判定する。
 */
export function bossAttacks(world: World): void {
  if (world.role !== 'guest') {
    for (let b = world.bosses.length - 1; b >= 0; b--) {
      const boss = world.bosses[b]!;
      const i = findEnemyIndex(world, boss.id);
      if (i === -1 || world.enemies.hp[i]! <= 0) {
        world.bosses.splice(b, 1);
        continue;
      }
      if (--boss.cooldown > 0) continue;
      boss.cooldown = boss.interval;
      const moveIdx = boss.moves[boss.next++ % boss.moves.length]!;
      const move = world.rules.stage.moves[moveIdx];
      if (!move) continue;
      const bx = world.enemies.x[i]!;
      const by = world.enemies.y[i]!;
      const target = nearestPlayer(world, bx, by);
      if (!target) continue;
      if (move.shape === 'line') {
        // 自分から狙ったプレイヤーへ向かう直線
        const dx = target.x - bx;
        const dy = target.y - by;
        const len = Math.hypot(dx, dy) || 1;
        addHazard(world, moveIdx, bx, by, dx / len, dy / len, move.dashSpeed ? boss.id : -1);
      } else if (move.target === 'self') {
        addHazard(world, moveIdx, bx, by, 0, 0, -1);
      } else {
        for (let c = 0; c < move.count; c++) {
          // 1つ目は足元、2つ目以降はばらつかせる（動かないと当たり、動けば避けられる）
          const [ux, uy] = c === 0 ? [0, 0] : randomUnit(world.rng);
          const dist = c === 0 ? 0 : world.rng.range(move.radius, move.spread + move.radius);
          addHazard(world, moveIdx, target.x + ux * dist, target.y + uy * dist, 0, 0, -1);
        }
      }
    }
  }
  const me = world.players.find((p) => p.id === world.localPlayerId);
  for (let h = world.hazards.length - 1; h >= 0; h--) {
    const hz = world.hazards[h]!;
    if (--hz.ticksLeft > 0) continue;
    world.hazards.splice(h, 1);
    const move = world.rules.stage.moves[hz.move];
    world.events.push({
      type: 'hazardStruck',
      x: hz.x,
      y: hz.y,
      radius: hz.radius,
      effect: move?.effect ?? '',
      shape: hz.shape,
      dirX: hz.dirX,
      dirY: hz.dirY,
      length: hz.length,
    });
    // 突進: 線に沿って進む（ノックバックの仕組みで動かす。ホストが動かし、位置はゲストへ送る）
    if (hz.dasher !== -1 && move?.dashSpeed && world.role !== 'guest') {
      const i = findEnemyIndex(world, hz.dasher);
      if (i !== -1) world.enemies.knockBack(i, hz.dirX * move.dashSpeed, hz.dirY * move.dashSpeed, Math.round(hz.length / move.dashSpeed / world.dt));
    }
    if (!me || me.down || me.invincibleTicks > 0) continue;
    if (hazardHits(hz, me.x, me.y, me.radius)) hurtPlayer(world, me, hz.damage);
  }
}

/** 範囲に入っているか（円・直線） */
export function hazardHits(
  hz: { shape: 'circle' | 'line'; x: number; y: number; radius: number; dirX: number; dirY: number; length: number },
  x: number,
  y: number,
  r: number,
): boolean {
  if (hz.shape === 'circle') return (x - hz.x) ** 2 + (y - hz.y) ** 2 <= (hz.radius + r) ** 2;
  const t = Math.max(0, Math.min(hz.length, (x - hz.x) * hz.dirX + (y - hz.y) * hz.dirY));
  const px = hz.x + hz.dirX * t;
  const py = hz.y + hz.dirY * t;
  return (x - px) ** 2 + (y - py) ** 2 <= (hz.radius + r) ** 2;
}

/** 範囲技の予告を置く（ホストが決め、ゲストには知らせで届く） */
export function addHazard(world: World, moveIdx: number, x: number, y: number, dirX: number, dirY: number, dasher: number): void {
  const move: BossMove | undefined = world.rules.stage.moves[moveIdx];
  if (!move) return;
  const ticks = Math.round(move.telegraphSeconds / world.dt);
  const length = move.shape === 'line' ? (move.length ?? 400) : 0;
  world.hazards.push({ move: moveIdx, shape: move.shape, x, y, radius: move.radius, dirX, dirY, length, dasher, damage: move.damage, ticksLeft: ticks, totalTicks: ticks });
  world.events.push({ type: 'hazardTelegraphed', move: moveIdx, x, y, dirX, dirY, dasher });
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
 * ランの進行と終わりを判定する（ソロ・ホスト）。
 * - 四天王（required）を全員倒したらクリア。確率で伝説戦へ（クリアは確定）
 * - 制限時間までに四天王が残っていたら失敗。全員が倒れたら失敗（伝説戦の間はクリアのまま）
 * - 伝説戦: 倒す・全員倒れる・時間切れで終わる
 */
export function checkRunEnd(world: World): void {
  // ゲストはホストの決定（endRun）に合わせる
  if (world.outcome || world.role === 'guest') return;
  for (const ev of world.events) {
    if (ev.type !== 'enemyKilled') continue;
    world.requiredLeft.delete(ev.kind);
    if (world.legendary && ev.kind === world.legendary.kind) {
      finishLegendary(world, 'won');
      return;
    }
  }
  const allDown = world.players.length > 0 && world.players.every((p) => p.down);
  if (world.legendary) {
    if (allDown) finishLegendary(world, 'lost');
    else if (world.tick >= world.legendary.endTick) finishLegendary(world, 'timeUp');
    return;
  }
  if (allDown) {
    endRun(world, 'fail');
    return;
  }
  if (world.requiredTotal > 0 && !world.cleared && world.requiredLeft.size === 0) {
    world.cleared = true;
    startLegendaryOrClear(world);
    return;
  }
  if (world.requiredTotal > 0 && world.tick >= Math.round(world.rules.stage.durationSeconds / world.dt)) endRun(world, 'fail');
}

/** クリア: 確率で伝説戦を始める。始めないならランを終える */
function startLegendaryOrClear(world: World): void {
  const cfg = world.rules.stage.legendary;
  if (!cfg || world.rng.next() >= cfg.chance) {
    endRun(world, 'clear');
    return;
  }
  const id = cfg.kinds[world.rng.int(cfg.kinds.length)]!;
  const kind = world.rules.enemies.kinds.findIndex((k) => k.id === id);
  if (kind === -1) {
    endRun(world, 'clear');
    return;
  }
  const appearTick = world.tick + Math.round(cfg.warningSeconds / world.dt);
  world.legendary = { kind, appearTick, endTick: appearTick + Math.round(cfg.timeLimitSeconds / world.dt), spawned: false, result: null };
  // 雑魚はいなくなり、伝説と戦う（2.2）。残っている予告も消す
  const e = world.enemies;
  for (let i = 0; i < e.count; i++) {
    if (e.hp[i]! <= 0) continue;
    e.hp[i] = 0;
    world.events.push({ type: 'enemyRetired', id: e.id[i]! });
  }
  world.bosses.length = 0;
  world.hazards.length = 0;
  world.events.push({ type: 'legendaryWarning', kind });
}

function finishLegendary(world: World, result: LegendaryResult): void {
  if (!world.legendary) return;
  world.legendary.result = result;
  endRun(world, 'clear');
}

export function endRun(world: World, outcome: 'clear' | 'fail' | 'disconnected'): void {
  if (world.outcome) return;
  world.outcome = outcome;
  world.hazards.length = 0;
  world.events.push({ type: 'runEnded', outcome, legendary: world.legendary ? { kind: world.legendary.kind, result: world.legendary.result } : null });
}
