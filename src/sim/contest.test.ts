import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { appealMultiplier, applyContest, crowdAir, crowdPeaks, primaryScore } from './contest';
import { Simulation } from './simulation';
import { RunRecorder } from '../meta/runRecorder';
import { SaveStore } from '../meta/saveStore';
import { itemSprites, moveSprites, shopConfig } from '../data';
import { confirmItem, spawnItem } from './systems/items';

/** ポケモンコンテスト（作者の決定 2026年11月4日。07 の188章） */
function setup(n = 1, role: 'solo' | 'host' = 'solo') {
  const rules = buildSimRules('hoenn');
  const sim = new Simulation({ tickRate: 30, seed: 3, rules, ...(role === 'host' ? { role: 'host' as const } : {}) });
  const players = Array.from({ length: n }, (_, k) => {
    const lo = playableLoadout(rules, 'treecko');
    return sim.addPlayer({ id: k + 1, x: 0, y: 0, radius: 12, moveSpeed: 0, types: lo.types, moves: lo.moves, line: lo.line, species: lo.species });
  });
  return { rules, sim, world: sim.world, players, cfg: rules.contest! };
}

/** 制限時間まで進める（gauge があれば、出せるようになるたびに全員が技を出す） */
function perform(sim: Simulation, gauge?: number) {
  const world = sim.world;
  for (let k = 0; k < 30 * 120 && world.contest?.phase === 'appeal'; k++) {
    if (gauge !== undefined) for (const e of world.contest.entrants) if (e.playerId !== null) applyContest(world, { op: 'appeal', playerId: e.playerId, gauge });
    sim.step([]);
  }
}

describe('ポケモンコンテスト', () => {
  it('ホウエンだけにある。カントー・ジョウトには無い', () => {
    expect(buildSimRules('kanto').contest).toBeUndefined();
    expect(buildSimRules('johto').contest).toBeUndefined();
    expect(buildSimRules('hoenn').contest).toBeDefined();
  });

  it('リーグを選ぶと続けられ、もう分岐は出ない', () => {
    const { world } = setup();
    applyContest(world, { op: 'open', playerId: 0 });
    expect(world.contest?.phase).toBe('branch');
    applyContest(world, { op: 'answer', playerId: 1, go: false });
    expect(world.contest).toBeNull();
    expect(world.contestOffered).toBe(true);
  });

  it('ステータスの点はポロックと技の強化回数の累計で決まる', () => {
    const { world, players, cfg } = setup();
    const p = players[0]!;
    expect(primaryScore(world, p, 'cool')).toBe(0);
    p.pokeblocks = { cool: 2, cute: 3 };
    p.moveUps = 5;
    const s = cfg.score;
    expect(primaryScore(world, p, 'cool')).toBe(2 * s.pokeblockChosen + 3 * s.pokeblockOther + 5 * s.moveUp);
  });

  it('足りない分は NPC で4人。順位が高いほどコインが多く、終わるとランの結果は contest', () => {
    const { sim, world, players, rules } = setup();
    const p = players[0]!;
    p.pokeblocks = { cool: 100 };
    applyContest(world, { op: 'open', playerId: 0 });
    applyContest(world, { op: 'answer', playerId: 1, go: true });
    expect(world.contest?.phase).toBe('entry');
    applyContest(world, { op: 'entry', playerId: 1, category: 'cool', moves: [moveIndexOf(rules, 'leafage')], rank: 0 });
    expect(world.contest?.phase).toBe('appeal');
    perform(sim, 1);
    const r = world.contest!.results!;
    expect(r).toHaveLength(4);
    expect(r.filter((x) => x.playerId === null)).toHaveLength(3);
    expect(r[0]!.playerId).toBe(1);
    expect(r.map((x) => x.coins)).toEqual([...r.map((x) => x.coins)].sort((a, b) => b - a));
    expect(r[0]!.coins).toBeGreaterThan(r[3]!.coins);
    expect(p.bonusCoins).toBe(r[0]!.coins);
    applyContest(world, { op: 'finish', playerId: 1 });
    expect(world.outcome).toBe('contest');
  });

  it('協力プレイ: 全員がコンテストを選んだときだけ。だれかがリーグなら全員リーグへ。2人なら NPC は2人', () => {
    const a = setup(2);
    applyContest(a.world, { op: 'open', playerId: 0 });
    applyContest(a.world, { op: 'answer', playerId: 1, go: true });
    expect(a.world.contest?.phase).toBe('branch');
    applyContest(a.world, { op: 'answer', playerId: 2, go: false });
    expect(a.world.contest).toBeNull();
    const b = setup(2);
    applyContest(b.world, { op: 'open', playerId: 0 });
    applyContest(b.world, { op: 'answer', playerId: 1, go: true });
    applyContest(b.world, { op: 'answer', playerId: 2, go: true });
    applyContest(b.world, { op: 'entry', playerId: 1, category: 'cool', moves: [], rank: 3 });
    applyContest(b.world, { op: 'entry', playerId: 2, category: 'cute', moves: [], rank: 1 });
    expect(b.world.contest!.rank).toBe(1);
    perform(b.sim);
    expect(b.world.contest!.results!.filter((x) => x.playerId === null)).toHaveLength(2);
  });

  it('区間7の中ボスを倒して次へ進むと分岐が開き、開いている間はゲームが止まる', () => {
    const { sim, world, cfg } = setup();
    world.section = cfg.afterSection;
    world.gateIds.clear();
    world.nextBoss = world.bossSchedule.length;
    sim.step([]);
    expect(world.section).toBe(cfg.afterSection + 1);
    expect(world.contest?.phase).toBe('branch');
    const tick = world.tick;
    sim.step([]);
    expect(world.tick).toBe(tick);
  });
});

