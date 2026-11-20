import { insideObstacle, rayLengthToObstacle } from '../obstacles';
import { absorbBarrier, noteLegendThreat } from './stage';
import { recomputeModifiers } from './leveling';
import {
  MOTION_BOOMERANG,
  MOTION_FOLLOW,
  MOTION_HOMING,
  MOTION_LOB,
  MOTION_BOUNCE,
  MOTION_STREAM,
  MOTION_SWEEP,
  MOTION_SPIRAL,
  MOTION_LINEAR,
  MOTION_ORBIT,
  MOTION_PULSE,
  MOTION_SNAKE,
  MOTION_ATTACH,
  SHAPE_CIRCLE,
  SHAPE_LINE,
  SHAPE_BOX,
  SHAPE_SECTOR,
  snakeOffset,
  type ProjectileSpawn,
} from '../entities/projectiles';
import type { Player, PlayerMove } from '../entities/player';
import { DMG_CRIT, DMG_SUPER, type HitEffect } from '../events';
import { axisToUnit } from '../math';
import { typeFlags, typeMultiplier, type MoveStats, type SimMoveDef } from '../moves';
import { findEnemyIndex, type World } from '../world';
import { abilityOf, abilityPowerMultiplier, killStackPct, pinchMods } from '../ability';
import { autoSkillMove, skillPowerPct } from '../activeSkills';
import { bumpRunStat } from '../runStats';
import type { Modifiers } from '../upgrades';
import { applyHitEffect } from './commands';
import { fireDelayedExplosion, fireEffects, fireLanding, type FxSource } from './moveEffects';
import { healPlayer, hurtPlayer, selfDamage } from './health';
import { activeField, hazardDamage } from './stage';
import { breakOnDamage, damageTakenMultiplier } from './status';

/** 持ち物の威力の倍率（でんきだま: その系統が持っているときだけ） */
function heldPowerMultiplier(world: World, p: Player): number {
  let m = 1;
  for (const it of p.items) {
    const def = world.rules.items[it.item]!;
    if (def.powerMultiplier && (!def.lines || def.lines.includes(p.line)) && (!def.forms || def.forms.includes(p.species))) m *= def.powerMultiplier;
  }
  return m;
}

/** 一撃で倒すときのダメージ（どの雑魚の HP より大きい） */
const INSTAKILL_DAMAGE = 1e9;
/** 投げる技の landOnly: 落ちる直前のこの秒数だけ当たる */
const LAND_WINDOW_SECONDS = 0.1;

/** 技のレベルの性能（レベルは 1〜最大に収める） */
export function moveStatsOf(world: World, pm: { move: number; level: number }): MoveStats {
  const levels = world.rules.moves[pm.move]!.levels;
  return levels[Math.max(1, Math.min(pm.level, levels.length)) - 1]!;
}

/**
 * 持ち物の効果のうち、技の数・持続・射程・貫通を変えるもの（ポイントマックス・ひかりのねんど・ズームレンズ・するどいツメ）を足した、その技のレベルの性能
 */
export function playerMoveStats(world: World, p: Player, pm: { move: number; level: number }): MoveStats {
  const st = moveStatsOf(world, pm);
  const m = p.mods;
  const def = world.rules.moves[pm.move]!;
  // 自分を中心に円状に広がる技（だいばくはつ など）は、半径（range）を射程の強化ではなく範囲の強化で広げる（作者の決定 2026年10月25日）
  const selfRadius = SELF_RADIUS_PATTERNS.has(def.pattern);
  const areaPct = m.areaPct + typeAreaPctOf(m, def);
  if (m.amountBonus === 0 && m.durationPct === 0 && m.rangePct === 0 && m.pierceBonus === 0 && !(selfRadius && areaPct !== 0)) return st;
  const rangePct = selfRadius ? areaPct : m.rangePct * (def.rangeBonusScale ?? 1);
  // 太い追従レーザー・円: 本数は増やさず、増えた分を威力に変える（元の本数 n に +k なら ×(n + 割合×k)/n。07 の128章）
  const toPower = (def.bonusCountToPower || selfAround(def, st)) && st.count > 0 && m.amountBonus !== 0;
  return {
    ...st,
    count: toPower ? st.count : st.count + m.amountBonus,
    ...(toPower ? { power: (st.power * Math.max(1, st.count + world.rules.combat.bonusCountPowerRate * m.amountBonus)) / st.count } : {}),
    // サイコブレイク: 玉は 1 つのまま、増えた分だけ大きくなる（07 の305章）
    ...(toPower && def.bonusCountSizePct ? { size: st.size * Math.max(0.1, 1 + (def.bonusCountSizePct * m.amountBonus) / 100) } : {}),
    durationSeconds: st.durationSeconds * Math.max(0.1, 1 + m.durationPct / 100),
    range: st.range * Math.max(0.1, 1 + rangePct / 100),
    pierce: st.pierce + m.pierceBonus,
  };
}

/** 自分の周り全部に当たる技（360° の扇・まとう技）: 数が増えても向きが無いので、増えた分は威力にする（07 の163章） */
function selfAround(def: SimMoveDef, st: MoveStats): boolean {
  if (def.pattern === 'aura') return true;
  return def.pattern === 'melee' && !def.frontBox && (st.arcDegrees >= 360 || st.range === 0);
}

/** 自分を中心に円状に広がる出し方（半径は範囲の強化で広がり、射程の強化は効かない） */
const SELF_RADIUS_PATTERNS = new Set(['nova', 'pulse', 'spin', 'screen', 'eruption']);

/**
 * ポイントマックスで増えた分の当たり判定（index from 以降、出した数のうち後ろの分）に印を付け、2段目以降の技（効き方）を起こさない
 * （みらいよち: 落雷は増えても、後から来る爆発は増やさない。作者の決定 2026年10月25日）
 */
function markBonusShots(world: World, p: Player, pm: PlayerMove, st: MoveStats, from: number): void {
  const bonus = p.mods.amountBonus;
  if (bonus <= 0 || st.count <= 0 || world.rules.moves[pm.move]!.effects.length === 0 || world.rules.moves[pm.move]!.bonusCountToPower) return;
  const pr = world.projectiles;
  const added = pr.count - from;
  // 数を1本にまとめる出し方（ビームは幅を広げる）は、増えた分の弾が無いので印を付けない（作者の依頼 2026年10月29日: ゴッドバードの残り火が消えていた）
  if (added < st.count) return;
  const keep = Math.floor((added * Math.max(0, st.count - bonus)) / st.count);
  for (let i = from + keep; i < pr.count; i++) pr.noFx[i] = 1;
}

/** 技のタイプ（2つ目のタイプ extraTypes も。インファイト: かくとう と ほのお）の番号 */
export function moveTypesOf(def: SimMoveDef): readonly number[] {
  return def.extraTypes ? [def.type, ...def.extraTypes] : [def.type];
}

/** タイプの範囲の強化（2つ目のタイプの分も足す） */
function typeAreaPctOf(m: Player['mods'], def: SimMoveDef): number {
  return moveTypesOf(def).reduce((sum, t) => sum + (m.typeAreaPct[t] ?? 0), 0);
}

/** タイプの威力の強化: 持ち物・あまごい・マップの効果（2つ目のタイプの分も足す） */
function typePowerPctOf(world: World, p: Player, def: SimMoveDef, pinch: Modifiers | null): number {
  let pct = 0;
  for (const t of moveTypesOf(def)) {
    pct += (p.mods.typePowerPct[t] ?? 0) + (pinch?.typePowerPct[t] ?? 0) + (p.rain && p.rain.type === t && world.tick < p.rain.untilTick ? p.rain.pct : 0) + fieldTypePct(world, t);
    // オーバーヒートの後（エンテイ。07 の313章）: ほのおの技が弱まる
    if (p.overheat && p.overheat.type === t && world.tick < p.overheat.untilTick) pct -= p.overheat.pct;
  }
  return pct;
}

/** 持ち物の効果を掛けた、その技の威力・大きさ・速さ・クールダウン */
export function scaledMoveStats(world: World, p: Player, pm: PlayerMove, st: MoveStats) {
  const def = world.rules.moves[pm.move]!;
  const m = p.mods;
  // 特性: HP が少ない間だけ威力が上がる（しんりょく など。07 の133章）
  const pinch = pinchMods(world, p);
  // じしんかじょう: 倒すたびに重なる物理の威力
  const classPct = (def.damageClass === 'physical' ? m.physicalPowerPct + (pinch?.physicalPowerPct ?? 0) + killStackPct(world, p) : m.specialPowerPct + (pinch?.specialPowerPct ?? 0) + calmPowerPct(world, p)) + (pinch?.powerPct ?? 0);
  return {
    // ポケモンのステータス（物理・特殊の威力。種族値のランクとレベル）と、持ち物の効果を掛ける
    power:
      st.power *
      (def.damageClass === 'physical' ? p.physicalPower : p.specialPower) *
      Math.max(0, 1 + (m.powerPct + classPct + typePowerPctOf(world, p, def, pinch) + skillPowerPct(world, p)) / 100) *
      // つるぎのまい: ほかの % と足さずに別に掛ける（07 の324章）
      (def.damageClass === 'physical' ? Math.max(0, 1 + m.physicalPowerMultPct / 100) : 1) *
      heldPowerMultiplier(world, p) *
      // なまけ: 2回に1回しか出ない分、強い
      abilityPowerMultiplier(world, p) *
      // とっておき: 覚えているほかの技が多いほど強い
      (1 + (st.perMovePowerPct * Math.max(0, p.moves.length - 1)) / 100),
    size: st.size * Math.max(0.1, 1 + (m.areaPct + typeAreaPctOf(m, def)) / 100),
    speed: st.speed * Math.max(0.1, 1 + m.projectileSpeedPct / 100),
    cooldownSeconds: st.cooldownSeconds * Math.max(0.2, 1 + m.cooldownPct / 100),
  };
}

/** 当たり判定 i がまだ当たれる（当たり直しの間を待っていない）、(x, y) から range の中の一番近い敵。いなければ -1 */
function nearestUnhitEnemy(world: World, i: number, range: number): number {
  const { enemies: e, enemyHash, scratch, projectiles: pr } = world;
  const x = pr.x[i]!;
  const y = pr.y[i]!;
  const n = enemyHash.queryRect(x - range, y - range, x + range, y + range, scratch);
  let best = -1;
  let bestD2 = range * range;
  for (let k = 0; k < n; k++) {
    const j = scratch[k]!;
    if (e.hp[j]! <= 0 || pr.isBlocked(i, e.id[j]!, world.tick)) continue;
    const d2 = (e.x[j]! - x) ** 2 + (e.y[j]! - y) ** 2;
    if (d2 < bestD2 || (d2 === bestD2 && best !== -1 && e.id[j]! < e.id[best]!)) {
      bestD2 = d2;
      best = j;
    }
  }
  return best;
}

/**
 * 追う弾（homing）の狙い（07 の248章）: (x, y) から range の中で一番近い敵のうち、「もう倒れる見込み」でない敵。
 * 同じ持ち主・同じ技の飛んでいる追う弾がすでに狙っている敵は、その弾の威力の合計を HP から引いて見る（予約）。
 * 予約で倒れる見込みの敵は飛ばす（一発目が倒すと残りが引き返す、を避け、群れでは弾が別々の敵へ散る）。
 * 全部が予約で埋まっていれば（HP の多いボスは埋まらない）一番近い敵。self は今狙いを決める弾（出す前なら -1）。
 * 貫通する弾は、もう当たった敵（当たり直しを待っている敵）を選ばない
 */
function pickHomingTarget(world: World, self: number, owner: number, move: number, x: number, y: number, range: number): number {
  const { enemies: e, enemyHash, scratch, projectiles: pr } = world;
  // ロックオンしている相手が届く所にいれば、まずそこへ（貫通して当たった後は、雑魚へ狙い直す。07 の249章）
  const lockOwner = world.players.find((pl) => pl.id === owner);
  if (lockOwner?.lockOn) {
    const j = findEnemyIndex(world, lockOwner.lockOn - 1);
    if (j !== -1 && e.hp[j]! > 0 && (e.x[j]! - x) ** 2 + (e.y[j]! - y) ** 2 <= range * range && !(self >= 0 && pr.isBlocked(self, e.id[j]!, world.tick))) return j;
  }
  const reserved = new Map<number, number>();
  for (let k = 0; k < pr.count; k++) {
    if (k === self || pr.motion[k] !== MOTION_HOMING || pr.stage[k] !== 0 || pr.owner[k] !== owner || pr.move[k] !== move || pr.target[k] === 0) continue;
    const id = pr.target[k]! - 1;
    reserved.set(id, (reserved.get(id) ?? 0) + pr.damage[k]!);
  }
  const n = enemyHash.queryRect(x - range, y - range, x + range, y + range, scratch);
  let best = -1;
  let bestD2 = Infinity;
  let near = -1;
  let nearD2 = Infinity;
  const seen = new Set<number>();
  for (let k = 0; k < n; k++) {
    const j = scratch[k]!;
    if (seen.has(j)) continue;
    seen.add(j);
    if (e.hp[j]! <= 0 || (self >= 0 && pr.isBlocked(self, e.id[j]!, world.tick))) continue;
    const d2 = (e.x[j]! - x) ** 2 + (e.y[j]! - y) ** 2;
    if (d2 > range * range) continue;
    const closer = (bd: number, b: number): boolean => d2 < bd || (d2 === bd && b !== -1 && e.id[j]! < e.id[b]!);
    if (closer(nearD2, near)) {
      nearD2 = d2;
      near = j;
    }
    if (e.hp[j]! - (reserved.get(e.id[j]!) ?? 0) <= 0) continue;
    if (closer(bestD2, best)) {
      bestD2 = d2;
      best = j;
    }
  }
  return best !== -1 ? best : near;
}

/** 射程内の一番近い敵の index。いなければ -1（同じ距離なら id の小さい方。ハッシュの並び順に左右されないように） */
function nearestEnemy(world: World, x: number, y: number, range: number): number {
  const { enemies: e, enemyHash, scratch } = world;
  const n = enemyHash.queryRect(x - range, y - range, x + range, y + range, scratch);
  let best = -1;
  let bestD2 = range * range;
  for (let k = 0; k < n; k++) {
    const i = scratch[k]!;
    if (e.hp[i]! <= 0) continue;
    const dx = e.x[i]! - x;
    const dy = e.y[i]! - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2 || (d2 === bestD2 && best !== -1 && e.id[i]! < e.id[best]!)) {
      bestD2 = d2;
      best = i;
    }
  }
  return best;
}

/** 一番近い敵への向き。いなければ向いている方向 */
function aim(world: World, p: Player, range: number): [number, number] {
  const t = nearestEnemy(world, p.x, p.y, range);
  if (t === -1) return axisToUnit(p.facingX, p.facingY);
  const dx = world.enemies.x[t]! - p.x;
  const dy = world.enemies.y[t]! - p.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  return [dx / d, dy / d];
}

/** 届く範囲で HP の一番高い敵の番号。いなければ -1（同じ HP なら先に見つかった方） */
/** HP の一番高い敵（スキルの狙いを見せるため。07 の310章） */
export function strongestEnemyIndex(world: World, p: Player, range: number): number {
  return strongestEnemy(world, p, range);
}

function strongestEnemy(world: World, p: Player, range: number): number {
  const e = world.enemies;
  let best = -1;
  for (const i of enemiesInRange(world, p.x, p.y, range)) {
    if (best === -1 || e.hp[i]! > e.hp[best]!) best = i;
  }
  return best;
}

/**
 * 飛び込む相手（ヘビーボンバー）: 届く範囲で HP の一番高い敵。arcDegrees があれば、向いている方向を中心にしたその角度の扇の中だけから選ぶ
 * （まわり全部から選ぶと、後ろのボスへ勝手に飛ぶ。作者の指示 2026年11月13日。07 の242章）。いなければ -1
 */
function dashTarget(world: World, p: Player, dash: NonNullable<SimMoveDef['dash']>, range: number): number {
  if (!dash.arcDegrees) return strongestEnemy(world, p, range);
  const e = world.enemies;
  const [fx, fy] = axisToUnit(p.facingX, p.facingY);
  const cosHalf = Math.cos(((dash.arcDegrees / 2) * Math.PI) / 180);
  let best = -1;
  for (const i of enemiesInRange(world, p.x, p.y, range)) {
    const dx = e.x[i]! - p.x;
    const dy = e.y[i]! - p.y;
    const d = Math.hypot(dx, dy);
    // 重なっている相手（中心がほぼ同じ）は前にいるとみなす
    if (d > 1 && (dx * fx + dy * fy) / d < cosHalf) continue;
    if (best === -1 || e.hp[i]! > e.hp[best]!) best = i;
  }
  return best;
}

/** 続けて当てるほど強くなる技（エコーボイス）の 1 つの輪: 段で威力と大きさを上げ、こだまの輪の数で威力を分ける。飛ぶ間に広がる */
function echoShape(echo: NonNullable<SimMoveDef['echo']>, pm: PlayerMove, b: { damage: number; radius: number }): { damage: number; radius: number; growth: number } {
  const stack = pm.echo ?? 0;
  const rings = 1 + Math.floor(stack / 2);
  const size = 1 + echo.sizePerStack * stack;
  return { damage: (b.damage * (1 + echo.powerPerStack * stack)) / rings, radius: b.radius * size, growth: echo.growPerSecond * size };
}

/** ロックオンが届く距離（画面くらい） */
const LOCK_ON_RANGE = 700;

/**
 * ロックオン（07 の249章）: ロックオン を持っていれば、ボス・中ボスがいる間、そのうち HP の一番高いものにロックオンする。
 * ロックオンした相手が残っていて届く間は替えない。どのブラウザでも同じ敵の状態から決める
 */
function updateLockOn(world: World, p: Player): void {
  if (p.mods.lockOnPct <= 0) {
    p.lockOn = 0;
    return;
  }
  const e = world.enemies;
  if (p.lockOn) {
    const j = findEnemyIndex(world, p.lockOn - 1);
    if (j !== -1 && e.hp[j]! > 0 && (e.x[j]! - p.x) ** 2 + (e.y[j]! - p.y) ** 2 <= LOCK_ON_RANGE * LOCK_ON_RANGE) return;
  }
  const b = toughestBoss(world, p.x, p.y, LOCK_ON_RANGE);
  p.lockOn = b !== -1 ? e.id[b]! + 1 : 0;
}

/** 届く範囲のボス・中ボス（rank が normal でない敵）のうち HP の一番高いものの番号。いなければ -1 */
function toughestBoss(world: World, x: number, y: number, range: number): number {
  const e = world.enemies;
  let best = -1;
  for (const i of enemiesInRange(world, x, y, range)) {
    if ((world.rules.enemies.kinds[e.kind[i]!]?.rank ?? 'normal') === 'normal') continue;
    if (best === -1 || e.hp[i]! > e.hp[best]!) best = i;
  }
  return best;
}

/** 届く範囲で HP の一番高い敵への向き（ゴッドバード: ボスを狙う）。いなければ null */
function aimStrongest(world: World, p: Player, range: number): [number, number] | null {
  const e = world.enemies;
  const best = strongestEnemy(world, p, range);
  if (best === -1) return null;
  const dx = e.x[best]! - p.x;
  const dy = e.y[best]! - p.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  return [dx / d, dy / d];
}

