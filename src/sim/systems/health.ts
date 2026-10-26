import { activeLegendField } from './stage';
import type { PlayerId } from '../commands';
import type { Player } from '../entities/player';
import type { World } from '../world';

/**
 * 自分が敵に触れたかを判定し、ダメージを受ける（01_game_design.md 2.3: 自分に関わることは自分のブラウザで判定する）。
 * 無敵時間の間は受けない。重なっている敵のうち一番大きいダメージを1回だけ受ける。
 */
export function contactDamage(world: World): void {
  const me = world.players.find((p) => p.id === world.localPlayerId);
  if (!me || me.down || me.invincibleTicks > 0) return;
  const { enemies: e, enemyHash, scratch } = world;
  let maxR = 0;
  for (const k of world.rules.enemies.kinds) maxR = Math.max(maxR, k.radius);
  const reach = me.radius + maxR;
  const n = enemyHash.queryRect(me.x - reach, me.y - reach, me.x + reach, me.y + reach, scratch);
  let worst = 0;
  for (let k = 0; k < n; k++) {
    const i = scratch[k]!;
    if (e.hp[i]! <= 0 || e.damage[i]! <= 0) continue;
    const dx = e.x[i]! - me.x;
    const dy = e.y[i]! - me.y;
    const r = me.radius + e.radius[i]!;
    if (dx * dx + dy * dy <= r * r) worst = Math.max(worst, e.damage[i]!);
  }
  if (worst > 0) hurtPlayer(world, me, worst);
}

/** ダメージを受ける（防御・受けるダメージの倍率を掛ける）。HP が無くなったら復活するか倒れる */
export function hurtPlayer(world: World, p: Player, raw: number): void {
  // ドわすれの守り: 決まった間、受けるダメージを減らす
  const guard = p.guardUntilTick !== undefined && world.tick < p.guardUntilTick ? 1 - (p.guardPct ?? 0) / 100 : 1;
  // にらみつける（ファイヤー）: 伝説戦の間、防御が下がる
  const defense = p.defense * (activeLegendField(world)?.field.defenseMultiplier ?? 1);
  const amount = ((raw * 100) / (100 + defense)) * Math.max(0, 1 + p.mods.damageTakenPct / 100) * guard;
  p.hp -= amount;
  p.invincibleTicks = Math.round(world.rules.stats.hurtInvincibleSeconds / world.dt);
  world.events.push({ type: 'playerDamaged', playerId: p.id, amount });
  if (p.hp <= 0) downOrRevive(world, p);
}

/**
 * 自分の技で受けるダメージ（だいばくはつ）: 防御・受けるダメージの軽減は敵のダメージと同じく効くが、無敵時間は付けず、倒れない（1 は残す）
 */
export function selfDamage(world: World, p: Player, raw: number): void {
  const guard = p.guardUntilTick !== undefined && world.tick < p.guardUntilTick ? 1 - (p.guardPct ?? 0) / 100 : 1;
  const amount = Math.min(p.hp - 1, ((raw * 100) / (100 + p.defense)) * Math.max(0, 1 + p.mods.damageTakenPct / 100) * guard);
  if (amount <= 0) return;
  p.hp -= amount;
  world.events.push({ type: 'playerDamaged', playerId: p.id, amount });
}

/** 伝説戦のマップの効果のダメージ（ふぶき）: 防御は効かず、無敵時間も付けない。HP が無くなれば倒れる */
export function fieldDamage(world: World, p: Player, amount: number): void {
  if (amount <= 0 || p.down) return;
  p.hp -= amount;
  world.events.push({ type: 'playerDamaged', playerId: p.id, amount });
  if (p.hp <= 0) downOrRevive(world, p);
}

/**
 * HP が無くなったとき: 復活可能数（全員で共有）が残っていれば自動で復活する（ソロ）。無ければ倒れる。
 * 協力プレイでは倒れて、味方が触れると復活する（touchRevive）。
 */
