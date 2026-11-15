import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { achievementsConfig, derivationsConfig, generated, playablesConfig, playerConfig, shopConfig } from '../data';
import { buildSimRules, permanentModifiers, playableLoadout } from '../data/simRules';
import { achievementPerks } from '../meta/achievementPerks';
import type { Axis, InputCommand } from './commands';
import { Simulation } from './simulation';
import { typeMultiplier } from './moves';
import { itemFits, recomputeModifiers } from './systems/leveling';
import { legendRoundKinds, startLegendary } from './systems/stage';
import type { SimEnemyKind } from './rules';

/**
 * ポケモンごとの、ビルドを揃えた状態の総 DPS を出すためのビルド案を作る（作者の依頼 2026年11月6日）。
 *   npx vitest run --mode balance src/sim/buildDps.balance.ts
 *
 * - 4 枠の技（技は忘れられないので、最初の技はかならず 1 枠を使う）と、6 枠の持ち物（派生の材料は残る。進化の道具は使うと空く）を、
 *   その系統が実際に作れる組み合わせだけで探す（docs/16_learnsets.json と data/game/derivations.json）
 * - ショップは強化ごとに最大レベルの半分。技は最大レベル、持ち物は最大レベル。ランのレベルは BUILD_LEVEL（ふつう 100）
 * - 測り方は moveDps.balance.ts と同じ（60 秒、止まったまま、相性なし）。ボス 1 体は、寄ってくる・距離 50・距離 150 のうち一番伸びる立ち位置で見る
 * - 群れは、その地方の最後の区間の雑魚（Lv100 の実際の HP）400 体。倒れた分はすぐ足す。倒れない的だと、当たるたびに広がる技（みらいよち・ワイルドボルト）や一撃技の値が
 *   実際より何桁も大きく出るので、HP で頭打ちになる値を DPS にする（作者の依頼 2026年11月6日。07 の231章）
 * - まず技ごとの表と持ち物の割合で全組み合わせを見積もり、上位を実際のシミュレーションで測り直して持ち物を詰める
 */
type SimRules = ReturnType<typeof buildSimRules>;
const SECONDS = 60;
const HP = 1e12;
const SEEDS = [7, 11, 23];
const LEVEL = Number(process.env.BUILD_LEVEL ?? 100);
const OUT = process.env.BUILD_OUT ?? 'docs/24_build_dps.json';
const LEARNSETS = process.env.LEARNSET_IN ?? 'docs/16_learnsets.json';
const ONLY = process.env.BUILD_ONLY?.split(',');
/** 並列に回すとき: BUILD_SHARD=0/8 */
const SHARD = process.env.BUILD_SHARD?.split('/').map(Number);
const TOP = Number(process.env.BUILD_TOP ?? 10);
/** この技のどれかを必ず入れた案だけを探す: BUILD_MUST=crunch */
const MUST = process.env.BUILD_MUST?.split(',');

type SceneKey = 'boss' | 'at50' | 'at150' | 'swarm';
const SCENES: Record<SceneKey, { count: number; boss: boolean; still?: number; lateHp?: boolean }> = {
  boss: { count: 1, boss: true },
  at50: { count: 1, boss: true, still: 50 },
  at150: { count: 1, boss: true, still: 150 },
  swarm: { count: 400, boss: false, lateHp: true },
};
const BOSS_SCENES: SceneKey[] = ['boss', 'at50', 'at150'];
/** 技の数や持続など、掛け算で見積もれない持ち物。表は技ごとに実際に測る */
const SHAPE_ITEMS: Record<string, number> = { metronome: 5, 'pp-max': 2, 'razor-claw': 2, 'wide-lens': 5, 'light-clay': 5, 'zoom-lens': 5, 'quick-claw': 5 };
const AMOUNT_ITEMS = ['metronome', 'pp-max', 'razor-claw'];
const FILL_ITEMS =['x-attack', 'x-sp-atk', 'dire-hit', ...Object.keys(SHAPE_ITEMS)];

type Row = {
  region: string;
  key: string;
  name: string;
  forms: { key: string; name: string; types: string[] }[];
  fixedMoves: boolean;
  learnsAll: boolean;
  start: string[];
  learn: { move: string; forms: string[]; withMoves?: string[]; minLevel?: number }[];
  special: { move: string; how: 'form' | 'item'; form?: string; item?: string }[];
  derives: { from: string; to: string; item: string | null; minLevel: number | null; needs: { move: string }[]; lineOnly: boolean; unique: boolean }[];
};
type RawDerivation = { from: string; to: string; item?: string; line?: string; forms?: string[]; consumes?: string[]; levelCap?: { base: number; perConsumed: number } };
type Option = { root: string; end: string; chain: string[]; items: string[]; consumes: string[]; needs: string[]; maxLevel?: number; minLevel: number; picks: number };
type Loadout = Pick<ReturnType<typeof playableLoadout>, 'line' | 'moveTypes' | 'learnsAll'>;
type Winner = { dps: number; est: number; form: string; line: Loadout; build: Build };
type Build = { moves: { move: string; level: number; maxLevel?: number }[]; items: { item: string; level: number }[]; options: Option[]; evolveItems: string[] };

const halfShop = (rules: SimRules) => {
  const levels: Record<string, number> = {};
  for (const u of shopConfig.upgrades) if (u.perLevel) levels[u.id] = Math.floor(u.maxLevel / 2);
  return permanentModifiers(rules, levels);
};

/** その地方の最後の区間の雑魚の HP（ランのレベルは LEVEL。ソロ） */
function lateEnemyHp(rules: SimRules, kindHp: number, lastWaveHp: number): number {
  const gyms = rules.stage.bosses.filter((b) => b.gate).length;
  return kindHp * lastWaveHp * (1 + (rules.spawn.hpPerTwoGymsPct * Math.floor(gyms / 2)) / 100) * (1 + (rules.spawn.hpPerLevelPct * (LEVEL - 1)) / 100);
}

function measure(rules: SimRules, form: string, types: number[], loadout: Loadout, moves: Build['moves'], items: Build['items'], sceneKey: keyof typeof SCENES, seedNo: number, target?: SimEnemyKind): number {
  const scene = SCENES[sceneKey];
  const r: SimRules = { ...rules, enemies: { ...rules.enemies, kinds: [...rules.enemies.kinds] } };
  const base = r.enemies.kinds.find((k) => (k.rank ?? 'normal') === 'normal')!;
  const dummy: SimEnemyKind = { ...base, id: 'dps-dummy', hp: HP, moveSpeed: 60, radius: 12, contactDamage: 0, types: [], rank: 'normal', xp: 0 };
  const boss: SimEnemyKind = target ? { ...target, id: 'dps-boss', hp: HP, moveSpeed: 60, contactDamage: 0, motion: undefined } : { ...base, id: 'dps-boss', hp: HP, moveSpeed: 60, radius: 28, contactDamage: 0, types: [], rank: 'midboss' };
  r.enemies.kinds.push(dummy, boss);
  const dummyKind = r.enemies.kinds.length - 2;
  const bossKind = r.enemies.kinds.length - 1;
  const sim = new Simulation({ tickRate: 30, seed: SEEDS[seedNo]!, rules: r });
  const w = sim.world;
  for (const wave of w.waves) Object.assign(wave, { spawnPerSecond: 0, minimum: 0 });
  (w as { nextBoss: number }).nextBoss = w.bossSchedule.length;
  (w.swarmSchedule as unknown[]).length = 0;
  w.boxTimer = 1e9;
  const moveIdx = (k: string): number => r.moves.findIndex((m) => m.key === k);
  const species = r.species.findIndex((s) => s.key === form);
  const p = sim.addPlayer({
    id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, types, species, line: loadout.line, moveTypes: loadout.moveTypes, learnsAll: loadout.learnsAll,
    moves: moves.map((m) => ({ move: moveIdx(m.move), level: m.level })),
  });
  moves.forEach((m, i) => {
    if (m.maxLevel) p.moves[i]!.maxLevel = m.maxLevel;
  });
  w.level = LEVEL;
  (p as { permanent?: unknown }).permanent = halfShop(r) ?? undefined;
  p.items = items.map((x) => ({ item: r.items.findIndex((it) => it.key === x.item), level: x.level }));
  recomputeModifiers(w, p);
  p.hp = p.maxHp = 1e9;
  p.facingX = 1;
  p.facingY = 0;
  let seed = 1 + seedNo;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const hp = scene.lateHp ? lateEnemyHp(r, base.hp, w.waves[w.waves.length - 1]!.hpMultiplier) : HP;
  const spawn = (): void => {
    const a = scene.boss ? 0 : rnd() * Math.PI * 2;
    const d = scene.still ?? (scene.boss ? 120 : 60 + rnd() * 340);
    // 突進する技でプレイヤーは動くので、足す雑魚はプレイヤーのまわりに置く
    w.enemies.add(w.nextEnemyId++, scene.boss ? bossKind : dummyKind, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, hp, scene.still !== undefined ? 0 : 60, scene.boss ? boss.radius : 12, 0);
  };
  for (let k = 0; k < scene.count; k++) spawn();
  let kills = 0;
  for (let t = 0; t < SECONDS * 30; t++) {
    p.hp = p.maxHp;
    p.facingX = 1;
    p.facingY = 0;
    // ボスの場面では、ボスの方を向く（人はボスへ向き直る。突き抜ける技（ころがる・のしかかり）が 1 回で終わらないように。07 の238章）
    if (scene.boss && w.enemies.count > 0) {
      const dx = w.enemies.x[0]! - p.x;
      const dy = w.enemies.y[0]! - p.y;
      const d = Math.hypot(dx, dy);
      // 向きは 8 方向（入力と同じ。-1・0・1）
      if (d > 1) {
        p.facingX = (Math.abs(dx) > d * 0.38 ? Math.sign(dx) : 0) as typeof p.facingX;
        p.facingY = (Math.abs(dy) > d * 0.38 ? Math.sign(dy) : 0) as typeof p.facingY;
      }
    }
    sim.step([]);
    // 倒れた分は、数がいつも同じになるようにすぐ足す（数えるのは倒した数だけ。遠くて消えた雑魚は数えない）
    if (scene.lateHp) {
      for (const ev of w.events) if (ev.type === 'enemyKilled') kills++;
      while (w.enemies.count < scene.count) spawn();
    }
  }
  let lost = kills * hp;
  for (let i = 0; i < w.enemies.count; i++) lost += hp - w.enemies.hp[i]!;
  return lost / SECONDS;
}