/** 向きを spreadDegrees の範囲でばらつかせる（見た目と自分の命中だけに関わるので三角関数を使ってよい） */
function spread(world: World, dx: number, dy: number, degrees: number): [number, number] {
  if (degrees <= 0) return [dx, dy];
  const a = Math.atan2(dy, dx) + ((world.rng.next() - 0.5) * degrees * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
}

/**
 * 覚えている技を使う（技は自動で発動する）。出し方は data/schema.ts の MOVE_PATTERNS を参照。
 * nearest・facing・homing・boomerang は count 発を interval ごとに出し、それ以外は count 個を同時に出す。
 */
export function useMoves(world: World): void {
  for (const p of world.players) {
    updateLockOn(world, p);
    // 受けたダメージを返す技（ミラーコート・マジックコート）: その技の当たり判定が出ている間に受けたダメージを、効き方 hurt に渡す
    if (p.hurtQueue) {
      const taken = p.hurtQueue;
      p.hurtQueue = 0;
      const pr0 = world.projectiles;
      for (const pm of p.moves) {
        const def = world.rules.moves[pm.move];
        // メタルバースト: 受けたらすぐ次を出す（その 1 回だけ強い）
        if (def?.hurtRelease) {
          pm.hurtCharge = true;
          pm.cooldown = 0;
          continue;
        }
        if (!def?.effects.some((fx) => fx.trigger === 'hurt')) continue;
        let active = -1;
        for (let i = 0; i < pr0.count && active === -1; i++) if (pr0.owner[i] === p.id && pr0.move[i] === pm.move && pr0.stage[i] === 0) active = i;
        if (active === -1) continue;
        const [fx, fy] = axisToUnit(p.facingX, p.facingY);
        const sc = scaledMoveStats(world, p, pm, playerMoveStats(world, p, pm));
        // みちづれ: 自分の所ではなく、結んだ敵（貼り付いた当たり判定）の所で返す（07 の272章）
        const at = def.hurtAtLink ? { x: pr0.x[active]!, y: pr0.y[active]! } : { x: p.x, y: p.y };
        // みちづれ: 受けた量そのものではなく、受けた割合（最大 HP の %）× 技の威力で返す（HP の桁に左右されない。07 の272章）
        const amount = def.hurtByHpPct ? (taken / Math.max(1, p.maxHp)) * 100 * sc.power : taken;
        fireEffects(world, 'hurt', { owner: p.id, move: pm.move, level: pm.level, damage: amount, size: sc.size, x: at.x, y: at.y, dirX: fx, dirY: fy, length: 0 });
      }
    }
    // 倒れている間・凍っている間（伝説戦のぜったいれいど）は技を使わない
    if (p.down || p.frozenTicks) continue;
    // 眠っている間・起きる動きの間は、眠っている間だけ出す技（いびき）のほかは出さない
    const resting = stepRest(world, p);
    const asleep = resting && p.sleep?.asleep === true;
    if (resting && !(asleep && p.moves.some((m) => world.rules.moves[m.move]?.onlyWhileAsleep))) continue;
    // 技の反動で動けない間（ギガインパクト）は、ほかの技も出ない（進んでいる間は出る）
    if (p.recoverTicks && !p.dashTicks) continue;
    // 順番に出す技（ワンリキーのパンチ）の、次に出せるまでの秒数
    if (p.groupTimers) for (const g of Object.keys(p.groupTimers)) p.groupTimers[g]! -= world.dt;
    for (const pm of p.moves) {
      const def = world.rules.moves[pm.move];
      // いつも効く技（かくばる・テクスチャー）は使わない（効果は持ち物と同じく、いつも足されている）
      if (!def || def.pattern === 'passive' || def.pattern === 'rest') continue;
      // キーで使う技（スイクン）: 自分のスキルの枠にあれば自動では出さない。枠に無い（技の表を測るミュウ など）ときは、使えるようになるたびに出す
      if (def.pattern === 'skill') {
        autoSkillMove(world, p, pm);
        continue;
      }
      // いびき: 眠っている間だけ出す（ほかの技は眠っている間は出さない）
      if (!!def.onlyWhileAsleep !== asleep) continue;
      // 連続技（とっておき）の続きを出す
      if (pm.seq) stepSequence(world, p, pm);
      const st = playerMoveStats(world, p, pm);
      // 特性が HP の少なさで効いている（こんじょう など）: ランの記録（固有技の条件。07 の134章）
      if (pm === p.moves[0] && pinchMods(world, p)) bumpRunStat(world, p, 'pinch');
      // ためている間に出す技（きあいパンチのマッハパンチ）。この技を出している間（pauseSeconds）は止める
      if (def.chargeMove) {
        pm.subPause = Math.max(0, (pm.subPause ?? 0) - world.dt);
        pm.sub ??= { move: def.chargeMove.move, level: world.rules.moves[def.chargeMove.move]!.levels.length, cooldown: 0, burstLeft: 0, burstTimer: 0 };
        if (pm.subPause <= 0) runSubMove(world, p, pm.sub);
      }
      // 一緒に出し続ける技（インファイト: 炎蹴りの薙ぎ払い・突き出す蹴り）。それぞれの再使用ごとに、この技のレベルで出す
      if (def.comboMoves) {
        // 遅れて出し始める技（アクアテールの叩きつけ）は、最初の再使用をその秒数から数える
        pm.combo ??= def.comboMoves.map((move) => ({ move, level: pm.level, cooldown: world.rules.moves[move]?.comboOffsetSeconds ?? 0, burstLeft: 0, burstTimer: 0 }));
        for (const sub of pm.combo) {
          sub.level = pm.level;
          runSubMove(world, p, sub);
        }
      }
      // 走って電気をためる技（ほうでん）は、止まっている間は次を出すまでの時間が進まない（07 の165章）
      if (!def.chargeWhileMoving || p.inputX !== 0 || p.inputY !== 0) pm.cooldown -= world.dt;
      if (pm.burstLeft > 0) {
        fireBurst(world, p, pm, st);
        continue;
      }
      if (pm.cooldown > 0) continue;
      // 体が動く技: 行き先に敵がいなければ出さない（だれもいないのに勝手に動かない。溜める技も溜め始めない）
      if ((def.dash && !(def.dash.target === 'strongest' ? dashTarget(world, p, def.dash, st.range) !== -1 : def.dash.target === 'crowd' ? enemiesInRange(world, p.x, p.y, st.range).length > 0 : enemyAhead(world, p, st.range + st.size))) || (def.sequence && !sequenceCanStart(world, p, def.sequenceGate ?? 'ahead', st))) {
        pm.cooldown = 0;
        continue;
      }
      // 体が動く技（のしかかり・すてみタックル・ヘビーボンバー・ギガインパクト など）は重ねて出さない（07 の268章）:
      // ほかの体が動く技が進んでいる間・溜めている間・連続技の途中は、出せるようになっても待つ（終わったらすぐ出る）
      if (movesBody(world, pm.move) && pm.windup === undefined && bodyBusy(world, p, pm)) {
        pm.cooldown = 0;
        continue;
      }
      // 溜める技（リーフブレード・ブレイズキック）: windupSeconds 溜めてから出す（溜めている間は体が光る。RunScene.chargeOf）
      if (def.windupSeconds) {
        if (pm.windup === undefined) {
          pm.windup = def.windupSeconds;
          continue;
        }
        pm.windup -= world.dt;
        if (pm.windup > 0) continue;
        pm.windup = undefined;
      }
      const needsTarget = def.pattern === 'nearest' || def.pattern === 'homing' || def.pattern === 'chain' || !!def.epicenter;
      // 射程内に敵がいなければ待つ
      if (needsTarget && nearestEnemy(world, p.x, p.y, st.range) === -1) {
        pm.cooldown = 0;
        continue;
      }
      // 出した技が消えるまで次を出さない技（ボルテッカー）は、再使用を少なくとも持続の長さにする
      // 順番に出す技（ワンリキーのパンチ）: 自分の番で、前の技から間が空いたときだけ出す。
      // 間は出した技の再使用 ÷ 順番に出す技の数（それぞれの技は、だいたい自分の再使用ごとに1回出る）
      if (def.group) {
        const members = p.moves.filter((m) => world.rules.moves[m.move]?.group === def.group);
        if (members.length > 1) {
          const timers = (p.groupTimers ??= {});
          const cursor = (p.groupCursor ??= {});
          const k = (cursor[def.group] ?? 0) % members.length;
          if (members[k] !== pm || (timers[def.group] ?? 0) > 0) {
            pm.cooldown = 0;
            continue;
          }
          cursor[def.group] = k + 1;
          timers[def.group] = scaledMoveStats(world, p, pm, st).cooldownSeconds / members.length;
        }
      }
      // HP を使う技（だいばくはつ）: HP が最大の minHpPct % を下回っていれば出さずに待つ。最大 HP の pct % 相当のダメージを自分が受ける
      // （防御・ディフェンダーの軽減が効く）。HP は本人のブラウザで減らす（ほかの人の分は本人の画面から届く）
      if (def.hpCost) {
        if (p.hp < (p.maxHp * def.hpCost.minHpPct) / 100) {
          pm.cooldown = 0;
          continue;
        }
        // 反動の技（onHit）は、当たったときに受ける（07 の269章）
        if (!def.hpCost.onHit && p.id === world.localPlayerId) selfDamage(world, p, (p.maxHp * def.hpCost.pct) / 100);
      }
      // その姿の間だけ HP を使う技（ピチュー: でんきショック。07 の57章・66.4）
      const formCost = world.rules.lines?.[p.line]?.hpCost;
      if (formCost && formCost.move === pm.move && formCost.forms.includes(p.species)) {
        if (p.hp < (p.maxHp * formCost.minHpPct) / 100) {
          pm.cooldown = 0;
          continue;
        }
        if (p.id === world.localPlayerId) selfDamage(world, p, (p.maxHp * formCost.pct) / 100);
      }
      // 消えてから数える技（こなゆき・ふぶき）は、持続の分を足す
      // 連鎖（しんそく・ボルトチェンジ）は跳ぶたびに遅れるので、消えるまでの長さは 跳ぶ回数 × 遅れ ＋ 持続（戻る線があれば 1 回多い）
      const ends = st.durationSeconds + (def.pattern === 'chain' ? def.chainHopSeconds * (st.count - 1 + (def.chainReturn ? 1 : 0)) : 0);
      pm.cooldown = Math.max(scaledMoveStats(world, p, pm, st).cooldownSeconds, def.waitForEnd ? ends : 0) + (def.restAfterEnd ? st.durationSeconds : 0);
      if (abilityPowerMultiplier(world, p) !== 1) {
        pm.truantRest = !pm.truantRest;
        if (!pm.truantRest) continue;
      }
      world.events.push({ type: 'moveUsed', playerId: p.id, move: pm.move });
      // 使うと自分が一時的に強くなる技（フレアドライブ）: どのブラウザでも同じように付ける。使い直すと時間が戻る
      if (def.selfBuff) {
        const ticks = Math.max(1, Math.round(def.selfBuff.seconds / world.dt));
        const had = p.moveBuffs?.find((b) => b.move === pm.move);
        if (had) had.ticksLeft = ticks;
        else {
          p.moveBuffs = [...(p.moveBuffs ?? []), { move: pm.move, ticksLeft: ticks }];
          recomputeModifiers(world, p);
        }
      }
      if (def.chargeMove) pm.subPause = def.chargeMove.pauseSeconds;
      // ネコにこばん: 使うたびにランのコインが増える（自分の分は自分のブラウザで数える）
      if (def.coinGain) p.bonusCoins = (p.bonusCoins ?? 0) + def.coinGain.perUse + def.coinGain.perLevel * (pm.level - 1);
      const from = world.projectiles.count;
      switch (def.pattern) {
        case 'nearest':
        case 'facing':
        case 'homing':
        case 'boomerang':
        case 'barrage':
          pm.burstLeft = st.count;
          pm.burstTimer = 0;
          // 続けて当てるほど強くなる（エコーボイス）: 前に出した分が当たっていれば 1 段上げ、外れていれば 0 段。2 段ごとにこだまの輪を 1 つ足す（07 の240章）
          if (def.echo) {
            const stack = pm.echoHit ? Math.min(def.echo.maxStacks, (pm.echo ?? 0) + 1) : 0;
            pm.echo = stack;
            pm.echoHit = false;
            pm.burstLeft = st.count + Math.floor(stack / 2);
          }
          // 向きをランダムに選ぶ技（にどげり）は、使うたびに1つの向きを選び、連撃はその向きへ
          pm.aimAngle = def.randomAim ? world.rng.next() * Math.PI * 2 : undefined;
          if (def.pattern === 'barrage' && def.body) {
            const [fx, fy] = axisToUnit(p.facingX, p.facingY);
            const a = pm.aimAngle ?? Math.atan2(fy, fx);
            world.events.push({ type: 'bodyAttack', playerId: p.id, dirX: Math.cos(a), dirY: Math.sin(a), distance: def.body.lungeDistance, afterimages: def.body.afterimages });
          }
          fireBurst(world, p, pm, st);
          break;
        case 'melee':
          fireMelee(world, p, pm, st);
          break;
        case 'orbit':
          fireOrbit(world, p, pm, st);
          break;
        case 'beam':
          fireBeam(world, p, pm, st);
          break;
        case 'ground':
          fireGround(world, p, pm, st);
          break;
        case 'nova':
          fireNova(world, p, pm, st);
          break;
        case 'screen':
          fireScreen(world, p, pm, st);
          break;
        case 'metronome':
          fireMetronome(world, p, pm);
          break;
        case 'whip':
          fireWhip(world, p, pm, st);
          break;
        case 'lob':
          fireLob(world, p, pm, st);
          break;
        case 'dash':
          fireDash(world, p, pm, st);
          break;
        case 'sequence':
          pm.seq = { i: 0, timer: 0 };
          stepSequence(world, p, pm);
          break;
        case 'strike':
          if (def.sequential) {
            // 1つずつ順に置く（ゴーストダイブ: 影が出ては消え、別の所に出る）
            pm.burstLeft = st.count;
            pm.burstTimer = 0;
            fireBurst(world, p, pm, st);
          } else fireStrike(world, p, pm, st);
          break;
        case 'chain': {
          const hops = fireChain(world, p, pm, st);
          // 実際に走った分だけ待つ（1 体の相手に、走らなかった分の待ち時間を作らない。07 の234章）
          if (def.chainTurnBack) pm.cooldown = Math.max(scaledMoveStats(world, p, pm, st).cooldownSeconds, st.durationSeconds + def.chainHopSeconds * hops);
          break;
        }
        case 'bounce':
          fireBounce(world, p, pm, st);
          break;
        case 'trail':
          fireTrail(world, p, pm, st);
          break;
        case 'cross':
          fireCross(world, p, pm, st);
          break;
        case 'scatter':
          fireScatter(world, p, pm, st);
          break;
        case 'stream':
          fireStream(world, p, pm, st);
          break;
        case 'eruption':
          fireEruption(world, p, pm, st);
          break;
        case 'spin':
          fireSpin(world, p, pm, st);
          break;
        case 'heal':
          fireHeal(world, p, pm, st);
          break;
        case 'sweep':
          fireSweep(world, p, pm, st);
          break;
        case 'spiral':
          fireSpiral(world, p, pm, st);
          break;
        case 'pulse':
          firePulse(world, p, pm, st);
          break;
        case 'weather':
        case 'aura':
          fireWeather(world, p, pm, st);
          break;
      }
      // 続けて撃つ技（burst）は fireBurst の中で印を付ける
      if (!BURST_PATTERNS.has(def.pattern)) markBonusShots(world, p, pm, st, from);
      // ゆびをふる・ものまね は、選んだ技の分を fireMetronome の中で起こす
      if (def.pattern !== 'metronome') fireSpawnEffects(world, from, world.projectiles.count);
      if (def.effects.some((fx) => fx.trigger === 'cast')) {
        const [fx, fy] = axisToUnit(p.facingX, p.facingY);
        const sc = scaledMoveStats(world, p, pm, st);
        fireEffects(world, 'cast', { owner: p.id, move: pm.move, level: pm.level, damage: sc.power, size: sc.size, x: p.x, y: p.y, dirX: fx, dirY: fy, length: 0 });
      }
    }
  }
}

/**
 * ねむる（カビゴン）の1回分: 歩いていない時間が duration 続くと眠り、眠っている間は毎秒 最大 HP の healPct % を回復する。
 * 動くと起き、interval 秒の起きる動き（その間は動けない。movePlayers が止める）を挟む。
 * 眠っている間・起きる動きの間なら true（ほかの技を出さない）
 */
function stepRest(world: World, p: Player): boolean {
  const pm = p.moves.find((m) => world.rules.moves[m.move]?.pattern === 'rest');
  if (!pm) return false;
  const st = moveStatsOf(world, pm);
  const s = (p.sleep ??= { stillTicks: 0, asleep: false, wakeTicks: 0 });
  const moving = p.inputX !== 0 || p.inputY !== 0;
  if (s.wakeTicks > 0) {
    s.wakeTicks--;
    return true;
  }
  if (s.asleep) {
    if (moving) {
      s.asleep = false;
      s.stillTicks = 0;
      s.wakeTicks = Math.round(st.intervalSeconds / world.dt);
      world.events.push({ type: 'restChanged', playerId: p.id, asleep: false });
      return true;
    }
    healPlayer(world, p.id, (p.maxHp * st.healPct * world.dt) / 100);
    return true;
  }
  s.stillTicks = moving ? 0 : s.stillTicks + 1;
  if (s.stillTicks >= Math.round(st.durationSeconds / world.dt)) {
    s.asleep = true;
    world.events.push({ type: 'restChanged', playerId: p.id, asleep: true });
    return true;
  }
  return false;
}

/** 出したばかりの技そのもの（index from〜to − 1）の spawn の効き方を起こす。遅れて現れるもの（stage 3）は、現れたときに起こす */
function fireSpawnEffects(world: World, from: number, to: number): void {
  const pr = world.projectiles;
  for (let i = from; i < to; i++) {
    if (pr.stage[i] !== 0 || pr.noFx[i]) continue;
    if (!world.rules.moves[pr.move[i]!]!.effects.some((fx) => fx.trigger === 'spawn')) return;
    fireEffects(world, 'spawn', fxSourceOf(world, i, pr.x[i]!, pr.y[i]!));
  }
}

/** ためている間に出す技（きあいパンチのマッハパンチ）を、ふつうの技と同じく再使用ごとに出す（続けて撃つ技は間隔ごとに） */
function runSubMove(world: World, p: Player, sub: PlayerMove): void {
  const def = world.rules.moves[sub.move]!;
  const st = playerMoveStats(world, p, sub);
  sub.cooldown -= world.dt;
  if (sub.burstLeft > 0) {
    fireBurst(world, p, sub, st);
    return;
  }
  if (sub.cooldown > 0) return;
  // 溜める技（アクアテールの叩きつけ）: 本体と同じく windupSeconds 溜めてから出す（溜めている間は体が光る）
  if (def.windupSeconds) {
    if (sub.windup === undefined) {
      sub.windup = def.windupSeconds;
      return;
    }
    sub.windup -= world.dt;
    if (sub.windup > 0) return;
    sub.windup = undefined;
  }
  const needsTarget = def.pattern === 'nearest' || def.pattern === 'homing' || def.pattern === 'chain';
  if (needsTarget && nearestEnemy(world, p.x, p.y, st.range) === -1) {
    sub.cooldown = 0;
    return;
  }
  sub.cooldown = scaledMoveStats(world, p, sub, st).cooldownSeconds;
  world.events.push({ type: 'moveUsed', playerId: p.id, move: sub.move });
  if (BURST_PATTERNS.has(def.pattern)) {
    sub.burstLeft = st.count;
    sub.burstTimer = 0;
    fireBurst(world, p, sub, st);
    return;
  }
  ONE_SHOT_FIRE[def.pattern]?.(world, p, sub, st);
}

function base(world: World, p: Player, pm: PlayerMove, st: MoveStats): Omit<ProjectileSpawn, 'motion' | 'x' | 'y'> {
  const sc = scaledMoveStats(world, p, pm, st);
  return {
    owner: p.id,
    move: pm.move,
    level: pm.level,
    damage: sc.power,
    radius: sc.size,
    pierce: st.pierce,
    life: st.durationSeconds,
    hitIntervalTicks: Math.round(st.hitIntervalSeconds / world.dt),
    vx: 0,
    vy: 0,
    ox: 0,
    oy: 0,
    angle: 0,
    // 飛ぶ弾が曲がる速さ（ほかの動き方は、それぞれ上書きする）
    angularSpeed: world.rules.moves[pm.move]!.curve,
    orbitRadius: 0,
    shape: SHAPE_CIRCLE,
    length: 0,
    dirX: 0,
    dirY: 0,
    growth: 0,
  };
}

/** nearest・facing・homing・boomerang・barrage: 間隔が来た分だけ1発ずつ飛ばす */
function fireBurst(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const def = world.rules.moves[pm.move]!;
  pm.burstTimer -= pm.burstTimer > 0 ? world.dt : 0;
  while (pm.burstLeft > 0 && pm.burstTimer <= 0) {
    // ポイントマックスで増えた分（後ろの発）は、2段目以降の技を起こさない
    const shot = st.count - pm.burstLeft;
    const before = world.projectiles.count;
    // 数を威力に変える技（せいなるほのお）は、増えた発が無いので印を付けない
    const bonusShot = shot >= st.count - p.mods.amountBonus && def.effects.length > 0 && !def.bonusCountToPower;
    if (def.pattern === 'barrage') {
      fireBarrageHit(world, p, pm, st);
      if (bonusShot) for (let k = before; k < world.projectiles.count; k++) world.projectiles.noFx[k] = 1;
      pm.burstLeft--;
      pm.burstTimer += st.intervalSeconds;
      continue;
    }
    if (def.pattern === 'strike') {
      // 1つずつ置く落雷（sequential。ゴーストダイブ）: 届く範囲に敵がいなければその1つは出ない
      fireStrike(world, p, pm, { ...st, count: 1 });
      if (bonusShot) for (let k = before; k < world.projectiles.count; k++) world.projectiles.noFx[k] = 1;
      pm.burstLeft--;
      pm.burstTimer += st.intervalSeconds;
      continue;
    }
    let dir: [number, number];
    let target: number | undefined;
    let landLife: number | undefined;
    if (def.pattern === 'nearest' || def.pattern === 'homing') {
      const t = nearestEnemy(world, p.x, p.y, st.range);
      if (t === -1) {
        pm.burstLeft = 0;
        return;
      }
      // せいなるほのお: 届く範囲で HP の一番高い敵へ飛び、その敵を追い続ける。ラスターカノン（nearest）はその敵へまっすぐ（追わない）
      const strong = def.aimStrongest ? strongestEnemy(world, p, st.range) : -1;
      if (strong !== -1 && def.pattern === 'homing') target = world.enemies.id[strong]!;
      dir = strong !== -1 ? aimStrongest(world, p, st.range)! : aim(world, p, st.range);
      // 追う弾: 倒れる見込みの敵を飛ばして狙いを決め、その敵へ向けて出す（07 の248章）
      if (def.pattern === 'homing' && strong === -1) {
        const pick = pickHomingTarget(world, -1, p.id, pm.move, p.x, p.y, st.range);
        if (pick !== -1) {
          target = world.enemies.id[pick]!;
          const ddx = world.enemies.x[pick]! - p.x;
          const ddy = world.enemies.y[pick]! - p.y;
          const dd = Math.hypot(ddx, ddy) || 1;
          dir = [ddx / dd, ddy / dd];
        }
      }
      // 狙った敵の所で止まる（ラスターカノン: 着いた所で弾ける）
      if (def.landAtTarget) {
        const t2 = strong !== -1 ? strong : t;
        const speed0 = scaledMoveStats(world, p, pm, st).speed;
        landLife = Math.min(st.durationSeconds, Math.hypot(world.enemies.x[t2]! - p.x, world.enemies.y[t2]! - p.y) / Math.max(1, speed0));
      }
    } else {
      dir = axisToUnit(p.facingX, p.facingY);
    }
    const [dx, dy] = spread(world, dir[0], dir[1], st.spreadDegrees);
    const speed = scaledMoveStats(world, p, pm, st).speed;
    // 蛇行する弾（りゅうのいかり）: 出した場所から、同じ揺れ方で続けて飛ぶので、つながった炎に見える
    if (def.snake && def.pattern !== 'homing' && def.pattern !== 'boomerang') {
      world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_SNAKE, x: p.x, y: p.y, vx: dx * speed, vy: dy * speed, ox: p.x, oy: p.y, orbitRadius: def.snake.amplitude, angularSpeed: (Math.PI * 2 * speed) / def.snake.wavelength });
      if (bonusShot) for (let k = before; k < world.projectiles.count; k++) world.projectiles.noFx[k] = 1;
      pm.burstLeft--;
      pm.burstTimer += st.intervalSeconds;
      continue;
    }
    const motion = def.pattern === 'homing' ? MOTION_HOMING : def.pattern === 'boomerang' ? MOTION_BOOMERANG : MOTION_LINEAR;
    // boomerang は出したときの速度を ox・oy に覚えておき、時間とともに減速・反転させる
    world.projectiles.add({
      ...base(world, p, pm, st),
      motion,
      x: p.x,
      y: p.y,
      vx: dx * speed,
      vy: dy * speed,
      ox: dx * speed,
      oy: dy * speed,
      ...(target !== undefined ? { target } : {}),
      ...(landLife !== undefined ? { life: Math.max(world.dt, landLife) } : {}),
      ...(def.echo ? echoShape(def.echo, pm, base(world, p, pm, st)) : {}),
    });
    if (bonusShot) for (let k = before; k < world.projectiles.count; k++) world.projectiles.noFx[k] = 1;
    pm.burstLeft--;
    pm.burstTimer += st.intervalSeconds;
  }
}

/**
 * barrage（連打）の1発: 向き（ランダムに選んだ向き、無ければ向いている方向）を中心にした開き arcDegrees・距離 range の中の
 * ランダムな場所に、外へ押し出す小さな当たり判定を出す（拳・蹴り。進む向きへ speed で少し進んで消える）
 */
function fireBarrageHit(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const [fx, fy] = axisToUnit(p.facingX, p.facingY);
  const center = pm.aimAngle ?? Math.atan2(fy, fx);
  const speed0 = scaledMoveStats(world, p, pm, st).speed;
  const bdef = world.rules.moves[pm.move]!;
  const width = bdef.barrageWidth ? bdef.barrageWidth + (bdef.barrageWidthPerLevel ?? 0) * Math.max(0, pm.level - 1) : 0;
  if (width) {
    // 長方形: 自分を通る横の辺のランダムな所から、向きへまっすぐ。奥行き range まで届いたら消える
    const dx = Math.cos(center);
    const dy = Math.sin(center);
    const off = (bdef.barrageSeek ? barrageSeekOffset(world, p, dx, dy, width, st.range) : null) ?? (world.rng.next() - 0.5) * width;
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x: p.x - dy * off, y: p.y + dx * off, vx: dx * speed0, vy: dy * speed0, life: st.range / Math.max(1, speed0) });
    return;
  }
  if (bdef.barrageAhead) {
    // 前へ順に置く（にどげり）: k 発目を自分から range × k / count の所に。持ち主に付いていく
    const shot = st.count - pm.burstLeft + 1;
    const ox = Math.cos(center) * ((st.range * shot) / Math.max(1, st.count));
    const oy = Math.sin(center) * ((st.range * shot) / Math.max(1, st.count));
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_FOLLOW, x: p.x + ox, y: p.y + oy, ox, oy, vx: Math.cos(center), vy: Math.sin(center) });
    return;
  }
  const a = center + (world.rng.next() - 0.5) * ((Math.min(360, st.arcDegrees) * Math.PI) / 180);
  const d = st.range * (0.3 + 0.7 * world.rng.next());
  const speed = speed0;
  world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed });
}

/**
 * 長方形の連打で噛みにいく敵の横の位置（自分を通る線の上）: 長方形の中の生きている敵のどれかを選ぶ。だれもいなければ null
 * 群れではランダムに選ぶので幅いっぱいに広がり、ボス1体なら全部がその正面から出る（07 の233章）
 */
function barrageSeekOffset(world: World, p: Player, dx: number, dy: number, width: number, range: number): number | null {
  const e = world.enemies;
  let maxR = 0;
  for (const k of world.rules.enemies.kinds) maxR = Math.max(maxR, k.radius);
  const r = Math.hypot(range, width / 2) + maxR;
  const n = world.enemyHash.queryRect(p.x - r, p.y - r, p.x + r, p.y + r, world.scratch);
  let found = 0;
  let best: number | null = null;
  for (let q = 0; q < n; q++) {
    const j = world.scratch[q]!;
    if (e.hp[j]! <= 0) continue;
    const rx = e.x[j]! - p.x;
    const ry = e.y[j]! - p.y;
    const along = rx * dx + ry * dy;
    const side = ry * dx - rx * dy;
    const er = e.radius[j]!;
    if (along < -er || along > range + er || Math.abs(side) > width / 2 + er) continue;
    // 1 つずつ同じ確率で残す（順番に左右されない選び方）。少しだけ横にずらして、同じ列に重ならないようにする
    found++;
    if (world.rng.next() * found < 1) best = Math.max(-width / 2, Math.min(width / 2, side)) + (world.rng.next() - 0.5) * er;
  }
  return best;
}

/** melee: 向いている方向 → 反対側 → 左 → 右 の順に当たり判定を出す（持ち主に付いていく。range 0 なら自分の周り） */
function fireMelee(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  // 後ろへ出す技（リベンジ: 振り向きざまの反撃）は、向いている方の反対へ
  const [ux, uy] = axisToUnit(p.facingX, p.facingY);
  const back = world.rules.moves[pm.move]!.aimBehind ? -1 : 1;
  const fx = ux * back;
  const fy = uy * back;
  const body = world.rules.moves[pm.move]!.body;
  if (body) world.events.push({ type: 'bodyAttack', playerId: p.id, dirX: fx, dirY: fy, distance: body.lungeDistance, afterimages: body.afterimages, ...(body.flip ? { flip: true } : {}) });
  const box = world.rules.moves[pm.move]!.frontBox;
  if (box) {
    // キバの技: 自分の前の長方形（口の絵が描かれる所。届く距離 range + size の start〜end 倍）。体当たりの技は扇形のまま
    // 数が増えると、届く距離と幅が大きくなる（07 の163章）
    const grow = 1 + (world.rules.combat.boxCountGrowthPct / 100) * Math.max(0, st.count - 1);
    const reach = (st.range + scaledMoveStats(world, p, pm, st).size) * grow;
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_FOLLOW, x: p.x, y: p.y, radius: reach, shape: SHAPE_BOX, length: reach * box.halfWidth, dirX: fx, dirY: fy, vx: fx, vy: fy });
    return;
  }
  if (st.arcDegrees > 0) {
    // 扇形: 自分を中心に、向いている方向へ（360 度なら自分の周り全部。数が2以上なら反対側にも）
    const sc = scaledMoveStats(world, p, pm, st);
    // 数が増えたら、本数を増やさず角度を広げる（07 の163章: 反対側に同じ扇を出すと違和感がある）。技の countWidens（度）が無ければ元の角度の countWidenPct %
    const widen = world.rules.moves[pm.move]!.countWidens ?? (st.arcDegrees * world.rules.combat.countWidenPct) / 100;
    const arc = Math.min(360, st.arcDegrees + widen * Math.max(0, st.count - 1));
    const half = Math.min(Math.PI, (arc * Math.PI) / 360);
    const sideways = !!world.rules.moves[pm.move]!.sideways;
    const n = sideways ? 2 : 1;
    // 外へ進む攻撃: 厚さ band の帯が、中心から届く距離まで持続の間に進む
    const reach = st.range + sc.size;
    const band = reachBand(world, pm.move, reach);
    const growth = band > 0 ? (reach - band) / st.durationSeconds : 0;
    for (let k = 0; k < n; k++) {
      const s = k === 0 ? 1 : -1;
      // 左右（ハイパーボイス）: 向いている方向に直角な2つの向き
      const dx = sideways ? -fy * s : fx * s;
      const dy = sideways ? fx * s : fy * s;
      world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_FOLLOW, x: p.x, y: p.y, radius: band > 0 ? band : reach, band, growth, shape: SHAPE_SECTOR, length: half, dirX: dx, dirY: dy, vx: dx, vy: dy });
    }
    return;
  }
  const dirs: [number, number][] = [
    [fx, fy],
    [-fx, -fy],
    [-fy, fx],
    [fy, -fx],
  ];
  const n = st.range > 0 ? Math.min(st.count, dirs.length) : 1;
  for (let k = 0; k < n; k++) {
    const [dx, dy] = dirs[k]!;
    const ox = dx * st.range;
    const oy = dy * st.range;
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_FOLLOW, x: p.x + ox, y: p.y + oy, ox, oy, vx: dx, vy: dy });
  }
}

/** orbit: count 個を等間隔に並べて回す（回る速さ speed は円周上の速さ） */
function fireOrbit(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const angularSpeed = st.range > 0 ? st.speed / st.range : 0;
  for (let k = 0; k < st.count; k++) {
    const angle = (k / st.count) * Math.PI * 2;
    world.projectiles.add({
      ...base(world, p, pm, st),
      motion: MOTION_ORBIT,
      x: p.x + Math.cos(angle) * st.range,
      y: p.y + Math.sin(angle) * st.range,
      angle,
      angularSpeed,
      orbitRadius: st.range,
    });
  }
}

/**
 * beam: 一番近い敵（いなければ向いている方向）へ直線を出す。count 2 以上は少しずつ角度をずらす。
 * spreadDegrees があれば、その角度の中に等間隔に並べる（じわれ: 360 で四方へ）
 */
function fireBeam(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const def = world.rules.moves[pm.move]!;
  const [ax, ay] = def.aimFacing ? axisToUnit(p.facingX, p.facingY) : ((def.aimStrongest ? aimStrongest(world, p, st.range) : null) ?? aim(world, p, st.range));
  const body = def.body;
  if (body) world.events.push({ type: 'bodyAttack', playerId: p.id, dirX: ax, dirY: ay, distance: body.lungeDistance, afterimages: body.afterimages });
  // 数が増えても1本のまま、幅を広げる（作者の指摘 2026年10月27日: 本数を増やすと、残る範囲が1本分だけだった）
  const widen = 1 + world.rules.combat.beamWidthPerExtraCount * Math.max(0, st.count - 1);
  const b = base(world, p, pm, st);
  // 障害物は技も遮る（ビームは障害物の手前まで）
  const length = rayLengthToObstacle(world, p.x, p.y, ax, ay, st.range);
  world.projectiles.add({ ...b, radius: b.radius * widen, motion: MOTION_FOLLOW, x: p.x, y: p.y, shape: SHAPE_LINE, length, dirX: ax, dirY: ay, vx: ax, vy: ay });
}

/**
 * stream: 向いている方向へ、太い流れを出し続ける（07 22.5 ハイドロポンプ）。弾ではなく持ち主に付いていく直線で、
 * 次に使うまで消えない（再使用の時間だけ残るので、途切れずに出し続けて見える）。count 2 以上は spreadDegrees ずつ広げて並べる
 */
function fireStream(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const [fx, fy] = axisToUnit(p.facingX, p.facingY);
  const sc = scaledMoveStats(world, p, pm, st);
  for (let k = 0; k < st.count; k++) {
    const offset = ((k - (st.count - 1) / 2) * st.spreadDegrees * Math.PI) / 180;
    const a = Math.atan2(fy, fx) + offset;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    world.projectiles.add({
      ...base(world, p, pm, st),
      motion: MOTION_STREAM,
      x: p.x,
      y: p.y,
      shape: SHAPE_LINE,
      length: rayLengthToObstacle(world, p.x, p.y, dx, dy, st.range),
      dirX: dx,
      dirY: dy,
      angle: offset,
      // 向きを変える速さ（ラジアン/秒）は speed を度/秒として使う
      angularSpeed: (st.speed * Math.PI) / 180,
      orbitRadius: st.range,
      // 出ている時間は持続（再使用より長ければ再使用まで）。前は再使用までずっと出していて、ハイドロポンプの「持続 1 秒・再使用 3 秒」（作者の決定）が効いていなかった
      life: Math.min(st.durationSeconds, sc.cooldownSeconds) + world.dt,
    });
  }
}

