import type { z } from 'zod';
import simulationJson from '../../data/game/simulation.json';
import playerJson from '../../data/game/player.json';
import placeholderJson from '../../data/render/placeholder.json';
import uiJson from '../../data/render/ui.json';
import groundJson from '../../data/render/ground.json';
import itemSpritesJson from '../../data/render/items.json';
import obstacleSpritesJson from '../../data/render/obstacles.json';
import obstaclesJson from '../../data/game/obstacles.json';
import iconsJson from '../../data/render/icons.json';
import itemIconsJson from '../../data/render/item-icons.json';
import moveSpritesJson from '../../data/render/move-sprites.json';
import moveBalanceJson from '../../data/game/move-balance.json';
import enemiesJson from '../../data/game/enemies.json';
import spawnJson from '../../data/game/spawn.json';
import combatJson from '../../data/game/combat.json';
import movesJson from '../../data/game/moves.json';
import playablesJson from '../../data/game/playables.json';
import regionsJson from '../../data/game/regions.json';
import siteJson from '../../data/site.json';
import levelingJson from '../../data/game/leveling.json';
import itemsJson from '../../data/game/items.json';
import derivationsJson from '../../data/game/derivations.json';
import statsJson from '../../data/game/stats.json';
import stageJson from '../../data/game/stage.json';
import saveJson from '../../data/game/save.json';
import achievementsJson from '../../data/game/achievements.json';
import shopJson from '../../data/game/shop.json';
import ja from '../i18n/ja.json';
import en from '../i18n/en.json';
import spriteRenderJson from '../../data/render/sprites.json';
import networkJson from '../../data/game/network.json';
import statusJson from '../../data/game/status.json';
import pickupsJson from '../../data/game/pickups.json';
import effectRecipesJson from '../../data/effects/recipes.json';
import sfxJson from '../../data/audio/sfx.json';
import bgmJson from '../../data/audio/bgm.json';
import weatherJson from '../../data/game/weather.json';
import generatedPokemonJson from '../../data/generated/pokemon.json';
import spritePokemonJson from '../../data/sprites/pokemon.json';
import generatedMovesJson from '../../data/generated/moves.json';
import generatedItemsJson from '../../data/generated/items.json';
import generatedTypesJson from '../../data/generated/types.json';
import generatedRegionsJson from '../../data/generated/regions.json';
import type { BgmRun, GroundConfig, ObstacleConfig, SpawnConfig, StageConfig, UnlocksConfig } from './schema';
import { resolveEffectRecipes } from './effects';
import {
  combatConfigSchema,
  derivationsConfigSchema,
  itemsConfigSchema,
  levelingConfigSchema,
  enemiesConfigSchema,
  generatedItemsSchema,
  generatedMovesSchema,
  generatedPokemonSchema,
  generatedRegionsSchema,
  regionsConfigSchema,
  regionStageSchema,
  siteConfigSchema,
  generatedTypesSchema,
  groundConfigSchema,
  movesConfigSchema,
  networkConfigSchema,
  pickupConfigSchema,
  placeholderRenderSchema,
  uiConfigSchema,
  playablesConfigSchema,
  playerConfigSchema,
  simulationConfigSchema,
  spawnConfigSchema,
  spriteRenderSchema,
  stageConfigSchema,
  weatherConfigSchema,
  saveConfigSchema,
  achievementsConfigSchema,
  shopConfigSchema,
  statsConfigSchema,
  statusConfigSchema,
  sfxConfigSchema,
  bgmConfigSchema,
  musicScoreSchema,
  pixelSpritesSchema,
  obstacleConfigSchema,
  iconConfigSchema,
  itemIconsSchema,
  moveSpritesSchema,
  MOVE_PATTERNS,
  moveBalanceSchema,
  spritePokemonListSchema,
} from './schema';

function load<T extends z.ZodType>(name: string, schema: T, raw: unknown): z.infer<T> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error(`data/${name} の検証に失敗しました:\n${result.error.message}`);
  }
  return result.data;
}

