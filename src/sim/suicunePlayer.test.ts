import { describe, expect, it } from 'vitest';
import { buildSimRules, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { hurtPlayer } from './systems/health';

/** 遊べるスイクン（07 の307章）: 4 枠すべてが技で、なみのり（SPACE）・ミラーコート（Q）・ぜったいれいど（E）はキーで使う。めいそう は自動 */
function setup() {
  const rules = buildSimRules('johto');
  const lo = playableLoadout(rules, 'suicune');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 180, types: lo.types, species: lo.species, moves: lo.moves, line: 'suicune', fixedMoves: lo.fixedMoves });
  const key = (k: string) => rules.moves.findIndex((m) => m.key === k);
  return { rules, sim, p, key };
}

describe('遊べるスイクン', () => {
  it('最初の技は なみのり・ミラーコート・ぜったいれいど・めいそう。キーは SPACE・Q・E の順', () => {
    const { rules, p } = setup();
    expect(p.moves.map((m) => rules.moves[m.move]!.key)).toEqual(['surf-suicune', 'mirror-coat-suicune', 'sheer-cold-suicune', 'calm-mind']);
    expect(p.skills!.map((s) => rules.activeSkills!.defs[s.skill]!.kind)).toEqual(['surf', 'mirrorCoat', 'sheerCold']);
    expect(p.fixedMoves).toBe(true);
  });

  it('キーで使う技は自動では出ない', () => {
    const { sim, key } = setup();
    for (let k = 0; k < 120; k++) sim.step([]);
    const pr = sim.world.projectiles;
    for (let i = 0; i < pr.count; i++) expect([key('surf-suicune'), key('sheer-cold-suicune'), key('mirror-coat-suicune')]).not.toContain(pr.move[i]);
  });

  it('なみのり: 波が進み、自分も乗って進み、通った跡に水が残る。水があると ぜったいれいど で全部凍って大きく当たる', () => {
    const { sim, p, key } = setup();
    const surf = key('surf-suicune');
    const cold = key('sheer-cold-suicune');
    const e = sim.world.enemies;
    e.add(1, 0, 300, 0, 1e7, 0, 12, 0, 0, 0);
    sim.step([{ type: 'move', playerId: 1, dx: 1, dy: 0 }]);
    sim.step([{ type: 'move', playerId: 1, dx: 0, dy: 0 }]);
    const x0 = p.x;
    sim.step([{ type: 'useSkill', playerId: 1, slot: 0 }]);
    expect(p.dashTicks).toBeGreaterThan(0);
    for (let k = 0; k < 45; k++) sim.step([]);
    expect(p.x).toBeGreaterThan(x0 + 100);
    const pr = sim.world.projectiles;
    const waters = (): number => {
      let n = 0;
      for (let i = 0; i < pr.count; i++) if (pr.move[i] === surf && pr.stage[i] === 1) n++;
      return n;
    };
    expect(waters()).toBeGreaterThan(5);
    const hp0 = e.hp[0]!;
    sim.step([{ type: 'useSkill', playerId: 1, slot: 2 }]);
    expect(waters()).toBe(0);
    let ice = 0;
    for (let i = 0; i < pr.count; i++) if (pr.move[i] === cold && pr.stage[i] === 3 && pr.armStage[i] === 1) ice++;
    expect(ice).toBeGreaterThan(5);
    for (let k = 0; k < 20; k++) sim.step([]);
    expect(e.hp[0]!).toBeLessThan(hp0);
  });

  it('ぜったいれいど: 水が無ければ、HP の一番高い敵の所を凍らせる', () => {
    const { sim, key } = setup();
    const cold = key('sheer-cold-suicune');
    const e = sim.world.enemies;
    e.add(1, 0, 200, 50, 1e7, 0, 12, 0, 0, 0);
    // 敵の場所の表は更新で作り直す
    sim.step([]);
    sim.step([{ type: 'useSkill', playerId: 1, slot: 2 }]);
    const pr = sim.world.projectiles;
    let at = -1;
    for (let i = 0; i < pr.count; i++) if (pr.move[i] === cold && pr.stage[i] === 3 && pr.armStage[i] === 0) at = i;
    expect(at).not.toBe(-1);
    expect(Math.abs(pr.x[at]! - e.x[0]!)).toBeLessThan(1);
    const hp0 = e.hp[0]!;
    for (let k = 0; k < 20; k++) sim.step([]);
    expect(e.hp[0]!).toBeLessThan(hp0);
  });

  it('ミラーコート: 効いている間はダメージを受けずに吸い、終わると吸った分だけ多く鏡の破片が飛ぶ', () => {
    const { rules, sim, p, key } = setup();
    const mirror = key('mirror-coat-suicune');
    sim.world.enemies.add(1, 0, 300, 0, 1e7, 0, 12, 0, 0, 0);
    sim.step([{ type: 'useSkill', playerId: 1, slot: 1 }]);
    expect(p.mirror).toBeDefined();
    const hp0 = p.hp;
    hurtPlayer(sim.world, p, p.maxHp * 0.4);
    expect(p.hp).toBe(hp0);
    expect(p.mirror!.hits).toBe(1);
    let shards = 0;
    for (let k = 0; k < 90 && shards === 0; k++) {
      sim.step([]);
      const pr = sim.world.projectiles;
      for (let i = 0; i < pr.count; i++) if (pr.move[i] === mirror) shards++;
    }
    const base = rules.moves[mirror]!.levels[0]!.count;
    expect(shards).toBeGreaterThan(base);
    // 終わった後は受ける
    hurtPlayer(sim.world, p, 10);
    expect(p.hp).toBeLessThan(hp0);
  });

  it('めいそう: 使うたびに重なり、とくしゅの威力が上がる', () => {
    const { sim, p } = setup();
    for (let k = 0; k < 30 * 16; k++) sim.step([]);
    expect(p.calm?.stacks ?? 0).toBeGreaterThanOrEqual(2);
  });
});