/** ground: 一番近い敵の位置（いなければ前方 range の位置）に、地面に残る当たり判定を置く */
function fireGround(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const t = nearestEnemy(world, p.x, p.y, st.range);
  let tx: number;
  let ty: number;
  if (t !== -1) {
    tx = world.enemies.x[t]!;
    ty = world.enemies.y[t]!;
  } else {
    const [fx, fy] = axisToUnit(p.facingX, p.facingY);
    tx = p.x + fx * st.range * 0.5;
    ty = p.y + fy * st.range * 0.5;
  }
  const sc = scaledMoveStats(world, p, pm, st);
  for (let k = 0; k < st.count; k++) {
    // 2つ目以降は周りに散らす
    const r = k === 0 ? 0 : sc.size * 1.5 * (0.5 + world.rng.next());
    const a = world.rng.next() * Math.PI * 2;
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x: tx + Math.cos(a) * r, y: ty + Math.sin(a) * r });
  }
}

/** screen: range の中の近い敵 count 体の足元に、同時に当たり判定を置く（画面じゅうの敵へ） */
function fireScreen(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const { enemies: e, enemyHash, scratch } = world;
  const n = enemyHash.queryRect(p.x - st.range, p.y - st.range, p.x + st.range, p.y + st.range, scratch);
  const found: { i: number; d2: number }[] = [];
  const flying = world.rules.moves[pm.move]!.groundOnly ? world.rules.types.names.indexOf('flying') : -1;
  // ハッシュの衝突で同じ敵が2回入っていることがある
  const seen = new Set<number>();
  for (let k = 0; k < n; k++) {
    const i = scratch[k]!;
    if (e.hp[i]! <= 0 || seen.has(i)) continue;
    seen.add(i);
    // 地上の敵だけ（じしん: ひこうタイプには効かない）
    if (flying >= 0 && world.rules.enemies.kinds[e.kind[i]!]?.types?.includes(flying)) continue;
    const d2 = (e.x[i]! - p.x) ** 2 + (e.y[i]! - p.y) ** 2;
    if (d2 <= st.range * st.range) found.push({ i, d2 });
  }
  // 近い順（同じ距離なら id の小さい順。ハッシュの並び順に左右されないように）
  found.sort((a, b) => a.d2 - b.d2 || e.id[a.i]! - e.id[b.i]!);
  for (const { i } of found.slice(0, st.count)) {
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x: e.x[i]!, y: e.y[i]! });
  }
}

/** 一度に出し終える出し方（ゆびをふるで選ぶ技。連射の出し方は、出し続ける状態を持てないので選ばない） */
/** 続けて撃つ出し方（ゆびをふる・ものまね では一度にまとめて撃つ） */
const BURST_PATTERNS = new Set(['nearest', 'facing', 'homing', 'boomerang', 'barrage']);
const ONE_SHOT_PATTERNS = new Set(['melee', 'orbit', 'beam', 'ground', 'nova', 'screen', 'whip', 'lob', 'strike', 'chain', 'bounce', 'cross', 'scatter', 'eruption', 'spin', 'sweep', 'spiral', 'pulse', 'weather', 'aura']);

/** metronome（ゆびをふる）: ほかの技からランダムに1つを、その技の最大レベルで出す */
function fireMetronome(world: World, p: Player, self?: PlayerMove): void {
  // 選ぶ技: ものまね は遊べるポケモンの最初の技、ゆびをふる は固有技（作者の決定 2026年10月23日）。
  // 続けて撃つ技（ひのこ・スピードスター など）は一度にまとめて撃ち、出し続ける技・回復は選ばない
  const own = self ? world.rules.moves[self.move]! : null;
  const pool = (own && own.randomPool.length > 0 ? own.randomPool : world.rules.moves.map((_, i) => i)).filter((i) => {
    const pat = world.rules.moves[i]!.pattern;
    return ONE_SHOT_PATTERNS.has(pat) || BURST_PATTERNS.has(pat);
  });
  if (pool.length === 0) return;
  const move = pool[world.rng.int(pool.length)]!;
  const def = world.rules.moves[move]!;
  // ものまね は自分のレベルの割合で（最大なら選んだ技も最大）、ゆびをふる は最大レベルで出す
  const max = def.levels.length;
  const level = own && self && own.randomScaled ? Math.max(1, Math.round((self.level / own.levels.length) * max)) : max;
  const pm: PlayerMove = { move, level, cooldown: 0, burstLeft: 0, burstTimer: 0 };
  const st = playerMoveStats(world, p, pm);
  if (BURST_PATTERNS.has(def.pattern)) {
    pm.burstLeft = st.count;
    fireBurst(world, p, pm, { ...st, intervalSeconds: 0 });
    return;
  }
  const from = world.projectiles.count;
  ONE_SHOT_FIRE[def.pattern]?.(world, p, pm, st);
  fireSpawnEffects(world, from, world.projectiles.count);
}

/** 一度に出し終える出し方ごとの出す関数（ゆびをふる・ものまね・ためている間に出す技で使う） */
const ONE_SHOT_FIRE: Record<string, (w: World, p: Player, pm: PlayerMove, st: MoveStats) => void> = {
  melee: fireMelee,
  dash: fireDash,
  orbit: fireOrbit,
  beam: fireBeam,
  ground: fireGround,
  nova: fireNova,
  screen: fireScreen,
  whip: fireWhip,
  lob: fireLob,
  strike: fireStrike,
  chain: fireChain,
  bounce: fireBounce,
  cross: fireCross,
  scatter: fireScatter,
  eruption: fireEruption,
  spin: fireSpin,
  sweep: fireSweep,
  spiral: fireSpiral,
  pulse: firePulse,
  weather: fireWeather,
  // まとう技（フレアドライブ）: 伝説が同じ技を出すとき（色違いのリザードン。07 の254章）
  aura: fireWeather,
};

/**
 * whip（横なぎ）: 左右へ長い直線で払う。向いている側（左右）から、count 2 で反対側、3・4 で上下も。
 * 5〜8 は斜め（向いている側の上・下、反対側の上・下）も（作者の指摘 2026年10月23日: ポイントマックスで 5 以上にしても4方向のままだった）
 */
function fireWhip(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const side = p.facingX < 0 ? -1 : 1;
  const d = Math.SQRT1_2;
  const dirs: [number, number][] = [
    [side, 0],
    [-side, 0],
    [0, -1],
    [0, 1],
    [side * d, -d],
    [side * d, d],
    [-side * d, -d],
    [-side * d, d],
  ];
  const body = world.rules.moves[pm.move]!.body;
  if (body) world.events.push({ type: 'bodyAttack', playerId: p.id, dirX: side, dirY: 0, distance: body.lungeDistance, afterimages: body.afterimages });
  // 2本目からは interval ずつ遅らせる（同時に払わず、左 → 右と順に。作者の指摘 2026年10月25日）。遅れる分は出番を待つもの（stage 3）
  dirs.slice(0, Math.max(1, Math.min(dirs.length, st.count))).forEach(([dx, dy], k) => {
    const length = rayLengthToObstacle(world, p.x, p.y, dx, dy, st.range);
    const wait = st.intervalSeconds * k;
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_FOLLOW, x: p.x, y: p.y, shape: SHAPE_LINE, length, dirX: dx, dirY: dy, vx: dx, vy: dy, ...(wait > 0 ? { life: wait, stage: 3, armLife: st.durationSeconds } : {}) });
  });
}

/**
 * lob（放物線）: 向いている側の斜め上へ投げ、重さで弧を描いて落ちる。
 * 落とす場所が決まっている技（lobTarget）は、真上寄りに speed で投げ上げ、持続の秒数でちょうどその場所に落ちるよう重さを決める
 */
function fireLob(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const speed = scaledMoveStats(world, p, pm, st).speed;
  const target = world.rules.moves[pm.move]!.lobTarget;
  if (target) {
    const T = st.durationSeconds;
    const t0 = target === 'nearest' ? nearestEnemy(world, p.x, p.y, st.range) : -1;
    // 一部を敵のいる所へ落とす（ふんか: 残りはランダムな地面。伝説が同じ技を出すときは使わない。07 の234章）
    const share = p.id < CASTER_ID_BASE ? (world.rules.moves[pm.move]!.lobSeekShare ?? 0) : 0;
    const seek = share > 0 ? Math.round(st.count * share) : 0;
    const pool = seek > 0 ? enemiesInRange(world, p.x, p.y, st.range) : [];
    for (let k = 0; k < st.count; k++) {
      let dx: number;
      let dy: number;
      if (t0 !== -1 && k === 0) {
        dx = world.enemies.x[t0]! - p.x;
        dy = world.enemies.y[t0]! - p.y;
      } else if (k < seek && pool.length > 0) {
        const j = pool[world.rng.int(pool.length)]!;
        dx = world.enemies.x[j]! - p.x;
        dy = world.enemies.y[j]! - p.y;
      } else {
        // 自分の周り range の中（近すぎない所）のランダムな場所
        const a = world.rng.next() * Math.PI * 2;
        const r = st.range * (0.25 + 0.75 * Math.sqrt(world.rng.next()));
        dx = Math.cos(a) * r;
        dy = Math.sin(a) * r;
      }
      const vy = -speed * (0.85 + world.rng.next() * 0.3);
      // 落ちる場所 = 投げた場所 + v × T + 重さ × dt² × n(n+1)/2（更新 n 回ぶん。速さを先に変えてから動かすので、式どおりの T²/2 より少し多い）
      const n = Math.max(1, Math.round(T / world.dt));
      const gravity = (dy - vy * n * world.dt) / ((world.dt * world.dt * n * (n + 1)) / 2);
      world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LOB, x: p.x, y: p.y, vx: dx / T, vy, angularSpeed: gravity });
    }
    return;
  }
  const side = p.facingX < 0 ? -1 : p.facingX > 0 ? 1 : world.rng.next() < 0.5 ? -1 : 1;
  for (let k = 0; k < st.count; k++) {
    // 数が多いときは、左右・高さをばらつかせる
    const sx = (k % 2 === 0 ? side : -side) * (0.25 + world.rng.next() * 0.35);
    const vy = -(0.85 + world.rng.next() * 0.3);
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LOB, x: p.x, y: p.y, vx: sx * speed, vy: vy * speed, angularSpeed: speed * 2.2 });
  }
}

/** range の中にいる敵（同じ敵は1回だけ） */
function enemiesInRange(world: World, x: number, y: number, range: number): number[] {
  const { enemies: e, enemyHash, scratch } = world;
  const n = enemyHash.queryRect(x - range, y - range, x + range, y + range, scratch);
  const out: number[] = [];
  const seen = new Set<number>();
  for (let k = 0; k < n; k++) {
    const i = scratch[k]!;
    if (e.hp[i]! <= 0 || seen.has(i)) continue;
    seen.add(i);
    if ((e.x[i]! - x) ** 2 + (e.y[i]! - y) ** 2 <= range * range) out.push(i);
  }
  // ハッシュの並び順に左右されないように、id の順にそろえてから乱数で選ぶ
  return out.sort((a, b) => e.id[a]! - e.id[b]!);
}

/** strike（落雷）: range の中のランダムな敵 count 体の足元に、同時に当たり判定を置く */
/** 重ねる印を並べる向き（三角関数を使わず、どのブラウザでも同じ位置に） */
const STACK_OFFSETS: readonly (readonly [number, number])[] = [[1, 0], [-0.7, 0.7], [0, -1], [0.7, 0.7], [-1, 0], [0.7, -0.7], [0, 1], [-0.7, -0.7]];

function fireStrike(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const e = world.enemies;
  const pool = enemiesInRange(world, p.x, p.y, st.range);
  const def = world.rules.moves[pm.move]!;
  const all = def.strikeRepeat ? [...pool] : [];
  // HP の一番高い敵を先に（ぜったいれいど: 1 つ目はボスへ。残りはランダム。07 の271章）
  const first = def.aimStrongest ? strongestEnemy(world, p, st.range) : -1;
  // 印を重ねる技（サーナイトの みらいよち）: 全部をその敵へ。少しずつずらして、目が並んで見えるように
  if (first !== -1 && def.delayedBlast?.stack) {
    const r = e.radius[first]! * 0.6;
    for (let k = 0; k < st.count; k++) {
      const [ox, oy] = k === 0 ? [0, 0] : STACK_OFFSETS[(k - 1) % STACK_OFFSETS.length]!;
      world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x: e.x[first]! + ox * r, y: e.y[first]! + oy * r });
    }
    return;
  }
  for (let k = 0; k < st.count && (pool.length > 0 || all.length > 0); k++) {
    // 敵より多く出す技は、一回りしたら同じ敵にも重ねる
    const i = k === 0 && first !== -1 ? pool.splice(pool.indexOf(first), 1)[0]! : pool.length > 0 ? pool.splice(world.rng.int(pool.length), 1)[0]! : all[world.rng.int(all.length)]!;
    // 敵に貼り付く（みちづれ）: その敵の上に乗って動く
    world.projectiles.add({ ...base(world, p, pm, st), motion: def.attachToTarget ? MOTION_ATTACH : MOTION_LINEAR, x: e.x[i]!, y: e.y[i]!, ...(def.attachToTarget ? { target: e.id[i]! } : {}) });
  }
}

/** 体が動く技か（dash の技と、dash の段を持つ連続技: ギガインパクト・とっておき・げきりん） */
function movesBody(world: World, move: number): boolean {
  const def = world.rules.moves[move];
  if (!def) return false;
  return !!def.dash || !!def.sequence?.some((s) => !!world.rules.moves[s.move]?.dash);
}

/**
 * ほかの体が動く技が使われているか（07 の268章）: 進んでいる間（dashBusyTicks。どのブラウザでも同じに数える）か、
 * ほかの体が動く技が溜めている・連続技の途中
 */
function bodyBusy(world: World, p: Player, self: PlayerMove): boolean {
  if (p.dashBusyTicks) return true;
  return p.moves.some((m) => m !== self && (m.windup !== undefined || m.seq !== undefined) && movesBody(world, m.move));
}

/** 連続技を始めてよいか（とっておき: 前に敵がいる。げきりん: 届く範囲に敵がいる。アクアテール: いつでも） */
function sequenceCanStart(world: World, p: Player, gate: 'ahead' | 'any' | 'none', st: MoveStats): boolean {
  if (gate === 'none') return true;
  if (gate === 'any') return enemiesInRange(world, p.x, p.y, st.range).length > 0;
  return enemyAhead(world, p, st.range + st.size);
}

/**
 * 連続技（とっておき。07 の183章）: 時間が来た段を順に出す。消費していない技の段は飛ばす（待たない）。
 * 段の技は本体のレベルで出す
 */
function stepSequence(world: World, p: Player, pm: PlayerMove): void {
  const steps = world.rules.moves[pm.move]!.sequence!;
  const seq = pm.seq!;
  seq.timer -= world.dt;
  while (seq.timer <= 0 && seq.i < steps.length) {
    const s = steps[seq.i++]!;
    if (pm.level < s.minLevel) continue;
    // 段の条件: 消費した技（needsConsumed）か、持っている技（needsMoves）のどれか。両方あればどちらかでよい
    // （ギガインパクトのヘビーボンバー: 進化で消費していても、後から覚えて持っていても出る。07 の268章）
    if (s.needsConsumed.length > 0 || s.needsMoves.length > 0) {
      const ok = s.needsConsumed.some((m) => p.consumedMoves?.includes(m)) || s.needsMoves.some((m) => p.moves.some((x) => x.move === m));
      if (!ok) continue;
    }
    const def = world.rules.moves[s.move]!;
    const sub: PlayerMove = { move: s.move, level: Math.min(pm.level, def.levels.length), cooldown: 0, burstLeft: 0, burstTimer: 0 };
    const st = playerMoveStats(world, p, sub);
    // 敵が多い所へ飛ぶ段（げきりん）: 途中で周りの敵がいなくなったら、そこで終わる
    if (def.dash?.target === 'crowd' && enemiesInRange(world, p.x, p.y, st.range).length === 0) {
      pm.seq = undefined;
      return;
    }
    // 相手の上へ飛び込む段（ギガインパクトのヘビーボンバー）: 前の扇に相手がいなければ、その段だけ飛ばす（待たない）
    if (def.dash?.target === 'strongest' && dashTarget(world, p, def.dash, st.range) === -1) continue;
    if (BURST_PATTERNS.has(def.pattern)) {
      sub.burstLeft = st.count;
      fireBurst(world, p, sub, { ...st, intervalSeconds: 0 });
    } else {
      ONE_SHOT_FIRE[def.pattern]?.(world, p, sub, st);
    }
    seq.timer += s.afterSeconds;
  }
  if (seq.i >= steps.length) pm.seq = undefined;
}

/** 届く範囲で、まわり（radius）に敵が一番多い敵（先頭から決まった数だけ調べる）。いなければ -1 */
function crowdCenter(world: World, p: Player, range: number, radius: number): number {
  const e = world.enemies;
  const pool = enemiesInRange(world, p.x, p.y, range);
  let best = -1;
  let bestCount = -1;
  for (const i of pool.slice(0, 24)) {
    let n = 0;
    for (const j of pool.slice(0, 80)) if ((e.x[i]! - e.x[j]!) ** 2 + (e.y[i]! - e.y[j]!) ** 2 <= radius * radius) n++;
    if (n > bestCount) {
      bestCount = n;
      best = i;
    }
  }
  return best;
}

/** 向いている方の半分（自分より前）で、距離 reach の中に敵がいるか */
function enemyAhead(world: World, p: Player, reach: number): boolean {
  const e = world.enemies;
  const [fx, fy] = axisToUnit(p.facingX, p.facingY);
  for (const i of enemiesInRange(world, p.x, p.y, reach)) {
    if ((e.x[i]! - p.x) * fx + (e.y[i]! - p.y) * fy >= 0) return true;
  }
  return false;
}

/**
 * dash（体が本当に動く技。07 の177章）: 向いている方へ range だけ進む。動かすのは本人のブラウザだけ（ほかの人の位置は通信で届く）。
 * land は着く所に、着く時刻に当たり判定を出す。path は進んでいる間、体に付いて当たる
 */
function fireDash(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const dash = world.rules.moves[pm.move]!.dash!;
  let [fx, fy] = axisToUnit(p.facingX, p.facingY);
  let distance = st.range;
  // 敵が一番多い所へ（ドラゴンダイブ）
  if (dash.target !== 'facing') {
    // 敵が一番多い所（ドラゴンダイブ）か、HP の一番高い敵の上（ヘビーボンバー）
    const t = dash.target === 'crowd' ? crowdCenter(world, p, st.range, st.size) : dashTarget(world, p, dash, st.range);
    if (t !== -1) {
      const dx = world.enemies.x[t]! - p.x;
      const dy = world.enemies.y[t]! - p.y;
      distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > 0) {
        fx = dx / distance;
        fy = dy / distance;
      }
      // 相手の手前で止まる（アクアブレイク: ぶつかった所でしぶき）
      if (dash.stopShort) distance = Math.max(0, distance - world.enemies.radius[t]! - p.radius);
    }
  }
  const ticks = Math.max(1, Math.round(dash.seconds / world.dt));
  // 更新回数で割り切って、ちょうど行き先まで進む
  const speed = distance / (ticks * world.dt);
  world.events.push({ type: 'dashStarted', playerId: p.id, seconds: dash.seconds, hop: dash.hop, afterimages: dash.afterimages, ...(dash.tint ? { tint: dash.tint } : {}), dirX: fx, dirY: fy, distance });
  if (dash.recoverSeconds > 0) p.recoverTicks = ticks + Math.round((dash.recoverSeconds * (dash.recoverLines?.[p.line] ?? 1)) / world.dt);
  // 進んでいる間は、ほかの体が動く技を出さない（07 の268章）。体を動かすのは本人のブラウザだけだが、これはどのブラウザでも数える
  p.dashBusyTicks = Math.max(p.dashBusyTicks ?? 0, ticks);
  if (p.id === world.localPlayerId) {
    p.dashTicks = ticks;
    p.dashVx = fx * speed;
    p.dashVy = fy * speed;
    if (dash.invincible) p.invincibleTicks = Math.max(p.invincibleTicks, ticks + 1);
  }
  const b = base(world, p, pm, st);
  if (dash.hit === 'land') {
    const x = p.x + fx * distance;
    const y = p.y + fy * distance;
    world.projectiles.add({ ...b, motion: MOTION_LINEAR, x, y, vx: 0, vy: 0, life: dash.seconds, stage: 3, armLife: st.durationSeconds });
    // 予告: 着く前に、行き先の敵へ状態異常だけを付ける（ドラゴンダイブ: 殺気ですくむ）
    if (dash.target === 'crowd') world.projectiles.add({ ...b, motion: MOTION_LINEAR, x, y, vx: 0, vy: 0, life: 0.1, damage: 0, knockback: 0, radius: st.size * 2, stage: 1 });
  } else {
    world.projectiles.add({ ...b, motion: MOTION_FOLLOW, x: p.x, y: p.y, ox: 0, oy: 0, vx: fx, vy: fy, dirX: fx, dirY: fy, life: dash.seconds + world.dt });
  }
}

/** chain（連鎖）: 一番近い敵から、近くの敵へ count 回飛び移る線（1回に range の半分まで跳ぶ） */
function fireChain(world: World, p: Player, pm: PlayerMove, st: MoveStats): number {
  const e = world.enemies;
  let x = p.x;
  let y = p.y;
  let reach = st.range;
  const used = new Set<number>();
  const hop = world.rules.moves[pm.move]!.chainHopSeconds;
  const minHop2 = world.rules.moves[pm.move]!.chainMinHop ** 2;
  if (world.rules.moves[pm.move]!.chainRadial) {
    // ほうでん: 届く範囲の敵から count 匹をランダムに選び、自分からそれぞれへまっすぐ出す（まわりの全方向へ放電する）
    const pool = enemiesInRange(world, x, y, reach);
    for (let k = 0; k < st.count && pool.length > 0; k++) {
      const i = pool.splice(Math.floor(world.rng.next() * pool.length), 1)[0]!;
      const len = Math.hypot(e.x[i]! - x, e.y[i]! - y) || 1;
      world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x, y, shape: SHAPE_LINE, length: len, dirX: (e.x[i]! - x) / len, dirY: (e.y[i]! - y) / len });
    }
    return 0;
  }
  // 前へ撃つ連鎖（10まんボルト）は、自分から見て向いている方の角度の中の敵へだけ跳ぶ（07 の164章）
  const facingHalf = world.rules.moves[pm.move]!.chainFacingHalf;
  const [afx, afy] = axisToUnit(p.facingX, p.facingY);
  const ahead = (i: number): boolean => facingHalf === undefined || inSector(e.x[i]! - p.x, e.y[i]! - p.y, e.radius[i]!, afx, afy, facingHalf);
  let hops = 0;
  let lastEnemy = -1;
  let lastX = 1;
  let lastY = 0;
  for (let k = 0; k < st.count; k++) {
    // 一番近い敵へ。chainMinHop があれば、それより離れた敵の中で一番近い敵（いなければ一番近い敵。しんそく: 広く倒す）
    let best = -1;
    let bestD2 = reach * reach;
    let far = -1;
    let farD2 = reach * reach;
    for (const i of enemiesInRange(world, x, y, reach)) {
      if (used.has(i) || !ahead(i)) continue;
      const d2 = (e.x[i]! - x) ** 2 + (e.y[i]! - y) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
      if (k > 0 && d2 >= minHop2 && d2 < farD2) {
        farD2 = d2;
        far = i;
      }
    }
    if (minHop2 > 0 && far !== -1) {
      best = far;
      bestD2 = farD2;
    }
    if (best === -1) break;
    used.add(best);
    const len = Math.sqrt(bestD2) || 1;
    const dx = (e.x[best]! - x) / len;
    const dy = (e.y[best]! - y) / len;
    // 2回目からは、跳ぶごとに少し遅れて現れる（出番を待つもの stage 3。待つ間は見えず当たらない）
    const wait = hop * k;
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x, y, shape: SHAPE_LINE, length: len, dirX: dx, dirY: dy, ...(wait > 0 ? { life: wait, stage: 3, armLife: st.durationSeconds } : {}) });
    x = e.x[best]!;
    y = e.y[best]!;
    reach = st.range * 0.5;
    hops++;
    lastEnemy = best;
    lastX = dx;
    lastY = dy;
  }
  // 切り返し（しんそく）: 敵が足りなければ、最後の敵を突き抜けて少し先へ走る。戻る線はまたその敵を通る（07 の234章）
  if (world.rules.moves[pm.move]!.chainTurnBack && lastEnemy !== -1 && hops < st.count) {
    const len = rayLengthToObstacle(world, x, y, lastX, lastY, e.radius[lastEnemy]! + Math.sqrt(minHop2));
    if (len > 1) {
      const wait = hop * hops;
      world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x, y, shape: SHAPE_LINE, length: len, dirX: lastX, dirY: lastY, ...(wait > 0 ? { life: wait, stage: 3, armLife: st.durationSeconds } : {}) });
      x += lastX * len;
      y += lastY * len;
      hops++;
    }
  }
  if (world.rules.moves[pm.move]!.chainReturn && hops > 0) {
    // 最後は自分の所へ戻る線（ボルトチェンジ: 残像が帰ってくる）。出番が来たときに、そのときの自分の位置へ向け直す（orbitRadius −1 の印。飛ばない線では使っていない欄）
    const len = Math.hypot(p.x - x, p.y - y) || 1;
    const wait = hop * hops;
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x, y, shape: SHAPE_LINE, length: len, dirX: (p.x - x) / len, dirY: (p.y - y) / len, orbitRadius: -1, ...(wait > 0 ? { life: wait, stage: 3, armLife: st.durationSeconds } : {}) });
  }
  return hops;
}

/** bounce（跳ね返り）: ランダムな方向へ飛び、自分のまわりの枠の端で跳ね返る */
function fireBounce(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const speed = scaledMoveStats(world, p, pm, st).speed;
  for (let k = 0; k < st.count; k++) {
    const [fx, fy] = axisToUnit(p.facingX, p.facingY);
    // spreadDegrees があれば、その幅でランダムにずらす（ボルテッカー: 毎回違う向きへ駆け出す。作者の指摘 2026年10月25日）
    const jitter = st.spreadDegrees > 0 ? ((world.rng.next() - 0.5) * st.spreadDegrees * Math.PI) / 180 : 0;
    const a = Math.atan2(fy, fx) + world.rules.moves[pm.move]!.bounceAngle + jitter + (k / st.count) * Math.PI * 2;
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_BOUNCE, x: p.x, y: p.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, ox: st.range, oy: st.range * 0.56 });
  }
}

/** trail（足あと）: 歩いていると、足元にしばらく残る当たり判定を置く */
function fireTrail(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  if (p.x === p.prevX && p.y === p.prevY) return;
  world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x: p.x, y: p.y });
}

