import type { BossMove, LegendField } from '../../data/schema';
import { randomUnit } from '../math';
import { currentWaveIndex, enemyHpScale, findEnemyIndex, moveIndexOfStage, type LegendaryResult, type RunOutcome, type World, type BossEntry, type WingKind, gateDeadlineTick, enemyMoveSpeed } from '../world';
import { hurtPlayer, fieldDamage } from './health';
import { bumpRunStat } from '../runStats';
import { maybeOpenContest } from '../contest';
import { fireCasterMove } from './attack';
import { casterFor } from './legendCasters';
import { spawnItemsAround } from './items';

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
function spawnBoss(world: World, kindIndex: number, moves: readonly number[], interval: number, enrage: BossEntry['enrage'] = null, tag = false, hpScale = 1, phases?: BossEntry['phases']): number {
  const rules = world.rules.stage.bossRules;
  const kind = world.rules.enemies.kinds[kindIndex]!;
  const p = world.players[world.rng.int(world.players.length)]!;
  const [ux, uy] = randomUnit(world.rng);
  const x = p.x + ux * rules.spawnDistance;
  const y = p.y + uy * rules.spawnDistance;
  // 伝説は人数倍（07 の123章）
  const perExtra = kind.rank === 'legendary' ? (rules.legendHpPerExtraPlayerPct ?? rules.hpPerExtraPlayerPct) : rules.hpPerExtraPlayerPct;
  const hp = kind.hp * hpScale * (tag ? (rules.tagHpMultiplier ?? 1) : 1) * (1 + (perExtra * (world.players.length - 1)) / 100);
  const id = world.nextEnemyId++;
  if (world.enemies.add(id, kindIndex, x, y, hp, enemyMoveSpeed(world, kindIndex), kind.radius, kind.contactDamage) === -1) return -1;
  world.events.push({ type: 'enemySpawned', id, kind: kindIndex, x, y });
  world.events.push({ type: 'bossAppeared', id, kind: kindIndex });
  if (moves.length > 0) world.bosses.push({ id, cooldown: interval, interval, moves, next: 0, ...(enrage ? { enrage } : {}), ...(phases?.length ? { phases, phase: -1 } : {}) });
  return id;
}

/**
 * 伝説を1体出す。技は伝説ごとの技（無ければ共通の技を順に）。第2段階（HP が半分を切ると技の間隔が短くなり、2つ同時に使うことがある）は
 * 伝説ごとに数える。出せなければ -1
 */
function spawnLegend(world: World, kind: number, hpScale = 1): number {
  const cfg = world.rules.stage.legendary!;
  const set = cfg.moveSets[world.rules.enemies.kinds[kind]?.id ?? ''];
  const enrage = cfg.enrage && !set?.noEnrage
    ? { hpRatio: cfg.enrage.hpRatio, interval: Math.round((set?.enrageMoveIntervalSeconds ?? cfg.enrage.moveIntervalSeconds) / world.dt), doubleChance: cfg.enrage.doubleChance }
    : null;
  const id = spawnBoss(
    world,
    kind,
    (set?.moves ?? cfg.moves).map((m) => world.rules.stage.moves.findIndex((x) => x.id === m)),
    Math.round((set?.moveIntervalSeconds ?? cfg.moveIntervalSeconds) / world.dt),
    enrage,
    false,
    hpScale,
    set?.phases?.map((ph) => ({ belowRatio: ph.belowHpPct / 100, moves: ph.moves.map((m) => world.rules.stage.moves.findIndex((x) => x.id === m)) })),
  );
  const boss = world.bosses.find((b) => b.id === id);
  if (boss && set?.random) boss.random = true;
  // "*" は毎回 pool からランダムに選ぶ（ミュウ: テレポートとゆびをふるを交互に）
  if (boss && set?.pool) boss.pool = set.pool.map((m) => world.rules.stage.moves.findIndex((x) => x.id === m)).filter((k) => k >= 0);
  if (boss && set?.hpDrops) boss.dropsAt = [...set.hpDrops.atHpPct].sort((a, b) => b - a);
  if (boss && set?.hpMoves) boss.hpMoves = [...set.hpMoves].sort((a, b) => b.belowHpPct - a.belowHpPct).map((h) => ({ belowRatio: h.belowHpPct / 100, moves: h.moves.map((m) => world.rules.stage.moves.findIndex((x) => x.id === m)) }));
  if (boss && set?.intervalAfterMove) boss.intervalAfterMove = true;
  return id;
}

/** ソロ・ホスト: 伝説に与えたダメージを数える（追う相手を決める。07 の125章） */
export function noteLegendThreat(world: World, i: number, by: number, amount: number): void {
  if (world.role === 'guest' || world.players.length < 2 || !world.rules.stage.bossRules.legendThreat) return;
  if (world.rules.enemies.kinds[world.enemies.kind[i]!]?.rank !== 'legendary') return;
  const id = world.enemies.id[i]!;
  let t = world.legendThreat.get(id);
  if (!t) {
    t = { byPlayer: new Map(), since: world.tick };
    world.legendThreat.set(id, t);
  }
  t.byPlayer.set(by, (t.byPlayer.get(by) ?? 0) + amount);
}

/**
 * ソロ・ホスト: 伝説の追う相手を決める（07 の125章）。直近のダメージが一番多い人を追い、今の相手より switchRatio 倍以上多い人がいて、
 * holdSeconds 以上追っていれば乗り換える。今の相手が倒れたら、すぐ次の人へ。変えたらゲストへ知らせる
 */
export function stepLegendTargets(world: World): void {
  const cfg = world.rules.stage.bossRules.legendThreat;
  if (world.role === 'guest' || !cfg || world.players.length < 2) return;
  const keep = Math.pow(cfg.decayPerSecond, world.dt);
  const e = world.enemies;
  for (const [id, t] of world.legendThreat) {
    const i = findEnemyIndex(world, id);
    if (i === -1 || e.hp[i]! <= 0) {
      world.legendThreat.delete(id);
      world.legendTargets.delete(id);
      continue;
    }
    for (const [pid, v] of t.byPlayer) t.byPlayer.set(pid, v * keep);
    const alive = world.players.filter((p) => !p.down);
    if (alive.length === 0) continue;
    let top = alive[0]!;
    for (const p of alive) if ((t.byPlayer.get(p.id) ?? 0) > (t.byPlayer.get(top.id) ?? 0)) top = p;
    const cur = world.legendTargets.get(id);
    const curP = cur === undefined ? undefined : alive.find((p) => p.id === cur);
    const held = world.tick - t.since >= Math.round(cfg.holdSeconds / world.dt);
    const switchTo =
      !curP ? ((t.byPlayer.get(top.id) ?? 0) > 0 ? top : undefined) : top.id !== curP.id && held && (t.byPlayer.get(top.id) ?? 0) > (t.byPlayer.get(curP.id) ?? 0) * cfg.switchRatio ? top : undefined;
    // 今の相手が倒れたら（追う相手がいなくなったら）印を外す（一番近い人を追う）
    if (cur !== undefined && !curP && !switchTo) {
      world.legendTargets.delete(id);
      continue;
    }
    if (!switchTo) continue;
    world.legendTargets.set(id, switchTo.id);
    t.since = world.tick;
    world.events.push({ type: 'legendTarget', enemyId: id, playerId: switchTo.id });
  }
}

/** 伝説 id が追っているプレイヤー（倒れていれば null）。決まっていなければ null（一番近い人） */
export function legendTargetOf(world: World, enemyId: number): World['players'][number] | null {
  const pid = world.legendTargets.get(enemyId);
  if (pid === undefined) return null;
  const p = world.players.find((q) => q.id === pid);
  return p && !p.down ? p : null;
}