/**
 * 技ごとの表（持ち物なしと、形の持ち物 1 つずつ）は docs/26_move_items.json に残し、次からはそれを使う（作者の依頼 2026年11月8日: 毎回測らない）。
 * 技の定義・形の持ち物・戦いの数値・ステータスの決まりが変わった技だけ測り直す（目印 sig）。
 * 技の作り（src/sim のコード）を変えたときは、目印では分からないので TABLE_REDO=技,技 か TABLE_REDO=all で測り直す。
 */
const TABLE_FILE = process.env.TABLE_FILE ?? 'docs/26_move_items.json';
type TableFile = { note: string; regions: Record<string, Record<string, { sig: string; row: Record<string, Record<SceneKey, number>> }>> };
function moveSig(rules: SimRules, k: string): string {
  const def = rules.moves.find((m) => m.key === k);
  const items = Object.keys(SHAPE_ITEMS).map((i) => rules.items.find((x) => x.key === i));
  return createHash('sha1').update(JSON.stringify({ def, items, shape: SHAPE_ITEMS, combat: rules.combat, stats: rules.stats, LEVEL, SECONDS })).digest('hex').slice(0, 16);
}

function regionTable(rules: SimRules, keys: Set<string>, region: string): Map<string, Record<string, Record<SceneKey, number>>> {
  const file: TableFile = existsSync(TABLE_FILE) ? (JSON.parse(readFileSync(TABLE_FILE, 'utf8')) as TableFile) : { note: '', regions: {} };
  file.note = 'buildDps.balance.ts が作る技ごとの表（ミュウ Lv' + LEVEL + '・タイプなし・ショップ半分・' + SECONDS + ' 秒）。手で直さない';
  const cache = (file.regions[region] ??= {});
  const redo = process.env.TABLE_REDO?.split(',');
  const table = new Map<string, Record<string, Record<SceneKey, number>>>();
  let measured = 0;
  for (const k of keys) {
    const sig = moveSig(rules, k);
    const hit = cache[k];
    if (hit && hit.sig === sig && !redo?.includes(k) && !redo?.includes('all')) {
      table.set(k, hit.row);
      continue;
    }
    const row = measureRow(rules, k);
    if (!row) continue;
    table.set(k, row);
    cache[k] = { sig, row };
    measured++;
    // 途中で止めても、測った分は残す
    if (measured % 10 === 0) writeFileSync(TABLE_FILE, JSON.stringify(file) + '\n');
  }
  if (measured) writeFileSync(TABLE_FILE, JSON.stringify(file) + '\n');
  console.log(`${region}: 技の表 ${table.size} 個（測り直し ${measured} 個）`);
  return table;
}

function measureRow(rules: SimRules, k: string): Record<string, Record<SceneKey, number>> | null {
  const mew = 'mew';
  const lo = playableLoadout(rules, mew);
  {
    const def = rules.moves.find((m) => m.key === k);
    if (!def) return null;
    const moves = [{ move: k, level: def.levels.length }];
    const row: Record<string, Record<SceneKey, number>> = {};
    const m = (it: { item: string; level: number }[]): Record<SceneKey, number> => ({
      boss: measure(rules, mew, [], lo, moves, it, 'boss', 0),
      at50: measure(rules, mew, [], lo, moves, it, 'at50', 0),
      at150: measure(rules, mew, [], lo, moves, it, 'at150', 0),
      swarm: measure(rules, mew, [], lo, moves, it, 'swarm', 0),
    });
    row.none = m([]);
    if (row.none.boss > 0 || row.none.at50 > 0 || row.none.at150 > 0 || row.none.swarm > 0)
      for (const [item, level] of Object.entries(SHAPE_ITEMS)) row[item] = m([{ item, level }]);
    return row;
  }
}

/** 系統の姿の親子（進化先をたどる。becomes の系統も）。姿 → そこへの道の姿 */
function pathsOf(row: Row, rules: SimRules): Map<string, { path: string[]; items: string[] }> {
  const gen = generated.pokemon as Record<string, { evolvesTo: { to: string; trigger?: string; item?: string }[] } | undefined>;
  const formKeys = new Set(row.forms.map((f) => f.key));
  const out = new Map<string, { path: string[]; items: string[] }>();
  const def = playablesConfig.pokemon[row.key];
  const startKey = formKeys.has(row.key) ? row.key : (row.forms[0]?.key ?? row.key);
  const visit = (k: string, path: string[], items: string[]): void => {
    if (out.has(k)) return;
    out.set(k, { path: [...path, k], items });
    const sp = rules.species.find((s) => s.key === k);
    for (const e of gen[k]?.evolvesTo ?? []) {
      if (!formKeys.has(e.to)) continue;
      const evo = sp?.evolutions.find((x) => rules.species[x.to]?.key === e.to);
      if (!evo) continue;
      if (evo?.trigger === 'friendship' && evo.time && !rules.nightSections?.some(Boolean)) continue;
      const itemKey = evo && evo.trigger !== 'level' && evo.trigger !== 'friendship' && evo.item !== undefined ? rules.items[evo.item]?.key : undefined;
      visit(e.to, [...path, k], itemKey ? [...items, itemKey] : items);
    }
  };
  visit(startKey, [], []);
  for (const b of def?.becomes ?? []) if (!out.has(b.form)) visit(b.form, [startKey], []);
  return out;
}

function optionsFor(row: Row, rules: SimRules, path: string[], formItems: string[], line: string): Option[] {
  const raw = [...derivationsConfig.derivations, ...derivationsConfig.unique] as RawDerivation[];
  const lineOf = (d: Row['derives'][number]): RawDerivation | undefined => {
    const same = raw.filter((x) => x.from === d.from && x.to === d.to && (x.item ?? null) === d.item && (d.lineOnly ? !!x.line : !x.line));
    return same.find((x) => x.line === line || x.line === row.key) ?? same[0];
  };
  const specialItem = (m: string): string | undefined => row.special.find((x) => x.move === m && x.how === 'item')?.item;
  // 消費する技に、ほかの系列と別の元の技があるか（でんこうせっか と すてみタックル は同じ元なので一緒に持てない）
  const rootOf = (m: string): string | null => {
    if (roots.has(m)) return m;
    const prev = row.derives.find((d) => d.to === m);
    return prev ? rootOf(prev.from) : null;
  };
  const levels = (k: string): number => rules.moves.find((m) => m.key === k)?.levels.length ?? 1;
  const roots = new Map<string, { learnPick: number; needs: string[] }>();
  for (const s of row.start) roots.set(s, { learnPick: 0, needs: [] });
  if (!row.fixedMoves) for (const l of row.learn) if (l.forms.some((f) => path.includes(f)) && !roots.has(l.move)) roots.set(l.move, { learnPick: 1, needs: l.withMoves ?? [] });
  for (const s of row.special) {
    if (s.how === 'form' && s.form && path.includes(s.form)) roots.set(s.move, { learnPick: 0, needs: [] });
    if (s.how === 'item' && s.item) roots.set(s.move, { learnPick: 0, needs: [`item:${s.item}`] });
  }
  for (const b of playablesConfig.pokemon[row.key]?.becomes ?? []) {
    if (!path.includes(b.form)) continue;
    for (const m of playablesConfig.pokemon[b.line]?.startingMoves ?? []) if (!roots.has(m)) roots.set(m, { learnPick: 0, needs: [] });
  }
  const def = playablesConfig.pokemon[row.key] as { formTransforms?: { form: string; from: string[]; to: string }[] } | undefined;
  const transforms = (def?.formTransforms ?? []).filter((t) => path.includes(t.form));
  const out: Option[] = [];
  const walk = (root: string, cur: string, chain: string[], items: string[], consumes: string[], picks: number, minLevel: number, maxLevel: number | undefined, needs: string[]): void => {
    // 進化で別の技に変わる技（イーブイの たいあたり）は、その姿では終点にならない
    const forced = transforms.some((t) => t.from.includes(cur));
    if (!forced) out.push({ root, end: cur, chain, items, consumes, needs, picks, minLevel, ...(maxLevel ? { maxLevel } : {}) });
    for (const t of transforms) if (t.from.includes(cur) && !chain.includes(t.to)) walk(root, t.to, [...chain, t.to], items, consumes, picks + (levels(t.to) - 1), minLevel, undefined, needs);
    for (const d of row.derives) {
      if (d.from !== cur || chain.includes(d.to)) continue;
      const r = lineOf(d);
      if (r?.forms && !r.forms.some((f) => path.includes(f))) continue;
      const all = (r?.consumes ?? []).filter((c) => rootOf(c) !== null);
      // 消費する技は持っていなくてもよい（最大レベルが下がる）。持てる組み合わせを全部見る
      for (let mask = 0; mask < 1 << all.length; mask++) {
        const cons = all.filter((_, i) => mask & (1 << i));
        const consRoots = cons.map((c) => rootOf(c)!);
        if (new Set([root, ...consRoots]).size !== consRoots.length + 1) continue;
        const cap = r?.levelCap ? r.levelCap.base + r.levelCap.perConsumed * cons.length : undefined;
        const lv = Math.min(cap ?? Infinity, levels(d.to));
        const consLearn = cons.reduce((n, c) => n + (specialItem(c) || row.start.includes(c) ? 0 : 1), 0);
        const inherit = (r as { inheritLevels?: boolean } | undefined)?.inheritLevels;
        // 受け継ぐ技（ばくれつパンチ・とっておき）は、元の技と材料の技で上げた分がそのまま残る
        const nextPicks = inherit ? picks + 1 + consLearn + (lv - 1 - (levels(cur) - 1)) : picks + 1 + (lv - 1);
        const chainItems = (m: string): string[] => {
          if (roots.has(m)) return [];
          const prev = row.derives.find((x) => x.to === m);
          return prev ? [...chainItems(prev.from), ...(prev.item ? [prev.item] : [])] : [];
        };
        const consNeeds = cons.flatMap((c) => [...(specialItem(c) ? ['item:' + specialItem(c)] : []), ...chainItems(c).map((i) => 'item:' + i)]);
        walk(root, d.to, [...chain, d.to], d.item ? [...items, d.item] : items, [...new Set([...consumes, ...cons, ...consRoots])], nextPicks, Math.max(minLevel, d.minLevel ?? 0), cap ? lv : undefined, [...needs, ...consNeeds]);
      }
    }
  };
  for (const [root, r] of roots) walk(root, root, [root], [], [], r.learnPick + (levels(root) - 1), 0, undefined, r.needs);
  void formItems;
  return out;
}

