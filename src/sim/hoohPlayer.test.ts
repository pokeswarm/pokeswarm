import { describe, expect, it } from 'vitest';
import { buildSimRules, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';

/** 遊べるホウオウ（07 の322章）: ゴッドバード（SPACE）・じこさいせい（Q）・せいなるほのお（E）はキーで使い、かぜおこし は自動 */
function setup(moves?: { key: string; level: number }[]) {
  const rules = buildSimRules('johto');
  const lo = playableLoadout(rules, 'ho-oh');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const ids = moves ? moves.map((m) => ({ move: rules.moves.findIndex((x) => x.key === m.key), level: m.level })) : lo.moves;
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 180, types: lo.types, species: lo.species, moves: ids, line: 'ho-oh', fixedMoves: lo.fixedMoves });
  return { rules, sim, p };
}

const all = [
  { key: 'sky-attack-hooh', level: 1 },
  { key: 'recover-hooh', level: 1 },
  { key: 'sacred-fire-hooh', level: 1 },
];

/** 自然に出る敵と番号が重ならない敵を置いて、その HP を返す関数 */
function target(sim: Simulation, id: number, x: number, y: number): () => number {
  sim.world.enemies.add(id, 0, x, y, 1e7, 0, 12, 0, 0, 0);
  return () => {
    const e = sim.world.enemies;
    for (let i = 0; i < e.count; i++) if (e.id[i] === id) return e.hp[i]!;
    return 0;
  };
}

describe('遊べるホウオウ', () => {
  it('最初の技は ゴッドバード・じこさいせい・せいなるほのお・かぜおこし。キーは SPACE・Q・E。ルートは無い', () => {
    const { rules, p } = setup();
    expect(p.moves.map((m) => rules.moves[m.move]!.key)).toEqual(['sky-attack-hooh', 'recover-hooh', 'sacred-fire-hooh', 'gust-hooh']);
    expect(p.skills!.map((s) => rules.activeSkills!.defs[s.skill]!.kind)).toEqual(['skyLoop', 'rebirth', 'sacredFire']);
    expect(rules.derivations.filter((d) => d.line === 'ho-oh')).toEqual([]);
  });

  it('ゴッドバード: 楕円を回って元の所へ戻り、通り道の敵に当たって燃える場所が残る', () => {
    const { rules, sim, p } = setup(all);
    const sa = rules.moves.findIndex((m) => m.key === 'sky-attack-hooh');
    p.facingX = 1;
    p.facingY = 0;
    // 楕円の通り道（真ん中の脇）に敵を置く
    const hp = target(sim, 9001, 240, -130);
    sim.step([]);
    sim.step([{ type: 'useSkill', playerId: 1, slot: 0 }]);
    let far = 0;
    for (let k = 0; k < 60; k++) {
      sim.step([]);
      far = Math.max(far, p.x);
    }
    expect(far).toBeGreaterThan(380);
    expect(Math.hypot(p.x, p.y)).toBeLessThan(20);
    expect(hp()).toBeLessThan(1e7);
    let fires = 0;
    for (let i = 0; i < sim.world.projectiles.count; i++) if (sim.world.projectiles.move[i] === sa && sim.world.projectiles.stage[i] === 1) fires++;
    expect(fires).toBeGreaterThan(10);
  });

  it('せいなるほのお: 炎弾が着弾して爆発し、飛び火が燃える。使うと 8 秒 聖炎', () => {
    const { rules, sim, p } = setup(all);
    const sf = rules.moves.findIndex((m) => m.key === 'sacred-fire-hooh');
    p.facingX = 1;
    p.facingY = 0;
    const hp = target(sim, 9001, 260, 0);
    sim.step([]);
    sim.step([{ type: 'useSkill', playerId: 1, slot: 2 }]);
    expect(p.sacredFlame).toBeDefined();
    for (let k = 0; k < 30; k++) sim.step([]);
    expect(hp()).toBeLessThan(1e7);
    let embers = 0;
    for (let i = 0; i < sim.world.projectiles.count; i++) if (sim.world.projectiles.move[i] === sf && sim.world.projectiles.stage[i] === 1) embers++;
    expect(embers).toBe(6);
    for (let k = 0; k < 240; k++) sim.step([]);
    expect(p.sacredFlame).toBeUndefined();
  });

  it('聖炎の間の ゴッドバード は、燃える場所が青白い火になって強い', () => {
    const fires = (sacred: boolean) => {
      const { rules, sim, p } = setup(all);
      const sa = rules.moves.findIndex((m) => m.key === 'sky-attack-hooh');
      p.facingX = 1;
      p.facingY = 0;
      if (sacred) p.sacredFlame = { fromTick: 0, untilTick: 99999 };
      sim.step([{ type: 'useSkill', playerId: 1, slot: 0 }]);
      for (let i = 0; i < sim.world.projectiles.count; i++) {
        if (sim.world.projectiles.move[i] === sa && sim.world.projectiles.stage[i] === 3 && sim.world.projectiles.armStage[i] === 1) return { angle: sim.world.projectiles.angle[i], dmg: sim.world.projectiles.damage[i]! };
      }
      return { angle: -1, dmg: 0 };
    };
    const a = fires(false);
    const b = fires(true);
    expect(a.angle).toBe(0);
    expect(b.angle).toBe(1);
    expect(b.dmg).toBeGreaterThan(a.dmg * 1.4);
  });

  it('じこさいせい: 回復する。聖炎の間は、倒れている味方をすぐ起こす（ソロ・ホスト）', () => {
    const { sim, p } = setup(all);
    p.hp = p.maxHp * 0.3;
    sim.step([{ type: 'useSkill', playerId: 1, slot: 1 }]);
    expect(p.hp).toBeGreaterThan(p.maxHp * 0.55);
    const ally = sim.addPlayer({ id: 2, x: 80, y: 0, radius: 12, moveSpeed: 180, types: p.types, species: p.species, moves: [], line: 'pidgey' });
    ally.down = true;
    ally.hp = 0;
    p.sacredFlame = { fromTick: 0, untilTick: 99999 };
    p.skills![1]!.charges = 1;
    sim.step([{ type: 'useSkill', playerId: 1, slot: 1 }]);
    expect(ally.down).toBe(false);
    expect(ally.hp).toBeGreaterThan(0);
  });
});
