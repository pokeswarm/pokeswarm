import { describe, it } from 'vitest';
import { playerConfig, simulationConfig } from '../data';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import { Simulation } from './simulation';
import { elapsedSeconds } from './world';

/**
 * 放置の確かめ（作者の指摘 2026年11月3日: 自分を中心に押し出す技があると、ランを放置できる）。
 * 技を 1 つだけ最大レベルで持ち、一歩も動かず、レベルアップは何も選ばない。区間を進めて敵の数と強さを上げ、
 * 受けたダメージと倒した数を測る。比べるために、向いている方へ撃つ技も同じ条件で回す。
 * 例: AFK_REGION=hoenn npm run balance -- -t "放置"
 */
const REGION = process.env.AFK_REGION ?? 'hoenn';
const SECONDS = Number(process.env.AFK_SECONDS ?? 240);
const MOVES = (process.env.AFK_MOVES ?? 'surf,muddy-water,psychic,earthquake,lava-plume,dark-pulse,snarl,wild-charge,flare-blitz,petal-dance,flamethrower,hydro-pump,thunderbolt').split(',');

function afk(move: string): string {
  const rules = buildSimRules(REGION);
  const sim = new Simulation({ tickRate: simulationConfig.tickRate, seed: 7, rules });
  const m = moveIndexOf(rules, move);
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: playerConfig.radius, moveSpeed: playerConfig.moveSpeed, moves: [{ move: m, level: rules.moves[m]!.levels.length }] });
  const w = sim.world;
  let taken = 0;
  let hits = 0;
  const startHp = p.maxHp;
  while (elapsedSeconds(w) < SECONDS) {
    if (w.levelUp && !w.levelUp.done.has(1)) {
      sim.step([{ type: 'skipUpgrade', playerId: 1 }]);
      continue;
    }
    sim.step([]);
    for (const ev of w.events) if (ev.type === 'playerDamaged' && ev.playerId === 1) { taken += ev.amount; hits++; }
    // 倒れても続ける（受けたダメージの合計を見るため）
    if (p.hp < p.maxHp * 0.5) p.hp = p.maxHp;
  }
  return `${move.padEnd(14)} 受けたダメージ ${Math.round(taken).toString().padStart(6)}（最大HP ${Math.round(startHp)} の ${(taken / startHp).toFixed(1).padStart(5)} 回分・${hits} 回） 撃破 ${w.stats.kills}`;
}

describe('放置の確かめ', () => {
  it(`技 1 つ・最大レベル・動かない（${REGION}・${SECONDS} 秒）`, () => {
    for (const k of MOVES) console.log(afk(k));
  }, 600_000);
});
