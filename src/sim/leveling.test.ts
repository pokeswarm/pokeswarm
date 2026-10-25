import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { addXp, applyOffer, derivationCompletedBy, makeOffers } from './systems/leveling';
import { playerMoveStats } from './systems/attack';
import { testMove, testRules } from './testRules';
import { emptyModifiers, type SimUpgradeDef } from './upgrades';

const FIRE = 1;

function upgrade(
  key: string,
  maxLevel: number,
  consumable: boolean,
  mods: Partial<ReturnType<typeof emptyModifiers>>,
  category: SimUpgradeDef['category'] = 'stat',
): SimUpgradeDef {
  return { key, category, maxLevel, consumable, perLevel: { ...emptyModifiers(4), ...mods } };
}

/**
 * 技: 0 テスト用（ノーマル）、1 ひのこ役（ほのお・最大レベル1）、2 派生先、3 固有技
 * 持ち物: 0 プラスパワー役（威力 +10%）、1 石（消える）
 */
function rules(overrides: Parameters<typeof testRules>[0] = {}) {
  return testRules({
    extraMoves: [
      testMove('ember', 'nearest', { range: 1 }, FIRE),
      testMove('flamethrower', 'nearest', { range: 1 }, FIRE),
      testMove('blast-burn', 'nearest', { range: 1 }, FIRE),
    ],
    items: [upgrade('x-attack', 5, false, { powerPct: 10 }), upgrade('fire-stone', 1, true, {})],
    derivations: [
      { from: 1, item: 0, to: 2, line: null },
      { from: 2, item: 1, to: 3, line: 'charmander' },
    ],
    ...overrides,
  });
}

function makeSim(line = 'charmander', moves = [{ move: 1, level: 1 }]) {
  const sim = new Simulation({ tickRate: 30, seed: 5, rules: rules() });
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, types: [FIRE], moves, line });
  return { sim, p };
}

describe('経験値とレベル', () => {
  it('必要な経験値が貯まるとレベルが上がり、選択を待つ数が増える', () => {
    const { sim } = makeSim();
    const need = sim.world.rules.leveling.xpToNext;
    expect(need[1]).toBe(5);
    addXp(sim.world, need[1]! + need[2]! + 1);
    expect(sim.world.level).toBe(3);
    expect(sim.world.pendingLevelUps).toBe(2);
    expect(sim.world.xpIntoLevel).toBe(1);
  });

  it('レベルアップの選択中はゲームが止まる（敵が動かず、時間も進まない）', () => {
    const { sim } = makeSim();
    sim.world.enemies.add(1, 0, 300, 0, 20, 60, 10);
    addXp(sim.world, 5);
    sim.step([]);
    expect(sim.world.levelUp).not.toBeNull();
    const tick = sim.world.tick;
    const x = sim.world.enemies.x[0];
    for (let t = 0; t < 30; t++) sim.step([]);
    expect(sim.world.tick).toBe(tick);
    expect(sim.world.enemies.x[0]).toBe(x);
  });

  it('選ぶと再開し、全員に短い無敵時間が付く', () => {
    const { sim, p } = makeSim();
    addXp(sim.world, 5);
    sim.step([]);
    sim.step([{ type: 'chooseUpgrade', playerId: 1, index: 0 }]);
    sim.step([]);
    expect(sim.world.levelUp).toBeNull();
    expect(p.invincibleTicks).toBeGreaterThan(0);
  });

  it('見送るとリロール権 +1。時間切れも見送ると同じ', () => {
    const { sim, p } = makeSim();
    const before = p.rerolls;
    addXp(sim.world, 5 + 13);
    sim.step([]);
    sim.step([{ type: 'skipUpgrade', playerId: 1 }]);
    sim.step([]);
    expect(p.rerolls).toBe(before + 1);
    // 2回目のレベルアップは時間切れまで待つ
    expect(sim.world.levelUp).not.toBeNull();
    for (let t = 0; t < 15 * 30 + 2; t++) sim.step([]);
    expect(sim.world.levelUp).toBeNull();
    expect(p.rerolls).toBe(before + 2);
  });

  it('リロールは権利を使って候補を引き直す', () => {
    const { sim, p } = makeSim();
    addXp(sim.world, 5);
    sim.step([]);
    const before = p.rerolls;
    sim.step([{ type: 'rerollUpgrades', playerId: 1 }]);
    expect(p.rerolls).toBe(before - 1);
    expect(sim.world.levelUp!.offers.get(1)!.length).toBe(3);
  });

  it('最大レベルの後も経験値を数え、たまるたびに回復かコインを選ぶ（レベルは最大のまま）', () => {
    const { sim } = makeSim();
    const w = sim.world;
    const cfg = w.rules.leveling;
    w.level = cfg.maxLevel;
    const need = cfg.xpToNext[cfg.maxLevel]!;
    expect(need).toBeGreaterThan(0);
    addXp(w, need * 2 + 1);
    expect(w.level).toBe(cfg.maxLevel);
    expect(w.xpIntoLevel).toBe(1);
    expect(w.pendingLevelUps).toBe(2);
    sim.step([]);
    expect(w.levelUp!.overMax).toBe(true);
    expect(w.levelUp!.offers.get(1)!.map((o) => o.kind)).toEqual(['heal', 'coins']);
    sim.step([{ type: 'chooseUpgrade', playerId: 1, index: 1 }]);
    sim.step([]);
    expect(w.levelUp!.overMax).toBe(true);
    sim.step([{ type: 'chooseUpgrade', playerId: 1, index: 0 }]);
    sim.step([]);
    expect(w.levelUp).toBeNull();
    expect(w.pendingLevelUps).toBe(0);
    expect(w.maxLevelUps).toBe(0);
  });
});

