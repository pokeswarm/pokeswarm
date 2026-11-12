import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { achievementsConfig } from '../data';
import { buildSimRules, playableLoadout } from '../data/simRules';
import { achievementPerks } from '../meta/achievementPerks';
import { Simulation } from './simulation';
import { answerEvolution, checkEvolution } from './systems/evolution';
import { applyOffer, makeOffers, moveMaxLevel, recomputeModifiers } from './systems/leveling';
type UpgradeOffer = ReturnType<typeof makeOffers>[number];

/**
 * ビルド案が本当に作れるかを、ゲームの候補の出し方（makeOffers）と取り方（applyOffer）だけを使って確かめる（作者の依頼 2026年11月6日）。
 *   BUILD_IN=案の json npx vitest run --mode balance src/sim/buildVerify.balance.ts
 *
 * ランのレベルを 1 から 100 まで上げながら、欲しいものが候補に出たら取る（同じレベルで何度も引き直す）。最後に、姿・技とレベル・持ち物とレベルが案と同じかを見る。
 */
type Plan = {
  form: string;
  moves: { end: string; root: string; chain: string[]; items: string[]; consumes: string[]; level: number }[];
  items: { item: string; level: number }[];
  evolveItems: string[];
};
const IN = process.env.BUILD_IN ?? 'docs/24_build_dps.json';
const DRAWS = 40;