export const simulationConfig = load('game/simulation.json', simulationConfigSchema, simulationJson);
export const playerConfig = load('game/player.json', playerConfigSchema, playerJson);
export const placeholderRender = load('render/placeholder.json', placeholderRenderSchema, placeholderJson);
export const uiConfig = load('render/ui.json', uiConfigSchema, uiJson);
/** 自作のドット絵（道具・アメの箱） */
export const itemSprites = load('render/items.json', pixelSpritesSchema, itemSpritesJson);
/** 障害物のドット絵（自作）と、置き方 */
export const obstacleSprites = load('render/obstacles.json', pixelSpritesSchema, obstacleSpritesJson);
/** 技・持ち物・パッシブのアイコン（自作のドット絵） */
export const iconConfig = load('render/icons.json', iconConfigSchema, iconsJson);
export const itemIcons = load('render/item-icons.json', itemIconsSchema, itemIconsJson);
/** 技のドット絵（自作。npm run move-sprites） */
export const moveSprites = load('render/move-sprites.json', moveSpritesSchema, moveSpritesJson);
/** 技の強さをそろえる目安（段階ごとの総合の強さ） */
export const moveBalanceConfig = load('game/move-balance.json', moveBalanceSchema, moveBalanceJson);
export const enemiesConfig = load('game/enemies.json', enemiesConfigSchema, enemiesJson);
export const combatConfig = load('game/combat.json', combatConfigSchema, combatJson);
export const movesConfig = load('game/moves.json', movesConfigSchema, movesJson);
export const playablesConfig = load('game/playables.json', playablesConfigSchema, playablesJson);
/** プレイヤーとして描ける（全動作のドット絵がある）ポケモン。これ以外へは進化しない（雑魚・ボス用だけのハガネールなど） */
export const playerSpriteKeys: ReadonlySet<string> = new Set(
  load('sprites/pokemon.json', spritePokemonListSchema, spritePokemonJson)
    .pokemon.filter((p) => p.uses.includes('full'))
    .map((p) => p.key),
);
export const siteConfig = load('site.json', siteConfigSchema, siteJson);
export const regionsConfig = load('game/regions.json', regionsConfigSchema, regionsJson);
export const levelingConfig = load('game/leveling.json', levelingConfigSchema, levelingJson);
export const itemsConfig = load('game/items.json', itemsConfigSchema, itemsJson);
export const derivationsConfig = load('game/derivations.json', derivationsConfigSchema, derivationsJson);
export const statsConfig = load('game/stats.json', statsConfigSchema, statsJson);

/**
 * 地方のステージ（data/regions/<地方>.json）を、地方に関わらない設定（spawn.json・stage.json・ground.json・obstacles.json）と
 * 合わせて、今までと同じ形にしたもの（02 の16章）。シミュレーションには buildSimRules(地方) で渡す
 */
