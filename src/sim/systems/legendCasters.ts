import { createPlayer, type Player } from '../entities/player';
import { emptyModifiers } from '../upgrades';
import type { World } from '../world';
import type { CasterMoveData } from '../../data/schema';
import { CASTER_ID_BASE, fireCasterMove, moveStatsOf } from './attack';

/**
 * 伝説がプレイヤーと同じ技を使う（色違いの御三家。作者の依頼 2026年10月27日）。
 * 伝説の場所に見えない術者（プレイヤーと同じ形）を置き、プレイヤーの技を出す処理をそのまま使って技を出す。
 * どのブラウザでも同じように動かし、当たったかは自分のプレイヤーで決める（attack.ts の hitLocalPlayer）。
 * - casters: 戦いの間ずっと出す技（かえんほうしゃ・ほのおのうず・はなびらのまい・ヘドロばくだん）
 * - shell: プレイヤーが離れると甲羅の形になり、速くなって技（こうそくスピン）を出しながら追う（カメックス）
 */
export function tickLegendCasters(world: World): void {
  const lg = world.legendary;
  if (!lg || !lg.spawned || lg.result) return;
  const e = world.enemies;
  let i = -1;
  for (let k = 0; k < e.count; k++) {
    if (e.kind[k] === lg.kind && e.hp[k]! > 0) {
      i = k;
      break;
    }
  }
  if (i === -1) return;
  const set = world.rules.stage.legendary?.moveSets[world.rules.enemies.kinds[lg.kind]?.id ?? ''];
  if (!set || (!set.casters?.length && !set.shell)) return;
  const id = e.id[i]!;
  const caster = casterFor(world, id, set.casterPower ?? 1);
  // 術者は伝説の場所で、一番近いプレイヤーの方を向く
  caster.prevX = caster.x;
  caster.prevY = caster.y;
  caster.x = e.x[i]!;
  caster.y = e.y[i]!;
  const target = nearestAlive(world, caster.x, caster.y);
  if (target) {
    const dx = target.x - caster.x;
    const dy = target.y - caster.y;
    const len = Math.hypot(dx, dy) || 1;
    caster.facingX = dx / len > 0.38 ? 1 : dx / len < -0.38 ? -1 : 0;
    caster.facingY = dy / len > 0.38 ? 1 : dy / len < -0.38 ? -1 : 0;
  }
  // 予告の間止まる技（ため）を待っている間は、技も甲羅も止める
  if (!world.legendAi || world.legendAi.enemyId !== id) {
    world.legendAi = { enemyId: id, timers: (set.casters ?? []).map(() => 0), shellTimers: (set.shell?.moves ?? []).map(() => 0), shell: false };
  }
  const ai = world.legendAi;
  if (ai.holdTicks) ai.holdTicks--;
  const charging = !!ai.holdTicks || world.hazards.some((h) => h.dasher === id && h.activeTicks === undefined && world.rules.stage.moves[h.move]?.rooted);
  // 甲羅の形（カメックス）: 離れたら甲羅、近づいたら戻る。甲羅の間は速い
  if (set.shell && target) {
    const d = Math.hypot(target.x - caster.x, target.y - caster.y);
    if (!ai.shell && d > set.shell.farDistance) ai.shell = true;
    else if (ai.shell && d < set.shell.nearDistance) ai.shell = false;
    const base = world.rules.enemies.kinds[lg.kind]?.moveSpeed ?? 0;
    e.speed[i] = charging ? 0 : ai.shell ? base * set.shell.speedMultiplier : base;
  }
  if (charging) return;
  const fire = (list: readonly CasterMoveData[], timers: number[]): void => {
    list.forEach((c, k) => {
      if ((timers[k] = (timers[k] ?? 0) - 1) > 0) return;
      const move = world.rules.moves.findIndex((m) => m.key === c.move);
      if (move === -1) return;
      const cd = c.everySeconds ?? moveStatsOf(world, { move, level: c.level }).cooldownSeconds;
      timers[k] = Math.max(1, Math.round(cd / world.dt));
      fireCasterMove(world, caster, move, c.level, c);
    });
  };
  if (ai.shell && set.shell) fire(set.shell.moves, ai.shellTimers);
  else fire(set.casters ?? [], ai.timers);
}

/** 伝説の敵 id の術者（無ければ作る）。威力は power 倍 */
export function casterFor(world: World, enemyId: number, power = 1): Player {
  let c = world.casters.get(enemyId);
  if (c) return c;
  c = createPlayer({ id: CASTER_ID_BASE + (world.casters.size % 5000), x: 0, y: 0, radius: 20, moveSpeed: 0, moves: [], remote: true, mods: emptyModifiers(world.rules.types.names.length) });
  c.physicalPower = power;
  c.specialPower = power;
  world.casters.set(enemyId, c);
  return c;
}

function nearestAlive(world: World, x: number, y: number): Player | null {
  let best: Player | null = null;
  let bd = Infinity;
  for (const p of world.players) {
    if (p.down) continue;
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}