function verify(region: string, key: string, plan: Plan): string[] {
  const rules = buildSimRules(region);
  const obtainable = achievementPerks(achievementsConfig, achievementsConfig.achievements.filter((a) => a.region === region).map((a) => a.id), region).items;
  const unlockedItems = new Set([...obtainable].map((k) => rules.items.findIndex((i) => i.key === k)));
  const lo = playableLoadout(rules, key);
  const sim = new Simulation({ tickRate: 30, seed: 5, rules });
  const w = sim.world;
  const p = sim.addPlayer({ id: 1, x: 0, y: 0, radius: 12, moveSpeed: 0, types: lo.types, species: lo.species, moves: lo.moves, line: lo.line, moveTypes: lo.moveTypes, fixedMoves: lo.fixedMoves, learnsAll: lo.learnsAll, unlockedItems });
  (p as { walked: number }).walked = 1e9;
  const mv = (k: string): number => rules.moves.findIndex((m) => m.key === k);
  const it = (k: string): number => rules.items.findIndex((i) => i.key === k);
  const targetForm = rules.species.findIndex((s) => s.key === plan.form);
  // 夜の区間（ブラッキー）。エーフィなら昼
  const nights = (rules as { nightSections?: readonly boolean[] }).nightSections ?? [];
  const wantsNight = plan.form === 'umbreon';
  const setSection = (): void => {
    const i = nights.findIndex((n) => n === wantsNight);
    if (i >= 0) (w as { section: number }).section = i;
  };
  const inChain = new Set(plan.moves.flatMap((m) => m.chain).map(mv));
  const consumed = new Set(plan.moves.flatMap((m) => m.consumes).map(mv));
  const finalMoves = new Set(plan.moves.map((m) => mv(m.end)));
  const wantedItems = new Map(plan.items.map((i) => [it(i.item), i.level]));
  const materials = new Set(plan.moves.flatMap((m) => m.items).map(it));
  const edges = new Set(plan.moves.flatMap((m) => m.chain.slice(1).map((to, i) => mv(m.chain[i]!) + '>' + mv(to))));
  const planConsumes = (to: number): number[] => plan.moves.filter((m) => m.chain.map(mv).includes(to)).flatMap((m) => m.consumes.map(mv)).filter((c) => rules.derivations.some((d) => d.to === to && d.consumes?.includes(c)));
  const held = (m: number): boolean => p.moves.some((x) => x.move === m);
  /** 案で消費しない技なのに、まだ起きていない派生に消費されてしまう技は、その派生の後で覚える */
  const eatenLater = (m: number): boolean => rules.derivations.some((d) => inChain.has(d.to) && !held(d.to) && !p.consumedMoves?.includes(d.to) && d.consumes?.includes(m) && !planConsumes(d.to).includes(m) && plan.moves.some((x) => x.chain.map(mv).includes(d.to) && x.chain.map(mv).includes(d.from)));
  const score = (o: UpgradeOffer): number => {
    switch (o.kind) {
      case 'derive': {
        const from = p.moves[o.slot]!.move;
        if (!edges.has(from + '>' + o.to)) return -1;
        // 受け継ぐ技（ばくれつパンチ・とっておき）: 消費する技を最大まで上げてから
        const ready = planConsumes(o.to).every((c) => {
          const x = p.moves.find((y) => y.move === c);
          return (x && x.level >= moveMaxLevel(rules, x)) || !consumedOrAlive(c);
        });
        return ready ? 100 : -1;
      }
      case 'moveNew': {
        // 消費する技と、消費する系列を先に
        if (consumed.has(o.move)) return 90;
        if (eatenLater(o.move)) return -1;
        if (inChain.has(o.move)) return 60;
        return -1;
      }
      case 'moveUp': {
        const m = p.moves[o.slot]!.move;
        return inChain.has(m) || consumed.has(m) ? 80 : -1;
      }
      case 'itemNew': {
        const def = rules.items[o.item]!;
        // 持つと技を覚える石（ワンリキー）のように、最後まで残すものは材料と同じ
        if (def.consumable && !wantedItems.has(o.item)) {
          // 進化の道具: 次の姿へ行くときだけ。派生の材料: 元の技が最大のときだけ
          const evolves = rules.species[p.species]?.evolutions.some((e) => (e.trigger === 'item' || e.trigger === 'trade') && e.item === o.item && reaches(e.to));
          const derive = rules.derivations.some((d) => (d.line === null || d.line === p.line) && d.item === o.item && edges.has(d.from + '>' + d.to) && !held(d.to) && p.moves.some((m) => m.move === d.from && m.level >= moveMaxLevel(rules, m)));
          if (derive) return 70;
          return evolves ? 5 : -1;
        }
        const taught = (rules.itemMoves ?? []).some((im) => im.line === p.line && im.item === o.item && (consumed.has(im.move) || inChain.has(im.move)));
        if (taught) return 55;
        if (materials.has(o.item)) {
          const pending = plan.evolveItems.filter((k) => rules.items[it(k)]?.consumable && rules.species[p.species]?.evolutions.some((e) => (e as { item?: number }).item === it(k))).length;
          return p.items.length + pending < rules.leveling.maxItemSlots ? 50 : -1;
        }
        // 残りの枠を埋めるのは、進化の道具を取り終えて技がそろってから
        const movesDone = finalMoves.size === p.moves.length && p.moves.every((m) => finalMoves.has(m.move) && m.level >= moveMaxLevel(rules, m));
        return wantedItems.has(o.item) && movesDone && p.species === targetForm ? 20 : -1;
      }
      case 'itemUp': {
        const want = wantedItems.get(p.items[o.slot]!.item);
        return want !== undefined && p.items[o.slot]!.level < want ? 30 : -1;
      }
      default:
        return -1;
    }
  };
  /** 案で消費する技のうち、もう持てないもの（覚えられない）は待たない */
  const consumedOrAlive = (c: number): boolean => !p.consumedMoves?.includes(c);
  const reaches = (species: number, seen = new Set<number>()): boolean => {
    if (species === targetForm) return true;
    if (seen.has(species)) return false;
    seen.add(species);
    return (rules.species[species]?.evolutions ?? []).some((e) => reaches(e.to, seen));
  };
  for (let level = 1; level <= 100; level++) {
    (w as { level: number }).level = level;
    setSection();
    (p as { walked: number }).walked = 0;
    for (let picks = 0; picks < 400; picks++) {
      let best: UpgradeOffer | null = null;
      let bestScore = 0;
      for (let d = 0; d < DRAWS; d++) {
        for (const o of makeOffers(w, p)) {
          const v = score(o);
          if (v > bestScore) {
            best = o;
            bestScore = v;
          }
        }
      }
      if (!best) break;
      applyOffer(w, p, best);
      if (p.evolveAsk !== undefined) answerEvolution(w, p, reaches(p.evolveAsk));
    }
    (p as { walked: number }).walked = 1e9;
    for (let guard = 0; guard < 6; guard++) {
      checkEvolution(w, p);
      if (p.evolveAsk !== undefined) answerEvolution(w, p, reaches(p.evolveAsk));
    }
  }
  recomputeModifiers(w, p);
  const problems: string[] = [];
  if (p.species !== targetForm) problems.push(`姿 ${rules.species[p.species]?.key} ≠ ${plan.form}`);
  const name = (i: number): string => rules.moves[i]?.key ?? '?';
  for (const m of plan.moves) {
    const got = p.moves.find((x) => x.move === mv(m.end));
    if (!got) problems.push(`技が無い ${m.end}`);
    else if (got.level !== m.level) problems.push(`${m.end} Lv${got.level} ≠ ${m.level}`);
  }
  for (const x of p.moves) if (!finalMoves.has(x.move)) problems.push(`余分な技 ${name(x.move)}`);
  for (const i of plan.items) {
    const got = p.items.find((x) => x.item === it(i.item));
    if (!got) problems.push(`持ち物が無い ${i.item}`);
    else if (got.level !== i.level) problems.push(`${i.item} Lv${got.level} ≠ ${i.level}`);
  }
  for (const x of p.items) if (!wantedItems.has(x.item)) problems.push(`余分な持ち物 ${rules.items[x.item]?.key}`);
  return problems;
}

it('ビルド案が作れるか', () => {
  const data = JSON.parse(readFileSync(IN, 'utf8')) as { results: { region: string; key: string; boss: Plan | null; swarm: Plan | null }[] };
  const out: string[] = [];
  let bad = 0;
  for (const r of data.results) {
    for (const kind of ['boss', 'swarm'] as const) {
      const plan = r[kind];
      if (!plan) continue;
      const problems = verify(r.region, r.key, plan);
      if (problems.length) bad++;
      out.push(`${problems.length ? 'NG' : 'ok'} ${r.region} ${r.key} ${kind} ${plan.form}: ${problems.join(' / ')}`);
    }
  }
  writeFileSync(process.env.VERIFY_OUT ?? 'docs/24_build_verify.txt', out.join('\n') + `\n作れない案 ${bad} 個\n`);
}, 3_600_000);