/** cross（十字）: 向いている方向から等しい角度で count 方向へ同時に撃つ */
function fireCross(world: World, p: Player, pm: PlayerMove, st0: MoveStats): void {
  // メタルバースト: 受けた後の 1 回は強く、数が多い
  const release = pm.hurtCharge ? world.rules.moves[pm.move]!.hurtRelease : undefined;
  pm.hurtCharge = false;
  const st = release ? { ...st0, power: st0.power * release.powerMultiplier, count: st0.count + release.extraCount } : st0;
  const [fx, fy] = axisToUnit(p.facingX, p.facingY);
  const start = Math.atan2(fy, fx);
  const speed = scaledMoveStats(world, p, pm, st).speed;
  const snake = world.rules.moves[pm.move]!.snake;
  // 1 回に撃った弾のまとまり（メタルバースト。受けて返す 1 回は除く）。古いまとまり（弾が消えた後）は消す
  let group = 0;
  if (world.rules.moves[pm.move]!.oneHitPerCast && !release) {
    const keep = Math.round(st.durationSeconds / world.dt) + 2;
    for (const [id, g] of world.castGroups) if (world.tick - g.tick > keep) world.castGroups.delete(id);
    group = world.nextCastGroup++;
    world.castGroups.set(group, { tick: world.tick, hit: new Set() });
  }
  for (let k = 0; k < st.count; k++) {
    // うたう: 音符はランダムな向きへ
    // 前へ流す技（ヘドロウェーブ）: 向いている方を中心にした crossArc の中に、端から端まで等しく並べる
    const arc = world.rules.moves[pm.move]!.crossArc;
    const a = world.rules.moves[pm.move]!.crossRandom ? world.rng.next() * Math.PI * 2 : arc !== undefined ? start + (st.count === 1 ? 0 : (k / (st.count - 1) - 0.5) * arc) : start + (k / st.count) * Math.PI * 2;
    const jitter = world.rules.moves[pm.move]!.crossSpeedJitter;
    const sp = jitter ? speed * (1 - world.rng.next() * jitter) : speed;
    const vx = Math.cos(a) * sp;
    const vy = Math.sin(a) * sp;
    // 蛇行する弾（ヘドロウェーブ）: 出した場所を ox・oy に覚え、時間から位置を決める。隣どうしで揺れの向きを逆にする
    if (snake) {
      const omega = (Math.PI * 2 * speed) / snake.wavelength;
      world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_SNAKE, x: p.x, y: p.y, vx, vy, ox: p.x, oy: p.y, orbitRadius: snake.amplitude * (k % 2 === 0 ? 1 : -1), angularSpeed: omega });
      continue;
    }
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x: p.x, y: p.y, vx, vy, group });
  }
}

/**
 * scatter（水たまり）: 自分の周り range の中のランダムな場所に、しばらく残る当たり判定を置く。
 * scatterJitter があれば、数と大きさも使うたびにランダムにする（マグニチュード。大きいほど威力も大きい）。
 * scatterDelaySeconds があれば、出番を待つもの（stage 3）として置き、その秒数後に当たり判定が出る（つららおとし）
 */
function fireScatter(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const jit = world.rules.moves[pm.move]!.scatterJitter;
  const wait = world.rules.moves[pm.move]!.scatterDelaySeconds ?? 0;
  const b0 = base(world, p, pm, st);
  const count = jit ? Math.min(st.count, jit.countMin) + world.rng.int(Math.max(1, st.count - Math.min(st.count, jit.countMin) + 1)) : st.count;
  // 前の扇に置く（いわなだれ）: 向いている方向を中心にした scatterArc 度の中
  const arc = world.rules.moves[pm.move]!.scatterArc;
  const [fx, fy] = axisToUnit(p.facingX, p.facingY);
  // 敵の足元に置く（りゅうせいぐん）: range の中の敵からランダムに選ぶ。足りなければ残りはランダムな場所
  const targets = world.rules.moves[pm.move]!.scatterOnEnemies ? enemiesInRange(world, p.x, p.y, st.range) : [];
  // ボス・中ボスがいれば、その真上に大きな塊を 1 つ（つららおとし。置くのは今の場所で、追いかけない。07 の238章）
  const sb = world.rules.moves[pm.move]!.scatterBoss;
  if (sb && sb.move >= 0) {
    const boss = toughestBoss(world, p.x, p.y, sb.range);
    if (boss !== -1) {
      world.projectiles.add({
        ...b0,
        move: sb.move,
        motion: MOTION_LINEAR,
        x: world.enemies.x[boss]!,
        y: world.enemies.y[boss]!,
        vx: 0,
        vy: 0,
        radius: b0.radius * sb.sizeMultiplier,
        damage: b0.damage * sb.powerMultiplier,
        ...(wait > 0 ? { life: wait, stage: 3, armLife: st.durationSeconds } : {}),
      });
    }
  }
  for (let k = 0; k < count; k++) {
    if (targets.length > 0) {
      const i = targets.splice(world.rng.int(targets.length), 1)[0]!;
      world.projectiles.add({ ...b0, motion: MOTION_LINEAR, x: world.enemies.x[i]!, y: world.enemies.y[i]!, vx: 0, vy: 0, ...(wait > 0 ? { life: wait, stage: 3, armLife: st.durationSeconds } : {}) });
      continue;
    }
    const a = arc ? Math.atan2(fy, fx) + (world.rng.next() - 0.5) * ((arc * Math.PI) / 180) : world.rng.next() * Math.PI * 2;
    const r = st.range * (0.3 + world.rng.next() * 0.7);
    // speed があれば、置いた場所からランダムな向きへゆっくり動く
    const b = world.rng.next() * Math.PI * 2;
    const radius = jit ? b0.radius * (jit.sizeMin + world.rng.next() * (jit.sizeMax - jit.sizeMin)) : b0.radius;
    world.projectiles.add({
      ...b0,
      radius,
      // 大きさがランダムなもの（マグニチュード）は、大きい揺れほど強い
      ...(jit ? { damage: b0.damage * (radius / b0.radius) } : {}),
      motion: MOTION_LINEAR,
      x: p.x + Math.cos(a) * r,
      y: p.y + Math.sin(a) * r,
      vx: Math.cos(b) * st.speed,
      vy: Math.sin(b) * st.speed,
      ...(wait > 0 ? { life: wait, stage: 3, armLife: st.durationSeconds } : {}),
    });
  }
}

/**
 * eruption（爆炎の柱）: 自分を中心に count 方向へ、円の柱を段に分けて外へ向かって順に出す（ブラストバーン。作者の決定 2026年10月23日）。
 * 段 k（0 から）は、距離 range × (k + 1) / 段の数、半径 size × (1 + sizeGrowth × k)、interval × k 秒遅れて現れ、duration の間残る。
 * 遅れて現れる柱は、出番を待つもの（stage 3）として置き、待つ間は見えず当たらない
 */
function fireEruption(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const def = world.rules.moves[pm.move]!;
  const er = def.eruption ?? { stages: 3, sizeGrowth: 0.25 };
  const sc = scaledMoveStats(world, p, pm, st);
  const [fx, fy] = axisToUnit(p.facingX, p.facingY);
  const a0 = Math.atan2(fy, fx);
  // 一番近い敵の足元にも柱を立て、十字の柱はその敵に当てない（ブラストバーン: どの距離でも 1 本ぶん当たり、ボスに全部は重ならない。伝説が同じ技を出すときは使わない。07 の235章）
  const near = er.targetPillarPower && p.id < CASTER_ID_BASE ? nearestEnemy(world, p.x, p.y, st.range) : -1;
  const avoid = near !== -1 ? { avoid: world.enemies.id[near]! } : {};
  if (near !== -1) world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x: world.enemies.x[near]!, y: world.enemies.y[near]!, radius: sc.size, damage: sc.power * er.targetPillarPower! });
  for (let k = 0; k < er.stages; k++) {
    const d = (st.range * (k + 1)) / er.stages;
    const radius = sc.size * (1 + er.sizeGrowth * k);
    const wait = st.intervalSeconds * k;
    for (let j = 0; j < st.count; j++) {
      const a = a0 + (j / st.count) * Math.PI * 2;
      const x = p.x + Math.cos(a) * d;
      const y = p.y + Math.sin(a) * d;
      if (wait <= 0) world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x, y, radius, ...avoid });
      else world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x, y, radius, life: wait, stage: 3, armLife: st.durationSeconds, ...avoid });
    }
  }
}

/**
 * spin（回転）: 自分のまわりに、開き arcDegrees の扇形を count 枚、等しい角度で出す。使うたびに arcDegrees ずつ時計回りへずらす
 * （画面は y が下なので、角度を足すと時計回り）。再使用が短いほど速く回って見える（こうそくスピン。作者の決定 2026年10月23日）
 */
function fireSpin(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const sc = scaledMoveStats(world, p, pm, st);
  const [fx, fy] = axisToUnit(p.facingX, p.facingY);
  const step = (Math.max(1, st.arcDegrees) * Math.PI) / 180;
  const start = Math.atan2(fy, fx) + (pm.spinStep ?? 0) * step;
  pm.spinStep = ((pm.spinStep ?? 0) + 1) % 360;
  const half = Math.min(Math.PI, step / 2);
  const n = Math.max(1, st.count);
  for (let k = 0; k < n; k++) {
    const a = start + (k / n) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_FOLLOW, x: p.x, y: p.y, radius: st.range + sc.size, shape: SHAPE_SECTOR, length: half, dirX: dx, dirY: dy, vx: dx, vy: dy });
  }
}

/**
 * heal（回復）: 最大 HP の healPct % を回復し、guardPct があれば duration の間、受けるダメージを減らす（なまける・ドわすれ）。
 * 見た目だけの円（当たらない。stage 2）を自分に付けて出す
 */
function fireHeal(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  // 回復の円（つきのひかり）: 出ている間、中のプレイヤーを毎秒回復する（health.ts の regenerate）
  const zoneDef = world.rules.moves[pm.move]!;
  // しんぴのまもり: 自分に付いて動く膜。中のプレイヤー（仲間も）は状態異常にならない（stage.ts の hitLocal）
  if (zoneDef.healZone) world.healZones.push({ x: p.x, y: p.y, radius: st.size, ticks: Math.round(st.durationSeconds / world.dt), pct: st.healPct, ...(zoneDef.statusGuard ? { guard: true, follow: p.id } : {}) });
  else healPlayer(world, p.id, (p.maxHp * st.healPct) / 100);
  // いやしのねがい: 味方を回復する（HP は本人のブラウザで管理するので、どのブラウザでも自分のプレイヤーだけを回復する）
  const ally = world.rules.moves[pm.move]!.allyHealPct;
  if (ally) for (const q of world.players) if (q.id !== p.id) healPlayer(world, q.id, (q.maxHp * ally) / 100);
  // めいそう: 重ねる数が 1 つ増え、持続が戻る（07 の307章）
  const calm = zoneDef.calmMind;
  if (calm) {
    const live = p.calm && world.tick < p.calm.untilTick ? p.calm.stacks : 0;
    p.calm = { stacks: Math.min(calm.maxStacks, live + 1), untilTick: world.tick + Math.round(st.durationSeconds / world.dt) };
  }
  if (st.guardPct > 0) {
    p.guardPct = st.guardPct;
    p.guardUntilTick = world.tick + Math.round(st.durationSeconds / world.dt);
  }
  world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_FOLLOW, x: p.x, y: p.y, damage: 0, stage: 2, fxIndex: -1 });
}

/** spiral（うず）: 自分を中心に count 個を等しい角度に並べ、回りながら duration の間に range まで広がる（はなびらのまい） */
function fireSpiral(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const [fx, fy] = axisToUnit(p.facingX, p.facingY);
  const a0 = Math.atan2(fy, fx);
  const n = Math.max(1, st.count);
  // 回る速さは技の curve（度/秒）。無ければ 1 秒で半周
  const turn = world.rules.moves[pm.move]!.curve || Math.PI;
  for (let k = 0; k < n; k++) {
    const a = a0 + (k / n) * Math.PI * 2;
    world.projectiles.add({
      ...base(world, p, pm, st),
      motion: MOTION_SPIRAL,
      x: p.x + Math.cos(a) * 16,
      y: p.y + Math.sin(a) * 16,
      angle: a,
      angularSpeed: turn,
      orbitRadius: 16,
      ox: Math.max(0, st.range - 16) / st.durationSeconds,
      // うずの中心が前へ進む技（はなびらのまい）は、進む速さを vx・vy に覚える（うずでは使っていない欄）
      vx: fx * (world.rules.moves[pm.move]!.spiralDrift ?? 0),
      vy: fy * (world.rules.moves[pm.move]!.spiralDrift ?? 0),
    });
  }
}

/** sweep（往復するなぎ払い）: 向いている方向を中心に、細い扇形を spreadDegrees の幅で行って戻る（おうふくビンタ） */
function fireSweep(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const sc = scaledMoveStats(world, p, pm, st);
  const def = world.rules.moves[pm.move]!;
  // 向きをランダムに選ぶ技（まわしげり）は、近くのランダムな向きへ払う
  const [fx, fy] = def.randomAim ? ((r: number): [number, number] => [Math.cos(r), Math.sin(r)])(world.rng.next() * Math.PI * 2) : axisToUnit(p.facingX, p.facingY);
  if (def.body) world.events.push({ type: 'bodyAttack', playerId: p.id, dirX: fx, dirY: fy, distance: def.body.lungeDistance, afterimages: def.body.afterimages });
  const half = Math.min(Math.PI, (st.arcDegrees * Math.PI) / 360);
  // 数が増えたら払う幅を広げる（07 の163章。本数は増やさない）
  const spread = st.spreadDegrees * (1 + (world.rules.combat.countWidenPct / 100) * Math.max(0, st.count - 1));
  const amp = (Math.min(360, spread) * Math.PI) / 360;
  const center = Math.atan2(fy, fx);
  if (def.sweepClap) {
    // ねこだまし: 左右の端から1つずつ正面へ払い、正面で合わせる（両手でパチン。07 の141章）。
    // 片道の払い（orbitRadius 1）は angle − A から angle + A へ動くので、端 ±amp から正面 0 へ動くよう angle と A を半分ずらす。
    // 片手はそれぞれの側を払うので、威力はそのまま（正面で合わさる所だけ両手が当たる）
    for (const s of [1, -1]) {
      world.projectiles.add({
        ...base(world, p, pm, st),
        motion: MOTION_SWEEP,
        x: p.x,
        y: p.y,
        radius: st.range + sc.size,
        shape: SHAPE_SECTOR,
        length: half,
        angle: center - (s * amp) / 2,
        angularSpeed: (s * amp) / 2,
        dirX: Math.cos(center - s * amp),
        dirY: Math.sin(center - s * amp),
        orbitRadius: 1,
        hitIntervalTicks: 0,
      });
    }
    return;
  }
  world.projectiles.add({
    ...base(world, p, pm, st),
    motion: MOTION_SWEEP,
    x: p.x,
    y: p.y,
    radius: st.range + sc.size,
    shape: SHAPE_SECTOR,
    length: half,
    angle: Math.atan2(fy, fx),
    angularSpeed: def.sweepReverse ? -amp : amp,
    dirX: Math.cos(Math.atan2(fy, fx) - (def.sweepReverse ? -amp : amp)),
    dirY: Math.sin(Math.atan2(fy, fx) - (def.sweepReverse ? -amp : amp)),
    // 行きと戻りの両方で当たる。片道だけ（はたく）は orbitRadius 1 の印を付け、同じ敵には1回
    ...(def.sweepOnce ? { orbitRadius: 1, hitIntervalTicks: 0 } : { hitIntervalTicks: Math.max(1, Math.round(st.durationSeconds / 2 / world.dt)) }),
  });
}

/**
 * pulse（広がって縮む輪）: 自分を中心に、厚さ size の輪が range まで広がってから縮む（スパーク・ワイルドボルト。作者の決定 2026年10月25日）。
 * count 2 以上は interval ごとに続けて出す（遅れる輪は出番を待つもの stage 3）
 */
function firePulse(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  const band = scaledMoveStats(world, p, pm, st).size;
  const outer = Math.max(band + 1, st.range);
  for (let k = 0; k < Math.max(1, st.count); k++) {
    const wait = st.intervalSeconds * k;
    world.projectiles.add({
      ...base(world, p, pm, st),
      motion: MOTION_PULSE,
      x: p.x,
      y: p.y,
      radius: band,
      band,
      ox: band,
      orbitRadius: outer,
      ...(wait > 0 ? { life: wait, stage: 3, armLife: st.durationSeconds } : {}),
    });
  }
}

/**
 * weather（天気）: duration の間、自分の周り半径 size（画面くらい）の敵すべてに、当たり直しの間隔ごとに当たる
 * （こなゆき・ふぶき。作者の決定 2026年10月25日）。持ち主に付いていく大きな円で、見た目は画面に降る雪（範囲は塗らない）
 */
function fireWeather(world: World, p: Player, pm: PlayerMove, st: MoveStats): void {
  // あまごい: 出ている間、みずの技の威力を上げる
  const rain = world.rules.moves[pm.move]!.rainBoost;
  if (rain) p.rain = { type: rain.type, pct: rain.pct, untilTick: world.tick + Math.round(st.durationSeconds / world.dt) };
  world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_FOLLOW, x: p.x, y: p.y });
}

/** nova: 自分を中心に、大きさ size から range まで広がる輪 */
function fireNova(world: World, p: Player, pm: PlayerMove, st0: MoveStats): void {
  // マグニチュード: 使うたびに強さ（4〜10）を引き、7 を 1 として威力と届く距離に掛ける（07 の152章）
  const mag = world.rules.moves[pm.move]!.magnitude;
  const k = mag ? (mag.min + world.rng.next() * (mag.max - mag.min)) / 7 : 1;
  const st = k === 1 ? st0 : { ...st0, power: st0.power * k, range: st0.range * k };
  const sc = scaledMoveStats(world, p, pm, st);
  // 外へ進む攻撃なら、中が空いた帯（厚さ band）として広がる
  const band = reachBand(world, pm.move, st.range);
  const start = band > 0 ? band : sc.size;
  const growth = Math.max(0, (st.range - start) / st.durationSeconds);
  // 技の向きへ押す輪（サイコキネシス）は、向いている方向を覚える
  const [fx, fy] = world.rules.moves[pm.move]!.knockbackAlongFacing ? axisToUnit(p.facingX, p.facingY) : [0, 0];
  // 震源（フライゴンの じしん）: 届く範囲のボス・中ボス、いなければ敵が一番多い所。輪はそこに残る
  if (world.rules.moves[pm.move]!.epicenter) {
    const e = world.enemies;
    const t = toughestBoss(world, p.x, p.y, st0.range);
    const c = t !== -1 ? t : crowdCenter(world, p, st0.range, st.range * 0.5);
    if (c === -1) return;
    for (let k = 0; k < st.count; k++) {
      const j = world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x: e.x[c]!, y: e.y[c]!, radius: start, band, growth, life: st.durationSeconds * (1 + k * 0.6), dirX: fx, dirY: fy });
      // 震源から走る地割れ（spawn の効き方）は 1 回だけ
      if (k > 0 && j >= 0) world.projectiles.noFx[j] = 1;
    }
    return;
  }
  for (let k = 0; k < st.count; k++) {
    world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_FOLLOW, x: p.x, y: p.y, radius: start, band, growth, life: st.durationSeconds * (1 + k * 0.6), dirX: fx, dirY: fy });
  }
}

/** 外へ進む攻撃（sweep）の帯の厚さ。届く距離 reach に対する割合から。外へ進まない技は 0 */
export function reachBand(world: World, move: number, reach: number): number {
  const sweep = world.rules.moves[move]?.sweep ?? 0;
  return sweep > 0 ? Math.max(1, reach * sweep) : 0;
}

/** 扇の中心から (dx, dy) にある半径 r の敵が、向き (fx, fy)・片側の開き half の扇の角度に入るか（距離は別に確かめる） */
function inSector(dx: number, dy: number, r: number, fx: number, fy: number, half: number): boolean {
  if (half >= Math.PI) return true;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= r) return true;
  const cos = (dx * fx + dy * fy) / d;
  const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
  // 敵の大きさの分だけ、角度の判定をゆるめる
  return angle <= half + Math.asin(Math.min(1, r / d));
}

/** 根元から (dx, dy) にある半径 r の敵が、向き (fx, fy) に沿って from〜to・片側の幅 half の前方の長方形に重なるか（キバの技） */
export function inBox(dx: number, dy: number, r: number, fx: number, fy: number, from: number, to: number, half: number): boolean {
  const along = dx * fx + dy * fy;
  const side = Math.abs(dx * -fy + dy * fx);
  return along >= from - r && along <= to + r && side <= half + r;
}

/** 点 (px, py) と、始点 (x, y)・向き (dx, dy)・長さ len の線分との距離の2乗 */
function segmentDistance2(px: number, py: number, x: number, y: number, dx: number, dy: number, len: number): number {
  const t = Math.max(0, Math.min(len, (px - x) * dx + (py - y) * dy));
  const cx = x + dx * t - px;
  const cy = y + dy * t - py;
  return cx * cx + cy * cy;
}

/**
 * 当たり判定を動かし、敵に当たったらダメージを与える。HP が 0 以下になった敵の撃破を記録する。
 * 同じ敵には、当たり直しの間隔（無ければ1回だけ）を空けないと当たらない。貫通可能数を使い切ったら消える。
 * 当たり判定の位置は描画と自分の命中判定にだけ使うので、三角関数を使ってよい（ほかのブラウザとそろえる必要がない）。
 */