/** 区間が始まって予定の時間がたったら中ボス・ボスを出す。伝説戦では伝説を出す */
export function spawnBosses(world: World): void {
  if (world.role === 'guest' || world.players.length === 0) return;
  const lg = world.legendary;
  if (lg) {
    if (!lg.spawned && world.tick >= lg.appearTick) {
      lg.spawned = true;
      // ラウンドの相手は同時に出す（レッド戦のエーフィとカビゴンなど）
      // 伝説戦の伝説だけ HP を増やす（乱入の三犬は増やさない。07 の124章）
      for (const kind of legendRoundKinds(world, lg.kind)) spawnLegend(world, kind, world.rules.stage.bossRules.legendHpMultiplier ?? 1);
    }
    return;
  }
  const inSection = world.tick - world.sectionStartTick;
  while (world.nextBoss < world.bossSchedule.length) {
    const b = world.bossSchedule[world.nextBoss]!;
    if (b.wave > world.section || (b.wave === world.section && b.afterTicks > inSection)) break;
    world.nextBoss++;
    const id = spawnBoss(world, b.kind, b.moves, b.interval, b.enrage, b.tag, 1, b.phases);
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
    // 跳ね回っている（ころがる）
    if (world.bosses.some((b) => b.id === id && b.bounce)) return true;
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
  maybeOpenContest(world, world.section - 1);
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
      // ラティ兄妹は2体一緒に。ほかは1体
      const kinds = cfg?.together ? cfg.kinds.map((id) => world.rules.enemies.kinds.findIndex((k) => k.id === id)) : [it.kind];
      const ids = kinds.map((k) => spawnLegend(world, k));
      // 出せなかった（敵の上限）なら、次の更新で出し直す
      if (ids.some((id) => id === -1)) return;
      it.id = ids[0]!;
      it.ids = ids;
      return;
    }
    const alive = (it.ids ?? [it.id]).filter((id) => {
      const i = findEnemyIndex(world, id);
      return i !== -1 && world.enemies.hp[i]! > 0;
    });
    if (alive.length === 0) {
      it.done = true;
      return;
    }
    if (world.tick >= it.endTick) {
      it.done = true;
      for (const id of alive) {
        world.enemies.hp[findEnemyIndex(world, id)] = 0;
        world.events.push({ type: 'enemyRetired', id });
      }
      world.events.push({ type: 'intruderLeft', kind: it.kind });
    }
    return;
  }
  if (!cfg || it || world.legendary || world.cleared) return;
  while (world.nextIntruderCheck < cfg.minutes.length && world.tick >= Math.round((cfg.minutes[world.nextIntruderCheck]! * 60) / world.dt)) {
    world.nextIntruderCheck++;
    if (world.rng.next() >= cfg.chance) continue;
    const kind = world.rules.enemies.kinds.findIndex((k) => k.id === cfg.kinds[cfg.together ? 0 : world.rng.int(cfg.kinds.length)]);
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
      if (s.pattern === 'haunt') world.haunts.set(id, world.tick + Math.round((s.lifeSeconds ?? 20) / world.dt));
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
    } else if (s.pattern === 'bomber' || s.pattern === 'haunt') {
      // 画面の外から転がってくる（ふつうに追ってくる。ビリリダマはプレイヤーより速い。ヌケニンはゆっくり）
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
  // 時間で消える敵（ヌケニン）
  for (const [id, until] of world.haunts) {
    const i = findEnemyIndex(world, id);
    if (i === -1 || world.enemies.hp[i]! <= 0) world.haunts.delete(id);
    else if (world.tick >= until) {
      world.enemies.hp[i] = 0;
      world.enemies.ghostTicks[i] = 0;
      world.haunts.delete(id);
      world.events.push({ type: 'enemyRetired', id });
    }
  }
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
      switchPhase(world, boss, i);
      fieldLightning(world, boss, i);
      dropAtHp(world, boss, i);
      // 跳ね回っている間（ボルテッカー・ころがる）と、反動で止まっている間は、次の技を使わない（07 の167章）
      if (stepBounce(world, boss, i)) continue;
      // 消えている間（潜る・跳ぶ技の予告の間）は、次の技を使わない
      if (world.hiddenEnemies.has(boss.id)) continue;
      if (boss.stunTicks) {
        if (--boss.stunTicks === 0) world.enemies.speed[i] = bossSpeed(world, boss, i);
        continue;
      }
      // 交代: 順番でない相手は歩くだけ。順番が来たら、少し間を置いて技を始める（07 の193章）
      const turns = legendTurns(world, i);
      if (turns) {
        if (bossBusy(world, boss.id)) continue;
        if (!legendTurnIsActive(world, i)) {
          boss.waiting = true;
          boss.cooldown = Math.max(1, Math.round(turns.startDelaySeconds / world.dt));
          world.enemies.speed[i] = (bossSpeed(world, boss, i) * turns.idleSpeedPct) / 100;
          continue;
        }
      }
      // 最後の 1 体になったときも、歩く速さを戻す
      if (boss.waiting && legendTurnIsActive(world, i)) {
        boss.waiting = false;
        world.enemies.speed[i] = bossSpeed(world, boss, i);
      }
      // HP で放つ大技（ピカチュウのボルテッカー）: 今の技が終わり次第、順に使う
      const next = boss.hpMoves?.[0];
      if (next && world.enemies.hp[i]! <= world.enemies.maxHp[i]! * next.belowRatio) {
        boss.hpMoves!.shift();
        (boss.forced ??= []).push(...next.moves);
      }
      if (boss.forced?.length) {
        if (!bossBusy(world, boss.id)) useBossMove(world, boss, i, boss.forced.shift()!);
        boss.cooldown = boss.interval;
        continue;
      }
      // 技が終わってから間隔を数える（間隔のぶん必ず歩く）
      if (boss.intervalAfterMove && bossBusy(world, boss.id)) {
        boss.cooldown = boss.interval;
        continue;
      }
      if (--boss.cooldown > 0) continue;
      // 止まって出す技・跳ぶ技・続きのある技の途中は、次の技を始めない（テレポートで離れた後に、前の場所から光線が出ていた。07 の191章）
      if (bossBusy(world, boss.id)) {
        boss.cooldown = 1;
        continue;
      }
      // りゅうのまい: 重ねた段だけ技の間隔が短い
      const quick = 1 - (boss.stacks ?? 0) * (stackedBuff(world, boss)?.intervalPct ?? 0) / 100;
      boss.cooldown = Math.max(1, Math.round(boss.interval * Math.max(0.2, quick)));
      // 2つ同時に使う確率: 伝説・四天王の第2段階
      const double = boss.enraged && boss.enrage ? boss.enrage.doubleChance : 0;
      const uses = double > 0 && world.rng.next() < double ? 2 : 1;
      for (let u = 0; u < uses; u++) {
        if (u > 0 && bossBusy(world, boss.id)) break;
        useBossMove(world, boss, i);
      }
    }
    runBossQueue(world);
    retireDecoys(world);
  }
  markHiddenBosses(world);
  strikeHazards(world);
}

/** HP が決めた割合を切るたびに、道具を人数分落とす（雑魚のいないレッド戦の回復。ソロ・ホスト。07 の193章） */
function dropAtHp(world: World, boss: World['bosses'][number], i: number): void {
  const at = boss.dropsAt;
  if (!at?.length) return;
  const pct = (world.enemies.hp[i]! / Math.max(1, world.enemies.maxHp[i]!)) * 100;
  if (pct > at[0]!) return;
  at.shift();
  const set = world.rules.stage.legendary?.moveSets[world.rules.enemies.kinds[world.enemies.kind[i]!]?.id ?? ''];
  if (set?.hpDrops) spawnItemsAround(world, set.hpDrops.item, world.enemies.x[i]!, world.enemies.y[i]!, world.players.length);
}

/**
 * 交代の決まり（07 の193章）: i の相手のラウンドに turns があり、まだ 2 体以上残っていれば返す。
 * どのブラウザでも同じになるよう、順番は残り時間（endTick）と残っている相手から決める
 */
export function legendTurns(world: World, i: number): NonNullable<NonNullable<NonNullable<World['rules']['stage']['legendary']>['rounds']>[number]['turns']> | null {
  const lg = world.legendary;
  if (!lg || lg.result) return null;
  const id = world.rules.enemies.kinds[world.enemies.kind[i]!]?.id ?? '';
  const round = world.rules.stage.legendary?.rounds?.find((r) => r.kinds.includes(id));
  if (!round?.turns || turnAlive(world).length < 2) return null;
  return round.turns;
}

/** 交代のあるラウンドで、残っている相手の敵の番号（ラウンドの kinds の順） */
function turnAlive(world: World): number[] {
  const lg = world.legendary;
  if (!lg) return [];
  const e = world.enemies;
  const out: number[] = [];
  for (const k of legendRoundKinds(world, lg.kind)) {
    for (let i = 0; i < e.count; i++) if (e.kind[i] === k && e.hp[i]! > 0) out.push(i);
  }
  return out;
}