describe('候補', () => {
  it('技の枠が埋まっていれば新しい技は出ない', () => {
    const { sim, p } = makeSim('charmander', [
      { move: 0, level: 1 },
      { move: 1, level: 1 },
      { move: 2, level: 1 },
      { move: 3, level: 1 },
    ]);
    for (let k = 0; k < 20; k++) {
      expect(makeOffers(sim.world, p).some((o) => o.kind === 'moveNew')).toBe(false);
    }
  });

  it('派生先・固有技は、タイプの技として直接は出ない', () => {
    const { sim, p } = makeSim('charmander', []);
    for (let k = 0; k < 30; k++) {
      for (const o of makeOffers(sim.world, p)) if (o.kind === 'moveNew') expect([0, 1]).toContain(o.move);
    }
  });

  it('元の技が最大レベルで材料を持っていれば、派生が必ず出る', () => {
    const { sim, p } = makeSim();
    p.items.push({ item: 0, level: 1 });
    expect(makeOffers(sim.world, p)[0]).toEqual({ kind: 'derive', slot: 0, to: 2, item: 0, unique: false });
  });

  it('派生すると元の技と入れ替わる。固有技はその系統だけに出て、石はなくなる', () => {
    const { sim, p } = makeSim();
    p.items.push({ item: 0, level: 1 }, { item: 1, level: 1 });
    applyOffer(sim.world, p, makeOffers(sim.world, p)[0]!);
    expect(p.moves[0]!.move).toBe(2);
    // 派生技を最大レベルにする（テスト用の技は最大レベル1）→ 固有技が出る
    const unique = makeOffers(sim.world, p)[0]!;
    expect(unique).toMatchObject({ kind: 'derive', to: 3, unique: true });
    applyOffer(sim.world, p, unique);
    expect(p.moves[0]!.move).toBe(3);
    expect(p.items.map((it) => it.item)).toEqual([0]);

    const other = makeSim('bulbasaur', [{ move: 2, level: 1 }]);
    other.p.items.push({ item: 1, level: 1 });
    expect(makeOffers(other.sim.world, other.p).some((o) => o.kind === 'derive')).toBe(false);
  });

  it('協力プレイ: ほかのプレイヤーが持っている持ち物も候補に出る（作者の決定で廃止した決まり）', () => {
    const { sim, p } = makeSim('charmander', []);
    const q = sim.addPlayer({ id: 2, x: 0, y: 0, radius: 12, moveSpeed: 100, moves: [] });
    q.items.push({ item: 0, level: 1 });
    let seen = false;
    for (let k = 0; k < 40 && !seen; k++) seen = makeOffers(sim.world, p).some((o) => o.kind === 'itemNew' && o.item === 0);
    expect(seen).toBe(true);
  });
  it('タイプのアイテムは、自分のタイプとノーマルのものだけ候補に出る（ほかの持ち物はだれにでも出る）', () => {
    const WATER = 2;
    const NORMAL = 0;
    const r = rules({
      items: [
        upgrade('charcoal', 5, false, {}, 'type'),
        upgrade('mystic-water', 5, false, {}, 'type'),
        upgrade('silk-scarf', 5, false, {}, 'type'),
        upgrade('water-stone', 1, true, {}, 'evolution'),
      ],
    });
    r.items[0]!.perLevel.typePowerPct[FIRE] = 15;
    r.items[1]!.perLevel.typePowerPct[WATER] = 15;
    r.items[2]!.perLevel.typePowerPct[NORMAL] = 15;
    const sim = new Simulation({ tickRate: 30, seed: 5, rules: r });
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, types: [FIRE], moves: [] });
    const seen = new Set<number>();
    for (let k = 0; k < 40; k++) for (const o of makeOffers(sim.world, p)) if (o.kind === 'itemNew') seen.add(o.item);
    expect([...seen].sort()).toEqual([0, 2, 3]);
  });

  it('候補が1つも無いときは、回復とコインを選べる（回復は最大HP の割合、コインはランの終わりに足す分）', () => {
    const r = rules({ items: [] });
    const sim = new Simulation({ tickRate: 30, seed: 2, rules: r });
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, types: [2], moves: [] });
    // 技を全部持って最大にする（新しい技も強化も出ない）
    p.moves = r.moves.map((m, move) => ({ move, level: m.levels.length, cooldown: 0, burstLeft: 0, burstTimer: 0 }));
    expect(makeOffers(sim.world, p)).toEqual([{ kind: 'heal' }, { kind: 'coins' }]);
    p.maxHp = 100;
    p.hp = 50;
    applyOffer(sim.world, p, { kind: 'heal' });
    expect(p.hp).toBe(70);
    applyOffer(sim.world, p, { kind: 'coins' });
    expect(p.bonusCoins).toBe(20);
  });

  it('技は持ち物の2倍の重みで選ばれる', () => {
    const r = rules({ items: [upgrade('a', 5, false, {})], leveling: { offerCount: 1 } });
    const sim = new Simulation({ tickRate: 30, seed: 9, rules: r });
    // 候補: 新しい技（ノーマルのテスト用の技）1つ・持ち物1つ
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, types: [2], moves: [] });
    let moves = 0;
    const N = 3000;
    for (let k = 0; k < N; k++) if (makeOffers(sim.world, p)[0]!.kind === 'moveNew') moves++;
    expect(moves / N).toBeCloseTo(2 / 3, 1);
  });
});

