import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf } from '../data/simRules';
import { Simulation } from './simulation';

/** 07 の177章: 技で起きていることから作り直した技 */
function setup(move: string, region = 'kanto') {
  const rules = buildSimRules(region);
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  const m = moveIndexOf(rules, move);
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, moves: [{ move: m, level: 1 }] });
  p.facingX = 1;
  p.facingY = 0;
  const pr = sim.world.projectiles;
  const mine = (): number[] => [...Array(pr.count).keys()].filter((i) => pr.move[i] === m);
  const status = (id: string): number => rules.status.kinds.findIndex((k) => k.id === id);
  const kindOf = (rank: 'normal' | 'boss'): number => rules.enemies.kinds.findIndex((k) => (rank === 'normal' ? (k.rank ?? 'normal') === 'normal' : (k.rank ?? 'normal') !== 'normal'));
  return { rules, sim, p, m, pr, mine, status, kindOf, e: sim.world.enemies };
}

describe('体が本当に動く技', () => {
  it('のしかかり: 前に敵がいると跳んで進み、着いた所の敵がぺしゃんこになる。跳んでいる間は無敵', () => {
    const t = setup('body-slam');
    t.e.add(1, t.kindOf('normal'), 80, 0, 1e6, 0, 10);
    t.sim.step([]);
    expect(t.p.invincibleTicks).toBeGreaterThan(0);
    expect(t.sim.world.events.some((ev) => ev.type === 'dashStarted')).toBe(true);
    // 跳んでいる途中はまだ当たらない
    expect(t.e.hp[0]).toBe(1e6);
    for (let k = 0; k < 12; k++) t.sim.step([]);
    expect(t.p.x).toBeCloseTo(80, 0);
    expect(t.e.hp[0]!).toBeLessThan(1e6);
    expect(t.e.hasStatus(0, t.status('squashed'))).toBe(true);
  });

  it('前に敵がいなければ動かない（後ろにだけいるときも）', () => {
    for (const move of ['body-slam', 'double-edge']) {
      const t = setup(move);
      t.e.add(1, t.kindOf('normal'), -80, 0, 1e6, 0, 10);
      for (let k = 0; k < 40; k++) t.sim.step([]);
      expect(t.p.x, move).toBe(0);
    }
  });

  it('進んでいる間は入力で動けない', () => {
    const t = setup('body-slam');
    t.e.add(1, t.kindOf('normal'), 80, 0, 1e6, 0, 10);
    t.sim.step([]);
    const y = t.p.y;
    t.sim.step([{ type: 'move', playerId: 1, dx: 0, dy: 1 }]);
    t.sim.step([]);
    expect(t.p.y).toBe(y);
  });

  it('すてみタックル: 前へ突進し、通った道の敵を前へはね飛ばして回す。反動で HP が減る', () => {
    const t = setup('double-edge');
    t.e.add(1, t.kindOf('normal'), 70, 0, 1e6, 0, 10);
    const hp = t.p.hp;
    for (let k = 0; k < 8; k++) t.sim.step([]);
    expect(t.p.x).toBeGreaterThan(60);
    expect(t.p.hp).toBeLessThan(hp);
    expect(t.e.hp[0]!).toBeLessThan(1e6);
    expect(t.e.hasStatus(0, t.status('flung'))).toBe(true);
    expect(t.e.kbVx[0]!).toBeGreaterThan(0);
  });

  it('ボスはぺしゃんこにならない', () => {
    const t = setup('body-slam');
    t.e.add(1, t.kindOf('boss'), 80, 0, 1e6, 0, 10);
    for (let k = 0; k < 14; k++) t.sim.step([]);
    expect(t.e.hp[0]!).toBeLessThan(1e6);
    expect(t.e.hasStatus(0, t.status('squashed'))).toBe(false);
  });
});