const uniq = <T,>(a: T[]): T[] => [...new Set(a)];

/** その姿での系統（ピチュー → ピカチュウ は系統が変わる） */
function lineAt(rules: SimRules, row: Row, base: Loadout, path: string[]): Loadout {
  const b = (playablesConfig.pokemon[row.key]?.becomes ?? []).find((x) => path.includes(x.form) && rules.lines?.[x.line]);
  return b ? { line: b.line, moveTypes: [...rules.lines![b.line]!.moveTypes], learnsAll: base.learnsAll } : base;
}
type TableRow = Record<string, Record<SceneKey, number>>;
type Ctx = { rules: SimRules; table: Map<string, TableRow>; unlocked: Set<number>; mewSp: SimRules['species'][number]; moveByKey: Map<string, SimRules['moves'][number]>; itemByKey: Map<string, SimRules['items'][number]>; rankMul: (v: number) => number };
type Candidate = { est: number; per: number[]; form: string; line: Loadout; build: Build };
type FormOptions = Map<string, { options: Option[]; path: string[]; items: string[] }>;

function makeCtx(rules: SimRules, table: Map<string, TableRow>, unlocked: Set<number>): Ctx {
  const rankMul = (v: number): number => {
    const c = rules.stats;
    let i = 0;
    while (i < c.rankThresholds.length && v >= c.rankThresholds[i]!) i++;
    return c.rankMultipliers[i]!;
  };
  return { rules, table, unlocked, mewSp: rules.species.find((s) => s.key === 'mew')!, moveByKey: new Map(rules.moves.map((m) => [m.key, m])), itemByKey: new Map(rules.items.map((i) => [i.key, i])), rankMul };
}

