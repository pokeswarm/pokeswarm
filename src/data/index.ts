import type { z } from 'zod';
import simulationJson from '../../data/game/simulation.json';
import playerJson from '../../data/game/player.json';
import placeholderJson from '../../data/render/placeholder.json';
import groundJson from '../../data/render/ground.json';
import itemSpritesJson from '../../data/render/items.json';
import obstacleSpritesJson from '../../data/render/obstacles.json';
import obstaclesJson from '../../data/game/obstacles.json';
import iconsJson from '../../data/render/icons.json';
import moveBalanceJson from '../../data/game/move-balance.json';
import enemiesJson from '../../data/game/enemies.json';
import spawnJson from '../../data/game/spawn.json';
import combatJson from '../../data/game/combat.json';
import movesJson from '../../data/game/moves.json';
import playablesJson from '../../data/game/playables.json';
import levelingJson from '../../data/game/leveling.json';
import itemsJson from '../../data/game/items.json';
import passivesJson from '../../data/game/passives.json';
import derivationsJson from '../../data/game/derivations.json';
import statsJson from '../../data/game/stats.json';
import stageJson from '../../data/game/stage.json';
import saveJson from '../../data/game/save.json';
import achievementsJson from '../../data/game/achievements.json';
import unlocksJson from '../../data/game/unlocks.json';
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
import generatedPokemonJson from '../../data/generated/pokemon.json';
import generatedMovesJson from '../../data/generated/moves.json';
import generatedItemsJson from '../../data/generated/items.json';
import generatedTypesJson from '../../data/generated/types.json';
import { resolveEffectRecipes } from './effects';
import {
  combatConfigSchema,
  derivationsConfigSchema,
  itemsConfigSchema,
  levelingConfigSchema,
  passivesConfigSchema,
  enemiesConfigSchema,
  generatedItemsSchema,
  generatedMovesSchema,
  generatedPokemonSchema,
  generatedTypesSchema,
  groundConfigSchema,
  movesConfigSchema,
  networkConfigSchema,
  pickupConfigSchema,
  placeholderRenderSchema,
  playablesConfigSchema,
  playerConfigSchema,
  simulationConfigSchema,
  spawnConfigSchema,
  spriteRenderSchema,
  stageConfigSchema,
  saveConfigSchema,
  achievementsConfigSchema,
  unlocksConfigSchema,
  shopConfigSchema,
  statsConfigSchema,
  statusConfigSchema,
  sfxConfigSchema,
  bgmConfigSchema,
  musicScoreSchema,
  pixelSpritesSchema,
  obstacleConfigSchema,
  iconConfigSchema,
  MOVE_PATTERNS,
  moveBalanceSchema,
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
export const groundConfig = load('render/ground.json', groundConfigSchema, groundJson);
/** 自作のドット絵（道具・アメの箱） */
export const itemSprites = load('render/items.json', pixelSpritesSchema, itemSpritesJson);
/** 障害物のドット絵（自作）と、置き方 */
export const obstacleSprites = load('render/obstacles.json', pixelSpritesSchema, obstacleSpritesJson);
export const obstacleConfig = load('game/obstacles.json', obstacleConfigSchema, obstaclesJson);
/** 技・持ち物・パッシブのアイコン（自作のドット絵） */
export const iconConfig = load('render/icons.json', iconConfigSchema, iconsJson);
/** 技の強さをそろえる目安（段階ごとの総合の強さ） */
export const moveBalanceConfig = load('game/move-balance.json', moveBalanceSchema, moveBalanceJson);
export const enemiesConfig = load('game/enemies.json', enemiesConfigSchema, enemiesJson);
export const spawnConfig = load('game/spawn.json', spawnConfigSchema, spawnJson);
export const combatConfig = load('game/combat.json', combatConfigSchema, combatJson);
export const movesConfig = load('game/moves.json', movesConfigSchema, movesJson);
export const playablesConfig = load('game/playables.json', playablesConfigSchema, playablesJson);
export const levelingConfig = load('game/leveling.json', levelingConfigSchema, levelingJson);
export const itemsConfig = load('game/items.json', itemsConfigSchema, itemsJson);
export const passivesConfig = load('game/passives.json', passivesConfigSchema, passivesJson);
export const derivationsConfig = load('game/derivations.json', derivationsConfigSchema, derivationsJson);
export const statsConfig = load('game/stats.json', statsConfigSchema, statsJson);
export const stageConfig = load('game/stage.json', stageConfigSchema, stageJson);
export const saveConfig = load('game/save.json', saveConfigSchema, saveJson);
export const achievementsConfig = load('game/achievements.json', achievementsConfigSchema, achievementsJson);
export const unlocksConfig = load('game/unlocks.json', unlocksConfigSchema, unlocksJson);
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
};