export function moveProjectiles(world: World): void {
  const { projectiles: pr, enemies: e, enemyHash, scratch, hitScratch } = world;
  let maxEnemyRadius = 0;
  for (const k of world.rules.enemies.kinds) maxEnemyRadius = Math.max(maxEnemyRadius, k.radius);
  // 末尾から回す（removeAt で末尾の要素が手前に来ても、処理済みなので問題ない）
  for (let i = pr.count - 1; i >= 0; i--) {
    pr.prevX[i] = pr.x[i]!;
    pr.prevY[i] = pr.y[i]!;
    // 出番を待つもの（stage 3）: 時間が来たら、技そのものとして現れる（見えず当たらないまま待つ）
    if (pr.stage[i] === 3) {
      pr.life[i]! -= world.dt;
      if (pr.life[i]! <= 0) {
        pr.stage[i] = pr.armStage[i]!;
        pr.life[i] = pr.maxLife[i] = pr.armLife[i]!;
        // 自分の所へ戻る線（ボルトチェンジ）: 現れるときの自分の位置へ向け直す
        if (pr.orbitRadius[i] === -1 && pr.shape[i] === SHAPE_LINE) {
          const o = world.players.find((q) => q.id === pr.owner[i]);
          if (o) {
            const len = Math.hypot(o.x - pr.x[i]!, o.y - pr.y[i]!) || 1;
            pr.length[i] = len;
            pr.dirX[i] = (o.x - pr.x[i]!) / len;
            pr.dirY[i] = (o.y - pr.y[i]!) / len;
          }
        }
        // 効き方から出た、遅れて伸びる亀裂（じわれ）は、1本ずつ光らせない
        if (pr.stage[i] === 0) world.events.push({ type: 'projectileHit', x: pr.x[i]!, y: pr.y[i]!, owner: pr.owner[i]!, move: pr.move[i]! });
        fireSpawnEffects(world, i, i + 1);
      }
      continue;
    }
    const owner = world.players.find((p) => p.id === pr.owner[i]) ?? casterOf(world, pr.owner[i]!);
    const motion = pr.motion[i]!;
    if (motion === MOTION_LINEAR) {
      // 曲がる弾（angularSpeed）は速度の向きを回す。広がる輪（growth）は半径を広げる
      if (pr.angularSpeed[i] !== 0) {
        const c = Math.cos(pr.angularSpeed[i]! * world.dt);
        const s = Math.sin(pr.angularSpeed[i]! * world.dt);
        const vx = pr.vx[i]!;
        pr.vx[i] = vx * c - pr.vy[i]! * s;
        pr.vy[i] = vx * s + pr.vy[i]! * c;
      }
      pr.radius[i]! += pr.growth[i]! * world.dt;
      pr.x[i]! += pr.vx[i]! * world.dt;
      pr.y[i]! += pr.vy[i]! * world.dt;
    } else if (motion === MOTION_BOOMERANG) {
      // 出したときの速度 (ox, oy) から、残り時間の半分で止まり、その後は戻ってくる
      const k = 1 - 2 * (1 - pr.life[i]! / pr.maxLife[i]!);
      pr.x[i]! += pr.ox[i]! * k * world.dt;
      pr.y[i]! += pr.oy[i]! * k * world.dt;
    } else if (motion === MOTION_LOB) {
      pr.vy[i]! += pr.angularSpeed[i]! * world.dt;
      pr.x[i]! += pr.vx[i]! * world.dt;
      pr.y[i]! += pr.vy[i]! * world.dt;
    } else if (motion === MOTION_BOUNCE) {
      pr.x[i]! += pr.vx[i]! * world.dt;
      pr.y[i]! += pr.vy[i]! * world.dt;
      // 持ち主のまわりの枠の端で跳ね返る（持ち主がいなければ、そのまま飛ぶ）
      if (owner) {
        if ((pr.x[i]! > owner.x + pr.ox[i]! && pr.vx[i]! > 0) || (pr.x[i]! < owner.x - pr.ox[i]! && pr.vx[i]! < 0)) pr.vx[i] = -pr.vx[i]!;
        if ((pr.y[i]! > owner.y + pr.oy[i]! && pr.vy[i]! > 0) || (pr.y[i]! < owner.y - pr.oy[i]! && pr.vy[i]! < 0)) pr.vy[i] = -pr.vy[i]!;
      }
    } else if (motion === MOTION_SNAKE) {
      const [dx, dy] = snakeOffset(pr.vx[i]!, pr.vy[i]!, pr.orbitRadius[i]!, pr.angularSpeed[i]!, pr.maxLife[i]! - pr.life[i]! + world.dt);
      pr.x[i] = pr.ox[i]! + dx;
      pr.y[i] = pr.oy[i]! + dy;
    } else if (motion === MOTION_HOMING) {
      // まだ当たっていない一番近い敵を追う（貫通する弾は、当たった敵の次へ進む。前は当たった敵を追い続けて残っていた）。
      // 狙った敵が決まっている弾（せいなるほのお）は、その敵が残っている間はその敵を追う
      // 追う弾は狙いを決めて追い、倒れた・貫通して当たり済みになったら、倒れる見込みの敵を飛ばして狙い直す（07 の248章）。
      // HP の一番高い敵を狙う弾（せいなるほのお）は、その敵が残っている間は当たった後も追い続ける
      const locked = pr.target[i]! > 0 ? findEnemyIndex(world, pr.target[i]! - 1) : -1;
      const keep = locked !== -1 && e.hp[locked]! > 0 && (world.rules.moves[pr.move[i]!]!.aimStrongest || !pr.isBlocked(i, pr.target[i]! - 1, world.tick));
      let t = keep ? locked : -1;
      if (!keep) {
        t = pr.stage[i] === 0 ? pickHomingTarget(world, i, pr.owner[i]!, pr.move[i]!, pr.x[i]!, pr.y[i]!, 300) : nearestUnhitEnemy(world, i, 300);
        pr.target[i] = t !== -1 ? e.id[t]! + 1 : 0;
      }
      if (t !== -1) {
        const dx = e.x[t]! - pr.x[i]!;
        const dy = e.y[t]! - pr.y[i]!;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const sp = Math.sqrt(pr.vx[i]! * pr.vx[i]! + pr.vy[i]! * pr.vy[i]!);
        pr.vx[i] = (dx / d) * sp;
        pr.vy[i] = (dy / d) * sp;
      }
      pr.x[i]! += pr.vx[i]! * world.dt;
      pr.y[i]! += pr.vy[i]! * world.dt;
    } else if (!owner) {
      pr.removeAt(i);
      continue;
    } else if (motion === MOTION_FOLLOW) {
      pr.x[i] = owner.x + pr.ox[i]!;
      pr.y[i] = owner.y + pr.oy[i]!;
      pr.radius[i]! += pr.growth[i]! * world.dt;
      // 向いている方向を追う扇（かえんほうしゃ）・前の長方形（なみのりの波。07 の149章）
      const follow = world.rules.moves[pr.move[i]!]!.followFacing;
      if (follow && (pr.shape[i] === SHAPE_SECTOR || pr.shape[i] === SHAPE_BOX) && pr.stage[i] === 0) {
        const [fx, fy] = axisToUnit(owner.facingX, owner.facingY);
        const cur = Math.atan2(pr.dirY[i]!, pr.dirX[i]!);
        // 左右へ出す扇（ハイパーボイス）は、向いている方向に直角な向きのうち、今の向きに近い方を追う
        const side = world.rules.moves[pr.move[i]!]!.sideways ? (pr.dirX[i]! * -fy + pr.dirY[i]! * fx >= 0 ? 1 : -1) : 0;
        let diff = (side ? Math.atan2(fx * side, -fy * side) : Math.atan2(fy, fx)) - cur;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const turn = ((follow * Math.PI) / 180) * world.dt;
        const a = cur + Math.max(-turn, Math.min(turn, diff));
        pr.dirX[i] = pr.vx[i] = Math.cos(a);
        pr.dirY[i] = pr.vy[i] = Math.sin(a);
      }
      // 回り続ける扇（ハイパーボイス: 左右の扇が決まった速さでぐるりと回る。07 の141章）
      const spin = world.rules.moves[pr.move[i]!]!.spinDegPerSec;
      if (spin && pr.shape[i] === SHAPE_SECTOR && pr.stage[i] === 0) {
        const a = Math.atan2(pr.dirY[i]!, pr.dirX[i]!) + ((spin * Math.PI) / 180) * world.dt;
        pr.dirX[i] = pr.vx[i] = Math.cos(a);
        pr.dirY[i] = pr.vy[i] = Math.sin(a);
      }
    } else if (motion === MOTION_SPIRAL) {
      pr.angle[i]! += pr.angularSpeed[i]! * world.dt;
      pr.orbitRadius[i]! += pr.ox[i]! * world.dt;
      const age = pr.maxLife[i]! - pr.life[i]!;
      pr.x[i] = owner.x + pr.vx[i]! * age + Math.cos(pr.angle[i]!) * pr.orbitRadius[i]!;
      pr.y[i] = owner.y + pr.vy[i]! * age + Math.sin(pr.angle[i]!) * pr.orbitRadius[i]!;
    } else if (motion === MOTION_ORBIT) {
      pr.angle[i]! += pr.angularSpeed[i]! * world.dt;
      pr.x[i] = owner.x + Math.cos(pr.angle[i]!) * pr.orbitRadius[i]!;
      pr.y[i] = owner.y + Math.sin(pr.angle[i]!) * pr.orbitRadius[i]!;
    } else if (motion === MOTION_STREAM) {
      stepStream(world, i, owner);
    } else if (motion === MOTION_ATTACH) {
      // 結んだ敵に貼り付く（みちづれ）。その敵が倒れた・いなくなったら、次で終わる（end の効き方はその場で）
      const t = pr.target[i]! > 0 ? findEnemyIndex(world, pr.target[i]! - 1) : -1;
      if (t === -1 || e.hp[t]! <= 0) pr.life[i] = Math.min(pr.life[i]!, world.dt);
      else {
        pr.x[i] = e.x[t]!;
        pr.y[i] = e.y[t]!;
      }
    } else if (motion === MOTION_PULSE) {
      pr.x[i] = owner.x;
      pr.y[i] = owner.y;
      const t = Math.min(1, (pr.maxLife[i]! - pr.life[i]! + world.dt) / pr.maxLife[i]!);
      pr.radius[i] = pr.ox[i]! + (pr.orbitRadius[i]! - pr.ox[i]!) * Math.sin(Math.PI * t);
    } else if (motion === MOTION_SWEEP) {
      // 前半に片側の端からもう片側の端へ、後半に戻る（片道だけのもの orbitRadius 1 は、全体で片側の端からもう片側の端へ）
      pr.x[i] = owner.x;
      pr.y[i] = owner.y;
      const t = 1 - pr.life[i]! / pr.maxLife[i]!;
      const s = pr.orbitRadius[i] === 1 ? t : t < 0.5 ? t * 2 : 2 - t * 2;
      const a = pr.angle[i]! - pr.angularSpeed[i]! + 2 * pr.angularSpeed[i]! * s;
      pr.dirX[i] = Math.cos(a);
      pr.dirY[i] = Math.sin(a);
    }
    pr.life[i]! -= world.dt;
    if (pr.life[i]! <= 0) {
      expire(world, i);
      continue;
    }
    // 遅れて弾ける印と、敵に当たらない技（ミルクのみのびん）は当たらない
    if (pr.stage[i] === 2 || world.rules.moves[pr.move[i]!]!.harmless) continue;
    tickEveryEffects(world, i);
    // 障害物は技も遮る（飛んでいく技は当たると消える）。跳ね返る技（ボルテッカー）は枠の端で跳ね返り続けるので、障害物は通り抜ける
    if ((motion === MOTION_HOMING || motion === MOTION_BOOMERANG || motion === MOTION_LOB || motion === MOTION_SNAKE || (motion === MOTION_LINEAR && (pr.vx[i] !== 0 || pr.vy[i] !== 0))) && !world.rules.moves[pr.move[i]!]!.passObstacles && insideObstacle(world, pr.x[i]!, pr.y[i]!)) {
      world.events.push({ type: 'projectileHit', x: pr.x[i]!, y: pr.y[i]!, owner: pr.owner[i]!, move: pr.move[i]! });
      expire(world, i);
      continue;
    }
    // 伝説がプレイヤーと同じ技で出したもの（術者）: 敵には当たらず、自分のプレイヤーに当たる（自分のブラウザで決める）
    if (pr.owner[i]! >= CASTER_ID_BASE) {
      hitLocalPlayer(world, i);
      continue;
    }
    // 投げる技で「落ちた所でだけ当たる」もの（landOnly）: 飛んでいる途中は当たらない（07 の126章）
    if (motion === MOTION_LOB && pr.stage[i] === 0 && pr.life[i]! > LAND_WINDOW_SECONDS && world.rules.moves[pr.move[i]!]!.landOnly) continue;
    const x = pr.x[i]!;
    const y = pr.y[i]!;
    const line = pr.shape[i] === SHAPE_LINE;
    // 長方形は、根元から一番遠い角まで
    const box = pr.shape[i] === SHAPE_BOX;
    const boxDef = box ? world.rules.moves[pr.move[i]!]!.frontBox : undefined;
    const reach = (box ? Math.hypot(pr.radius[i]!, pr.length[i]!) : pr.radius[i]!) + maxEnemyRadius;
    const len = line ? pr.length[i]! : 0;
    const ex = x + pr.dirX[i]! * len;
    const ey = y + pr.dirY[i]! * len;
    const n = enemyHash.queryRect(Math.min(x, ex) - reach, Math.min(y, ey) - reach, Math.max(x, ex) + reach, Math.max(y, ey) + reach, scratch);
    // 重なっていて、今当たれる敵を集める
    let hits = 0;
    for (let k = 0; k < n; k++) {
      const j = scratch[k]!;
      if (e.hp[j]! <= 0 || pr.avoid[i] === e.id[j]! + 1 || pr.isBlocked(i, e.id[j]!, world.tick)) continue;
      const r = pr.radius[i]! + e.radius[j]!;
      const d2 = line
        ? segmentDistance2(e.x[j]!, e.y[j]!, x, y, pr.dirX[i]!, pr.dirY[i]!, len)
        : box
          ? 0
          : (e.x[j]! - x) * (e.x[j]! - x) + (e.y[j]! - y) * (e.y[j]! - y);
      if (d2 > r * r) continue;
      // 外へ進む帯: 帯より内側にいる敵には当たらない（もう通り過ぎた）
      const inner = pr.band[i]! > 0 ? pr.radius[i]! - pr.band[i]! - e.radius[j]! : 0;
      if (inner > 0 && d2 < inner * inner) continue;
      if (pr.shape[i] === SHAPE_SECTOR && !inSector(e.x[j]! - x, e.y[j]! - y, e.radius[j]!, pr.dirX[i]!, pr.dirY[i]!, pr.length[i]!)) continue;
      if (boxDef) {
        const b = boxOf(world, i);
        if (!inBox(e.x[j]! - x, e.y[j]! - y, e.radius[j]!, pr.dirX[i]!, pr.dirY[i]!, b.from, b.to, b.half)) continue;
      }
      hitScratch[hits++] = j;
    }
    if (hits === 0) continue;
    // 同じ更新で複数に重なったら id の小さい順に当てる（ハッシュの並び順に左右されないように）
    const candidates = hitScratch.subarray(0, hits).sort((a, b) => e.id[a]! - e.id[b]!);
    // 命中の扱い（03_network.md 3.3）:
    // - 自分の攻撃: ソロ・ホストはその場で HP を減らす。ゲストは命中をホストへ伝える（HP はホストが集計）
    // - 別のブラウザのプレイヤーの攻撃: 見た目だけ（命中の判定はそのプレイヤーのブラウザが行う）
    const ownerId = pr.owner[i]!;
    const local = ownerId === world.localPlayerId;
    const def = world.rules.moves[pr.move[i]!]!;
    const st = moveStatsOf(world, { move: pr.move[i]!, level: pr.level[i]! });
    let hitAny = false;
    let hitX = x;
    let hitY = y;
    let firstX = NaN;
    let firstY = NaN;
    let firstId = 0;
    for (let k = 0; k < candidates.length && pr.pierceLeft[i]! > 0; k++) {
      const j = candidates[k]!;
      // ハッシュの衝突で同じ敵が2回入っていることがある
      if (pr.isBlocked(i, e.id[j]!, world.tick)) continue;
      // 1 回に撃った弾のまとまり（メタルバースト）: ほかの弾がもう当てた敵には当たらない
      const grp = pr.group[i] ? world.castGroups.get(pr.group[i]!) : undefined;
      if (grp?.hit.has(e.id[j]!)) continue;
      grp?.hit.add(e.id[j]!);
      pr.recordHit(i, e.id[j]!, world.tick);
      // ふしぎなまもり（ヌケニン）: 弱点のタイプの技でなければ、すり抜ける（07 の188章）
      const guardKind = world.rules.enemies.kinds[e.kind[j]!];
      if (guardKind?.wonderGuard && !moveTypesOf(def).some((t) => typeFlags(world.rules.types, t, [], guardKind.types) & DMG_SUPER)) continue;
      pr.pierceLeft[i]!--;
      hitAny = true;
      // 続けて当てるほど強くなる技（エコーボイス）: 当たったことを、出した技に覚えておく（次に出すときに段が上がる）
      if (def.echo && pr.stage[i] === 0 && owner) {
        const epm = owner.moves.find((m) => m.move === pr.move[i]);
        if (epm) epm.echoHit = true;
      }
      if (Number.isNaN(firstX)) {
        firstX = e.x[j]!;
        firstY = e.y[j]!;
        firstId = e.id[j]!;
      }
      // 本体が当たった相手（end の効き方の avoidTarget）: 最初の相手。あとでボス・中ボスに当たったらそちら
      const bossHit = (world.rules.enemies.kinds[e.kind[j]!]?.rank ?? 'normal') !== 'normal';
      const firstStrike = pr.struck[i] === 0;
      if (pr.struck[i] === 0 || bossHit) pr.struck[i] = e.id[j]! + 1;
      // 反動の技（すてみタックル など）: その 1 回で最初に敵に当たったときに、自分が反動を受ける（本人のブラウザで。07 の269章）
      if (firstStrike && local && pr.stage[i] === 0 && def.hpCost?.onHit && owner) selfDamage(world, owner, (owner.maxHp * def.hpCost.pct) / 100);
      // 雑魚は貫通し、ボス・中ボスで止まる（ラスターカノン: そこで弾ける）
      if (bossHit && pr.stage[i] === 0 && def.stopOnBoss) pr.pierceLeft[i] = 0;
      // 途中の敵は貫通し、狙った敵で止まる（サイコブレイク: そこで弾ける。07 の305章）
      if (pr.stage[i] === 0 && def.stopOnTarget && pr.target[i] === e.id[j]! + 1) pr.pierceLeft[i] = 0;
      // 線・扇・外へ広がる輪は、当たった光を敵の所に出す（中心に出すと使ったポケモンの足元に重なって白い円に見える。07 の184章）
      if (line || pr.shape[i] === SHAPE_SECTOR || pr.band[i]! > 0) {
        hitX = e.x[j]!;
        hitY = e.y[j]!;
      }
      // 当たった敵ごとの効き方（かみなり: 落雷を受けた敵から電気が連鎖する）。見た目もそろうように、どのブラウザでも起こす
      // 遅れて爆発する印（みらいよち）: どのブラウザでも付け、時間が来たら付けたプレイヤーの技として爆発させる
      // ほろびのうた は雑魚だけに付く（ボスには効かない）
      if (pr.stage[i] === 0 && def.delayedBlast && e.markTicks[j] === 0 && (!def.delayedBlast.perish || (world.rules.enemies.kinds[e.kind[j]!]?.rank ?? 'normal') === 'normal')) {
        e.markTicks[j] = Math.max(1, Math.round(def.delayedBlast.seconds / world.dt));
        e.markDamage[j] = pr.damage[i]! * def.delayedBlast.powerMultiplier;
        e.markSize[j] = pr.radius[i]! * def.delayedBlast.sizeMultiplier;
        e.markMove[j] = pr.move[i]!;
        e.markBy[j] = ownerId;
      } else if (pr.stage[i] === 0 && def.delayedBlast?.stack && e.markTicks[j]! > 0 && e.markMove[j] === pr.move[i] && e.markBy[j] === ownerId) {
        // 重ねる印（サーナイトの みらいよち）: 威力を足す。時間は最初の印のまま
        e.markDamage[j] = e.markDamage[j]! + pr.damage[i]! * def.delayedBlast.powerMultiplier;
        e.markSize[j] = Math.max(e.markSize[j]!, pr.radius[i]! * def.delayedBlast.sizeMultiplier);
      }
      // しもやけ（フリーザー。07 の314章）: どのブラウザでも同じように重ね、フリーズドライ のとげが重ねきった相手に当たったら氷漬け
      const frozeSolid = def.frostStack || def.frostCombo ? frostOnHit(world, j, def, pr.stage[i]!, ownerId) : false;
      if (pr.stage[i] === 0 && !pr.noFx[i] && def.effects.some((fx) => fx.trigger === 'eachHit')) fireEffects(world, 'eachHit', fxSourceOf(world, i, e.x[j]!, e.y[j]!));
      // ころがる: 当たるたびに大きくなる（どのブラウザでも同じように）
      if (def.growOnHit) pr.radius[i] = Math.min(st.size * def.growOnHit.maxMultiplier, pr.radius[i]! + st.size * def.growOnHit.perHit);
      if (!local) continue;
      // ノックバックの向き: 直線は線の向き、それ以外は当たり判定から敵へ（重なっていれば進む向き）
      // 技の向きへ押す技（なみのり・サイコキネシス。07 の162章）は、自分の後ろの敵も前へ押す
      // 向きを持たない進む弾（だくりゅうの波。07 の274章）は、進む向きへ押す
      const along = !!def.knockbackAlongFacing;
      const moving = along && !line && pr.dirX[i] === 0 && pr.dirY[i] === 0;
      const kx = moving ? pr.vx[i]! : line || along ? pr.dirX[i]! : e.x[j]! - x || pr.vx[i]!;
      const ky = moving ? pr.vy[i]! : line || along ? pr.dirY[i]! : e.y[j]! - y || pr.vy[i]!;
      // 波に乗る技は、止まっていると押し出さない
      const idle = !!def.idleScale && ownerIdle(world, ownerId);
      // 効果（ノックバック・状態異常）は当てたプレイヤーの画面ですぐ付け、相手へは命中と一緒に送る
      let fx = rollHitEffect(world, st, kx, ky, idle ? 0 : pr.knockback[i]!, def.randomStatuses, (owner && abilityOf(world, owner)?.statusChanceMultiplier) || 1);
      // 押し出しの踏ん張り（引き寄せは数えない）
      const pushKb = Number.isNaN(pr.knockback[i]!) ? st.knockback : pr.knockback[i]!;
      if (fx.kbTicks > 0 && pushKb > 0) fx = knockbackFatigue(world, j, fx);
      if (frozeSolid) fx = { ...fx, status: world.statusKinds.findIndex((s) => s.id === 'freeze'), statusTicks: Math.max(1, Math.round(def.frostCombo!.freezeSeconds / world.dt)) };
      applyHitEffect(world, j, fx, ownerId);
      const kind = world.rules.enemies.kinds[e.kind[j]!];
      // 急所（クリティカットなど・技ごとの急所）の判定は、当てたプレイヤーのブラウザの乱数で行う
      const critPct = (owner?.mods.critChancePct ?? 0) + st.critChancePct;
      const crit = critPct > 0 && world.rng.next() * 100 < critPct;
      if (crit && local && owner) bumpRunStat(world, owner, 'crits');
      // 一撃（じわれ）: 雑魚だけ。当てたプレイヤーのブラウザの乱数で決め、倒しきる量を送る
      const normalEnemy = (kind?.rank ?? 'normal') === 'normal';
      const instakill = (st.instakillChance > 0 && normalEnemy && world.rng.next() < st.instakillChance);
      // たたりめ: 状態異常の敵へのダメージを上げる
      const statusBonus = st.statusBonusPct > 0 && e.hasAnyStatus(j) ? 1 + st.statusBonusPct / 100 : 1;
      // しおみず: HP が半分を切った敵へのダメージを上げる
      const lowHpBonus = def.lowHpBonus && e.hp[j]! <= (e.maxHp[j]! * def.lowHpBonus.thresholdPct) / 100 ? 1 + def.lowHpBonus.powerPct / 100 : 1;
      // ロックオンした相手へのダメージを上げる
      const lockOnBonus = owner && owner.lockOn === e.id[j]! + 1 && owner.mods.lockOnPct > 0 ? 1 + owner.mods.lockOnPct / 100 : 1;
      // つかんで投げる技（サイコキネシス）・聞かせる技（ほろびのうた）は、触れた時にはダメージを与えない（倒れると浮かない。投げた時・時間が来た時に効く）
      const amount = instakill
        ? INSTAKILL_DAMAGE
        : ((def.delayedBlast?.throw || def.delayedBlast?.perish) && pr.stage[i] === 0 ? 0 : 1) * pr.damage[i]! *
          Math.max(...moveTypesOf(def).map((t) => typeMultiplier(world.rules.types, world.rules.combat.typeMultipliers, t, owner?.types ?? [], kind?.types ?? []))) *
          (crit ? world.rules.combat.critMultiplier : 1) *
          statusBonus *
          lowHpBonus *
          lockOnBonus *
          (frozeSolid ? def.frostCombo!.multiplier : 1) *
          (idle ? def.idleScale!.power : 1);
      // ダメージの数字（設定でオンのときだけ。一撃は出さない）
      if (world.damageNumbers && !instakill && amount > 0) {
        const flags = typeFlags(world.rules.types, def.type, owner?.types ?? [], kind?.types ?? []) | (crit ? DMG_CRIT : 0);
        world.events.push({ type: 'damageNumber', enemyId: e.id[j]!, x: e.x[j]!, y: e.y[j]!, amount: amount * damageTakenMultiplier(world, j), flags });
      }
      // 吸収（ギガドレインなど）: 与えたダメージの一部を回復する
      if (st.lifestealPct > 0) healPlayer(world, ownerId, (amount * st.lifestealPct) / 100);
      // 倒したときの効き方（ぜったいれいど: 凍った敵が氷の破片を飛ばす）。倒せると見込んだら起こす
      if (pr.stage[i] === 0 && !pr.noFx[i] && e.hp[j]! > 0 && e.hp[j]! - amount * damageTakenMultiplier(world, j) <= 0 && def.effects.some((fx) => fx.trigger === 'kill')) fireEffects(world, 'kill', fxSourceOf(world, i, e.x[j]!, e.y[j]!));
      if (world.role === 'guest') {
        world.events.push({ type: 'damageDealt', enemyId: e.id[j]!, amount, by: ownerId, ...fx });
        // 雑魚は自分の画面でも HP を減らし、倒したと見込んだら撃破の知らせを待たずに先に消して見せる（HP はホストが決める）
        if ((kind?.rank ?? 'normal') === 'normal') {
          const before = e.hp[j]!;
          e.hp[j]! -= amount * damageTakenMultiplier(world, j);
          if (e.hp[j]! <= 0) {
            e.savedHp[j] = before;
            e.ghostTicks[j] = Math.max(1, Math.round(world.rules.netSmoothing.predictKillSeconds / world.dt));
          }
        }
        continue;
      }
      if (world.role === 'host') world.events.push({ type: 'enemyAffected', enemyId: e.id[j]!, by: ownerId, ...fx });
      noteLegendThreat(world, j, ownerId, amount);
      e.hp[j]! -= absorbBarrier(world, j, amount * damageTakenMultiplier(world, j));
      breakOnDamage(world, j);
      if (e.hp[j]! <= 0) {
        world.events.push({ type: 'enemyKilled', enemyId: e.id[j]!, kind: e.kind[j]!, by: ownerId });
        world.stats.kills++;
      }
    }
    if (hitAny) world.events.push({ type: 'projectileHit', x: hitX, y: hitY, owner: ownerId, move: pr.move[i]!, ...(pr.stage[i] !== 0 ? { fx: true as const } : {}) });
    // hit の効き方は、その当たり判定が初めて敵に当たったときに1回だけ（当たった敵の位置で）
    if (hitAny && pr.stage[i] === 0 && pr.hitFired[i] === 0 && !pr.noFx[i]) {
      pr.hitFired[i] = 1;
      fireEffects(world, 'hit', { ...fxSourceOf(world, i, firstX, firstY), hitEnemy: firstId });
    }
    if (pr.pierceLeft[i]! <= 0) expire(world, i);
  }
}

/** 術者（伝説がプレイヤーと同じ技を出すための見えないプレイヤー）の番号はここから（プレイヤーの番号と重ならない） */
export const CASTER_ID_BASE = 60000;

/** 術者を番号から探す（いなければ undefined） */
export function casterOf(world: World, id: number): Player | undefined {
  if (id < CASTER_ID_BASE) return undefined;
  for (const c of world.casters.values()) if (c.id === id) return c;
  return undefined;
}

/** 術者の技 i が、自分のプレイヤーに触れていれば当てる（同じ技は当たり直しの間隔ごと。無敵時間の間は当たらない） */
function hitLocalPlayer(world: World, i: number): void {
  const pr = world.projectiles;
  const me = world.players.find((p) => p.id === world.localPlayerId);
  if (!me || me.down || me.invincibleTicks > 0) return;
  const key = 4000000000 + me.id;
  if (pr.isBlocked(i, key, world.tick)) return;
  const x = pr.x[i]!;
  const y = pr.y[i]!;
  const r = pr.radius[i]! + me.radius;
  const line = pr.shape[i] === SHAPE_LINE;
  const d2 = line ? segmentDistance2(me.x, me.y, x, y, pr.dirX[i]!, pr.dirY[i]!, pr.length[i]!) : pr.shape[i] === SHAPE_BOX ? 0 : (me.x - x) ** 2 + (me.y - y) ** 2;
  if (d2 > r * r) return;
  const inner = pr.band[i]! > 0 ? pr.radius[i]! - pr.band[i]! - me.radius : 0;
  if (inner > 0 && d2 < inner * inner) return;
  if (pr.shape[i] === SHAPE_SECTOR && !inSector(me.x - x, me.y - y, me.radius, pr.dirX[i]!, pr.dirY[i]!, pr.length[i]!)) return;
  const boxDef = pr.shape[i] === SHAPE_BOX ? world.rules.moves[pr.move[i]!]!.frontBox : undefined;
  if (boxDef && !inBox(me.x - x, me.y - y, me.radius, pr.dirX[i]!, pr.dirY[i]!, pr.radius[i]! * boxDef.start, pr.radius[i]! * boxDef.end, pr.length[i]!)) return;
  pr.recordHit(i, key, world.tick);
  hurtPlayer(world, me, hazardDamage(world, pr.damage[i]!));
}

/**
 * 術者に、プレイヤーと同じ技を1回出させる（一度に出し終える出し方だけ。続けて撃つ出し方は1発ずつまとめて出す）。
 * count・spreadDegrees は上書き（カメックスのハイドロカノンを一周）
 */
export function fireCasterMove(world: World, caster: Player, move: number, level: number, over: { count?: number; spreadDegrees?: number; sweepDegreesPerSecond?: number; orbitRadius?: number; range?: number; power?: number } = {}): void {
  const def = world.rules.moves[move];
  if (!def) return;
  const pm: PlayerMove = { move, level, cooldown: 0, burstLeft: 0, burstTimer: 0 };
  const base0 = moveStatsOf(world, pm);
  const st: MoveStats = { ...base0, ...(over.count !== undefined ? { count: over.count } : {}), ...(over.spreadDegrees !== undefined ? { spreadDegrees: over.spreadDegrees } : {}), ...(over.range !== undefined ? { range: over.range } : {}), ...(over.power !== undefined ? { power: over.power } : {}) };
  const from = world.projectiles.count;
  if (BURST_PATTERNS.has(def.pattern)) {
    pm.burstLeft = st.count;
    while (pm.burstLeft > 0) {
      pm.burstTimer = 0;
      fireBurst(world, caster, pm, st);
    }
  } else if (def.pattern === 'stream') {
    // 流れ（ハイドロカノン）: 向いている方向へ出し続ける。sweepDegreesPerSecond なら向きを追わずに回し続ける（カメックス）
    fireStream(world, caster, pm, st);
    if (over.sweepDegreesPerSecond) for (let k = from; k < world.projectiles.count; k++) world.projectiles.ox[k] = (over.sweepDegreesPerSecond * Math.PI) / 180;
  } else {
    ONE_SHOT_FIRE[def.pattern]?.(world, caster, pm, st);
    // うずを広げずに、決まった距離で回す（色違いのフシギバナ: はなびらのまい。絵はそのまま）
    if (over.orbitRadius && def.pattern === 'spiral') {
      const pr = world.projectiles;
      for (let k = from; k < pr.count; k++) {
        pr.orbitRadius[k] = over.orbitRadius;
        pr.ox[k] = 0;
        pr.x[k] = caster.x + Math.cos(pr.angle[k]!) * over.orbitRadius;
        pr.y[k] = caster.y + Math.sin(pr.angle[k]!) * over.orbitRadius;
      }
    }
  }
  fireSpawnEffects(world, from, world.projectiles.count);
}

/** ほろびのうた の時間が来た雑魚を倒す（ゲストはホストへ伝え、自分の画面では先に消して見せる） */
function perishKill(world: World, i: number): void {
  const e = world.enemies;
  const by = e.markBy[i]!;
  if (world.role === 'guest') {
    world.events.push({ type: 'damageDealt', enemyId: e.id[i]!, amount: INSTAKILL_DAMAGE, by, kbx: 0, kby: 0, kbTicks: 0, status: -1, statusTicks: 0 });
    e.savedHp[i] = e.hp[i]!;
    e.hp[i] = 0;
    e.ghostTicks[i] = Math.max(1, Math.round(world.rules.netSmoothing.predictKillSeconds / world.dt));
    return;
  }
  e.hp[i] = 0;
  world.events.push({ type: 'enemyKilled', enemyId: e.id[i]!, kind: e.kind[i]!, by });
  world.stats.kills++;
}

