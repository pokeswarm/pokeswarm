import { describe, expect, it } from 'vitest';
import { effectRecipes, stageConfig } from '../data';
import { buildSimRules, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { activeLegendField, legendRoundKinds, startIntruder } from './systems/stage';
import { applyItem } from './systems/items';

/** ホウエンのクリアの後（作者の決定 2026年11月4日。07 の189章）: ダイゴ（メタグロス）→ グラードン ＋ カイオーガ → 確率でレックウザ（いんせきならデオキシス） */
function setup(seed = 1) {
  const rules = buildSimRules('hoenn');
  const sim = new Simulation({ tickRate: 30, seed, rules });
  const lo = playableLoadout(rules, 'treecko');
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, types: lo.types, moves: [], line: lo.line, species: lo.species });
  const kindIndex = (id: string): number => rules.enemies.kinds.findIndex((k) => k.id === id);
  const w = sim.world;
  const living = (): string[] => {
    const out: string[] = [];
    for (let i = 0; i < w.enemies.count; i++) if (w.enemies.hp[i]! > 0) out.push(rules.enemies.kinds[w.enemies.kind[i]!]!.id);
    return out;
  };
  /** 今の相手が出るまで進めて、全員倒す */
  const clearRound = (): string[] => {
    for (let k = 0; k < 200 && w.legendary && !w.legendary.spawned; k++) sim.step([]);
    const kinds = legendRoundKinds(w, w.legendary!.kind);
    const names = kinds.map((k) => rules.enemies.kinds[k]!.id);
    const cmds = [];
    for (let i = 0; i < w.enemies.count; i++) {
      if (w.enemies.hp[i]! > 0 && kinds.includes(w.enemies.kind[i]!)) cmds.push({ type: 'damageEnemy' as const, id: w.enemies.id[i]!, amount: 1e9, by: 1, kbx: 0, kby: 0, kbTicks: 0, status: -1, statusTicks: 0 });
    }
    sim.step(cmds);
    return names;
  };
  /** ミクリを倒した所まで飛ばす */
  const clear = () => {
    w.requiredLeft.clear();
    sim.step([]);
  };
  return { rules, sim, w, p, kindIndex, living, clearRound, clear };
}

/** 最後の戦いの抽選が当たるシードと外れるシードを探す */
function seedWhere(hit: boolean): number {
  for (let s = 1; s < 500; s++) {
    const t = setup(s);
    t.clear();
    t.clearRound();
    t.clearRound();
    if ((t.w.legendary?.result === null && !t.w.outcome) === hit) return s;
  }
  throw new Error('no seed');
}

describe('ホウエンのクリアの後', () => {
  it('ダイゴはメタグロスだけ。次にグラードン ＋ カイオーガ。外れならそこで勝って終わる', () => {
    const t = setup(seedWhere(false));
    t.clear();
    expect(t.clearRound()).toEqual(['steven-metagross']);
    expect(t.clearRound().sort()).toEqual(['legend-groudon', 'legend-kyogre']);
    expect(t.w.outcome).toBeTruthy();
  });

  it('当たればレックウザ', () => {
    const t = setup(seedWhere(true));
    t.clear();
    t.clearRound();
    t.clearRound();
    expect(t.clearRound()).toEqual(['legend-rayquaza']);
    expect(t.w.outcome).toBeTruthy();
  });

  it('いんせきを持っていれば、確率に関わらずレックウザの代わりにデオキシス', () => {
    for (const hit of [true, false]) {
      const t = setup(seedWhere(hit));
      t.w.items.push({ id: 900, kind: 'meteorite', x: 0, y: 0, ticksLeft: 999, pending: false } as never);
      applyItem(t.w, 900, 1, 'meteorite', 0);
      t.clear();
      t.clearRound();
      t.clearRound();
      expect(t.clearRound()).toEqual(['legend-deoxys']);
    }
  });

  it('天気の伝説の場は30秒ごとに入れ替わり、片方を倒すと残った方のまま', () => {
    const t = setup(1);
    t.clear();
    t.clearRound();
    for (let k = 0; k < 200 && !t.w.legendary!.spawned; k++) t.sim.step([]);
    const a = activeLegendField(t.w)!.field.groundTint;
    t.w.tick += 30 * 30;
    t.sim.step([]);
    const b = activeLegendField(t.w)!.field.groundTint;
    expect(a).not.toBe(b);
    // カイオーガを倒すとグラードンの日差しのまま
    const ky = t.kindIndex('legend-kyogre');
    let i = 0;
    while (t.w.enemies.kind[i] !== ky) i++;
    t.sim.step([{ type: 'damageEnemy', id: t.w.enemies.id[i]!, amount: 1e9, by: 1, kbx: 0, kby: 0, kbTicks: 0, status: -1, statusTicks: 0 }]);
    for (const add of [0, 30 * 30]) {
      t.w.tick += add;
      t.sim.step([]);
      expect(activeLegendField(t.w)!.field.typePowerPct).toEqual(t.rules.stage.legendary!.moveSets['legend-groudon']!.field!.typePowerPct);
    }
  });

  it('ラティアス ＋ ラティオスは2体一緒に乱入する', () => {
    const t = setup(1);
    startIntruder(t.w, t.kindIndex('legend-latias'));
    for (let k = 0; k < 200 && t.w.intruder!.id === -1; k++) t.sim.step([]);
    expect(t.living().filter((x) => x.startsWith('legend-')).sort()).toEqual(['legend-latias', 'legend-latios']);
  });

  it('グラードン・カイオーガ・レックウザ・デオキシス・ダイゴのメタグロスはボスとして数える', () => {
    const k = buildSimRules('hoenn').enemies.kinds;
    for (const id of ['steven-metagross', 'legend-groudon', 'legend-kyogre', 'legend-rayquaza', 'legend-deoxys']) expect(k.find((x) => x.id === id)?.asBoss, id).toBe(true);
    expect(k.find((x) => x.id === 'legend-latias')?.asBoss).toBeUndefined();
  });

  it('デオキシスの技は HP で4段階に変わる', () => {
    const r = buildSimRules('hoenn').stage.legendary!.moveSets['legend-deoxys']!;
    expect(r.phases?.map((p) => p.belowHpPct)).toEqual([75, 50, 25]);
  });
});