/** 交代で、今が i の相手の順番か（交代が無ければ常に順番） */
export function legendTurnIsActive(world: World, i: number): boolean {
  const turns = legendTurns(world, i);
  if (!turns) return true;
  const alive = turnAlive(world);
  const n = Math.floor((Math.max(0, world.legendary!.endTick - world.tick) * world.dt) / turns.seconds);
  return alive[alive.length - 1 - (n % alive.length)] === i;
}

/** 段階（変化タイプ）: HP が段階の割合を切ったら技を切り替え、「DANGER」を出す（ソロ・ホスト） */
function switchPhase(world: World, boss: World['bosses'][number], i: number): void {
  if (!boss.phases) return;
  const ratio = world.enemies.hp[i]! / Math.max(1, world.enemies.maxHp[i]!);
  let at = -1;
  boss.phases.forEach((p, k) => {
    if (ratio < p.belowRatio) at = k;
  });
  if (at === (boss.phase ?? -1) || at === -1) return;
  boss.phase = at;
  boss.moves = boss.phases[at]!.moves;
  boss.next = 0;
  boss.cooldown = Math.min(boss.cooldown, Math.round(0.6 / world.dt));
  world.events.push({ type: 'legendaryWarning', kind: world.enemies.kind[i]!, enraged: true });
}

/** そのボスが使った、重ねる強化（りゅうのまい）の技の buff。無ければ undefined */
function stackedBuff(world: World, boss: World['bosses'][number]): BossMove['buff'] | undefined {
  if (!boss.stacks) return undefined;
  for (const m of boss.moves) {
    const b = world.rules.stage.moves[m]?.buff;
    if (b && (b.speedPct || b.intervalPct)) return b;
  }
  return undefined;
}

/** ボスの今の速さ（りゅうのまい の段を足す） */
function bossSpeed(world: World, boss: World['bosses'][number], i: number): number {
  const base = enemyMoveSpeed(world, world.enemies.kind[i]!);
  return base * (1 + ((boss.stacks ?? 0) * (stackedBuff(world, boss)?.speedPct ?? 0)) / 100);
}

/** 跳ね回る（ボルテッカー・ころがる。ソロ・ホスト）: 箱の端で跳ね返りながら進む。跳ね回っている間は true */
function stepBounce(world: World, boss: World['bosses'][number], i: number): boolean {
  const bn = boss.bounce;
  if (!bn) return false;
  const e = world.enemies;
  e.speed[i] = 0;
  let x = e.x[i]! + bn.vx * world.dt;
  let y = e.y[i]! + bn.vy * world.dt;
  if (x < bn.cx - bn.hw || x > bn.cx + bn.hw) {
    bn.vx = -bn.vx;
    x = Math.max(bn.cx - bn.hw, Math.min(bn.cx + bn.hw, x));
  }
  if (y < bn.cy - bn.hh || y > bn.cy + bn.hh) {
    bn.vy = -bn.vy;
    y = Math.max(bn.cy - bn.hh, Math.min(bn.cy + bn.hh, y));
  }
  e.x[i] = x;
  e.y[i] = y;
  if (--bn.ticks <= 0) {
    boss.bounce = undefined;
    e.speed[i] = bossSpeed(world, boss, i);
  }
  return true;
}

/** 少し後に使う技（みらいよち の続き）を、時間が来たら使う（ソロ・ホスト） */
function runBossQueue(world: World): void {
  for (let k = world.bossQueue.length - 1; k >= 0; k--) {
    const q = world.bossQueue[k]!;
    if (q.tick > world.tick) continue;
    world.bossQueue.splice(k, 1);
    const i = findEnemyIndex(world, q.bossId);
    if (i !== -1 && world.enemies.hp[i]! > 0) castBossMove(world, q.bossId, i, q.move, q.index);
  }
}

/** かげぶんしん の偽物を、時間が来たら消す（ソロ・ホスト） */
function retireDecoys(world: World): void {
  for (const [id, end] of world.decoys) {
    const i = findEnemyIndex(world, id);
    if (i === -1 || world.enemies.hp[i]! <= 0) {
      world.decoys.delete(id);
      continue;
    }
    if (world.tick < end) continue;
    world.decoys.delete(id);
    world.enemies.hp[i] = 0;
    world.events.push({ type: 'enemyRetired', id });
  }
}

