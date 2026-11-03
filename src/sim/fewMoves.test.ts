import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import type { Player } from './entities/player';
import { Simulation } from './simulation';
import { checkEvolution } from './systems/evolution';
import { canLearnNewMove, makeOffers, recomputeModifiers } from './systems/leveling';

/** 技の少ないポケモンの救済（07 の173章） */
function setup(line: string, region = 'johto') {
  const rules = buildSimRules(region);
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const lo = playableLoadout(rules, line);
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, types: lo.types, moveTypes: lo.moveTypes, fixedMoves: lo.fixedMoves, moves: lo.moves, line: lo.line, species: lo.species });
  const move = (key: string): number => moveIndexOf(rules, key);
  const item = (key: string): number => rules.items.findIndex((it) => it.key === key);
  const keys = (): string[] => p.moves.map((m) => rules.moves[m.move]!.key);
  /** 元の技を最大にして持ち物を持てば、その技進化が候補に出るか */
  const derivable = (from: string, itemKey: string, to: string): boolean => {
    const m = move(from);
    const had = p.moves.find((x) => x.move === m);
    if (had) had.level = rules.moves[m]!.levels.length + 1;
    else p.moves.push({ move: m, level: rules.moves[m]!.levels.length + 1, cooldown: 0, burstLeft: 0, burstTimer: 0 });
    if (!p.items.some((it) => it.item === item(itemKey))) p.items.push({ item: item(itemKey), level: 1 });
    return Array.from({ length: 20 }, () => makeOffers(sim.world, p)).some((offers) => offers.some((o) => o.kind === 'derive' && o.to === move(to)));
  };
  return { rules, sim, p, move, item, keys, derivable };
}

describe('ミルタンク', () => {
  it('最初の技は たいあたり と ミルクのみ。まるくなる・ふみつけ を覚え、ふみつけ ＋ シルクのスカーフ → すてみタックル', () => {
    const t = setup('miltank');
    expect(t.keys()).toEqual(['tackle', 'milk-drink']);
    expect(canLearnNewMove(t.sim.world, t.p, t.move('defense-curl'))).toBe(true);
    expect(canLearnNewMove(t.sim.world, t.p, t.move('stomp'))).toBe(true);
    expect(t.derivable('stomp', 'silk-scarf', 'double-edge')).toBe(true);
  });

  it('ミルクのみ: 近くへびんを投げ、落ちた所にモーモーミルクが残る（敵には当たらない）。マップには 3 つまで', () => {
    const t = setup('miltank');
    t.p.moves = t.p.moves.filter((m) => m.move === t.move('milk-drink'));
    t.sim.world.enemies.add(1, 0, 60, 0, 1000, 0, 10);
    for (let k = 0; k < 30 * 60; k++) t.sim.step([]);
    const milk = t.sim.world.items.filter((it) => it.kind === 'moomoo-milk');
    expect(milk).toHaveLength(3);
    for (const it of milk) expect(Math.hypot(it.x - t.p.x, it.y - t.p.y)).toBeLessThan(200);
    expect(t.sim.world.enemies.hp[0]).toBe(1000);
  });

  it('モーモーミルクを拾うと 最大 HP の 15% 回復する', () => {
    const t = setup('miltank');
    t.p.moves = t.p.moves.filter((m) => m.move === t.move('milk-drink'));
    for (let k = 0; k < 60 && !t.sim.world.items.length; k++) t.sim.step([]);
    const it = t.sim.world.items[0]!;
    t.p.hp = t.p.maxHp * 0.5;
    t.p.x = it.x;
    t.p.y = it.y;
    t.sim.step([]);
    expect(t.p.hp).toBeCloseTo(t.p.maxHp * 0.65, 0);
  });

  it('すてみタックル: 使うたびに HP を使う（反動）。まるくなる で防御が上がると反動も減る', () => {
    const hurt = (curl: boolean): number => {
      const t = setup('miltank');
      t.p.moves = [{ move: t.move('double-edge'), level: 1, cooldown: 0, burstLeft: 0, burstTimer: 0 }];
      if (curl) t.p.moves.push({ move: t.move('defense-curl'), level: 8, cooldown: 0, burstLeft: 0, burstTimer: 0 });
      recomputeModifiers(t.sim.world, t.p);
      t.sim.world.enemies.add(1, 0, 40, 0, 1e6, 0, 10);
      const hp = t.p.hp;
      t.sim.step([]);
      return hp - t.p.hp;
    };
    expect(hurt(false)).toBeGreaterThan(0);
    expect(hurt(true)).toBeLessThan(hurt(false));
  });

  it('まるくなる: ころがる（いわ）の威力も上がる', () => {
    const t = setup('miltank');
    t.p.moves.push({ move: t.move('defense-curl'), level: 8, cooldown: 0, burstLeft: 0, burstTimer: 0 });
    recomputeModifiers(t.sim.world, t.p);
    expect(t.p.mods.typePowerPct[t.rules.types.names.indexOf('rock')]).toBe(40);
    expect(t.p.mods.defensePct).toBe(48);
  });
});

