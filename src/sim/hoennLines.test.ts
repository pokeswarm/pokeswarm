import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { abilityOf, abilitySturdy } from './ability';
import { applyOffer, makeOffers, moveMaxLevel } from './systems/leveling';
import { hurtPlayer } from './systems/health';
import { applyItem } from './systems/items';
import type { UpgradeOffer } from './world';

/** ホウエンの残りのプレイアブル（作者の決定 2026年10月29日。07 の133・134章） */
function setup(line: string, id = 1) {
  const rules = buildSimRules('hoenn');
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const add = (pid: number, key: string) => {
    const lo = playableLoadout(rules, key);
    return sim.addPlayer({ id: pid, x: 0, y: 0, radius: 12, moveSpeed: 0, types: lo.types, moveTypes: lo.moveTypes, fixedMoves: lo.fixedMoves, moves: lo.moves, line: lo.line, species: lo.species });
  };
  const p = add(id, line);
  const move = (key: string): number => moveIndexOf(rules, key);
  const species = (key: string): number => rules.species.findIndex((s) => s.key === key);
  const item = (key: string): number => rules.items.findIndex((it) => it.key === key);
  const give = (key: string, level: number) => p.moves.push({ move: move(key), level, cooldown: 0, burstLeft: 0, burstTimer: 0 });
  const derives = (key: string): UpgradeOffer | undefined => makeOffers(sim.world, p).find((o) => o.kind === 'derive' && o.to === move(key));
  return { rules, sim, p, add, move, species, item, give, derives };
}

describe('固有技の条件', () => {
  it('ドンメル: バクーダの姿 ＋ ふんえん最大 ＋ じしん Lv8 ＋ ひでりの区間で ふんか', () => {
    const t = setup('numel');
    t.p.moves = [];
    t.give('lava-plume', 8);
    t.give('earthquake', 8);
    t.p.moves[0]!.level = moveMaxLevel(t.rules, t.p.moves[0]!);
    expect(t.derives('eruption')).toBeUndefined();
    t.p.species = t.species('camerupt');
    expect(t.derives('eruption')).toBeUndefined();
    // ひでりの区間を探す
    const sun = t.rules.weatherSections!.findIndex((w) => w.kinds.includes('sun'));
    expect(sun).toBeGreaterThanOrEqual(0);
    t.sim.world.section = sun;
    t.sim.world.sectionStartTick = t.sim.world.tick;
    expect(t.derives('eruption')).toBeDefined();
  });

  it('アブソル: ランの記録（急所の回数）は本人から届いたコマンドで付き、数に届くと イカサマ が出る', () => {
    const t = setup('absol');
    t.p.moves = [];
    t.give('night-slash', 8);
    t.p.moves[0]!.level = moveMaxLevel(t.rules, t.p.moves[0]!);
    t.give('future-sight', 8);
    expect(t.derives('foul-play')).toBeUndefined();
    t.sim.step([{ type: 'runStat', playerId: 1, stat: 'crits', value: 150 }]);
    expect(t.derives('foul-play')).toBeDefined();
  });

  it('カゲボウズ: ジュペッタの姿 ＋ おどろかす最大 ＋ シャドーボール Lv8 で ゴーストダイブ（作者の決定 2026年11月1日。07 の148章）', () => {
    const t = setup('shuppet');
    t.p.species = t.species('banette');
    t.p.moves = [];
    t.give('astonish', 8);
    t.p.moves[0]!.level = moveMaxLevel(t.rules, t.p.moves[0]!);
    t.give('shadow-ball', 7);
    expect(t.derives('phantom-force')).toBeUndefined();
    t.p.moves[1]!.level = 8;
    expect(t.derives('phantom-force')).toBeDefined();
    t.p.species = t.species('shuppet');
    expect(t.derives('phantom-force')).toBeUndefined();
  });

  it('ダンバル: メタルコート（進化の道具）は派生の材料なので、進化しなくても候補に出る', () => {
    const t = setup('beldum');
    t.p.moves[0]!.level = moveMaxLevel(t.rules, t.p.moves[0]!);
    const coat = t.item('metal-coat');
    (t.p as { unlockedItems?: unknown }).unlockedItems = undefined;
    const seen = Array.from({ length: 60 }, () => makeOffers(t.sim.world, t.p)).flat().some((o) => o.kind === 'itemNew' && o.item === coat);
    expect(seen).toBe(true);
  });

  it('カゲボウズの最初の技は したでなめる（おにび・ほのおのうず はしまった）', () => {
    const t = setup('shuppet');
    expect(t.p.moves.map((m) => m.move)).toEqual([t.move('lick')]);
    expect(t.rules.moves.some((m) => m.key === 'will-o-wisp' || m.key === 'fire-spin-hoenn')).toBe(false);
  });

  it('ゴーストダイブ: 使った瞬間に自分の足元に影の範囲が残り、大きな影が間をあけて1つずつランダムな敵の足元に出る', () => {
    const t = setup('shuppet');
    t.p.moves = [];
    t.give('phantom-force', 1);
    const def = t.rules.moves[t.move('phantom-force')]!;
    expect(def.pattern).toBe('strike');
    expect(def.sequential).toBe(true);
    t.sim.step([
      { type: 'spawnEnemy', id: 1, kind: 0, x: 150, y: 0 },
      { type: 'spawnEnemy', id: 2, kind: 0, x: -150, y: 60 },
    ]);
    t.sim.step([]);
    const pr = t.sim.world.projectiles;
    const count = (stage: number) => {
      let n = 0;
      for (let i = 0; i < pr.count; i++) if (pr.stage[i] === stage) n++;
      return n;
    };
    // 最初の更新で、影 1 つ（stage 0）と足元の範囲（効き方の puddle。stage 1）
    expect(count(0)).toBe(1);
    expect(count(1)).toBe(1);
    let first = -1;
    for (let i = 0; i < pr.count; i++) if (pr.stage[i] === 0) first = pr.serial[i]!;
    // intervalSeconds（0.5 秒）後に 2 つ目（通し番号が後のもの）
    for (let k = 0; k < Math.round(def.levels[0]!.intervalSeconds * 30) + 1; k++) t.sim.step([]);
    let later = 0;
    for (let i = 0; i < pr.count; i++) if (pr.stage[i] === 0 && pr.serial[i]! > first) later++;
    expect(later).toBe(1);
  });

  it('ゴーストダイブ: 足元の影は自分に付いていく（作者の要望 2026年11月1日）', () => {
    const t = setup('shuppet');
    t.p.moves = [];
    t.give('phantom-force', 1);
    t.sim.step([{ type: 'spawnEnemy', id: 1, kind: 0, x: 150, y: 0 }]);
    t.sim.step([]);
    const pr = t.sim.world.projectiles;
    let puddle = -1;
    for (let i = 0; i < pr.count; i++) if (pr.stage[i] === 1 && pr.linger[i] === 1) puddle = i;
    expect(puddle).not.toBe(-1);
    const serial = pr.serial[puddle]!;
    expect(pr.x[puddle]).toBeCloseTo(t.p.x);
    expect(pr.y[puddle]).toBeCloseTo(t.p.y);
    // 自分が動いても、影は足元にある
    t.p.x += 40;
    t.p.y -= 25;
    t.sim.step([]);
    for (let i = 0; i < pr.count; i++) if (pr.serial[i] === serial) puddle = i;
    expect(pr.x[puddle]).toBeCloseTo(t.p.x);
    expect(pr.y[puddle]).toBeCloseTo(t.p.y);
  });
});