/** 技ごとの表と持ち物の割合で、その系統の全組み合わせを見積もる（測らない）。solo は技 1 つだけのときの見積もり */
function candidatesFor(ctx: Ctx, row: Row, forms: FormOptions, scene: SceneKey): { list: Candidate[]; solo: { move: string; est: number; form: string; items: string[] }[] } {
  const { rules, table, unlocked, mewSp, moveByKey, itemByKey, rankMul } = ctx;
  const lo = playableLoadout(rules, row.key);
  const def = playablesConfig.pokemon[row.key] as { startingMoves?: string[] } | undefined;
  const candidates: Candidate[] = [];
  const solo: { move: string; est: number; form: string; items: string[] }[] = [];
  for (const [form, info] of forms) {
    const sp = rules.species.find((s) => s.key === form);
    if (!sp) continue;
    // レベルやなつきで必ず進化する姿には、Lv100 ではとどまれない
    if (sp.evolutions.some((e) => (e.trigger === 'level' && e.level <= LEVEL) || (e.trigger === 'friendship' && !e.time))) continue;
    const types = [...sp.types];
    const atk = rankMul(sp.baseStats.attack) / rankMul(mewSp.baseStats.attack);
    const spa = rankMul(sp.baseStats.specialAttack) / rankMul(mewSp.baseStats.specialAttack);
    const moveDef = (k: string) => moveByKey.get(k);
    const finalLine = lineAt(rules, row, lo, info.path);
    // 持てる持ち物: 道のどれかの姿で候補に出るもの
    const fitCache = new Map<string, boolean>();
    const fitsItem = (key: string, owned: readonly string[] = []): boolean => {
      const cacheKey = key + '|' + owned.join(',');
      const hit = fitCache.get(cacheKey);
      if (hit !== undefined) return hit;
      const moves = owned.map((m) => ({ move: rules.moves.findIndex((x) => x.key === m) }));
      const item = rules.items.findIndex((i) => i.key === key);
      if (item < 0) return false;
      const ok = info.path.some((f, n) => {
        const s = rules.species.findIndex((x) => x.key === f);
        const l = lineAt(rules, row, lo, info.path.slice(0, n + 1));
        return itemFits(rules, { unlockedItems: unlocked, line: l.line, items: [], moveTypes: l.moveTypes, species: s, types: [...(rules.species[s]?.types ?? [])], moves }, item);
      });
      fitCache.set(cacheKey, ok);
      return ok;
    };
    const formIndex = rules.species.findIndex((x) => x.key === form);
    const stays = (k: string): boolean => {
      const d = itemByKey.get(k);
      return !d?.forms || d.consumable === true || d.forms.includes(formIndex);
    };
    const usable = info.options.filter((o) => o.items.every((k) => fitsItem(k, o.chain) && stays(k)) && o.needs.filter((n) => n.startsWith('item:')).every((n) => fitsItem(n.slice(5), o.chain) && stays(n.slice(5))));
    const roots = uniq(usable.map((o) => o.root));
    const starts = (def?.startingMoves ?? row.start).filter((s) => roots.includes(s));
    // 直接のダメージの大きい順に上から（必ず入る最初の技の系列は全部残す）。補助の技（いつも効く）は別に残す
    const value = (o: Option): number => {
      const md = moveDef(o.end);
      const pow = md?.damageClass === 'physical' ? atk : spa;
      return (table.get(o.end)?.none?.[scene] ?? 0) * pow * (md && types.includes(md.type) ? rules.combat.typeMultipliers.stab : 1);
    };
    const passivePct = (o: Option): number => {
      const md = moveDef(o.end);
      const pa = md?.passive[md.levels.length - 1] as { powerPct?: number; physicalPowerPct?: number; specialPowerPct?: number; lockOnPct?: number } | undefined;
      // ロックオン（ボスへのダメージ）も、ボスを相手にした見積もりでは威力と同じに数える
      return (pa?.powerPct ?? 0) + (pa?.physicalPowerPct ?? 0) + (pa?.specialPowerPct ?? 0) + (pa?.lockOnPct ?? 0);
    };
    const ranked = [...usable].sort((a, b) => value(b) - value(a));
    const keep = new Set<Option>();
    for (const o of ranked.slice(0, row.learnsAll ? 16 : 24)) keep.add(o);
    for (const o of usable) if (starts.includes(o.root) || passivePct(o) > 0 || MUST?.includes(o.end)) keep.add(o);
    for (const r of roots) {
      const bestOf = ranked.find((o) => o.root === r);
      if (bestOf) keep.add(bestOf);
    }
    const pool = [...keep];
    // 技の組み合わせ（最初の技はかならず入る）
    const pick = (cur: Option[], from: number): void => {
      const usedRoots = cur.map((o) => o.root);
      const need = starts.filter((s) => !usedRoots.includes(s));
      if (cur.length + need.length > rules.combat.maxMoveSlots) return;
      let extended = false;
      if (cur.length < rules.combat.maxMoveSlots) {
        for (let i = 0; i < pool.length; i++) {
          const o = pool[i]!;
          if (usedRoots.includes(o.root) || cur.some((c) => c.end === o.end)) continue;
          if (cur.some((c) => c.consumes.includes(o.root) || c.consumes.includes(o.end) || o.consumes.includes(c.root) || o.consumes.includes(c.end))) continue;
          if (popcount(cur.reduce((b, c) => b | keptBits.get(c)!, keptBits.get(o)!)) > rules.leveling.maxItemSlots) continue;
          extended = true;
          if (i >= from) pick([...cur, o], i + 1);
        }
      }
      // 足せる技がもう無い組だけを見る（枠は埋める）
      if (!extended && cur.length > 0 && need.length === 0) sets.push(cur);
    };
    const sets: Option[][] = [];
    const bitOf = new Map<string, number>();
    const keptBits = new Map<Option, number>();
    const popcount = (v: number): number => {
      let c = 0;
      for (let x = v; x !== 0; x &= x - 1) c++;
      return c;
    };
    for (const o of pool) {
      let b = 0;
      for (const k of [...o.items.filter((i) => !itemByKey.get(i)?.consumable), ...o.needs.filter((n) => n.startsWith('item:')).map((n) => n.slice(5))]) {
        if (!bitOf.has(k)) bitOf.set(k, bitOf.size);
        b |= 1 << bitOf.get(k)!;
      }
      keptBits.set(o, b);
    }
    // 最後まで残る持ち物（進化の道具は使うと空く。持つだけで技を覚える石は残る）
    const materialsOf = (opts: Option[]): string[] => uniq(opts.flatMap((o) => [...o.items, ...o.needs.filter((n) => n.startsWith('item:')).map((n) => n.slice(5))]));
    const keptOf = (opts: Option[]): string[] => materialsOf(opts).filter((k) => !itemByKey.get(k)?.consumable || opts.some((o) => o.needs.includes(`item:${k}`)));
    // 一緒に持てない持ち物（かわらずのいし と 進化の石・でんきだま と かみなりのいし）: 進化に使う道具と、残る持ち物がぶつかる組は作れない
    const clashes = (kept: string[]): boolean => {
      const idx = (k: string): number => rules.items.findIndex((i) => i.key === k);
      const evo = info.items.map(idx);
      return kept.some((k) => {
        const d = itemByKey.get(k);
        return evo.some((e) => d?.excludes?.includes(e) || rules.items[e]?.excludes?.includes(idx(k)));
      });
    };
    const quickOne = new Map<Option, [number, number]>();
    for (const o of pool) {
      const v = value(o);
      const t = table.get(o.end);
      const n = t?.none?.[scene] ?? 0;
      let shaped = v;
      if (n > 0) for (const it of ['pp-max', 'metronome', 'light-clay']) if (t?.[it]) shaped *= t[it]![scene] / n;
      quickOne.set(o, [v, shaped]);
    }
    const quick = (opts: Option[], which: 0 | 1): number => opts.reduce((sum, o) => sum + quickOne.get(o)![which], 0) * (1 + opts.reduce((p2, o) => p2 + passivePct(o), 0) / 100);
    // single: 技 1 つだけの見積もり（ほかの技が要る・姿で自動で覚える技の枠、は見ない）
    const evaluate = (opts: Option[], single = false): Candidate | null => {
      // 消費する技を持っている必要があるもの・ほかの技が要るものは満たす
      const ends = opts.map((o) => o.end);
      const rootsNow = opts.map((o) => o.root);
      for (const o of opts) {
        if (!single) for (const n of o.needs) if (!n.startsWith('item:') && !rootsNow.includes(n) && !ends.includes(n)) return null;
        if (o.consumes.some((c) => ends.includes(c) || rootsNow.includes(c))) return null;
      }
      const earlier = (m: string, autoForm: string): boolean => {
        const at = info.path.indexOf(autoForm);
        if (row.start.includes(m)) return true;
        return row.learn.some((l) => l.move === m && l.forms.some((x) => info.path.indexOf(x) >= 0 && info.path.indexOf(x) < at));
      };
      for (const a of row.special) {
        if (a.how !== 'form' || !a.form || !info.path.includes(a.form) || rootsNow.includes(a.move) || ends.includes(a.move)) continue;
        if (opts.some((o) => o.consumes.includes(a.move))) continue;
        if (!single && (opts.length < rules.combat.maxMoveSlots || !opts.every((o) => earlier(o.root, a.form!)))) return null;
      }
      const materials = materialsOf(opts);
      const keepItems = keptOf(opts);
      const free = rules.leveling.maxItemSlots - keepItems.length;
      if (free < 0 || clashes(keepItems)) return null;
      const held = (key: string): boolean => keepItems.includes(key);
      const types2 = uniq(opts.map((o) => rules.types.names[moveDef(o.end)?.type ?? -1] ?? ''));
      const typeItems = rules.items.filter((i) => i.category === 'type' && [...i.perLevel.typePowerPct].some((v, t) => v && types2.includes(rules.types.names[t]!))).map((i) => i.key);
      const extraItems = form === 'pikachu' ? ['light-ball'] : form === 'eevee' ? ['everstone'] : [];
      const cands = uniq([...FILL_ITEMS, ...typeItems, ...extraItems]).filter((k) => !held(k) && fitsItem(k, opts.flatMap((o) => o.chain)) && !clashes([k]));
      // 自分を強くする技（フレアドライブ: 使うと 5 秒 攻撃 +60%）は、出ている割合（持続 ÷ 再使用）だけ、ほかの技の威力に足す
      const buffs = opts.flatMap((o) => {
        const md = moveDef(o.end)!;
        const sb = md.selfBuff;
        if (!sb) return [];
        const st = md.levels[(o.maxLevel ?? md.levels.length) - 1]!;
        return [{ end: o.end, up: Math.min(1, sb.seconds / Math.max(0.1, st.cooldownSeconds)), mods: sb.mods }];
      });
      let per: number[] = [];
      const estimateWith = (fill: string[]): number => {
        const allItems = [...keepItems, ...fill];
        let total = 0;
        per = [];
        const passivePower = opts.reduce((s, o) => s + passivePct(o), 0);
        // 持ち物の数値（最大レベル）。会心は 1.5 倍（基本の会心率 9% に足す）
        const lv = (it: string): number => itemByKey.get(it)?.maxLevel ?? 0;
        const critItem = allItems.reduce((s, it) => s + (itemByKey.get(it)?.perLevel.critChancePct ?? 0) * lv(it), 0);
        for (const o of opts) {
          const md = moveDef(o.end)!;
          const row2 = table.get(o.end);
          let v = row2?.none?.[scene] ?? 0;
          if (!row2 || v <= 0) {
            per.push(0);
            continue;
          }
          // 数を増やす持ち物（ポイントマックス・メトロノーム・するどいツメ）は割合を掛ける。
          // 届き方を変える持ち物（範囲・距離・持続・弾の速さ）は、ほとんど届かない立ち位置で何倍にもなり、掛け合わせると何千倍にもなるので、一番伸びる 1 つだけ（07 の237章）
          let reach = 1;
          for (const it of allItems) {
            if (!SHAPE_ITEMS[it] || !row2[it] || row2.none![scene] <= 0) continue;
            const r = row2[it]![scene] / row2.none![scene];
            if (AMOUNT_ITEMS.includes(it)) v *= r;
            else reach = Math.max(reach, r);
          }
          v *= reach;
          let add = 25 + passivePower;
          const physical = md.damageClass === 'physical';
          for (const it of allItems) {
            const p = itemByKey.get(it)?.perLevel;
            if (!p) continue;
            add += lv(it) * ((p.powerPct ?? 0) + (physical ? (p.physicalPowerPct ?? 0) : (p.specialPowerPct ?? 0)) + (p.typePowerPct?.[md.type] ?? 0));
          }
          for (const b of buffs) if (b.end !== o.end) add += b.up * ((b.mods.powerPct ?? 0) + (physical ? b.mods.physicalPowerPct : b.mods.specialPowerPct));
          const crit = (100 + (rules.combat.critMultiplier - 1) * (9 + critItem)) / (100 + (rules.combat.critMultiplier - 1) * 9);
          v *= ((1 + add / 100) / 1.25) * crit * (physical ? atk : spa) * (types.includes(md.type) ? rules.combat.typeMultipliers.stab : 1);
          if (allItems.includes('light-ball')) v *= 2;
          per.push(v);
          total += v;
        }
        return total;
      };
      // 空き枠を、増え方の大きい順に埋める
      const fill: string[] = [];
      let cur = estimateWith(fill);
      for (let k = 0; k < free && fill.length < cands.length; k++) {
        let bestK: string | null = null;
        let bestV = cur;
        for (const c of cands) {
          if (fill.includes(c)) continue;
          const v = estimateWith([...fill, c]);
          if (v > bestV) {
            bestV = v;
            bestK = c;
          }
        }
        if (!bestK) break;
        fill.push(bestK);
        cur = bestV;
      }
      if (cur <= 0) return null;
      estimateWith(fill);
      const levelOf = (k: string): number => rules.items.find((i) => i.key === k)!.maxLevel;
      const build: Build = {
        moves: opts.map((o) => ({ move: o.end, level: o.maxLevel ?? rules.moves.find((m) => m.key === o.end)!.levels.length, ...(o.maxLevel ? { maxLevel: o.maxLevel } : {}) })),
        items: [...keepItems, ...fill].map((item) => ({ item, level: levelOf(item) })),
        options: opts,
        evolveItems: uniq([...info.items, ...materials.filter((k) => !keepItems.includes(k))]),
      };
      return { est: cur, per: [...per], form, line: finalLine, build };
    };
    pick([], 0);
    // 軽い点の上位だけ、持ち物まで詰める（点は 2 通り: そのままと、数や持続が増えたとき）
    const chosen = new Set<Option[]>();
    const wanted = MUST ? sets.filter((set) => set.some((o) => MUST.includes(o.end))) : sets;
    for (const which of [0, 1] as const) for (const set of [...wanted].sort((a, b) => quick(b, which) - quick(a, which)).slice(0, 150)) chosen.add(set);
    for (const set of chosen) {
      const c = evaluate(set);
      if (!c) continue;
      candidates.push(c);
      if (candidates.length > TOP * 40) {
        candidates.sort((a, b) => b.est - a.est);
        candidates.length = TOP * 8;
      }
    }
    // 技 1 つだけ（持ち物は材料と、その技に一番効くもので埋める）
    for (const o of usable) {
      const c = evaluate([o], true);
      if (c) solo.push({ move: o.end, est: c.est, form, items: c.build.items.map((i) => i.item) });
    }
  }
  candidates.sort((a, b) => b.est - a.est);
  return { list: candidates, solo };
}

