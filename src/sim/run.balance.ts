import { describe, it } from 'vitest';
import { playerConfig, playablesConfig, simulationConfig } from '../data';
import { buildSimRules, playableLoadout } from '../data/simRules';
import type { Axis, InputCommand } from './commands';
import { Simulation } from './simulation';
import { elapsedSeconds, enemyHpScale, type UpgradeOffer } from './world';

/**
 * 1ランをシミュレーションだけで速く回して、レベルの上がり方を確かめる（npm run balance。01_game_design.md 3.1）。
 * 目安: 永続強化もパッシブも無い状態で、15分の終わりにレベル50前後。
 *
 * 自動で動くプレイヤー:
 * - 倒れない（経験値の量を測るため。生き残れるかはバランス調整で別に見る）
 * - 一番近い敵へ向かって歩く（向いている方向に撃つ技・近接の技も当たり、玉も拾える）。倒れないので積極的に戦う人に近い
 * - 経験値の玉が上限近くまでたまったら（新しい経験値は一番古い玉にまとめられる）、一番大きな玉を拾いに行く
 * - レベルアップでは 派生・固有技 > 技の強化 > 新しい技 > 持ち物 の順で選ぶ
 */
const OFFER_PRIORITY: Record<UpgradeOffer['kind'], number> = { derive: 0, moveUp: 1, moveNew: 2, itemNew: 3, itemUp: 4, heal: 5, coins: 6 };
/** 向きを変える間隔（毎回変えると細かく揺れるだけになる） */
const RETARGET_SECONDS = 0.3;
/** 打ち切る時間（ランは20分で終わる。伝説戦があればその分長くなる） */
const LIMIT_SECONDS = 25 * 60;
/** 固さを測るときの「近く」の距離 */
const NEAR = 250;

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
    moveTypes: loadout.moveTypes,
    fixedMoves: loadout.fixedMoves,
    learnsAll: loadout.learnsAll,
    moves: loadout.moves,
    line: loadout.line,
    species: loadout.species,
  });
  const w = sim.world;
  const byMinute: number[] = [];
  const killsByMinute: number[] = [];
  const evolutions: string[] = [];
  const sections: string[] = [];
  // 区間ごとの、画面にいる敵の数の平均（群れの圧力の目安）
  const enemySum: number[] = [];
  const enemyTicks: number[] = [];
  // 区間ごとの、雑魚がプレイヤーの近く（NEAR）に来てから倒されるまでの平均の秒数（固さの目安。歩いてくる時間は数えない）と HP の倍率
  const bornAt = new Map<number, number>();
  const lifeSum: number[] = [];
  const lifeCount: number[] = [];
  const hpScaleAt: number[] = [];
  // 中ボス・ボス・伝説が出てから倒されるまでの秒数
  const bossAt = new Map<number, number>();
  const bossTimes: string[] = [];
  const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
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
    enemySum[w.section] = (enemySum[w.section] ?? 0) + w.enemies.count;
    enemyTicks[w.section] = (enemyTicks[w.section] ?? 0) + 1;
    hpScaleAt[w.section] = enemyHpScale(w);
    for (let i = 0; i < w.enemies.count; i++) {
      if (bornAt.has(w.enemies.id[i]!)) continue;
      if ((w.enemies.x[i]! - p.x) ** 2 + (w.enemies.y[i]! - p.y) ** 2 < NEAR * NEAR) bornAt.set(w.enemies.id[i]!, w.tick);
    }
    for (const ev of w.events) {
      if (ev.type === 'enemyKilled') {
        const born = bornAt.get(ev.enemyId);
        bornAt.delete(ev.enemyId);
        if (born !== undefined && (w.rules.enemies.kinds[ev.kind]!.rank ?? 'normal') === 'normal') {
          lifeSum[w.section] = (lifeSum[w.section] ?? 0) + (w.tick - born) / tickRate;
          lifeCount[w.section] = (lifeCount[w.section] ?? 0) + 1;
        }
      }
      if (ev.type === 'bossAppeared' && w.rules.enemies.kinds[ev.kind]!.rank === 'boss') bossSeenAt = elapsedSeconds(w);
      if (ev.type === 'bossAppeared') bossAt.set(ev.kind, w.tick);
      if (ev.type === 'enemyKilled' && bossAt.has(ev.kind)) {
        bossTimes.push(`${w.rules.enemies.kinds[ev.kind]!.id.replace(/^(midboss|boss|legend)-/, '')} ${Math.round((w.tick - bossAt.get(ev.kind)!) / tickRate)}`);
        bossAt.delete(ev.kind);
      }
      if (ev.type === 'sectionAdvanced') sections.push(fmt(elapsedSeconds(w)));
      if (ev.type === 'evolved') evolutions.push(`${Math.floor(elapsedSeconds(w) / 60)}分 ${w.rules.species[ev.to]!.key}`);
    }
    const minute = Math.floor(elapsedSeconds(w) / 60);
    if (!w.levelUp && byMinute.length <= minute && w.tick % (60 * tickRate) === 0) {
      byMinute.push(w.level);
      killsByMinute.push(w.stats.kills);
    }
  }
  const ms = performance.now() - t0;
  const name = pokemon.padEnd(10);
  console.log(
    `${name} 結果 ${w.outcome ?? '時間切れ'}  時間 ${fmt(elapsedSeconds(w))}  レベル ${w.level}  撃破 ${w.stats.kills}  ` +
      `ボス出現 ${bossSeenAt < 0 ? '-' : fmt(bossSeenAt)}  出た中ボス・ボス ${w.nextBoss}  （${steps} 回, ${(ms / 1000).toFixed(1)} 秒）`,
  );
  console.log(`${name} 分ごとのレベル ${byMinute.map((l, i) => `${i}:${l}`).join(' ')}`);
  console.log(`${name} 四天王の残り ${w.requiredLeft.size}  伝説 ${w.legendary ? `${w.rules.enemies.kinds[w.legendary.kind]!.id} ${w.legendary.result}` : '-'}`);
  console.log(`${name} 区間が進んだ時刻 ${sections.join(' ') || '-'}`);
  console.log(`${name} 区間ごとの敵の数（平均） ${enemySum.map((n, i) => `${i}:${Math.round(n / enemyTicks[i]!)}`).join(' ')}`);
  console.log(`${name} 区間ごとの雑魚の HP の倍率（区間の終わり） ${hpScaleAt.map((v, i) => `${i}:${v.toFixed(1)}`).join(' ')}`);
  console.log(`${name} 区間ごとの雑魚が近くに来てから倒されるまで（秒） ${lifeSum.map((v, i) => `${i}:${(v / lifeCount[i]!).toFixed(1)}`).join(' ')}`);
  console.log(`${name} ボスを倒すまで（秒） ${bossTimes.join(' / ') || '-'}`);
  console.log(`${name} 進化 ${evolutions.join(' → ') || '-'}`);
  console.log(`${name} 分ごとの撃破数 ${killsByMinute.map((k, i) => `${i}:${k}`).join(' ')}`);
  console.log(`${name} 技 ${p.moves.map((m) => `${w.rules.moves[m.move]!.key}:${m.level}`).join(' ')}  持ち物 ${p.items.map((it) => `${w.rules.items[it.item]!.key}:${it.level}`).join(' ')}`);
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