describe('持ち物の効果', () => {
  it('ポイントマックスで技の数が増え、ひかりのねんどで持続が延びる', () => {
    const r = rules({ items: [upgrade('pp-max', 2, false, { amountBonus: 1 }), upgrade('light-clay', 5, false, { durationPct: 10 })] });
    const sim = new Simulation({ tickRate: 30, seed: 1, rules: r });
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100 });
    const before = playerMoveStats(sim.world, p, p.moves[0]!);
    applyOffer(sim.world, p, { kind: 'itemNew', item: 0 });
    applyOffer(sim.world, p, { kind: 'itemUp', slot: 0 });
    applyOffer(sim.world, p, { kind: 'itemNew', item: 1 });
    const after = playerMoveStats(sim.world, p, p.moves[0]!);
    expect(after.count).toBe(before.count + 2);
    expect(after.durationSeconds).toBeCloseTo(before.durationSeconds * 1.1);
  });

  it('ズームレンズで射程が延び、するどいツメで貫通が増える（何体でも当たる技はそのまま）', () => {
    const r = rules({ items: [upgrade('zoom-lens', 5, false, { rangePct: 10 }), upgrade('razor-claw', 2, false, { pierceBonus: 1 })] });
    const sim = new Simulation({ tickRate: 30, seed: 1, rules: r });
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100 });
    const before = playerMoveStats(sim.world, p, p.moves[0]!);
    applyOffer(sim.world, p, { kind: 'itemNew', item: 0 });
    applyOffer(sim.world, p, { kind: 'itemNew', item: 1 });
    applyOffer(sim.world, p, { kind: 'itemUp', slot: 1 });
    const after = playerMoveStats(sim.world, p, p.moves[0]!);
    expect(after.range).toBeCloseTo(before.range * 1.1);
    expect(after.pierce).toBe(before.pierce + 2);
  });

  it('プラスパワー Lv2 で技のダメージ +20%', () => {
    const r = rules();
    r.moves[0]!.levels[0]!.cooldownSeconds = 100;
    const sim = new Simulation({ tickRate: 30, seed: 1, rules: r });
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100 });
    applyOffer(sim.world, p, { kind: 'itemNew', item: 0 });
    applyOffer(sim.world, p, { kind: 'itemUp', slot: 0 });
    sim.world.enemies.add(1, 0, 150, 0, 100, 0, 10);
    for (let t = 0; t < 30; t++) sim.step([]);
    expect(100 - sim.world.enemies.hp[0]!).toBeCloseTo(12);
  });

});