/** 地方のルール・系統ごとの技の道・技ごとの表（docs/26 から。無い・変わった技だけ測る） */
function regionSetup(region: string, rs: Row[]): { rules: SimRules; unlocked: Set<number>; allOptions: Map<string, FormOptions>; ctx: Ctx } {
  const rules = buildSimRules(region);
  const obtainable = achievementPerks(achievementsConfig, achievementsConfig.achievements.filter((a) => a.region === region).map((a) => a.id), region).items;
  const unlocked = new Set([...obtainable].map((k) => rules.items.findIndex((i) => i.key === k)));
  const moveKeys = new Set<string>();
  const allOptions = new Map<string, FormOptions>();
  for (const row of rs) {
    const lo = playableLoadout(rules, row.key);
    const perForm: FormOptions = new Map();
    for (const [form, info] of pathsOf(row, rules)) {
      const opts = optionsFor(row, rules, info.path, info.items, lo.line);
      perForm.set(form, { options: opts, path: info.path, items: info.items });
      opts.forEach((o) => moveKeys.add(o.end));
    }
    allOptions.set(row.key, perForm);
  }
  const table = regionTable(rules, moveKeys, region);
  return { rules, unlocked, allOptions, ctx: makeCtx(rules, table, unlocked) };
}

it('ビルド案', () => {
  const data = JSON.parse(readFileSync(LEARNSETS, 'utf8')) as { pokemon: Row[]; moves: Record<string, { name: string; type: string }>; items: Record<string, string>; types: Record<string, string> };
  const rows = data.pokemon.filter((p, i) => (p.region === 'kanto' || p.region === 'johto') && (!ONLY || ONLY.includes(p.key)) && (!SHARD || i % SHARD[1]! === SHARD[0]));
  const results: unknown[] = [];
  for (const region of ['kanto', 'johto']) {
    const rs = rows.filter((r) => r.region === region);
    if (!rs.length) continue;
    const { rules, allOptions, ctx } = regionSetup(region, rs);

    for (const row of rs) {
      const best: Record<SceneKey, Winner | null> = { boss: null, at50: null, at150: null, swarm: null };
      for (const scene of [...BOSS_SCENES, 'swarm'] as SceneKey[]) {
        const candidates = candidatesFor(ctx, row, allOptions.get(row.key)!, scene).list;
        // 上位を実際に測る（1 シード → 上位 3 つを 3 シード）
        const perForm = [...new Set(candidates.map((c) => c.form))].flatMap((fm) => candidates.filter((c) => c.form === fm).slice(0, 2));
        const top = [...new Set([...candidates.slice(0, TOP), ...perForm])].map((c) => {
          const types = [...rules.species.find((s) => s.key === c.form)!.types];
          return { ...c, types, one: measure(rules, c.form, types, c.line, c.build.moves, c.build.items, scene, 0) };
        });
        top.sort((a, b) => b.one - a.one);
        let winner: Winner | null = null;
        for (const c of top.slice(0, 3)) {
          const dps = SEEDS.reduce((s, _, n) => s + measure(rules, c.form, c.types, c.line, c.build.moves, c.build.items, scene, n), 0) / SEEDS.length;
          if (!winner || dps > winner.dps) winner = { dps, est: c.est, form: c.form, line: c.line, build: c.build };
        }
        best[scene] = winner;
      }
      const describe = (x: Winner | null, scene: SceneKey): unknown => {
        if (!x) return null;
        const b = x.build;
        const types = [...rules.species.find((s) => s.key === x.form)!.types];
        const avg = (s: keyof typeof SCENES, moves = b.moves): number => SEEDS.reduce((sum, _, n) => sum + measure(rules, x.form, types, x.line, moves, b.items, s, n), 0) / SEEDS.length;
        const itemLevels = b.items.reduce((s, i) => s + i.level, 0);
        const picks = b.options.reduce((s, o) => s + o.picks, 0) + itemLevels + b.evolveItems.length;
        return {
          form: x.form,
          scene,
          dps: { boss: avg('boss'), at50: avg('at50'), at150: avg('at150'), swarm: avg('swarm') },
          est: x.est,
          moves: b.options.map((o, i) => ({ end: o.end, root: o.root, chain: o.chain, items: o.items, consumes: o.consumes, level: b.moves[i]!.level, solo: { scene: avg(scene, [b.moves[i]!]) } })),
          items: b.items,
          evolveItems: b.evolveItems,
          picks,
          minLevel: Math.max(0, ...b.options.map((o) => o.minLevel)),
        };
      };
      const bossScene = BOSS_SCENES.reduce((a, b) => ((best[b]?.dps ?? 0) > (best[a]?.dps ?? 0) ? b : a));
      results.push({ region, key: row.key, name: row.name, boss: describe(best[bossScene], bossScene), swarm: describe(best.swarm, 'swarm') });
      console.log(`${region} ${row.key}: ボス ${best[bossScene]?.dps.toFixed(0)}（${bossScene}） / 群れ ${best.swarm?.dps.toFixed(0)}`);
    }
  }
  const lateHp = Object.fromEntries(
    ['kanto', 'johto'].map((region) => {
      const rules = buildSimRules(region);
      const base = rules.enemies.kinds.find((k) => (k.rank ?? 'normal') === 'normal')!;
      return [region, lateEnemyHp(rules, base.hp, new Simulation({ tickRate: 30, seed: 1, rules }).world.waves.at(-1)!.hpMultiplier)];
    }),
  );
  writeFileSync(OUT, JSON.stringify({ level: LEVEL, seconds: SECONDS, lateHp, results }, null, 1) + '\n');
}, 7_200_000);

/**
 * ポケモンごとのボス単独の火力と、ボスを倒す秒数（作者の依頼 2026年11月7日）:
 *   npx vitest run --mode balance src/sim/buildDps.balance.ts -t ボスを倒す秒数
 * docs/24 のボス向けの案を使い、(1) その系統が持てる技を 1 つずつ測る (2) 案の合計を、ボスごとの相性と大きさで測って HP で割る
 * (3) 本物の伝説と戦わせる（倒れないプレイヤーがボスを追う。避ける分を引いていないので、上限に近い値）。
 */
type PlanMove = { end: string; level: number; solo: { scene: number } };
type Plan = { form: string; scene: SceneKey; dps: Record<string, number>; moves: PlanMove[]; items: { item: string; level: number }[] };
type Target = { id: string; label: string; kinds: string[]; hp: number[]; real: boolean };

function realFight(rules: SimRules, form: string, line: Loadout, plan: Plan, kindIndex: number, seed: number): { seconds: number; won: boolean; dealtPct: number; hp: number } {
  const sim = new Simulation({ tickRate: 30, seed, rules });
  const w = sim.world;
  for (const wave of w.waves) Object.assign(wave, { spawnPerSecond: 0, minimum: 0 });
  (w as { nextBoss: number }).nextBoss = w.bossSchedule.length;
  (w.swarmSchedule as unknown[]).length = 0;
  w.boxTimer = 1e9;
  const sp = rules.species.findIndex((x) => x.key === form);
  const p = sim.addPlayer({
    id: 1, x: 0, y: 0, radius: playerConfig.radius, moveSpeed: playerConfig.moveSpeed, types: [...rules.species[sp]!.types], species: sp, line: line.line, moveTypes: line.moveTypes, learnsAll: line.learnsAll,
    moves: plan.moves.map((m) => ({ move: rules.moves.findIndex((x) => x.key === m.end), level: m.level })),
  });
  w.level = LEVEL;
  (p as { permanent?: unknown }).permanent = halfShop(rules) ?? undefined;
  p.items = plan.items.map((x) => ({ item: rules.items.findIndex((it) => it.key === x.item), level: x.level }));
  recomputeModifiers(w, p);
  startLegendary(w, kindIndex);
  const startRound = w.legendary!.round ?? 0;
  const kinds = legendRoundKinds(w, kindIndex);
  const keep = plan.scene === 'at150' ? 150 : plan.scene === 'at50' ? 50 : 30;
  let spawnedAt = -1;
  let startHp = 0;
  let dir = '';
  const e = w.enemies;
  const alive = (): number => {
    let sum = 0;
    for (let i = 0; i < e.count; i++) if (e.hp[i]! > 0 && kinds.includes(e.kind[i]!)) sum += e.hp[i]!;
    return sum;
  };
  const result = (won: boolean, left: number) => ({ seconds: (w.tick - spawnedAt) / 30, won, dealtPct: startHp ? (100 * (startHp - left)) / startHp : 0, hp: startHp });
  for (let guard = 0; guard < 30 * 400; guard++) {
    p.invincibleTicks = 2;
    p.hp = p.maxHp;
    const cmds: InputCommand[] = [];
    if (w.levelUp) cmds.push({ type: 'skipUpgrade', playerId: 1 });
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < e.count; i++) {
      if (e.hp[i]! <= 0 || !kinds.includes(e.kind[i]!) || w.hiddenEnemies.has(e.id[i]!)) continue;
      const d = Math.hypot(e.x[i]! - p.x, e.y[i]! - p.y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) {
      const dx = e.x[best]! - p.x;
      const dy = e.y[best]! - p.y;
      const len = Math.hypot(dx, dy) || 1;
      const a = (v: number): Axis => (v / len > 0.38 ? 1 : v / len < -0.38 ? -1 : 0);
      // 向きは実際のプレイヤーと同じ 8 方向
      p.facingX = a(dx);
      p.facingY = a(dy);
      const want = e.radius[best]! + keep;
      const sign = bd > want + 12 ? 1 : bd < want - 12 ? -1 : 0;
      const flip = (v: Axis): Axis => (sign === 0 ? 0 : sign > 0 ? v : v === 1 ? -1 : v === -1 ? 1 : 0);
      const ax = flip(a(dx));
      const ay = flip(a(dy));
      const nd = ax + ',' + ay;
      if (nd !== dir) {
        dir = nd;
        cmds.push({ type: 'move', playerId: 1, dx: ax, dy: ay });
      }
    }
    sim.step(cmds);
    const l = w.legendary;
    if (l?.spawned && spawnedAt < 0) {
      spawnedAt = w.tick;
      startHp = alive();
    }
    if (spawnedAt < 0) continue;
    const left = alive();
    if (left <= 0) return result(true, 0);
    if (!l || l.result !== null || (l.round ?? 0) !== startRound || w.outcome !== null) return result(false, left);
  }
  return result(false, alive());
}

