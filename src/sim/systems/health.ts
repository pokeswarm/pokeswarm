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
  const amount = ((raw * 100) / (100 + p.defense)) * Math.max(0, 1 + p.mods.damageTakenPct / 100);
  p.hp -= amount;
  p.invincibleTicks = Math.round(world.rules.stats.hurtInvincibleSeconds / world.dt);
  world.events.push({ type: 'playerDamaged', playerId: p.id, amount });
  if (p.hp <= 0) downOrRevive(world, p);
}

/**
 * HP が無くなったとき: 復活可能数（全員で共有）が残っていれば自動で復活する（ソロ）。無ければ倒れる。
 * 協力プレイの「触れて復活」はフェーズ3。
 */
function downOrRevive(world: World, p: Player): void {
  const cfg = world.rules.stats.revive;
  if (world.revives > 0) {
    world.revives--;
    p.hp = (p.maxHp * cfg.hpPct) / 100;
    p.invincibleTicks = Math.round(cfg.invincibleSeconds / world.dt);
    world.events.push({ type: 'playerRevived', playerId: p.id });
    return;
  }
  p.hp = 0;
  p.down = true;
  p.inputX = 0;
  p.inputY = 0;
  world.events.push({ type: 'playerDown', playerId: p.id });
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
