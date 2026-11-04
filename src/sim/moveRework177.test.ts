import { describe, expect, it } from 'vitest';
import { effectRecipes } from '../data';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { applyOffer, makeOffers } from './systems/leveling';

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
    // マジカルシャイン（トゲチック）は 07 の184章で、敵の所に光の花が咲く技になった
    const g = setup('dazzling-gleam', 'johto');
    expect(g.rules.moves[g.m]!.pattern).toBe('strike');
    g.e.add(1, g.kindOf('normal'), 150, 0, 1e6, 0, 10);
    g.e.add(2, g.kindOf('normal'), -150, 0, 1e6, 0, 10);
    for (let k = 0; k < 10; k++) g.sim.step([]);
    expect(g.e.hp[0]!).toBeLessThan(1e6);
    expect(g.e.hp[1]!).toBeLessThan(1e6);
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

describe('ドラゴン 600 族の固有技・げきりん（07 の184章）', () => {
  it('カイリュー: ドラゴンテール ＋ りゅうのキバ → ドラゴンクロー、ドラゴンクロー ＋ エアスラッシュ最大 → げきりん（ボーマンダと同じ。07 の185章）', () => {
    const rules = buildSimRules('kanto');
    const sim = new Simulation({ tickRate: 30, seed: 1, rules });
    const lo = playableLoadout(rules, 'dratini');
    const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, types: lo.types, moveTypes: lo.moveTypes, fixedMoves: lo.fixedMoves, line: lo.line, species: lo.species, moves: [] });
    const move = (k: string): number => moveIndexOf(rules, k);
    const pm = (k: string, level: number) => ({ move: move(k), level, cooldown: 0, burstLeft: 0, burstTimer: 0 });
    const derives = (k: string) => makeOffers(sim.world, p).find((o) => o.kind === 'derive' && o.to === move(k));
    const seen = (k: string): boolean => Array.from({ length: 40 }, () => derives(k)).some(Boolean);
    const dragonite = rules.species.findIndex((s) => s.key === 'dragonite');
    p.items = [{ item: rules.items.findIndex((x) => x.key === 'dragon-fang'), level: 1 }];

    // ミニリュウの間は ドラゴンダイブ だけ。カイリューになると ドラゴンクロー も選べる
    p.moves = [pm('dragon-tail', 8)];
    expect(seen('dragon-rush')).toBe(true);
    expect(seen('dragon-claw')).toBe(false);
    p.species = dragonite;
    expect(seen('dragon-rush')).toBe(true);
    expect(seen('dragon-claw')).toBe(true);

    // げきりん は持ち物がいらない。エアスラッシュ が最大でないと出ない。エアスラッシュ は消費しない
    p.items = [];
    p.moves = [pm('dragon-claw', 8), pm('air-slash', 7)];
    expect(seen('outrage')).toBe(false);
    p.moves = [pm('dragon-claw', 8), pm('air-slash', 8)];
    expect(seen('outrage')).toBe(true);
    applyOffer(sim.world, p, derives('outrage') ?? { kind: 'derive', slot: 0, to: move('outrage'), item: -1, unique: true });
    expect(p.moves.map((m) => m.move).sort()).toEqual([move('outrage'), move('air-slash')].sort());
  });

  it('ボーマンダは りゅうのはどう ＋ シルクのスカーフ で はかいこうせん', () => {
    const hoenn = buildSimRules('hoenn');
    expect(hoenn.derivations.find((d) => d.line === 'bagon' && d.from === moveIndexOf(hoenn, 'dragon-pulse') && d.to === moveIndexOf(hoenn, 'hyper-beam'))).toBeDefined();
  });

  it('げきりん: 近くの敵へ次々に飛びかかり、Lv8 は 5 回。終わると少し動けない。周りに敵がいなければ始めない', () => {
    const none = setup('outrage');
    none.e.add(1, none.kindOf('normal'), 600, 0, 1e6, 0, 10);
    for (let k = 0; k < 40; k++) none.sim.step([]);
    expect(none.p.moves[0]!.seq).toBeUndefined();
    expect(none.p.x).toBe(0);

    const dashes = (level: number): { n: number; recovered: boolean; hurt: boolean } => {
      const t = setup('outrage');
      t.p.moves[0]!.level = level;
      t.e.add(1, t.kindOf('boss'), 100, 0, 1e9, 0, 28);
      let n = 0;
      let recovered = false;
      for (let k = 0; k < 40; k++) {
        t.sim.step([]);
        n += t.sim.world.events.filter((ev) => ev.type === 'dashStarted').length;
        if (t.p.recoverTicks) recovered = true;
      }
      return { n, recovered, hurt: t.e.hp[0]! < 1e9 };
    };
    expect(dashes(1)).toEqual({ n: 3, recovered: true, hurt: true });
    expect(dashes(4)).toEqual({ n: 4, recovered: true, hurt: true });
    expect(dashes(8)).toEqual({ n: 5, recovered: true, hurt: true });
  });

  it('ふんえん の絵は床の高さに描く', () => {
    expect(effectRecipes['lava-plume']!.drawOnFloor).toBe(true);
  });
});

describe('ふんか は 3 系統がそれぞれの形で覚える', () => {
  it('バクフーン: かえんほうしゃ ＋ ポイントマックス。エンテイ: かえんほうしゃ ＋ ほのおのいし。ドンメルの条件はほかの系統に掛からない', () => {
    const rules = buildSimRules('johto');
    const move = (k: string): number => moveIndexOf(rules, k);
    const offered = (line: string, form: string, item: string): boolean => {
      const sim = new Simulation({ tickRate: 30, seed: 1, rules });
      const lo = playableLoadout(rules, line);
      const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, types: lo.types, moveTypes: lo.moveTypes, fixedMoves: lo.fixedMoves, line: lo.line, species: rules.species.findIndex((s) => s.key === form), moves: [] });
      p.moves = [{ move: move('flamethrower'), level: 8, cooldown: 0, burstLeft: 0, burstTimer: 0 }];
      p.items = [{ item: rules.items.findIndex((x) => x.key === item), level: 1 }];
      return makeOffers(sim.world, p).some((o) => o.kind === 'derive' && o.to === move('eruption'));
    };
    expect(offered('cyndaquil', 'typhlosion', 'pp-max')).toBe(true);
    expect(offered('cyndaquil', 'typhlosion', 'hp-up')).toBe(false);
    expect(offered('entei', 'entei', 'fire-stone')).toBe(true);
  });
});