export interface RegionStage {
  readonly id: string;
  readonly spawn: SpawnConfig;
  readonly stage: StageConfig;
  readonly ground: GroundConfig;
  readonly obstacles: ObstacleConfig;
  readonly bgmRun: BgmRun;
  /** 区間ごとの、夜か */
  readonly night: readonly boolean[];
  /** 区間ごとの天気（data/game/weather.json のキーの並び。巡らせる区間は everySeconds ごとに次へ。ふつうは空） */
  readonly weather: readonly SectionWeather[];
}
export interface SectionWeather {
  readonly kinds: readonly string[];
  /** 0 なら巡らせない */
  readonly everySeconds: number;
}
/** 地方の天気の定義（ホウエン。07 の89.2） */
export const weatherConfig = load('game/weather.json', weatherConfigSchema, weatherJson);
export const regionStages: Readonly<Record<string, RegionStage>> = Object.fromEntries(
  Object.entries(import.meta.glob('../../data/regions/*.json', { eager: true, import: 'default' })).map(([path, raw]) => {
    const id = path.replace(/^.*\/|\.json$/g, '');
    const name = `regions/${id}.json`;
    const file = load(name, regionStageSchema, raw);
    const stage: RegionStage = {
      id,
      spawn: load(`game/spawn.json と ${name}`, spawnConfigSchema, { ...spawnJson, waves: file.sections.map((x) => x.wave) }),
      stage: load(`game/stage.json と ${name}`, stageConfigSchema, {
        ...stageJson,
        durationSeconds: file.durationSeconds,
        bosses: file.bosses,
        swarms: file.swarms,
        // 伝説戦の無い地方は null（stage.json の legendary の決まり）
        legendary: file.legendary ?? null,
      }),
      ground: load(`render/ground.json と ${name}`, groundConfigSchema, { ...groundJson, waves: file.sections.map((x) => ({ tile: x.tile })) }),
      obstacles: load(`game/obstacles.json と ${name}`, obstacleConfigSchema, { ...obstaclesJson, sections: file.sections.map((x) => x.obstacles) }),
      bgmRun: { sections: file.sections.map((x) => x.bgm), legendary: file.legendaryBgm, intruder: file.intruderBgm },
      night: file.sections.map((x) => x.night),
      weather: file.sections.map((x) =>
        x.weatherCycle ? { kinds: x.weatherCycle.kinds, everySeconds: x.weatherCycle.everySeconds } : { kinds: x.weather ? [x.weather] : [], everySeconds: 0 },
      ),
    };
    return [id, stage];
  }),
);
if (!regionStages.kanto) throw new Error('data/regions/kanto.json がありません');
/** 地方のステージ。無い地方はカントー */
export function regionStage(id: string | undefined): RegionStage {
  return (id && regionStages[id]) || regionStages.kanto!;
}
/** カントーの組（タイトル画面の地面・テスト・自動プレイヤー。地方を選ばない所で使う） */
export const spawnConfig = regionStages.kanto.spawn;
export const stageConfig = regionStages.kanto.stage;
export const groundConfig = regionStages.kanto.ground;
export const obstacleConfig = regionStages.kanto.obstacles;
export const saveConfig = load('game/save.json', saveConfigSchema, saveJson);
export const achievementsConfig = load('game/achievements.json', achievementsConfigSchema, achievementsJson);
/** ポケモンの解放: 実績の reward.pokemon から作る（作者の決定で、解放は実績に統合した） */
export const unlocksConfig: UnlocksConfig = {
  initial: achievementsConfig.initialPokemon,
  unlocks: achievementsConfig.achievements.flatMap((a) => (a.reward?.pokemon ? [{ pokemon: a.reward.pokemon, condition: a.condition, region: a.region }] : [])),
};
/** 数え直す記録（クリアしたポケモンの種類・出した固有技の種類）のもと */
export const derivedStatSources = {
  playables: Object.keys(playablesConfig.pokemon).filter((k) => !playablesConfig.pokemon[k]!.hatch),
  uniqueMoves: [...new Set(derivationsConfig.unique.map((d) => d.to))],
};
export const shopConfig = load('game/shop.json', shopConfigSchema, shopJson);
export const statusConfig = load('game/status.json', statusConfigSchema, statusJson);
export const pickupConfig = load('game/pickups.json', pickupConfigSchema, pickupsJson);
export const spriteRender = load('render/sprites.json', spriteRenderSchema, spriteRenderJson);
export const effectRecipes = resolveEffectRecipes(effectRecipesJson);
export const networkConfig = load('game/network.json', networkConfigSchema, networkJson);
export const sfxConfig = load('audio/sfx.json', sfxConfigSchema, sfxJson);
export const bgmConfig = load('audio/bgm.json', bgmConfigSchema, bgmJson);
/** コードで鳴らす 8bit の曲（data/audio/music/<名前>.json） */
export const musicScores = Object.fromEntries(
  Object.entries(import.meta.glob('../../data/audio/music/*.json', { eager: true, import: 'default' })).map(([path, raw]) => {
    const name = path.replace(/^.*\/|\.json$/g, '');
    return [name, load(`audio/music/${name}.json`, musicScoreSchema, raw)];
  }),
);

