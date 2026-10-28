import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { generated, moveBalanceConfig, derivationsConfig } from '../data';
import { buildSimRules } from '../data/simRules';
import { Simulation } from './simulation';
import { recomputeModifiers } from './systems/leveling';
import type { SimEnemyKind } from './rules';

/**
 * 技ごとの DPS（1 秒あたりのダメージ）を、敵の数を変えて 60 秒ずつ測る（作者の依頼 2026年10月29日。docs/14_move_dps.md を作る）。
 *   npm run balance -- src/sim/moveDps.balance.ts
 *
 * 条件をそろえるため:
 * - 技は最大レベル、持ち物なし。プレイヤーはタイプなしの ミュウ Lv50（タイプ一致なし・物理と特殊が同じ強さ）。止まったまま右を向く
 * - 敵はタイプなし（相性なし）・HP がとても多い（倒れないので数が変わらない）・接触ダメージなし
 * - ボス 1 体: 中ボスの大きさ（半径 28）。右から近づいてくる。雑魚 10・50・200 体: 半径 12、まわりから近づいて群がる（速さはどちらも 60）
 * - 雑魚・ボスは自動で出さない。一撃（じわれ・ほろびのうた）は倒れない敵に意味がないので「一撃」と書く
 */
const SECONDS = 60;
const SCENES = [
  { key: 'boss', label: 'ボス1体', count: 1, boss: true },
  { key: 'n10', label: '雑魚10', count: 10, boss: false },
  { key: 'n50', label: '雑魚50', count: 50, boss: false },
  { key: 'n200', label: '雑魚200', count: 200, boss: false },
] as const;
const HP = 1e12;

type Row = { key: string; name: string; type: string; tier: string; pattern: string; dps: Record<string, number>; note: string };

function measure(moveKey: string, scene: (typeof SCENES)[number]): { dps: number; instakill: boolean } {
  const rules = buildSimRules();
  const base = rules.enemies.kinds.find((k) => (k.rank ?? 'normal') === 'normal')!;
  const dummy: SimEnemyKind = { ...base, id: 'dps-dummy', hp: HP, moveSpeed: 60, radius: 12, contactDamage: 0, types: [], rank: 'normal' };
  const boss: SimEnemyKind = { ...base, id: 'dps-boss', hp: HP, moveSpeed: 60, radius: 28, contactDamage: 0, types: [], rank: 'midboss' };
  rules.enemies.kinds.push(dummy, boss);
  const dummyKind = rules.enemies.kinds.length - 2;
  const bossKind = rules.enemies.kinds.length - 1;
  const sim = new Simulation({ tickRate: 30, seed: 7, rules });
  const w = sim.world;
  // 自動で出るものを止める
  for (const wave of w.waves) Object.assign(wave, { spawnPerSecond: 0, minimum: 0 });
  (w as { nextBoss: number }).nextBoss = w.bossSchedule.length;
  (w.swarmSchedule as unknown[]).length = 0;
  w.boxTimer = 1e9;
  const move = rules.moves.findIndex((m) => m.key === moveKey);
  const species = rules.species.findIndex((s) => s.key === 'mew');
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, types: [], species, moves: [{ move, level: rules.moves[move]!.levels.length }] });
  w.level = 50;
  recomputeModifiers(w, p);
  p.hp = p.maxHp = 1e9;
  p.facingX = 1;
  p.facingY = 0;
  // 敵を置く（ボスは右に、雑魚はまわりの輪の中にばらばらに）
  let seed = 1;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < scene.count; k++) {
    const a = scene.boss ? 0 : rnd() * Math.PI * 2;
    const d = scene.boss ? 120 : 60 + rnd() * 340;
    const kind = scene.boss ? bossKind : dummyKind;
    w.enemies.add(w.nextEnemyId++, kind, Math.cos(a) * d, Math.sin(a) * d, HP, 60, scene.boss ? 28 : 12, 0);
  }
  let instakill = false;
  for (let t = 0; t < SECONDS * 30; t++) {
    p.hp = p.maxHp;
    p.facingX = 1;
    p.facingY = 0;
    sim.step([]);
    for (const ev of w.events) if (ev.type === 'enemyKilled') instakill = true;
  }
  let lost = 0;
  for (let i = 0; i < w.enemies.count; i++) lost += HP - w.enemies.hp[i]!;
  return { dps: lost / SECONDS, instakill };
}

it('技の DPS（60 秒）', () => {
  const rules = buildSimRules();
  const tierOf = (key: string): string =>
    moveBalanceConfig.tierOverrides?.[key] ?? (derivationsConfig.unique.some((d) => d.to === key) ? 'unique' : derivationsConfig.derivations.some((d) => d.to === key) ? 'derived' : 'base');
  const rows: Row[] = [];
  // 試しに一部だけ: DPS_ONLY=ember,flamethrower
  const only = process.env.DPS_ONLY?.split(',');
  for (const m of rules.moves) {
    if (['passive', 'heal', 'rest'].includes(m.pattern) || (only && !only.includes(m.key))) continue;
    const dps: Record<string, number> = {};
    let note = '';
    for (const sc of SCENES) {
      const r = measure(m.key, sc);
      dps[sc.key] = r.dps;
      if (r.instakill) note = '一撃';
    }
    const name = generated.moves[m.key]?.names.ja ?? m.key;
    const type = generated.types[rules.types.names[m.type] ?? '']?.names.ja ?? '';
    rows.push({ key: m.key, name, type, tier: tierOf(m.key), pattern: m.pattern, dps, note });
  }
  writeFileSync(process.env.DPS_OUT ?? 'docs/14_move_dps.json', JSON.stringify({ seconds: SECONDS, scenes: SCENES, rows }, null, 2) + '\n');
  console.log(`技 ${rows.length} 個を測りました`);
}, 3_600_000);
