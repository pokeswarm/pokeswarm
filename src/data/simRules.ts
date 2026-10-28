import type { Locale } from '../i18n';
import type { ModifierData } from './schema';
import { buildTypeChart, resolveMoveLevels, type SimMoveDef } from '../sim/moves';
import { addModifiers, buildXpTable, emptyModifiers, resolveModifiers, type Modifiers, type SimUpgradeDef } from '../sim/upgrades';
import type { SimEvolution, SimSpecies } from '../sim/species';
import type { SimLineRule, SimRules } from '../sim/rules';
import {
  combatConfig,
  derivationsConfig,
  enemiesConfig,
  generated,
  itemsConfig,
  networkConfig,
  playerConfig,
  levelingConfig,
  moveBalanceConfig,
  movesConfig,
  pickupConfig,
  playablesConfig,
  playerSpriteKeys,
  shopConfig,
  statsConfig,
  statusConfig,
  regionStage,
  weatherConfig,
} from './index';
import type { LocalizedNames } from './schema';

/**
 * data/ の定義と PokeAPI から生成したデータを組み合わせて、シミュレーションが使う定義一式を作る。
 * 技・タイプは番号（並び順）で指すので、その対応もここで作る。
 * region は遊ぶ地方（区間・ボス・障害物は data/regions/<地方>.json）。省くとカントー
 */
