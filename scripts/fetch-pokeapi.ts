/**
 * PokeAPI からポケモン・技・持ち物・タイプのデータを取得し、ゲームで使う形に変換する。
 *
 *   npm run pokeapi
 *
 * 入力: data/pokeapi/targets.json（取得するポケモン・技・持ち物・地方のキー。タイプは全部）
 * 出力: data/generated/pokemon.json・moves.json・items.json・types.json・regions.json（コミットする。ビルドに通信を使わないため）
 *
 * 取得した応答は scripts/.cache/pokeapi/ に保存し、再取得しない（PokeAPI に何度も問い合わせない）。
 * 出力はキーの順に並べ、何度実行しても同じ内容になるようにする。
 * 技の性能（威力など）は使わない。名前・タイプ・分類（物理・特殊）だけを使う（04_data_pipeline.md 2章）。
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generatedItemsSchema,
  generatedMovesSchema,
  generatedPokemonSchema,
  generatedRegionsSchema,
  generatedTypesSchema,
  pokeapiTargetsSchema,
  type GeneratedPokemon,
} from '../src/data/schema.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, 'scripts', '.cache', 'pokeapi');
const OUT_DIR = join(ROOT, 'data', 'generated');
const API = 'https://pokeapi.co/api/v2/';
/** 対象外のタイプ（ゲームには出てこない） */
const IGNORED_TYPES = new Set(['unknown', 'shadow', 'stellar']);

interface NamedRef {
  name: string;
  url: string;
}
interface LocalizedName {
  name: string;
  language: NamedRef;
}