/** 地方の四天王・伝説・レッド・乱入（HP は伝説の倍率込み） */
function targetsOf(region: string, rules: SimRules): Target[] {
  const kinds = rules.enemies.kinds;
  const cfg = rules.stage.legendary!;
  const stageData = JSON.parse(readFileSync('data/regions/' + region + '.json', 'utf8')) as { bosses: { kind?: string; id?: string }[] };
  const hpOf = (id: string): number => kinds.find((k) => k.id === id)!.hp;
  const legendHp = (id: string): number => hpOf(id) * (rules.stage.bossRules.legendHpMultiplier ?? 1);
  const targets: Target[] = [];
  for (const b of stageData.bosses) {
    const id = b.kind ?? b.id!;
    if (kinds.find((k) => k.id === id)?.rank === 'boss') targets.push({ id, label: 'elite', kinds: [id], hp: [hpOf(id)], real: false });
  }
  const counterKinds = (cfg as { counter?: { kinds: readonly string[] } }).counter?.kinds ?? [];
  if (!cfg.rounds?.length) for (const k of [...cfg.kinds, ...counterKinds]) {
    const id = typeof k === 'number' ? kinds[k]!.id : k;
    targets.push({ id, label: 'legend', kinds: [id], hp: [legendHp(id)], real: true });
  }
  const idOf = (k: string | number): string => (typeof k === 'number' ? kinds[k]!.id : k);
  (cfg.rounds ?? []).forEach((r, n) => {
    const ids = r.kinds.map(idOf);
    targets.push({ id: 'round' + (n + 1), label: 'red', kinds: ids, hp: ids.map(legendHp), real: true });
  });
  for (const r of cfg.bonusRounds ?? []) {
    const ids = r.kinds.map(idOf);
    targets.push({ id: ids[0]!, label: 'legend', kinds: ids, hp: ids.map(legendHp), real: true });
  }
  // ホウエンの最後の戦い（レックウザ。いんせきならデオキシス。07 の189章）
  const finale = (cfg as { finale?: { kinds: string[]; item: { kinds: string[] } } }).finale;
  for (const list of finale ? [finale.kinds, finale.item.kinds] : []) {
    const ids = list.map(idOf);
    targets.push({ id: ids[0]!, label: 'legend', kinds: ids, hp: ids.map(legendHp), real: true });
  }
  if (cfg.intruders) {
    const mid = kinds.filter((k) => stageData.bosses.some((b) => (b.kind ?? b.id) === k.id) && k.rank === 'midboss').map((k) => k.hp);
    const times = cfg.intruders.hpTimesMidboss;
    // 中ボスに合わせない乱入（ホウエンのラティ兄妹）は自分の HP。together は全員を一度に倒す
    const hp = (id: string): number => (times ? Math.max(...mid) * times : hpOf(id));
    if ((cfg.intruders as { together?: boolean }).together) {
      const ids = cfg.intruders.kinds.map(idOf);
      targets.push({ id: ids[0]!, label: 'intruder', kinds: ids, hp: ids.map(hp), real: false });
    } else
      for (const k of cfg.intruders.kinds) {
        const id = idOf(k);
        targets.push({ id, label: 'intruder', kinds: [id], hp: [hp(id)], real: false });
      }
  }
  return targets;
}

it('ボスを倒す秒数', () => {
  const plans = JSON.parse(readFileSync(process.env.KILL_IN ?? 'docs/24_build_dps.json', 'utf8')) as { results: { region: string; key: string; name: string; boss: Plan }[] };
  const data = JSON.parse(readFileSync(LEARNSETS, 'utf8')) as { pokemon: Row[] };
  const out: unknown[] = [];
  const targetsOut: Record<string, Target[]> = {};
  const CLASS_ITEM: Record<string, string> = { physical: 'x-attack', special: 'x-sp-atk' };
  for (const region of ['kanto', 'johto']) {
    const rows = plans.results.filter((r) => r.region === region && (!ONLY || ONLY.includes(r.key)));
    if (!rows.length) continue;
    const rules = buildSimRules(region);
    const kinds = rules.enemies.kinds;
    const targets = targetsOf(region, rules);
    targetsOut[region] = targets;
    const unlocked = new Set([...achievementPerks(achievementsConfig, achievementsConfig.achievements.filter((a) => a.region === region).map((a) => a.id), region).items].map((k) => rules.items.findIndex((i) => i.key === k)));
    for (const r of rows) {
      const row = data.pokemon.find((p) => p.region === region && p.key === r.key)!;
      const lo = playableLoadout(rules, r.key);
      const plan = r.boss;
      const info = pathsOf(row, rules).get(plan.form)!;
      const line = lineAt(rules, row, lo, info.path);
      const types = [...rules.species.find((s) => s.key === plan.form)!.types];
      // (1) 持てる技を 1 つずつ（材料＋火力の持ち物で 6 枠まで）
      const seen = new Set<string>();
      const allMoves: { move: string; dps: number; scene: SceneKey; inBuild: boolean; items: string[] }[] = [];
      const fits = (key: string, owned: string[]): boolean => {
        const item = rules.items.findIndex((i) => i.key === key);
        const moves = owned.map((m) => ({ move: rules.moves.findIndex((x) => x.key === m) }));
        return item >= 0 && info.path.some((f, n) => {
          const s = rules.species.findIndex((x) => x.key === f);
          const l = lineAt(rules, row, lo, info.path.slice(0, n + 1));
          return itemFits(rules, { unlockedItems: unlocked, line: l.line, items: [], moveTypes: l.moveTypes, species: s, types: [...(rules.species[s]?.types ?? [])], moves }, item);
        });
      };
      for (const o of optionsFor(row, rules, info.path, info.items, lo.line)) {
        if (seen.has(o.end) || !o.items.every((k) => fits(k, o.chain))) continue;
        seen.add(o.end);
        const def = rules.moves.find((m) => m.key === o.end);
        if (!def) continue;
        const items = uniq(o.items.filter((k) => !rules.items.find((i) => i.key === k)?.consumable));
        const typeItem = rules.items.find((i) => i.category === 'type' && i.perLevel.typePowerPct[def.type]);
        const wish = [CLASS_ITEM[def.damageClass] ?? 'x-attack', ...(typeItem ? [typeItem.key] : []), 'dire-hit', 'metronome', 'pp-max', 'light-clay'];
        for (const k of wish) if (items.length < rules.leveling.maxItemSlots && !items.includes(k) && fits(k, o.chain)) items.push(k);
        const its = items.map((item) => ({ item, level: rules.items.find((i) => i.key === item)!.maxLevel }));
        const mv = [{ move: o.end, level: o.maxLevel ?? def.levels.length }];
        let bestDps = 0;
        let bestScene: SceneKey = 'boss';
        for (const sc of BOSS_SCENES) {
          const v = measure(rules, plan.form, types, line, mv, its, sc, 0);
          if (v > bestDps) {
            bestDps = v;
            bestScene = sc;
          }
        }
        allMoves.push({ move: o.end, dps: bestDps, scene: bestScene, inBuild: plan.moves.some((m) => m.end === o.end), items });
      }
      allMoves.sort((a, b) => b.dps - a.dps);
      // (2) 案の合計を、ボスごとに（相性・大きさ込み。一番伸びる立ち位置）
      const moves = plan.moves.map((m) => ({ move: m.end, level: m.level }));
      // その技を抜くと、合計がいくら下がるか（技どうしの組み合わせの分も入る。単独の値では見えない）
      const totalIn = (list: typeof moves): number => SEEDS.reduce((sum, _, n) => sum + measure(rules, plan.form, types, line, list, plan.items, plan.scene, n), 0) / SEEDS.length;
      const whole = totalIn(moves);
      const worth = Object.fromEntries(moves.map((m) => [m.move, whole - (moves.length > 1 ? totalIn(moves.filter((x) => x !== m)) : 0)]));
      const vs: Record<string, { dps: number; seconds: number }> = {};
      const memo = new Map<string, number>();
      const dpsAgainst = (id: string): number => {
        const hit = memo.get(id);
        if (hit !== undefined) return hit;
        const kind = kinds.find((k) => k.id === id)!;
        const v = Math.max(...BOSS_SCENES.map((sc) => SEEDS.reduce((sum, _, n) => sum + measure(rules, plan.form, types, line, moves, plan.items, sc, n, kind), 0) / SEEDS.length));
        memo.set(id, v);
        return v;
      };
      for (const t of targets) {
        const seconds = t.kinds.reduce((sum, id, n) => sum + t.hp[n]! / Math.max(1, dpsAgainst(id)), 0);
        vs[t.id] = { dps: t.hp.reduce((a, b) => a + b, 0) / seconds, seconds };
      }
      // (3) 本物の伝説と戦う
      const real: Record<string, { seconds: number; won: boolean; dealtPct: number; hp: number }> = {};
      for (const t of targets) {
        if (!t.real) continue;
        const idx = kinds.findIndex((k) => k.id === t.kinds[0]);
        const a = [101, 202].map((seed) => realFight(rules, plan.form, line, plan, idx, seed));
        real[t.id] = { seconds: (a[0]!.seconds + a[1]!.seconds) / 2, won: a.every((x) => x.won), dealtPct: Math.min(a[0]!.dealtPct, a[1]!.dealtPct), hp: a[0]!.hp };
      }
      out.push({ region, key: r.key, name: r.name, form: plan.form, total: Math.max(plan.dps.boss!, plan.dps.at50!, plan.dps.at150!), scene: plan.scene, build: plan.moves.map((m) => ({ move: m.end, level: m.level, solo: m.solo.scene, worth: worth[m.end] })), items: plan.items.map((i) => i.item), allMoves, vs, real });
    }
  }
  writeFileSync(process.env.KILL_OUT ?? 'docs/25_boss_kill.json', JSON.stringify({ level: LEVEL, targets: targetsOut, rows: out }, null, 1) + '\n');
}, 7_200_000);

