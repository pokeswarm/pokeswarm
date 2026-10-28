import type { BossMove, LegendField } from '../../data/schema';
import { randomUnit } from '../math';
import { currentWaveIndex, enemyHpScale, findEnemyIndex, moveIndexOfStage, type LegendaryResult, type World, type BossEntry, type WingKind } from '../world';
import { hurtPlayer, fieldDamage } from './health';
import { fireCasterMove } from './attack';
import { casterFor } from './legendCasters';

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

/**
 * ボス・伝説を出す。HP は参加人数に応じて上げる（2.2）。タッグのボスは、その前に bossRules.tagHpMultiplier 倍（ソロの補正。07 の89.5）。
 * 出せなければ -1
 */
function spawnBoss(world: World, kindIndex: number, moves: readonly number[], interval: number, enrage: BossEntry['enrage'] = null, tag = false): number {
  const rules = world.rules.stage.bossRules;
  const kind = world.rules.enemies.kinds[kindIndex]!;
  const p = world.players[world.rng.int(world.players.length)]!;
  const [ux, uy] = randomUnit(world.rng);
  const x = p.x + ux * rules.spawnDistance;
  const y = p.y + uy * rules.spawnDistance;
  const hp = kind.hp * (tag ? (rules.tagHpMultiplier ?? 1) : 1) * (1 + (rules.hpPerExtraPlayerPct * (world.players.length - 1)) / 100);
  const id = world.nextEnemyId++;
  if (world.enemies.add(id, kindIndex, x, y, hp, kind.moveSpeed, kind.radius, kind.contactDamage) === -1) return -1;
  world.events.push({ type: 'enemySpawned', id, kind: kindIndex, x, y });
  world.events.push({ type: 'bossAppeared', id, kind: kindIndex });
  if (moves.length > 0) world.bosses.push({ id, cooldown: interval, interval, moves, next: 0, ...(enrage ? { enrage } : {}) });
  return id;
}

/**
 * 伝説を1体出す。技は伝説ごとの技（無ければ共通の技を順に）。第2段階（HP が半分を切ると技の間隔が短くなり、2つ同時に使うことがある）は
 * 伝説ごとに数える。出せなければ -1
 */
function spawnLegend(world: World, kind: number): number {
  const cfg = world.rules.stage.legendary!;
  const set = cfg.moveSets[world.rules.enemies.kinds[kind]?.id ?? ''];
  const enrage = cfg.enrage
    ? { hpRatio: cfg.enrage.hpRatio, interval: Math.round((set?.enrageMoveIntervalSeconds ?? cfg.enrage.moveIntervalSeconds) / world.dt), doubleChance: cfg.enrage.doubleChance }
    : null;
  const id = spawnBoss(
    world,
    kind,
    (set?.moves ?? cfg.moves).map((m) => world.rules.stage.moves.findIndex((x) => x.id === m)),
    Math.round((set?.moveIntervalSeconds ?? cfg.moveIntervalSeconds) / world.dt),
    enrage,
  );
  const boss = world.bosses.find((b) => b.id === id);
  if (boss && set?.random) boss.random = true;
  // "*" は毎回 pool からランダムに選ぶ（ミュウ: テレポートとゆびをふるを交互に）
  if (boss && set?.pool) boss.pool = set.pool.map((m) => world.rules.stage.moves.findIndex((x) => x.id === m)).filter((k) => k >= 0);
  return id;
}

/** 区間が始まって予定の時間がたったら中ボス・ボスを出す。伝説戦では伝説を出す */
export function spawnBosses(world: World): void {
  if (world.role === 'guest' || world.players.length === 0) return;
  const lg = world.legendary;
  if (lg) {
    if (!lg.spawned && world.tick >= lg.appearTick) {
      lg.spawned = true;
      // ラウンドの相手は同時に出す（レッド戦のエーフィとカビゴンなど）
      for (const kind of legendRoundKinds(world, lg.kind)) spawnLegend(world, kind);
    }
    return;
  }
  const inSection = world.tick - world.sectionStartTick;
  while (world.nextBoss < world.bossSchedule.length) {
    const b = world.bossSchedule[world.nextBoss]!;
    if (b.wave > world.section || (b.wave === world.section && b.afterTicks > inSection)) break;
    world.nextBoss++;
    const id = spawnBoss(world, b.kind, b.moves, b.interval, b.enrage, b.tag);
    // 出せなかった（敵の上限）中ボスは、次の更新で出し直す
    if (id === -1 && b.gate) {
      world.nextBoss--;
      break;
    }
    if (b.gate) world.gateIds.add(id);
    if (b.tag && id !== -1) world.tagIds.set(id, b.wave);
  }
}

/**
 * タッグバトル（ホウエン。07 の89.5。ソロ・ホスト）: 組の片方が倒れたら、残ったほうはすぐ第2段階になる
 * （第2段階の無いボスはそのまま）
 */
export function stepTags(world: World): void {
  if (world.role === 'guest' || world.tagIds.size === 0) return;
  for (const ev of world.events) {
    if (ev.type !== 'enemyKilled') continue;
    const wave = world.tagIds.get(ev.enemyId);
    if (wave === undefined) continue;
    world.tagIds.delete(ev.enemyId);
    for (const [id, w] of world.tagIds) {
      if (w !== wave) continue;
      const boss = world.bosses.find((b) => b.id === id);
      const i = findEnemyIndex(world, id);
      if (!boss?.enrage || boss.enraged || i === -1) continue;
      boss.enraged = true;
      boss.interval = boss.enrage.interval;
      boss.cooldown = Math.min(boss.cooldown, boss.interval);
      world.events.push({ type: 'legendaryWarning', kind: world.enemies.kind[i]!, enraged: true });
    }
  }
}