/** 遅れて爆発する印（みらいよち）の時間を進め、時間が来たら、その敵の位置で付けたプレイヤーの技として爆発させる */
export function tickMarks(world: World): void {
  const e = world.enemies;
  // びりびり: 当たらないまま時間が経つと消える。エレキフィールドの中で重なる
  for (let i = 0; i < e.count; i++) if (e.shockTicks[i]! > 0 && --e.shockTicks[i]! === 0) e.shock[i] = 0;
  // しもやけ・氷漬け: 時間が来ると消える
  for (let i = 0; i < e.count; i++) if (e.frostTicks[i]! > 0 && --e.frostTicks[i]! === 0) e.frost[i] = 0;
  stepElectricField(world);
  stepZapBands(world);
  stepWetTornadoes(world);
  for (let i = 0; i < e.count; i++) {
    if (e.markTicks[i] === 0) continue;
    if (--e.markTicks[i]! > 0 || e.hp[i]! <= 0) continue;
    // ほろびのうた: 時間が来た雑魚が、音も爆発もなく倒れる。決めるのは歌ったプレイヤーのブラウザ（ほかの人には撃破の知らせで届く）
    if (world.rules.moves[e.markMove[i]!]?.delayedBlast?.perish) {
      if (e.markBy[i] === world.localPlayerId) perishKill(world, i);
      continue;
    }
    // つかんで投げる（サイコキネシス）: 雑魚は持ち主の向いている方へ飛び、飛ぶ敵に付いた当たり判定が通り道の敵に当たる。ボスは下の爆発を受ける
    const thrown = world.rules.moves[e.markMove[i]!]?.delayedBlast?.throw;
    const owner = thrown ? world.players.find((pl) => pl.id === e.markBy[i]) : undefined;
    if (thrown && owner && (world.rules.enemies.kinds[e.kind[i]!]?.rank ?? 'normal') === 'normal') {
      const [fx, fy] = axisToUnit(owner.facingX, owner.facingY);
      const ticks = Math.max(1, Math.round(thrown.seconds / world.dt));
      e.knockBack(i, fx * thrown.speed, fy * thrown.speed, ticks);
      // 飛ぶ敵に付いた当たり判定。投げられた敵自身には、落ちる時に当たる（飛ぶ前に倒れると投げられない）
      const bullet = world.projectiles.add({
        owner: e.markBy[i]!, move: e.markMove[i]!, level: 1, motion: MOTION_LINEAR, x: e.x[i]!, y: e.y[i]!, vx: fx * thrown.speed, vy: fy * thrown.speed, ox: 0, oy: 0,
        angle: 0, angularSpeed: 0, orbitRadius: 0, life: thrown.seconds, damage: e.markDamage[i]!, radius: e.radius[i]! * 1.4, pierce: Infinity,
        hitIntervalTicks: Math.max(1, ticks - 2), shape: SHAPE_CIRCLE, length: 0, dirX: fx, dirY: fy, growth: 0, stage: 1,
      });
      if (bullet >= 0) world.projectiles.recordHit(bullet, e.id[i]!, world.tick);
      continue;
    }
    world.projectiles.add({
      owner: e.markBy[i]!, move: e.markMove[i]!, level: 1, motion: MOTION_LINEAR, x: e.x[i]!, y: e.y[i]!, vx: 0, vy: 0, ox: 0, oy: 0,
      angle: 0, angularSpeed: 0, orbitRadius: 0, life: 0.25, damage: e.markDamage[i]!, radius: e.markSize[i]!, pierce: Infinity,
      hitIntervalTicks: 0, shape: SHAPE_CIRCLE, length: 0, dirX: 0, dirY: 0, growth: 0, stage: 1,
    });
    world.events.push({ type: 'projectileHit', x: e.x[i]!, y: e.y[i]!, owner: e.markBy[i]!, move: e.markMove[i]!, fx: true });
  }
}

/** 直線（始点・向き・長さ・太さ）に最初に触れる敵までの距離。いなければ長さ */
function firstEnemyAlong(world: World, x: number, y: number, dx: number, dy: number, len: number, width: number): number {
  const { enemies: e, enemyHash, scratch } = world;
  const ex = x + dx * len;
  const ey = y + dy * len;
  const n = enemyHash.queryRect(Math.min(x, ex) - width, Math.min(y, ey) - width, Math.max(x, ex) + width, Math.max(y, ey) + width, scratch);
  let best = len;
  for (let k = 0; k < n; k++) {
    const j = scratch[k]!;
    if (e.hp[j]! <= 0) continue;
    const t = (e.x[j]! - x) * dx + (e.y[j]! - y) * dy;
    if (t < 0 || t >= best) continue;
    const r = width + e.radius[j]!;
    if (segmentDistance2(e.x[j]!, e.y[j]!, x, y, dx, dy, len) <= r * r) best = t;
  }
  return best;
}

/** 出し続ける流れの1回分: 持ち主に付いていき、向いている方向へ回り、障害物の手前まで伸び、流れの先で爆発する */
function stepStream(world: World, i: number, owner: Player): void {
  const pr = world.projectiles;
  pr.x[i] = owner.x;
  pr.y[i] = owner.y;
  const cur = Math.atan2(pr.dirY[i]!, pr.dirX[i]!);
  // 回し続ける流れ（ox が回る速さ。カメックスのハイドロカノンを一周）
  if (pr.ox[i] !== 0) {
    const a = cur + pr.ox[i]! * world.dt;
    pr.dirX[i] = Math.cos(a);
    pr.dirY[i] = Math.sin(a);
    pr.length[i] = rayLengthToObstacle(world, owner.x, owner.y, pr.dirX[i]!, pr.dirY[i]!, pr.orbitRadius[i]!);
    return;
  }
  const [fx, fy] = axisToUnit(owner.facingX, owner.facingY);
  const want = Math.atan2(fy, fx) + pr.angle[i]!;
  // 近いほうの回り方で、決まった速さまで向きを変える
  let diff = want - cur;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const turn = pr.angularSpeed[i]! * world.dt;
  const a = cur + Math.max(-turn, Math.min(turn, diff));
  pr.dirX[i] = Math.cos(a);
  pr.dirY[i] = Math.sin(a);
  pr.length[i] = rayLengthToObstacle(world, owner.x, owner.y, pr.dirX[i]!, pr.dirY[i]!, pr.orbitRadius[i]!);
}

/** 当たり判定 i を元にした、効き方の元（位置は (x, y)） */
function fxSourceOf(world: World, i: number, x: number, y: number): FxSource {
  const pr = world.projectiles;
  const vlen = Math.sqrt(pr.vx[i]! * pr.vx[i]! + pr.vy[i]! * pr.vy[i]!);
  const line = pr.shape[i] === SHAPE_LINE;
  const dirX = line || vlen === 0 ? pr.dirX[i]! || 1 : pr.vx[i]! / vlen;
  const dirY = line || vlen === 0 ? pr.dirY[i]! : pr.vy[i]! / vlen;
  // 前の長方形（frontBox）は、その形も渡す（ブレイズキックの燃える道を長方形に重ねる）
  const box = pr.shape[i] === SHAPE_BOX ? boxOf(world, i) : undefined;
  return { owner: pr.owner[i]!, move: pr.move[i]!, level: pr.level[i]!, damage: pr.damage[i]!, size: pr.band[i]! > 0 && world.rules.moves[pr.move[i]!]!.knockbackAlongFacing ? pr.band[i]! : pr.radius[i]!, x, y, dirX, dirY, length: line ? pr.length[i]! : 0, serial: pr.serial[i]!, ...(box ? { box } : {}), ...(pr.avoid[i]! > 0 ? { avoid: pr.avoid[i]! - 1 } : {}) };
}

/** 前の長方形（frontBox）の当たり判定 i の形: 根元から向きに沿った始まり・終わり、片側の幅（ワールドの単位） */
export function boxOf(world: World, i: number): { from: number; to: number; half: number } {
  const pr = world.projectiles;
  const def = world.rules.moves[pr.move[i]!]!;
  const box = def.frontBox;
  // 波に乗る技（なみのり）: 持ち主が止まっていると波が小さい（07 の162章）
  const k = def.idleScale && ownerIdle(world, pr.owner[i]!) ? def.idleScale.size : 1;
  const reach = pr.radius[i]! * k;
  return { from: reach * (box?.start ?? 0), to: reach * (box?.end ?? 1), half: pr.length[i]! * k };
}

/** 持ち主が移動の入力をしていないか（波に乗る技。どのブラウザでも、届いた入力で同じに決まる） */
export function ownerIdle(world: World, id: number): boolean {
  const p = world.players.find((q) => q.id === id);
  return !!p && p.inputX === 0 && p.inputY === 0;
}

/**
 * 押し出しの踏ん張り（07 の162章）: 少し前に押し出された敵への押し出しは弱い。押し出されていなければ、これから踏ん張る。
 * 当てたプレイヤーのブラウザで決め、弱めた効果を相手へ送る
 */
export function knockbackFatigue(world: World, j: number, fx: HitEffect): HitEffect {
  const f = world.rules.combat.knockbackFatigue;
  const e = world.enemies;
  if (e.kbGuard[j]! > 0) return { ...fx, kbx: fx.kbx * f.multiplier, kby: fx.kby * f.multiplier };
  e.kbGuard[j] = Math.max(1, Math.round(f.seconds / world.dt));
  return fx;
}

/** 当たり判定 i を消す。技そのもの（段階 0）なら end の効き方、印（段階 2）なら遅れた爆発を起こす */
function expire(world: World, i: number): void {
  const pr = world.projectiles;
  if (pr.stage[i] === 0 && !pr.noFx[i]) fireEffects(world, 'end', { ...fxSourceOf(world, i, pr.x[i]!, pr.y[i]!), ...(pr.struck[i]! > 0 ? { hitEnemy: pr.struck[i]! - 1 } : {}) });
  else if (pr.stage[i] === 2) fireDelayedExplosion(world, pr.fxIndex[i]!, fxSourceOf(world, i, pr.x[i]!, pr.y[i]!));
  else if (pr.stage[i] === 1 && pr.fxIndex[i]! > 0) fireLanding(world, pr.fxIndex[i]!, fxSourceOf(world, i, pr.x[i]!, pr.y[i]!));
  pr.removeAt(i);
}

/** every の効き方: 残っている間、決まった間隔で起こす。流れは、流れが最初に当たる敵（いなければ流れの先）で */
function tickEveryEffects(world: World, i: number): void {
  const pr = world.projectiles;
  if (pr.stage[i] !== 0 || pr.noFx[i]) return;
  const every = world.rules.moves[pr.move[i]!]!.effects.find((fx) => fx.trigger === 'every');
  if (!every) return;
  pr.fxTimer[i]! += world.dt;
  const period = every.everySeconds ?? 0.5;
  if (pr.fxTimer[i]! < period) return;
  pr.fxTimer[i]! -= period;
  let x = pr.x[i]!;
  let y = pr.y[i]!;
  if (pr.motion[i] === MOTION_STREAM) {
    const along = firstEnemyAlong(world, x, y, pr.dirX[i]!, pr.dirY[i]!, pr.length[i]!, pr.radius[i]!);
    x += pr.dirX[i]! * along;
    y += pr.dirY[i]! * along;
  }
  const src = fxSourceOf(world, i, x, y);
  fireEffects(world, 'every', { ...src, length: pr.motion[i] === MOTION_STREAM ? 0 : src.length });
}

/**
 * 命中の効果を決める。ノックバックは (dirX, dirY) の向き。
 * 状態異常が付くかの判定は、当てたプレイヤーのブラウザの乱数で行う（03_network.md 3.2）。
 */
function rollHitEffect(world: World, st: MoveStats, dirX: number, dirY: number, knockback = NaN, randomStatuses: readonly number[] = [], chanceMultiplier = 1): HitEffect {
  let kbx = 0;
  let kby = 0;
  let kbTicks = 0;
  // 効き方の部品のノックバックの上書き（マイナスなら中心へ引き寄せる）
  const kb = Number.isNaN(knockback) ? st.knockback : knockback;
  if (kb !== 0 && st.knockbackSeconds > 0) {
    const len = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
    kbx = (dirX / len) * kb;
    kby = (dirY / len) * kb;
    kbTicks = Math.round(st.knockbackSeconds / world.dt);
  }
  let status = -1;
  let statusTicks = 0;
  if ((st.status >= 0 || randomStatuses.length > 0) && st.statusChance > 0 && world.rng.next() < st.statusChance * chanceMultiplier) {
    // トライアタック: やけど・こおり・まひ のどれか
    status = randomStatuses.length > 0 ? randomStatuses[world.rng.int(randomStatuses.length)]! : st.status;
    statusTicks = Math.round(st.statusSeconds / world.dt);
  }
  return { kbx, kby, kbTicks, status, statusTicks };
}

/** 伝説のマップの効果（ホウオウの日差し）・区間の天気（ホウエン）で、タイプ type の技の威力が変わる % */
function fieldTypePct(world: World, type: number): number {
  const pct = activeField(world)?.field.typePowerPct;
  if (!pct) return 0;
  return pct[world.rules.types.names[type] ?? ''] ?? 0;
}

/**
 * アクティブスキルの技（スイクン。07 の307章）: キーで使う技の、今のレベルの性能（持ち物の効果を掛ける。数の強化は回数に回すので足さない）
 */
export function skillMoveStats(world: World, p: Player, pm: PlayerMove): { st: MoveStats; sc: ReturnType<typeof scaledMoveStats> } {
  const st = moveStatsOf(world, pm);
  return { st, sc: scaledMoveStats(world, p, pm, st) };
}

/** 1 回に出したもののまとまり（同じ敵には 1 つだけ当たる）を作る */
function newCastGroup(world: World, keepSeconds: number): number {
  const keep = Math.round(keepSeconds / world.dt) + 2;
  for (const [id, g] of world.castGroups) if (world.tick - g.tick > keep) world.castGroups.delete(id);
  const group = world.nextCastGroup++;
  world.castGroups.set(group, { tick: world.tick, hit: new Set() });
  return group;
}

/**
 * なみのり（スイクン）: (x, y) から向き (dirX, dirY) へ、横に並べた count 個の波を進める（1 回で同じ敵には 1 回）。
 * 通った跡に水（同じ技の stage 1）を残す: 波が通る時に現れ（出番を待つもの）、waterSeconds 残る
 */
export function fireSurfWave(world: World, p: Player, pm: PlayerMove, x: number, y: number, dirX: number, dirY: number, cfg: { waterSeconds: number; waterSpacing: number; waterRows: number; waterPowerPct: number }): void {
  const { st, sc } = skillMoveStats(world, p, pm);
  const n = Math.max(1, st.count);
  const spacing = sc.size * 1.6;
  const speed = Math.max(1, sc.speed);
  const life = st.range / speed;
  const group = newCastGroup(world, life);
  const px = -dirY;
  const py = dirX;
  const b0 = base(world, p, pm, st);
  for (let k = 0; k < n; k++) {
    const off = (k - (n - 1) / 2) * spacing;
    world.projectiles.add({ ...b0, motion: MOTION_LINEAR, x: x + px * off + dirX * 20, y: y + py * off + dirY * 20, vx: dirX * speed, vy: dirY * speed, life, group, dirX, dirY });
  }
  if (cfg.waterSeconds <= 0) return;
  const width = spacing * (n - 1) + sc.size * 2;
  const rowSp = width / cfg.waterRows;
  for (let d = cfg.waterSpacing; d <= st.range; d += cfg.waterSpacing) {
    for (let r = 0; r < cfg.waterRows; r++) {
      const off = (r - (cfg.waterRows - 1) / 2) * rowSp;
      world.projectiles.add({
        ...b0,
        motion: MOTION_LINEAR,
        x: x + dirX * d + px * off,
        y: y + dirY * d + py * off,
        radius: rowSp * 0.62,
        damage: (sc.power * cfg.waterPowerPct) / 100,
        hitIntervalTicks: Math.round(0.6 / world.dt),
        knockback: 0,
        life: d / speed,
        stage: 3,
        armStage: 1,
        armLife: cfg.waterSeconds,
      });
    }
  }
}

/**
 * ぜったいれいど（スイクン）: 自分の なみのり の水（waterMove の stage 1 か、まだ現れていない水）が残っていれば、水を全部凍らせる
 * （freezeDelaySeconds 後に、水の所に 技の威力 × comboMultiplier。1 回で同じ敵には 1 回）。水が無ければ、射程の中で HP の一番高い敵の所
 * （いなければ向いている方）を凍らせる。返り値: 凍らせた水の数
 */
export function fireSheerCold(world: World, p: Player, pm: PlayerMove, dirX: number, dirY: number, waterMove: number, cfg: { comboMultiplier: number; freezeDelaySeconds: number }): number {
  const { st, sc } = skillMoveStats(world, p, pm);
  const group = newCastGroup(world, cfg.freezeDelaySeconds + st.durationSeconds);
  const b0 = base(world, p, pm, st);
  const pr = world.projectiles;
  let frozen = 0;
  const spots: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < pr.count; i++) {
    if (pr.owner[i] !== p.id || pr.move[i] !== waterMove || !(pr.stage[i] === 1 || (pr.stage[i] === 3 && pr.armStage[i] === 1))) continue;
    spots.push({ x: pr.x[i]!, y: pr.y[i]!, r: pr.radius[i]! });
    // 水は凍って消える（待っている水も、待つのをやめて消える）
    pr.stage[i] = 1;
    pr.life[i] = 0;
    frozen++;
  }
  for (const s of spots) {
    world.projectiles.add({ ...b0, motion: MOTION_LINEAR, x: s.x, y: s.y, radius: s.r * 1.15, damage: sc.power * cfg.comboMultiplier, group, life: cfg.freezeDelaySeconds, stage: 3, armStage: 1, armLife: st.durationSeconds });
  }
  if (frozen > 0) return frozen;
  const t = strongestEnemy(world, p, st.range);
  const x = t !== -1 ? world.enemies.x[t]! : p.x + dirX * st.range * 0.5;
  const y = t !== -1 ? world.enemies.y[t]! : p.y + dirY * st.range * 0.5;
  world.projectiles.add({ ...b0, motion: MOTION_LINEAR, x, y, group, life: cfg.freezeDelaySeconds, stage: 3, armStage: 0, armLife: st.durationSeconds });
  return 0;
}

/** ミラーコート（スイクン）: 鏡の破片を count 個、自分のまわりから HP の一番高い敵へ飛ばす（1 個の威力は 技の威力 × mult） */
export function fireMirrorShards(world: World, p: Player, pm: PlayerMove, count: number, mult: number, speed: number): void {
  const { st, sc } = skillMoveStats(world, p, pm);
  const t = strongestEnemy(world, p, st.range);
  const target = t !== -1 ? world.enemies.id[t]! : undefined;
  const b0 = base(world, p, pm, st);
  // 殻のまわりから、少しずつ遅れて次々に飛び出す（まとめて出すと輪のまま並んで飛ぶ）
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2 * 2.618;
    const r = 26 + ((k * 37) % 24);
    world.projectiles.add({
      ...b0,
      motion: MOTION_HOMING,
      x: p.x + Math.cos(a) * r,
      y: p.y - 14 + Math.sin(a) * r,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      damage: sc.power * mult,
      pierce: 1,
      ...(k > 0 ? { life: k * 0.035, stage: 3, armStage: 0, armLife: 2.4 } : { life: 2.4 }),
      ...(target !== undefined ? { target } : {}),
    });
  }
}

/** めいそう の重ねたとくしゅの威力（%） */
export function calmPowerPct(world: World, p: Player): number {
  if (!p.calm || world.tick >= p.calm.untilTick) return 0;
  let per = 0;
  for (const pm of p.moves) per = Math.max(per, world.rules.moves[pm.move]?.calmMind?.specialPowerPct ?? 0);
  return per * p.calm.stacks;
}

/**
 * しんそく（ライコウ。07 の309・310章）の稲妻の折れ線: 自分から向き (dirX, dirY) へ、全部で range の長さ。
 * 1 つ目の角は前の扇（±60°）の中の一番近い敵（いなければ前へ少し右）。そこから左右に交互に折れて稲妻の形に抜けていく
 * （折れる先の近くに敵がいれば、その敵を角にする）。角は count 個まで。固定マップの中に収める
 */
export function extremeSpeedPath(world: World, p: Player, pm: PlayerMove, dirX: number, dirY: number): { x: number; y: number }[] {
  const { st } = skillMoveStats(world, p, pm);
  const corners = Math.max(1, st.count);
  const pts = [{ x: p.x, y: p.y }];
  const e = world.enemies;
  const used = new Set<number>();
  const heading = Math.atan2(dirY, dirX);
  let left = st.range;
  let cx = p.x;
  let cy = p.y;
  // 1 つ目: 前の扇の中の一番近い敵
  let first = -1;
  let firstD = Infinity;
  for (const i of enemiesInRange(world, cx, cy, st.range * 0.6)) {
    if (e.hp[i]! <= 0) continue;
    const dx = e.x[i]! - cx;
    const dy = e.y[i]! - cy;
    const d = Math.hypot(dx, dy);
    if (d < 30 || (dx * dirX + dy * dirY) / d < 0.5) continue;
    if (d < firstD) {
      first = i;
      firstD = d;
    }
  }
  // 1 つ目の敵が向きより右にいれば、次は左へ折れる（交互）
  let side = 1;
  if (first !== -1) {
    used.add(first);
    const nx = e.x[first]!;
    const ny = e.y[first]!;
    side = (nx - cx) * -dirY + (ny - cy) * dirX > 0 ? -1 : 1;
    left -= Math.hypot(nx - cx, ny - cy);
    cx = nx;
    cy = ny;
    pts.push({ x: cx, y: cy });
  }
  for (let k = pts.length - 1; k < corners && left > 40; k++) {
    const seg = Math.min(left / (corners - k + 0.6), 150);
    const a = heading + side * 0.65;
    side = -side;
    let nx = cx + Math.cos(a) * seg;
    let ny = cy + Math.sin(a) * seg;
    // 折れる先の近く（半径 70）に敵がいれば、その敵を角にする
    let best = -1;
    let bestD = 70;
    for (const i of enemiesInRange(world, nx, ny, 70)) {
      if (used.has(i) || e.hp[i]! <= 0) continue;
      const d = Math.hypot(e.x[i]! - nx, e.y[i]! - ny);
      if (d < bestD && (e.x[i]! - cx) * dirX + (e.y[i]! - cy) * dirY > 20) {
        best = i;
        bestD = d;
      }
    }
    if (best !== -1) {
      used.add(best);
      nx = e.x[best]!;
      ny = e.y[best]!;
    }
    left -= Math.hypot(nx - cx, ny - cy);
    cx = nx;
    cy = ny;
    pts.push({ x: cx, y: cy });
  }
  // 最後の角から、残りの長さだけ向きへ駆け抜ける
  if (left > 20) pts.push({ x: cx + dirX * Math.min(left, 160), y: cy + dirY * Math.min(left, 160) });
  const ar = world.arena;
  if (ar) for (const q of pts) {
    q.x = Math.max(ar.x - ar.halfWidth + p.radius, Math.min(ar.x + ar.halfWidth - p.radius, q.x));
    q.y = Math.max(ar.y - ar.halfHeight + p.radius, Math.min(ar.y + ar.halfHeight - p.radius, q.y));
  }
  return pts;
}

/**
 * しんそく: 折れ線を作り、自分に付いて動く当たり（1 回で同じ敵には 1 回）を出す。体は折れ線に沿って駆け抜ける（activeSkills の stepSkills が進める。07 の311章）。
 * 返り値は折れ線と、駆け抜けにかかる秒数
 */
export function fireExtremeSpeed(world: World, p: Player, pm: PlayerMove, dirX: number, dirY: number): { pts: { x: number; y: number }[]; seconds: number; speed: number } {
  const { st, sc } = skillMoveStats(world, p, pm);
  const pts = extremeSpeedPath(world, p, pm, dirX, dirY);
  let len = 0;
  for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k]!.x - pts[k - 1]!.x, pts[k]!.y - pts[k - 1]!.y);
  const speed = Math.max(1, sc.speed);
  const seconds = len / speed + world.dt * 2;
  const group = newCastGroup(world, seconds);
  world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_FOLLOW, x: p.x, y: p.y, ox: 0, oy: 0, life: seconds, group });
  return { pts, seconds, speed };
}

/**
 * エレキフィールド（ライコウ。07 の311・312章）: いつも、自分の足元の楕円（横の半径 = 技の size、縦はその半分。見えている地面と同じ）の中の敵に、
 * hitIntervalSeconds ごとに びりびり を 1 つ重ね（どのブラウザでも同じように数える）、技の威力のダメージ（自分のブラウザだけ。
 * その敵の足元に小さな当たりを出して、ふつうの技と同じ道で当てる。1 回で同じ敵には 1 回）
 */
function stepElectricField(world: World): void {
  const e = world.enemies;
  for (const p of world.players) {
    if (p.down) continue;
    for (const pm of p.moves) {
      const def = world.rules.moves[pm.move];
      if (!def?.shockStack) continue;
      const st = moveStatsOf(world, pm);
      const every = Math.max(1, Math.round(st.hitIntervalSeconds / world.dt));
      if (world.tick % every !== 0) continue;
      const rx = st.size;
      const ry = st.size * 0.5;
      const keep = Math.max(1, Math.round(def.shockStack.seconds / world.dt));
      const hurt = p.id === world.localPlayerId && st.power > 0;
      const b0 = hurt ? base(world, p, pm, st) : undefined;
      const group = hurt ? newCastGroup(world, 0.2) : 0;
      for (const i of enemiesInRange(world, p.x, p.y, rx + 40)) {
        if (e.hp[i]! <= 0) continue;
        const dx = (e.x[i]! - p.x) / (rx + e.radius[i]! * 0.5);
        const dy = (e.y[i]! - p.y) / (ry + e.radius[i]! * 0.5);
        if (dx * dx + dy * dy > 1) continue;
        e.shock[i] = Math.min(def.shockStack.maxStacks, e.shock[i]! + 1);
        e.shockTicks[i] = keep;
        e.shockBy[i] = p.id;
        if (b0) world.projectiles.add({ ...b0, motion: MOTION_LINEAR, x: e.x[i]!, y: e.y[i]!, radius: Math.max(4, e.radius[i]! * 0.5), pierce: 1, life: world.dt * 2.5, group });
      }
    }
  }
}

/** エレキフィールドの楕円の横の半径（持っていなければ 0。絵で使う） */
export function electricFieldRadius(world: World, p: Player): number {
  for (const pm of p.moves) if (world.rules.moves[pm.move]?.shockStack) return moveStatsOf(world, pm).size;
  return 0;
}

/** エレキフィールドが中の敵に効く間隔（更新回数。持っていなければ 0。絵で使う） */
export function electricFieldEvery(world: World, p: Player): number {
  for (const pm of p.moves) if (world.rules.moves[pm.move]?.shockStack) return Math.max(1, Math.round(moveStatsOf(world, pm).hitIntervalSeconds / world.dt));
  return 0;
}

/** びりびりを重ねきった数（エレキフィールドの maxStacks。無ければ 0） */
export function shockFull(world: World): number {
  for (const m of world.rules.moves) if (m.shockStack) return m.shockStack.maxStacks;
  return 0;
}

/** ライジングボルト（ライコウ。07 の310章）: 射程の中の、びりびりを重ねきった自分の相手（HP の高い順に max 体まで） */
export function risingVoltageTargets(world: World, p: Player, pm: PlayerMove, max: number): number[] {
  const { st } = skillMoveStats(world, p, pm);
  const e = world.enemies;
  const out: number[] = [];
  const full = shockFull(world);
  if (full <= 0) return out;
  for (const i of enemiesInRange(world, p.x, p.y, st.range)) {
    if (e.hp[i]! > 0 && e.shockBy[i] === p.id && e.shock[i]! >= full) out.push(i);
  }
  out.sort((a, b) => e.hp[b]! - e.hp[a]! || e.id[a]! - e.id[b]!);
  return out.slice(0, max);
}

/**
 * ライジングボルト: 重ねきった相手がいればその全員の足元からコンボの雷の柱（同じ技の stage 1。重ねは消える）、
 * いなければ HP の一番高い敵（いなければ前）の足元から雷の柱（stage 0）。じゅうでん の分だけ強くなり、使い切る（1 回で同じ敵には 1 回）。
 * 返り値: コンボの相手の数
 */