describe('サイコキネシス: つかんで投げる', () => {
  it('雑魚は浮いて止まり、0.5 秒後に向いている方へ飛び、通り道の敵に当たる', () => {
    const t = setup('psychic');
    t.p.moves[0]!.level = t.rules.moves[t.m]!.levels.length + 1;
    t.e.add(1, t.kindOf('normal'), 0, 100, 1e6, 0, 10);
    t.sim.step([]);
    expect(t.e.hasStatus(0, t.status('lifted'))).toBe(true);
    const y = t.e.y[0]!;
    for (let k = 0; k < 10; k++) t.sim.step([]);
    expect(t.e.y[0]).toBeCloseTo(y, 3);
    // 右へ飛んでいく先に別の敵を置く（まだつかまれていない敵）
    t.e.add(2, t.kindOf('normal'), t.e.x[0]! + 60, t.e.y[0]!, 1e6, 0, 10);
    t.p.moves[0]!.cooldown = 99;
    for (let k = 0; k < 16; k++) t.sim.step([]);
    expect(t.e.x[0]!).toBeGreaterThan(40);
    expect(t.e.hp[1]!).toBeLessThan(1e6);
  });

  it('ボスは浮かず、飛ばされず、その場で大きなダメージを受ける', () => {
    const t = setup('psychic');
    t.e.add(1, t.kindOf('boss'), 100, 0, 1e6, 0, 10);
    t.sim.step([]);
    expect(t.e.hasStatus(0, t.status('lifted'))).toBe(false);
    const hp = t.e.hp[0]!;
    t.p.moves[0]!.cooldown = 99;
    for (let k = 0; k < 18; k++) t.sim.step([]);
    expect(t.e.hp[0]!).toBeLessThan(hp);
    expect(t.e.kbTicks[0]).toBe(0);
  });
});

describe('じしん: 地面全体が揺れる', () => {
  it('止まっているとたまらず、走るとたまって、地上の敵が揺れる。ひこうタイプには効かない', () => {
    const t = setup('earthquake');
    const flying = t.rules.types.names.indexOf('flying');
    const air = t.rules.enemies.kinds.findIndex((k) => (k.rank ?? 'normal') === 'normal' && k.types?.includes(flying));
    const ground = t.rules.enemies.kinds.findIndex((k) => (k.rank ?? 'normal') === 'normal' && !k.types?.includes(flying));
    expect(air).toBeGreaterThanOrEqual(0);
    t.e.add(1, ground, -300, 200, 1e6, 0, 10);
    t.e.add(2, air, 300, -200, 1e6, 0, 10);
    t.p.moves[0]!.cooldown = 1;
    for (let k = 0; k < 60; k++) t.sim.step([]);
    expect(t.e.hp[0]).toBe(1e6);
    for (let k = 0; k < 40; k++) t.sim.step([{ type: 'move', playerId: 1, dx: 1, dy: 0 }]);
    expect(t.e.hp[0]!).toBeLessThan(1e6);
    expect(t.e.hp[1]).toBe(1e6);
  });
});

describe('バークアウト: 吠えて、おびえさせる', () => {
  it('吠え声が口から 3 つ前へ飛び、当たった雑魚はプレイヤーから逃げ出す', () => {
    const t = setup('snarl', 'johto');
    t.e.add(1, t.kindOf('normal'), 70, 0, 1e6, 60, 10);
    const seen: number[] = [];
    let scared = false;
    for (let k = 0; k < 12; k++) {
      t.sim.step([]);
      seen.push(t.mine().length);
      if (t.e.hasStatus(0, t.status('scared'))) scared = true;
    }
    expect(Math.max(...seen)).toBe(3);
    expect(scared).toBe(true);
    const x = t.e.x[0]!;
    t.p.moves[0]!.cooldown = 99;
    t.e.kbTicks[0] = 0;
    t.sim.step([]);
    expect(t.e.x[0]!).toBeGreaterThan(x);
  });

  it('ボスは逃げず、追いかけ続ける', () => {
    const t = setup('snarl', 'johto');
    t.e.add(1, t.kindOf('boss'), 70, 0, 1e6, 60, 10);
    for (let k = 0; k < 10; k++) t.sim.step([]);
    t.p.moves[0]!.cooldown = 99;
    t.e.kbTicks[0] = 0;
    const x = t.e.x[0]!;
    t.sim.step([]);
    expect(t.e.x[0]!).toBeLessThanOrEqual(x);
  });
});

describe('ハイパーボイス: 輪の音波と広がる音の輪', () => {
  it('一番近い敵を追いかけて飛び、当たった所から音の輪が広がる', () => {
    const t = setup('hyper-voice');
    t.e.add(1, t.kindOf('normal'), 0, -120, 1e6, 0, 10);
    t.e.add(2, t.kindOf('normal'), 30, -130, 1e6, 0, 10);
    let ring = false;
    for (let k = 0; k < 30; k++) {
      t.sim.step([]);
      if (t.mine().some((i) => t.pr.stage[i] === 1 && t.pr.band[i]! > 0)) ring = true;
    }
    expect(ring).toBe(true);
    expect(t.e.hp[0]!).toBeLessThan(1e6);
    expect(t.e.hp[1]!).toBeLessThan(1e6);
  });
});

