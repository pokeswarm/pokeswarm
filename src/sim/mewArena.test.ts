import { describe, expect, it } from 'vitest';
import { buildSimRules } from '../data/simRules';
import { Simulation } from './simulation';
import { startLegendary } from './systems/stage';

/** ミュウの固定マップの戦い（07 の257章）: ゆびをふる で、作り直した 7 体の技をまねる。HP 66% で へんしん、33% で 大当たり */
function setup(seed = 3) {
  const rules = buildSimRules();
  const sim = new Simulation({ tickRate: 30, seed, rules });
  sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 180 });
  const p = sim.world.players[0]!;
  sim.world.cleared = true;
  startLegendary(sim.world, rules.enemies.kinds.findIndex((k) => k.id === 'legend-mew'));
  const w = sim.world;
  /** 使い始めた技（予告を出した順。続きの技も入る） */
  const cast: string[] = [];
  const step = (seconds: number): void => {
    for (let t = 0; t < Math.round(seconds * 30); t++) {
      p.hp = p.maxHp = 1e6;
      p.invincibleTicks = 0;
      sim.step([]);
      for (const ev of w.events) if (ev.type === 'hazardTelegraphed' && ev.delay === 0) cast.push(rules.stage.moves[ev.move]!.id);
    }
  };
  step(3.5);
  const boss = w.bosses[0]!;
  const i = (): number => {
    for (let k = 0; k < w.enemies.count; k++) if (w.enemies.id[k] === boss.id) return k;
    return -1;
  };
  const of = (id: string) => w.hazards.filter((h) => rules.stage.moves[h.move]?.id === id);
  const setHp = (pct: number): void => {
    w.enemies.hp[i()] = (w.enemies.maxHp[i()]! * pct) / 100;
  };
  return { rules, sim, w, p, boss, i, of, step, cast, setHp };
}

const set = () => buildSimRules().stage.legendary!.moveSets['legend-mew']!;
const move = (id: string) => buildSimRules().stage.moves.find((m) => m.id === id)!;

