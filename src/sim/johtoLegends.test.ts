import { describe, expect, it } from 'vitest';
import { buildSimRules } from '../data/simRules';
import { Simulation } from './simulation';
import { startIntruder, legendRoundStats } from './systems/stage';

/** ジョウトの特別な戦い（07 の85章）: レッド戦の3ラウンド・はねの戦い（ルギア・ホウオウ）・三犬の乱入 */
function johto() {
  const rules = buildSimRules('johto');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0 });
  // 雑魚は出さない（数えやすいように）
  sim.world.players[0]!.invincibleTicks = 1e9;
  return sim;
}

const kindOf = (sim: Simulation, id: string): number => sim.world.rules.enemies.kinds.findIndex((k) => k.id === id);

function steps(sim: Simulation, n: number): string[] {
  const types: string[] = [];
  for (let k = 0; k < n; k++) {
    sim.step([]);
    types.push(...sim.world.events.map((e) => e.type));
  }
  return types;
}

/** 種類 ids の敵を全部倒す */
function killAll(sim: Simulation, ids: readonly string[]): void {
  const kinds = ids.map((id) => kindOf(sim, id));
  const e = sim.world.enemies;
  const targets: number[] = [];
  for (let i = 0; i < e.count; i++) if (e.hp[i]! > 0 && kinds.includes(e.kind[i]!)) targets.push(e.id[i]!);
  expect(targets.length).toBe(ids.length);
  sim.step(targets.map((id) => ({ type: 'damageEnemy' as const, id, amount: 1e9, by: 1, kbx: 0, kby: 0, kbTicks: 0, status: -1, statusTicks: 0 })));
}

/** ワタルまでを倒した（クリア）ことにする */
function clear(sim: Simulation): void {
  sim.world.requiredLeft.clear();
  steps(sim, 1);
}

describe('ジョウトの特別な戦い（07 の85章）', () => {
  it('ワタルを倒したらクリア（レッドは区間の予定に無い）。クリアの後、必ずレッド戦の1ラウンド（ピカチュウ）', () => {
    const sim = johto();
    expect(sim.world.rules.stage.bosses.some((b) => b.kind === 'johto-boss-pikachu')).toBe(false);
    clear(sim);
    expect(sim.world.cleared).toBe(true);
    expect(sim.world.legendary?.kind).toBe(kindOf(sim, 'red-pikachu'));
    expect(sim.world.legendary?.round).toBe(0);
  });

  it('ラウンドの相手を全員倒すと次のラウンド。2ラウンドはエーフィとカビゴン、3ラウンドは御三家が同時に出る', () => {
    const sim = johto();
    clear(sim);
    steps(sim, 100);
    killAll(sim, ['red-pikachu']);
    expect(sim.world.legendary?.round).toBe(1);
    steps(sim, 100);
    killAll(sim, ['red-espeon', 'red-snorlax']);
    expect(sim.world.legendary?.round).toBe(2);
    steps(sim, 100);
    killAll(sim, ['red-venusaur', 'red-charizard', 'red-blastoise']);
    // はねが無ければ、レッドに勝って終わり
    expect(sim.world.outcome).toBe('clear');
    expect(sim.world.legendary?.result).toBe('won');
    expect(legendRoundStats(sim.world, sim.world.legendary!.kind, 'won')).toEqual(['redDefeated']);
  });

  it('はねを拾っていれば、レッドに勝った後にルギア → ホウオウ（どちらも HP 60000）', () => {
    const sim = johto();
    sim.world.wings.add('silver-wing');
    sim.world.wings.add('rainbow-wing');
    clear(sim);
    for (const round of [['red-pikachu'], ['red-espeon', 'red-snorlax'], ['red-venusaur', 'red-charizard', 'red-blastoise']]) {
      steps(sim, 100);
      killAll(sim, round);
    }
    expect(sim.world.legendary?.kind).toBe(kindOf(sim, 'legend-lugia'));
    steps(sim, 100);
    const e = sim.world.enemies;
    const lugia = Array.from(e.kind.subarray(0, e.count)).indexOf(kindOf(sim, 'legend-lugia'));
    expect(e.maxHp[lugia]).toBe(60000);
    killAll(sim, ['legend-lugia']);
    expect(sim.world.legendary?.kind).toBe(kindOf(sim, 'legend-ho-oh'));
    // ホウオウ戦の途中で終わっても、レッドには勝っている
    expect(legendRoundStats(sim.world, kindOf(sim, 'legend-ho-oh'), 'timeUp')).toEqual(['redDefeated']);
  });

  it('レッドに勝てなければ（時間切れ）、はねがあってもルギア・ホウオウとは戦わない', () => {
    const sim = johto();
    sim.world.wings.add('silver-wing');
    clear(sim);
    steps(sim, Math.round((sim.world.rules.stage.legendary!.timeLimitSeconds + 4) * 30));
    expect(sim.world.outcome).toBe('clear');
    expect(sim.world.legendary?.result).toBe('timeUp');
    expect(legendRoundStats(sim.world, sim.world.legendary!.kind, 'timeUp')).toEqual([]);
  });

  it('三犬の乱入: 「DANGER」の後に出て、雑魚はそのまま。制限時間で逃げる', () => {
    const sim = johto();
    steps(sim, 30);
    startIntruder(sim.world, kindOf(sim, 'legend-suicune'));
    steps(sim, 100);
    const e = sim.world.enemies;
    const has = (): boolean => Array.from(e.kind.subarray(0, e.count)).some((k, i) => k === kindOf(sim, 'legend-suicune') && e.hp[i]! > 0);
    expect(has()).toBe(true);
    expect(sim.world.legendary).toBeNull();
    expect(e.maxHp[Array.from(e.kind.subarray(0, e.count)).indexOf(kindOf(sim, 'legend-suicune'))]).toBe(44800);
    const types = steps(sim, 180 * 30);
    expect(types).toContain('intruderLeft');
    expect(has()).toBe(false);
    expect(sim.world.intruder?.done).toBe(true);
  });

  it('三犬の乱入は 5〜15分の奇数分ちょうどに確かめる（1回のランで1回まで）', () => {
    const cfg = buildSimRules('johto').stage.legendary!.intruders!;
    expect(cfg.minutes).toEqual([5, 7, 9, 11, 13, 15]);
    expect(cfg.chance).toBe(0.01);
  });
});
