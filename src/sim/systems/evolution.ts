import type { Player } from '../entities/player';
import type { World } from '../world';
import { recomputeModifiers } from './leveling';

/**
 * 進化の条件を満たしていれば進化する（01_game_design.md 5.2）。
 * - レベル: 原作どおりのレベルで進化する（レベルは全員で共有）
 * - 石: その石を持っていれば進化し、石はなくなる（イーブイなど。石が無ければ進化しない）
 * - 通信交換: つながりのヒモを持っていれば進化し、ヒモはなくなる
 * 1回で条件を満たす段階まで続けて進化する（高いレベルで途中から始めた場合など）。
 */
export function checkEvolution(world: World, p: Player): void {
  for (let guard = 0; guard < 4; guard++) {
    const sp = world.rules.species[p.species];
    if (!sp) return;
    const evo = sp.evolutions.find((e) => {
      if (e.trigger === 'level') return world.level >= e.level;
      return p.items.some((it) => it.item === e.item);
    });
    if (!evo) return;
    if (evo.trigger !== 'level') p.items = p.items.filter((it) => it.item !== evo.item);
    const from = p.species;
    p.species = evo.to;
    p.types = [...world.rules.species[evo.to]!.types];
    recomputeModifiers(world, p);
    world.events.push({ type: 'evolved', playerId: p.id, from, to: evo.to });
  }
}

export function checkEvolutionAll(world: World): void {
  for (const p of world.players) if (!p.down) checkEvolution(world, p);
}