describe('ミュウ（07 の257章）', () => {
  it('固定マップで戦い、テレポートと ゆびをふる をくり返す。ゆびをふる は作り直した 7 体の技を、同じ技を続けずに出す', () => {
    const { w, step, cast } = setup();
    expect(w.arena).not.toBeNull();
    step(60);
    const pool = move('mew-metronome').pick!;
    const picks: string[] = [];
    for (let k = 0; k < cast.length; k++) if (cast[k - 1] === 'mew-metronome' && pool.includes(cast[k]!)) picks.push(cast[k]!);
    expect(cast.filter((m) => m === 'mew-teleport').length).toBeGreaterThanOrEqual(5);
    expect(picks.length).toBeGreaterThanOrEqual(5);
    expect(new Set(picks).size).toBeGreaterThanOrEqual(4);
    for (let k = 1; k < picks.length; k++) expect(picks[k]).not.toBe(picks[k - 1]);
    // 昔の技（自分のまわりの だいばくはつ など）は使わない
    expect(cast.some((m) => m.startsWith('mew-') && !['mew-teleport', 'mew-metronome'].includes(m))).toBe(false);
  });

  it('ゆびをふる の技は、7 体の作り直した技だけ（マップの場所に頼る技は入れない）', () => {
    const pool = move('mew-metronome').pick!;
    const owners = ['mewtwo-', 'articuno-', 'zapdos-', 'moltres-', 'charizard-s-', 'venusaur-s-', 'blastoise-s-'];
    for (const owner of owners) expect(pool.some((m) => m.startsWith(owner)), owner).toBe(true);
    for (const id of pool) {
      const m = move(id);
      expect(m.arenaPaths ?? m.arenaLinks, id).toBeUndefined();
    }
    expect(set().showMoveNames).toBe(true);
    expect(move('mew-metronome').move).toBe('metronome');
    expect(move('mew-transform').move).toBe('transform');
  });

  it('HP 66% で へんしん: 7 体のどれかの姿になり、その伝説の技を 3 つ使って元に戻る', () => {
    const { rules, w, step, cast, setHp, of } = setup();
    setHp(60);
    const from = cast.length;
    let into: string | undefined;
    let lookSeen = false;
    for (let t = 0; t < 30 * 40; t++) {
      step(1 / 30);
      const active = w.hazards.find((h) => h.activeTicks !== undefined && rules.stage.moves[h.move]?.look);
      if (active) {
        lookSeen = true;
        into ??= rules.stage.moves[active.move]!.id;
      }
      if (cast.slice(from).includes('mew-transform-back')) break;
    }
    expect(lookSeen).toBe(true);
    expect(into).toBeDefined();
    const after = cast.slice(from);
    expect(after).toContain('mew-transform');
    const queue = move(into!).thenQueue!;
    // その姿の 3 つの技を順に（間に別の技を挟まない。アクアジェットなど代わりの技はよい）
    const start = after.indexOf(into!);
    // 何度も落ちる技（ブラストバーン）は 1 回と数える
    // 離れていて代わりの技（アクアジェット）になったときは、その技を使ったものとする
    const named = after.slice(start + 1).map((m, k, a) => (m === 'blastoise-s-aqua-jet' && queue.includes('blastoise-s-hydro-cannon') && !a.slice(0, k).includes('blastoise-s-hydro-cannon') ? 'blastoise-s-hydro-cannon' : m));
    const used = named.filter((m) => queue.includes(m)).filter((m, k, a) => a[k - 1] !== m);
    expect(used.slice(0, queue.length)).toEqual(queue);
    // 元に戻ると、姿を変える範囲は消える
    step(0.2);
    expect(of(into!).length).toBe(0);
  });

  it('HP 33% で 大当たり: 真ん中へテレポートし、御三家の究極の技のどれかを出して、4 秒疲れる（直前の突進が終わってから真ん中へ）', () => {
    const { rules, w, i, step, cast, setHp } = setup();
    // 66% の へんしん は済んだことにする。ゆびをふる で ドリルくちばし（突進）が出た直後に HP を切ったことにする
    w.bosses[0]!.hpMoves = w.bosses[0]!.hpMoves!.slice(1);
    w.bosses[0]!.forced = [rules.stage.moves.findIndex((m) => m.id === 'zapdos-drill-peck')];
    setHp(30);
    const from = cast.length;
    let bigAt: number | null = null;
    for (let t = 0; t < 30 * 20; t++) {
      step(1 / 30);
      const after = cast.slice(from);
      if (bigAt === null && after.includes('mew-metronome-big')) bigAt = Math.hypot(w.enemies.x[i()]! - w.arena!.x, w.enemies.y[i()]! - w.arena!.y);
      if (after.includes('mew-tired')) break;
    }
    const after = cast.slice(from);
    expect(after.filter((m) => m.startsWith('mew-')).slice(0, 2)).toEqual(['mew-to-center', 'mew-metronome-big']);
    expect(bigAt).toBeLessThan(20);
    const ultimates = ['charizard-s-ultimate', 'venusaur-s-frenzy-plant', 'blastoise-s-ultimate-cw', 'blastoise-s-ultimate-ccw'];
    expect(after.some((m) => ultimates.includes(m))).toBe(true);
    expect(after).toContain('mew-tired');
    expect(move('mew-tired').telegraphSeconds).toBe(4);
    // どの究極の技も出る（大当たりは 3 つから。カメックスは向きをさらに選ぶ）
    expect(move('mew-metronome-big').pick).toEqual(['charizard-s-ultimate', 'venusaur-s-frenzy-plant', 'mew-ultimate-hydro']);
    void rules;
  });

  it('テレポートは当たらない（狙った人から離れた所に現れるだけ）・きずぐすりは落とさない', () => {
    expect(move('mew-teleport').damage).toBe(0);
    expect(move('mew-teleport').blink!.minDistance).toBeGreaterThan(200);
    expect(set().hpDrops).toBeUndefined();
  });
});
