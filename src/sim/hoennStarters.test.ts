import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { applyOffer, makeOffers, moveMaxLevel, pledgePowerPct } from './systems/leveling';
import { scaledMoveStats, useMoves } from './systems/attack';
import type { UpgradeOffer } from './world';

/** ホウエンの御三家の技（作者の決定 2026年10月29日。07 の130章） */
function setup(line: string, region = 'hoenn') {
  const rules = buildSimRules(region);
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const add = (id: number, key: string) => {
    const lo = playableLoadout(rules, key);
    return sim.addPlayer({ id, x: 0, y: 0, radius: 12, moveSpeed: 0, types: lo.types, moveTypes: lo.moveTypes, fixedMoves: lo.fixedMoves, learnsAll: lo.learnsAll, moves: lo.moves, line: lo.line, species: lo.species });
  };
  const p = add(1, line);
  const move = (key: string): number => moveIndexOf(rules, key);
  const item = (key: string): number => rules.items.findIndex((it) => it.key === key);
  const species = (key: string): number => rules.species.findIndex((s) => s.key === key);
  const learn = (key: string, level = 1) => p.moves.push({ move: move(key), level, cooldown: 0, burstLeft: 0, burstTimer: 0 });
  const maxOut = (key: string) => {
    const pm = p.moves.find((m) => m.move === move(key))!;
    pm.level = moveMaxLevel(rules, pm);
  };
  // 何回か候補を作って、出た候補を全部集める
  const offers = (times = 40): UpgradeOffer[] => Array.from({ length: times }, () => makeOffers(sim.world, p)).flat();
  const offersNew = (key: string): boolean => offers().some((o) => o.kind === 'moveNew' && o.move === move(key));
  const derives = (key: string): UpgradeOffer | undefined => makeOffers(sim.world, p).find((o) => o.kind === 'derive' && o.to === move(key));
  return { rules, sim, p, add, move, item, species, learn, maxOut, offers, offersNew, derives };
}

describe('ホウエンの技は前の地方に流れない（07 の130章）', () => {
  it('カントーのミュウ（何でも覚える）にも、ホウエンの技は候補に出ない。ゆびをふるの集まりにも入らない', () => {
    const k = setup('mew', 'kanto');
    const hoennMoves = new Set(k.rules.moves.flatMap((m, i) => (m.region === 'hoenn' ? [i] : [])));
    expect(hoennMoves.size).toBeGreaterThan(10);
    k.p.moves = k.p.moves.slice(0, 1);
    k.sim.world.level = 60;
    expect(k.offers(200).some((o) => o.kind === 'moveNew' && hoennMoves.has(o.move))).toBe(false);
    for (const m of k.rules.moves) for (const i of m.randomPool) expect(hoennMoves.has(i), m.key).toBe(false);
  });

  it('カントーのゼニガメの みずでっぽう ＋ しんぴのしずく は今までどおり ハイドロポンプ、ミズゴロウは みずのはどう だけ', () => {
    const k = setup('squirtle', 'kanto');
    k.maxOut('water-gun');
    k.p.items.push({ item: k.item('mystic-water'), level: 1 });
    expect(k.derives('hydro-pump')).toBeDefined();
    const h = setup('mudkip');
    h.maxOut('water-gun');
    h.p.items.push({ item: h.item('mystic-water'), level: 1 });
    expect(h.derives('water-pulse')).toBeDefined();
    expect(h.derives('hydro-pump')).toBeUndefined();
  });
});

describe('キモリ', () => {
  it('くさのちかいは ジュプトルから候補に出る。リーフストームは Lv50 以上 ＋ くさのちかい', () => {
    const t = setup('treecko');
    expect(t.offersNew('grass-pledge')).toBe(false);
    t.p.species = t.species('grovyle');
    expect(t.offersNew('grass-pledge')).toBe(true);
    t.sim.world.level = 50;
    expect(t.offersNew('leaf-storm-hoenn')).toBe(false);
    t.learn('grass-pledge');
    expect(t.offersNew('leaf-storm-hoenn')).toBe(true);
    t.sim.world.level = 49;
    expect(t.offersNew('leaf-storm-hoenn')).toBe(false);
  });

  it('ひっかく → きりさく（シルクのスカーフ）→ つるぎのまい（プラスパワー）。このはが最大でつるぎのまいを覚えていれば リーフブレード（つるぎのまいは残る）', () => {
    const t = setup('treecko');
    t.learn('slash');
    t.maxOut('slash');
    t.p.items.push({ item: t.item('x-attack'), level: 1 });
    applyOffer(t.sim.world, t.p, t.derives('swords-dance')!);
    expect(t.p.moves.some((m) => m.move === t.move('swords-dance'))).toBe(true);
    const before = t.p.mods.physicalPowerPct;
    t.p.moves.find((m) => m.move === t.move('swords-dance'))!.level = 8;
    applyOffer(t.sim.world, t.p, { kind: 'heal' });
    expect(t.p.mods.physicalPowerPct).toBeGreaterThan(before);
    expect(t.derives('leaf-blade')).toBeUndefined();
    t.maxOut('leafage');
    applyOffer(t.sim.world, t.p, t.derives('leaf-blade')!);
    expect(t.p.moves.map((m) => t.rules.moves[m.move]!.key).sort()).toEqual(['leaf-blade', 'swords-dance']);
  });

  it('リーフブレードは溜めてから出す（溜めている間は出さない）', () => {
    const t = setup('treecko');
    t.p.moves = [{ move: t.move('leaf-blade'), level: 1, cooldown: 0, burstLeft: 0, burstTimer: 0 }];
    const windup = t.rules.moves[t.move('leaf-blade')]!.windupSeconds!;
    const steps = Math.round(windup / t.sim.world.dt);
    for (let k = 0; k < steps; k++) {
      useMoves(t.sim.world);
      expect(t.sim.world.projectiles.count, `${k}`).toBe(0);
    }
    useMoves(t.sim.world);
    expect(t.sim.world.projectiles.count).toBeGreaterThan(0);
  });
});

