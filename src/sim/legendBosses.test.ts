import { describe, expect, it } from 'vitest';
import { buildSimRules } from '../data/simRules';
import { Simulation } from './simulation';
import { activeLegendField } from './systems/stage';

/**
 * 伝説ボスの強化（作者の案 2026年10月26日）: 本番のデータで伝説戦を始めて、それぞれの戦い方を確かめる
 */
function legend(id: string, players = 1) {
  const rules = buildSimRules();
  const sim = new Simulation({ tickRate: 30, seed: 3, rules });
  for (let k = 0; k < players; k++) sim.addPlayer({ id: k + 1, x: k * 120, y: 0, radius: 12, moveSpeed: 0 });
  const kind = rules.enemies.kinds.findIndex((k) => k.id === id);
  sim.world.cleared = true;
  sim.world.legendary = { kind, appearTick: sim.world.tick + 1, endTick: sim.world.tick + 30 * 600, spawned: false, result: null };
  for (let t = 0; t < 3; t++) sim.step([]);
  const e = sim.world.enemies;
  const i = [...Array(e.count).keys()].find((k) => e.kind[k] === kind)!;
  return { rules, sim, kind, i, p: sim.world.players[0]! };
}

function moveId(sim: Simulation, idx: number): string {
  return sim.world.rules.stage.moves[idx]!.id;
}

describe('ミュウツー', () => {
  it('ランダムなプレイヤーの場所へテレポートし、現れた直後に自分の周りの範囲技を使う', () => {
    const { sim, i } = legend('legend-mewtwo');
    const seen = new Set<string>();
    for (let t = 0; t < 30 * 3; t++) {
      sim.step([]);
      for (const ev of sim.world.events) if (ev.type === 'hazardTelegraphed') seen.add(moveId(sim, ev.move));
    }
    expect(seen.has('mewtwo-warp')).toBe(true);
    expect(seen.has('mewtwo-burst')).toBe(true);
    // テレポートした先は、プレイヤーのすぐそば
    const e = sim.world.enemies;
    expect(Math.hypot(e.x[i]!, e.y[i]!)).toBeLessThan(150);
  });
});

describe('フリーザー', () => {
  it('戦いの間、毎秒 最大 HP の 1% を削られて遅くなり、HP が 10% を切ると凍る', () => {
    const { sim, p } = legend('legend-articuno');
    expect(activeLegendField(sim.world)?.field.damagePctPerSecond).toBe(1);
    // 範囲技に当たらないよう、ずっと無敵にして数える（ふぶきは無敵でも削られる）
    const before = p.hp;
    for (let t = 0; t < 30 * 4; t++) {
      p.invincibleTicks = 2;
      sim.step([]);
    }
    expect(before - p.hp).toBeCloseTo((p.maxHp * 4) / 100, 0);
    expect(p.zoneSlowPct).toBeGreaterThan(0);
    p.hp = p.maxHp * 0.09;
    p.invincibleTicks = 999;
    sim.step([]);
    expect(p.frozenTicks).toBeGreaterThan(0);
  });
});

describe('サンダー', () => {
  it('動かず、マップの落雷と、自分から飛ぶ電気の玉を出し続ける', () => {
    const { sim, i } = legend('legend-zapdos');
    const e = sim.world.enemies;
    const x0 = e.x[i]!;
    const y0 = e.y[i]!;
    let bolts = 0;
    let bullets = 0;
    for (let t = 0; t < 30 * 3; t++) {
      sim.world.players[0]!.invincibleTicks = 2;
      sim.step([]);
      for (const ev of sim.world.events) {
        if (ev.type !== 'hazardTelegraphed') continue;
        const id = moveId(sim, ev.move);
        if (id === 'zapdos-field-bolt') bolts++;
        if (id === 'zapdos-spray') bullets++;
      }
    }
    expect(bolts).toBeGreaterThanOrEqual(6);
    expect(bullets).toBeGreaterThanOrEqual(12);
    expect(e.x[i]).toBeCloseTo(x0);
    expect(e.y[i]).toBeCloseTo(y0);
    // 飛ぶ玉は動いている
    const moving = sim.world.hazards.filter((h) => moveId(sim, h.move) === 'zapdos-spray' && h.activeTicks !== undefined);
    expect(moving.some((h) => Math.hypot(h.x - x0, h.y - y0) > 50)).toBe(true);
  });
});

describe('ファイヤー', () => {
  it('にらみつけるで防御が下がり、ゴッドバードは一番 HP の多いプレイヤーを追いかける（必中）', () => {
    const { sim } = legend('legend-moltres', 2);
    expect(activeLegendField(sim.world)?.field.defenseMultiplier).toBe(0.75);
    const [a, b] = sim.world.players;
    a!.hp = a!.maxHp * 0.3;
    let homing = null as null | (typeof sim.world.hazards)[number];
    for (let t = 0; t < 30 * 3 && !homing; t++) {
      sim.step([]);
      homing = sim.world.hazards.find((h) => moveId(sim, h.move) === 'moltres-skyattack' && h.activeTicks === undefined) ?? null;
    }
    expect(homing?.follow).toBe(b!.id);
    // 狙われた人が動いても、予告がついて来る
    b!.x += 200;
    sim.step([]);
    expect(homing!.x).toBeCloseTo(b!.x);
  });
});