describe('「進化できる！」の判定（このカードを取ると派生の条件がそろうか）', () => {
  it('元の技が最大で材料の持ち物が候補に出たとき・材料を持っていて最後の強化が候補に出たとき', () => {
    const { sim, p } = makeSim();
    // テスト用の技は最大レベル1なので、ひのこ役（番号1）は最初から最大
    expect(derivationCompletedBy(sim.world, p, { kind: 'itemNew', item: 0 })).toMatchObject({ from: 1, to: 2 });
    expect(derivationCompletedBy(sim.world, p, { kind: 'itemNew', item: 1 })).toBeNull();
  });

  it('派生先をもう持っていれば出さない', () => {
    const { sim, p } = makeSim('charmander', [
      { move: 1, level: 1 },
      { move: 2, level: 1 },
    ]);
    expect(derivationCompletedBy(sim.world, p, { kind: 'itemNew', item: 0 })).toBeNull();
  });
});

describe('でんきだまとボルテッカー（ピカチュウ）', () => {
  function pikachuRules() {
    const r = rules({
      items: [upgrade('x-attack', 5, false, { powerPct: 10 }), { ...upgrade('light-ball', 1, false, {}), lines: ['pikachu'], powerMultiplier: 2 }],
      derivations: [{ from: 1, item: 1, to: 3, line: 'pikachu', minLevel: 51 }],
    });
    r.moves[1] = { ...r.moves[1]!, levels: [r.moves[1]!.levels[0]!] };
    return r;
  }

  it('でんきだまはピカチュウの候補にだけ出る', () => {
    const r = pikachuRules();
    const seen = (line: string): boolean => {
      const sim = new Simulation({ tickRate: 30, seed: 5, rules: r });
      const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, types: [FIRE], moves: [], line });
      for (let k = 0; k < 40; k++) if (makeOffers(sim.world, p).some((o) => o.kind === 'itemNew' && o.item === 1)) return true;
      return false;
    };
    expect(seen('pikachu')).toBe(true);
    expect(seen('charmander')).toBe(false);
  });

  it('でんきだまとかみなりのいしは片方だけ。でんきだまは進化していない姿だけ', () => {
    const r = pikachuRules();
    r.items = [r.items[0]!, { ...r.items[1]!, forms: [0], excludes: [2] }, upgrade('thunder-stone', 1, true, {}, 'evolution')];
    const offered = (held: number[], species = 0): Set<number> => {
      const sim = new Simulation({ tickRate: 30, seed: 5, rules: r });
      const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, types: [FIRE], moves: [], line: 'pikachu' });
      p.species = species;
      p.items = held.map((item) => ({ item, level: 1 }));
      const seen = new Set<number>();
      for (let k = 0; k < 60; k++) for (const o of makeOffers(sim.world, p)) if (o.kind === 'itemNew') seen.add(o.item);
      return seen;
    };
    expect(offered([]).has(1)).toBe(true);
    expect(offered([]).has(2)).toBe(true);
    // でんきだまを持っていれば、かみなりのいしは出ない（その逆も）
    expect(offered([1]).has(2)).toBe(false);
    expect(offered([2]).has(1)).toBe(false);
    // 進化した後（別の姿）には、でんきだまは出ない
    expect(offered([], 1).has(1)).toBe(false);
  });

  it('レベル51になるまでは、条件がそろってもボルテッカーは出ない', () => {
    const sim = new Simulation({ tickRate: 30, seed: 5, rules: pikachuRules() });
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, types: [FIRE], moves: [{ move: 1, level: 1 }], line: 'pikachu' });
    p.items.push({ item: 1, level: 1 });
    sim.world.level = 50;
    expect(makeOffers(sim.world, p).some((o) => o.kind === 'derive')).toBe(false);
    sim.world.level = 51;
    expect(makeOffers(sim.world, p)[0]).toMatchObject({ kind: 'derive', to: 3 });
    // でんきだまはなくならない
    applyOffer(sim.world, p, makeOffers(sim.world, p)[0]!);
    expect(p.items.map((it) => it.item)).toEqual([1]);
  });
});