describe('でんこうせっか → すてみタックル（だれでもの派生）', () => {
  it('原作で すてみタックル を覚える系統なら、どの地方でも出る', () => {
    expect(setup('eevee', 'kanto').derivable('quick-attack', 'silk-scarf', 'double-edge')).toBe(true);
    expect(setup('cyndaquil').derivable('quick-attack', 'silk-scarf', 'double-edge')).toBe(true);
    expect(setup('raikou').derivable('quick-attack', 'silk-scarf', 'double-edge')).toBe(true);
  });
});

describe('イワーク', () => {
  it('かたくなる を覚え、ハガネールの姿なら かたくなる ＋ ディフェンダー → てっぺき（イワークの姿では出ない）', () => {
    const t = setup('onix');
    expect(canLearnNewMove(t.sim.world, t.p, t.move('harden'))).toBe(true);
    expect(t.derivable('harden', 'x-defense', 'iron-defense')).toBe(false);
    t.p.species = t.rules.species.findIndex((s) => s.key === 'steelix');
    expect(t.derivable('harden', 'x-defense', 'iron-defense')).toBe(true);
  });

  it('かたくなる・てっぺき は防御を上げる（てっぺき の方が大きい）', () => {
    const defense = (key: string | null): number => {
      const t = setup('onix');
      t.p.species = t.rules.species.findIndex((s) => s.key === 'steelix');
      if (key) t.p.moves.push({ move: t.move(key), level: 8, cooldown: 0, burstLeft: 0, burstTimer: 0 });
      recomputeModifiers(t.sim.world, t.p);
      return (t.p as Player).defense;
    };
    expect(defense('harden')).toBeGreaterThan(defense(null));
    expect(defense('iron-defense')).toBeGreaterThan(defense('harden'));
  });
});

describe('ヘラクロス', () => {
  it('カウンター・つっぱり を覚え、カウンター ＋ くろおび → リベンジ（ビルドアップ はホウエンの技のまま）', () => {
    const t = setup('heracross');
    for (const k of ['counter', 'arm-thrust']) expect(canLearnNewMove(t.sim.world, t.p, t.move(k)), k).toBe(true);
    expect(canLearnNewMove(t.sim.world, t.p, t.move('bulk-up'))).toBe(false);
    expect(t.derivable('counter', 'black-belt', 'revenge')).toBe(true);
  });
});