// ---- ファイルをまたぐ参照の検証 ----
function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
}
for (const wave of spawnConfig.waves) {
  for (const kind of wave.kinds) {
    check(
      enemiesConfig.kinds.some((k) => k.id === kind),
      `data/game/spawn.json の waves にある敵 "${kind}" が data/game/enemies.json にありません`,
    );
  }
}
// アイコン: 技の出し方・持ち物・パッシブ・タイプごとに絵柄と色がある
for (const p of MOVE_PATTERNS) check(!!iconConfig.glyphs[iconConfig.moves[p] ?? ''], `data/render/icons.json に出し方 "${p}" の絵柄がありません`);
for (const k of Object.keys(itemsConfig.items)) check(!!iconConfig.glyphs[iconConfig.items[k]?.glyph ?? ''], `data/render/icons.json に持ち物 "${k}" のアイコンがありません`);
for (const k of Object.keys(passivesConfig.passives)) check(!!iconConfig.glyphs[iconConfig.passives[k]?.glyph ?? ''], `data/render/icons.json にパッシブ "${k}" のアイコンがありません`);
for (const k of Object.keys(movesConfig.moves)) check(!!iconConfig.typeColors[generated.moves[k]!.type], `data/render/icons.json にタイプ "${generated.moves[k]!.type}" の色がありません`);
// 障害物: 区間の数は spawn.json と同じ。見た目の種類はドット絵がある
check(obstacleConfig.sections.length === spawnConfig.waves.length, `data/game/obstacles.json の sections（${obstacleConfig.sections.length}）と data/game/spawn.json の waves（${spawnConfig.waves.length}）の数をそろえてください`);
for (const kinds of obstacleConfig.sections) for (const k of kinds) check(!!obstacleSprites.sprites[k], `data/game/obstacles.json の "${k}" のドット絵が data/render/obstacles.json にありません`);
check(obstacleConfig.margin * 2 < obstacleConfig.cellSize, 'data/game/obstacles.json の margin は cellSize の半分より小さくする');
check(!!itemSprites.candyBurst, 'data/render/items.json に candyBurst がありません');
// 道具のドット絵: マップの道具ごとと、アメの箱
for (const name of ['potion', 'magnet', 'rare-candy', 'candy-box', 'candy-box-open']) {
  check(!!itemSprites.sprites[name], `data/render/items.json に "${name}" のドット絵がありません`);
}
// BGM: 曲はファイルか楽譜のどちらかを持つ。楽譜は data/audio/music にあるもの
for (const [id, track] of Object.entries(bgmConfig.tracks)) {
  check(!!track.file || !!track.score, `data/audio/bgm.json の曲 "${id}" は file か score を書いてください`);
  check(!track.score || !!musicScores[track.score], `data/audio/bgm.json の曲 "${id}" の楽譜 "${track.score}" が data/audio/music にありません`);
}
// BGM: 区間ごとの曲は区間の数と同じ。曲の名前は tracks にあるもの
check(bgmConfig.run.sections.length === spawnConfig.waves.length, `data/audio/bgm.json の run.sections（${bgmConfig.run.sections.length}）と data/game/spawn.json の waves（${spawnConfig.waves.length}）の数をそろえてください`);
for (const id of [...bgmConfig.run.sections, bgmConfig.run.legendary, bgmConfig.scenes.title, bgmConfig.scenes.result]) {
  check(id === null || !!bgmConfig.tracks[id], `data/audio/bgm.json の曲 "${id}" が tracks にありません`);
}
check(
  groundConfig.waves.length === spawnConfig.waves.length,
  `data/render/ground.json の waves（${groundConfig.waves.length}）と data/game/spawn.json の waves（${spawnConfig.waves.length}）の数をそろえてください`,
);
// 最後の区間以外は、中ボス（gate）か durationSeconds で次へ進めるようにする
spawnConfig.waves.forEach((w, i) => {
  if (i === spawnConfig.waves.length - 1) return;
  const gate = stageConfig.bosses.some((b) => b.wave === i && b.gate);
  check(gate !== !!w.durationSeconds, `data/game/spawn.json の区間 ${i + 1} は、中ボス（stage.json の gate）か durationSeconds のどちらか1つで次へ進めてください`);
});
for (const kind of enemiesConfig.kinds) {
  const species = kind.species ?? kind.id;
  check(!!generated.pokemon[species], `data/game/enemies.json の "${kind.id}" のポケモン "${species}" が data/generated/pokemon.json にありません（data/pokeapi/targets.json に足して npm run pokeapi）`);
}
for (const wave of spawnConfig.waves) {
  for (const id of wave.kinds) {
    check((enemiesConfig.kinds.find((k) => k.id === id)?.rank ?? 'normal') === 'normal', `data/game/spawn.json の waves の "${id}" は雑魚（rank: normal）ではありません`);
  }
}
const stageMoveIds = new Set(stageConfig.moves.map((m) => m.id));
for (const m of stageConfig.moves) {
  check(!m.move || !!generated.moves[m.move], `data/game/stage.json の範囲技 "${m.id}" の技 "${m.move}" が data/generated/moves.json にありません`);
  check(!!effectRecipes[m.effect], `data/game/stage.json の範囲技 "${m.id}" の effect "${m.effect}" のレシピがありません`);
  check(m.shape !== 'line' || !!m.length, `data/game/stage.json の範囲技 "${m.id}" は直線なので length が必要です`);
}
for (const b of stageConfig.bosses) {
  const rank = enemiesConfig.kinds.find((k) => k.id === b.kind)?.rank;
  check(rank === 'midboss' || rank === 'boss', `data/game/stage.json の "${b.kind}" が data/game/enemies.json に rank: "midboss" か "boss" でありません`);
  check(b.wave < spawnConfig.waves.length, `data/game/stage.json の "${b.kind}" の wave ${b.wave} が data/game/spawn.json の waves にありません`);
  check(!b.gate || b.wave < spawnConfig.waves.length - 1, `data/game/stage.json の "${b.kind}" は最後の区間なので gate にできません`);
  for (const id of b.moves) check(stageMoveIds.has(id), `data/game/stage.json の "${b.kind}" の範囲技 "${id}" がありません`);
}
if (stageConfig.legendary) {
  for (const id of stageConfig.legendary.kinds) {
    check(enemiesConfig.kinds.find((k) => k.id === id)?.rank === 'legendary', `data/game/stage.json の伝説 "${id}" が data/game/enemies.json に rank: "legendary" でありません`);
  }
  for (const id of stageConfig.legendary.moves) check(stageMoveIds.has(id), `data/game/stage.json の伝説の範囲技 "${id}" がありません`);
}
for (const s of stageConfig.swarms) {
  check(enemiesConfig.kinds.some((k) => k.id === s.kind), `data/game/stage.json のスウォーム "${s.kind}" が data/game/enemies.json にありません`);
  if (s.pattern === 'bomber') {
    const move = stageConfig.moves.find((m) => m.id === s.move);
    check(!!s.triggerRange && !!move?.selfDestruct, `data/game/stage.json のスウォーム "${s.kind}" は bomber なので triggerRange と、selfDestruct の範囲技 move が必要です`);
  }
}
for (const [key, def] of Object.entries(movesConfig.moves)) {
  check(!!generated.moves[key], `data/game/moves.json の "${key}" が data/generated/moves.json にありません（data/pokeapi/targets.json に足して npm run pokeapi）`);
  check(!!effectRecipes[def.effect], `data/game/moves.json の "${key}" の effect "${def.effect}" のレシピがありません`);
  const status = def.base.statusId;
  check(!status || statusConfig.kinds.some((k) => k.id === status), `data/game/moves.json の "${key}" の statusId "${status}" が data/game/status.json にありません`);
}
for (const [key, p] of Object.entries(playablesConfig.pokemon)) {
  check(!!generated.pokemon[key], `data/game/playables.json の "${key}" が data/generated/pokemon.json にありません`);
  for (const m of p.startingMoves) check(!!movesConfig.moves[m], `data/game/playables.json の "${key}" の最初の技 "${m}" が data/game/moves.json にありません`);
  if (p.unlock) {
    const u = p.unlock;
    check(unlocksConfig.unlocks.some((x) => x.pokemon === u), `data/game/playables.json の "${key}" の解放 "${u}" が data/game/unlocks.json にありません`);
  }
}
check(!!playablesConfig.pokemon[playablesConfig.default], `data/game/playables.json の default "${playablesConfig.default}" がありません`);
for (const key of [...Object.keys(itemsConfig.items), ...Object.keys(passivesConfig.passives)]) {
  check(!!generated.items[key], `持ち物・パッシブ "${key}" が data/generated/items.json にありません（data/pokeapi/targets.json に足して npm run pokeapi）`);
}
for (const d of [...derivationsConfig.derivations, ...derivationsConfig.unique]) {
  check(!!movesConfig.moves[d.from] && !!movesConfig.moves[d.to], `data/game/derivations.json の "${d.from} → ${d.to}" の技が data/game/moves.json にありません`);
  check(!!itemsConfig.items[d.item], `data/game/derivations.json の材料 "${d.item}" が data/game/items.json にありません`);
}
for (const u of derivationsConfig.unique) {
  check(!!playablesConfig.pokemon[u.line], `data/game/derivations.json の固有技 "${u.to}" の系統 "${u.line}" が data/game/playables.json にありません`);
}