export function fireRisingVoltage(world: World, p: Player, pm: PlayerMove, dirX: number, dirY: number, cfg: { comboMultiplier: number; delaySeconds: number; comboDelaySeconds: number; comboSizeMultiplier: number; maxTargets: number }): number {
  const { st, sc } = skillMoveStats(world, p, pm);
  const charge = 1 + (p.charged?.pct ?? 0) / 100;
  p.charged = undefined;
  const group = newCastGroup(world, cfg.comboDelaySeconds + st.durationSeconds);
  const b0 = base(world, p, pm, st);
  const e = world.enemies;
  const combo = risingVoltageTargets(world, p, pm, cfg.maxTargets);
  // 全員に同時に落とす（ずらすと、着いた瞬間の反転の光が続けて点滅して見える）
  for (const i of combo) {
    e.shock[i] = 0;
    e.shockTicks[i] = 0;
    world.projectiles.add({ ...b0, motion: MOTION_LINEAR, x: e.x[i]!, y: e.y[i]!, radius: sc.size * cfg.comboSizeMultiplier, damage: sc.power * cfg.comboMultiplier * charge, group, life: cfg.comboDelaySeconds, stage: 3, armStage: 1, armLife: st.durationSeconds });
  }
  if (combo.length > 0) return combo.length;
  const t = strongestEnemy(world, p, st.range);
  const x = t !== -1 ? e.x[t]! : p.x + dirX * st.range * 0.4;
  const y = t !== -1 ? e.y[t]! : p.y + dirY * st.range * 0.4;
  world.projectiles.add({ ...b0, motion: MOTION_LINEAR, x, y, damage: sc.power * charge, group, life: cfg.delaySeconds, stage: 3, armStage: 0, armLife: st.durationSeconds });
  return 0;
}

/** ふんえん（エンテイ。07 の313章）の残っている割れ目（自分の。線の始まり・向き・長さ） */
export function lavaCracks(world: World, p: Player, lavaMove: number): { x: number; y: number; dx: number; dy: number; len: number }[] {
  const pr = world.projectiles;
  const out: { x: number; y: number; dx: number; dy: number; len: number }[] = [];
  if (lavaMove < 0) return out;
  for (let i = 0; i < pr.count; i++) {
    if (pr.owner[i] !== p.id || pr.move[i] !== lavaMove || pr.shape[i] !== SHAPE_LINE) continue;
    if (!(pr.stage[i] === 1 || (pr.stage[i] === 3 && pr.armStage[i] === 1))) continue;
    out.push({ x: pr.x[i]!, y: pr.y[i]!, dx: pr.dirX[i]!, dy: pr.dirY[i]!, len: pr.length[i]! });
  }
  return out;
}

/**
 * ふんえん（エンテイ）: 向きへ count 本の地割れを走らせ、根元から順に溶岩を噴かせる（1 回で同じ敵には 1 回）。
 * 割れ目（同じ技の線。stage 1）は crackSeconds 残り、中の敵に少しずつ当たる。固定マップの中で止める
 */
export function fireLavaPlume(world: World, p: Player, pm: PlayerMove, dirX: number, dirY: number, cfg: { spreadDegrees: number; spacing: number; delayPerPixel: number; crackSeconds: number; crackPowerPct: number }): void {
  const { st, sc } = skillMoveStats(world, p, pm);
  const n = Math.max(1, st.count);
  const group = newCastGroup(world, st.range * cfg.delayPerPixel + st.durationSeconds);
  const b0 = base(world, p, pm, st);
  const heading = Math.atan2(dirY, dirX);
  const ar = world.arena;
  for (let c = 0; c < n; c++) {
    const a = heading + ((c - (n - 1) / 2) * cfg.spreadDegrees * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let len = st.range;
    if (ar) {
      // 固定マップの外へは割れない
      for (let d = 0; d <= st.range; d += 10) {
        const x = p.x + dx * d;
        const y = p.y + dy * d;
        if (Math.abs(x - ar.x) > ar.halfWidth || Math.abs(y - ar.y) > ar.halfHeight) {
          len = Math.max(0, d - 10);
          break;
        }
      }
    }
    for (let d = cfg.spacing * 0.6; d <= len; d += cfg.spacing) {
      world.projectiles.add({ ...b0, motion: MOTION_LINEAR, x: p.x + dx * d, y: p.y + dy * d, group, life: Math.max(world.dt, d * cfg.delayPerPixel), stage: 3, armStage: 0, armLife: st.durationSeconds });
    }
    if (len > 10) {
      world.projectiles.add({
        ...b0,
        motion: MOTION_LINEAR,
        x: p.x,
        y: p.y,
        shape: SHAPE_LINE,
        length: len,
        dirX: dx,
        dirY: dy,
        radius: sc.size * 0.6,
        damage: (sc.power * cfg.crackPowerPct) / 100,
        hitIntervalTicks: Math.round(0.6 / world.dt),
        life: world.dt,
        stage: 3,
        armStage: 1,
        armLife: cfg.crackSeconds,
      });
    }
  }
}

/**
 * ふんか（エンテイ）: 火山弾を、HP が多いほど多く落とす。自分の ふんえん の割れ目が残っていれば全部そこへ落ちて噴火する（stage 3 → 1）。
 * 無ければ向きの先の区画へばらばらに（stage 3 → 0）。返り値: 割れ目に落ちた数
 */
export function fireEnteiEruption(world: World, p: Player, pm: PlayerMove, dirX: number, dirY: number, lavaMove: number, cfg: { minCountPct: number; delaySeconds: number; spreadSeconds: number; areaRadius: number; areaDistance: number; comboMultiplier: number; comboSizeMultiplier: number }): number {
  const { st, sc } = skillMoveStats(world, p, pm);
  const hp = Math.max(0, Math.min(1, p.hp / Math.max(1, p.maxHp)));
  const n = Math.max(1, Math.round(st.count * (cfg.minCountPct / 100 + (1 - cfg.minCountPct / 100) * hp)));
  const group = newCastGroup(world, cfg.delaySeconds + cfg.spreadSeconds + st.durationSeconds);
  const b0 = base(world, p, pm, st);
  const cracks = lavaCracks(world, p, lavaMove).filter((c) => Math.hypot(c.x - p.x, c.y - p.y) <= st.range);
  const total = cracks.reduce((s, c) => s + c.len, 0);
  const center = eruptionCenter(world, p, st.range, dirX, dirY, cfg.areaDistance);
  // 割れ目の中で、狙う敵に一番近い所（割れ目の始まりからの長さを、全部をつないだ長さで）
  let near = -1;
  if (total > 0 && center.target !== -1) {
    let best = Infinity;
    let acc = 0;
    for (const cr of cracks) {
      const t = Math.max(0, Math.min(cr.len, (center.x - cr.x) * cr.dx + (center.y - cr.y) * cr.dy));
      const d = Math.hypot(cr.x + cr.dx * t - center.x, cr.y + cr.dy * t - center.y);
      if (d < best) {
        best = d;
        near = acc + t;
      }
      acc += cr.len;
    }
  }
  for (let k = 0; k < n; k++) {
    const wait = cfg.delaySeconds + (n > 1 ? (k / (n - 1)) * cfg.spreadSeconds : 0);
    if (total > 0) {
      // 割れ目の上に落ちる: 半分は狙う敵に一番近い所のまわり、残りは割れ目に沿って並べる（少しずらす）
      let at = near >= 0 && k % 2 === 0 ? near + (world.rng.next() - 0.5) * 50 : ((k + 0.5) / n) * total + (world.rng.next() - 0.5) * 20;
      at = Math.max(0, Math.min(total - 0.01, at));
      let c = cracks[0]!;
      for (const cr of cracks) {
        if (at <= cr.len) {
          c = cr;
          break;
        }
        at -= cr.len;
      }
      const d = Math.max(0, Math.min(c.len, at));
      world.projectiles.add({ ...b0, motion: MOTION_LINEAR, x: c.x + c.dx * d, y: c.y + c.dy * d, radius: sc.size * cfg.comboSizeMultiplier, damage: sc.power * cfg.comboMultiplier, group, life: wait, stage: 3, armStage: 1, armLife: st.durationSeconds });
      continue;
    }
    const a = world.rng.next() * Math.PI * 2;
    const r = Math.sqrt(world.rng.next()) * cfg.areaRadius;
    const x = center.x + Math.cos(a) * r;
    const y = center.y + Math.sin(a) * r * 0.7;
    world.projectiles.add({ ...b0, motion: MOTION_LINEAR, x, y, group, life: wait, stage: 3, armStage: 0, armLife: st.durationSeconds });
  }
  return total > 0 ? n : 0;
}

/**
 * ふんか の落ちる区画の中心: 向きの扇（±50°）の中で射程の中の HP の一番高い敵（target はその番号）。扇の中にいなければ射程の中で HP の一番高い敵。
 * 敵がいなければ向きの areaDistance 先
 */
export function eruptionCenter(world: World, p: Player, range: number, dirX: number, dirY: number, areaDistance: number): { x: number; y: number; target: number } {
  const e = world.enemies;
  let best = -1;
  for (const i of enemiesInRange(world, p.x, p.y, range)) {
    if (e.hp[i]! <= 0) continue;
    const dx = e.x[i]! - p.x;
    const dy = e.y[i]! - p.y;
    const d = Math.hypot(dx, dy) || 1;
    if ((dx * dirX + dy * dirY) / d < 0.64) continue;
    if (best === -1 || e.hp[i]! > e.hp[best]! || (e.hp[i] === e.hp[best] && e.id[i]! < e.id[best]!)) best = i;
  }
  // 扇の中にいなければ、射程の中で HP の一番高い敵
  if (best === -1) best = strongestEnemy(world, p, range);
  if (best !== -1) return { x: e.x[best]!, y: e.y[best]!, target: best };
  const dist = Math.min(areaDistance, range);
  return { x: p.x + dirX * dist, y: p.y + dirY * dist, target: -1 };
}

/**
 * オーバーヒート（エンテイ）: chargeSeconds 赤熱してから、向きへ巨大な炎（自分に付いて動く線。長さ range・半径 size。hitInterval ごとに当たる）。
 * 使った後 debuffSeconds の間、ほのおの技が弱まる（自分の。炎そのものの威力は使った時に決まるので弱まらない）
 */
export function fireOverheat(world: World, p: Player, pm: PlayerMove, dirX: number, dirY: number, cfg: { chargeSeconds: number; debuffPct: number; debuffSeconds: number }): void {
  const { st } = skillMoveStats(world, p, pm);
  const b0 = base(world, p, pm, st);
  world.projectiles.add({ ...b0, motion: MOTION_FOLLOW, x: p.x, y: p.y, ox: 0, oy: 0, shape: SHAPE_LINE, length: st.range, dirX, dirY, life: Math.max(world.dt, cfg.chargeSeconds), stage: 3, armStage: 0, armLife: st.durationSeconds });
  const def = world.rules.moves[pm.move]!;
  p.overheat = { type: def.type, pct: cfg.debuffPct, fromTick: world.tick, untilTick: world.tick + Math.round((cfg.chargeSeconds + st.durationSeconds + cfg.debuffSeconds) / world.dt) };
}

/** しもやけ の、氷漬けの印（重ねた数の代わりに入れる。07 の314章） */
export const FROST_ENCASED = 255;

const frostDefCache = new WeakMap<object, { maxStacks: number; seconds: number; slowPctPerStack: number } | null>();

/** しもやけ の決まり（最初に frostStack を持つ技の値。無ければ null） */
export function frostDef(world: World): { maxStacks: number; seconds: number; slowPctPerStack: number } | null {
  const ms = world.rules.moves;
  let d = frostDefCache.get(ms);
  if (d === undefined) {
    const m = ms.find((x) => x.frostStack);
    d = m?.frostStack ? { ...m.frostStack } : null;
    frostDefCache.set(ms, d);
  }
  return d;
}

/** しもやけ を重ねきった数（無ければ 0） */
export function frostFull(world: World): number {
  return frostDef(world)?.maxStacks ?? 0;
}

/**
 * 当たった敵の しもやけ（どのブラウザでも同じように）: frostCombo の技のとげ（stage 0）は、自分が重ねきった相手を氷漬けにする（返り値 true）。
 * それ以外の frostStack の技は 1 つ重ねる（氷漬けの間は重ねない）
 */
function frostOnHit(world: World, j: number, def: World['rules']['moves'][number], stage: number, by: number): boolean {
  const e = world.enemies;
  if (def.frostCombo && stage === 0) {
    const full = frostFull(world);
    if (full > 0 && e.frost[j] !== FROST_ENCASED && e.frost[j]! >= full && e.frostBy[j] === by) {
      e.frost[j] = FROST_ENCASED;
      e.frostTicks[j] = Math.max(1, Math.round(def.frostCombo.freezeSeconds / world.dt));
      return true;
    }
    return false;
  }
  if (!def.frostStack || e.frost[j] === FROST_ENCASED) return false;
  e.frost[j] = Math.min(def.frostStack.maxStacks, e.frost[j]! + 1);
  e.frostTicks[j] = Math.max(1, Math.round(def.frostStack.seconds / world.dt));
  e.frostBy[j] = by;
  return false;
}

/** しもやけ で遅くなる倍率（1 つにつき slowPctPerStack %） */
export function frostSlowMultiplier(world: World, i: number): number {
  const n = world.enemies.frost[i]!;
  if (n === 0 || n === FROST_ENCASED) return 1;
  const d = frostDef(world);
  return d ? Math.max(0, 1 - (d.slowPctPerStack * n) / 100) : 1;
}

/** 固定マップの中に収まる、向き (dx, dy) の線の長さ（固定マップが無ければ len のまま） */
function clipToArena(world: World, x: number, y: number, dx: number, dy: number, len: number): number {
  const ar = world.arena;
  if (!ar) return len;
  for (let d = 0; d <= len; d += 10) {
    if (Math.abs(x + dx * d - ar.x) > ar.halfWidth || Math.abs(y + dy * d - ar.y) > ar.halfHeight) return Math.max(0, d - 10);
  }
  return len;
}

/**
 * フリーズドライ（フリーザー。07 の314章）: 向きへ count 本の霜の線を走らせ、霜が通った spikeDelaySeconds 後に、根元から順に氷のとげを立てる（1 回で同じ敵には 1 回）。
 * 霜の線（同じ技の線。stage 1）は frostSeconds 残り、中の敵に少しずつ当たって しもやけ を重ねる
 */
export function fireFreezeDry(world: World, p: Player, pm: PlayerMove, dirX: number, dirY: number, cfg: { spreadDegrees: number; spacing: number; delayPerPixel: number; spikeDelaySeconds: number; frostSeconds: number; frostPowerPct: number }): void {
  const { st, sc } = skillMoveStats(world, p, pm);
  const n = Math.max(1, st.count);
  const group = newCastGroup(world, st.range * cfg.delayPerPixel + cfg.spikeDelaySeconds + st.durationSeconds);
  const b0 = base(world, p, pm, st);
  const heading = Math.atan2(dirY, dirX);
  for (let c = 0; c < n; c++) {
    const a = heading + ((c - (n - 1) / 2) * cfg.spreadDegrees * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const len = clipToArena(world, p.x, p.y, dx, dy, st.range);
    for (let d = cfg.spacing * 0.6; d <= len; d += cfg.spacing) {
      world.projectiles.add({ ...b0, motion: MOTION_LINEAR, x: p.x + dx * d, y: p.y + dy * d, group, life: Math.max(world.dt, d * cfg.delayPerPixel + cfg.spikeDelaySeconds), stage: 3, armStage: 0, armLife: st.durationSeconds });
    }
    if (len > 10) {
      world.projectiles.add({
        ...b0,
        motion: MOTION_LINEAR,
        x: p.x,
        y: p.y,
        shape: SHAPE_LINE,
        length: len,
        dirX: dx,
        dirY: dy,
        radius: sc.size * 0.5,
        damage: (sc.power * cfg.frostPowerPct) / 100,
        hitIntervalTicks: Math.round(0.5 / world.dt),
        knockback: 0,
        life: world.dt,
        stage: 3,
        armStage: 1,
        armLife: cfg.frostSeconds,
      });
    }
  }
}

/** こごえるかぜ（07 の314章）: 向きへ扇の冷たい風（自分に付いて動き、向きを追う。技の hitIntervalSeconds ごとに当たる） */
export function fireIcyWind(world: World, p: Player, pm: PlayerMove, dirX: number, dirY: number, cfg: { spreadDegrees: number }): void {
  const { st } = skillMoveStats(world, p, pm);
  const half = (cfg.spreadDegrees * Math.PI) / 360;
  world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_FOLLOW, x: p.x, y: p.y, radius: st.range, shape: SHAPE_SECTOR, length: half, dirX, dirY, vx: dirX, vy: dirY });
}

/**
 * ふぶき（07 の314章）: 向きの startDistance 先に、幅 width・奥行き 技の size × 2 の吹雪の帯（向きに直角な線）を出し、技の speed で前へ進める。
 * 岩の上も吹き抜ける。帯の中の敵に hitIntervalSeconds ごとに当たる
 */
export function fireBlizzard(world: World, p: Player, pm: PlayerMove, dirX: number, dirY: number, cfg: { width: number; startDistance: number }): void {
  const { st, sc } = skillMoveStats(world, p, pm);
  const px = -dirY;
  const py = dirX;
  const cx = p.x + dirX * cfg.startDistance;
  const cy = p.y + dirY * cfg.startDistance;
  const half = cfg.width / 2;
  world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x: cx - px * half, y: cy - py * half, shape: SHAPE_LINE, length: cfg.width, dirX: px, dirY: py, radius: sc.size, vx: dirX * sc.speed, vy: dirY * sc.speed });
}

/** ゴッドバード（ファイヤー。07 の315章）の道: 今の場所から向きへ 技の range（固定マップの中に収める） */
export function skyAttackPath(world: World, p: Player, pm: PlayerMove, dirX: number, dirY: number): { x: number; y: number }[] {
  const { st } = skillMoveStats(world, p, pm);
  const ar = world.arena;
  let len = st.range;
  if (ar) {
    // 固定マップの壁の手前で止まる
    for (let d = 0; d <= st.range; d += 10) {
      const x = p.x + dirX * d;
      const y = p.y + dirY * d;
      if (Math.abs(x - ar.x) > ar.halfWidth - p.radius || Math.abs(y - ar.y) > ar.halfHeight - p.radius) {
        len = Math.max(0, d - 10);
        break;
      }
    }
  }
  return [
    { x: p.x, y: p.y },
    { x: p.x + dirX * len, y: p.y + dirY * len },
  ];
}

/**
 * ゴッドバード: chargeSeconds ためてから、道に沿って突き抜ける当たり（自分に付いて動く。1 回で同じ敵には 1 回）と、
 * 通り道に落ちて燃える羽（同じ技の stage 1。featherSeconds 燃える）を出す。返り値: 道・突き抜ける秒数・速さ
 */
export function fireSkyAttack(world: World, p: Player, pm: PlayerMove, dirX: number, dirY: number, cfg: { chargeSeconds: number; featherSpacing: number; featherSeconds: number; featherPowerPct: number }): { pts: { x: number; y: number }[]; seconds: number; speed: number } {
  const { st, sc } = skillMoveStats(world, p, pm);
  const pts = skyAttackPath(world, p, pm, dirX, dirY);
  const len = Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
  const speed = Math.max(1, sc.speed);
  const seconds = len / speed + world.dt * 2;
  const group = newCastGroup(world, cfg.chargeSeconds + seconds);
  const b0 = base(world, p, pm, st);
  world.projectiles.add({ ...b0, motion: MOTION_FOLLOW, x: p.x, y: p.y, ox: 0, oy: 0, dirX, dirY, group, life: Math.max(world.dt, cfg.chargeSeconds), stage: 3, armStage: 0, armLife: seconds });
  for (let d = cfg.featherSpacing * 0.5; cfg.featherSeconds > 0 && d <= len; d += cfg.featherSpacing) {
    world.projectiles.add({
      ...b0,
      motion: MOTION_LINEAR,
      x: p.x + dirX * d,
      y: p.y + dirY * d,
      dirX,
      dirY,
      radius: sc.size * 0.6,
      damage: (sc.power * cfg.featherPowerPct) / 100,
      hitIntervalTicks: Math.round(0.5 / world.dt),
      knockback: 0,
      life: Math.max(world.dt, cfg.chargeSeconds + d / speed),
      stage: 3,
      armStage: 1,
      armLife: cfg.featherSeconds,
    });
  }
  return { pts, seconds, speed };
}

/**
 * ねっぷう（07 の315章）: 向きへ弧の熱波を count 回、waveDelaySeconds ごとに送る（自分に付いて動く。1 回ごとに turnDegrees ずつ向きをずらす）。
 * 熱波は厚さ 技の size の帯で、技の durationSeconds で 技の range まで広がる
 */
export function fireHeatWave(world: World, p: Player, pm: PlayerMove, dirX: number, dirY: number, cfg: { arcDegrees: number; waveDelaySeconds: number; turnDegrees: number }): void {
  const { st, sc } = skillMoveStats(world, p, pm);
  const n = Math.max(1, st.count);
  const half = Math.min(Math.PI, (cfg.arcDegrees * Math.PI) / 360);
  const band = Math.max(1, sc.size);
  const growth = Math.max(0, (st.range - band) / Math.max(world.dt, st.durationSeconds));
  const heading = Math.atan2(dirY, dirX);
  const b0 = base(world, p, pm, st);
  for (let k = 0; k < n; k++) {
    const a = heading + ((k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * cfg.turnDegrees * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    world.projectiles.add({ ...b0, motion: MOTION_FOLLOW, x: p.x, y: p.y, ox: 0, oy: 0, radius: band, band, growth, shape: SHAPE_SECTOR, length: half, dirX: dx, dirY: dy, vx: dx, vy: dy, life: Math.max(world.dt, k * cfg.waveDelaySeconds), stage: 3, armStage: 0, armLife: st.durationSeconds });
  }
}

/** もえつきる の炎の玉が落ちる所（ふんか と同じ選び方: 向きの扇の中の HP の一番高い敵 → 射程の中の一番高い敵 → 向きの areaDistance 先） */
export function burnUpCenter(world: World, p: Player, range: number, dirX: number, dirY: number, areaDistance: number): { x: number; y: number; target: number } {
  return eruptionCenter(world, p, range, dirX, dirY, areaDistance);
}

/** もえつきる（07 の315章）: chargeSeconds 体の炎を集め、巨大な炎の玉を投げる（flightSeconds で落ちて、半径 技の size で爆発する） */
export function fireBurnUp(world: World, p: Player, pm: PlayerMove, dirX: number, dirY: number, cfg: { chargeSeconds: number; flightSeconds: number; areaDistance: number }): void {
  const { st } = skillMoveStats(world, p, pm);
  const c = burnUpCenter(world, p, st.range, dirX, dirY, cfg.areaDistance);
  const group = newCastGroup(world, cfg.chargeSeconds + cfg.flightSeconds + st.durationSeconds);
  world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x: c.x, y: c.y, group, life: Math.max(world.dt, cfg.chargeSeconds + cfg.flightSeconds), stage: 3, armStage: 0, armLife: st.durationSeconds });
}

/** でんじほう（サンダー。07 の316章）のスキルの定義（無ければ undefined） */
function zapCannonSkill(world: World): { move: number; cfg: { linkDistance: number; bandWidth: number; bandPowerPct: number; bandIntervalSeconds: number; maxSpheres: number } } | undefined {
  const d = world.rules.activeSkills?.defs.find((x) => x.kind === 'zapCannon' && x.move >= 0 && x.zapCannon);
  return d ? { move: d.move, cfg: d.zapCannon! } : undefined;
}

/**
 * プレイヤー owner の でんじほう の球（出ているもの。古い順）と、共鳴の帯（球の番号の組。linkDistance より近い球どうし）。描画でも使う
 */
export function zapNetwork(world: World, owner: number): { spheres: { i: number; x: number; y: number; r: number; serial: number }[]; links: [number, number][]; bandWidth: number } {
  const zc = zapCannonSkill(world);
  const spheres: { i: number; x: number; y: number; r: number; serial: number }[] = [];
  const links: [number, number][] = [];
  if (!zc) return { spheres, links, bandWidth: 0 };
  const pr = world.projectiles;
  for (let i = 0; i < pr.count; i++) {
    if (pr.move[i] !== zc.move || pr.owner[i] !== owner || pr.stage[i] !== 0 || pr.shape[i] !== SHAPE_CIRCLE) continue;
    spheres.push({ i, x: pr.x[i]!, y: pr.y[i]!, r: pr.radius[i]!, serial: pr.serial[i]! });
  }
  spheres.sort((a, b) => a.serial - b.serial);
  for (let a = 0; a < spheres.length; a++) {
    for (let b = a + 1; b < spheres.length; b++) {
      if (Math.hypot(spheres[a]!.x - spheres[b]!.x, spheres[a]!.y - spheres[b]!.y) <= zc.cfg.linkDistance) links.push([a, b]);
    }
  }
  return { spheres, links, bandWidth: zc.cfg.bandWidth };
}

/** 線分 a（(ax,ay) から (bx,by)）と線分 c（(cx,cy) から (ex,ey)）のいちばん近い距離 */
function segSegDistance(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, ex: number, ey: number): number {
  const ptSeg = (px: number, py: number, sx: number, sy: number, tx: number, ty: number): number => {
    const vx = tx - sx;
    const vy = ty - sy;
    const l2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((px - sx) * vx + (py - sy) * vy) / l2));
    return Math.hypot(px - sx - vx * t, py - sy - vy * t);
  };
  // 交わっていれば 0
  const cross = (ux: number, uy: number, vx: number, vy: number): number => ux * vy - uy * vx;
  const d1 = cross(bx - ax, by - ay, cx - ax, cy - ay);
  const d2 = cross(bx - ax, by - ay, ex - ax, ey - ay);
  const d3 = cross(ex - cx, ey - cy, ax - cx, ay - cy);
  const d4 = cross(ex - cx, ey - cy, bx - cx, by - cy);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(ptSeg(ax, ay, cx, cy, ex, ey), ptSeg(bx, by, cx, cy, ex, ey), ptSeg(cx, cy, ax, ay, bx, by), ptSeg(ex, ey, ax, ay, bx, by));
}

/**
 * 10まんボルト の稲妻（(x,y) から向き (dx,dy) に長さ len・太さ r）が当たる、プレイヤー owner の でんじほう の網。
 * 当たった球・帯からつながっているものをすべて返す（spheres は球、links は帯。どちらも zapNetwork の中の番号）
 */
export function zapNetworkHit(world: World, owner: number, x: number, y: number, dx: number, dy: number, len: number, r: number): { spheres: number[]; links: number[]; net: ReturnType<typeof zapNetwork> } {
  const net = zapNetwork(world, owner);
  const ex = x + dx * len;
  const ey = y + dy * len;
  const hit = new Set<number>();
  net.spheres.forEach((s, k) => {
    if (segSegDistance(x, y, ex, ey, s.x, s.y, s.x, s.y) <= s.r + r) hit.add(k);
  });
  net.links.forEach(([a, b]) => {
    const A = net.spheres[a]!;
    const B = net.spheres[b]!;
    if (segSegDistance(x, y, ex, ey, A.x, A.y, B.x, B.y) <= net.bandWidth / 2 + r) {
      hit.add(a);
      hit.add(b);
    }
  });
  // つながっている球をたどる
  const queue = [...hit];
  while (queue.length > 0) {
    const k = queue.pop()!;
    for (const [a, b] of net.links) {
      const o = a === k ? b : b === k ? a : -1;
      if (o !== -1 && !hit.has(o)) {
        hit.add(o);
        queue.push(o);
      }
    }
  }
  const links: number[] = [];
  net.links.forEach(([a, b], k) => {
    if (hit.has(a) && hit.has(b)) links.push(k);
  });
  return { spheres: [...hit].sort((a, b) => a - b), links, net };
}