export function buildSimRules(region?: string): SimRules {
  const rs = regionStage(region);
  const types = buildTypeChart(generated.types);
  const typeIndex = (key: string): number => {
    const i = types.names.indexOf(key);
    if (i === -1) throw new Error(`タイプ ${key} がありません`);
    return i;
  };
  const statusIndexOf = (id: string): number => statusConfig.kinds.findIndex((k) => k.id === id);
  const moves: SimMoveDef[] = Object.entries(movesConfig.moves).map(([key, def]) => {
    const g = generated.moves[key]!;
    return {
      key,
      pattern: def.pattern,
      type: typeIndex(g.type),
      // 原作で変化技（status）のものは、特殊の威力を使う
      damageClass: g.damageClass === 'physical' ? 'physical' : 'special',
      levels: resolveMoveLevels(def, statusIndexOf),
      effect: def.effect,
      body: def.body ?? null,
      eruption: def.eruption ?? null,
      effects: def.effects ?? [],
      curve: ((def.curve ?? 0) * Math.PI) / 180,
      sweep: def.sweep ?? 0,
      bounceAngle: ((def.bounceAngle ?? 0) * Math.PI) / 180,
      randomStatuses: (def.randomStatuses ?? []).map(statusIndexOf),
      // 選ぶ技の集まりは、全部の技が並んでから番号に直す（下）
      randomPool: [] as number[],
      // ものまね（最初の技から選ぶ）は自分のレベルの割合で、ゆびをふる（固有技から選ぶ）は最大レベルで出す
      randomScaled: def.randomPool === 'starting' || def.randomPool === 'common',
      chainHopSeconds: def.chainHopSeconds ?? 0,
      chainMinHop: def.chainMinHop ?? 0,
      learners: def.learners ?? null,
      waitForEnd: def.waitForEnd,
      ...(def.hpCost ? { hpCost: def.hpCost } : {}),
      ...(def.allyHealPct ? { allyHealPct: def.allyHealPct } : {}),
      rangeBonusScale: def.rangeBonusScale ?? 1,
      ...(def.countWidens ? { countWidens: def.countWidens } : {}),
      ...(def.crossRandom ? { crossRandom: true } : {}),
      ...(def.sideways ? { sideways: true } : {}),
      ...(def.perishHits ? { perishHits: def.perishHits } : {}),
      ...(def.followFacing ? { followFacing: def.followFacing } : {}),
      ...(def.coinGain ? { coinGain: def.coinGain } : {}),
      ...(def.healZone ? { healZone: true } : {}),
      ...(def.growOnHit ? { growOnHit: def.growOnHit } : {}),
      ...(def.rainBoost ? { rainBoost: { type: typeIndex(def.rainBoost.type), pct: def.rainBoost.pct } } : {}),
      ...(def.delayedBlast ? { delayedBlast: def.delayedBlast } : {}),
      ...(def.lobTarget ? { lobTarget: def.lobTarget } : {}),
      ...(def.scatterJitter ? { scatterJitter: def.scatterJitter } : {}),
      ...(def.scatterDelaySeconds ? { scatterDelaySeconds: def.scatterDelaySeconds } : {}),
      sweepOnce: def.sweepOnce,
      teachOnly: def.teachOnly,
      aimStrongest: def.aimStrongest,
      aimFacing: def.aimFacing,
      chainRadial: def.chainRadial,
      frontBox: def.frontBox,
      ...(def.group ? { group: def.group } : {}),
      randomAim: def.randomAim,
      ...(def.barrageWidth ? { barrageWidth: def.barrageWidth, barrageWidthPerLevel: def.barrageWidthPerLevel ?? 0 } : {}),
      restAfterEnd: def.restAfterEnd,
      ...(def.snake ? { snake: def.snake } : {}),
      // いつも効く技: レベルごとの効果を、そのレベルまでの合計にしておく
      passive: (def.passive ?? []).reduce<Modifiers[]>((acc, mods) => {
        const sum = emptyModifiers(types.names.length);
        if (acc.length > 0) addModifiers(sum, acc[acc.length - 1]!, 1);
        addModifiers(sum, resolveModifiers(mods, types.names), 1);
        return [...acc, sum];
      }, []),
    };
  });
  const moveIndex = (key: string): number => moves.findIndex((m) => m.key === key);
  // ものまね: 遊べるポケモンの最初の技、ゆびをふる: 固有技（自分たち ランダムな技 は除く）
  const startingKeys = [...new Set(Object.values(playablesConfig.pokemon).flatMap((p) => p.startingMoves))];
  const uniqueKeys = derivationsConfig.unique.map((d) => d.to);
  // ふつうの技と派生技（固有技・伝説の技は固有技の一覧にある。持ち物で覚えるだけの技も除く）
  const commonKeys = Object.keys(movesConfig.moves).filter((k) => !uniqueKeys.includes(k) && !movesConfig.moves[k]!.teachOnly);
  moves.forEach((m, k) => {
    const pool = movesConfig.moves[m.key]?.randomPool;
    if (!pool) return;
    const keys = pool === 'starting' ? startingKeys : pool === 'common' ? commonKeys : uniqueKeys;
    moves[k] = { ...m, randomPool: keys.map(moveIndex).filter((i) => i !== -1 && moves[i]!.pattern !== 'metronome') };
  });
  // ためている間に出す技（きあいパンチのマッハパンチ）
  moves.forEach((m, k) => {
    const cm = movesConfig.moves[m.key]?.chargeMove;
    if (cm) moves[k] = { ...m, chargeMove: { move: moveIndex(cm.move), pauseSeconds: cm.pauseSeconds } };
  });
  const upgrades = (
    defs: Record<string, { category: "stat" | "type" | "evolution"; maxLevel: number; consumable: boolean; perLevel: Parameters<typeof resolveModifiers>[0]; lines?: string[]; powerMultiplier?: number; onlyWhenEvolves?: boolean }>,
  ): SimUpgradeDef[] =>
    Object.entries(defs).map(([key, d]) => ({
      key,
      category: d.category,
      maxLevel: d.maxLevel,
      consumable: d.consumable,
      perLevel: resolveModifiers(d.perLevel, types.names),
      ...(d.lines ? { lines: d.lines } : {}),
      ...(d.powerMultiplier ? { powerMultiplier: d.powerMultiplier } : {}),
      ...(d.onlyWhenEvolves ? { onlyWhenEvolves: true } : {}),
    }));
  const items = upgrades(itemsConfig.items);
  // 今の姿だけ・一緒に持てない（番号に直す。持ち物の番号は上で決まる）
  items.forEach((it, k) => {
    const d = itemsConfig.items[it.key]!;
    const speciesKeys = Object.keys(generated.pokemon);
    items[k] = {
      ...it,
      ...(d.forms ? { forms: d.forms.map((f) => speciesKeys.indexOf(f)) } : {}),
      ...(d.excludes ? { excludes: d.excludes.map((x) => items.findIndex((i) => i.key === x)) } : {}),
    };
  });
  const itemIndex = (key: string): number => items.findIndex((i) => i.key === key);
  const derivations = [
    ...derivationsConfig.derivations.map((d) => ({ from: moveIndex(d.from), item: itemIndex(d.item), to: moveIndex(d.to), line: null })),
    ...derivationsConfig.unique.map((d) => ({ from: moveIndex(d.from), item: d.item ? itemIndex(d.item) : -1, to: moveIndex(d.to), line: d.line, ...(d.minLevel ? { minLevel: d.minLevel } : {}), ...(d.forms ? { forms: d.forms.map((f) => Object.keys(generated.pokemon).indexOf(f)) } : {}), ...(d.withMoves ? { withMoves: d.withMoves.map(moveIndex) } : {}), ...(d.consumes ? { consumes: d.consumes.map(moveIndex) } : {}), ...(d.inheritLevels ? { inheritLevels: true } : {}), ...(d.levelCap ? { levelCap: d.levelCap } : {}), ...(moveBalanceConfig.tierOverrides[d.to] === 'derived' ? { derivedTier: true } : {}) })),
  ];
  const itemMoves = Object.entries(playablesConfig.pokemon).flatMap(([line, p]) => p.itemMoves.map((im) => ({ line, item: itemIndex(im.item), move: moveIndex(im.move) })));
  // ポケモンの種類: PokeAPI から生成したすべて。進化先・進化の道具・進化先のプレイヤーのドット絵が無いものは進化の一覧から外す
  const speciesKeys = Object.keys(generated.pokemon);
  const linkingCord = itemIndex('linking-cord');
  const species: SimSpecies[] = speciesKeys.map((key) => {
    const g = generated.pokemon[key]!;
    const evolutions: SimEvolution[] = [];
    // 進化しない遊べるポケモン
    if (playablesConfig.pokemon[key]?.evolves === false) return { key, types: g.types.map(typeIndex), baseStats: g.baseStats, evolutions };
    for (const e of g.evolvesTo) {
      const to = speciesKeys.indexOf(e.to);
      if (to === -1 || !playerSpriteKeys.has(e.to)) continue;
      if (e.trigger === 'level' && e.level) evolutions.push({ to, trigger: 'level', level: e.level });
      else if (e.trigger === 'item' && e.item && itemIndex(e.item) !== -1) evolutions.push({ to, trigger: 'item', item: itemIndex(e.item) });
      else if (e.trigger === 'trade' && linkingCord !== -1) evolutions.push({ to, trigger: 'trade', item: linkingCord });
      else if (e.trigger === 'friendship') evolutions.push({ to, trigger: 'friendship', ...(e.time && { time: e.time }) });
    }
    return { key, types: g.types.map(typeIndex), baseStats: g.baseStats, evolutions };
  });
  // 遊べるポケモンのタイプの指定（プリン: ノーマルだけ）。進化した姿にも当てはめる
  for (const [key, pl] of Object.entries(playablesConfig.pokemon)) {
    if (!pl.types) continue;
    const forced = pl.types.map(typeIndex);
    const stack = [key];
    while (stack.length) {
      const k = stack.pop()!;
      const s = species.find((x) => x.key === k);
      if (!s) continue;
      species[species.indexOf(s)] = { ...s, types: forced };
      for (const e of generated.pokemon[k]?.evolvesTo ?? []) stack.push(e.to);
    }
  }
  // 系統ごとの決まり（ベイビィポケモンの進化で変わる決まり。07 の66.4）
  const formIndex = (k: string): number => speciesKeys.indexOf(k);
  const lines: Record<string, SimLineRule> = {};
  for (const [key, pl] of Object.entries(playablesConfig.pokemon)) {
    if (pl.hatch) continue;
    lines[key] = {
      fixedMoves: pl.fixedMoves,
      types: pl.types ? pl.types.map(typeIndex) : null,
      moveTypes: pl.allMoveTypes ? types.names.map((_, i) => i) : (pl.moveTypes ?? []).map(typeIndex),
      startingMoves: pl.startingMoves.map(moveIndex),
      formMoves: pl.formMoves.map((f) => ({ form: formIndex(f.form), move: moveIndex(f.move), ...(f.maxLevel && { maxLevel: f.maxLevel }) })),
      formTransforms: pl.formTransforms.map((f) => ({ form: formIndex(f.form), from: f.from.map(moveIndex), to: moveIndex(f.to) })),
      becomes: pl.becomes.map((b) => ({ form: formIndex(b.form), line: b.line })),
      fixedForms: pl.fixedForms.map(formIndex),
      excludeMoveTypes: pl.excludeMoveTypes.map(typeIndex),
      hpCost: pl.formHpCost ? { forms: pl.formHpCost.forms.map(formIndex), move: moveIndex(pl.formHpCost.move), pct: pl.formHpCost.pct, minHpPct: pl.formHpCost.minHpPct } : null,
      cry: pl.cry ? { forms: pl.cry.forms.map(formIndex), everyDistance: pl.cry.everyDistance, seconds: pl.cry.seconds } : null,
    };
  }
  return {
    enemies: { kinds: enemiesConfig.kinds.map((k) => ({ ...k, types: generated.pokemon[k.species ?? k.id]!.types.map(typeIndex) })) },
    spawn: rs.spawn,
    status: statusConfig,
    pickups: pickupConfig,
    combat: combatConfig,
    moves,
    types,
    leveling: { ...levelingConfig, xpToNext: buildXpTable(levelingConfig) },
    items,
    derivations,
    itemMoves,
    species,
    stats: statsConfig,
    stage: rs.stage,
    obstacles: rs.obstacles,
    netSmoothing: networkConfig.smoothing,
    friendshipDistance: playerConfig.friendshipDistance,
    nightSections: rs.night,
    ...(rs.weather.some((w) => w.kinds.length > 0)
      ? { weatherSections: rs.weather.map((w) => ({ kinds: w.kinds, fields: w.kinds.map((k) => weatherConfig.weathers[k]!), everySeconds: w.everySeconds })) }
      : {}),
    lines,
  };
}