describe('ボスの技を避けられるように（07 の190章）', () => {
  const moves = stageConfig.moves;
  const of = (id: string) => moves.find((m) => m.id === id)!;

  it('スピードスターは追わない、まっすぐの星の弾幕', () => {
    for (const id of ['espeon-swift', 'deoxys-swift']) {
      const m = of(id);
      expect(m.travel?.homingDegreesPerSecond ?? 0).toBe(0);
      expect(m.arms?.count).toBeGreaterThanOrEqual(7);
      expect(m.repeat?.count).toBeGreaterThanOrEqual(3);
    }
  });

  it('必中（予告が最後まで追う）はファイヤーとフシギバナだけ（どちらも作者が決めた形）', () => {
    expect(moves.filter((m) => m.homing).map((m) => m.id).sort()).toEqual(['moltres-skyattack', 'venusaur-solar-beam']);
  });

  it('追う予告は、止まってから落ちるまでに、プレイヤーの速さで範囲の外へ出られる', () => {
    const speed = 180;
    for (const m of moves.filter((x) => x.follow)) {
      const left = m.telegraphSeconds - m.follow!.seconds;
      expect(left * speed, m.id).toBeGreaterThan(m.radius);
    }
  });

  it('ダメージのある扇の技には、必ず絵がある', () => {
    for (const m of moves.filter((x) => x.shape === 'cone' && x.damage > 0)) {
      const r = effectRecipes[m.effect];
      expect(r?.strike ?? r?.bossActive, m.id).toBeTruthy();
    }
  });
});

describe('ボスの光線は体から出る・メタグロスの動き（07 の191章）', () => {
  /** kind だけを伝説として出す（1 ラウンド目を差し替える） */
  function fight(kindId: string, seed = 3) {
    const base = buildSimRules('hoenn');
    const legendary = { ...base.stage.legendary!, rounds: [{ kinds: [kindId] }], finale: undefined, intruders: undefined };
    const rules = { ...base, stage: { ...base.stage, legendary } } as typeof base;
    const sim = new Simulation({ tickRate: 30, seed, rules });
    const lo = playableLoadout(rules, 'treecko');
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, types: lo.types, moves: [], line: lo.line, species: lo.species });
    sim.world.requiredLeft.clear();
    for (let k = 0; k < 400 && !sim.world.bosses.length; k++) sim.step([]);
    return { rules, sim, w: sim.world, p };
  }
  const bossIndex = (w: ReturnType<typeof fight>['w']): number => {
    for (let i = 0; i < w.enemies.count; i++) if (w.enemies.id[i] === w.bosses[0]!.id) return i;
    return -1;
  };

  it('デオキシスの直線の技は、落ちる時も本体の場所から出る', () => {
    const { sim, w, p } = fight('legend-deoxys');
    p.invincibleTicks = 1e6;
    const i0 = bossIndex(w);
    expect(i0).toBeGreaterThanOrEqual(0);
    // 第4段階まで見る（テレポートと光線が続く）
    w.enemies.hp[i0] = w.enemies.maxHp[i0]! * 0.2;
    let lines = 0;
    for (let t = 0; t < 30 * 40; t++) {
      p.hp = p.maxHp;
      p.x = Math.cos(t / 40) * 250;
      p.y = Math.sin(t / 40) * 250;
      sim.step([]);
      const i = bossIndex(w);
      if (i < 0) break;
      for (const h of w.hazards) {
        const m = w.rules.stage.moves[h.move]!;
        if (h.shape !== 'line' || !m.rooted || h.activeTicks !== undefined || h.ticksLeft > 1) continue;
        lines++;
        expect(Math.hypot(h.x - w.enemies.x[i]!, h.y - w.enemies.y[i]!), m.id).toBeLessThan(40);
      }
    }
    expect(lines).toBeGreaterThan(3);
  });

  it('メタグロスは離れると一度構えてから一気に来る。プレイヤーより速い', () => {
    const { sim, w, p } = fight('steven-metagross');
    p.invincibleTicks = 1e6;
    const i = bossIndex(w);
    p.x = w.enemies.x[i]! + 800;
    p.y = w.enemies.y[i]!;
    sim.step([]);
    const ai = w.legendAis.get(w.bosses[0]!.id)!;
    expect(ai.shell).toBe(true);
    expect(ai.holdTicks).toBeGreaterThan(0);
    expect(w.enemies.speed[i]).toBe(0);
    for (let t = 0; t < 30; t++) sim.step([]);
    expect(w.enemies.speed[i]).toBeGreaterThan(180);
  });
});
