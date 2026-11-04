import { describe, it } from 'vitest';
import { playerConfig, shopConfig, simulationConfig } from '../data';
import { buildSimRules, permanentModifiers, playableLoadout } from '../data/simRules';
import { permanentBonus } from '../meta/shop';
import { emptySave } from '../meta/saveData';
import type { Axis, InputCommand } from './commands';
import { Simulation } from './simulation';
import { CASTER_ID_BASE } from './systems/attack';
import { hazardHits, legendRoundKinds, startLegendary } from './systems/stage';
import type { UpgradeOffer } from './world';

/**
 * レッド戦の測り方（07 の193章）: ワタルまでを倒れない自動プレイヤーで進めて技をそろえ、レッド戦からは倒れるようにして、
 * 予告を避けながら戦う自動プレイヤーで 3 ラウンドを回す。
 * 例: RED_LINES=cyndaquil,zubat npx vitest run --mode balance --silent=false src/sim/redBattle.balance.ts（RED_ROUND=2 でそのラウンドだけ。RED_IDEAL=1 で相手を止めて、全部当たれば出る火力を見る）
 * 出る値: 相手に当てられた時間の割合（1 秒ごとにダメージが入ったか）・隠れている割合・受けたダメージ（最大 HP の何回分か）・回復した量。
 * 避け方は人より単純なので、数字は変更の前後を比べるために使う。
 */
const UPGRADES = Number(process.env.BALANCE_UPGRADES ?? 3);
const LINES = (process.env.RED_LINES ?? 'cyndaquil,totodile,chikorita,pichu,larvitar,zubat,heracross,mareep').split(',');
/** 区間の途中でもこの時刻でクリアにして、レッド戦へ進む */
const CLEAR_AT_SECONDS = 22 * 60;
/** 1 ラウンドだけ測る（1〜3）。IDEAL=1 なら、相手を動かさず技も出させない（当たれば出る火力の上限） */
const ONLY_ROUND = Number(process.env.RED_ROUND ?? 0);
const IDEAL = process.env.RED_IDEAL === '1';
/** はねの戦いを 1 戦だけ測る（legend-lugia・legend-ho-oh） */
const ONLY_KIND = process.env.RED_KIND;
const PRIORITY: Record<UpgradeOffer['kind'], number> = { derive: 0, moveUp: 1, moveNew: 2, itemNew: 3, itemUp: 4, heal: 5, coins: 6 };
/** レッド戦に入るときの技（クリアまで来た人の組み立ての例。自動プレイヤーの技の選び方は単純で固有技まで届かないので、ここで入れ替える） */
const BUILDS: Record<string, string[]> = {
  cyndaquil: ['flare-blitz', 'eruption', 'flamethrower', 'swift'],
  totodile: ['slash', 'crunch', 'hydro-pump', 'water-gun'],
  chikorita: ['razor-leaf', 'leaf-storm', 'solar-beam', 'giga-drain'],
  pichu: ['volt-tackle', 'thunder', 'thunderbolt', 'swift'],
  larvitar: ['rock-blast', 'stone-edge', 'earthquake', 'dark-pulse'],
  zubat: ['cross-poison', 'air-slash', 'aerial-ace', 'gust'],
  heracross: ['fury-cutter', 'megahorn', 'revenge', 'arm-thrust'],
  mareep: ['zap-cannon', 'thunderbolt', 'discharge', 'swift'],
};
/** 近くでしか当たらない技が中心の系統（動いている間も近づいて戦う） */
const MELEE = new Set(['totodile', 'heracross']);
const DIRS: [Axis, Axis][] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

interface Stat {
  ticks: number;
  hidden: number;
  fast: number;
  still: number;
  secHit: number;
  sec: number;
  dmgInSec: number;
  hurt: number;
  healed: number;
  dmg: number;
  minHp: number;
}
const newStat = (): Stat => ({ ticks: 0, hidden: 0, fast: 0, still: 0, secHit: 0, sec: 0, dmgInSec: 0, hurt: 0, healed: 0, dmg: 0, minHp: 1 });