describe('プリン（デバッファー）', () => {
  it('カントーのプリン: はたく・うたう・あまえる・チャームボイス で技が決まっている', () => {
    const t = setup('jigglypuff', 'kanto');
    expect(t.keys()).toEqual(['pound', 'sing', 'charm', 'disarming-voice']);
    expect(t.p.fixedMoves).toBe(true);
  });

  it('あまえる ＋ ディフェンダー → じゃれつく、チャームボイス ＋ スペシャルアップ → マジカルシャイン。ハイパーボイス には進化しない', () => {
    const t = setup('jigglypuff', 'kanto');
    expect(t.derivable('charm', 'x-defense', 'play-rough')).toBe(true);
    expect(t.derivable('disarming-voice', 'x-sp-atk', 'dazzling-gleam-jigglypuff')).toBe(true);
    expect(t.derivable('sing', 'silk-scarf', 'hyper-voice')).toBe(false);
  });

  it('あまえる・じゃれつく: 前の敵の攻撃を下げ、真後ろの敵には当たらない（自分から円が出ない。07 の174章）', () => {
    for (const key of ['charm', 'play-rough']) {
      const t = setup('jigglypuff', 'kanto');
      t.p.facingX = 1;
      t.p.facingY = 0;
      t.p.moves = [{ move: t.move(key), level: 8, cooldown: 0, burstLeft: 0, burstTimer: 0 }];
      for (let k = 0; k < 6; k++) t.sim.world.enemies.add(k + 1, 0, 70 + k * 12, (k % 3) * 10 - 10, 1e6, 0, 10);
      t.sim.world.enemies.add(99, 0, -80, 0, 1e6, 0, 10);
      for (let k = 0; k < 40; k++) t.sim.step([]);
      const down = t.rules.status.kinds.findIndex((s) => s.id === 'attackDown');
      const n = [...Array(6).keys()].filter((i) => t.sim.world.enemies.hasStatus(i, down)).length;
      expect(n, key).toBeGreaterThan(0);
      expect(t.sim.world.enemies.hp[6], `${key} の後ろ`).toBe(1e6);
    }
  });

  it('ふみつけ・いびき も真後ろの敵には当たらない。マジカルシャイン（プリン）は離れた敵の足元で弾ける', () => {
    const behind = (line: string, key: string, extra: string[] = []): number => {
      const t = setup(line, 'kanto');
      t.p.facingX = 1;
      t.p.facingY = 0;
      t.p.moves = [key, ...extra].map((k) => ({ move: t.move(k), level: 8, cooldown: 0, burstLeft: 0, burstTimer: 0 }));
      t.sim.world.enemies.add(1, 0, 60, 0, 1e6, 0, 10);
      t.sim.world.enemies.add(2, 0, -60, 0, 1e6, 0, 10);
      for (let k = 0; k < 150; k++) t.sim.step([]);
      expect(t.sim.world.enemies.hp[0], `${key} の前`).toBeLessThan(1e6);
      return t.sim.world.enemies.hp[1]!;
    };
    expect(behind('miltank', 'stomp')).toBe(1e6);
    expect(behind('snorlax', 'snore', ['rest'])).toBe(1e6);
    // 光は向きに関係なく、届く範囲の敵の足元で弾ける
    expect(behind('jigglypuff', 'dazzling-gleam-jigglypuff')).toBeLessThan(1e6);
  });

  it('ププリンも同じ技を覚え、プリンになると同じ形になる', () => {
    const t = setup('igglybuff');
    for (const k of ['sing', 'charm', 'disarming-voice']) expect(canLearnNewMove(t.sim.world, t.p, t.move(k)), k).toBe(true);
    t.p.walked = 30000;
    checkEvolution(t.sim.world, t.p);
    expect(t.keys()).toEqual(['pound', 'sing', 'charm', 'disarming-voice']);
  });

  it('ププリンのうちは技進化せず、プリンになると はたく ＋ プラスパワー → おうふくビンタ が出る', () => {
    const t = setup('igglybuff');
    expect(t.derivable('pound', 'x-attack', 'double-slap')).toBe(false);
    t.p.walked = 30000;
    checkEvolution(t.sim.world, t.p);
    expect(t.derivable('pound', 'x-attack', 'double-slap')).toBe(true);
  });
});