export function moveIndexOf(rules: SimRules, key: string): number {
  const i = rules.moves.findIndex((m) => m.key === key);
  if (i === -1) throw new Error(`技 ${key} がありません`);
  return i;
}

/** プレイアブルのポケモンの、シミュレーションでの初期値（タイプと最初の技） */
export function playableLoadout(
  rules: SimRules,
  pokemon: string,
): { types: number[]; moves: { move: number; level: number }[]; line: string; species: number; moveTypes: number[]; fixedMoves: boolean; learnsAll: boolean } {
  const p = playablesConfig.pokemon[pokemon] ?? playablesConfig.pokemon[playablesConfig.default]!;
  const species = generated.pokemon[pokemon] ?? generated.pokemon[playablesConfig.default]!;
  return {
    types: (p.types ?? species.types).map((t) => rules.types.names.indexOf(t)),
    moveTypes: p.allMoveTypes ? rules.types.names.map((_, i) => i) : (p.moveTypes ?? []).map((t) => rules.types.names.indexOf(t)),
    fixedMoves: p.fixedMoves,
    learnsAll: p.allMoveTypes,
    moves: p.startingMoves.map((m) => ({ move: moveIndexOf(rules, m), level: 1 })),
    // 系統はプレイアブルのキー（固有技の判定。進化しても変わらない）
    line: playablesConfig.pokemon[pokemon] ? pokemon : playablesConfig.default,
    species: rules.species.findIndex((s) => s.key === (playablesConfig.pokemon[pokemon] ? pokemon : playablesConfig.default)),
  };
}