describe('そのほか', () => {
  it('あまえる: 近くの敵へ 1 つ飛び、攻撃を下げる。後ろの敵でも近ければ狙う', () => {
    const t = setup('charm', 'johto');
    t.e.add(1, t.kindOf('normal'), -60, 0, 1e6, 0, 10);
    for (let k = 0; k < 20; k++) t.sim.step([]);
    expect(t.e.hasStatus(0, t.status('attackDown'))).toBe(true);
  });

  it('いびき: 眠っている間に Z が漂い出て、触れた敵がうとうとする', () => {
    const rules = buildSimRules('kanto');
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 100, moves: ['rest', 'snore'].map((k) => ({ move: moveIndexOf(rules, k), level: 8 })) });
    for (let k = 0; k < 8; k++) sim.world.enemies.add(k + 1, 0, Math.cos(k) * 60, Math.sin(k) * 60, 1e6, 0, 10);
    const drowsy = rules.status.kinds.findIndex((k) => k.id === 'drowsy');
    let hit = false;
    for (let k = 0; k < 240 && !hit; k++) {
      sim.step([]);
      hit = [...Array(8).keys()].some((i) => sim.world.enemies.hasStatus(i, drowsy));
    }
    expect(p.sleep?.asleep).toBe(true);
    expect(hit).toBe(true);
  });

  it('エアカッター: 刃が 3 枚前へ飛ぶ。マジカルシャイン（トゲチック）: 前の扇の光', () => {
    const a = setup('air-cutter');
    a.sim.step([]);
    const blades = a.mine();
    expect(blades).toHaveLength(3);
    for (const i of blades) expect(a.pr.vx[i]!).toBeGreaterThan(0);
    const g = setup('dazzling-gleam', 'johto');
    g.e.add(1, g.kindOf('normal'), 150, 0, 1e6, 0, 10);
    g.e.add(2, g.kindOf('normal'), -150, 0, 1e6, 0, 10);
    for (let k = 0; k < 10; k++) g.sim.step([]);
    expect(g.e.hp[0]!).toBeLessThan(1e6);
    expect(g.e.hp[1]).toBe(1e6);
  });
});

describe('ギガインパクト・ドラゴンダイブ・ふんえん（07 の182章）', () => {
  it('ギガインパクト: ためてから前へ突進し、その後は動けず技も出ない。ケッキングは動けない時間が短い', () => {
    const t = setup('giga-impact');
    t.e.add(1, t.kindOf('normal'), 120, 0, 1e6, 0, 10);
    // ためている間は進まない
    for (let k = 0; k < 10; k++) t.sim.step([]);
    expect(t.p.x).toBe(0);
    for (let k = 0; k < 16; k++) t.sim.step([]);
    expect(t.p.x).toBeGreaterThan(150);
    expect(t.p.recoverTicks!).toBeGreaterThan(0);
    const x = t.p.x;
    t.sim.step([{ type: 'move', playerId: 1, dx: 1, dy: 0 }]);
    t.sim.step([]);
    expect(t.p.x).toBe(x);
    const def = t.rules.moves[t.m]!.dash!;
    expect(def.recoverSeconds * def.recoverLines!.slakoth!).toBeLessThan(def.recoverSeconds);
    for (let k = 0; k < 40; k++) t.sim.step([]);
    expect(t.p.recoverTicks).toBe(0);
  });

  it('ドラゴンダイブ: 敵が一番多い所へ降り、着く前からそこの敵がすくむ。降りるまで無敵', () => {
    const t = setup('dragon-rush');
    t.e.add(1, t.kindOf('normal'), -200, 0, 1e6, 0, 10);
    for (let k = 0; k < 6; k++) t.e.add(k + 2, t.kindOf('normal'), 200 + k * 4, k * 4, 1e6, 0, 10);
    t.sim.step([]);
    t.sim.step([]);
    expect(t.p.invincibleTicks).toBeGreaterThan(0);
    expect(t.e.hasStatus(1, t.status('cowed'))).toBe(true);
    expect(t.e.hasStatus(0, t.status('cowed'))).toBe(false);
    for (let k = 0; k < 20; k++) t.sim.step([]);
    expect(t.p.x).toBeGreaterThan(150);
    expect(t.e.hp[1]!).toBeLessThan(1e6);
    expect(t.e.hp[0]).toBe(1e6);
  });

  it('ふんえん: 走った跡に煙が残って敵を焼く。止まっていると出ない', () => {
    const t = setup('lava-plume', 'hoenn');
    for (let k = 0; k < 30; k++) t.sim.step([]);
    expect(t.mine()).toHaveLength(0);
    for (let k = 0; k < 30; k++) t.sim.step([{ type: 'move', playerId: 1, dx: 1, dy: 0 }]);
    const puffs = t.mine();
    expect(puffs.length).toBeGreaterThan(1);
    const xs = puffs.map((i) => t.pr.x[i]!);
    expect(Math.max(...xs)).toBeGreaterThan(Math.min(...xs));
    t.e.add(1, t.kindOf('normal'), xs[0]!, 0, 1e6, 0, 10);
    for (let k = 0; k < 10; k++) t.sim.step([]);
    expect(t.e.hp[0]!).toBeLessThan(1e6);
  });
});