/** でんじほう（07 の316章）: 向きへ大きな電気の球をゆっくり放つ（自分の球が maxSpheres を超えたら古い球から消す） */
export function fireZapCannon(world: World, p: Player, pm: PlayerMove, dirX: number, dirY: number, cfg: { maxSpheres: number }): void {
  const { st, sc } = skillMoveStats(world, p, pm);
  const net = zapNetwork(world, p.id);
  const extra = net.spheres.length + 1 - cfg.maxSpheres;
  if (extra > 0) {
    const old = net.spheres.slice(0, extra).map((s) => s.i).sort((a, b) => b - a);
    for (const i of old) world.projectiles.removeAt(i);
  }
  world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_LINEAR, x: p.x + dirX * 30, y: p.y + dirY * 30, vx: dirX * sc.speed, vy: dirY * sc.speed, dirX, dirY });
}

/**
 * 共鳴の帯（07 の316章）: bandIntervalSeconds ごとに、自分の球どうしの帯の上に当たりを出す（自分のブラウザだけ。同じ技の線の stage 1。1 回で同じ敵には 1 回）
 */
function stepZapBands(world: World): void {
  const zc = zapCannonSkill(world);
  if (!zc) return;
  const every = Math.max(1, Math.round(zc.cfg.bandIntervalSeconds / world.dt));
  if (world.tick % every !== 0) return;
  const p = world.players.find((q) => q.id === world.localPlayerId);
  const pm = p?.moves.find((m) => m.move === zc.move);
  if (!p || !pm || p.down) return;
  const net = zapNetwork(world, p.id);
  if (net.links.length === 0) return;
  const { st, sc } = skillMoveStats(world, p, pm);
  const b0 = base(world, p, pm, st);
  const group = newCastGroup(world, 0.2);
  for (const [a, b] of net.links) {
    const A = net.spheres[a]!;
    const B = net.spheres[b]!;
    const len = Math.hypot(B.x - A.x, B.y - A.y);
    if (len < 1) continue;
    world.projectiles.add({ ...b0, motion: MOTION_LINEAR, x: A.x, y: A.y, shape: SHAPE_LINE, length: len, dirX: (B.x - A.x) / len, dirY: (B.y - A.y) / len, radius: zc.cfg.bandWidth / 2, damage: (sc.power * zc.cfg.bandPowerPct) / 100, knockback: 0, pierce: Infinity, life: world.dt * 2.5, stage: 1, group });
  }
}

/**
 * 10まんボルト（07 の316章）: 向きへ稲妻をまっすぐ放つ（同じ技の線の stage 0）。自分の でんじほう の網に当たると、つながった球と帯をすべてはじけさせる
 * （球は消えて burstDelaySeconds 後に大きな爆発。帯は線の上に。どちらも同じ技の stage 1）。返り値: はじけた球の数
 */
export function fireThunderbolt(world: World, p: Player, pm: PlayerMove, dirX: number, dirY: number, cfg: { burstMultiplier: number; burstSizeMultiplier: number; bandBurstMultiplier: number; burstDelaySeconds: number }): number {
  const { st, sc } = skillMoveStats(world, p, pm);
  const b0 = base(world, p, pm, st);
  let len = st.range;
  const ar = world.arena;
  if (ar) {
    for (let d = 0; d <= st.range; d += 10) {
      if (Math.abs(p.x + dirX * d - ar.x) > ar.halfWidth || Math.abs(p.y + dirY * d - ar.y) > ar.halfHeight) {
        len = Math.max(10, d - 10);
        break;
      }
    }
  }
  world.projectiles.add({ ...b0, motion: MOTION_FOLLOW, x: p.x, y: p.y, ox: 0, oy: 0, shape: SHAPE_LINE, length: len, dirX, dirY, radius: sc.size, life: st.durationSeconds });
  const hit = zapNetworkHit(world, p.id, p.x, p.y, dirX, dirY, len, sc.size);
  if (hit.spheres.length === 0) return 0;
  const { net } = hit;
  for (const k of hit.links) {
    const [a, b] = net.links[k]!;
    const A = net.spheres[a]!;
    const B = net.spheres[b]!;
    const l = Math.hypot(B.x - A.x, B.y - A.y) || 1;
    world.projectiles.add({ ...b0, motion: MOTION_LINEAR, x: A.x, y: A.y, shape: SHAPE_LINE, length: l, dirX: (B.x - A.x) / l, dirY: (B.y - A.y) / l, radius: net.bandWidth, damage: sc.power * cfg.bandBurstMultiplier, life: Math.max(world.dt, cfg.burstDelaySeconds), stage: 3, armStage: 1, armLife: 0.2 });
  }
  for (const k of hit.spheres) {
    const s = net.spheres[k]!;
    world.projectiles.add({ ...b0, motion: MOTION_LINEAR, x: s.x, y: s.y, radius: s.r * cfg.burstSizeMultiplier, damage: sc.power * cfg.burstMultiplier, life: Math.max(world.dt, cfg.burstDelaySeconds), stage: 3, armStage: 1, armLife: 0.2 });
  }
  // 球は消す（番号の大きい方から）
  const idx = hit.spheres.map((k) => net.spheres[k]!.i).sort((a, b) => b - a);
  for (const i of idx) world.projectiles.removeAt(i);
  return hit.spheres.length;
}

/**
 * エアロブラスト（ルギア。07 の317章）: ためてから風の玉を撃ち、落ちる所で風が爆ぜる（同じ技の円の stage 0。1 回で同じ敵には 1 回）。
 * そこに竜巻（同じ技の円の stage 1。angle 0 = ふつう、1 = 水を吸った竜巻）が残って、中の敵を中心へ吸い寄せる
 */
export function fireAeroblast(world: World, p: Player, pm: PlayerMove, dirX: number, dirY: number, cfg: { chargeSeconds: number; flightSeconds: number; areaDistance: number; tornadoSeconds: number; tornadoRadius: number; tornadoPowerPct: number; pull: number }): void {
  const { st, sc } = skillMoveStats(world, p, pm);
  const c = eruptionCenter(world, p, st.range, dirX, dirY, cfg.areaDistance);
  const wait = Math.max(world.dt, cfg.chargeSeconds + cfg.flightSeconds);
  const group = newCastGroup(world, wait + st.durationSeconds);
  const b0 = base(world, p, pm, st);
  world.projectiles.add({ ...b0, motion: MOTION_LINEAR, x: c.x, y: c.y, group, life: wait, stage: 3, armStage: 0, armLife: st.durationSeconds });
  world.projectiles.add({ ...b0, motion: MOTION_LINEAR, x: c.x, y: c.y, radius: cfg.tornadoRadius, damage: (sc.power * cfg.tornadoPowerPct) / 100, hitIntervalTicks: Math.round(0.5 / world.dt), knockback: -cfg.pull, angle: 0, life: wait + world.dt, stage: 3, armStage: 1, armLife: cfg.tornadoSeconds });
}

/** じんつうりき（07 の317章）: 向きの扇の中の近い敵 count 体の所に、delaySeconds 後にはじける印（同じ技の円。待つ間は stage 3）。敵がいなければ前に 1 つ */
export function fireExtrasensory(world: World, p: Player, pm: PlayerMove, dirX: number, dirY: number, cfg: { spreadDegrees: number; delaySeconds: number }): void {
  const { st, sc } = skillMoveStats(world, p, pm);
  const e = world.enemies;
  const cos = Math.cos((cfg.spreadDegrees * Math.PI) / 360);
  const cands: { i: number; d: number }[] = [];
  for (const i of enemiesInRange(world, p.x, p.y, st.range)) {
    if (e.hp[i]! <= 0) continue;
    const dx = e.x[i]! - p.x;
    const dy = e.y[i]! - p.y;
    const d = Math.hypot(dx, dy) || 1;
    if ((dx * dirX + dy * dirY) / d < cos) continue;
    cands.push({ i, d });
  }
  cands.sort((a, b) => a.d - b.d || e.id[a.i]! - e.id[b.i]!);
  const group = newCastGroup(world, cfg.delaySeconds + st.durationSeconds);
  const b0 = base(world, p, pm, st);
  const n = Math.max(1, st.count);
  const picks = cands.slice(0, n);
  if (picks.length === 0) {
    world.projectiles.add({ ...b0, motion: MOTION_LINEAR, x: p.x + dirX * st.range * 0.5, y: p.y + dirY * st.range * 0.5, group, life: Math.max(world.dt, cfg.delaySeconds), stage: 3, armStage: 0, armLife: st.durationSeconds });
    return;
  }
  for (const { i } of picks) {
    world.projectiles.add({ ...b0, motion: MOTION_LINEAR, x: e.x[i]!, y: e.y[i]!, radius: Math.max(sc.size, e.radius[i]! + 10), group, life: Math.max(world.dt, cfg.delaySeconds), stage: 3, armStage: 0, armLife: st.durationSeconds });
  }
}

/** ハイドロポンプ（07 の317章）: ためてから、向きを真ん中に sweepDegrees を片道でなぎ払う太い水流（自分に付いて動く線） */
export function fireHydroPump(world: World, p: Player, pm: PlayerMove, dirX: number, dirY: number, cfg: { chargeSeconds: number; sweepDegrees: number }): void {
  const { st, sc } = skillMoveStats(world, p, pm);
  const half = (cfg.sweepDegrees * Math.PI) / 360;
  const a = Math.atan2(dirY, dirX);
  world.projectiles.add({
    ...base(world, p, pm, st),
    motion: MOTION_SWEEP,
    x: p.x,
    y: p.y,
    shape: SHAPE_LINE,
    length: st.range,
    radius: sc.size,
    dirX: Math.cos(a - half),
    dirY: Math.sin(a - half),
    angle: a,
    angularSpeed: half,
    orbitRadius: 1,
    life: Math.max(world.dt, cfg.chargeSeconds),
    stage: 3,
    armStage: 0,
    armLife: st.durationSeconds,
  });
}

/**
 * 水の渦の爆発（07 の318章）: ハイドロポンプ の水流が、同じプレイヤーの エアロブラスト の風の渦（stage 1・angle 0）に触れると、渦が水を巻き上げ（angle 1。spoutSeconds で消える）、
 * spoutSeconds 後に着弾点で爆発する（エアロブラスト の円の stage 0・angle 2。どのブラウザでも同じように起こし、当たりは持ち主のブラウザで決まる）
 */
function stepWetTornadoes(world: World): void {
  const defs = world.rules.activeSkills?.defs;
  const hp = defs?.find((d) => d.kind === 'hydroPump' && d.move >= 0 && d.hydroPump);
  const ab = defs?.find((d) => d.kind === 'aeroblast' && d.move >= 0);
  if (!hp || !ab) return;
  const cfg = hp.hydroPump!;
  const pr = world.projectiles;
  const n = pr.count;
  for (let b = 0; b < n; b++) {
    if (pr.move[b] !== hp.move || pr.stage[b] !== 0 || pr.shape[b] !== SHAPE_LINE) continue;
    for (let t = 0; t < n; t++) {
      if (pr.move[t] !== ab.move || pr.stage[t] !== 1 || pr.angle[t] !== 0 || pr.owner[t] !== pr.owner[b]) continue;
      const d2 = segmentDistance2(pr.x[t]!, pr.y[t]!, pr.x[b]!, pr.y[b]!, pr.dirX[b]!, pr.dirY[b]!, pr.length[b]!);
      const r = pr.radius[t]! + pr.radius[b]!;
      if (d2 > r * r) continue;
      pr.angle[t] = 1;
      pr.life[t] = Math.min(pr.life[t]!, cfg.spoutSeconds);
      const owner = world.players.find((q) => q.id === pr.owner[t]);
      const pm = owner?.moves.find((m) => m.move === ab.move);
      if (!owner || !pm) continue;
      const { st, sc } = skillMoveStats(world, owner, pm);
      world.projectiles.add({
        ...base(world, owner, pm, st),
        motion: MOTION_LINEAR,
        x: pr.x[t]!,
        y: pr.y[t]!,
        radius: pr.radius[t]! * cfg.burstSizeMultiplier,
        damage: sc.power * cfg.burstMultiplier,
        angle: 2,
        group: newCastGroup(world, cfg.spoutSeconds + 0.3),
        life: cfg.spoutSeconds,
        stage: 3,
        armStage: 0,
        armLife: 0.25,
      });
    }
  }
}

/**
 * ミストボール（ラティアス。07 の319章）: 霧の玉を扇に飛ばす。玉ごとに、通り道で最初に触れる敵（いなければ射程の先）を決め、
 * そこで弾ける当たり（同じ技の円の stage 0。1 回で同じ敵には 1 回）と、残る霧（stage 1。angle 0 = ふつう、1 = いやしのはどう の光が届いた）を、玉が着く時間だけ待って出す
 */
export function fireMistBall(world: World, p: Player, pm: PlayerMove, dirX: number, dirY: number, cfg: { spreadDegrees: number; mistSeconds: number; mistRadius: number; mistPowerPct: number }): void {
  const { st, sc } = skillMoveStats(world, p, pm);
  const e = world.enemies;
  const n = Math.max(1, st.count);
  const speed = Math.max(1, sc.speed);
  const heading = Math.atan2(dirY, dirX);
  const b0 = base(world, p, pm, st);
  const near = enemiesInRange(world, p.x, p.y, st.range + 40);
  for (let k = 0; k < n; k++) {
    const a = heading + (n > 1 ? (k / (n - 1) - 0.5) * ((cfg.spreadDegrees * Math.PI) / 180) : 0);
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let dist = clipToArena(world, p.x, p.y, dx, dy, st.range);
    for (const i of near) {
      if (e.hp[i]! <= 0) continue;
      const t = (e.x[i]! - p.x) * dx + (e.y[i]! - p.y) * dy;
      if (t < 0 || t > dist) continue;
      const side = Math.abs(-(e.x[i]! - p.x) * dy + (e.y[i]! - p.y) * dx);
      if (side <= sc.size + e.radius[i]!) dist = t;
    }
    const x = p.x + dx * dist;
    const y = p.y + dy * dist;
    const wait = Math.max(world.dt, dist / speed);
    world.projectiles.add({ ...b0, motion: MOTION_LINEAR, x, y, radius: sc.size * 1.3, dirX: dx, dirY: dy, life: wait, stage: 3, armStage: 0, armLife: st.durationSeconds });
    world.projectiles.add({ ...b0, motion: MOTION_LINEAR, x, y, radius: cfg.mistRadius, damage: (sc.power * cfg.mistPowerPct) / 100, hitIntervalTicks: Math.round(0.5 / world.dt), knockback: 0, angle: 0, life: wait + world.dt, stage: 3, armStage: 1, armLife: cfg.mistSeconds });
  }
}

/** りゅうのはどう（ラティアス。07 の319章）: ためてから、向きへ太い竜の気の波動（自分に付いて動く線。1 回当たる） */
export function fireDragonPulse(world: World, p: Player, pm: PlayerMove, dirX: number, dirY: number, cfg: { chargeSeconds: number }): void {
  const { st, sc } = skillMoveStats(world, p, pm);
  const len = clipToArena(world, p.x, p.y, dirX, dirY, st.range);
  world.projectiles.add({ ...base(world, p, pm, st), motion: MOTION_FOLLOW, x: p.x, y: p.y, ox: 0, oy: 0, shape: SHAPE_LINE, length: Math.max(10, len), dirX, dirY, radius: sc.size, life: Math.max(world.dt, cfg.chargeSeconds), stage: 3, armStage: 0, armLife: st.durationSeconds });
}

/**
 * いやしのはどう（ラティアス。07 の319章）: 自分と近くの仲間を回復し（回復は自分のブラウザのプレイヤーにだけ効くので、どのブラウザでも呼ぶ）、
 * 近くに残っている自分の ミストボール の霧へ光を届けて弾けさせる（同じ技の円の stage 3 → 0。霧は光が届いたら消える）。返り値: 弾けさせた霧の数
 */
export function fireHealPulse(world: World, p: Player, pm: PlayerMove, cfg: { healPct: number; allyRadius: number; mistRange: number; travelSeconds: number; burstSizeMultiplier: number }): number {
  for (const q of world.players) {
    if (q.down || Math.hypot(q.x - p.x, q.y - p.y) > cfg.allyRadius) continue;
    healPlayer(world, q.id, (q.maxHp * cfg.healPct) / 100);
  }
  const mist = world.rules.activeSkills?.defs.find((d) => d.kind === 'mistBall' && d.move >= 0)?.move ?? -1;
  if (mist < 0) return 0;
  const { st, sc } = skillMoveStats(world, p, pm);
  const pr = world.projectiles;
  const b0 = base(world, p, pm, st);
  const n = pr.count;
  let lit = 0;
  for (let i = 0; i < n; i++) {
    if (pr.move[i] !== mist || pr.owner[i] !== p.id || pr.stage[i] !== 1 || pr.angle[i] !== 0) continue;
    if (Math.hypot(pr.x[i]! - p.x, pr.y[i]! - p.y) > cfg.mistRange) continue;
    pr.angle[i] = 1;
    pr.life[i] = Math.min(pr.life[i]!, cfg.travelSeconds + world.dt);
    world.projectiles.add({ ...b0, motion: MOTION_LINEAR, x: pr.x[i]!, y: pr.y[i]!, radius: pr.radius[i]! * cfg.burstSizeMultiplier, damage: sc.power, group: newCastGroup(world, cfg.travelSeconds + st.durationSeconds), life: cfg.travelSeconds, stage: 3, armStage: 0, armLife: st.durationSeconds });
    lit++;
  }
  return lit;
}

/**
 * ラスターパージ（ラティオス。07 の320章）: 光の玉を撃ち、落ちる所から向きへ光の爆発を順に走らせる（同じ技の円の stage 3 → 0。爆発ごとに当たる）。
 * 最初の爆発は angle 1（光の玉が飛んでいく先。描画で玉を描く）
 */
export function fireLusterPurge(world: World, p: Player, pm: PlayerMove, dirX: number, dirY: number, cfg: { areaDistance: number; spacing: number; staggerSeconds: number }): void {
  const { st, sc } = skillMoveStats(world, p, pm);
  const c = eruptionCenter(world, p, st.range, dirX, dirY, cfg.areaDistance);
  const flight = Math.max(world.dt, Math.hypot(c.x - p.x, c.y - p.y) / Math.max(1, sc.speed));
  const b0 = base(world, p, pm, st);
  const n = Math.max(1, st.count);
  const ar = world.arena;
  for (let k = 0; k < n; k++) {
    const x = c.x + dirX * cfg.spacing * k;
    const y = c.y + dirY * cfg.spacing * k;
    if (ar && (Math.abs(x - ar.x) > ar.halfWidth || Math.abs(y - ar.y) > ar.halfHeight)) break;
    world.projectiles.add({ ...b0, motion: MOTION_LINEAR, x, y, dirX, dirY, angle: k === 0 ? 1 : 0, life: flight + k * cfg.staggerSeconds, stage: 3, armStage: 0, armLife: st.durationSeconds });
  }
}

/** りゅうせいぐん（ラティオス。07 の320章）: 向きの先の区画へ、流星 技の count ＋ 重ね × perStack 個をばらばらに落とす（同じ技の円の stage 3 → 0。流星ごとに当たる） */
export function fireDracoMeteor(world: World, p: Player, pm: PlayerMove, dirX: number, dirY: number, cfg: { perStack: number; areaRadius: number; areaDistance: number; delaySeconds: number; spreadSeconds: number }, stacks: number): number {
  const { st } = skillMoveStats(world, p, pm);
  const c = eruptionCenter(world, p, st.range, dirX, dirY, cfg.areaDistance);
  const n = Math.max(1, st.count + stacks * cfg.perStack);
  const b0 = base(world, p, pm, st);
  for (let k = 0; k < n; k++) {
    const a = world.rng.next() * Math.PI * 2;
    const r = Math.sqrt(world.rng.next()) * cfg.areaRadius;
    // 半分は狙った敵のそばへ
    const near = k % 2 === 0 && c.target !== -1 ? 0.35 : 1;
    const x = c.x + Math.cos(a) * r * near;
    const y = c.y + Math.sin(a) * r * 0.7 * near;
    const wait = cfg.delaySeconds + (n > 1 ? (k / (n - 1)) * cfg.spreadSeconds : 0);
    world.projectiles.add({ ...b0, motion: MOTION_LINEAR, x, y, life: Math.max(world.dt, wait), stage: 3, armStage: 0, armLife: st.durationSeconds });
  }
  return n;
}

/** ゴッドバード（ホウオウ。07 の322章）の楕円の道: 今の場所から向きへ長さ range・幅 range × widthRatio の楕円を、points 個の角でたどって戻る（固定マップの中に収める） */
export function skyLoopPath(world: World, p: Player, range: number, dirX: number, dirY: number, cfg: { widthRatio: number; points: number }): { x: number; y: number }[] {
  const half = range / 2;
  const w = (range * cfg.widthRatio) / 2;
  const px = -dirY;
  const py = dirX;
  const cx = p.x + dirX * half;
  const cy = p.y + dirY * half;
  const ar = world.arena;
  const pts: { x: number; y: number }[] = [];
  for (let k = 0; k <= cfg.points; k++) {
    // 自分の所（角度 π）から始めて、一周して戻る
    const a = Math.PI + (k / cfg.points) * Math.PI * 2;
    let x = cx + dirX * Math.cos(a) * half + px * Math.sin(a) * w;
    let y = cy + dirY * Math.cos(a) * half + py * Math.sin(a) * w;
    if (ar) {
      x = Math.max(ar.x - ar.halfWidth + p.radius, Math.min(ar.x + ar.halfWidth - p.radius, x));
      y = Math.max(ar.y - ar.halfHeight + p.radius, Math.min(ar.y + ar.halfHeight - p.radius, y));
    }
    pts.push({ x, y });
  }
  pts[0] = { x: p.x, y: p.y };
  pts[pts.length - 1] = { x: p.x, y: p.y };
  return pts;
}

/**
 * ゴッドバード（ホウオウ）: 楕円をたどる当たり（自分に付いて動く。1 回で同じ敵には 1 回）と、通った所に燃える場所（同じ技の円の stage 3 → 1。
 * angle 1 は聖炎の青白い火）を、ホウオウが通る時に現れるように出す。返り値: 道・秒数・速さ
 */
export function fireSkyLoop(world: World, p: Player, pm: PlayerMove, dirX: number, dirY: number, cfg: { widthRatio: number; points: number; spacing: number; burnSeconds: number; burnPowerPct: number; sacredBurnMultiplier: number }): { pts: { x: number; y: number }[]; seconds: number; speed: number } {
  const { st, sc } = skillMoveStats(world, p, pm);
  const pts = skyLoopPath(world, p, st.range, dirX, dirY, cfg);
  const speed = Math.max(1, sc.speed);
  let len = 0;
  for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k]!.x - pts[k - 1]!.x, pts[k]!.y - pts[k - 1]!.y);
  const seconds = len / speed + world.dt * 2;
  const group = newCastGroup(world, seconds);
  const b0 = base(world, p, pm, st);
  world.projectiles.add({ ...b0, motion: MOTION_FOLLOW, x: p.x, y: p.y, ox: 0, oy: 0, group, life: seconds });
  const sacred = !!p.sacredFlame && world.tick < p.sacredFlame.untilTick;
  const mult = sacred ? cfg.sacredBurnMultiplier : 1;
  let acc = 0;
  let next = cfg.spacing * 0.5;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1]!;
    const b = pts[k]!;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    while (next <= acc + l) {
      const t = l > 0 ? (next - acc) / l : 0;
      world.projectiles.add({
        ...b0,
        motion: MOTION_LINEAR,
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        radius: sc.size * 0.85,
        damage: (sc.power * cfg.burnPowerPct * mult) / 100,
        hitIntervalTicks: Math.round(0.5 / world.dt),
        knockback: 0,
        angle: sacred ? 1 : 0,
        life: Math.max(world.dt, next / speed),
        stage: 3,
        armStage: 1,
        armLife: cfg.burnSeconds * (sacred ? 1.3 : 1),
      });
      next += cfg.spacing;
    }
    acc += l;
  }
  return { pts, seconds, speed };
}

/**
 * じこさいせい（ホウオウ。07 の322章）: 自分を回復する。聖炎の間は、近くの味方も回復し、近くで倒れている味方をすぐ起こす（起こすのはホストかソロ。復活の数は使わない）。
 * 回復は自分のブラウザのプレイヤーにだけ効くので、どのブラウザでも呼ぶ（ほかのブラウザでは見た目と、そこのプレイヤーの回復）
 */
export function fireRebirth(world: World, p: Player, cfg: { healPct: number; allyRadius: number; allyHealPct: number }): number {
  healPlayer(world, p.id, (p.maxHp * cfg.healPct) / 100);
  const sacred = !!p.sacredFlame && world.tick < p.sacredFlame.untilTick;
  if (!sacred) return 0;
  let raised = 0;
  for (const q of world.players) {
    if (q === p || Math.hypot(q.x - p.x, q.y - p.y) > cfg.allyRadius) continue;
    if (q.down) {
      if (world.role === 'guest') continue;
      const rv = world.rules.stats.revive;
      q.down = false;
      q.hp = (q.maxHp * rv.hpPct) / 100;
      q.invincibleTicks = Math.round(rv.invincibleSeconds / world.dt);
      world.reviveTouch.delete(q.id);
      world.events.push({ type: 'playerRevived', playerId: q.id, revives: world.revives });
      raised++;
      continue;
    }
    healPlayer(world, q.id, (q.maxHp * cfg.allyHealPct) / 100);
  }
  return raised;
}

/**
 * せいなるほのお（ホウオウ。07 の322章）: 青白い炎弾を落ちる所へ飛ばし、着弾で爆発（同じ技の円の stage 3 → 0。angle 1 は炎弾が飛んでいく先）と、
 * まわりに飛び火（stage 3 → 1。少しずつ遅れて落ち、燃え続ける）
 */
export function fireSacredFire(world: World, p: Player, pm: PlayerMove, dirX: number, dirY: number, cfg: { areaDistance: number; embers: number; emberSpread: number; emberRadius: number; emberSeconds: number; emberPowerPct: number }): void {
  const { st, sc } = skillMoveStats(world, p, pm);
  const c = eruptionCenter(world, p, st.range, dirX, dirY, cfg.areaDistance);
  const flight = Math.max(world.dt, Math.hypot(c.x - p.x, c.y - p.y) / Math.max(1, sc.speed));
  const b0 = base(world, p, pm, st);
  world.projectiles.add({ ...b0, motion: MOTION_LINEAR, x: c.x, y: c.y, angle: 1, group: newCastGroup(world, flight + st.durationSeconds), life: flight, stage: 3, armStage: 0, armLife: st.durationSeconds });
  for (let k = 0; k < cfg.embers; k++) {
    const a = (k / Math.max(1, cfg.embers)) * Math.PI * 2 + world.rng.next() * 0.8;
    const r = cfg.emberSpread * (0.55 + world.rng.next() * 0.45);
    world.projectiles.add({
      ...b0,
      motion: MOTION_LINEAR,
      x: c.x + Math.cos(a) * r,
      y: c.y + Math.sin(a) * r * 0.7,
      radius: cfg.emberRadius,
      damage: (sc.power * cfg.emberPowerPct) / 100,
      hitIntervalTicks: Math.round(0.5 / world.dt),
      knockback: 0,
      angle: 0,
      life: flight + 0.12 + world.rng.next() * 0.25,
      stage: 3,
      armStage: 1,
      armLife: cfg.emberSeconds,
    });
  }
}