/**
 * 技の作りの検査（作者の指摘 2026年11月7日: 数字だけでなく作りを見る）:
 *   npx vitest run --mode balance src/sim/buildDps.balance.ts -t 技の大きさ（的の大きさで DPS がどれだけ変わるか・付いている効き方の分）
 *   npx vitest run --mode balance src/sim/buildDps.balance.ts -t 技の順（系統の中で、固有技が元の技より弱い逆転）
 */
it('技の大きさ', () => {
  const k = JSON.parse(readFileSync('docs/25_boss_kill.json', 'utf8')) as { rows: { allMoves: { move: string }[] }[] };
  const rules = buildSimRules('johto');
  const lo = playableLoadout(rules, 'mew');
  const base = rules.enemies.kinds.find((x) => x.rank === 'legendary')!;
  const noFx: SimRules = { ...rules, moves: rules.moves.map((m) => ({ ...m, effects: [] })) };
  const keys = [...new Set(k.rows.flatMap((r) => r.allMoves.map((m) => m.move)))];
  const out: unknown[] = [];
  for (const key of keys) {
    const def = rules.moves.find((m) => m.key === key);
    if (!def) continue;
    const mv = [{ move: key, level: def.levels.length }];
    const at = (r: SimRules, radius: number): number => Math.max(...BOSS_SCENES.map((sc) => measure(r, 'mew', [], lo, mv, [], sc, 0, { ...base, radius, types: [] })));
    const small = at(rules, 12);
    const mid = at(rules, 28);
    const big = at(rules, 46);
    const bigNoFx = at(noFx, 46);
    const smallNoFx = at(noFx, 12);
    out.push({ key, small, mid, big, bigNoFx, smallNoFx, pattern: def.pattern, effects: def.effects.map((e) => e.trigger) });
  }
  writeFileSync(process.env.SIZE_OUT ?? 'docs/26_move_size.json', JSON.stringify(out, null, 1) + '\n');
}, 7_200_000);

it('技の順', () => {
  const plans = JSON.parse(readFileSync('docs/25_boss_kill.json', 'utf8')) as { rows: { region: string; key: string; name: string; form: string; allMoves: { move: string; dps: number; items: string[] }[] }[] };
  const data = JSON.parse(readFileSync(LEARNSETS, 'utf8')) as { pokemon: Row[] };
  const out: unknown[] = [];
  for (const region of ['kanto', 'johto']) {
    const rows = plans.rows.filter((r) => r.region === region && (!ONLY || ONLY.includes(r.key)));
    if (!rows.length) continue;
    const rules = buildSimRules(region);
    for (const r of rows) {
      const row = data.pokemon.find((p) => p.region === region && p.key === r.key)!;
      const lo = playableLoadout(rules, r.key);
      const info = pathsOf(row, rules).get(r.form)!;
      const line = lineAt(rules, row, lo, info.path);
      const types = [...rules.species.find((s) => s.key === r.form)!.types];
      const moves = r.allMoves.map((m) => {
        const def = rules.moves.find((x) => x.key === m.move)!;
        const its = m.items.map((item) => ({ item, level: rules.items.find((i) => i.key === item)!.maxLevel }));
        const swarm = measure(rules, r.form, types, line, [{ move: m.move, level: def.levels.length }], its, 'swarm', 0);
        const boss = Math.max(...BOSS_SCENES.map((sc) => measure(rules, r.form, types, line, [{ move: m.move, level: def.levels.length }], its, sc, 0)));
        const d = row.derives.find((x) => x.to === m.move);
        const tier = d ? (d.unique ? 'unique' : 'derived') : 'base';
        return { move: m.move, tier, from: d?.from ?? null, boss, before: m.dps, swarm };
      });
      out.push({ region, key: r.key, form: r.form, moves });
    }
  }
  writeFileSync(process.env.ORDER_OUT ?? 'docs/26_move_order.json', JSON.stringify(out, null, 1) + '\n');
}, 7_200_000);

/**
 * 技に付いている効き方を 1 つずつ抜いて測る（リワークの案の見積もり）:
 *   FX_LIST=johto:larvitar:stone-edge,kanto:scyther:x-scissor npx vitest run --mode balance src/sim/buildDps.balance.ts -t 効き方の分解
 * その系統のボス向けの案のまま、技の effects を 1 つ抜いたときの、案の合計（ボス・群れ）を出す。
 */
it('効き方の分解', () => {
  const plans = JSON.parse(readFileSync('docs/24_build_dps.json', 'utf8')) as { results: { region: string; key: string; boss: Plan }[] };
  const data = JSON.parse(readFileSync(LEARNSETS, 'utf8')) as { pokemon: Row[] };
  const out: unknown[] = [];
  for (const spec of (process.env.FX_LIST ?? '').split(',').filter(Boolean)) {
    const [region, key, moveKey] = spec.split(':') as [string, string, string];
    const rules = buildSimRules(region);
    const r = plans.results.find((x) => x.region === region && x.key === key)!;
    const row = data.pokemon.find((p) => p.region === region && p.key === key)!;
    const lo = playableLoadout(rules, key);
    const line = lineAt(rules, row, lo, pathsOf(row, rules).get(r.boss.form)!.path);
    const types = [...rules.species.find((s) => s.key === r.boss.form)!.types];
    const moves = r.boss.moves.map((m) => ({ move: m.end, level: m.level }));
    const def = rules.moves.find((m) => m.key === moveKey)!;
    const run = (rr: SimRules, list = moves): { boss: number; swarm: number } => ({
      boss: Math.max(...BOSS_SCENES.map((sc) => measure(rr, r.boss.form, types, line, list, r.boss.items, sc, 0))),
      swarm: measure(rr, r.boss.form, types, line, list, r.boss.items, 'swarm', 0),
    });
    const withFx = (keep: (i: number) => boolean): SimRules => ({ ...rules, moves: rules.moves.map((m) => (m.key === moveKey ? { ...m, effects: m.effects.filter((_, i) => keep(i)) } : m)) });
    const solo = [{ move: moveKey, level: def.levels.length }];
    const variants: Record<string, { boss: number; swarm: number; soloBoss: number; soloSwarm: number }> = {};
    const add = (name: string, rr: SimRules): void => {
      const all = run(rr);
      const one = run(rr, solo);
      variants[name] = { boss: all.boss, swarm: all.swarm, soloBoss: one.boss, soloSwarm: one.swarm };
    };
    add('そのまま', rules);
    def.effects.forEach((e, i) => add('抜く ' + i + ' ' + e.trigger + ':' + Object.keys(e).filter((x) => x !== 'trigger' && x !== 'everySeconds').join('+'), withFx((j) => j !== i)));
    add('全部抜く', withFx(() => false));
    out.push({ spec, variants });
  }
  writeFileSync(process.env.FX_OUT ?? 'docs/26_move_fx.json', JSON.stringify(out, null, 1) + '\n');
}, 7_200_000);

/**
 * 案を作る前に、技の定義を変えて測る（作りの案の見積もり）:
 *   VARY_LINES=kanto:charmander,johto:houndour VARY_FILE=案.json npx vitest run --mode balance src/sim/buildDps.balance.ts -t 変えて測る
 * 案.json は [{ name, moves: { 技: { scale: { power: 0.6 }, set: { durationSeconds: 3 }, def: { lobTarget: 'nearest' } } } }]。
 * 系統のボス向けの案のまま、案の合計（ボス・群れ）と、持てる技ごとの単独（ボス・群れ）を出す。
 */