describe('とっておき: 消費した技が順に出る連続技（07 の183章）', () => {
  const run = (consumed: string[]) => {
    const t = setup('last-resort');
    t.p.moves[0]!.level = 8;
    t.p.consumedMoves = consumed.map((k) => moveIndexOf(t.rules, k));
    // 駆ける段が届かない所に置く（すぐ前だと、星が出たその瞬間に当たって消え、数えられない）
    t.e.add(1, t.kindOf('normal'), 200, 0, 1e6, 0, 10);
    // 出た順に、段の技の名前を並べる
    const order: string[] = [];
    for (let k = 0; k < 30; k++) {
      t.sim.step([]);
      for (let i = 0; i < t.pr.count; i++) {
        const key = t.rules.moves[t.pr.move[i]!]!.key;
        if (key.startsWith('last-resort-') && !order.includes(key)) order.push(key);
      }
    }
    return { t, order };
  };

  it('何も消費していなければ、跳んで踏みつける → 虹の爆発 だけ', () => {
    expect(run([]).order).toEqual(['last-resort-slam', 'last-resort-burst']);
  });

  it('スピードスター を使っていると星の段が増える', () => {
    expect(run(['swift']).order).toEqual(['last-resort-stars', 'last-resort-slam', 'last-resort-burst']);
  });

  it('でんこうせっか か すてみタックル を使っていると駆ける段が増える。全部で 4 段がこの順に出る', () => {
    for (const rush of ['quick-attack', 'double-edge']) {
      expect(run([rush]).order, rush).toEqual(['last-resort-rush', 'last-resort-slam', 'last-resort-burst']);
      expect(run([rush, 'swift']).order, rush).toEqual(['last-resort-rush', 'last-resort-stars', 'last-resort-slam', 'last-resort-burst']);
    }
  });

  it('段を出すと体が前へ進み、敵に当たる', () => {
    const { t } = run(['swift', 'quick-attack']);
    expect(t.p.x).toBeGreaterThan(100);
    expect(t.e.hp[0]!).toBeLessThan(1e6);
  });

  it('前に敵がいなければ始めない', () => {
    const t = setup('last-resort');
    t.e.add(1, t.kindOf('normal'), -90, 0, 1e6, 0, 10);
    for (let k = 0; k < 40; k++) t.sim.step([]);
    expect(t.p.x).toBe(0);
    expect(t.p.moves[0]!.seq).toBeUndefined();
    expect(t.e.hp[0]).toBe(1e6);
  });

  it('消費した技が多いほど強い（Lv16 + 星 が Lv8 より、Lv24 + 全段 が Lv16 より）', () => {
    const lost = (level: number, consumed: string[]): number => {
      const t = setup('last-resort');
      t.p.moves[0]!.level = level;
      t.p.consumedMoves = consumed.map((k) => moveIndexOf(t.rules, k));
      t.e.add(1, t.kindOf('boss'), 30, 0, 1e9, 0, 28);
      for (let k = 0; k < 300; k++) {
        t.e.kbTicks[0] = 0;
        t.e.x[0] = t.p.x + 30;
        t.e.y[0] = t.p.y;
        t.sim.step([]);
      }
      return 1e9 - t.e.hp[0]!;
    };
    const a = lost(8, []);
    const b = lost(16, ['swift']);
    const c = lost(24, ['swift', 'quick-attack']);
    expect(b).toBeGreaterThan(a * 1.5);
    expect(c).toBeGreaterThan(b * 1.5);
  });
});