describe('ミュウ', () => {
  it('テレポートと、カントーの固有技をまねた技を、交互にくり返す', () => {
    const { sim } = legend('legend-mew');
    const order: string[] = [];
    for (let t = 0; t < 30 * 4; t++) {
      sim.world.players[0]!.invincibleTicks = 2;
      sim.step([]);
      for (const ev of sim.world.events) if (ev.type === 'hazardTelegraphed' && ev.delay === 0) order.push(moveId(sim, ev.move));
    }
    const teleports = order.filter((m) => m === 'mew-teleport').length;
    const others = new Set(order.filter((m) => m !== 'mew-teleport'));
    expect(teleports).toBeGreaterThanOrEqual(3);
    expect(others.size).toBeGreaterThanOrEqual(3);
  });
});

describe('色違いの御三家（プレイヤーと同じ技）', () => {
  const hostile = (sim: Simulation, key: string): number => {
    const pr = sim.world.projectiles;
    const move = sim.world.rules.moves.findIndex((m) => m.key === key);
    let n = 0;
    for (let i = 0; i < pr.count; i++) if (pr.move[i] === move && pr.owner[i]! >= 60000) n++;
    return n;
  };

  it('リザードン: かえんほうしゃ・ほのおのうずをずっと出し、プレイヤーに当たる（敵には当たらない）', () => {
    const { sim, p } = legend('shiny-charizard');
    let flame = 0;
    let spin = 0;
    const hp = p.hp;
    for (let t = 0; t < 30 * 3; t++) {
      sim.step([]);
      flame = Math.max(flame, hostile(sim, 'flamethrower'));
      spin = Math.max(spin, hostile(sim, 'fire-spin'));
    }
    expect(flame).toBeGreaterThan(0);
    expect(spin).toBeGreaterThan(0);
    expect(p.hp).toBeLessThan(hp);
  });

  it('リザードン: 突進の後に、プレイヤーと同じブラストバーンを出す', () => {
    const { sim } = legend('shiny-charizard');
    let blast = 0;
    for (let t = 0; t < 30 * 6; t++) {
      sim.world.players[0]!.invincibleTicks = 2;
      sim.step([]);
      blast = Math.max(blast, hostile(sim, 'blast-burn'));
    }
    expect(blast).toBeGreaterThan(0);
  });

  it('フシギバナ: はなびらのまい・ヘドロばくだんを出し、ソーラービームの予告は狙った人を追う', () => {
    const { sim } = legend('shiny-venusaur');
    let petal = 0;
    let sludge = 0;
    let beam = null as null | (typeof sim.world.hazards)[number];
    for (let t = 0; t < 30 * 5 && !beam; t++) {
      sim.world.players[0]!.invincibleTicks = 2;
      sim.step([]);
      petal = Math.max(petal, hostile(sim, 'petal-dance'));
      sludge = Math.max(sludge, hostile(sim, 'sludge-bomb'));
      beam = sim.world.hazards.find((h) => moveId(sim, h.move) === 'venusaur-solar-beam' && h.activeTicks === undefined) ?? null;
    }
    expect(petal).toBeGreaterThan(0);
    expect(sludge).toBeGreaterThan(0);
    expect(beam).not.toBeNull();
    const p = sim.world.players[0]!;
    p.y += 300;
    sim.step([]);
    const toP = Math.atan2(p.y - beam!.y, p.x - beam!.x);
    expect(Math.abs(Math.atan2(beam!.dirY, beam!.dirX) - toP)).toBeLessThan(0.05);
  });

  it('カメックス: 離れると甲羅の形で速く追い、ためた後にハイドロカノンを一周に出す', () => {
    const { sim, i, kind } = legend('shiny-blastoise');
    const e = sim.world.enemies;
    // 遠くへ離す
    sim.world.players[0]!.x = e.x[i]! + 600;
    for (let t = 0; t < 10; t++) {
      sim.world.players[0]!.invincibleTicks = 2;
      sim.step([]);
    }
    expect(sim.world.legendAi?.shell).toBe(true);
    expect(e.speed[i]).toBeGreaterThan(sim.world.rules.enemies.kinds[kind]!.moveSpeed * 2);
    let cannon = 0;
    for (let t = 0; t < 30 * 6; t++) {
      sim.world.players[0]!.invincibleTicks = 2;
      sim.step([]);
      cannon = Math.max(cannon, hostile(sim, 'hydro-cannon'));
    }
    expect(cannon).toBeGreaterThanOrEqual(12);
  });
});
