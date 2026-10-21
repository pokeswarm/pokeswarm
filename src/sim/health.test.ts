import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { deriveStats, rankMultiplier, type SimSpecies } from './species';
import { addXp, applyOffer } from './systems/leveling';
import { testRules } from './testRules';
import { emptyModifiers } from './upgrades';

const stats = testRules().stats;
const st = (hp: number, attack: number, defense: number, specialAttack: number, specialDefense: number, speed: number) => ({
  hp,
  attack,
  defense,
  specialAttack,
  specialDefense,
  speed,
});

describe('種族値のランクとステータス', () => {
  it('種族値の区切りで倍率が決まる', () => {
    expect([30, 50, 69, 70, 100, 129, 130, 150].map((v) => rankMultiplier(stats, v))).toEqual([0.7, 0.85, 0.85, 1, 1.15, 1.3, 1.45, 1.45]);
  });

  it('進化前より進化後が強い（ヒトカゲ → リザードン）。防御は ぼうぎょ・とくぼう の高い方', () => {
    const charmander: SimSpecies = { key: 'c', types: [1], baseStats: st(39, 52, 43, 60, 50, 65), evolutions: [] };
    const charizard: SimSpecies = { key: 'z', types: [1], baseStats: st(78, 84, 78, 109, 85, 100), evolutions: [] };
    const a = deriveStats(stats, charmander, 1);
    const b = deriveStats(stats, charizard, 1);
    expect(b.maxHp).toBeGreaterThan(a.maxHp);
    expect(b.specialPower).toBeGreaterThan(a.specialPower);
    // リザードンの防御は とくぼう 85 で決まる（ぼうぎょ 78 より高い）
    expect(b.defense).toBe(stats.base.defense * rankMultiplier(stats, 85));
  });
});

/** 敵がプレイヤーに重なって止まっている状況 */
function hurtSim(stats: NonNullable<Parameters<typeof testRules>[0]>['stats'] = {}) {
  const rules = testRules({ move: { range: 1 }, stats });
  rules.enemies.kinds[0]!.contactDamage = 10;
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0 });
  sim.world.enemies.add(1, 0, 5, 0, 1000, 0, 10, 10);
  return { sim, p };
}

describe('HP とダメージ', () => {
  it('敵に触れるとダメージを受け、無敵時間の間は受けない', () => {
    const { sim, p } = hurtSim();
    sim.step([]);
    expect(p.hp).toBe(90);
    for (let t = 0; t < 10; t++) sim.step([]);
    expect(p.hp).toBe(90);
    for (let t = 0; t < 10; t++) sim.step([]);
    expect(p.hp).toBe(80);
  });

  it('防御でダメージが減る（100 / (100 + 防御)）', () => {
    const { sim, p } = hurtSim({ base: { maxHp: 100, power: 1, defense: 100 } });
    sim.step([]);
    expect(p.hp).toBe(95);
  });

  it('HP が無くなると、復活可能数があれば自動で復活する。無ければ倒れて動かなくなる', () => {
    const { sim, p } = hurtSim({ revive: { initialCount: 1, hpPct: 50, invincibleSeconds: 0.1, touchSeconds: 1, touchRange: 40 } });
    p.hp = 5;
    sim.step([]);
    expect(p.down).toBe(false);
    expect(p.hp).toBe(50);
    expect(sim.world.revives).toBe(0);
    p.hp = 5;
    for (let t = 0; t < 10; t++) sim.step([]);
    expect(p.down).toBe(true);
    sim.step([{ type: 'move', playerId: 1, dx: 1, dy: 0 }]);
    sim.step([]);
    expect(p.x).toBe(0);
  });

  it('たべのこしで回復する（最大HPまで）', () => {
    const rules = testRules({ items: [{ key: 'leftovers', category: 'stat', maxLevel: 5, consumable: false, perLevel: { ...emptyModifiers(4), regenPerSecond: 3 } }] });
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0 });
    applyOffer(sim.world, p, { kind: 'itemNew', item: 0 });
    p.hp = 50;
    for (let t = 0; t < 30; t++) sim.step([]);
    expect(p.hp).toBeCloseTo(53);
    p.hp = 99.99;
    for (let t = 0; t < 30; t++) sim.step([]);
    expect(p.hp).toBe(100);
  });

  it('吸収（lifesteal）で与えたダメージの一部を回復する', () => {
    const rules = testRules({ move: { cooldownSeconds: 100, power: 20, lifestealPct: 50 } });
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0 });
    p.hp = 50;
    sim.world.enemies.add(1, 0, 150, 0, 1000, 0, 10);
    for (let t = 0; t < 30; t++) sim.step([]);
    expect(p.hp).toBe(60);
  });
});