/** PokeAPI から生成したデータ（npm run pokeapi） */
export const generated = {
  pokemon: load('generated/pokemon.json', generatedPokemonSchema, generatedPokemonJson),
  moves: load('generated/moves.json', generatedMovesSchema, generatedMovesJson),
  items: load('generated/items.json', generatedItemsSchema, generatedItemsJson),
  types: load('generated/types.json', generatedTypesSchema, generatedTypesJson),
  regions: load('generated/regions.json', generatedRegionsSchema, generatedRegionsJson),
};
// 原作の名前を借りる技（ベイビィ用の ゆびをふる は、ミュウの ゆびをふる と名前・タイプが同じ別の技。moves.json の nameOf）
for (const [key, def] of Object.entries(movesConfig.moves)) {
  if (def.nameOf && generated.moves[def.nameOf] && !generated.moves[key]) generated.moves[key] = generated.moves[def.nameOf]!;
}

// ---- ファイルをまたぐ参照の検証 ----
function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
}
check(regionsConfig.regions.some((r) => r.available && !r.unlock), 'data/game/regions.json に最初から遊べる地方（available: true で unlock なし）が1つも無いです');
for (const r of regionsConfig.regions) {
  if (!r.unlock) continue;
  for (const [lang, messages] of [['ja', ja], ['en', en]] as const) check(!!(messages as Record<string, string>)[`region.unlock.${r.id}`], `地方 "${r.id}" の解放の案内 region.unlock.${r.id} が src/i18n/${lang}.json にありません`);
}
for (const r of regionsConfig.regions) {
  check(!!generated.regions[r.id], `data/game/regions.json の地方 "${r.id}" が data/generated/regions.json にありません（data/pokeapi/targets.json の regions に足して npm run pokeapi）`);
  check(!r.available || r.playables.length > 0, `data/game/regions.json の地方 "${r.id}" は遊べるのに playables が空です`);
  for (const p of r.playables) check(!!playablesConfig.pokemon[p], `data/game/regions.json の地方 "${r.id}" のプレイアブル "${p}" が playables.json にありません`);
}
// アイコン: 技の出し方・持ち物・パッシブ・タイプごとに絵柄と色がある
for (const p of MOVE_PATTERNS) check(!!iconConfig.glyphs[iconConfig.moves[p] ?? ''], `data/render/icons.json に出し方 "${p}" の絵柄がありません`);
for (const [move, glyph] of Object.entries(iconConfig.moveGlyphs)) check(!!iconConfig.glyphs[glyph], `data/render/icons.json の技 "${move}" の絵柄 "${glyph}" がありません`);
for (const k of Object.keys(itemsConfig.items)) check(!!itemIcons.items[k], `data/render/item-icons.json に持ち物 "${k}" のアイコンがありません（npm run item-icons）`);
for (const k of Object.keys(movesConfig.moves)) check(!!iconConfig.typeColors[generated.moves[k]!.type], `data/render/icons.json にタイプ "${generated.moves[k]!.type}" の色がありません`);
check(obstaclesJson.margin * 2 < obstaclesJson.cellSize, 'data/game/obstacles.json の margin は cellSize の半分より小さくする');
check(!!itemSprites.candyBurst, 'data/render/items.json に candyBurst がありません');
// 道具のドット絵: マップの道具ごとと、アメの箱
for (const name of ['potion', 'magnet', 'rare-candy', 'candy-box', 'candy-box-open', 'buff', 'buff-box', 'buff-box-open']) {
  check(!!itemSprites.sprites[name], `data/render/items.json に "${name}" のドット絵がありません`);
}
// BGM: 曲はファイルか楽譜のどちらかを持つ。楽譜は data/audio/music にあるもの
for (const [id, track] of Object.entries(bgmConfig.tracks)) {
  check(!!track.file || !!track.score, `data/audio/bgm.json の曲 "${id}" は file か score を書いてください`);
  check(!track.score || !!musicScores[track.score], `data/audio/bgm.json の曲 "${id}" の楽譜 "${track.score}" が data/audio/music にありません`);
}
for (const id of [bgmConfig.scenes.title, bgmConfig.scenes.result]) {
  check(id === null || !!bgmConfig.tracks[id], `data/audio/bgm.json の曲 "${id}" が tracks にありません`);
}
for (const kind of enemiesConfig.kinds) {
  const species = kind.species ?? kind.id;
  check(!!generated.pokemon[species], `data/game/enemies.json の "${kind.id}" のポケモン "${species}" が data/generated/pokemon.json にありません（data/pokeapi/targets.json に足して npm run pokeapi）`);
}
const stageMoveIds = new Set(regionStages.kanto.stage.moves.map((m) => m.id));
for (const m of regionStages.kanto.stage.moves) {
  check(!m.move || !!generated.moves[m.move], `data/game/stage.json の範囲技 "${m.id}" の技 "${m.move}" が data/generated/moves.json にありません`);
  check(!!effectRecipes[m.effect], `data/game/stage.json の範囲技 "${m.id}" の effect "${m.effect}" のレシピがありません`);
  check(!m.playerMove || !!movesConfig.moves[m.playerMove.move], `data/game/stage.json の範囲技 "${m.id}" のプレイヤーと同じ技 "${m.playerMove?.move}" が data/game/moves.json にありません`);
  check(!m.then || stageMoveIds.has(m.then), `data/game/stage.json の範囲技 "${m.id}" の then "${m.then}" がありません`);
  check(m.shape !== 'line' || !!m.length, `data/game/stage.json の範囲技 "${m.id}" は直線なので length が必要です`);
}
// 地方のステージごと: 区間の雑魚・地面・曲・障害物・ボス・伝説・スウォーム（02 の16章）
for (const rs of Object.values(regionStages)) {
  const file = `data/regions/${rs.id}.json`;
  const { spawn: spawnConfig, stage: stageConfig } = rs;
  spawnConfig.waves.forEach((wave, i) => {
    for (const kind of wave.kinds) {
      const k = enemiesConfig.kinds.find((x) => x.id === kind);
      check(!!k, `${file} の区間 ${i + 1} の敵 "${kind}" が data/game/enemies.json にありません`);
      check((k?.rank ?? 'normal') === 'normal', `${file} の区間 ${i + 1} の "${kind}" は雑魚（rank: normal）ではありません`);
    }
    // 最後の区間以外は、中ボス（gate）か durationSeconds で次へ進めるようにする
    if (i < spawnConfig.waves.length - 1) {
      const gate = stageConfig.bosses.some((b) => b.wave === i && b.gate);
      check(gate !== !!wave.durationSeconds, `${file} の区間 ${i + 1} は、中ボス（bosses の gate）か durationSeconds のどちらか1つで次へ進めてください`);
    }
  });
  // 天気（ホウエン）: weather.json にあり、粒は天気のあるレシピ
  rs.weather.forEach((w, i) => {
    for (const id of w.kinds) {
      const def = weatherConfig.weathers[id];
      check(!!def, `${file} の区間 ${i + 1} の天気 "${id}" が data/game/weather.json にありません`);
      if (def?.weather) check(!!effectRecipes[def.weather]?.weather, `data/game/weather.json の "${id}" の粒 "${def.weather}" が、天気のあるレシピ（data/effects/recipes.json の weather）ではありません`);
    }
  });
  // タッグ（ホウエン）: 同じ区間に2体以上
  for (const b of stageConfig.bosses) {
    if (b.tag) check(stageConfig.bosses.filter((x) => x.tag && x.wave === b.wave).length >= 2, `${file} の "${b.kind}" は tag なのに、区間 ${b.wave + 1} に組の相手がいません`);
  }
  for (const kinds of rs.obstacles.sections) for (const k of kinds) check(!!obstacleSprites.sprites[k], `${file} の障害物 "${k}" のドット絵が data/render/obstacles.json にありません`);
  const roundBgm = [...(rs.stage.legendary?.rounds ?? []), ...(rs.stage.legendary?.bonusRounds ?? [])].flatMap((r) => (r.bgm ? [r.bgm] : []));
  for (const id of [...rs.bgmRun.sections, rs.bgmRun.legendary, rs.bgmRun.intruder, ...roundBgm]) check(id === null || !!bgmConfig.tracks[id], `${file} の曲 "${id}" が data/audio/bgm.json の tracks にありません`);
  for (const b of stageConfig.bosses) {
    const rank = enemiesConfig.kinds.find((k) => k.id === b.kind)?.rank;
    check(rank === 'midboss' || rank === 'boss', `${file} の "${b.kind}" が data/game/enemies.json に rank: "midboss" か "boss" でありません`);
    check(b.wave < spawnConfig.waves.length, `${file} の "${b.kind}" の wave ${b.wave} が ${file} の waves にありません`);
    check(!b.gate || b.wave < spawnConfig.waves.length - 1, `${file} の "${b.kind}" は最後の区間なので gate にできません`);
    for (const id of b.moves) check(stageMoveIds.has(id), `${file} の "${b.kind}" の範囲技 "${id}" がありません`);
  }
  if (stageConfig.legendary) {
    for (const id of stageConfig.legendary.kinds) {
      check(enemiesConfig.kinds.find((k) => k.id === id)?.rank === 'legendary', `${file} の伝説 "${id}" が data/game/enemies.json に rank: "legendary" でありません`);
    }
    for (const id of stageConfig.legendary.moves) check(stageMoveIds.has(id), `${file} の伝説の範囲技 "${id}" がありません`);
    // 相性で選ぶ候補（色違いの御三家）: 伝説の敵で、条件の実績があること
    const counter = stageConfig.legendary.counter;
    for (const id of counter?.kinds ?? []) {
      check(enemiesConfig.kinds.find((k) => k.id === id)?.rank === 'legendary', `${file} の伝説の相性で選ぶ候補 "${id}" が data/game/enemies.json に rank: "legendary" でありません`);
    }
    for (const id of counter?.achievements ?? []) {
      check(achievementsConfig.achievements.some((a) => a.id === id), `${file} の伝説の相性で選ぶ候補の条件の実績 "${id}" がありません`);
    }
    // 続けて戦うラウンド（レッド）・はねの戦い（ルギア・ホウオウ）・乱入（三犬）の相手も、伝説の敵であること
    const lg = stageConfig.legendary;
    const roundKinds = [...(lg.rounds ?? []).flatMap((r) => r.kinds), ...(lg.bonusRounds ?? []).flatMap((r) => r.kinds), ...(lg.intruders?.kinds ?? [])];
    for (const b of lg.bonusRounds ?? []) check(achievementsConfig.achievements.some((a) => a.id === b.achievement), `${file} のはね "${b.item}" の条件の実績 "${b.achievement}" がありません`);
    for (const id of roundKinds) {
      check(enemiesConfig.kinds.find((k) => k.id === id)?.rank === 'legendary', `${file} の伝説のラウンド・乱入の "${id}" が data/game/enemies.json に rank: "legendary" でありません`);
    }
    const legendaryKinds = [...stageConfig.legendary.kinds, ...(counter?.kinds ?? []), ...roundKinds];
    for (const [kind, set] of Object.entries(stageConfig.legendary.moveSets)) {
      check(legendaryKinds.includes(kind), `${file} の伝説ごとの技の "${kind}" が伝説の候補にありません`);
      // "*" は pool からランダム（ミュウ）
      for (const id of set.moves) check(stageMoveIds.has(id) || (id === '*' && (set.pool?.length ?? 0) > 0), `${file} の伝説 "${kind}" の範囲技 "${id}" がありません`);
      for (const id of set.pool ?? []) check(stageMoveIds.has(id), `${file} の伝説 "${kind}" の pool の範囲技 "${id}" がありません`);
      for (const c of [...(set.casters ?? []), ...(set.shell?.moves ?? [])]) check(!!movesConfig.moves[c.move], `${file} の伝説 "${kind}" のプレイヤーと同じ技 "${c.move}" が data/game/moves.json にありません`);
      if (set.field?.weather) check(!!effectRecipes[set.field.weather]?.weather, `${file} の伝説 "${kind}" の天気 "${set.field.weather}" が、天気のあるレシピ（data/effects/recipes.json の weather）ではありません`);
      for (const id of [set.field?.lightning?.move].filter((x): x is string => !!x)) check(stageMoveIds.has(id), `${file} の伝説 "${kind}" の落雷の範囲技 "${id}" がありません`);
    }
  }
  for (const s of stageConfig.swarms) {
    check(enemiesConfig.kinds.some((k) => k.id === s.kind), `${file} のスウォーム "${s.kind}" が data/game/enemies.json にありません`);
    if (s.pattern === 'bomber') {
      const move = stageConfig.moves.find((m) => m.id === s.move);
      check(!!s.triggerRange && !!move?.selfDestruct, `${file} のスウォーム "${s.kind}" は bomber なので triggerRange と、selfDestruct の範囲技 move が必要です`);
    }
  }
}

