import { describe, it } from 'vitest';
import { playerConfig, playablesConfig, simulationConfig } from '../data';
import { buildSimRules, playableLoadout } from '../data/simRules';
import type { Axis, InputCommand } from './commands';
import { Simulation } from './simulation';
import { elapsedSeconds, type UpgradeOffer } from './world';

/**
 * 1ランをシミュレーションだけで速く回して、レベルの上がり方を確かめる（npm run balance。01_game_design.md 3.1）。
 * 目安: 永続強化もパッシブも無い状態で、15分の終わりにレベル50前後。
 *
 * 自動で動くプレイヤー:
 * - 倒れない（経験値の量を測るため。生き残れるかはバランス調整で別に見る）
 * - 一番近い敵へ向かって歩く（向いている方向に撃つ技・近接の技も当たり、玉も拾える）。倒れないので積極的に戦う人に近い
 * - 経験値の玉が上限近くまでたまったら（新しい経験値は一番古い玉にまとめられる）、一番大きな玉を拾いに行く
 * - レベルアップでは 派生・固有技 > 技の強化 > 新しい技 > 持ち物 > パッシブ の順で選ぶ
 */
const OFFER_PRIORITY: Record<UpgradeOffer['kind'], number> = { derive: 0, moveUp: 1, moveNew: 2, itemNew: 3, itemUp: 4, passiveNew: 5, passiveUp: 6 };
/** 向きを変える間隔（毎回変えると細かく揺れるだけになる） */
const RETARGET_SECONDS = 0.3;
/** ボスが倒せないときに打ち切る時間 */
const LIMIT_SECONDS = 20 * 60;

function simulateRun(pokemon: string): void {
  const rules = buildSimRules();
  const tickRate = simulationConfig.tickRate;
  const sim = new Simulation({ tickRate, seed: 12345, rules });
  const loadout = playableLoadout(rules, pokemon);
  const p = sim.addPlayer({
    id: 1,
    x: 0,
    y: 0,
    radius: playerConfig.radius,
    moveSpeed: playerConfig.moveSpeed,
    pickupRange: playerConfig.pickupRange,
    types: loadout.types,
    moves: loadout.moves,
    line: loadout.line,
    species: loadout.species,
  });
  const w = sim.world;
  const byMinute: number[] = [];
  const killsByMinute: number[] = [];
  let bossSeenAt = -1;
  let dir = '';
  const t0 = performance.now();
  let steps = 0;
  while (!w.outcome && elapsedSeconds(w) < LIMIT_SECONDS) {
    const cmds: InputCommand[] = [];
    if (w.levelUp) {
      const offers = w.levelUp.offers.get(1) ?? [];
      if (!w.levelUp.done.has(1)) {
        let best = 0;
        offers.forEach((o, i) => {
          if (OFFER_PRIORITY[o.kind] < OFFER_PRIORITY[offers[best]!.kind]) best = i;
        });
        cmds.push(offers.length ? { type: 'chooseUpgrade', playerId: 1, index: best } : { type: 'skipUpgrade', playerId: 1 });
      }
    } else {
      if (w.tick % Math.round(RETARGET_SECONDS * tickRate) === 0) {
        const [dx, dy] = w.gems.count >= w.gems.capacity * 0.8 ? towardBiggestGem(sim, p.x, p.y) : towardNearestEnemy(sim, p.x, p.y);
        if (`${dx},${dy}` !== dir) {
          dir = `${dx},${dy}`;
          cmds.push({ type: 'move', playerId: 1, dx, dy });
        }
      }
      p.invincibleTicks = 2;
    }
    sim.step(cmds);
    steps++;
    for (const ev of w.events) {
      if (ev.type === 'bossAppeared' && w.rules.enemies.kinds[ev.kind]!.rank === 'boss') bossSeenAt = elapsedSeconds(w);
    }
    const minute = Math.floor(elapsedSeconds(w) / 60);
    if (!w.levelUp && byMinute.length <= minute && w.tick % (60 * tickRate) === 0) {
      byMinute.push(w.level);
      killsByMinute.push(w.stats.kills);
    }
  }
  const ms = performance.now() - t0;
  const name = pokemon.padEnd(10);
  const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  console.log(
    `${name} 結果 ${w.outcome ?? '時間切れ'}  時間 ${fmt(elapsedSeconds(w))}  レベル ${w.level}  撃破 ${w.stats.kills}  ` +
      `ボス出現 ${bossSeenAt < 0 ? '-' : fmt(bossSeenAt)}  出た中ボス・ボス ${w.nextBoss}  （${steps} 回, ${(ms / 1000).toFixed(1)} 秒）`,
  );
  console.log(`${name} 分ごとのレベル ${byMinute.map((l, i) => `${i}:${l}`).join(' ')}`);
  console.log(`${name} 分ごとの撃破数 ${killsByMinute.map((k, i) => `${i}:${k}`).join(' ')}`);
  console.log(`${name} 技 ${p.moves.map((m) => `${w.rules.moves[m.move]!.key}:${m.level}`).join(' ')}  持ち物 ${p.items.length}  パッシブ ${p.passives.length}`);
}

/** 一番近い敵への向き（8方向）。敵がいなければ止まる */
function towardNearestEnemy(sim: Simulation, x: number, y: number): [Axis, Axis] {
  const e = sim.world.enemies;
  let best = Infinity;
  let tx = x;
  let ty = y;
  for (let i = 0; i < e.count; i++) {
    const d2 = (e.x[i]! - x) ** 2 + (e.y[i]! - y) ** 2;
    if (d2 < best) {
      best = d2;
      tx = e.x[i]!;
      ty = e.y[i]!;
    }
  }
  return toward(x, y, tx, ty);
}

/** 一番経験値の多い玉への向き */
function towardBiggestGem(sim: Simulation, x: number, y: number): [Axis, Axis] {
  const g = sim.world.gems;
  let best = -1;
  for (let i = 0; i < g.count; i++) if (best === -1 || g.value[i]! > g.value[best]!) best = i;
  return best === -1 ? [0, 0] : toward(x, y, g.x[best]!, g.y[best]!);
}

function toward(x: number, y: number, tx: number, ty: number): [Axis, Axis] {
  const dx = tx - x;
  const dy = ty - y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return [0, 0];
  const axis = (v: number): Axis => (v / len > 0.38 ? 1 : v / len < -0.38 ? -1 : 0);
  return [axis(dx), axis(dy)];
}

describe('1ランのレベルの上がり方', () => {
  for (const pokemon of Object.keys(playablesConfig.pokemon)) {
    it(pokemon, () => simulateRun(pokemon), 600_000);
  }
});