describe('特性の効き方', () => {
  it('がんじょう: 区間ごとに1回だけ、倒れる攻撃を HP 1 で耐える', () => {
    const t = setup('aron');
    expect(t.sim.world.localPlayerId).toBe(1);
    hurtPlayer(t.sim.world, t.p, 1e6);
    expect(t.p.down).toBeFalsy();
    expect(t.p.hp).toBe(1);
    expect(abilitySturdy(t.sim.world, t.p)).toBe(false);
  });

  it('なまけ: 技が出るのは2回に1回。ヤルキモノの間は やるき（なまけない）', () => {
    const t = setup('slakoth');
    expect(abilityOf(t.sim.world, t.p)?.key).toBe('truant');
    t.p.species = t.species('vigoroth');
    expect(abilityOf(t.sim.world, t.p)?.key).toBe('vital-spirit');
    t.p.species = t.species('slakoth');
    for (let k = 0; k < 6; k++) t.sim.world.enemies.add(k + 1, 0, 20 + k * 4, 0, 1e6, 0, 10);
    let used = 0;
    for (let k = 0; k < 300; k++) {
      t.sim.step([]);
      used += t.sim.world.events.filter((e) => e.type === 'moveUsed').length;
    }
    const cd = t.rules.moves[t.move('scratch')]!.levels[0]!.cooldownSeconds;
    expect(used).toBeLessThanOrEqual(Math.ceil(300 / 30 / cd / 2) + 1);
    expect(used).toBeGreaterThan(0);
  });

  it('トレース: ソロでは御三家の特性のどれか、協力プレイでは一番近い味方の特性', () => {
    const t = setup('ralts');
    expect(['overgrow', 'blaze', 'torrent']).toContain(abilityOf(t.sim.world, t.p)?.key);
    const ally = t.add(2, 'makuhita');
    ally.x = 30;
    expect(abilityOf(t.sim.world, t.p)?.key).toBe('guts');
  });

  it('たんじゅん: 性格の効き目が2倍。クリアボディ: 下がる能力が下がらない', () => {
    const ratio = (line: string, stat: 'physicalPower' | 'specialPower') => {
      const t = setup(line);
      const adamant = t.rules.natures!.findIndex((x) => x.up === 'attack' && x.down === 'special-attack');
      t.p.nature = undefined;
      applyOffer(t.sim.world, t.p, { kind: 'heal' });
      const plain = t.p[stat];
      t.p.nature = adamant;
      applyOffer(t.sim.world, t.p, { kind: 'heal' });
      return t.p[stat] / plain;
    };
    expect(ratio('numel', 'physicalPower')).toBeCloseTo(1.2);
    expect(ratio('numel', 'specialPower')).toBeCloseTo(0.8);
    expect(ratio('beldum', 'physicalPower')).toBeCloseTo(1.1);
    expect(ratio('beldum', 'specialPower')).toBeCloseTo(1);
    expect(ratio('makuhita', 'specialPower')).toBeCloseTo(0.9);
  });

});

