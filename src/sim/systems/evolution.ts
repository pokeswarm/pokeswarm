import type { Player } from '../entities/player';
import type { World } from '../world';
import { recomputeModifiers } from './leveling';

/**
 * 進化の条件を満たしていれば進化する（01_game_design.md 5.2）。
 * - レベル: 原作どおりのレベルで進化する（レベルは全員で共有）
 * - 石: その石を持っていれば進化し、石はなくなる（イーブイなど。石が無ければ進化しない）
 * - 通信交換: つながりのヒモを持っていれば進化し、ヒモはなくなる
 * - なつき: ランで歩いた距離が friendshipDistance を超えたら進化する（原作のなつき度のオマージュ。07 の57章・66.2）
 * 1回で条件を満たす段階まで続けて進化する（高いレベルで途中から始めた場合など）。
 */
export function checkEvolution(world: World, p: Player): void {
  for (let guard = 0; guard < 4; guard++) {
    const sp = world.rules.species[p.species];
    if (!sp) return;
    const evo = sp.evolutions.find((e) => {
      if (e.trigger === 'level') return world.level >= e.level;
      if (e.trigger === 'friendship') return p.walked >= world.rules.friendshipDistance && (!e.time || e.time === timeOfDay(world));
      return p.items.some((it) => it.item === e.item);
    });
    if (!evo) return;
    // 時間帯のなつきの進化（イーブイ）: 本人のブラウザで聞く（ほかのブラウザは本人から届いた姿に合わせる）。キャンセルした区間の間は聞かない
    if (evo.trigger === 'friendship' && evo.time) {
      if (p.remote || p.evolveAsk !== undefined || p.evolveDeclinedSection === world.section) return;
      p.evolveAsk = evo.to;
      world.events.push({ type: 'evolveAsk', playerId: p.id, from: p.species, to: evo.to });
      return;
    }
    if (evo.trigger === 'item' || evo.trigger === 'trade') p.items = p.items.filter((it) => it.item !== evo.item);
    evolveInto(world, p, evo.to, false);
  }
}

/** 今の区間の時間帯。夜のある地方（ジョウト）だけ。カントーには昼夜を入れない（07 の66.2）ので、時間帯のなつきの進化はしない */
function timeOfDay(world: World): 'day' | 'night' | null {
  const nights = world.rules.nightSections;
  if (!nights?.some(Boolean)) return null;
  return nights[world.section] ? 'night' : 'day';
}

function evolveInto(world: World, p: Player, to: number, asked: boolean): void {
  const from = p.species;
  p.species = to;
  p.types = [...world.rules.species[to]!.types];
  world.events.push({ type: 'evolved', playerId: p.id, from, to, ...(asked && { asked: true }) });
  applyForm(world, p);
  recomputeModifiers(world, p);
}

/** 聞いた進化への答え（本人のブラウザ）: 進化するか、キャンセルしてその区間の間は聞かない */
export function answerEvolution(world: World, p: Player, accept: boolean): void {
  const to = p.evolveAsk;
  if (to === undefined) return;
  p.evolveAsk = undefined;
  if (accept) evolveInto(world, p, to, true);
  else p.evolveDeclinedSection = world.section;
}

/** 別のブラウザのプレイヤーの姿（本人から届いた）に合わせる。時間帯のなつきの進化だけ（ほかの進化はどのブラウザでも同じように起きる） */
export function followRemoteSpecies(world: World, p: Player, species: number): void {
  if (!p.remote || p.species === species) return;
  const evo = world.rules.species[p.species]?.evolutions.find((e) => e.to === species && e.trigger === 'friendship' && e.time);
  if (evo) evolveInto(world, p, species, false);
}

/**
 * 進化した姿の決まり（ベイビィポケモン。07 の57章・66.4）: becomes ならその系統になり（技を覚えない などを引き継ぎ、最初の技を覚える）、
 * formMoves ならその技を覚える。技が埋まっていれば覚えない
 */
function applyForm(world: World, p: Player): void {
  const lines = world.rules.lines;
  if (!lines) return;
  const learn = (move: number): void => {
    if (move < 0 || p.moves.some((m) => m.move === move) || p.moves.length >= world.rules.combat.maxMoveSlots) return;
    p.moves.push({ move, level: 1, cooldown: 0, burstLeft: 0, burstTimer: 0 });
    world.events.push({ type: 'moveTaught', playerId: p.id, move });
  };
  const become = lines[p.line]?.becomes.find((b) => b.form === p.species && lines[b.line]);
  if (become) {
    const to = lines[become.line]!;
    p.line = become.line;
    p.fixedMoves = to.fixedMoves;
    p.moveTypes = to.moveTypes;
    if (to.types) p.types = [...to.types];
    for (const m of to.startingMoves) learn(m);
  }
  for (const f of lines[p.line]?.formMoves ?? []) if (f.form === p.species) learn(f.move);
}

export function checkEvolutionAll(world: World): void {
  for (const p of world.players) if (!p.down) checkEvolution(world, p);
}
