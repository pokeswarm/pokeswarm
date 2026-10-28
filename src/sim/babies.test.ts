import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { coopHatchSeed, hatchedPokemon } from '../meta/hatch';
import { Simulation } from './simulation';
import { answerEvolution, checkEvolution } from './systems/evolution';
import { makeOffers } from './systems/leveling';
import { regenerate } from './systems/health';
import { moveStatsOf, scaledMoveStats } from './systems/attack';

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

  it('ププリン: 進化する前は技を覚えない決まりは無い（覚えられる技が はたく だけ。07 の78・79章）。プリンになると うたう を覚え、カントーのプリンと同じく技を覚えない', () => {
    const s = setup('igglybuff');
    expect(s.p.fixedMoves).toBe(false);
    s.p.walked = 30000;
    checkEvolution(s.w, s.p);
    expect(s.p.line).toBe('jigglypuff');
    expect(s.keys()).toEqual(['pound', 'sing']);
    expect(s.p.fixedMoves).toBe(true);
    expect(makeOffers(s.w, s.p).some((o) => o.kind === 'moveNew')).toBe(false);
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

describe('カントーにもいるポケモンの、ジョウトで進化した姿（07 の80章）', () => {
  it('イワーク ＋ メタルコート → ハガネールで アイアンテール、ストライク → ハッサムで バレットパンチ、ポリゴン → ポリゴン2で じこさいせい', () => {
    for (const [line, item, form, move] of [
      ['onix', 'metal-coat', 'steelix', 'iron-tail'],
      ['scyther', 'metal-coat', 'scizor', 'bullet-punch'],
      ['porygon', 'up-grade', 'porygon2', 'recover'],
    ] as const) {
      const s = setup(line);
      s.p.items = [{ item: s.rules.items.findIndex((it) => it.key === item), level: 1 }];
      checkEvolution(s.w, s.p);
      expect(s.p.species).toBe(s.species(form));
      expect(s.keys()).toContain(move);
      expect(s.p.items).toEqual([]);
    }
  });
});

describe('イーブイの昼と夜の進化（07 の81章）', () => {
  it('なつきが十分で、夜の区間ならブラッキー・昼ならエーフィに進化してよいか聞く。答えで進化し、たいあたりは あさのひざし・つきのひかり に変わり、空きがあれば サイコキネシス・バークアウト を覚える（07 の103章）', () => {
    const s = setup('eevee');
    s.p.walked = 30000;
    s.w.section = 2;
    checkEvolution(s.w, s.p);
    expect(s.p.species).toBe(s.species('eevee'));
    expect(s.p.evolveAsk).toBe(s.species('umbreon'));
    expect(s.w.events.some((e) => e.type === 'evolveAsk')).toBe(true);
    answerEvolution(s.w, s.p, true);
    expect(s.p.species).toBe(s.species('umbreon'));
    expect(s.keys()).toEqual(['moonlight', 'snarl']);

    const d = setup('eevee');
    d.p.walked = 30000;
    checkEvolution(d.w, d.p);
    answerEvolution(d.w, d.p, true);
    expect(d.p.species).toBe(d.species('espeon'));
    expect(d.keys()).toEqual(['morning-sun', 'psychic']);
  });

  it('キャンセルすると、その区間の間は聞かない。次の区間でまた聞く', () => {
    const s = setup('eevee');
    s.p.walked = 30000;
    checkEvolution(s.w, s.p);
    answerEvolution(s.w, s.p, false);
    checkEvolution(s.w, s.p);
    expect(s.p.evolveAsk).toBeUndefined();
    s.w.section = 2;
    checkEvolution(s.w, s.p);
    expect(s.p.evolveAsk).toBe(s.species('umbreon'));
  });

  it('カントー（昼夜が無い）では、なつきで エーフィ・ブラッキーにならない', () => {
    const rules = buildSimRules();
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    const lo = playableLoadout(rules, 'eevee');
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 180, types: lo.types, moves: lo.moves, line: lo.line, species: lo.species });
    p.walked = 30000;
    checkEvolution(sim.world, p);
    expect(p.evolveAsk).toBeUndefined();
    expect(p.species).toBe(lo.species);
  });
});

describe('ジョウトだけのポケモン（07 の80章）', () => {
  it('ズバットは どくの技を新しく覚えない', () => {
    const s = setup('zubat');
    const poison = s.rules.types.names.indexOf('poison');
    for (let k = 0; k < 30; k++) {
      for (const o of makeOffers(s.w, s.p)) if (o.kind === 'moveNew') expect(s.rules.moves[o.move]!.type).not.toBe(poison);
    }
  });

  it('進化したとき技が空いていれば覚える: バンギラス すなあらし、キングドラ たつまき、ニョロボン ばくれつパンチ、ニョロトノ あまごい', () => {
    for (const [line, steps, move] of [
      ['larvitar', ['pupitar', 'tyranitar'], 'sandstorm'],
      ['horsea', ['seadra', 'kingdra'], 'twister'],
    ] as const) {
      const s = setup(line);
      s.w.level = 60;
      s.p.items = [{ item: s.rules.items.findIndex((it) => it.key === 'dragon-scale'), level: 1 }];
      checkEvolution(s.w, s.p);
      expect(s.p.species).toBe(s.species(steps[steps.length - 1]!));
      expect(s.keys()).toContain(move);
    }
    for (const [item, form, move] of [['water-stone', 'poliwrath', 'dynamic-punch'], ['kings-rock', 'politoed', 'rain-dance']] as const) {
      const s = setup('poliwag');
      s.w.level = 30;
      s.p.items = [{ item: s.rules.items.findIndex((it) => it.key === item), level: 1 }];
      checkEvolution(s.w, s.p);
      expect(s.p.species).toBe(s.species(form));
      expect(s.keys()).toContain(move);
    }
  });

  it('あまごい: 降っている間、みずの技の威力が上がる', () => {
    const s = setup('poliwag');
    const water = s.rules.types.names.indexOf('water');
    const pm = s.p.moves[0]!;
    const st = moveStatsOf(s.w, pm);
    const dry = scaledMoveStats(s.w, s.p, pm, st).power;
    s.p.rain = { type: water, pct: 50, untilTick: s.w.tick + 10 };
    expect(scaledMoveStats(s.w, s.p, pm, st).power).toBeCloseTo(dry * 1.5, 5);
    s.w.tick += 10;
    expect(scaledMoveStats(s.w, s.p, pm, st).power).toBeCloseTo(dry, 5);
  });
});