describe('どの系統も、固有技と支えの技を最大で持って動かせる', () => {
  it('18 系統の本線と支えの技を最大にして 20 秒動かしても止まらない', async () => {
    const { derivationsConfig } = await import('../data');
    const lines = ['makuhita', 'electrike', 'numel', 'slakoth', 'swablu', 'absol', 'shuppet', 'spheal', 'bagon', 'feebas', 'beldum', 'ralts', 'trapinch', 'aron', 'azurill', 'wynaut', 'barboach', 'mawile'];
    for (const line of lines) {
      const t = setup(line);
      const keys = new Set(derivationsConfig.unique.filter((u) => u.line === line).flatMap((u) => [u.from, u.to]));
      t.p.moves = [...keys].slice(0, 4).map((k) => ({ move: t.move(k), level: t.rules.moves[t.move(k)]!.levels.length, cooldown: 0, burstLeft: 0, burstTimer: 0 }));
      for (let k = 0; k < 30; k++) t.sim.world.enemies.add(k + 1, 0, 40 + (k % 6) * 30, -100 + Math.floor(k / 6) * 40, 1e6, 0, 10);
      expect(() => {
        for (let k = 0; k < 600; k++) t.sim.step([]);
      }, line).not.toThrow();
      expect(t.sim.world.events.length + t.sim.world.projectiles.count, line).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('箱の中身は地方ごと（07 の188章）', () => {
  const buffsOf = (region: string) => buildSimRules(region).pickups.items.buff!.buffs;
  it('カントーは今のまま・ジョウトはきのみ・ホウエンはポロック', () => {
    expect(buffsOf('kanto').map((b) => b.item)).toContain('x-attack');
    expect(buffsOf('johto').every((b) => b.item.endsWith('-berry'))).toBe(true);
    expect(buffsOf('hoenn').every((b) => b.item.startsWith('pokeblock-') && !!b.contest)).toBe(true);
    expect(new Set(buffsOf('hoenn').map((b) => b.contest)).size).toBe(5);
  });

  it('ポロックは拾った人が部門ごとにためる。オボンのみは強化でなく回復', () => {
    const t = setup('treecko');
    const cool = buffsOf('hoenn').findIndex((b) => b.contest === 'cool');
    t.sim.world.items.push({ id: 900, kind: 'buff', x: 0, y: 0 } as never);
    applyItem(t.sim.world, 900, 1, 'buff', cool);
    expect(t.p.pokeblocks).toEqual({ cool: 1 });
    expect(t.p.buffs?.length).toBe(1);

    const rules = buildSimRules('johto');
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    const lo = playableLoadout(rules, 'cyndaquil');
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, types: lo.types, moves: lo.moves, line: lo.line, species: lo.species });
    p.hp = 1;
    applyItem(sim.world, 901, 1, 'buff', rules.pickups.items.buff!.buffs.findIndex((b) => b.healPct));
    expect(p.hp).toBeCloseTo(1 + p.maxHp * 0.25);
    expect(p.buffs ?? []).toEqual([]);
  });
});

describe('ヌケニン（ふしぎなまもり。07 の188章）', () => {
  const run = (moveKey: string) => {
    const t = setup('treecko');
    const kind = t.rules.enemies.kinds.findIndex((k) => k.id === 'swarm-shedinja');
    t.p.moves = [{ move: t.move(moveKey), level: 1, cooldown: 0, burstLeft: 0, burstTimer: 0 }];
    t.sim.world.enemies.add(1, kind, 60, 0, 1, 0, 12, 0);
    for (let k = 0; k < 120; k++) t.sim.step([]);
    return t.sim.world.stats.kills;
  };
  it('弱点の ほのお の技で倒れる。みず の技はすり抜ける', () => {
    expect(run('ember')).toBe(1);
    expect(run('water-gun')).toBe(0);
  });
  it('ホウエンの爆発役は ヌケニンで、25 秒で消える', () => {
    const r = buildSimRules('hoenn');
    expect(r.stage.swarms.some((s) => s.kind === 'swarm-shedinja' && s.pattern === 'haunt' && s.lifeSeconds === 25)).toBe(true);
    expect(r.stage.swarms.some((s) => s.pattern === 'bomber')).toBe(false);
  });
});