function downOrRevive(world: World, p: Player): void {
  // 協力プレイでは自動で復活しない（触れて復活させる。復活可能数は全員で共有し、ホストが管理する）
  if (world.role === 'solo' && world.revives > 0) {
    revive(world, p);
    return;
  }
  p.hp = 0;
  p.down = true;
  p.inputX = 0;
  p.inputY = 0;
  world.events.push({ type: 'playerDown', playerId: p.id });
}

/** 復活させる: 共有の復活可能数を1つ使い、HP を戻して無敵時間を付ける */
export function revive(world: World, p: Player): void {
  const cfg = world.rules.stats.revive;
  world.revives = Math.max(0, world.revives - 1);
  p.down = false;
  p.hp = (p.maxHp * cfg.hpPct) / 100;
  p.invincibleTicks = Math.round(cfg.invincibleSeconds / world.dt);
  world.reviveTouch.delete(p.id);
  world.events.push({ type: 'playerRevived', playerId: p.id, revives: world.revives });
}

/**
 * 協力プレイの「触れて復活」（01_game_design.md 6章）: 倒れた味方の近くに、倒れていない誰かがいる間、時間を数える。
 * 決まった時間に達し、復活可能数が残っていれば、ホストが復活させて全員へ知らせる（ゲストは表示のために数えるだけ）。
 * 離れると数え直し。
 */
export function touchRevive(world: World): void {
  if (world.role === 'solo') return;
  const cfg = world.rules.stats.revive;
  const need = Math.round(cfg.touchSeconds / world.dt);
  for (const [id, left] of world.reviveGrace) {
    if (left <= 1) world.reviveGrace.delete(id);
    else world.reviveGrace.set(id, left - 1);
  }
  for (const p of world.players) {
    if (!p.down) {
      world.reviveTouch.delete(p.id);
      continue;
    }
    const r = cfg.touchRange + p.radius;
    const touched = world.players.some((q) => q !== p && !q.down && (q.x - p.x) ** 2 + (q.y - p.y) ** 2 <= r * r);
    if (!touched || world.revives <= 0) {
      world.reviveTouch.delete(p.id);
      continue;
    }
    const t = (world.reviveTouch.get(p.id) ?? 0) + 1;
    world.reviveTouch.set(p.id, Math.min(t, need));
    if (t >= need && world.role === 'host') {
      revive(world, p);
      world.reviveGrace.set(p.id, Math.round(1 / world.dt));
    }
  }
}

/** 協力プレイ: ホストが復活させたことを受け取る（自分なら HP を戻す。残りの復活可能数もそろえる） */
export function applyRevive(world: World, playerId: PlayerId, revives: number): void {
  const p = world.players.find((x) => x.id === playerId);
  world.revives = revives;
  if (!p) return;
  const cfg = world.rules.stats.revive;
  p.down = false;
  world.reviveTouch.delete(p.id);
  if (p.id === world.localPlayerId) {
    p.hp = (p.maxHp * cfg.hpPct) / 100;
    p.invincibleTicks = Math.round(cfg.invincibleSeconds / world.dt);
  }
  world.events.push({ type: 'playerRevived', playerId, revives });
}

/** 自分の HP を回復する（自分の HP は自分のブラウザで管理するので、ほかのプレイヤーの分は回復しない） */
export function healPlayer(world: World, playerId: PlayerId, amount: number): void {
  if (playerId !== world.localPlayerId || amount <= 0) return;
  const p = world.players.find((x) => x.id === playerId);
  if (!p || p.down) return;
  p.hp = Math.min(p.maxHp, p.hp + amount);
}

/** たべのこしなどの自然回復 */
export function regenerate(world: World): void {
  for (const p of world.players) {
    if (p.mods.regenPerSecond > 0) healPlayer(world, p.id, p.mods.regenPerSecond * world.dt);
  }
}
