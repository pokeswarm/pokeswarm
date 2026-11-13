import { describe, it } from 'vitest';
import { buildSimRules } from '../data/simRules';
import type { Axis, InputCommand } from './commands';
import { Simulation } from './simulation';
import { CASTER_ID_BASE } from './systems/attack';
import { hazardHits, startLegendary } from './systems/stage';

/**
 * 伝説の技の当たりやすさの測り方（範囲の確認に使う。07 の257章）: 攻撃せず、予告を避けるだけの自動プレイヤー（速さ 180・持ち物なし）で
 * 伝説と戦い、受けたダメージを技ごとに数える。HP 100%（ふだん）・60%（HP 66% の技の後）・30%（HP 33% の技の後）の 3 区間を回す。
 * 例: LEGENDS=legend-mew,shiny-blastoise npx vitest run --mode balance --silent=false src/sim/legendDodge.balance.ts（DODGE_SEEDS=6 で試す数）
 * DODGE_PATCH='{"set":{"moveIntervalSeconds":0.4},"moves":{"mew-metronome":{"telegraphSeconds":0.6}}}' で、測る前にデータを書き換えて案を比べる。
 * 避け方は人より単純なので、数字は伝説どうし・変更の前後を比べるために使う。
 */
const LEGENDS = (process.env.LEGENDS ?? 'legend-mewtwo,legend-articuno,legend-zapdos,legend-moltres,shiny-charizard,shiny-venusaur,shiny-blastoise,legend-mew').split(',');
const SEEDS = Number(process.env.DODGE_SEEDS ?? 4);
/** 区間（HP の割合と秒数） */
const SEGMENTS: [number, number][] = [
  [100, 90],
  [60, 40],
  [30, 40],
];
const DIRS: [Axis, Axis][] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

function run(kindId: string): void {
  const rules = buildSimRules();
  const patch = JSON.parse(process.env.DODGE_PATCH ?? '{}') as { set?: Record<string, unknown>; moves?: Record<string, Record<string, unknown>> };
  if (patch.set) Object.assign(rules.stage.legendary!.moveSets[kindId]!, patch.set);
  for (const [id, v] of Object.entries(patch.moves ?? {})) Object.assign(rules.stage.moves.find((m) => m.id === id)!, v);
  const tickRate = 30;
  let casts = 0;
  const kind = rules.enemies.kinds.findIndex((k) => k.id === kindId);
  const perSeg = SEGMENTS.map(() => 0);
  const by: Record<string, number> = {};
  const hits: Record<string, number> = {};
  for (let seed = 1; seed <= SEEDS; seed++) {
    const sim = new Simulation({ tickRate, seed, rules });
    sim.addPlayer({ id: 1, x: 0, y: 200, radius: 12, moveSpeed: 180 });
    const p = sim.world.players[0]!;
    const w = sim.world;
    w.cleared = true;
    startLegendary(w, kind);
    let dir = '';
    // 出てくるまで待つ
    for (let t = 0; t < tickRate * 6 && !w.bosses.length; t++) sim.step([]);
    const boss = w.bosses[0];
    if (!boss) throw new Error(`${kindId} が出ない`);
    const idx = (): number => {
      for (let k = 0; k < w.enemies.count; k++) if (w.enemies.id[k] === boss.id) return k;
      return -1;
    };
    SEGMENTS.forEach(([pct, secs], s) => {
      const bi = idx();
      if (bi < 0) return;
      w.enemies.hp[bi] = (w.enemies.maxHp[bi]! * pct) / 100;
      for (let t = 0; t < secs * tickRate; t++) {
        const cmds: InputCommand[] = [];
        if (w.tick % 3 === 0) {
          const e = w.enemies;
          const k = idx();
          const tx = k >= 0 ? e.x[k]! : 0;
          const ty = k >= 0 ? e.y[k]! : 0;
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
                const moving = hz.activeTicks !== undefined && (hz.vx || hz.vy);
                const at = moving ? { ...hz, x: hz.x + (hz.vx ?? 0) * look, y: hz.y + (hz.vy ?? 0) * look } : hz;
                if (hazardHits(at, x, y, p.radius + 6, m)) score -= moving ? 400 : 100 / (0.1 + hz.ticksLeft / tickRate);
              }
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
            score -= Math.abs(d - 230) * 0.08;
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
        p.hp = p.maxHp;
        sim.step(cmds);
        for (const ev of w.events) if (ev.type === 'hazardTelegraphed' && ev.delay === 0 && (rules.stage.moves[ev.move]?.damage ?? 0) > 0) casts++;
        const lost = (p.maxHp - p.hp) / p.maxHp;
        if (lost > 0) {
          perSeg[s]! += lost;
          let src = '';
          for (const hz of w.hazards) {
            if (hz.activeTicks === undefined) continue;
            const m = rules.stage.moves[hz.move];
            if (hazardHits(hz, p.x, p.y, p.radius + 4, m)) src = m?.id ?? '?';
          }
          if (!src) {
            const pr = w.projectiles;
            for (let i = 0; i < pr.count; i++) if (pr.owner[i]! >= CASTER_ID_BASE && (pr.x[i]! - p.x) ** 2 + (pr.y[i]! - p.y) ** 2 < (pr.radius[i]! + p.radius + 30) ** 2) src = 'casters';
          }
          if (!src) {
            const e = w.enemies;
            for (let i = 0; i < e.count; i++) if (e.hp[i]! > 0 && (e.x[i]! - p.x) ** 2 + (e.y[i]! - p.y) ** 2 <= (e.radius[i]! + p.radius + 4) ** 2) src = '触れる';
          }
          by[src || 'その他'] = (by[src || 'その他'] ?? 0) + lost;
          hits[src || 'その他'] = (hits[src || 'その他'] ?? 0) + 1;
        }
      }
    });
  }
  const perMin = (v: number, secs: number): string => ((v / SEEDS) * (60 / secs)).toFixed(2);
  console.log(
    `${kindId.padEnd(16)} 平均 ${perMin(perSeg.reduce((a, b) => a + b, 0), SEGMENTS.reduce((a, [, x]) => a + x, 0))} / 当たる技 毎分 ${((casts / SEEDS) * 60 / SEGMENTS.reduce((a, [, x]) => a + x, 0)).toFixed(1)} 回 / 受けた 毎分 最大HPの ${SEGMENTS.map(([pct, secs], s) => `HP${pct}%: ${perMin(perSeg[s]!, secs)}`).join(' / ')}`,
  );
  const total = SEGMENTS.reduce((a, [, secs]) => a + secs, 0);
  console.log(
    `${''.padEnd(16)} 内訳（毎分） ${Object.entries(by)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${perMin(v, total)}（${perMin(hits[k]!, total)}回×${(v / hits[k]!).toFixed(2)}）`)
      .join(' / ')}`,
  );
}

describe('伝説の技の当たりやすさ', () => {
  for (const id of LEGENDS) it(id, () => run(id), 900_000);
});