it('変えて測る', () => {
  type Vary = { name: string; moves: Record<string, { scale?: Record<string, number>; set?: Record<string, number>; def?: Record<string, unknown> }> };
  const variants = JSON.parse(readFileSync(process.env.VARY_FILE!, 'utf8')) as Vary[];
  const plans = JSON.parse(readFileSync('docs/24_build_dps.json', 'utf8')) as { results: { region: string; key: string; boss: Plan; swarm: Plan }[] };
  const kills = JSON.parse(readFileSync('docs/25_boss_kill.json', 'utf8')) as { rows: { region: string; key: string; allMoves: { move: string; items: string[] }[] }[] };
  const data = JSON.parse(readFileSync(LEARNSETS, 'utf8')) as { pokemon: Row[] };
  const out: unknown[] = [];
  for (const spec of (process.env.VARY_LINES ?? '').split(',').filter(Boolean)) {
    const [region, key] = spec.split(':') as [string, string];
    const rules = buildSimRules(region);
    const r = plans.results.find((x) => x.region === region && x.key === key)!;
    const k = kills.rows.find((x) => x.region === region && x.key === key)!;
    const row = data.pokemon.find((p) => p.region === region && p.key === key)!;
    const lo = playableLoadout(rules, key);
    const line = lineAt(rules, row, lo, pathsOf(row, rules).get(r.boss.form)!.path);
    const types = [...rules.species.find((s) => s.key === r.boss.form)!.types];
    const planMoves = r.boss.moves.map((m) => ({ move: m.end, level: m.level }));
    const touched = [...new Set([...variants.flatMap((v) => Object.keys(v.moves)), ...(process.env.VARY_SOLO?.split(",") ?? [])])];
    const res: Record<string, unknown> = {};
    for (const v of variants) {
      const rr: SimRules = {
        ...rules,
        moves: rules.moves.map((m) => {
          const c = v.moves[m.key];
          if (!c) return m;
          const levels = m.levels.map((s) => {
            const n = { ...s } as unknown as Record<string, number>;
            for (const [f, x] of Object.entries(c.scale ?? {})) n[f] = n[f]! * x;
            for (const [f, x] of Object.entries(c.set ?? {})) n[f] = x;
            return n as unknown as (typeof m.levels)[number];
          });
          return { ...m, ...(c.def ?? {}), levels } as typeof m;
        }),
      };
      const solo: Record<string, { boss: number; swarm: number }> = {};
      for (const a of k.allMoves) {
        if (!touched.includes(a.move)) continue;
        const def = rr.moves.find((m) => m.key === a.move)!;
        const its = a.items.map((item) => ({ item, level: rr.items.find((i) => i.key === item)!.maxLevel }));
        const mv = [{ move: a.move, level: def.levels.length }];
        solo[a.move] = { boss: Math.max(...BOSS_SCENES.map((sc) => measure(rr, r.boss.form, types, line, mv, its, sc, 0))), swarm: measure(rr, r.boss.form, types, line, mv, its, 'swarm', 0) };
      }
      res[v.name] = { boss: Math.max(...BOSS_SCENES.map((sc) => measure(rr, r.boss.form, types, line, planMoves, r.boss.items, sc, 0))), swarm: measure(rr, r.boss.form, types, line, r.swarm.moves.map((m) => ({ move: m.end, level: m.level })), r.swarm.items, 'swarm', 0), solo };
    }
    out.push({ spec, form: r.boss.form, plan: planMoves.map((m) => m.move), res });
  }
  writeFileSync(process.env.VARY_OUT ?? 'docs/26_move_vary.json', JSON.stringify(out, null, 1) + '\n');
}, 7_200_000);

/**
 * 測らずに見積もる（作者の依頼 2026年11月8日: ポケモンごとに、強い持ち物と技を持ったときのおおよそのボスへの強さを、毎回測らずに知りたい）:
 *   npm run build-estimate
 * 技ごとの表（docs/26_move_items.json。無い・変わった技だけ測る）に、持ち物の割合・種族値・タイプ一致・自分の強化の技を掛けて、
 * 系統ごとの全組み合わせの「ボス単独 DPS」を出し、伝説ごとの相性で HP を割って倒す秒数にする。docs/27_build_estimate.json に書く。
 * 見ていないもの: 技どうしの組み合わせ（防御を下げる・状態異常を付けてから強くなる技）、ボスの大きさ、避ける時間。
 * なので docs/25 の実測より速めに出る系統がある（ページに実測との比を出す）。
 */
it('見積もり', () => {
  const data = JSON.parse(readFileSync(LEARNSETS, 'utf8')) as { pokemon: Row[]; moves: Record<string, { name: string; type: string }>; items: Record<string, string> };
  const measured = existsSync('docs/25_boss_kill.json')
    ? (JSON.parse(readFileSync('docs/25_boss_kill.json', 'utf8')) as { rows: { region: string; key: string; form: string; total: number; build: { move: string }[]; real: Record<string, { seconds: number }> }[] }).rows
    : [];
  const TOP_BUILDS = Number(process.env.EST_TOP ?? 5);
  const out: { regions: Record<string, unknown> } = { regions: {} };
  // 地方は EST_REGIONS で選べる（既定は全部）。選ばなかった地方は前の結果を残す
  const regions = (process.env.EST_REGIONS ?? 'kanto,johto,hoenn').split(',');
  const outFile = process.env.EST_OUT ?? 'docs/27_build_estimate.json';
  if (existsSync(outFile)) Object.assign(out.regions, (JSON.parse(readFileSync(outFile, 'utf8')) as { regions: Record<string, unknown> }).regions);
  for (const region of regions) {
    const rs = data.pokemon.filter((p) => p.region === region && (!ONLY || ONLY.includes(p.key)));
    if (!rs.length) continue;
    const { rules, allOptions, ctx } = regionSetup(region, rs);
    const kinds = rules.enemies.kinds;
    const targets = targetsOf(region, rules);
    const kindTypes = (id: string): number[] => [...(kinds.find((k) => k.id === id)?.types ?? [])];
    const moveType = (k: string): number => ctx.moveByKey.get(k)!.type;
    const lines: unknown[] = [];
    const moveBest = new Map<string, { est: number; key: string; form: string; items: string[]; owners: number }>();
    for (const row of rs) {
      const all: (Candidate & { scene: SceneKey })[] = [];
      for (const scene of BOSS_SCENES) {
        const r = candidatesFor(ctx, row, allOptions.get(row.key)!, scene);
        for (const c of r.list) all.push({ ...c, scene });
        for (const s of r.solo) {
          const prev = moveBest.get(s.move);
          if (!prev || s.est > prev.est) moveBest.set(s.move, { est: s.est, key: row.key, form: s.form, items: s.items, owners: prev?.owners ?? 0 });
        }
      }
      for (const m of new Set(all.flatMap((c) => c.build.moves.map((x) => x.move)))) {
        const b = moveBest.get(m);
        if (b) b.owners++;
      }
      all.sort((a, b) => b.est - a.est);
      // 技の組が同じものは 1 つに（持ち物と立ち位置は一番伸びるもの）
      const seen = new Set<string>();
      const builds: unknown[] = [];
      for (const c of all) {
        const id = c.form + ':' + c.build.moves.map((m) => m.move).sort().join(',');
        if (seen.has(id)) continue;
        seen.add(id);
        const vs: Record<string, number> = {};
        for (const t of targets) {
          vs[t.id] = t.kinds.reduce((sum, kid, n) => {
            const dps = c.build.moves.reduce((s, m, i) => s + c.per[i]! * typeMultiplier(rules.types, rules.combat.typeMultipliers, moveType(m.move), [], kindTypes(kid)), 0);
            return sum + t.hp[n]! / Math.max(1, dps);
          }, 0);
        }
        const real = targets.filter((t) => t.real);
        builds.push({
          form: c.form,
          scene: c.scene,
          est: c.est,
          moves: c.build.moves.map((m, i) => ({ move: m.move, level: m.level, est: c.per[i] })),
          items: c.build.items.map((i) => i.item),
          vs,
          legendAvg: real.reduce((s, t) => s + vs[t.id]!, 0) / Math.max(1, real.length),
        });
        if (builds.length >= TOP_BUILDS) break;
      }
      const m = measured.find((x) => x.region === region && x.key === row.key);
      const realTs = targets.filter((t) => t.real);
      lines.push({
        key: row.key,
        name: row.forms.find((f) => f.key === row.key)?.name ?? row.key,
        builds,
        measured: m ? { form: m.form, total: m.total, moves: m.build.map((b) => b.move), legendAvg: realTs.every((t) => m.real?.[t.id]) ? realTs.reduce((s, t) => s + m.real[t.id]!.seconds, 0) / realTs.length : null } : null,
      });
    }
    out.regions[region] = {
      targets: targets.map((t) => ({ id: t.id, label: t.label, kinds: t.kinds, hp: t.hp.reduce((a, b) => a + b, 0), real: t.real })),
      lines,
      moves: [...moveBest].map(([move, b]) => ({ move, ...b })).sort((a, b) => b.est - a.est),
    };
  }
  // ページ用の名前（技・持ち物・ポケモン。伝説は種族の名前）
  const ja = (tbl: unknown, k: string): string | undefined => (tbl as Record<string, { names: { ja?: string } } | undefined>)[k]?.names.ja;
  const names: Record<string, string> = {};
  const kindNames: Record<string, string> = {};
  for (const region of Object.keys(out.regions)) {
    const reg = out.regions[region] as { targets: { kinds: string[] }[]; lines: { key: string; builds: { form: string; moves: { move: string }[]; items: string[] }[]; measured: { form: string; moves: string[] } | null }[]; moves: { move: string; form: string; items: string[] }[] };
    const add = (k: string): void => {
      names[k] ??= ja(generated.moves, k) ?? ja(generated.pokemon, k) ?? ja(generated.items, k) ?? k;
    };
    for (const l of reg.lines) {
      add(l.key);
      for (const b of l.builds) [b.form, ...b.moves.map((m) => m.move), ...b.items].forEach(add);
      if (l.measured) [l.measured.form, ...l.measured.moves].forEach(add);
    }
    for (const m of reg.moves) [m.move, m.form, ...m.items].forEach(add);
    const rules = buildSimRules(region);
    for (const t of reg.targets)
      for (const id of t.kinds) {
        const sp = rules.enemies.kinds.find((k) => k.id === id)?.species;
        kindNames[id] = (sp && ja(generated.pokemon, sp)) ?? id;
      }
  }
  writeFileSync(outFile, JSON.stringify({ level: LEVEL, ...out, names, kindNames }, null, 1) + '\n');
}, 7_200_000);
