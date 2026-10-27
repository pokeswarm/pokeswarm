import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { coopHatchSeed, hatchedPokemon } from '../meta/hatch';
import { Simulation } from './simulation';
import { checkEvolution } from './systems/evolution';
import { makeOffers } from './systems/leveling';
import { regenerate } from './systems/health';

/** ベイビィポケモンとタマゴ（07 の57章・66.4） */
function setup(pokemon: string) {
  const rules = buildSimRules('johto');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const lo = playableLoadout(rules, pokemon);
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 180, types: lo.types, moveTypes: lo.moveTypes, fixedMoves: lo.fixedMoves, moves: lo.moves, line: lo.line, species: lo.species });
  const move = (key: string): number => moveIndexOf(rules, key);
  const species = (key: string): number => rules.species.findIndex((s) => s.key === key);
  const keys = (): string[] => p.moves.map((m) => rules.moves[m.move]!.key);
  return { rules, sim, w: sim.world, p, move, species, keys };
}

describe('タマゴ', () => {
  it('かえるのは4種のどれか。同じシードなら同じ。協力プレイは部屋のシードと人で決まる', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 200; seed++) seen.add(hatchedPokemon('egg', seed));
    expect([...seen].sort()).toEqual(['cleffa', 'igglybuff', 'pichu', 'togepi']);
    expect(hatchedPokemon('egg', 42)).toBe(hatchedPokemon('egg', 42));
    expect(hatchedPokemon('cyndaquil', 42)).toBe('cyndaquil');
    expect(coopHatchSeed(7, 1)).not.toBe(coopHatchSeed(7, 2));
  });
});

describe('なつき（歩いた距離）', () => {
  it('歩いた距離が 30000 でピチュー → ピカチュウ。カントーのピカチュウの系統になる', () => {
    const s = setup('pichu');
    s.p.walked = 29999;
    checkEvolution(s.w, s.p);
    expect(s.p.species).toBe(s.species('pichu'));
    s.p.walked = 30000;
    checkEvolution(s.w, s.p);
    expect(s.p.species).toBe(s.species('pikachu'));
    expect(s.p.line).toBe('pikachu');
  });

  it('歩くと歩いた距離が増える', () => {
    const s = setup('pichu');
    s.p.inputX = 1;
    for (let i = 0; i < 30; i++) s.sim.step([]);
    expect(s.p.walked).toBeGreaterThan(0);
    expect(s.p.walked).toBeCloseTo(Math.abs(s.p.x), 3);
  });
});

describe('ベイビィポケモンの決まり', () => {
  it('ピチュー: でんきショックを撃つたびに HP が減り、10% を切ると撃たない', () => {
    const s = setup('pichu');
    // 近くに敵を置く（でんきショックは狙う敵がいるときだけ撃つ）
    s.w.enemies.add(9001, 0, 40, 0, 1e9, 0, 10);
    const hp = s.p.hp;
    for (let i = 0; i < 60 && s.p.hp === hp; i++) s.sim.step([]);
    expect(s.p.hp).toBeLessThan(hp);
    s.p.hp = s.p.maxHp * 0.09;
    const low = s.p.hp;
    for (let i = 0; i < 90; i++) s.sim.step([]);
    expect(s.p.hp).toBe(low);
  });

  it('ピィ: ピッピで ゆびをふる、ピクシー（つきのいし）で つきのひかり を覚える', () => {
    const s = setup('cleffa');
    s.p.walked = 30000;
    checkEvolution(s.w, s.p);
    expect(s.keys()).toEqual(['pound', 'metronome-baby']);
    s.p.items = [{ item: s.rules.items.findIndex((it) => it.key === 'moon-stone'), level: 1 }];
    checkEvolution(s.w, s.p);
    expect(s.p.species).toBe(s.species('clefable'));
    expect(s.keys()).toEqual(['pound', 'metronome-baby', 'moonlight']);
  });

  it('ププリン: 技を覚えない。プリンになると うたう を覚え、カントーのプリンと同じ決まり', () => {
    const s = setup('igglybuff');
    expect(makeOffers(s.w, s.p).some((o) => o.kind === 'moveNew')).toBe(false);
    s.p.walked = 30000;
    checkEvolution(s.w, s.p);
    expect(s.p.line).toBe('jigglypuff');
    expect(s.keys()).toEqual(['pound', 'sing']);
    expect(s.p.fixedMoves).toBe(true);
  });

  it('トゲピー: 進化するまで新しい技を覚えない。2500 歩くと止まって泣く', () => {
    const s = setup('togepi');
    expect(s.keys()).toEqual(['metronome-baby']);
    expect(makeOffers(s.w, s.p).some((o) => o.kind === 'moveNew')).toBe(false);
    s.p.cryWalked = 2499;
    s.p.inputX = 1;
    s.sim.step([]);
    expect(s.p.cryTicks).toBe(Math.round(1.5 * 30));
    const x = s.p.x;
    s.sim.step([]);
    expect(s.p.x).toBe(x);
    s.p.walked = 30000;
    checkEvolution(s.w, s.p);
    expect(s.p.species).toBe(s.species('togetic'));
    expect(Array.from({ length: 30 }, () => makeOffers(s.w, s.p)).some((offers) => offers.some((o) => o.kind === 'moveNew'))).toBe(true);
  });

  it('つきのひかり: 円の中にいる間、毎秒 最大 HP の healPct % 回復する', () => {
    const s = setup('cleffa');
    s.p.hp = s.p.maxHp * 0.5;
    s.w.healZones.push({ x: 0, y: 0, radius: 90, ticks: 30, pct: 1 });
    for (let i = 0; i < 30; i++) regenerate(s.w);
    expect(s.p.hp).toBeCloseTo(s.p.maxHp * 0.51, 3);
    expect(s.w.healZones).toHaveLength(0);
  });
});