describe('遊べるポケモンの設定（作者の決定 2026年10月23日）', () => {
  const WATER = 3;
  const offeredMoves = (init: { moveTypes?: number[]; fixedMoves?: boolean }): Set<number> => {
    const r = rules({ extraMoves: [testMove('ember', 'nearest', { range: 1 }, FIRE), testMove('flamethrower', 'nearest', { range: 1 }, FIRE), testMove('blast-burn', 'nearest', { range: 1 }, FIRE), testMove('water-gun', 'nearest', { range: 1 }, WATER)] });
    const sim = new Simulation({ tickRate: 30, seed: 5, rules: r });
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, types: [FIRE], moves: [{ move: 1, level: 1 }], line: 'x', ...init });
    const seen = new Set<number>();
    for (let k = 0; k < 60; k++) for (const o of makeOffers(sim.world, p)) if (o.kind === 'moveNew') seen.add(o.move);
    return seen;
  };

  it('追加の技のタイプ（コダック: エスパー）の技も候補に出る', () => {
    expect(offeredMoves({}).has(4)).toBe(false);
    expect(offeredMoves({ moveTypes: [WATER] }).has(4)).toBe(true);
  });

  it('技を覚えないポケモン（プリン）には、新しい技を候補に出さない', () => {
    expect(offeredMoves({}).size).toBeGreaterThan(0);
    expect(offeredMoves({ fixedMoves: true }).size).toBe(0);
  });
});

describe('覚えられる系統（learners。作者の決定 2026年10月24日）', () => {
  it('系統が決まっている技は、その系統と、何でも覚えるポケモンだけの候補に出る', () => {
    const offered = (line: string, learnsAll = false): boolean => {
      const r = rules({ extraMoves: [testMove('ember', 'nearest', { range: 1 }, FIRE), testMove('flamethrower', 'nearest', { range: 1 }, FIRE), testMove('blast-burn', 'nearest', { range: 1 }, FIRE), { ...testMove('sing', 'nearest', { range: 1 }, 0), learners: ['jigglypuff'] }] });
      const sim = new Simulation({ tickRate: 30, seed: 5, rules: r });
      const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, types: [FIRE], moves: [{ move: 1, level: 1 }], line, learnsAll });
      for (let k = 0; k < 60; k++) if (makeOffers(sim.world, p).some((o) => o.kind === 'moveNew' && o.move === 4)) return true;
      return false;
    };
    expect(offered('jigglypuff')).toBe(true);
    expect(offered('charmander')).toBe(false);
    expect(offered('mew', true)).toBe(true);
  });
});
