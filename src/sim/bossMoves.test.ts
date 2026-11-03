import { describe, expect, it } from 'vitest';
import { buildSimRules } from '../data/simRules';
import { Simulation } from './simulation';
import { findEnemyIndex, moveIndexOfStage } from './world';
import { addHazard, hazardHits } from './systems/stage';

/**
 * ボスの技と動きの作り直し（作者の決定 2026年11月3日。07 の167章）: 本番のデータでボスを出し、新しい部品の動きを確かめる
 */
function boss(region: 'kanto' | 'johto' | 'hoenn', id: string, opts: { invincible?: boolean } = {}) {
  const rules = buildSimRules(region);
  const sim = new Simulation({ tickRate: 30, seed: 5, rules });
  sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0 });
  const w = sim.world;
  if (opts.invincible !== false) w.players[0]!.invincibleTicks = 1e9;
  // ?boss= と同じ: そのボスの区間から始めて、すぐ出す
  const at = w.bossSchedule.findIndex((b) => rules.enemies.kinds[b.kind]?.id === id);
  const entry = w.bossSchedule[at]!;
  w.section = entry.wave;
  w.nextBoss = w.bossSchedule.findIndex((b) => b.wave === entry.wave && b.afterTicks === entry.afterTicks);
  w.sectionStartTick = w.tick - entry.afterTicks;
  sim.step([]);
  const kind = rules.enemies.kinds.findIndex((k) => k.id === id);
  const bossId = w.bosses.find((b) => w.enemies.kind[findEnemyIndex(w, b.id)] === kind)!.id;
  return { sim, w, bossId, p: w.players[0]! };
}

/** 範囲技 id を、ボスの場所から置く（予告から） */
function cast(w: Simulation['world'], bossId: number, id: string, x: number, y: number, dirX: number, dirY: number): void {
  addHazard(w, moveIndexOfStage(w.rules, id), x, y, dirX, dirY, bossId, undefined, { group: w.nextHazardGroup++ });
}

const steps = (sim: Simulation, n: number): void => {
  for (let k = 0; k < n; k++) sim.step([]);
};