function run(line: string): void {
  const rules = buildSimRules('johto');
  // 区間の時間切れでランを終わらせない（途中は倒れない自動プレイヤーで技をそろえるだけ）
  (rules.stage.bossRules as { gateTimeLimitSeconds?: number }).gateTimeLimitSeconds = 1e9;
  const save = emptySave();
  for (const def of shopConfig.upgrades) save.upgrades[def.id] = Math.min(UPGRADES, def.maxLevel);
  const bonus = permanentBonus(save, shopConfig);
  const tickRate = simulationConfig.tickRate;
  const sim = new Simulation({ tickRate, seed: 777, rules });
  const lo = playableLoadout(rules, line);
  const p = sim.addPlayer({
    id: 1,
    x: 0,
    y: 0,
    radius: playerConfig.radius,
    moveSpeed: playerConfig.moveSpeed,
    pickupRange: playerConfig.pickupRange,
    types: lo.types,
    moveTypes: lo.moveTypes,
    fixedMoves: lo.fixedMoves,
    learnsAll: lo.learnsAll,
    moves: lo.moves,
    line: lo.line,
    species: lo.species,
    permanent: permanentModifiers(rules, bonus.levels),
    rerolls: rules.leveling.initialRerolls + bonus.rerolls,
    bans: bonus.bans,
  });
  const w = sim.world;
  const kinds = rules.enemies.kinds;
  let dir = '';
  let round = -1;
  let stat = newStat();
  let prevBoss = 0;
  let hurtBy: Record<string, number> = {};
  const report = (label: string): void => {
    const s = stat;
    if (!s.ticks) return;
    const secs = s.ticks / tickRate;
    console.log(
      `${line.padEnd(10)} ${label.padEnd(4)} ${secs.toFixed(0).padStart(4)}秒 当てられた時間 ${Math.round((100 * s.secHit) / Math.max(1, s.sec))}% 隠れる ${Math.round((100 * s.hidden) / s.ticks)}% 走る ${Math.round((100 * s.fast) / s.ticks)}% 止まる ${Math.round((100 * s.still) / s.ticks)}% ` +
        `与えた ${Math.round(s.dmg)}（毎秒 ${Math.round(s.dmg / secs)}） 受けた 最大HPの ${(s.hurt / p.maxHp).toFixed(2)} 回分（毎分 ${((s.hurt / p.maxHp) * 60 / secs).toFixed(2)}） 回復 ${(s.healed / p.maxHp).toFixed(2)} 最低HP ${Math.round(s.minHp * 100)}%`,
    );
  };
  let guard = 0;
  let forced = false;
  while (!w.outcome && guard++ < 30 * 60 * 80) {
    const cmds: InputCommand[] = [];
    if (!forced && !w.levelUp && (w.legendary || w.tick >= CLEAR_AT_SECONDS * tickRate)) {
      forced = true;
      if (ONLY_KIND) startLegendary(w, kinds.findIndex((k) => k.id === ONLY_KIND));
      else if (ONLY_ROUND) {
        const r = rules.stage.legendary!.rounds![ONLY_ROUND - 1]!;
        startLegendary(w, kinds.findIndex((k) => k.id === r.kinds[0]), ONLY_ROUND - 1);
      } else w.requiredLeft.clear();
      p.moves = (BUILDS[line] ?? []).map((key) => ({ move: rules.moves.findIndex((m) => m.key === key), level: rules.moves.find((m) => m.key === key)!.levels.length, cooldown: 0, burstLeft: 0, burstTimer: 0 }));
    }
    const lg = w.legendary;
    if (w.levelUp) {
      const offers = w.levelUp.offers.get(1) ?? [];
      if (!w.levelUp.done.has(1)) {
        let best = 0;
        offers.forEach((o, i) => {
          if (PRIORITY[o.kind] < PRIORITY[offers[best]!.kind]) best = i;
        });
        cmds.push(offers.length ? { type: 'chooseUpgrade', playerId: 1, index: best } : { type: 'skipUpgrade', playerId: 1 });
      }
    } else if (!lg) {
      p.invincibleTicks = 2;
      if (w.tick % 9 === 0) {
        const e = w.enemies;
        let bd = Infinity;
        let tx = p.x;
        let ty = p.y;
        for (let i = 0; i < e.count; i++) {
          const d = (e.x[i]! - p.x) ** 2 + (e.y[i]! - p.y) ** 2;
          if (d < bd) {
            bd = d;
            tx = e.x[i]!;
            ty = e.y[i]!;
          }
        }
        const dx = tx - p.x;
        const dy = ty - p.y;
        const len = Math.hypot(dx, dy) || 1;
        const a = (v: number): Axis => (v / len > 0.38 ? 1 : v / len < -0.38 ? -1 : 0);
        const nd = `${a(dx)},${a(dy)}`;
        if (nd !== dir) {
          dir = nd;
          cmds.push({ type: 'move', playerId: 1, dx: a(dx), dy: a(dy) });
        }
      }
    } else if (w.tick % 3 === 0) {
      // 避ける: 8 方向と止まるのうち、少し先の場所が予告に入らず、相手から程よい距離のものを選ぶ。落ちている道具へも寄る
      const e = w.enemies;
      let bd = Infinity;
      let tx = p.x;
      let ty = p.y;
      let near = -1;
      for (let i = 0; i < e.count; i++) {
        if (e.hp[i]! <= 0) continue;
        const d = (e.x[i]! - p.x) ** 2 + (e.y[i]! - p.y) ** 2;
        if (d < bd) {
          bd = d;
          tx = e.x[i]!;
          ty = e.y[i]!;
          near = i;
        }
      }
      // 相手が止まっている間（隙）は近づいて前を向く（向いている方へ出す技・近くの技を当てる）。動いている間は離れて避ける
      const open = near !== -1 && e.speed[near] === 0 && !w.bosses.find((b) => b.id === e.id[near])?.bounce;
      const wantDistance = open || MELEE.has(line) ? e.radius[near < 0 ? 0 : near]! + 60 : 230;
      // HP が減っていて きずぐすり が落ちていれば、拾いに行く
      let potion: { x: number; y: number } | null = null;
      if (p.hp < p.maxHp * 0.7) {
        let pd = Infinity;
        for (const it of w.items) {
          const d = (it.x - p.x) ** 2 + (it.y - p.y) ** 2;
          if (it.kind === 'potion' && d < pd) {
            pd = d;
            potion = it;
          }
        }
      }
      let best: [Axis, Axis] = [0, 0];
      let bs = -Infinity;
      for (const [dx, dy] of DIRS) {
        const n = dx && dy ? Math.SQRT1_2 : 1;
        let score = 0;
        for (const look of [0.15, 0.35, 0.6]) {
          const x = p.x + dx * n * p.moveSpeed * look;
          const y = p.y + dy * n * p.moveSpeed * look;
          for (const hz of w.hazards) {
            const m = rules.stage.moves[hz.move];
            if (!hz.damage && !hz.damageOverride && !m?.damage) continue;
            // 飛んでいる星・走る波は、少し先の場所で見る
            const moving = hz.activeTicks !== undefined && (hz.vx || hz.vy);
            const at = moving ? { ...hz, x: hz.x + (hz.vx ?? 0) * look, y: hz.y + (hz.vy ?? 0) * look } : hz;
            if (hazardHits(at, x, y, p.radius + 6, m)) score -= moving ? 400 : 100 / (0.1 + hz.ticksLeft / tickRate);
          }
          // ボスが出したプレイヤーの技（術者の玉）も避ける
          const pr = w.projectiles;
          for (let i = 0; i < pr.count; i++) {
            if (pr.owner[i]! < CASTER_ID_BASE) continue;
            const px = pr.x[i]! + pr.vx[i]! * look;
            const py = pr.y[i]! + pr.vy[i]! * look;
            if ((px - x) ** 2 + (py - y) ** 2 < (pr.radius[i]! + p.radius + 6) ** 2) score -= 200;
          }
          for (let i = 0; i < e.count; i++) {
            if (e.hp[i]! > 0 && (e.x[i]! - x) ** 2 + (e.y[i]! - y) ** 2 < (e.radius[i]! + p.radius + 30) ** 2) score -= 40;
          }
        }
        const d = Math.hypot(tx - (p.x + dx * n * 40), ty - (p.y + dy * n * 40));
        score -= Math.abs(d - wantDistance) * 0.08;
        if (potion) score -= Math.hypot(potion.x - (p.x + dx * n * 40), potion.y - (p.y + dy * n * 40)) * 0.2;
        if (score > bs) {
          bs = score;
          best = [dx, dy];
        }
      }
      const nd = `${best[0]},${best[1]}`;
      if (nd !== dir) {
        dir = nd;
        cmds.push({ type: 'move', playerId: 1, dx: best[0], dy: best[1] });
      }
    }
    if (IDEAL && w.legendary?.spawned) {
      const e = w.enemies;
      const round = legendRoundKinds(w, w.legendary.kind);
      let k = 0;
      for (let i = 0; i < e.count; i++) {
        if (e.hp[i]! <= 0 || !round.includes(e.kind[i]!)) continue;
        e.x[i] = e.prevX[i] = p.x + e.radius[i]! + 70 + k * 40;
        e.y[i] = e.prevY[i] = p.y + k * 40;
        k++;
      }
      for (const b of w.bosses) b.cooldown = 999;
      w.hazards.length = 0;
      p.invincibleTicks = 2;
      p.facingX = 1;
      p.facingY = 0;
    }
    const hpBefore = p.hp;
    sim.step(cmds);
    if (forced && ONLY_ROUND && (w.legendary?.round ?? 0) !== ONLY_ROUND - 1 && w.legendary) break;
    const l2 = w.legendary;
    if (l2?.spawned && !w.levelUp) {
      const r = l2.round ?? 0;
      if (r !== round) {
        report(`R${round + 1}`);
        round = r;
        stat = newStat();
        prevBoss = 0;
      }
      const e = w.enemies;
      let boss = 0;
      let fast = 0;
      let still = 0;
      for (let i = 0; i < e.count; i++) {
        if (e.hp[i]! <= 0 || kinds[e.kind[i]!]?.rank !== 'legendary') continue;
        boss += e.hp[i]!;
        if (e.speed[i] === 0 && !w.hiddenEnemies.has(e.id[i]!) && !w.bosses.find((b) => b.id === e.id[i])?.bounce) still++;
        if (w.hazards.some((h) => h.dasher === e.id[i] && h.activeTicks !== undefined && (rules.stage.moves[h.move]?.bounce || rules.stage.moves[h.move]?.dashSpeed))) fast++;
      }
      stat.ticks++;
      if (w.hiddenEnemies.size > 0) stat.hidden++;
      if (fast > 0) stat.fast++;
      if (still > 0) stat.still++;
      if (prevBoss && boss < prevBoss) {
        stat.dmg += prevBoss - boss;
        stat.dmgInSec += prevBoss - boss;
      }
      prevBoss = boss;
      if (stat.ticks % tickRate === 0) {
        stat.sec++;
        if (stat.dmgInSec > 0) stat.secHit++;
        stat.dmgInSec = 0;
      }
      if (p.hp < hpBefore) {
        stat.hurt += hpBefore - p.hp;
        let source = '';
        for (let i = 0; i < e.count; i++) {
          if (e.hp[i]! > 0 && (e.x[i]! - p.x) ** 2 + (e.y[i]! - p.y) ** 2 <= (e.radius[i]! + p.radius + 2) ** 2) source = `触れる:${kinds[e.kind[i]!]!.id}`;
        }
        if (!source) {
          for (let i = 0; i < e.count; i++) if (e.hp[i]! > 0) source += `${source ? '+' : ''}${kinds[e.kind[i]!]!.id}`;
          source = `技:${source}`;
        }
        hurtBy[source] = (hurtBy[source] ?? 0) + (hpBefore - p.hp) / p.maxHp;
      }
      if (p.hp > hpBefore) stat.healed += p.hp - hpBefore;
      stat.minHp = Math.min(stat.minHp, p.hp / p.maxHp);
    }
  }
  report(`R${round + 1}`);
  console.log(`${line.padEnd(10)} 受けた内訳 ${Object.entries(hurtBy).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' / ')}`);
  hurtBy = {};
  console.log(`${line.padEnd(10)} 結果 ${w.outcome} ${w.legendary?.result ?? ''} Lv${w.level} HP ${Math.round(p.hp)}/${Math.round(p.maxHp)} 技 ${p.moves.map((m) => `${rules.moves[m.move]!.key}:${m.level}`).join(' ')}`);
}

describe('レッド戦', () => {
  for (const line of LINES) it(line, () => run(line), 900_000);
});
