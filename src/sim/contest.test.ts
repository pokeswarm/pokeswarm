import { describe, expect, it } from 'vitest';
import { buildSimRules, moveIndexOf, playableLoadout } from '../data/simRules';
import { applyContest, contestScore } from './contest';
import { Simulation } from './simulation';
import { RunRecorder } from '../meta/runRecorder';
import { SaveStore } from '../meta/saveStore';
import { moveSprites, shopConfig } from '../data';

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

/** 審査を時間切れまで進める（gauge があれば自分の番にアピールする） */
function perform(world: ReturnType<typeof setup>['world'], gauge?: number) {
  for (let k = 0; k < 200 && (world.contest?.phase === 'primary' || world.contest?.phase === 'appeal'); k++) {
    const c = world.contest!;
    const e = c.phase === 'appeal' ? c.entrants[c.turn] : undefined;
    if (gauge !== undefined && e?.playerId != null && !c.shown) applyContest(world, { op: 'appeal', playerId: e.playerId, gauge });
    else applyContest(world, { op: 'advance', playerId: 0 });
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
    expect(world.contest?.phase).toBe('primary');
    perform(world, 1);
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
    perform(b.world);
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
    perform(world);
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

describe('コンテストの審査（07 の192章）', () => {
  const enter = (world: ReturnType<typeof setup>['world'], moves: number[], rank = 0, category = 'cool') => {
    applyContest(world, { op: 'open', playerId: 0 });
    applyContest(world, { op: 'answer', playerId: 1, go: true });
    applyContest(world, { op: 'entry', playerId: 1, category, moves, rank });
  };
  const scoreOf = (world: ReturnType<typeof setup>['world']) => world.contest!.results!.find((r) => r.playerId === 1)!.score;

  it('マスターの1位は 2000 コイン', () => {
    const { world, players, cfg } = setup();
    players[0]!.pokeblocks = { cool: 200 };
    enter(world, [], cfg.ranks.length - 1);
    perform(world);
    expect(world.contest!.results![0]!.playerId).toBe(1);
    expect(world.contest!.results![0]!.coins).toBe(2000);
  });

  it('真ん中で止めるほど点が高い。押さないと基本の点だけ', () => {
    const run = (gauge?: number) => {
      const { world, rules } = setup();
      const cool = rules.moves.findIndex((m) => m.contestType === 'cool');
      enter(world, [cool, cool]);
      perform(world, gauge);
      return scoreOf(world);
    };
    expect(run(1)).toBeGreaterThan(run(0.6));
    expect(run(0.6)).toBeGreaterThan(run());
  });

  it('自分の番でない人のアピールは効かない。NPC の番はすぐ結果になる', () => {
    const { world, rules } = setup();
    enter(world, [rules.moves.findIndex((m) => m.contestType === 'cool')]);
    applyContest(world, { op: 'advance', playerId: 0 });
    const c = world.contest!;
    expect(c.phase).toBe('appeal');
    const first = c.entrants[0]!;
    // 自分はポロックなしで一番低い → 最初の番
    if (first.playerId === null) expect(c.shown).toBe(true);
    applyContest(world, { op: 'appeal', playerId: 99, gauge: 1 });
    expect(c.entrants.every((e) => e.playerId !== 99)).toBe(true);
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
    for (let k = 0; k < 100 && host.world.contest!.phase !== 'result'; k++) {
      const c = host.world.contest!;
      const e = c.phase === 'appeal' ? c.entrants[c.turn] : undefined;
      if (e?.playerId != null && !c.shown) apply({ op: 'appeal', playerId: e.playerId, gauge: 0.7 });
      else apply({ op: 'advance', playerId: 0 });
    }
    for (const cmd of seen) applyContest(guest.world, cmd);
    expect(guest.world.contest!.results).toEqual(host.world.contest!.results);
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