describe('進化', () => {
  /** 0 ヒトカゲ役 → 1 リザード役（Lv16）→ 2 リザードン役（Lv36、ひこうが加わる）、3 イーブイ役 →（石）4 ブースター役 / →（ヒモ）5 */
  function evoRules() {
    const base = st(80, 80, 80, 80, 80, 80);
    const strong = st(100, 100, 100, 100, 100, 100);
    return testRules({
      items: [
        { key: 'fire-stone', category: 'evolution', maxLevel: 1, consumable: true, perLevel: emptyModifiers(4) },
        { key: 'linking-cord', category: 'evolution', maxLevel: 1, consumable: true, perLevel: emptyModifiers(4) },
      ],
      species: [
        { key: 'charmander', types: [1], baseStats: base, evolutions: [{ to: 1, trigger: 'level', level: 16 }] },
        { key: 'charmeleon', types: [1], baseStats: base, evolutions: [{ to: 2, trigger: 'level', level: 36 }] },
        { key: 'charizard', types: [1, 3], baseStats: strong, evolutions: [] },
        { key: 'eevee', types: [0], baseStats: base, evolutions: [{ to: 4, trigger: 'item', item: 0 }] },
        { key: 'flareon', types: [1], baseStats: strong, evolutions: [] },
        { key: 'traded', types: [0], baseStats: base, evolutions: [{ to: 2, trigger: 'trade', item: 1 }] },
      ],
    });
  }

  function levelTo(sim: Simulation, level: number) {
    let need = 0;
    for (let l = sim.world.level; l < level; l++) need += sim.world.rules.leveling.xpToNext[l]!;
    addXp(sim.world, need);
    sim.world.pendingLevelUps = 0;
    sim.step([]);
  }

  it('原作どおりのレベルで進化し、タイプとステータスが変わる', () => {
    const sim = new Simulation({ tickRate: 30, seed: 1, rules: evoRules() });
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, species: 0, types: [1], moves: [] });
    levelTo(sim, 15);
    expect(p.species).toBe(0);
    levelTo(sim, 16);
    expect(p.species).toBe(1);
    const hpBefore = p.maxHp;
    levelTo(sim, 36);
    expect(p.species).toBe(2);
    expect(p.types).toEqual([1, 3]);
    expect(p.maxHp).toBeGreaterThan(hpBefore);
  });

  it('石を持つと進化し、石はなくなる。石が無ければ進化しない', () => {
    const sim = new Simulation({ tickRate: 30, seed: 1, rules: evoRules() });
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, species: 3, types: [0], moves: [] });
    levelTo(sim, 50);
    expect(p.species).toBe(3);
    applyOffer(sim.world, p, { kind: 'itemNew', item: 0 });
    expect(p.species).toBe(4);
    expect(p.items).toEqual([]);
  });

  it('つながりのヒモで、通信交換で進化するポケモンが進化する', () => {
    const sim = new Simulation({ tickRate: 30, seed: 1, rules: evoRules() });
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, species: 5, types: [0], moves: [] });
    applyOffer(sim.world, p, { kind: 'itemNew', item: 1 });
    expect(p.species).toBe(2);
    expect(p.items).toEqual([]);
  });
});