for (const [key, def] of Object.entries(movesConfig.moves)) {
  check(!!generated.moves[key], `data/game/moves.json の "${key}" が data/generated/moves.json にありません（data/pokeapi/targets.json に足して npm run pokeapi）`);
  check(!!effectRecipes[def.effect], `data/game/moves.json の "${key}" の effect "${def.effect}" のレシピがありません`);
  for (const l of def.learners ?? []) check(!!playablesConfig.pokemon[l], `data/game/moves.json の "${key}" の learners "${l}" が data/game/playables.json にありません`);
  for (const sp of (['sprite', 'effectLineSprite', 'effectSprite', 'pathSprite', 'edgeSprite', 'castSprite', 'hitSprite'] as const).flatMap((k) => { const sp = effectRecipes[def.effect]?.[k]; return sp ? [sp, ...(sp.variants ?? []).map((id) => ({ ...sp, id }))] : []; })) if (sp) check(!!moveSprites.sprites[sp.id], `data/effects/recipes.json の "${def.effect}" のドット絵 "${sp.id}" が data/render/move-sprites.json にありません（npm run move-sprites）`);
  const status = def.base.statusId;
  check(!status || statusConfig.kinds.some((k) => k.id === status), `data/game/moves.json の "${key}" の statusId "${status}" が data/game/status.json にありません`);
}
for (const [key, p] of Object.entries(playablesConfig.pokemon)) {
  if (p.hatch) {
    for (const b of p.hatch) check(!!playablesConfig.pokemon[b] && !playablesConfig.pokemon[b]!.hatch, `data/game/playables.json のタマゴ "${key}" の "${b}" が playables.json にありません`);
    check(!!itemSprites.sprites[p.sprite], `data/game/playables.json のタマゴ "${key}" の絵 "${p.sprite}" が data/render/items.json にありません`);
    continue;
  }
  check(p.startingMoves.length > 0, `data/game/playables.json の "${key}" に最初の技がありません`);
  check(!!generated.pokemon[key], `data/game/playables.json の "${key}" が data/generated/pokemon.json にありません`);
  for (const m of p.startingMoves) check(!!movesConfig.moves[m], `data/game/playables.json の "${key}" の最初の技 "${m}" が data/game/moves.json にありません`);
  if (p.unlock) {
    const u = p.unlock;
    check(unlocksConfig.unlocks.some((x) => x.pokemon === u), `data/game/playables.json の "${key}" の解放 "${u}" が data/game/achievements.json の reward.pokemon にありません`);
  }
}
check(!!playablesConfig.pokemon[playablesConfig.default], `data/game/playables.json の default "${playablesConfig.default}" がありません`);
for (const key of Object.keys(itemsConfig.items)) {
  check(!!generated.items[key], `持ち物 "${key}" が data/generated/items.json にありません（data/pokeapi/targets.json に足して npm run pokeapi）`);
}
for (const d of [...derivationsConfig.derivations, ...derivationsConfig.unique]) {
  check(!!movesConfig.moves[d.from] && !!movesConfig.moves[d.to], `data/game/derivations.json の "${d.from} → ${d.to}" の技が data/game/moves.json にありません`);
  if (d.item !== undefined) check(!!itemsConfig.items[d.item], `data/game/derivations.json の材料 "${d.item}" が data/game/items.json にありません`);
  else check(derivationsConfig.unique.some((u) => u === d && (u.minLevel || u.withMoves?.length || u.forms?.length)), `data/game/derivations.json の "${d.from} → ${d.to}" は材料が無いので、固有技でレベル（minLevel）か、ほかの技（withMoves）か、姿（forms）の条件が必要です`);
  for (const w of ('withMoves' in d ? d.withMoves : undefined) ?? []) check(!!movesConfig.moves[w], `data/game/derivations.json の "${d.from} → ${d.to}" の withMoves "${w}" が data/game/moves.json にありません`);
}
// いつも効く技（passive）: レベルごとの効果の数は、最大レベルと同じ
for (const [key, m] of Object.entries(movesConfig.moves)) {
  if (m.pattern === 'passive') check((m.passive?.length ?? 0) === m.levels.length + 1, `data/game/moves.json の "${key}" はいつも効く技なので、passive の数を最大レベル（${m.levels.length + 1}）にしてください`);
  else check(!m.passive, `data/game/moves.json の "${key}" の passive は、pattern が passive の技だけに書けます`);
}
for (const u of derivationsConfig.unique) {
  check(!!playablesConfig.pokemon[u.line], `data/game/derivations.json の固有技 "${u.to}" の系統 "${u.line}" が data/game/playables.json にありません`);
}

