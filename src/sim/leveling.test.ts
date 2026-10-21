import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { addXp, applyOffer, derivationCompletedBy, makeOffers } from './systems/leveling';
import { testMove, testRules } from './testRules';
import { emptyModifiers, type SimUpgradeDef } from './upgrades';

const FIRE = 1;

function upgrade(key: string, maxLevel: number, consumable: boolean, mods: Partial<ReturnType<typeof emptyModifiers>>): SimUpgradeDef {
  return { key, maxLevel, consumable, perLevel: { ...emptyModifiers(4), ...mods } };
}

/**
 * 技: 0 テスト用（ノーマル）、1 ひのこ役（ほのお・最大レベル1）、2 派生先、3 固有技
 * 持ち物: 0 プラスパワー役（威力 +10%）、1 石（消える）
 * パッシブ: 0 移動速度 +10%
 */
function rules(overrides: Parameters<typeof testRules>[0] = {}) {
  return testRules({
    extraMoves: [
      testMove('ember', 'nearest', { range: 1 }, FIRE),
      testMove('flamethrower', 'nearest', { range: 1 }, FIRE),
      testMove('blast-burn', 'nearest', { range: 1 }, FIRE),
    ],
    items: [upgrade('x-attack', 5, false, { powerPct: 10 }), upgrade('fire-stone', 1, true, {})],
    passives: [upgrade('carbos', 5, false, { moveSpeedPct: 10 })],
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
  it('タイプの持ち物は、自分のタイプのものだけ候補に出る', () => {
    const WATER = 2;
    const r = rules({ items: [upgrade('charcoal', 5, false, {}), upgrade('mystic-water', 5, false, {})] });
    r.items[0]!.perLevel.typePowerPct[FIRE] = 15;
    r.items[1]!.perLevel.typePowerPct[WATER] = 15;
    const sim = new Simulation({ tickRate: 30, seed: 5, rules: r });
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, types: [FIRE], moves: [] });
    const seen = new Set<number>();
    for (let k = 0; k < 40; k++) for (const o of makeOffers(sim.world, p)) if (o.kind === 'itemNew') seen.add(o.item);
    expect([...seen]).toEqual([0]);
  });
});

describe('持ち物・パッシブの効果', () => {
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

  it('パッシブで移動速度が上がる', () => {
    const { sim, p } = makeSim();
    applyOffer(sim.world, p, { kind: 'passiveNew', passive: 0 });
    expect(p.moveSpeed).toBeCloseTo(110);
  });
});

describe('「進化できる！」の判定（このカードを取ると派生の条件がそろうか）', () => {
  it('元の技が最大で材料の持ち物が候補に出たとき・材料を持っていて最後の強化が候補に出たとき', () => {
    const { sim, p } = makeSim();
    // テスト用の技は最大レベル1なので、ひのこ役（番号1）は最初から最大
    expect(derivationCompletedBy(sim.world, p, { kind: 'itemNew', item: 0 })).toMatchObject({ from: 1, to: 2 });
    expect(derivationCompletedBy(sim.world, p, { kind: 'itemNew', item: 1 })).toBeNull();
    expect(derivationCompletedBy(sim.world, p, { kind: 'passiveNew', passive: 0 })).toBeNull();
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