describe('アチャモ', () => {
  it('インファイト: ローキックが最大 ＋ フレアドライブ と ほのおのパンチ を覚えている。ほのおのパンチ は消費、フレアドライブは残る。最大 Lv16', () => {
    const a = setup('torchic');
    a.p.moves = [{ move: a.move('low-sweep'), level: 1, cooldown: 0, burstLeft: 0, burstTimer: 0 }];
    a.maxOut('low-sweep');
    a.learn('flare-blitz-hoenn');
    expect(a.derives('close-combat')).toBeUndefined();
    a.learn('fire-punch-hoenn');
    applyOffer(a.sim.world, a.p, a.derives('close-combat')!);
    expect(a.p.moves.map((m) => a.rules.moves[m.move]!.key).sort()).toEqual(['close-combat', 'flare-blitz-hoenn']);
    expect(moveMaxLevel(a.rules, a.p.moves.find((m) => m.move === a.move('close-combat'))!)).toBe(16);
    expect(a.offersNew('fire-punch-hoenn')).toBe(false);
  });

  it('インファイトには ほのお と かくとう の両方の強化が効く', () => {
    const a = setup('torchic');
    const pm = { move: a.move('close-combat'), level: 1, cooldown: 0, burstLeft: 0, burstTimer: 0 };
    a.p.moves = [pm];
    const st = a.rules.moves[pm.move]!.levels[0]!;
    const base = scaledMoveStats(a.sim.world, a.p, pm, st).power;
    applyOffer(a.sim.world, a.p, { kind: 'itemNew', item: a.item('charcoal') });
    const fire = scaledMoveStats(a.sim.world, a.p, pm, st).power;
    applyOffer(a.sim.world, a.p, { kind: 'itemNew', item: a.item('black-belt') });
    const both = scaledMoveStats(a.sim.world, a.p, pm, st).power;
    expect(fire).toBeGreaterThan(base);
    expect(both).toBeGreaterThan(fire);
  });

  it('ビルドアップ・ほのおのちかいは ワカシャモから。にどげり ＋ くろおび で ローキック', () => {
    const a = setup('torchic');
    expect(a.offersNew('bulk-up')).toBe(false);
    a.p.species = a.species('combusken');
    expect(a.offersNew('bulk-up')).toBe(true);
    expect(a.offersNew('fire-pledge')).toBe(true);
    a.maxOut('double-kick');
    a.p.items.push({ item: a.item('black-belt'), level: 1 });
    expect(a.derives('low-sweep')).toBeDefined();
  });
});

describe('ミズゴロウ', () => {
  it('どろかけ はミズゴロウから候補に出る。みずのはどう が最大 ＋ マッドショット Lv8 で だくりゅう（マッドショットは残る）', () => {
    const m = setup('mudkip');
    expect(m.offersNew('mud-slap')).toBe(true);
    m.p.moves = [{ move: m.move('water-pulse'), level: 1, cooldown: 0, burstLeft: 0, burstTimer: 0 }];
    m.maxOut('water-pulse');
    m.learn('mud-shot', 7);
    expect(m.derives('muddy-water-hoenn')).toBeUndefined();
    m.p.moves[1]!.level = 8;
    applyOffer(m.sim.world, m.p, m.derives('muddy-water-hoenn')!);
    expect(m.p.moves.map((x) => m.rules.moves[x.move]!.key).sort()).toEqual(['mud-shot', 'muddy-water-hoenn']);
  });
});

describe('ちかい', () => {
  it('ソロでは軽いバフだけ。協力プレイで味方がほかのちかいを覚えると、両方とも強くなる', () => {
    const t = setup('treecko');
    t.p.species = t.species('grovyle');
    applyOffer(t.sim.world, t.p, { kind: 'moveNew', move: t.move('grass-pledge') });
    const pl = t.rules.moves[t.move('grass-pledge')]!.pledge!;
    expect(pledgePowerPct(t.sim.world, t.p)).toBe(pl.powerPct);
    const powerSolo = t.p.mods.powerPct;
    const a = t.add(2, 'torchic');
    a.species = t.species('combusken');
    applyOffer(t.sim.world, a, { kind: 'moveNew', move: t.move('fire-pledge') });
    expect(pledgePowerPct(t.sim.world, t.p)).toBe(pl.powerPct + pl.perOtherPct);
    expect(t.p.mods.powerPct).toBe(powerSolo + pl.perOtherPct);
    expect(pledgePowerPct(t.sim.world, a)).toBe(pl.powerPct + pl.perOtherPct);
  });
});