async function get<T>(path: string): Promise<T> {
  // Windows のファイル名に使えない文字（? など）は置き換える
  const rel = path
    .replace(API, '')
    .replace(/\/$/, '')
    .replace(/[?=&:]/g, '_');
  const cachePath = join(CACHE_DIR, `${rel}.json`);
  if (existsSync(cachePath)) return JSON.parse(await readFile(cachePath, 'utf8')) as T;
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`);
  if (!res.ok) throw new Error(`取得に失敗しました: ${path} (${res.status})`);
  const text = await res.text();
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, text);
  return JSON.parse(text) as T;
}

/**
 * 日本語（かな）・英語・フランス語・ドイツ語・スペイン語・イタリア語の名前（作者の決定 2026年10月22日: 言語を増やす）。
 * かなが無ければ漢字まじりの日本語を使う。ヨーロッパの言語の名前が無ければ英語を使う
 */
function names(list: LocalizedName[], key: string): { ja: string; en: string; fr: string; de: string; es: string; it: string } {
  const by = (lang: string) => list.find((n) => n.language.name === lang)?.name;
  const ja = by('ja-hrkt') ?? by('ja');
  const en = by('en');
  if (!ja || !en) throw new Error(`${key}: 日本語か英語の名前がありません`);
  return { ja, en, fr: by('fr') ?? en, de: by('de') ?? en, es: by('es') ?? en, it: by('it') ?? en };
}

function sortObject<T>(obj: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}

interface EvolutionNode {
  species: NamedRef;
  evolution_details: {
    min_level: number | null;
    trigger: NamedRef;
    item: NamedRef | null;
    min_happiness?: number | null;
    time_of_day?: string;
    version_group?: NamedRef;
  }[];
  evolves_to: EvolutionNode[];
}

/** 進化の系統から、あるポケモンの進化前（系統の根から順に）を取り出す */
function preEvolutionsOf(chain: EvolutionNode, species: string): string[] {
  const walk = (node: EvolutionNode, path: string[]): string[] | null => {
    if (node.species.name === species) return path;
    for (const child of node.evolves_to) {
      const hit = walk(child, [...path, node.species.name]);
      if (hit) return hit;
    }
    return null;
  };
  return walk(chain, []) ?? [];
}

/** 進化の系統から、あるポケモンの「次の進化」を取り出す */
function evolutionsOf(chain: EvolutionNode, species: string): GeneratedPokemon['evolvesTo'] {
  const find = (node: EvolutionNode): EvolutionNode | null => {
    if (node.species.name === species) return node;
    for (const child of node.evolves_to) {
      const hit = find(child);
      if (hit) return hit;
    }
    return null;
  };
  const node = find(chain);
  if (!node) return [];
  return node.evolves_to.map((child) => {
    // 世代ごとに条件が並ぶことがある。赤・緑の条件があればそれを、無ければ最初の条件を使う
    const details = child.evolution_details;
    const d = details.find((x) => x.version_group?.name === 'red-blue') ?? details[0];
    if (!d) return { to: child.species.name, trigger: 'other' as const };
    if (d.trigger.name === 'level-up' && d.min_level) return { to: child.species.name, trigger: 'level' as const, level: d.min_level };
    if (d.trigger.name === 'use-item' && d.item) return { to: child.species.name, trigger: 'item' as const, item: d.item.name };
    if (d.trigger.name === 'trade') return { to: child.species.name, trigger: 'trade' as const };
    // なつき（時間帯の条件が無いもの。ピチュー・クロバットなど。ゲームでは「たくさん歩く」。07 の66.2）
    if (d.trigger.name === 'level-up' && d.min_happiness && !d.time_of_day) return { to: child.species.name, trigger: 'friendship' as const };
    return { to: child.species.name, trigger: 'other' as const };
  });
}

async function main(): Promise<void> {
  const targets = pokeapiTargetsSchema.parse(JSON.parse(await readFile(join(ROOT, 'data/pokeapi/targets.json'), 'utf8')));

  // ポケモン
  const pokemon: Record<string, unknown> = {};
  for (const key of targets.pokemon) {
    const p = await get<{
      id: number;
      types: { slot: number; type: NamedRef }[];
      stats: { base_stat: number; stat: NamedRef }[];
      species: NamedRef;
    }>(`pokemon/${key}`);
    const species = await get<{ id: number; names: LocalizedName[]; evolution_chain: { url: string } }>(p.species.url);
    const chain = await get<{ chain: EvolutionNode }>(species.evolution_chain.url);
    const stat = (name: string) => p.stats.find((s) => s.stat.name === name)?.base_stat ?? 0;
    pokemon[key] = {
      dex: species.id,
      names: names(species.names, key),
      types: [...p.types].sort((a, b) => a.slot - b.slot).map((t) => t.type.name),
      baseStats: {
        hp: stat('hp'),
        attack: stat('attack'),
        defense: stat('defense'),
        specialAttack: stat('special-attack'),
        specialDefense: stat('special-defense'),
        speed: stat('speed'),
      },
      evolvesTo: evolutionsOf(chain.chain, key),
      preEvolutions: preEvolutionsOf(chain.chain, key),
    };
  }

  // 技（名前・タイプ・分類だけ）
  const moves: Record<string, unknown> = {};
  for (const key of targets.moves) {
    const m = await get<{ names: LocalizedName[]; type: NamedRef; damage_class: NamedRef }>(`move/${key}`);
    moves[key] = { names: names(m.names, key), type: m.type.name, damageClass: m.damage_class.name };
  }

  // 持ち物（名前だけ）
  const items: Record<string, unknown> = {};
  for (const key of targets.items) {
    const it = await get<{ names: LocalizedName[] }>(`item/${key}`);
    items[key] = { names: names(it.names, key) };
  }

  // 地方（名前だけ）
  const regions: Record<string, unknown> = {};
  for (const key of targets.regions) {
    const r = await get<{ names: LocalizedName[] }>(`region/${key}`);
    regions[key] = { names: names(r.names, key) };
  }

  // タイプと相性（今の世代の相性表）
  const typeList = await get<{ results: NamedRef[] }>('type?limit=100');
  const types: Record<string, unknown> = {};
  for (const ref of typeList.results) {
    if (IGNORED_TYPES.has(ref.name)) continue;
    const t = await get<{
      names: LocalizedName[];
      damage_relations: Record<'double_damage_to' | 'half_damage_to' | 'no_damage_to', NamedRef[]>;
    }>(ref.url);
    const r = t.damage_relations;
    types[ref.name] = {
      names: names(t.names, ref.name),
      doubleDamageTo: r.double_damage_to.map((x) => x.name).sort(),
      halfDamageTo: r.half_damage_to.map((x) => x.name).sort(),
      noDamageTo: r.no_damage_to.map((x) => x.name).sort(),
    };
  }

  const outputs = {
    'pokemon.json': generatedPokemonSchema.parse(sortObject(pokemon)),
    'moves.json': generatedMovesSchema.parse(sortObject(moves)),
    'items.json': generatedItemsSchema.parse(sortObject(items)),
    'types.json': generatedTypesSchema.parse(sortObject(types)),
    'regions.json': generatedRegionsSchema.parse(sortObject(regions)),
  };
  await mkdir(OUT_DIR, { recursive: true });
  for (const [file, data] of Object.entries(outputs)) {
    await writeFile(join(OUT_DIR, file), JSON.stringify(data, null, 2) + '\n');
  }
  console.log(
    `ポケモン ${Object.keys(pokemon).length}・技 ${Object.keys(moves).length}・持ち物 ${Object.keys(items).length}・タイプ ${Object.keys(types).length} を data/generated/ に出力しました。`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