/** 永続強化のレベルから、プレイヤーに足す効果を作る（ショップの perLevel × レベル）。何も無ければ null */
export function permanentModifiers(rules: SimRules, levels: Readonly<Record<string, number>>): Modifiers | null {
  let out: Modifiers | null = null;
  for (const def of shopConfig.upgrades) {
    const level = Math.min(levels[def.id] ?? 0, def.maxLevel);
    if (!def.perLevel || level <= 0) continue;
    out ??= emptyModifiers(rules.types.names.length);
    addModifiers(out, resolveModifiers(def.perLevel, rules.types.names), level);
  }
  return out;
}

/** 永続の効果に、持ち物と同じ形の効果（実績のバフなど）を足す。どちらも無ければ null */
export function mergeModifiers(rules: SimRules, base: Modifiers | null, extra: ModifierData): Modifiers | null {
  const hasExtra = Object.values(extra).some((v) => typeof v === 'number' ? v !== 0 : v && Object.keys(v).length > 0);
  if (!hasExtra) return base;
  const out = base ?? emptyModifiers(rules.types.names.length);
  addModifiers(out, resolveModifiers(extra, rules.types.names), 1);
  return out;
}

/** PokeAPI 由来の名前を、今の言語で取り出す */
export function localName(names: LocalizedNames | undefined, locale: Locale, fallback: string): string {
  return names ? (names[locale] ?? names.en) : fallback;
}