/** 消えているボス（潜る・跳ぶ技の予告の間）を決める。どのブラウザでも予告から同じように決まる */
function markHiddenBosses(world: World): void {
  world.hiddenEnemies.clear();
  for (const h of world.hazards) {
    if (h.dasher === -1 || h.activeTicks !== undefined) continue;
    if (world.rules.stage.moves[h.move]?.hideBoss) world.hiddenEnemies.add(h.dasher);
  }
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

/** ボスが自分の場所から出す技の途中か（予告の間止まる・跳ぶ・消える技、波の続きが残っている） */
function bossBusy(world: World, id: number): boolean {
  if (world.bossQueue.some((q) => q.bossId === id)) return true;
  return world.hazards.some((h) => {
    if (h.dasher !== id) return false;
    const m = world.rules.stage.moves[h.move];
    // 体が回っている間（ジャイロボール）も次へ行かない
    if (h.activeTicks !== undefined) return !!(m?.spinBody || m?.holdWhileActive);
    return !!(m?.rooted || m?.teleport || m?.hideBoss || m?.spinBody);
  });
}

/** ボス・伝説が技を1つ使う（予告を置く） */
function useBossMove(world: World, boss: World['bosses'][number], i: number, forced?: number): void {
  let moveIdx = forced !== undefined ? forced : boss.random ? boss.moves[world.rng.int(boss.moves.length)]! : boss.moves[boss.next++ % boss.moves.length]!;
  if (moveIdx === -1 && boss.pool && boss.pool.length > 0) moveIdx = boss.pool[world.rng.int(boss.pool.length)]!;
  const move = world.rules.stage.moves[moveIdx];
  // 止まる技は、突進が終わってから始める（続けて突進する技の途中で止まると、絵が走っている体から離れる。07 の193章）
  if (move?.rooted && (world.enemies.kbTicks[i]! > 0 || world.hazards.some((h) => h.dasher === boss.id && !!world.rules.stage.moves[h.move]?.dashSpeed))) {
    if (!boss.random) boss.next--;
    boss.cooldown = 1;
    return;
  }
  // 使える回数のある技（あさのひざし・ねむる）: 使い切ったら順番を飛ばす
  if (move?.maxUses !== undefined) {
    const uses = (boss.uses ??= {});
    if ((uses[moveIdx] ?? 0) >= move.maxUses) {
      boss.cooldown = 1;
      return;
    }
    uses[moveIdx] = (uses[moveIdx] ?? 0) + 1;
  }
  // タッグの相手が突進している間は、突進する技を使わず、少し後にもう一度見る
  if ((move?.dashSpeed || move?.bounce) && partnerDashing(world, boss.id)) {
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

/**
 * ボス・伝説が技 moveIdx を、今の場所から使う（予告を置く）。続けて使う技（then）からも呼ぶ。
 * repeatIndex は狙い直して置く技（みらいよち）の何回目か（0 が最初。最初のときだけ続きを予定に入れる）
 */
function castBossMove(world: World, bossId: number, i: number, moveIdx: number, repeatIndex = 0): void {
  const move = world.rules.stage.moves[moveIdx];
  if (!move) return;
  const bx = world.enemies.x[i]!;
  const by = world.enemies.y[i]!;
  const target = ((move.targetPick ?? 'nearest') === 'nearest' ? legendTargetOf(world, bossId) : null) ?? pickPlayer(world, bx, by, move.targetPick ?? 'nearest');
  if (!target) return;
  const boss = world.bosses.find((b) => b.id === bossId);
  // 1回の技で出す範囲の組（×の2本などで、1回の技で当たるのは1回）
  const group = world.nextHazardGroup++;
  // ビルドアップ: 次の何回かの技は範囲が大きい
  let scale = 1;
  if (boss?.radiusBuff && boss.radiusBuff.uses > 0 && !move.buff) {
    scale = boss.radiusBuff.scale;
    if (--boss.radiusBuff.uses <= 0) boss.radiusBuff = undefined;
  }
  const radius = scale !== 1 ? move.radius * scale : undefined;
  const put = (x: number, y: number, dx: number, dy: number, dasher: number, extra: Parameters<typeof addHazard>[8] = {}): void =>
    addHazard(world, moveIdx, x, y, dx, dy, dasher, undefined, { group, ...(radius ? { radius } : {}), ...extra });
  // 狙い直して何回も置く（みらいよち）: 続きを予定に入れる
  if (move.repeat && repeatIndex === 0) {
    for (let k = 1; k < move.repeat.count; k++) world.bossQueue.push({ tick: world.tick + Math.round((k * move.repeat.everySeconds) / world.dt), bossId, move: moveIdx, index: k });
  }
  // 予告の間止まる技（ファイヤーのゴッドバード。ゲストも予告の知らせで止める）
  if (move.rooted) world.enemies.speed[i] = 0;
  const dx0 = target.x - bx;
  const dy0 = target.y - by;
  const len0 = Math.hypot(dx0, dy0) || 1;
  const ux = dx0 / len0;
  const uy = dy0 / len0;
  if (move.decoys) {
    castDecoys(world, bossId, i, move, moveIdx, target, put);
    return;
  }
  if (move.bullets) {
    // 飛ぶ玉（サンダー）: 自分からランダムな向きへ
    for (let k = 0; k < move.bullets.count; k++) {
      const [rx, ry] = randomUnit(world.rng);
      put(bx, by, rx, ry, bossId);
    }
    return;
  }
  if (move.wall) {
    // 押し寄せる波（なみのり）: 狙った人の手前 distance から、横に長い帯が狙った人の方へ進む。帯は gap の切れ目で2本に分ける
    const w = move.wall;
    const cx = target.x - ux * w.distance;
    const cy = target.y - uy * w.distance;
    // 帯の向き（進む向きに垂直）と、切れ目の場所（真ん中から ±length/4 のどこか）
    const px = -uy;
    const py = ux;
    const gapAt = (world.rng.next() - 0.5) * (w.length / 2);
    const speed = move.travel?.speed ?? 200;
    const half = w.length / 2;
    const left = gapAt - w.gap / 2 + half;
    const right = half - (gapAt + w.gap / 2);
    if (left > 0) put(cx - px * half, cy - py * half, px, py, -1, { length: left, vx: ux * speed, vy: uy * speed });
    if (right > 0) put(cx + px * (gapAt + w.gap / 2), cy + py * (gapAt + w.gap / 2), px, py, -1, { length: right, vx: ux * speed, vy: uy * speed });
    return;
  }
  if (move.arms) {
    // 中心から何本もの線（×・大の字・十字）。中心はボス（self）か狙った人
    const arms = move.arms;
    const self = move.target === 'self';
    const cx = self ? bx : target.x;
    const cy = self ? by : target.y;
    const spin = (repeatIndex * (arms.spinPerRepeat ?? 0) * Math.PI) / 180;
    const base = (arms.absolute ? 0 : Math.atan2(uy, ux)) + (arms.offsetDegrees * Math.PI) / 180 + spin;
    const angles = arms.fan?.map((d) => Math.atan2(uy, ux) + spin + (d * Math.PI) / 180) ?? arms.angles?.map((d) => (d * Math.PI) / 180) ?? Array.from({ length: arms.count }, (_, k) => base + (k * Math.PI * 2) / arms.count);
    for (const a of angles) {
      // 狙った人が真ん中: 線は中心より少し手前から（×の交わる所も当たる）
      const back = self ? 0 : move.radius;
      put(cx - Math.cos(a) * back, cy - Math.sin(a) * back, Math.cos(a), Math.sin(a), self ? bossId : -1);
    }
    return;
  }
  if (move.around) {
    // ボスの周りに順に（ライコウのかみなり）: 狙った人の向きから回る。中心を狙った人にすると、その人を囲む（クロバットの どくどく）
    const around = move.around.center === 'target';
    const ox = around ? target.x : bx;
    const oy = around ? target.y : by;
    const start = around ? Math.atan2(by - target.y, bx - target.x) : Math.atan2(uy, ux);
    const step = ((move.around.clockwise ? 1 : -1) * Math.PI * 2) / move.count;
    for (let c = 0; c < move.count; c++) {
      const a = start + c * step;
      put(ox + Math.cos(a) * move.around.radius, oy + Math.sin(a) * move.around.radius, 0, 0, -1, { delay: Math.round(((move.stagger ?? 0) * c) / world.dt) });
    }
    return;
  }
  if (move.along) {
    // 狙った人への向きに並べて順に（エンテイのふみつけ）
    for (const deg of move.fan ?? [0]) {
      const a = Math.atan2(uy, ux) + (deg * Math.PI) / 180;
      const vx = Math.cos(a);
      const vy = Math.sin(a);
      for (let c = 0; c < move.count; c++) {
        const d = move.along.start + c * move.along.spacing;
        // 止まって出す技は、落ちた時にまた動けるようボスを結び付ける（無いと止まったままになる）
        put(bx + vx * d, by + vy * d, vx, vy, move.rooted ? bossId : -1, { delay: Math.round(((move.stagger ?? 0) * c) / world.dt) });
      }
    }
    return;
  }
  if (move.bounce) {
    // 跳ね回る（ボルテッカー）: 予告は走り出す向きの線。落ちたら走り出す（strikeHazards）。当たる範囲はボスに付いていく
    put(bx, by, ux, uy, bossId, { boxX: target.x, boxY: target.y });
    return;
  }
  if (move.homing || move.follow) {
    // 必中（ファイヤーのゴッドバード）: 予告が狙ったプレイヤーを追いかける。直線（フシギバナのソーラービーム）は、ボスから狙った人への向きを追う。
    // follow は決まった秒数だけ追う（影が這う・雷雲・波紋）。潜る・跳ぶ技はボスが消え、落ちた所に現れる
    const dasher = move.teleport || move.hideBoss || move.rooted || move.playerMove ? bossId : -1;
    if (move.shape === 'line' || move.shape === 'cone') put(bx, by, ux, uy, bossId, { follow: target.id });
    else put(move.follow?.speed ? bx : target.x, move.follow?.speed ? by : target.y, 0, 0, dasher, { follow: target.id });
    return;
  }
  if (move.travel && move.target === 'player') {
    // ボスから狙った人の方へ飛ばす（りゅうのいかり・たつまき・おにび）。count 個を spread 度ずつ開いて並べる
    const base = Math.atan2(uy, ux);
    for (let c = 0; c < move.count; c++) {
      const a = base + (((c - (move.count - 1) / 2) * move.spread) * Math.PI) / 180;
      put(bx, by, Math.cos(a), Math.sin(a), move.rooted ? bossId : -1, { delay: Math.round(((move.stagger ?? 0) * c) / world.dt) });
    }
    return;
  }
  if (move.target === 'random') {
    // だれかの周りのランダムな場所（サイコブレイク・落雷）。テレポートなら、ボスがそこへ現れる
    const alive = world.players.filter((x) => !x.down);
    const count = countOf(world, move, i);
    for (let c = 0; c < count; c++) {
      const p = alive[world.rng.int(Math.max(1, alive.length))] ?? target;
      const [rx, ry] = randomUnit(world.rng);
      const dist = world.rng.range(0, move.spread);
      put(p.x + rx * dist, p.y + ry * dist, 0, 0, move.teleport ? bossId : -1, { delay: Math.round(((move.stagger ?? 0) * c) / world.dt) });
    }
    return;
  }
  if (move.shape === 'line' || move.shape === 'cone') {
    // 自分から狙ったプレイヤーへ向かう直線・扇
    put(bx, by, ux, uy, move.dashSpeed || move.rooted || move.playerMove || move.followBoss || move.sweep || move.recoilSeconds ? bossId : -1);
  } else if (move.target === 'self' && move.rings) {
    // 外へ広がる輪（ミュウツー）: 1本ずつ遅らせて、外側ほど遠くに出す
    for (let k = 0; k < move.rings.count; k++) {
      const r = (move.radius + k * move.rings.step) * scale;
      put(bx, by, 0, 0, move.followBoss || move.rooted ? bossId : -1, { delay: Math.round(((move.stagger ?? 0) * k) / world.dt), radius: r, inner: Math.max(0, r - move.rings.width * scale) });
    }
  } else if (move.target === 'self') {
    put(bx, by, ux, uy, move.rooted || move.playerMove || move.followBoss || move.counter || move.buff || move.healPct || move.then || move.recoilSeconds ? bossId : -1);
  } else if (move.teleport) {
    // 瞬間移動（ミュウツー）: 狙ったプレイヤーの後ろ（向いている方向の反対）に予告し、落ちたらそこへ現れる
    const fl = Math.hypot(target.facingX, target.facingY) || 1;
    const fx = target.facingX / fl || 1;
    const fy = target.facingY / fl;
    put(target.x - fx * move.spread, target.y - fy * move.spread, ux, uy, bossId);
  } else {
    // 協力プレイの伝説は、生きている全員の足元に落とす（逃げる係と攻撃する係に分かれて楽にならないように。07 の125章）
    const legend = world.rules.enemies.kinds[world.enemies.kind[i]!]?.rank === 'legendary';
    const targets = legend && world.rules.stage.bossRules.legendHitsAllPlayers && world.players.length > 1 ? world.players.filter((p) => !p.down) : [target];
    const count = countOf(world, move, i);
    for (const t of targets) {
      for (let c = 0; c < count; c++) {
        // 1つ目は足元、2つ目以降はばらつかせる（動かないと当たり、動けば避けられる）
        const [rx, ry] = c === 0 && !move.scatter ? [0, 0] : randomUnit(world.rng);
        const dist = move.scatter ? world.rng.range(0, move.spread) : c === 0 ? 0 : world.rng.range(move.radius, move.spread + move.radius);
        // 狙った人を囲む輪（くろいまなざし）: 内側の半径は rings.width で決める
        const ring = move.shape === 'ring' && move.rings ? { inner: Math.max(0, move.radius * scale - move.rings.width * scale) } : {};
        put(t.x + rx * dist, t.y + ry * dist, ux, uy, move.healPct || move.rooted || move.then || move.teleport || move.hideBoss || move.followBoss ? bossId : -1, { delay: Math.round(((move.stagger ?? 0) * c) / world.dt), ...ring });
      }
    }
  }
}

/** 落とす数。countByHp ならボスの残りの HP の割合で減らす（しおふき。最低 1） */
function countOf(world: World, move: BossMove, i: number): number {
  if (!move.countByHp) return move.count;
  return Math.max(1, Math.round(move.count * (world.enemies.hp[i]! / Math.max(1, world.enemies.maxHp[i]!))));
}

/**
 * かげぶんしん（ソロ・ホスト）: 狙った人の周りに、本物を含めて count + 1 か所を等しく並べる。本物はその1か所へ移り（予告つきのテレポート）、
 * 残りに偽物を出す。偽物は少し透けて、触れると消える（HP が少ない）。seconds 秒で消える
 */
function castDecoys(
  world: World,
  bossId: number,
  i: number,
  move: BossMove,
  moveIdx: number,
  target: World['players'][number],
  put: (x: number, y: number, dx: number, dy: number, dasher: number, extra?: Parameters<typeof addHazard>[8]) => void,
): void {
  const d = move.decoys!;
  const kind = world.rules.enemies.kinds.findIndex((k) => k.id === d.kind);
  const spots = d.count + 1;
  const start = world.rng.next() * Math.PI * 2;
  const real = world.rng.int(spots);
  for (let k = 0; k < spots; k++) {
    const a = start + (k * Math.PI * 2) / spots;
    const x = target.x + Math.cos(a) * d.radius;
    const y = target.y + Math.sin(a) * d.radius;
    if (k === real) {
      // 本物: 予告の後にそこへ現れる
      put(x, y, 0, 0, bossId);
      continue;
    }
    if (kind === -1) continue;
    const def = world.rules.enemies.kinds[kind]!;
    const id = world.nextEnemyId++;
    if (world.enemies.add(id, kind, x, y, def.hp, enemyMoveSpeed(world, kind), def.radius, def.contactDamage) === -1) continue;
    world.events.push({ type: 'enemySpawned', id, kind, x, y });
    world.decoys.set(id, world.tick + Math.round(d.seconds / world.dt));
  }
  void moveIdx;
  void i;
}

/** 範囲技が残した床: 時間を進め、自分のプレイヤーが上にいれば遅くする・削る・引き寄せる（当たったかは自分のブラウザで決める） */
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
    // ボスに付いていく床（じゅうりょく）
    if (z.followEnemy !== undefined) {
      const i = findEnemyIndex(world, z.followEnemy);
      if (i === -1 || world.enemies.hp[i]! <= 0) {
        world.zones.splice(k, 1);
        continue;
      }
      z.x = world.enemies.x[i]!;
      z.y = world.enemies.y[i]!;
    }
    if (!me || me.down || (me.x - z.x) ** 2 + (me.y - z.y) ** 2 > (z.radius + me.radius) ** 2) continue;
    slow = Math.max(slow, z.slowPct);
    burn = Math.max(burn, z.damagePerSecond);
    // 引き寄せる床（すなじごく・じゅうりょく。07 の167章）: 中心へ少しずつ
    if (z.pullPerSecond) {
      const dx = z.x - me.x;
      const dy = z.y - me.y;
      const d = Math.hypot(dx, dy);
      if (d > 4) {
        const step = Math.min(d, z.pullPerSecond * world.dt);
        me.x += (dx / d) * step;
        me.y += (dy / d) * step;
      }
    }
  }
  if (!me) return;
  tickPlayerConditions(world, me);
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

/** ボスの技の効き目（ねむけ・やけど・冷え）の時間を進める（自分のプレイヤーだけ。07 の167章） */
function tickPlayerConditions(world: World, me: World['players'][number]): void {
  if (me.drowsyTicks) me.drowsyTicks--;
  if (me.chillTicks && --me.chillTicks === 0) me.chill = 0;
  if (me.burnTicks) {
    me.burnTicks--;
    // やけど: 0.5 秒ごとに、最大 HP の割合で削られる（防御は効かない）
    me.burnHurtTicks = (me.burnHurtTicks ?? 0) + 1;
    if (me.burnHurtTicks >= Math.round(0.5 / world.dt)) {
      me.burnHurtTicks = 0;
      if (!me.down) fieldDamage(world, me, (me.maxHp * (world.rules.stage.bossRules.burnPctPerSecond ?? 1.5) * 0.5) / 100);
    }
  }
}

/** 自分のプレイヤーに、範囲技 hz を当てる（1回の技の組で1回。効き目もここで） */
function hitLocal(world: World, me: World['players'][number], hz: World['hazards'][number], move: BossMove | undefined): void {
  if (hz.group !== undefined) {
    if (world.hazardGroupsHit.has(hz.group)) return;
    world.hazardGroupsHit.add(hz.group);
  }
  hz.hitLocal = true;
  const conditioned = !!(me.drowsyTicks || me.burnTicks || me.chill || me.frozenTicks);
  const bonus = conditioned && move?.onHit?.statusBonusPct ? 1 + move.onHit.statusBonusPct / 100 : 1;
  hurtPlayer(world, me, hazardDamage(world, (hz.damageOverride || hz.damage) * bonus));
  bumpRunStat(world, me, 'bossAoeHits');
  const on = move?.onHit;
  if (!on) return;
  if (on.drowsySeconds) me.drowsyTicks = Math.max(me.drowsyTicks ?? 0, Math.round(on.drowsySeconds / world.dt));
  if (on.burnSeconds) me.burnTicks = (me.burnTicks ?? 0) + Math.round(on.burnSeconds / world.dt);
  if (on.flinchSeconds && !me.frozenTicks) me.frozenTicks = Math.round(on.flinchSeconds / world.dt);
  if (on.chill) {
    const rules = world.rules.stage.bossRules;
    me.chill = (me.chill ?? 0) + on.chill;
    me.chillTicks = Math.round((rules.chillForgetSeconds ?? 4) / world.dt);
    if (me.chill >= (rules.chillToFreeze ?? 3)) {
      me.chill = 0;
      me.frozenTicks = Math.round((rules.chillFreezeSeconds ?? 1.2) / world.dt);
      world.events.push({ type: 'playerFrozen', playerId: me.id });
    }
  }
  if (on.pushSpeed) {
    // ボス（無ければ範囲の中心）から外へすべらせる（瞬間移動させない）
    const i = hz.dasher !== -1 ? findEnemyIndex(world, hz.dasher) : -1;
    const ox = i !== -1 ? world.enemies.x[i]! : hz.x;
    const oy = i !== -1 ? world.enemies.y[i]! : hz.y;
    const d = Math.hypot(me.x - ox, me.y - oy) || 1;
    me.pushVx = ((me.x - ox) / d) * on.pushSpeed;
    me.pushVy = ((me.y - oy) / d) * on.pushSpeed;
    me.pushTicks = Math.round((on.pushSeconds ?? 0.3) / world.dt);
  }
}

/** 予告の時間が来た範囲技を当てる */
function strikeHazards(world: World): void {
  tickZones(world);
  tickLegendField(world);
  const me = world.players.find((p) => p.id === world.localPlayerId);
  // 何本もの線の技（×・大の字）は、落ちたときの絵を組ごとに1つだけ（真ん中に）出す
  const armsStruck = new Set<number>();
  for (let h = world.hazards.length - 1; h >= 0; h--) {
    const hz = world.hazards[h]!;
    const move = world.rules.stage.moves[hz.move];
    // ボスに付いていく範囲（ほろびのうた・フレアドライブ・カウンター）
    if (move?.followBoss && hz.dasher !== -1) {
      const i = findEnemyIndex(world, hz.dasher);
      if (i !== -1) {
        hz.x = world.enemies.x[i]!;
        hz.y = world.enemies.y[i]!;
      }
    }
    // 落ちた後: 残っている間に触れると当たる（1つの範囲技で1回。hitEverySeconds があればその間隔で何回も）。時間が来たら消す
    if (hz.activeTicks !== undefined) {
      if (--hz.activeTicks <= 0) {
        world.hazards.splice(h, 1);
        // 当たっている間止まっていたボスは、また動く
        if (move?.holdWhileActive && world.role !== 'guest') {
          const i = findEnemyIndex(world, hz.dasher);
          const boss = world.bosses.find((b) => b.id === hz.dasher);
          if (i !== -1 && boss) world.enemies.speed[i] = bossSpeed(world, boss, i);
        }
        // 組の範囲が全部消えたら、当たった印も消す
        if (hz.group !== undefined && !world.hazards.some((o) => o.group === hz.group)) world.hazardGroupsHit.delete(hz.group);
        continue;
      }
      stepActiveHazard(world, hz, move);
      if (move?.hitEverySeconds && hz.hitLocal && hz.rehitTicks !== undefined && --hz.rehitTicks <= 0) {
        hz.hitLocal = false;
        if (hz.group !== undefined) world.hazardGroupsHit.delete(hz.group);
        hz.rehitTicks = Math.round(move.hitEverySeconds / world.dt);
      }
      if (me && !me.down && me.invincibleTicks <= 0 && !hz.hitLocal && hazardHits(hz, me.x, me.y, me.radius, move)) {
        hitLocal(world, me, hz, move);
        // 罠（ふいうち）: 踏んだ人の画面で、その場で飛び出す
        if (move?.trap) world.events.push(struckEvent(hz, move));
      }
      continue;
    }
    // 必中の予告: 狙ったプレイヤーを追いかける（当たったかは狙われた人のブラウザで決めるので、本人の画面では必ず当たる）。
    // follow は決まった秒数だけ（速さがあればその速さまで）追い、その後は止まる
    const elapsed = (hz.totalTicks - hz.ticksLeft) * world.dt;
    if (hz.follow !== undefined && hz.follow !== -1 && (!move?.follow || elapsed < move.follow.seconds)) {
      const p = world.players.find((x) => x.id === hz.follow);
      if (p && !p.down) {
        if (hz.shape === 'line' || hz.shape === 'cone') {
          const len = Math.hypot(p.x - hz.x, p.y - hz.y) || 1;
          hz.dirX = (p.x - hz.x) / len;
          hz.dirY = (p.y - hz.y) / len;
        } else if (move?.follow?.speed) {
          const dx = p.x - hz.x;
          const dy = p.y - hz.y;
          const d = Math.hypot(dx, dy);
          const step = Math.min(d, move.follow.speed * world.dt);
          if (d > 0) {
            hz.x += (dx / d) * step;
            hz.y += (dy / d) * step;
          }
        } else {
          hz.x = p.x;
          hz.y = p.y;
        }
      }
    }
    if (--hz.ticksLeft > 0) continue;
    // 落ちた: 予告を消し、少しの間は当たる範囲として残す（描画は予告として描かない）。飛ぶ玉は飛んでいる間ずっと当たる
    const active = move?.bounce?.seconds ?? move?.sweep?.seconds ?? move?.trap?.seconds ?? move?.activeSeconds ?? (move?.bullets ? move.bullets.seconds : world.rules.stage.bossRules.hazardActiveSeconds);
    hz.activeTicks = Math.max(1, Math.round(active / world.dt));
    if (move?.hitEverySeconds) hz.rehitTicks = Math.round(move.hitEverySeconds / world.dt);
    if (move?.sweep) {
      hz.baseDirX = hz.dirX;
      hz.baseDirY = hz.dirY;
    }
    if (move?.travel && hz.vx === undefined) {
      hz.vx = hz.dirX * move.travel.speed;
      hz.vy = hz.dirY * move.travel.speed;
    }
    // 予告の間止まっていたボスは、また動く（反動で止まる技は、反動が終わるまで止まったまま）
    if ((move?.rooted || move?.recoilSeconds) && hz.dasher !== -1) {
      const i = findEnemyIndex(world, hz.dasher);
      const boss = world.bosses.find((b) => b.id === hz.dasher);
      if (i !== -1 && move.recoilSeconds && boss && world.role !== 'guest') {
        boss.stunTicks = Math.round(move.recoilSeconds / world.dt);
        world.enemies.speed[i] = 0;
      } else if (i !== -1 && move.rooted && !move.recoilSeconds && !move.holdWhileActive) world.enemies.speed[i] = boss ? bossSpeed(world, boss, i) : enemyMoveSpeed(world, world.enemies.kind[i]!);
    }
    if (move?.arms && hz.group !== undefined) {
      if (!armsStruck.has(hz.group)) {
        armsStruck.add(hz.group);
        // 真ん中: ボスが中心の技は始点、狙った人が中心の技は始点から半径ぶん先
        const back = move.target === 'self' ? 0 : move.radius;
        world.events.push({ ...struckEvent(hz, move), x: hz.x + hz.dirX * back, y: hz.y + hz.dirY * back, shape: 'circle', radius: hz.length - back });
      }
    } else if (!move?.trap) world.events.push(struckEvent(hz, move));
    if (world.role !== 'guest' && hz.dasher !== -1) onBossMoveStruck(world, hz, move);
    // 残る床（凍った床・燃える地面・砂の渦）。直線は線に沿って並べる。どのブラウザでも同じものを作る
    if (move?.leaves) {
      const lv = move.leaves;
      const add = (x: number, y: number): void => {
        world.zones.push({
          x,
          y,
          radius: hz.radius,
          ticksLeft: Math.round(lv.seconds / world.dt),
          slowPct: lv.slowPct,
          damagePerSecond: lv.damagePerSecond,
          color: lv.color,
          effect: move.effect,
          ...(lv.pullPerSecond ? { pullPerSecond: lv.pullPerSecond } : {}),
          ...(lv.followBoss && hz.dasher !== -1 ? { followEnemy: hz.dasher } : {}),
        });
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
    // 罠は踏んだときだけ当たる。ダメージの無い技（ため・強化・回復）は当てない
    if (move?.trap || !me || me.down || me.invincibleTicks > 0 || (hz.damage <= 0 && !hz.damageOverride)) continue;
    if (hazardHits(hz, me.x, me.y, me.radius, move)) hitLocal(world, me, hz, move);
  }
}

/** 落ちたときの演出の知らせ */
function struckEvent(hz: World['hazards'][number], move: BossMove | undefined): Extract<World['events'][number], { type: 'hazardStruck' }> {
  return {
    type: 'hazardStruck',
    x: hz.x,
    y: hz.y,
    radius: hz.radius,
    effect: move?.effect ?? '',
    shape: hz.shape,
    innerRadius: hz.innerRadius ?? 0,
    dirX: hz.dirX,
    dirY: hz.dirY,
    // 扇は、絵の幅を決める開き（片側。ラジアン）を長さの代わりに送る
    length: hz.shape === 'cone' ? ((move?.arc ?? 90) * Math.PI) / 360 : hz.length,
  };
}

/** 落ちた後、当たっている間の動き: 進む（玉・波）・曲がる・揺れる・回る（なぎ払い）・大きくなる（ころがる） */
function stepActiveHazard(world: World, hz: World['hazards'][number], move: BossMove | undefined): void {
  if (!move) return;
  const bullets = move.bullets;
  if (bullets) {
    // 飛ぶ玉（サンダー）: 向きへまっすぐ進む
    hz.x += hz.dirX * bullets.speed * world.dt;
    hz.y += hz.dirY * bullets.speed * world.dt;
    return;
  }
  if (move.bounce) {
    // ころがる: 走っている間に3段で大きくなる（跳ね返るたび。どのブラウザでも時間で同じに決める）
    const total = Math.max(1, Math.round(move.bounce.seconds / world.dt));
    hz.bounces = Math.min(2, Math.floor((1 - (hz.activeTicks ?? 0) / total) * 3));
  }
  if (move.sweep && hz.baseDirX !== undefined && hz.baseDirY !== undefined) {
    // なぎ払い: 落ちてからの割合で向きを回す。何本もの線（こおりのいぶき）はそのまま回し、1本は扇の端から端へ
    const total = Math.max(1, Math.round(move.sweep.seconds / world.dt));
    const t = 1 - (hz.activeTicks ?? 0) / total;
    const deg = move.arms ? move.sweep.degrees * t : move.sweep.degrees * (t - 0.5);
    const a = Math.atan2(hz.baseDirY, hz.baseDirX) + (deg * Math.PI) / 180;
    hz.dirX = Math.cos(a);
    hz.dirY = Math.sin(a);
  }
  if (move.travel && hz.vx !== undefined && hz.vy !== undefined) {
    const tr = move.travel;
    if (tr.homingDegreesPerSecond > 0) {
      // 一番近いプレイヤーへ少しずつ曲がる（おにび・スピードスター）
      const p = nearestPlayer(world, hz.x, hz.y);
      if (p) {
        const cur = Math.atan2(hz.vy, hz.vx);
        const want = Math.atan2(p.y - hz.y, p.x - hz.x);
        const diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
        const max = (tr.homingDegreesPerSecond * Math.PI * world.dt) / 180;
        const a = cur + Math.max(-max, Math.min(max, diff));
        const sp = Math.hypot(hz.vx, hz.vy);
        hz.vx = Math.cos(a) * sp;
        hz.vy = Math.sin(a) * sp;
        if (hz.shape !== 'line') {
          hz.dirX = Math.cos(a);
          hz.dirY = Math.sin(a);
        }
      }
    }
    let vx = hz.vx;
    let vy = hz.vy;
    if (tr.wobble) {
      // 左右に揺れる（たつまき）: 進む向きを周期で振る
      const age = (hz.rehitTicks ?? 0) + world.tick;
      const a = (tr.wobble.amplitude * Math.PI * Math.sin((age * world.dt * Math.PI * 2) / tr.wobble.seconds)) / 180;
      vx = hz.vx * Math.cos(a) - hz.vy * Math.sin(a);
      vy = hz.vx * Math.sin(a) + hz.vy * Math.cos(a);
    }
    hz.x += vx * world.dt;
    hz.y += vy * world.dt;
    // 自分の画面の端で跳ね返る（ボルテッカーの残像）
    const box = tr.bounceBox;
    const me = box ? (world.players.find((p) => p.id === world.localPlayerId) ?? nearestPlayer(world, hz.x, hz.y)) : null;
    if (box && me) {
      // 外へ向かっているときだけ跳ね返る（箱の外から出たときは、そのまま中へ入ってくる）
      const wall = hz.x > me.x + box.halfWidth && hz.vx > 0 ? 0 : hz.x < me.x - box.halfWidth && hz.vx < 0 ? 1 : hz.y > me.y + box.halfHeight && hz.vy > 0 ? 2 : hz.y < me.y - box.halfHeight && hz.vy < 0 ? 3 : -1;
      if (wall !== -1) {
        hz.bounces = (hz.bounces ?? 0) + 1;
        // 乱数の列を使わず、更新番号から決める（自分のブラウザだけの動きなので、ホストとずらさない）
        const rand = (k: number): number => Math.abs((Math.sin((world.tick + k) * 12.9898) * 43758.5453) % 1);
        let tx = me.x;
        let ty = me.y;
        hz.sinceAim = (hz.sinceAim ?? 0) + 1;
        // プレイヤーを通すのは左右の面からだけ。上下の面に来たら、次の左右の面まで待つ
        if (hz.sinceAim >= box.aimEvery && wall <= 1) hz.sinceAim = 0;
        else {
          // 今の面と直前にいた面を除いた面のどこかへ
          const sides = [0, 1, 2, 3].filter((w) => w !== wall && w !== hz.lastWall);
          const side = sides[Math.floor(rand(1) * sides.length) % sides.length]!;
          const u = rand(2) * 2 - 1;
          tx = me.x + (side === 0 ? box.halfWidth : side === 1 ? -box.halfWidth : u * box.halfWidth);
          ty = me.y + (side === 2 ? box.halfHeight : side === 3 ? -box.halfHeight : u * box.halfHeight);
        }
        hz.lastWall = wall;
        const dir = Math.atan2(ty - hz.y, tx - hz.x);
        const sp = Math.hypot(hz.vx, hz.vy);
        hz.vx = Math.cos(dir) * sp;
        hz.vy = Math.sin(dir) * sp;
      }
    }
  }
}

/** ボスの技が落ちたとき（ソロ・ホスト）: 瞬間移動・じばく・プレイヤーと同じ技・回復・続けて使う技・強化・カウンター・跳ね回る */
function onBossMoveStruck(world: World, hz: World['hazards'][number], move: BossMove | undefined): void {
  const i = findEnemyIndex(world, hz.dasher);
  if (i === -1 || !move) return;
  const boss = world.bosses.find((b) => b.id === hz.dasher);
  // じばく: 爆発した敵はいなくなる（ホストが決めてゲストへ送る）
  if (move.selfDestruct) {
    world.enemies.hp[i] = 0;
    world.events.push({ type: 'enemyRetired', id: hz.dasher });
    return;
  }
  // 瞬間移動: ボスが予告の場所へ現れる（ホストが動かし、位置はゲストへ送る）
  if (move.teleport) {
    world.enemies.x[i] = world.enemies.prevX[i] = hz.x;
    world.enemies.y[i] = world.enemies.prevY[i] = hz.y;
  }
  // プレイヤーと同じ技を出す（色違いの御三家のブラストバーン・ハイドロカノン）。ボスの場所から出す
  if (move.playerMove) {
    const pm = world.rules.moves.findIndex((m) => m.key === move.playerMove!.move);
    if (pm !== -1) {
      const set = world.rules.stage.legendary?.moveSets[world.rules.enemies.kinds[world.enemies.kind[i]!]?.id ?? ''];
      const caster = casterFor(world, hz.dasher, set?.casterPower ?? 1);
      caster.x = caster.prevX = world.enemies.x[i]!;
      caster.y = caster.prevY = world.enemies.y[i]!;
      fireCasterMove(world, caster, pm, move.playerMove.level, move.playerMove);
    }
  }
  const holder = move.holdSeconds ? world.legendAis.get(hz.dasher) : undefined;
  if (holder) holder.holdTicks = Math.round(move.holdSeconds! / world.dt);
  // 回復（エーフィの あさのひざし・カビゴンの ねむる）: 使ったボスの HP を戻す（HP はゲストへ送る）
  if (move.healPct && world.enemies.hp[i]! > 0) world.enemies.hp[i] = Math.min(world.enemies.maxHp[i]!, world.enemies.hp[i]! + (world.enemies.maxHp[i]! * move.healPct) / 100);
  // 強化（ビルドアップ・りゅうのまい）
  if (move.buff && boss) {
    if (move.buff.radiusPct) boss.radiusBuff = { scale: 1 + move.buff.radiusPct / 100, uses: move.buff.uses };
    if (move.buff.speedPct || move.buff.intervalPct) {
      boss.stacks = Math.min(move.buff.maxStacks, (boss.stacks ?? 0) + 1);
      world.enemies.speed[i] = bossSpeed(world, boss, i);
    }
  }
  // 跳ね回る: 走り出す（狙った人を中心にした箱の端で跳ね返る）
  if (move.bounce && boss) {
    const b = move.bounce;
    boss.bounce = { vx: hz.dirX * b.speed, vy: hz.dirY * b.speed, ticks: Math.round(b.seconds / world.dt), cx: hz.boxX ?? world.enemies.x[i]!, cy: hz.boxY ?? world.enemies.y[i]!, hw: b.halfWidth, hh: b.halfHeight, hazard: hz.group ?? -1 };
    world.enemies.speed[i] = 0;
  }
  // 続けて使う技（ミュウツー: テレポートの直後に自分の周り・つじぎり の二段目・カウンターの返し）
  if (move.then) {
    const next = moveIndexOfStage(world.rules, move.then);
    if (move.counter) {
      // カウンター: 予告の間に受けたダメージを返す（少なければ返さない）
      const taken = Math.max(0, (hz.hpAtStart ?? world.enemies.hp[i]!) - world.enemies.hp[i]!);
      const amount = Math.min(move.counter.max, taken * move.counter.ratio);
      if (amount >= 1) addHazard(world, next, world.enemies.x[i]!, world.enemies.y[i]!, 0, 0, hz.dasher, undefined, { group: world.nextHazardGroup++, damage: amount });
    } else if (move.thenSamePlace) addHazard(world, next, hz.x, hz.y, hz.dirX, hz.dirY, -1, undefined, { group: world.nextHazardGroup++ });
    else castBossMove(world, hz.dasher, i, next);
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

/** 範囲に入っているか（円・直線・輪・扇。跳ね回る技は跳ね返るたびに大きく） */
export function hazardHits(
  hz: { shape: 'circle' | 'line' | 'ring' | 'cone'; x: number; y: number; radius: number; innerRadius?: number; dirX: number; dirY: number; length: number; bounces?: number },
  x: number,
  y: number,
  r: number,
  move?: BossMove,
): boolean {
  const radius = hz.radius * (1 + ((move?.bounce?.growPct ?? 0) * (hz.bounces ?? 0)) / 100);
  if (hz.shape === 'circle') return (x - hz.x) ** 2 + (y - hz.y) ** 2 <= (radius + r) ** 2;
  if (hz.shape === 'ring') {
    const d = Math.hypot(x - hz.x, y - hz.y);
    return d <= radius + r && d >= (hz.innerRadius ?? 0) - r;
  }
  if (hz.shape === 'cone') {
    const dx = x - hz.x;
    const dy = y - hz.y;
    const d = Math.hypot(dx, dy);
    if (d > radius + r) return false;
    if (d <= r) return true;
    const half = ((move?.arc ?? 90) * Math.PI) / 360;
    const cos = (dx * hz.dirX + dy * hz.dirY) / d;
    // 縁の太さ（プレイヤーの半径）ぶん、角度を広げる
    return Math.acos(Math.max(-1, Math.min(1, cos))) <= half + Math.asin(Math.min(1, r / d));
  }
  const t = Math.max(0, Math.min(hz.length, (x - hz.x) * hz.dirX + (y - hz.y) * hz.dirY));
  const px = hz.x + hz.dirX * t;
  const py = hz.y + hz.dirY * t;
  return (x - px) ** 2 + (y - py) ** 2 <= (radius + r) ** 2;
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
  /**
   * 予告に足す遅れ（更新回数）・半径の上書き・輪の内側の半径・追いかけるプレイヤー・1回の技の組・威力の上書き（カウンター）・
   * 落ちた後に進む速さ（波）・直線の長さの上書き（波の帯）・跳ね回る箱の中心
   */
  extra: { delay?: number; radius?: number; inner?: number; follow?: number; group?: number; damage?: number; vx?: number; vy?: number; length?: number; boxX?: number; boxY?: number } = {},
): void {
  const move: BossMove | undefined = world.rules.stage.moves[moveIdx];
  if (!move) return;
  const ticks = Math.round(move.telegraphSeconds / world.dt) + (extra.delay ?? 0);
  const radius = extra.radius || move.radius;
  const length = move.shape === 'line' ? extra.length || (move.length ?? 400) : 0;
  const di = dasher !== -1 ? findEnemyIndex(world, dasher) : -1;
  world.hazards.push({
    move: moveIdx,
    shape: move.shape,
    x,
    y,
    radius,
    innerRadius: move.shape === 'ring' ? (extra.inner ?? 0) : undefined,
    dirX,
    dirY,
    length,
    dasher,
    damage: move.damage,
    ticksLeft: ticks,
    totalTicks: ticks,
    chainLeft,
    follow: extra.follow ?? -1,
    ...(extra.group ? { group: extra.group } : {}),
    ...(extra.damage ? { damageOverride: extra.damage } : {}),
    ...(extra.vx !== undefined && extra.vy !== undefined && (extra.vx !== 0 || extra.vy !== 0) ? { vx: extra.vx, vy: extra.vy } : {}),
    ...(extra.boxX !== undefined && extra.boxY !== undefined ? { boxX: extra.boxX, boxY: extra.boxY } : {}),
    ...(move.counter && di !== -1 ? { hpAtStart: world.enemies.hp[di]! } : {}),
  });
  // 予告の間止まる技（ゲストも同じ知らせで止める）
  if ((move.rooted || move.selfDestruct) && di !== -1) {
    world.enemies.speed[di] = 0;
    // じばく: 予告した敵はその場で止まる
    if (move.selfDestruct) {
      world.enemies.vx[di] = 0;
      world.enemies.vy[di] = 0;
    }
  }
  world.events.push({
    type: 'hazardTelegraphed',
    move: moveIdx,
    x,
    y,
    dirX,
    dirY,
    dasher,
    delay: extra.delay ?? 0,
    radius: extra.radius ?? 0,
    inner: extra.inner ?? 0,
    follow: extra.follow ?? -1,
    group: extra.group ?? 0,
    damage: extra.damage ?? 0,
    vx: extra.vx ?? 0,
    vy: extra.vy ?? 0,
    length: extra.length ?? 0,
  });
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
    // 同時に戦う相手の場の効果を、決まった秒数ごとに入れ替える（天気の伝説）。残りが1体ならその場のまま
    const cycle = world.rules.stage.legendary?.fieldCycleSeconds;
    const found: { field: LegendField; index: number }[] = [];
    for (let i = 0; i < e.count; i++) {
      if (e.hp[i]! <= 0) continue;
      const field = kinds.get(e.kind[i]!);
      if (field) {
        found.push({ field, index: i });
        if (!cycle) break;
      }
    }
    if (found.length > 0) out = found[cycle ? Math.floor(((world.tick - (world.legendary?.appearTick ?? 0)) * world.dt) / cycle) % found.length : 0]!;
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
  return [...r.rounds.map((x) => x.kinds), ...r.bonus.filter((b) => world.wings.has(b.item)).map((b) => b.kinds), ...(world.finaleKinds ? [world.finaleKinds] : [])];
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
  // 中ボスを制限時間で倒せなかった（育たずに逃げ回るランを早く終える。07 の106章）
  const deadline = gateDeadlineTick(world);
  if (deadline !== null && world.tick >= deadline && world.gateIds.size > 0) {
    const i = findEnemyIndex(world, world.gateIds.values().next().value!);
    endRun(world, 'fail', i === -1 ? undefined : world.enemies.kind[i]!);
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
/** 最後の戦いの相手を決める（1回だけ）: いんせきがあればデオキシス、無ければ確率でレックウザ（07 の189章） */
function rollFinale(world: World): void {
  const f = world.rules.stage.legendary?.finale;
  if (!f) return;
  const idx = (id: string): number => world.rules.enemies.kinds.findIndex((k) => k.id === id);
  if (world.wings.has(f.item.item)) world.finaleKinds = f.item.kinds.map(idx);
  else if (world.rng.next() < f.chance) world.finaleKinds = f.kinds.map(idx);
}

function startLegendaryOrClear(world: World): void {
  const cfg = world.rules.stage.legendary;
  rollFinale(world);
  // 続けて戦うラウンド（レッド戦）があれば、必ず1つ目から
  const seq = roundSequence(world);
  if (cfg && seq.length > 0) {
    startLegendary(world, seq[0]![0]!, 0);
    return;
  }
  if (!cfg || world.rng.next() >= cfg.chance + world.legendaryChanceBonus) {
    endRun(world, 'clear');
    return;
  }
  // 相性で選ぶ候補（色違いの御三家）は、参加者に一番不利な1体を、ほかの伝説と同じ重みで足す
  const pool = [...cfg.kinds];
  if (world.legendaryCounter && cfg.counter) pool.push(counterPick(world, cfg.counter.kinds));
  const drawn = pool[world.rng.int(pool.length)]!;
  const id = world.legendaryForce && cfg.forceKind ? cfg.forceKind.kind : drawn;
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

export function endRun(world: World, outcome: RunOutcome, gateTimeUp?: number): void {
  if (world.outcome) return;
  world.outcome = outcome;
  world.hazards.length = 0;
  world.zones.length = 0;
  world.events.push({ type: 'runEnded', outcome, legendary: world.legendary ? { kind: world.legendary.kind, result: world.legendary.result } : null, ...(gateTimeUp !== undefined && { gateTimeUp }) });
}