/** タッグの組の相手が突進している（予告中・突進中）か。突進する技は、相手の突進が終わるまで使わない（2体が同時に突っ込まない） */
function partnerDashing(world: World, bossId: number): boolean {
  const wave = world.tagIds.get(bossId);
  if (wave === undefined) return false;
  for (const [id, w] of world.tagIds) {
    if (id === bossId || w !== wave) continue;
    if (world.hazards.some((h) => h.dasher === id && !!world.rules.stage.moves[h.move]?.dashSpeed)) return true;
    const i = findEnemyIndex(world, id);
    if (i !== -1 && world.enemies.kbTicks[i]! > 0) return true;
  }
  return false;
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

/**
 * 伝説の乱入（ジョウトの三犬。作者の決定 2026年10月26日。ソロ・ホスト）: 決まった分ちょうどに、確率でどれかが乱入する（1回のランで1回まで）。
 * 「DANGER」の後に出て、雑魚はそのまま湧く。制限時間で倒せなければ逃げる。クリアの後（伝説戦）は乱入しない
 */
export function stepIntruders(world: World): void {
  if (world.role === 'guest' || world.players.length === 0) return;
  const cfg = world.rules.stage.legendary?.intruders;
  const it = world.intruder;
  if (it && !it.done) {
    if (it.id === -1) {
      if (world.tick < it.appearTick) return;
      it.id = spawnLegend(world, it.kind);
      // 出せなかった（敵の上限）なら、次の更新で出し直す
      return;
    }
    const i = findEnemyIndex(world, it.id);
    if (i === -1 || world.enemies.hp[i]! <= 0) {
      it.done = true;
      return;
    }
    if (world.tick >= it.endTick) {
      it.done = true;
      world.enemies.hp[i] = 0;
      world.events.push({ type: 'enemyRetired', id: it.id });
      world.events.push({ type: 'intruderLeft', kind: it.kind });
    }
    return;
  }
  if (!cfg || it || world.legendary || world.cleared) return;
  while (world.nextIntruderCheck < cfg.minutes.length && world.tick >= Math.round((cfg.minutes[world.nextIntruderCheck]! * 60) / world.dt)) {
    world.nextIntruderCheck++;
    if (world.rng.next() >= cfg.chance) continue;
    const kind = world.rules.enemies.kinds.findIndex((k) => k.id === cfg.kinds[world.rng.int(cfg.kinds.length)]);
    if (kind !== -1) startIntruder(world, kind);
    return;
  }
}

/** 伝説を乱入させる（「DANGER」の後に出る）。確認用の ?intruder= からも呼ぶ */
export function startIntruder(world: World, kind: number): void {
  const lg = world.rules.stage.legendary;
  if (!lg) return;
  const appearTick = world.tick + Math.round(lg.warningSeconds / world.dt);
  world.intruder = { kind, id: -1, appearTick, endTick: appearTick + Math.round((lg.intruders?.timeLimitSeconds ?? lg.timeLimitSeconds) / world.dt), done: false };
  world.events.push({ type: 'intruderWarning', kind });
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
      if (s.pattern === 'bomber') world.bombers.set(id, swarm);
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
    } else if (s.pattern === 'bomber') {
      // 画面の外から転がってくる（ふつうに追ってくる。プレイヤーより速い）
      const dist = world.rules.spawn.spawnDistanceMin;
      for (let k = 0; k < s.count; k++) {
        const [vx, vy] = k === 0 ? [ux, uy] : randomUnit(world.rng);
        add(p.x + vx * dist, p.y + vy * dist);
      }
      // 知らせは出さない（作者の決定。いつの間にか転がってくる）
      continue;
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
 * じばく（ソロ・ホスト）: 転がってきた敵がプレイヤーに近づいたら、止まってその場に範囲を予告する。
 * 予告の間に倒しても爆発は止まらない（誘爆）。落ちたら敵はいなくなる（撃破には数えない）
 */
export function armBombers(world: World): void {
  if (world.role === 'guest') return;
  for (const [id, swarm] of world.bombers) {
    const i = findEnemyIndex(world, id);
    if (i === -1 || world.enemies.hp[i]! <= 0) {
      world.bombers.delete(id);
      continue;
    }
    const s = world.rules.stage.swarms[swarm]!;
    const x = world.enemies.x[i]!;
    const y = world.enemies.y[i]!;
    const target = nearestPlayer(world, x, y);
    if (!target || (target.x - x) ** 2 + (target.y - y) ** 2 > (s.triggerRange ?? 0) ** 2) continue;
    world.bombers.delete(id);
    addHazard(world, moveIndexOfStage(world.rules, s.move!), x, y, 0, 0, id);
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
      enrageBoss(world, boss, i);
      fieldLightning(world, boss, i);
      if (--boss.cooldown > 0) continue;
      boss.cooldown = boss.interval;
      // 2つ同時に使う確率: 伝説・四天王の第2段階
      const double = boss.enraged && boss.enrage ? boss.enrage.doubleChance : 0;
      const uses = double > 0 && world.rng.next() < double ? 2 : 1;
      for (let u = 0; u < uses; u++) useBossMove(world, boss, i);
    }
  }
  strikeHazards(world);
}

/** 四天王の第2段階: HP が決まった割合を切ったら「DANGER」を出し、技の間隔を短くする（ソロ・ホスト） */
function enrageBoss(world: World, boss: World['bosses'][number], i: number): void {
  if (!boss.enrage || boss.enraged || world.role === 'guest') return;
  if (world.enemies.hp[i]! > world.enemies.maxHp[i]! * boss.enrage.hpRatio) return;
  boss.enraged = true;
  boss.interval = boss.enrage.interval;
  boss.cooldown = Math.min(boss.cooldown, boss.interval);
  world.events.push({ type: 'legendaryWarning', kind: world.enemies.kind[i]!, enraged: true });
}

/** ボス・伝説が技を1つ使う（予告を置く） */
function useBossMove(world: World, boss: World['bosses'][number], i: number): void {
  let moveIdx = boss.random ? boss.moves[world.rng.int(boss.moves.length)]! : boss.moves[boss.next++ % boss.moves.length]!;
  if (moveIdx === -1 && boss.pool && boss.pool.length > 0) moveIdx = boss.pool[world.rng.int(boss.pool.length)]!;
  const move = world.rules.stage.moves[moveIdx];
  // タッグの相手が突進している間は、突進する技を使わず、少し後にもう一度見る
  if (move?.dashSpeed && partnerDashing(world, boss.id)) {
    if (!boss.random) boss.next--;
    boss.cooldown = Math.min(boss.cooldown, Math.max(1, Math.round(0.2 / world.dt)));
    return;
  }
  // 狙う相手の距離の条件（フシギバナのソーラービーム・カメックスのハイドロカノン）: 満たさなければ使わず、少し後にもう一度見る
  if (move && (move.minTargetDistance !== undefined || move.maxTargetDistance !== undefined)) {
    const bx = world.enemies.x[i]!;
    const by = world.enemies.y[i]!;
    const t = pickPlayer(world, bx, by, move.targetPick ?? 'nearest');
    const d = t ? Math.hypot(t.x - bx, t.y - by) : Infinity;
    if ((move.minTargetDistance !== undefined && d <= move.minTargetDistance) || (move.maxTargetDistance !== undefined && d >= move.maxTargetDistance)) {
      if (!boss.random) boss.next--;
      boss.cooldown = Math.min(boss.cooldown, Math.max(1, Math.round(0.2 / world.dt)));
      return;
    }
  }
  castBossMove(world, boss.id, i, moveIdx);
}

/** ボス・伝説が技 moveIdx を、今の場所から使う（予告を置く）。続けて使う技（then）からも呼ぶ */
function castBossMove(world: World, bossId: number, i: number, moveIdx: number): void {
  const move = world.rules.stage.moves[moveIdx];
  if (!move) return;
  const bx = world.enemies.x[i]!;
  const by = world.enemies.y[i]!;
  const target = pickPlayer(world, bx, by, move.targetPick ?? 'nearest');
  if (!target) return;
  // 予告の間は止まる（ファイヤーのゴッドバード。ゲストも予告の知らせで止める）
  if (move.rooted) world.enemies.speed[i] = 0;
  if (move.bullets) {
    // 飛ぶ玉（サンダー）: 自分からランダムな向きへ
    for (let k = 0; k < move.bullets.count; k++) {
      const [ux, uy] = randomUnit(world.rng);
      addHazard(world, moveIdx, bx, by, ux, uy, bossId);
    }
    return;
  }
  if (move.homing) {
    // 必中（ファイヤーのゴッドバード）: 予告が狙ったプレイヤーを追いかける。直線（フシギバナのソーラービーム）は、ボスから狙った人への向きを追う
    if (move.shape === 'line') {
      const len = Math.hypot(target.x - bx, target.y - by) || 1;
      addHazard(world, moveIdx, bx, by, (target.x - bx) / len, (target.y - by) / len, bossId, undefined, { follow: target.id });
    } else addHazard(world, moveIdx, target.x, target.y, 0, 0, bossId, undefined, { follow: target.id });
    return;
  }
  if (move.target === 'random') {
    // だれかの周りのランダムな場所（サイコブレイク・落雷）。テレポートなら、ボスがそこへ現れる
    for (let c = 0; c < move.count; c++) {
      const p = world.players.filter((x) => !x.down)[world.rng.int(Math.max(1, world.players.filter((x) => !x.down).length))] ?? target;
      const [ux, uy] = randomUnit(world.rng);
      const dist = world.rng.range(0, move.spread);
      addHazard(world, moveIdx, p.x + ux * dist, p.y + uy * dist, 0, 0, move.teleport ? bossId : -1, undefined, { delay: Math.round(((move.stagger ?? 0) * c) / world.dt) });
    }
    return;
  }
  if (move.shape === 'line') {
    // 自分から狙ったプレイヤーへ向かう直線
    const dx = target.x - bx;
    const dy = target.y - by;
    const len = Math.hypot(dx, dy) || 1;
    addHazard(world, moveIdx, bx, by, dx / len, dy / len, move.dashSpeed || move.rooted || move.playerMove ? bossId : -1);
  } else if (move.target === 'self' && move.rings) {
    // 外へ広がる輪（ミュウツー）: 1本ずつ遅らせて、外側ほど遠くに出す
    for (let k = 0; k < move.rings.count; k++) {
      const r = move.radius + k * move.rings.step;
      addHazard(world, moveIdx, bx, by, 0, 0, -1, undefined, { delay: Math.round(((move.stagger ?? 0) * k) / world.dt), radius: r, inner: Math.max(0, r - move.rings.width) });
    }
  } else if (move.target === 'self') {
    addHazard(world, moveIdx, bx, by, 0, 0, move.rooted || move.playerMove ? bossId : -1);
  } else if (move.teleport) {
    // 瞬間移動（ミュウツー）: 狙ったプレイヤーの後ろ（向いている方向の反対）に予告し、落ちたらそこへ現れる
    const fl = Math.hypot(target.facingX, target.facingY) || 1;
    const fx = target.facingX / fl || 1;
    const fy = target.facingY / fl;
    addHazard(world, moveIdx, target.x - fx * move.spread, target.y - fy * move.spread, 0, 0, bossId);
  } else {
    for (let c = 0; c < move.count; c++) {
      // 1つ目は足元、2つ目以降はばらつかせる（動かないと当たり、動けば避けられる）
      const [ux, uy] = c === 0 ? [0, 0] : randomUnit(world.rng);
      const dist = c === 0 ? 0 : world.rng.range(move.radius, move.spread + move.radius);
      addHazard(world, moveIdx, target.x + ux * dist, target.y + uy * dist, 0, 0, -1, undefined, { delay: Math.round(((move.stagger ?? 0) * c) / world.dt) });
    }
  }
}

/** 範囲技が残した床: 時間を進め、自分のプレイヤーが上にいれば遅くする・削る（当たったかは自分のブラウザで決める） */
function tickZones(world: World): void {
  const me = world.players.find((p) => p.id === world.localPlayerId);
  let slow = 0;
  let burn = 0;
  for (let k = world.zones.length - 1; k >= 0; k--) {
    const z = world.zones[k]!;
    if (--z.ticksLeft <= 0) {
      world.zones.splice(k, 1);
      continue;
    }
    if (!me || me.down || (me.x - z.x) ** 2 + (me.y - z.y) ** 2 > (z.radius + me.radius) ** 2) continue;
    slow = Math.max(slow, z.slowPct);
    burn = Math.max(burn, z.damagePerSecond);
  }
  if (!me) return;
  me.zoneSlowPct = slow;
  if (burn <= 0) {
    me.zoneHurtTicks = 0;
    return;
  }
  // 燃える地面: 0.5 秒ごとに、その間の分をまとめて受ける
  const every = Math.round(0.5 / world.dt);
  me.zoneHurtTicks = (me.zoneHurtTicks ?? 0) + 1;
  if (me.zoneHurtTicks >= every && me.invincibleTicks <= 0) {
    me.zoneHurtTicks = 0;
    hurtPlayer(world, me, burn * 0.5);
  }
}

/** 予告の時間が来た範囲技を当てる */
function strikeHazards(world: World): void {
  tickZones(world);
  tickLegendField(world);
  const me = world.players.find((p) => p.id === world.localPlayerId);
  for (let h = world.hazards.length - 1; h >= 0; h--) {
    const hz = world.hazards[h]!;
    // 落ちた後: 残っている間に触れると当たる（1つの範囲技で1回）。時間が来たら消す
    if (hz.activeTicks !== undefined) {
      if (--hz.activeTicks <= 0) {
        world.hazards.splice(h, 1);
        continue;
      }
      // 飛ぶ玉（サンダー）: 向きへまっすぐ進む
      const bullets = world.rules.stage.moves[hz.move]?.bullets;
      if (bullets) {
        hz.x += hz.dirX * bullets.speed * world.dt;
        hz.y += hz.dirY * bullets.speed * world.dt;
      }
      if (me && !me.down && me.invincibleTicks <= 0 && !hz.hitLocal && hazardHits(hz, me.x, me.y, me.radius)) {
        hz.hitLocal = true;
        hurtPlayer(world, me, hazardDamage(world, hz.damage));
      }
      continue;
    }
    // 必中の予告: 狙ったプレイヤーを追いかける（当たったかは狙われた人のブラウザで決めるので、本人の画面では必ず当たる）
    if (hz.follow !== undefined && hz.follow !== -1) {
      const p = world.players.find((x) => x.id === hz.follow);
      if (p && !p.down) {
        if (hz.shape === 'line') {
          const len = Math.hypot(p.x - hz.x, p.y - hz.y) || 1;
          hz.dirX = (p.x - hz.x) / len;
          hz.dirY = (p.y - hz.y) / len;
        } else {
          hz.x = p.x;
          hz.y = p.y;
        }
      }
    }
    if (--hz.ticksLeft > 0) continue;
    const move = world.rules.stage.moves[hz.move];
    // 落ちた: 予告を消し、少しの間は当たる範囲として残す（描画は予告として描かない）。飛ぶ玉は飛んでいる間ずっと当たる
    hz.activeTicks = Math.max(1, Math.round((move?.bullets ? move.bullets.seconds : world.rules.stage.bossRules.hazardActiveSeconds) / world.dt));
    // 予告の間止まっていたボスは、また動く
    if (move?.rooted && hz.dasher !== -1) {
      const i = findEnemyIndex(world, hz.dasher);
      if (i !== -1) world.enemies.speed[i] = world.rules.enemies.kinds[world.enemies.kind[i]!]?.moveSpeed ?? 0;
    }
    world.events.push({
      type: 'hazardStruck',
      x: hz.x,
      y: hz.y,
      radius: hz.radius,
      effect: move?.effect ?? '',
      shape: hz.shape,
      innerRadius: hz.innerRadius ?? 0,
      dirX: hz.dirX,
      dirY: hz.dirY,
      length: hz.length,
    });
    // じばく: 爆発した敵はいなくなる（ホストが決めてゲストへ送る）
    if (move?.selfDestruct && hz.dasher !== -1 && world.role !== 'guest') {
      const i = findEnemyIndex(world, hz.dasher);
      if (i !== -1) {
        world.enemies.hp[i] = 0;
        world.events.push({ type: 'enemyRetired', id: hz.dasher });
      }
    }
    // 瞬間移動: ボスが予告の場所へ現れる（ホストが動かし、位置はゲストへ送る）
    if (move?.teleport && hz.dasher !== -1 && world.role !== 'guest') {
      const i = findEnemyIndex(world, hz.dasher);
      if (i !== -1) {
        world.enemies.x[i] = world.enemies.prevX[i] = hz.x;
        world.enemies.y[i] = world.enemies.prevY[i] = hz.y;
      }
    }
    // プレイヤーと同じ技を出す（色違いの御三家のブラストバーン・ハイドロカノン）。どのブラウザでも、ボスの場所から出す
    if (move?.playerMove && hz.dasher !== -1) {
      const i = findEnemyIndex(world, hz.dasher);
      const pm = world.rules.moves.findIndex((m) => m.key === move.playerMove!.move);
      if (i !== -1 && pm !== -1) {
        const set = world.rules.stage.legendary?.moveSets[world.rules.enemies.kinds[world.enemies.kind[i]!]?.id ?? ''];
        const caster = casterFor(world, hz.dasher, set?.casterPower ?? 1);
        caster.x = caster.prevX = world.enemies.x[i]!;
        caster.y = caster.prevY = world.enemies.y[i]!;
        fireCasterMove(world, caster, pm, move.playerMove.level, move.playerMove);
      }
    }
    const holder = move?.holdSeconds && hz.dasher !== -1 ? world.legendAis.get(hz.dasher) : undefined;
    if (holder) holder.holdTicks = Math.round(move!.holdSeconds! / world.dt);
    // 回復（エーフィの あさのひざし・カビゴンの ねむる）: 使ったボスの HP を戻す（ホストが決め、HP はゲストへ送る）
    if (move?.healPct && hz.dasher !== -1 && world.role !== 'guest') {
      const i = findEnemyIndex(world, hz.dasher);
      if (i !== -1 && world.enemies.hp[i]! > 0) world.enemies.hp[i] = Math.min(world.enemies.maxHp[i]!, world.enemies.hp[i]! + (world.enemies.maxHp[i]! * move.healPct) / 100);
    }
    // 続けて使う技（ミュウツー: テレポートの直後に自分の周り）。ホストが決める
    if (move?.then && hz.dasher !== -1 && world.role !== 'guest') {
      const i = findEnemyIndex(world, hz.dasher);
      if (i !== -1) castBossMove(world, hz.dasher, i, moveIndexOfStage(world.rules, move.then));
    }
    // 残る床（凍った床・燃える地面）。直線は線に沿って並べる。どのブラウザでも同じものを作る
    if (move?.leaves) {
      const lv = move.leaves;
      const add = (x: number, y: number): void => {
        world.zones.push({ x, y, radius: hz.radius, ticksLeft: Math.round(lv.seconds / world.dt), slowPct: lv.slowPct, damagePerSecond: lv.damagePerSecond, color: lv.color, effect: move.effect });
      };
      if (hz.shape === 'line') for (let d = 0; d <= hz.length; d += hz.radius * 1.5) add(hz.x + hz.dirX * d, hz.y + hz.dirY * d);
      else add(hz.x, hz.y);
    }
    // 突進: 線に沿って進む（ノックバックの仕組みで動かす。ホストが動かし、位置はゲストへ送る）
    if (hz.dasher !== -1 && move?.dashSpeed && world.role !== 'guest') {
      const i = findEnemyIndex(world, hz.dasher);
      if (i !== -1) {
        world.enemies.knockBack(i, hz.dirX * move.dashSpeed, hz.dirY * move.dashSpeed, Math.round(hz.length / move.dashSpeed / world.dt));
        // 続けて狙い直す（突進の先から、そのときのプレイヤーへ。予告はもう一度出る）
        const left = hz.chainLeft ?? move.chain ?? 0;
        const target = left > 0 ? nearestPlayer(world, hz.x + hz.dirX * hz.length, hz.y + hz.dirY * hz.length) : null;
        if (target) {
          const sx = hz.x + hz.dirX * hz.length;
          const sy = hz.y + hz.dirY * hz.length;
          const len = Math.hypot(target.x - sx, target.y - sy) || 1;
          addHazard(world, hz.move, sx, sy, (target.x - sx) / len, (target.y - sy) / len, hz.dasher, left - 1);
        }
      }
    }
    if (!me || me.down || me.invincibleTicks > 0) continue;
    if (hazardHits(hz, me.x, me.y, me.radius)) {
      hz.hitLocal = true;
      hurtPlayer(world, me, hazardDamage(world, hz.damage));
    }
  }
}

/**
 * 伝説戦のマップの効果を、自分のプレイヤーに当てる（どのブラウザでも自分の分だけ）:
 * ふぶき（毎秒 最大 HP の % ・遅くなる）・ほのおのうず（伝説の近くで削られる）・ぜったいれいど（HP が少ないと凍る）
 */
function tickLegendField(world: World): void {
  const me = world.players.find((p) => p.id === world.localPlayerId);
  if (!me) return;
  if (me.frozenTicks) me.frozenTicks--;
  if (me.freezeCooldown) me.freezeCooldown--;
  const active = activeField(world);
  if (!active || me.down) {
    me.fieldHurtTicks = 0;
    return;
  }
  const f = active.field;
  // 天気で削られないタイプ（すなあらしの いわ・じめん・はがね）
  const immune = !!f.immuneTypes && me.types.some((t) => f.immuneTypes!.includes(world.rules.types.names[t] ?? ''));
  if (f.slowPct) me.zoneSlowPct = Math.max(me.zoneSlowPct ?? 0, f.slowPct);
  // 強い風（ルギア）: 一方向へ流す。向きは決まった間隔で変わる（どのブラウザでも同じ向き。黄金角ずつ回す）
  if (f.wind) {
    const a = Math.floor(world.tick / Math.max(1, Math.round(f.wind.everySeconds / world.dt))) * 2.399963;
    me.x += Math.cos(a) * f.wind.speed * world.dt;
    me.y += Math.sin(a) * f.wind.speed * world.dt;
  }
  // 0.5 秒ごとに、その間の分をまとめて受ける
  const every = Math.round(0.5 / world.dt);
  me.fieldHurtTicks = (me.fieldHurtTicks ?? 0) + 1;
  if (me.fieldHurtTicks >= every) {
    me.fieldHurtTicks = 0;
    // ふぶき: 最大 HP の % （防御は効かない。無敵時間も付けない）
    if (f.damagePctPerSecond && !immune) fieldDamage(world, me, (me.maxHp * f.damagePctPerSecond * 0.5) / 100);
    // ほのおのうず: 伝説の近くにいると削られる（ふつうのダメージ）
    const e = world.enemies;
    if (f.aura && active.index >= 0 && !me.down && me.invincibleTicks <= 0 && (me.x - e.x[active.index]!) ** 2 + (me.y - e.y[active.index]!) ** 2 <= (f.aura.radius + me.radius) ** 2) {
      hurtPlayer(world, me, hazardDamage(world, f.aura.damagePerSecond * 0.5));
    }
  }
  // ぜったいれいど: HP が少ないと凍る（動けず、技も出ない）
  if (f.freezeBelowHpPct && !me.down && !me.frozenTicks && !me.freezeCooldown && me.hp < (me.maxHp * f.freezeBelowHpPct) / 100) {
    me.frozenTicks = Math.round((f.freezeSeconds ?? 5) / world.dt);
    me.freezeCooldown = me.frozenTicks + Math.round(3 / world.dt);
    world.events.push({ type: 'playerFrozen', playerId: me.id });
  }
}

/** 範囲技の威力: プレイヤーの最大 HP がレベルで伸びるのに合わせて上げる（後半でも痛いように） */
export function hazardDamage(world: World, damage: number): number {
  if (!world.rules.stage.bossRules.hazardDamageScalesWithLevel) return damage;
  return damage * (1 + (world.rules.stats.perLevelPct.maxHp * (world.level - 1)) / 100);
}

/** 範囲に入っているか（円・直線） */
export function hazardHits(
  hz: { shape: 'circle' | 'line' | 'ring'; x: number; y: number; radius: number; innerRadius?: number; dirX: number; dirY: number; length: number },
  x: number,
  y: number,
  r: number,
): boolean {
  if (hz.shape === 'circle') return (x - hz.x) ** 2 + (y - hz.y) ** 2 <= (hz.radius + r) ** 2;
  if (hz.shape === 'ring') {
    const d = Math.hypot(x - hz.x, y - hz.y);
    return d <= hz.radius + r && d >= (hz.innerRadius ?? 0) - r;
  }
  const t = Math.max(0, Math.min(hz.length, (x - hz.x) * hz.dirX + (y - hz.y) * hz.dirY));
  const px = hz.x + hz.dirX * t;
  const py = hz.y + hz.dirY * t;
  return (x - px) ** 2 + (y - py) ** 2 <= (hz.radius + r) ** 2;
}

/** 範囲技の予告を置く（ホストが決め、ゲストには知らせで届く） */
export function addHazard(
  world: World,
  moveIdx: number,
  x: number,
  y: number,
  dirX: number,
  dirY: number,
  dasher: number,
  chainLeft?: number,
  /** 予告に足す遅れ（更新回数）・半径の上書き・輪の内側の半径・追いかけるプレイヤー */
  extra: { delay?: number; radius?: number; inner?: number; follow?: number } = {},
): void {
  const move: BossMove | undefined = world.rules.stage.moves[moveIdx];
  if (!move) return;
  const ticks = Math.round(move.telegraphSeconds / world.dt) + (extra.delay ?? 0);
  const radius = extra.radius || move.radius;
  const length = move.shape === 'line' ? (move.length ?? 400) : 0;
  world.hazards.push({ move: moveIdx, shape: move.shape, x, y, radius, innerRadius: move.shape === 'ring' ? (extra.inner ?? 0) : undefined, dirX, dirY, length, dasher, damage: move.damage, ticksLeft: ticks, totalTicks: ticks, chainLeft, follow: extra.follow ?? -1 });
  // 予告の間止まる技（ゲストも同じ知らせで止める）
  if (move.rooted && dasher !== -1) {
    const i = findEnemyIndex(world, dasher);
    if (i !== -1) world.enemies.speed[i] = 0;
  }
  // じばく: 予告した敵はその場で止まる（ゲストも同じ知らせで止める）
  if (move.selfDestruct && dasher !== -1) {
    const i = findEnemyIndex(world, dasher);
    if (i !== -1) {
      world.enemies.speed[i] = 0;
      world.enemies.vx[i] = 0;
      world.enemies.vy[i] = 0;
    }
  }
  world.events.push({ type: 'hazardTelegraphed', move: moveIdx, x, y, dirX, dirY, dasher, delay: extra.delay ?? 0, radius: extra.radius ?? 0, inner: extra.inner ?? 0, follow: extra.follow ?? -1 });
}

/** 狙うプレイヤー（倒れていない人から）: 一番近い・ランダム・一番 HP の多い */
function pickPlayer(world: World, x: number, y: number, how: 'nearest' | 'random' | 'highestHp'): World['players'][number] | null {
  const alive = world.players.filter((p) => !p.down);
  if (alive.length === 0) return null;
  if (how === 'random') return alive[world.rng.int(alive.length)]!;
  if (how === 'highestHp') return alive.reduce((a, b) => (b.hp > a.hp ? b : a));
  return nearestPlayer(world, x, y);
}

/** マップの効果の落雷（サンダー）: 決まった間隔で、だれかの周りのランダムな場所に落とす（ソロ・ホスト） */
function fieldLightning(world: World, boss: World['bosses'][number], i: number): void {
  const field = legendFieldOf(world, world.enemies.kind[i]!);
  if (!field?.lightning) return;
  boss.lightningTimer = (boss.lightningTimer ?? 0) - 1;
  if (boss.lightningTimer > 0) return;
  boss.lightningTimer = Math.max(1, Math.round(field.lightning.everySeconds / world.dt));
  castBossMove(world, boss.id, i, moveIndexOfStage(world.rules, field.lightning.move));
}

/** その敵の種類（伝説）のマップの効果。無ければ undefined */
export function legendFieldOf(world: World, kind: number): LegendField | undefined {
  const id = world.rules.enemies.kinds[kind]?.id ?? '';
  return world.rules.stage.legendary?.moveSets[id]?.field;
}

/** マップの効果のある伝説の種類（種類の番号 → 効果）。rules ごとに覚える */
const fieldKinds = new WeakMap<World['rules'], Map<number, LegendField>>();
/** 同じ更新の中では、同じ答えを使う（技の威力の計算から何度も呼ばれる） */
const fieldTick = new WeakMap<World, { tick: number; out: { field: LegendField; index: number } | null }>();

/**
 * 今出ている伝説のマップの効果と、その伝説の敵の index（無ければ null）。伝説戦の相手のほか、乱入した伝説（三犬）も。
 * ゲストも同じように決まるよう、出ている敵から探す
 */
export function activeLegendField(world: World): { field: LegendField; index: number } | null {
  if (world.legendary?.result) return null;
  const cached = fieldTick.get(world);
  if (cached && cached.tick === world.tick) return cached.out;
  let kinds = fieldKinds.get(world.rules);
  if (!kinds) {
    kinds = new Map();
    world.rules.enemies.kinds.forEach((k, idx) => {
      const f = world.rules.stage.legendary?.moveSets[k.id]?.field;
      if (f && k.rank === 'legendary') kinds!.set(idx, f);
    });
    fieldKinds.set(world.rules, kinds);
  }
  let out: { field: LegendField; index: number } | null = null;
  if (kinds.size > 0) {
    const e = world.enemies;
    for (let i = 0; i < e.count; i++) {
      if (e.hp[i]! <= 0) continue;
      const field = kinds.get(e.kind[i]!);
      if (field) {
        out = { field, index: i };
        break;
      }
    }
  }
  fieldTick.set(world, { tick: world.tick, out });
  return out;
}

/**
 * 今の区間の天気（ホウエン。07 の89.2）: 区間の天気、巡らせる区間は頭からの秒数で決まる。天気の無い区間・地方は null。
 * section と sectionStartTick はゲストにも届くので、どのブラウザでも同じ天気になる
 */
export function currentWeather(world: World): { id: string; field: LegendField } | null {
  const w = world.rules.weatherSections?.[Math.min(world.section, (world.rules.weatherSections?.length ?? 1) - 1)];
  if (!w || w.kinds.length === 0) return null;
  const at = w.everySeconds > 0 ? Math.floor(((world.tick - world.sectionStartTick) * world.dt) / w.everySeconds) % w.kinds.length : 0;
  return { id: w.kinds[at]!, field: w.fields[at]! };
}

/**
 * 今効いているマップの効果: 伝説（伝説戦・乱入）のマップの効果があればそれ、無ければ区間の天気（index は -1）。
 * 伝説のマップの効果が天気より優先する（レックウザ: 天気を消す）
 */
export function activeField(world: World): { field: LegendField; index: number } | null {
  const legend = activeLegendField(world);
  if (legend) return legend;
  if (world.legendary?.result) return null;
  const w = currentWeather(world);
  return w ? { field: w.field, index: -1 } : null;
}

/** 伝説戦のラウンド（種類の番号）。rules ごとに覚える */
interface LegendRounds {
  readonly rounds: readonly { readonly kinds: readonly number[]; readonly stat?: string }[];
  readonly bonus: readonly { readonly item: WingKind; readonly kinds: readonly number[] }[];
}
const roundsCache = new WeakMap<World['rules'], LegendRounds>();
export function legendRounds(world: World): LegendRounds {
  let r = roundsCache.get(world.rules);
  if (!r) {
    const cfg = world.rules.stage.legendary;
    const idx = (id: string): number => world.rules.enemies.kinds.findIndex((k) => k.id === id);
    r = {
      rounds: (cfg?.rounds ?? []).map((x) => ({ kinds: x.kinds.map(idx), ...(x.stat ? { stat: x.stat } : {}) })),
      bonus: (cfg?.bonusRounds ?? []).map((x) => ({ item: x.item, kinds: x.kinds.map(idx) })),
    };
    roundsCache.set(world.rules, r);
  }
  return r;
}

/** その伝説と同時に戦う相手（ラウンドの相手。ラウンドの無い伝説戦は自分だけ） */
export function legendRoundKinds(world: World, kind: number): readonly number[] {
  const r = legendRounds(world);
  for (const x of r.rounds) if (x.kinds.includes(kind)) return x.kinds;
  for (const x of r.bonus) if (x.kinds.includes(kind)) return x.kinds;
  return [kind];
}

/** このランで戦うラウンドの並び: rounds の後に、拾ったはねの bonusRounds（ルギア・ホウオウ） */
function roundSequence(world: World): readonly (readonly number[])[] {
  const r = legendRounds(world);
  return [...r.rounds.map((x) => x.kinds), ...r.bonus.filter((b) => world.wings.has(b.item)).map((b) => b.kinds)];
}

/**
 * 伝説戦の終わり（kind が最後に戦った相手、result が結果）までに倒したラウンドの stat（レッドを倒す）。
 * 最後のラウンドより先（はねの戦い）まで進んでいれば、そのラウンドは倒している
 */
export function legendRoundStats(world: World, kind: number, result: LegendaryResult | null): string[] {
  const r = legendRounds(world);
  let at = r.rounds.findIndex((x) => x.kinds.includes(kind));
  if (at === -1 && r.bonus.some((x) => x.kinds.includes(kind))) at = r.rounds.length;
  if (at === -1) return [];
  const won = result === 'won' ? at : at - 1;
  return r.rounds.slice(0, won + 1).flatMap((x) => (x.stat ? [x.stat] : []));
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
    if (world.legendary?.spawned && legendRoundKinds(world, world.legendary.kind).includes(ev.kind) && !roundAlive(world)) {
      winRound(world);
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

/**
 * 参加者のポケモンに一番不利な敵（作者の決定 2026年10月24日: 弱点を突かれると強敵の感じが薄れる。ふだん選ばれにくいノーマルの技が活きる）。
 * プレイヤーごとに「向こうのタイプの技がこちらに効く倍率 ÷ こちらのタイプの技が向こうに効く倍率（タイプの平均）」を足し、一番大きいもの。同じなら先のもの
 */
export function counterPick(world: World, ids: readonly string[]): string {
  const chart = world.rules.types.chart;
  const eff = (atk: number, def: readonly number[]): number => def.reduce((m, d) => m * (chart[atk]?.[d] ?? 1), 1);
  let best = ids[0]!;
  let bestScore = -Infinity;
  for (const id of ids) {
    const kind = world.rules.enemies.kinds.find((k) => k.id === id);
    if (!kind) continue;
    let score = 0;
    for (const p of world.players) {
      if (p.types.length === 0) continue;
      const offense = p.types.reduce((sum, t) => sum + eff(t, kind.types), 0) / p.types.length;
      const defense = Math.max(...kind.types.map((t) => eff(t, p.types)));
      score += defense / Math.max(offense, 0.125);
    }
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

/** クリア: 確率で伝説戦を始める。始めないならランを終える */
function startLegendaryOrClear(world: World): void {
  const cfg = world.rules.stage.legendary;
  // 続けて戦うラウンド（レッド戦）があれば、必ず1つ目から
  const seq = roundSequence(world);
  if (cfg && seq.length > 0) {
    startLegendary(world, seq[0]![0]!, 0);
    return;
  }
  if (!cfg || world.rng.next() >= cfg.chance) {
    endRun(world, 'clear');
    return;
  }
  // 相性で選ぶ候補（色違いの御三家）は、参加者に一番不利な1体を、ほかの伝説と同じ重みで足す
  const pool = [...cfg.kinds];
  if (world.legendaryCounter && cfg.counter) pool.push(counterPick(world, cfg.counter.kinds));
  const id = pool[world.rng.int(pool.length)]!;
  const kind = world.rules.enemies.kinds.findIndex((k) => k.id === id);
  if (kind === -1) {
    endRun(world, 'clear');
    return;
  }
  startLegendary(world, kind);
}

/** 伝説戦を始める（「DANGER」の後に kind の伝説が出る）。確認用の ?legend= からも呼ぶ */
export function startLegendary(world: World, kind: number, round = roundIndexOf(world, kind)): void {
  const cfg = world.rules.stage.legendary;
  if (!cfg) return;
  world.cleared = true;
  const appearTick = world.tick + Math.round(cfg.warningSeconds / world.dt);
  world.legendary = { kind, appearTick, endTick: appearTick + Math.round(cfg.timeLimitSeconds / world.dt), spawned: false, result: null, round };
  // 乱入していた伝説（三犬）も、ほかの敵と一緒にいなくなる
  if (world.intruder) world.intruder.done = true;
  world.legendAis.clear();
  // 雑魚はいなくなり、伝説と戦う（2.2）。残っている予告も消す
  const e = world.enemies;
  for (let i = 0; i < e.count; i++) {
    if (e.hp[i]! <= 0) continue;
    e.hp[i] = 0;
    world.events.push({ type: 'enemyRetired', id: e.id[i]! });
  }
  world.bosses.length = 0;
  world.hazards.length = 0;
  world.zones.length = 0;
  world.events.push({ type: 'legendaryWarning', kind });
}

/** kind と戦うラウンドの番号（rounds の後に bonusRounds が続く。はねの戦いは、拾ったはねで並べた番号）。無ければ 0 */
function roundIndexOf(world: World, kind: number): number {
  const at = roundSequence(world).findIndex((r) => r.includes(kind));
  return at === -1 ? 0 : at;
}

/** 今のラウンドの相手が、まだだれか残っているか */
function roundAlive(world: World): boolean {
  const lg = world.legendary;
  if (!lg) return false;
  const kinds = legendRoundKinds(world, lg.kind);
  const e = world.enemies;
  for (let i = 0; i < e.count; i++) if (e.hp[i]! > 0 && kinds.includes(e.kind[i]!)) return true;
  return false;
}

/** ラウンドの相手を全員倒した: 次のラウンドがあれば続け、無ければ勝って終わる */
function winRound(world: World): void {
  const lg = world.legendary!;
  const seq = roundSequence(world);
  // 並びに無い相手（確認用の ?legend= で呼んだルギアなど）は、その1戦で終わる
  const cur = seq.findIndex((r) => r.includes(lg.kind));
  const next = cur + 1;
  if (cur !== -1 && next < seq.length) {
    startLegendary(world, seq[next]![0]!, next);
    return;
  }
  finishLegendary(world, 'won');
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
  world.zones.length = 0;
  world.events.push({ type: 'runEnded', outcome, legendary: world.legendary ? { kind: world.legendary.kind, result: world.legendary.result } : null });
}
