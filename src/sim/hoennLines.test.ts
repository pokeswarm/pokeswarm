import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { abilityOf, abilitySturdy } from './ability';
import { applyOffer, makeOffers, moveMaxLevel } from './systems/leveling';
import { hurtPlayer } from './systems/health';
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
  it('ドンメル: バクーダの姿 ＋ ふんえん最大 ＋ だいちのちから Lv8 ＋ ひでりの区間で ふんか', () => {
    const t = setup('numel');
    t.p.moves = [];
    t.give('lava-plume-hoenn', 8);
    t.give('earth-power', 8);
    t.p.moves[0]!.level = moveMaxLevel(t.rules, t.p.moves[0]!);
    expect(t.derives('eruption-hoenn')).toBeUndefined();
    t.p.species = t.species('camerupt');
    expect(t.derives('eruption-hoenn')).toBeUndefined();
    // ひでりの区間を探す
    const sun = t.rules.weatherSections!.findIndex((w) => w.kinds.includes('sun'));
    expect(sun).toBeGreaterThanOrEqual(0);
    t.sim.world.section = sun;
    t.sim.world.sectionStartTick = t.sim.world.tick;
    expect(t.derives('eruption-hoenn')).toBeDefined();
  });

  it('アブソル: ランの記録（急所の回数）は本人から届いたコマンドで付き、数に届くと ナイトバースト が出る', () => {
    const t = setup('absol');
    t.p.moves = [];
    t.give('night-slash', 8);
    t.p.moves[0]!.level = moveMaxLevel(t.rules, t.p.moves[0]!);
    t.give('future-sight-hoenn', 8);
    expect(t.derives('night-daze')).toBeUndefined();
    t.sim.step([{ type: 'runStat', playerId: 1, stat: 'crits', value: 150 }]);
    expect(t.derives('night-daze')).toBeDefined();
  });

  it('カゲボウズ: のろいのおふだ が最大（持ち物の強化の段階）のときだけ ゴーストダイブ', () => {
    const t = setup('shuppet');
    t.p.species = t.species('banette');
    t.p.moves = [];
    t.give('shadow-ball-hoenn', 8);
    t.p.moves[0]!.level = moveMaxLevel(t.rules, t.p.moves[0]!);
    t.give('fire-spin-hoenn', 8);
    t.p.items.push({ item: t.item('spell-tag'), level: 4 });
    expect(t.derives('phantom-force')).toBeUndefined();
    t.p.items[0]!.level = 5;
    expect(t.derives('phantom-force')).toBeDefined();
  });

  it('ダンバル: メタルコート（進化の道具）は派生の材料なので、進化しなくても候補に出る', () => {
    const t = setup('beldum');
    t.p.moves[0]!.level = moveMaxLevel(t.rules, t.p.moves[0]!);
    const coat = t.item('metal-coat');
    (t.p as { unlockedItems?: unknown }).unlockedItems = undefined;
    const seen = Array.from({ length: 60 }, () => makeOffers(t.sim.world, t.p)).flat().some((o) => o.kind === 'itemNew' && o.item === coat);
    expect(seen).toBe(true);
  });

  it('カゲボウズの おにび（ほのお）は、タイプに関わらず ジュペッタで候補に出る', () => {
    const t = setup('shuppet');
    t.p.species = t.species('banette');
    const seen = Array.from({ length: 80 }, () => makeOffers(t.sim.world, t.p)).flat().some((o) => o.kind === 'moveNew' && o.move === t.move('will-o-wisp'));
    expect(seen).toBe(true);
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