// 実績の名前・説明は翻訳ファイルに、解放するポケモンは PokeAPI のデータに必要
check(new Set(achievementsConfig.achievements.map((x) => x.id)).size === achievementsConfig.achievements.length, 'data/game/achievements.json の id が重複しています');
for (const a of achievementsConfig.achievements) {
  for (const [lang, messages] of [['ja', ja], ['en', en]] as const) {
    const m = messages as Record<string, string>;
    check(!!m[`achievement.${a.id}.name`] && !!m[`achievement.${a.id}.desc`], `実績 "${a.id}" の名前・説明が src/i18n/${lang}.json にありません`);
  }
}
for (const key of unlocksConfig.initial) {
  check(!!playablesConfig.pokemon[key], `data/game/unlocks.json の initial "${key}" が data/game/playables.json にありません`);
}
for (const u of unlocksConfig.unlocks) {
  check(!!generated.pokemon[u.pokemon], `data/game/unlocks.json の "${u.pokemon}" が data/generated/pokemon.json にありません`);
}

// 中ボス・ボス・伝説・スウォームに出るポケモンと、その進化前は、時間帯の雑魚に出さない（作者の決定）
{
  const reserved = new Map<string, string>();
  for (const k of enemiesConfig.kinds) {
    if (!k.rank && !stageConfig.swarms.some((s) => s.kind === k.id)) continue;
    const species = k.species ?? k.id;
    reserved.set(species, species);
    for (const pre of generated.pokemon[species]?.preEvolutions ?? []) reserved.set(pre, species);
  }
  spawnConfig.waves.forEach((wave, i) => {
    if (wave.allowBossSpecies) return;
    for (const id of wave.kinds) {
      const species = enemiesConfig.kinds.find((k) => k.id === id)?.species ?? id;
      const by = reserved.get(species);
      check(!by, `data/game/spawn.json の時間帯 ${i + 1} の "${id}" は、ボスかスウォームの "${by}"（またはその進化前）なので雑魚に出せません`);
    }
  });
}

// ショップの強化は、効果（perLevel）か増える回数（grants）のどちらか1つ。名前と説明は翻訳ファイルに
for (const u of shopConfig.upgrades) {
  check(!!u.perLevel !== !!u.grants, `data/game/shop.json の "${u.id}" は perLevel か grants のどちらか1つを書いてください`);
  for (const [lang, messages] of [['ja', ja], ['en', en]] as const) {
    const m = messages as Record<string, string>;
    check(!!m[`shop.${u.id}.name`] && !!m[`shop.${u.id}.desc`], `ショップの強化 "${u.id}" の名前・説明が src/i18n/${lang}.json にありません`);
  }
}