describe('コンテストの記録', () => {
  it('1位でコインが入り、その部門の次のランクへ進む。2回目の1位は同じランクなら進まない。クリアには数えない', () => {
    const store = new SaveStore(null, null);
    const { sim, world, players } = setup();
    players[0]!.pokeblocks = { cool: 100 };
    const rec = new RunRecorder(store, 'treecko', shopConfig, null, 'hoenn');
    applyContest(world, { op: 'open', playerId: 0 });
    applyContest(world, { op: 'answer', playerId: 1, go: true });
    applyContest(world, { op: 'entry', playerId: 1, category: 'cool', moves: [], rank: 0 });
    perform(sim);
    const coins = world.contest!.results![0]!.coins;
    applyContest(world, { op: 'finish', playerId: 1 });
    rec.finish(sim.world);
    const s = store.current.stats;
    expect(s['hoenn:contestRank.cool']).toBe(1);
    expect(s['hoenn:contestWins']).toBe(1);
    expect(s['hoenn:contestEntries']).toBe(1);
    expect(s['hoenn:clears']).toBeUndefined();
    expect(store.current.coins).toBeGreaterThanOrEqual(coins);
  });
});

describe('コンテストの審査（07 の230章）', () => {
  const enter = (world: ReturnType<typeof setup>['world'], moves: number[], rank = 0, category = 'cool') => {
    applyContest(world, { op: 'open', playerId: 0 });
    applyContest(world, { op: 'answer', playerId: 1, go: true });
    applyContest(world, { op: 'entry', playerId: 1, category, moves, rank });
  };
  const scoreOf = (world: ReturnType<typeof setup>['world']) => world.contest!.results!.find((r) => r.playerId === 1)!.score;

  it('マスターの1位は 2000 コイン', () => {
    const { sim, world, players, cfg } = setup();
    players[0]!.pokeblocks = { cool: 200 };
    enter(world, [], cfg.ranks.length - 1);
    perform(sim);
    expect(world.contest!.results![0]!.playerId).toBe(1);
    expect(world.contest!.results![0]!.coins).toBe(2000);
  });

  it('順番は無い: 始まってすぐ全員が同じ舞台に立ち、制限時間で終わる。結果はステータスとパフォーマンスの合計', () => {
    const { sim, world, cfg, players } = setup();
    players[0]!.pokeblocks = { cool: 3 };
    enter(world, []);
    const c = world.contest!;
    expect(c.phase).toBe('appeal');
    expect(c.entrants).toHaveLength(cfg.entrants);
    let steps = 0;
    while (world.contest!.phase === 'appeal' && steps < 30 * 120) {
      sim.step([]);
      steps++;
    }
    expect(steps * world.dt).toBeCloseTo(cfg.performanceSeconds, 0);
    for (const r of c.results!) expect(r.score).toBe(r.status + r.performance);
    expect(c.results!.find((r) => r.playerId === 1)!.status).toBe(3 * cfg.score.pokeblockChosen);
  });

  it('盛り上がった瞬間ほど点が高い。出すのをやめると技の点は入らない', () => {
    const run = (gauge?: number) => {
      const { sim, world, rules } = setup();
      const cool = rules.moves.findIndex((m) => m.contestType === 'cool');
      enter(world, [cool, cool]);
      perform(sim, gauge);
      return scoreOf(world);
    };
    expect(run(1)).toBeGreaterThan(run(0.6));
    expect(run(0.6)).toBeGreaterThan(run());
  });

  it('技を出したら、しばらく次を出せない', () => {
    const { sim, world, rules, cfg } = setup();
    enter(world, [rules.moves.findIndex((m) => m.contestType === 'cool')]);
    applyContest(world, { op: 'appeal', playerId: 1, gauge: 1 });
    applyContest(world, { op: 'appeal', playerId: 1, gauge: 1 });
    const me = world.contest!.entrants.find((e) => e.playerId === 1)!;
    expect(me.appeals).toHaveLength(1);
    for (let k = 0; k < Math.round(cfg.cooldownSeconds / world.dt); k++) sim.step([]);
    applyContest(world, { op: 'appeal', playerId: 1, gauge: 1 });
    expect(me.appeals).toHaveLength(2);
  });

  it('舞台にいない人は技を出せない', () => {
    const { world, rules } = setup();
    enter(world, [rules.moves.findIndex((m) => m.contestType === 'cool')]);
    applyContest(world, { op: 'appeal', playerId: 99, gauge: 1 });
    expect(world.contest!.entrants.every((e) => e.appeals.length === 0)).toBe(true);
  });

  it('観客の波: シードで決まり、0〜1 で、山の長さが毎回変わる', () => {
    const { cfg } = setup();
    const t = cfg.timing;
    for (let s = 0; s < 30; s += 0.1) {
      const a = crowdAir(t, 5, s);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
      expect(a).toBe(crowdAir(t, 5, s));
    }
    const peaks = crowdPeaks(t, 5, cfg.performanceSeconds);
    expect(peaks.length).toBeGreaterThanOrEqual(3);
    for (const p of peaks) expect(crowdAir(t, 5, p)).toBeCloseTo(1, 5);
    const gaps = peaks.slice(1).map((p, k) => p - peaks[k]!);
    expect(new Set(gaps.map((g) => g.toFixed(2))).size).toBeGreaterThan(1);
  });

  it('連打より、山を待って出す方が点が高い（どのシードでも）', () => {
    const { cfg } = setup();
    const t = cfg.timing;
    for (let seed = 1; seed <= 40; seed++) {
      // 連打: 出せるようになるたびに出す
      let spam = 0;
      for (let s = 0; s < cfg.performanceSeconds; s += cfg.cooldownSeconds) spam += appealMultiplier(t, crowdAir(t, seed, s));
      // 山を待つ: 頂点の少し手前で出す
      let wait = 0;
      for (const p of crowdPeaks(t, seed, cfg.performanceSeconds)) wait += appealMultiplier(t, crowdAir(t, seed, p - 0.3));
      expect(wait, 'seed ' + seed).toBeGreaterThan(spam);
    }
  });

  it('NPC はプレイヤーが押さなくても技を出し、決めた点に近くなる', () => {
    const { sim, world, cfg } = setup();
    enter(world, []);
    perform(sim);
    const npcs = world.contest!.results!.filter((r) => r.playerId === null);
    expect(npcs).toHaveLength(cfg.entrants - 1);
    for (const r of npcs) expect(r.performance).toBeGreaterThan(0);
    const base = cfg.ranks[0]!.npcScores;
    const lo = Math.min(...base) * (1 - cfg.npcJitter) - 10;
    const hi = Math.max(...base) * (1 + cfg.npcJitter) + 10;
    for (const r of npcs) {
      expect(r.score).toBeGreaterThanOrEqual(lo);
      expect(r.score).toBeLessThanOrEqual(hi);
    }
  });

  it('時間で最後まで進む（ソロでも止まらない）', () => {
    const { sim, world } = setup();
    enter(world, []);
    for (let k = 0; k < 30 * 60 && world.contest?.phase !== 'result'; k++) sim.step([]);
    expect(world.contest?.phase).toBe('result');
  });

  it('ホストの手順をゲストへ送ると同じ結果になる', () => {
    const host = setup(2, 'host');
    const guest = setup(2);
    const seen: Parameters<typeof applyContest>[1][] = [];
    const apply = (cmd: Parameters<typeof applyContest>[1]) => {
      applyContest(host.world, cmd);
      seen.push(cmd);
    };
    const cool = host.rules.moves.findIndex((m) => m.contestType === 'cool');
    apply({ op: 'open', playerId: 0 });
    apply({ op: 'answer', playerId: 1, go: true });
    apply({ op: 'answer', playerId: 2, go: true });
    apply({ op: 'entry', playerId: 1, category: 'cool', moves: [cool], rank: 0 });
    apply({ op: 'entry', playerId: 2, category: 'cute', moves: [cool], rank: 0 });
    for (let k = 0; k < 30 * 120 && host.world.contest!.phase !== 'result'; k++) {
      if (k % 150 === 0) apply({ op: 'appeal', playerId: 1 + (k % 2), gauge: 0.7 });
      host.sim.step([]);
      for (const ev of host.world.events) if (ev.type === 'contestApplied' && ev.command.op !== 'appeal' && ev.command.op !== 'open' && ev.command.op !== 'answer' && ev.command.op !== 'entry') seen.push(ev.command);
    }
    // ゲストは cooldown を見ない。受け取った順に当てはめる
    const g = guest.world as { role: string };
    g.role = 'guest';
    for (const cmd of seen) applyContest(guest.world, cmd);
    expect(guest.world.contest!.results).toEqual(host.world.contest!.results);
  });

  it('ポロックは落ちた時に色が決まり、絵はそれぞれ違う。拾うとその部門が増える', () => {
    const { world, players, rules } = setup();
    spawnItem(world, 700, 'buff', 0, 0);
    const it = world.items.find((x) => x.id === 700)!;
    const def = rules.pickups.items.buff!.buffs[it.variant!]!;
    expect(def.contest).toBeDefined();
    expect(world.events.some((e) => e.type === 'itemSpawned' && e.id === 700 && e.variant === it.variant)).toBe(true);
    confirmItem(world, 700, players[0]!.id);
    expect(players[0]!.pokeblocks).toEqual({ [def.contest!]: 1 });
    const art = rules.pickups.items.buff!.buffs.map((b) => b.sprite!);
    expect(new Set(art).size).toBe(art.length);
    for (const name of art) expect(itemSprites.sprites[name], name).toBeDefined();
    expect(new Set(art.map((name) => itemSprites.sprites[name]!.join())).size).toBe(art.length);
  });

  it('タイプの絵はどれも技のドット絵にある', () => {
    const { cfg } = setup();
    for (const id of Object.values(cfg.typeArt)) expect(moveSprites.sprites[id], id).toBeDefined();
  });

  it('NPC の技はどれもこの地方の技にある。曲がある', () => {
    const { rules, cfg } = setup();
    for (const list of Object.values(cfg.npcMoves)) for (const key of list) expect(rules.moves.some((m) => m.key === key), key).toBe(true);
    for (const npc of cfg.npcPokemon) expect(cfg.npcMoves[npc], npc).toBeDefined();
  });
});