// 実績の名前・説明は翻訳ファイルに、解放するポケモンは PokeAPI のデータに必要
check(new Set(achievementsConfig.achievements.map((x) => x.id)).size === achievementsConfig.achievements.length, 'data/game/achievements.json の id が重複しています');
for (const a of achievementsConfig.achievements) {
  for (const [lang, messages] of [['ja', ja], ['en', en]] as const) {
    const m = messages as Record<string, string>;
    // ポケモンの解放の実績は、決まった文から名前・説明を作れる
    if (a.reward?.pokemon) continue;
    check(!!m[`achievement.${a.id}.name`] && !!m[`achievement.${a.id}.desc`], `実績 "${a.id}" の名前・説明が src/i18n/${lang}.json にありません`);
  }
}
for (const key of unlocksConfig.initial) {
  check(!!playablesConfig.pokemon[key], `data/game/achievements.json の initialPokemon "${key}" が data/game/playables.json にありません`);
}
for (const u of unlocksConfig.unlocks) {
  check(!!generated.pokemon[u.pokemon], `data/game/achievements.json の解放 "${u.pokemon}" が data/generated/pokemon.json にありません`);
}

// （前は「ボス・スウォームのポケモンとその進化前は雑魚に出さない」を検証していた。作者の決定で無くした: 07 の60章）

// ショップの強化は、効果（perLevel）か増える回数（grants）のどちらか1つ。名前と説明は翻訳ファイルに
for (const u of shopConfig.upgrades) {
  check(!!u.perLevel !== !!u.grants, `data/game/shop.json の "${u.id}" は perLevel か grants のどちらか1つを書いてください`);
  for (const [lang, messages] of [['ja', ja], ['en', en]] as const) {
    const m = messages as Record<string, string>;
    check(!!m[`shop.${u.id}.name`] && !!m[`shop.${u.id}.desc`], `ショップの強化 "${u.id}" の名前・説明が src/i18n/${lang}.json にありません`);
  }
}