describe('ボスの技の作り直し（07 の167章）', () => {
  it('対象のボスは、白い突進・サイコキネシスの円・共通のシャドーボール・ミュウツーの技を使わず、突進は1つまで', () => {
    const old = new Set(['legend-dash', 'legend-nova', 'shadow-ball', 'mewtwo-teleport', 'mewtwo-psywave', 'zapdos-dash', 'moltres-flamedash', 'charizard-blast-burn', 'draco-meteor', 'legend-beam', 'earthquake', 'zapdos-thunder', 'articuno-blizzard']);
    const legends = ['red-pikachu', 'red-espeon', 'red-snorlax', 'legend-raikou', 'legend-entei', 'legend-suicune', 'legend-lugia', 'legend-ho-oh'];
    for (const region of ['kanto', 'johto', 'hoenn'] as const) {
      const rules = buildSimRules(region);
      const lists = [
        ...rules.stage.bosses.filter((b) => b.required).map((b) => ({ id: b.kind, moves: [...b.moves, ...(b.phases ?? []).flatMap((p) => p.moves)] })),
        ...legends.filter((id) => rules.stage.legendary?.moveSets[id]).map((id) => ({ id, moves: rules.stage.legendary!.moveSets[id]!.moves })),
      ];
      for (const { id, moves } of lists) {
        for (const m of moves) expect(old.has(m), `${region} ${id} の ${m}`).toBe(false);
        const dashes = new Set(moves.filter((m) => rules.stage.moves.find((x) => x.id === m)?.dashSpeed));
        expect(dashes.size, `${region} ${id} の突進`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('なぎ払い: 落ちた後、レーザーの向きが扇の端から端へ回る（カントーのカイリューの はかいこうせん）', () => {
    const { sim, w, bossId } = boss('kanto', 'boss-dragonite');
    w.hazards.length = 0;
    cast(w, bossId, 'dragonite-hyper-beam', 0, 0, 1, 0);
    const hz = w.hazards.at(-1)!;
    steps(sim, Math.round(1.3 * 30) + 1);
    const a0 = Math.atan2(hz.dirY, hz.dirX);
    steps(sim, 30);
    const a1 = Math.atan2(hz.dirY, hz.dirX);
    // 60° を 1.3 秒で: 始めは −30° 近く、1 秒後は +15° ほど
    expect(a0).toBeLessThan((-20 * Math.PI) / 180);
    expect(a1).toBeGreaterThan(a0 + (35 * Math.PI) / 180);
  });

  it('ねむけ・やけど・冷え・押し飛ばし: 当たった本人のブラウザでかかり、押し飛ばしは瞬間移動せずにすべる', () => {
    const { sim, w, bossId, p } = boss('johto', 'johto-boss-machamp', { invincible: false });
    w.hazards.length = 0;
    w.bosses.length = 0;
    const i = findEnemyIndex(w, bossId);
    // 触れて無敵時間にならない所（つかむ範囲 120 の中）
    w.enemies.x[i] = 100;
    w.enemies.y[i] = 0;
    w.enemies.speed[i] = 0;
    // あてみなげ: ボスから外へすべる
    cast(w, bossId, 'machamp-vital-throw', 100, 0, 1, 0);
    steps(sim, 31);
    expect(p.pushTicks).toBeGreaterThan(0);
    const x0 = p.x;
    sim.step([]);
    expect(p.x).toBeLessThan(x0);
    expect(x0 - p.x).toBeLessThan(40);
    // ねむけ（さいみんじゅつ）・やけど（おにび）・冷え（3回で凍る）
    const move = (id: string) => w.rules.stage.moves.find((m) => m.id === id)!;
    expect(move('gengar-hypnosis').onHit?.drowsySeconds).toBeGreaterThan(0);
    expect(move('houndoom-will-o-wisp').onHit?.burnSeconds).toBeGreaterThan(0);
    expect(move('glalie-frost-breath').onHit?.chill).toBe(1);
  });

  it('カウンター: 構えの間にダメージを受けなければ返さない', () => {
    const { sim, w, bossId } = boss('johto', 'johto-boss-machamp');
    w.hazards.length = 0;
    w.bosses.length = 0;
    const i = findEnemyIndex(w, bossId);
    // プレイヤーの技でボスが削られないよう、HP を毎回戻す
    const hp = w.enemies.hp[i]!;
    cast(w, bossId, 'machamp-counter', w.enemies.x[i]!, w.enemies.y[i]!, 1, 0);
    let returned = false;
    for (let k = 0; k < 70; k++) {
      w.enemies.hp[findEnemyIndex(w, bossId)] = hp;
      sim.step([]);
      if (w.events.some((e) => e.type === 'hazardTelegraphed' && w.rules.stage.moves[e.move]!.id === 'machamp-counter-burst')) returned = true;
    }
    expect(returned).toBe(false);
  });

  it('カウンターの返す威力は、受けたダメージの割合（上限あり）', () => {
    const { sim, w, bossId } = boss('johto', 'johto-boss-machamp');
    w.hazards.length = 0;
    w.bosses.length = 0;
    const i = findEnemyIndex(w, bossId);
    cast(w, bossId, 'machamp-counter', w.enemies.x[i]!, w.enemies.y[i]!, 1, 0);
    steps(sim, 5);
    w.enemies.hp[i] = w.enemies.hp[i]! - 100;
    let damage = 0;
    for (let k = 0; k < 70 && !damage; k++) {
      sim.step([]);
      for (const e of w.events) if (e.type === 'hazardTelegraphed' && w.rules.stage.moves[e.move]!.id === 'machamp-counter-burst') damage = e.damage;
    }
    expect(damage).toBeCloseTo(60, 0);
  });

  it('潜る技（ナイトヘッド）: 予告の間はボスが消えて狙われず、影はプレイヤーより遅く追い、落ちた所にボスが現れる', () => {
    const { sim, w, bossId, p } = boss('kanto', 'boss-gengar');
    w.hazards.length = 0;
    w.bosses.length = 0;
    const i = findEnemyIndex(w, bossId);
    w.enemies.x[i] = 300;
    w.enemies.y[i] = 0;
    addHazard(w, moveIndexOfStage(w.rules, 'gengar-night-shade'), 300, 0, 0, 0, bossId, undefined, { follow: p.id, group: w.nextHazardGroup++ });
    steps(sim, 2);
    expect(w.hiddenEnemies.has(bossId)).toBe(true);
    // 狙われない（近傍検索に入らない）
    const n = w.enemyHash.queryRect(w.enemies.x[i]! - 10, w.enemies.y[i]! - 10, w.enemies.x[i]! + 10, w.enemies.y[i]! + 10, w.scratch);
    expect([...w.scratch.subarray(0, n)].includes(i)).toBe(false);
    const hz = w.hazards[0]!;
    steps(sim, 30);
    // 影は毎秒 125 で追う（1 秒で 300 → 175 ほど）
    expect(Math.hypot(hz.x - p.x, hz.y - p.y)).toBeGreaterThan(120);
    for (let k = 0; k < 90 && w.hiddenEnemies.has(bossId); k++) sim.step([]);
    expect(w.hiddenEnemies.has(bossId)).toBe(false);
    const j = findEnemyIndex(w, bossId);
    // 現れた後の1回の更新ぶん（追う速さ）だけ動いていてよい
    expect(Math.hypot(w.enemies.x[j]! - hz.x, w.enemies.y[j]! - hz.y)).toBeLessThan(5);
  });

  it('段階（ジョウトのワタルのカイリュー）: HP が段階の割合を切ると技が変わる', () => {
    const { sim, w, bossId } = boss('johto', 'johto-boss-dragonite');
    const seen = (): Set<string> => {
      const s = new Set<string>();
      for (let k = 0; k < 30 * 6; k++) {
        sim.step([]);
        for (const e of w.events) if (e.type === 'hazardTelegraphed') s.add(w.rules.stage.moves[e.move]!.id);
      }
      return s;
    };
    expect(seen().has('dragonite-fire-blast')).toBe(true);
    const i = findEnemyIndex(w, bossId);
    w.enemies.hp[i] = w.enemies.maxHp[i]! * 0.5;
    w.hazards.length = 0;
    const s2 = seen();
    expect(s2.has('dragonite-thunder')).toBe(true);
    w.enemies.hp[i] = w.enemies.maxHp[i]! * 0.2;
    w.hazards.length = 0;
    const s3 = seen();
    expect(s3.has('dragonite-blizzard') || s3.has('dragonite-outrage')).toBe(true);
    expect(s3.has('dragonite-fire-blast')).toBe(false);
  });

  it('動き方: 間合いを保つボスは、近すぎると離れる（カントーのラプラス）', () => {
    const { sim, w, bossId } = boss('kanto', 'boss-lapras');
    w.bosses.length = 0;
    w.hazards.length = 0;
    const i = findEnemyIndex(w, bossId);
    w.enemies.x[i] = 100;
    w.enemies.y[i] = 0;
    steps(sim, 30);
    const j = findEnemyIndex(w, bossId);
    expect(Math.hypot(w.enemies.x[j]!, w.enemies.y[j]!)).toBeGreaterThan(120);
  });

  it('押し寄せる波（なみのり）: 切れ目で2本に分かれた帯が、狙った人の方へ進む', () => {
    const { sim, w, bossId } = boss('kanto', 'boss-lapras');
    w.bosses.length = 0;
    w.hazards.length = 0;
    const i = findEnemyIndex(w, bossId);
    w.enemies.x[i] = -300;
    w.enemies.y[i] = 0;
    w.bosses.push({ id: bossId, cooldown: 1, interval: 1000, moves: [moveIndexOfStage(w.rules, 'lapras-surf')], next: 0 });
    sim.step([]);
    const waves = w.hazards.filter((h) => w.rules.stage.moves[h.move]!.id === 'lapras-surf');
    expect(waves.length).toBe(2);
    // 帯は進む向き（+x）に垂直
    for (const h of waves) expect(Math.abs(h.dirX)).toBeLessThan(0.01);
    const x0 = waves[0]!.x;
    steps(sim, Math.round(1.1 * 30) + 30);
    expect(waves[0]!.x).toBeGreaterThan(x0 + 200);
  });

  it('扇の当たり判定（さいみんじゅつ）: 開きの中だけ当たる', () => {
    const hz = { shape: 'cone' as const, x: 0, y: 0, radius: 300, dirX: 1, dirY: 0, length: 0 };
    const move = { arc: 70 } as Parameters<typeof hazardHits>[4];
    expect(hazardHits(hz, 200, 0, 12, move)).toBe(true);
    expect(hazardHits(hz, 200, 100, 12, move)).toBe(true);
    expect(hazardHits(hz, 0, 200, 12, move)).toBe(false);
    expect(hazardHits(hz, -100, 0, 12, move)).toBe(false);
  });
});
