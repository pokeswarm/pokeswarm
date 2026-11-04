import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { applyContest, contestScore } from './contest';
import { Simulation } from './simulation';
import { RunRecorder } from '../meta/runRecorder';
import { SaveStore } from '../meta/saveStore';
import { shopConfig } from '../data';

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

  it('点数はポロック・技の強化回数の累計・選んだ技の部門で決まる', () => {
    const { world, players, cfg, rules } = setup();
    const p = players[0]!;
    const entry = { category: 'cool', moves: [] as number[] };
    expect(contestScore(world, p, entry)).toBe(0);
    p.pokeblocks = { cool: 2, cute: 3 };
    p.moveUps = 5;
    const s = cfg.score;
    expect(contestScore(world, p, entry)).toBe(2 * s.pokeblockChosen + 3 * s.pokeblockOther + 5 * s.moveUp);
    const cool = rules.moves.findIndex((m) => m.contestType === 'cool');
    const cute = rules.moves.findIndex((m) => m.contestType === 'cute');
    expect(contestScore(world, {}, { category: 'cool', moves: [cool, cute] })).toBe(s.moveMatch + s.moveOther);
  });

  it('足りない分は NPC で4人。順位が高いほどコインが多く、終わるとランの結果は contest', () => {
    const { world, players, rules } = setup();
    const p = players[0]!;
    p.pokeblocks = { cool: 100 };
    applyContest(world, { op: 'open', playerId: 0 });
    applyContest(world, { op: 'answer', playerId: 1, go: true });
    expect(world.contest?.phase).toBe('entry');
    applyContest(world, { op: 'entry', playerId: 1, category: 'cool', moves: [moveIndexOf(rules, 'leafage')], rank: 0 });
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
