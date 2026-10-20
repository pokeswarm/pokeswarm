/**
 * SpriteCollab からポケモンのスプライトを取得し、ゲームで使う形に変換する。
 *
 *   npm run sprites
 *
 * 入力: data/sprites/pokemon.json（使用するポケモンの一覧）、data/sprites/pipeline.json（取得元・動作・代わり）
 * 出力: public/sprites/<key>/atlas.png・atlas.json（Phaser のアトラス形式）・anims.json
 *       public/sprites/credits.json（作者一覧）、public/sprites/report.json（欠けている動作など）
 *
 * 取得したファイルは scripts/.cache/ に保存し、同じコミットからは再取得しない。
 * 出力はどちらも .gitignore 済み（スプライトをリポジトリに含めるかは未決定）。
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pngjs from 'pngjs';
import {
  SPRITE_DIRECTIONS,
  spriteAnimsSchema,
  spritePipelineSchema,
  spritePokemonListSchema,
  type SpriteAnims,
  type SpritePipeline,
} from '../src/data/schema.ts';

const { PNG } = pngjs;
type Png = InstanceType<typeof PNG>;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, 'scripts', '.cache', 'spritecollab');
const OUT_DIR = join(ROOT, 'public', 'sprites');
/** PMD のアニメーションの時間の単位（1/60 秒） */
const DURATION_UNIT_MS = 1000 / 60;
/** SpriteCollab 上で公式ゲーム（ポケモン不思議のダンジョン）の素材を表す作者名 */
const OFFICIAL_AUTHOR = 'CHUNSOFT';

interface AnimDef {
  name: string;
  frameWidth: number;
  frameHeight: number;
  durations: number[];
  copyOf?: string;
}

interface Author {
  name: string;
  contact: string | null;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(join(ROOT, path), 'utf8'));
}

/** SpriteCollab のファイルを取得する（キャッシュ優先）。存在しなければ null */
async function fetchFile(pipeline: SpritePipeline, path: string): Promise<Buffer | null> {
  const cachePath = join(CACHE_DIR, pipeline.source.ref, path);
  if (existsSync(cachePath)) return readFile(cachePath);
  const url = `https://raw.githubusercontent.com/${pipeline.source.repo}/${pipeline.source.ref}/${path}`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`取得に失敗しました: ${url} (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, buf);
  return buf;
}

function tag(xml: string, name: string): string | undefined {
  return new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1]?.trim();
}

/** AnimData.xml を読む（構造が単純なので正規表現で足りる） */
function parseAnimData(xml: string): Map<string, AnimDef> {
  const anims = new Map<string, AnimDef>();
  for (const m of xml.matchAll(/<Anim>([\s\S]*?)<\/Anim>/g)) {
    const body = m[1]!;
    const name = tag(body, 'Name');
    if (!name) continue;
    const copyOf = tag(body, 'CopyOf');
    const durations = [...body.matchAll(/<Duration>(\d+)<\/Duration>/g)].map((d) => Number(d[1]));
    anims.set(name, {
      name,
      frameWidth: Number(tag(body, 'FrameWidth') ?? 0),
      frameHeight: Number(tag(body, 'FrameHeight') ?? 0),
      durations,
      ...(copyOf !== undefined && { copyOf }),
    });
  }
  return anims;
}

/** CopyOf をたどって、実際に絵を持っている動作を返す */
function resolveCopy(anims: Map<string, AnimDef>, name: string): AnimDef | undefined {
  const seen = new Set<string>();
  let cur = anims.get(name);
  while (cur?.copyOf !== undefined) {
    if (seen.has(cur.name)) return undefined;
    seen.add(cur.name);
    cur = anims.get(cur.copyOf);
  }
  return cur;
}

function parseCreditNames(text: string): Map<string, Author> {
  const map = new Map<string, Author>();
  for (const line of text.split(/\r?\n/).slice(1)) {
    const [name, discord, contact] = line.split('\t');
    if (!name) continue;
    // Discord の ID（<@...>）は連絡先として載せない
    const author: Author = { name, contact: contact && !contact.startsWith('<@') ? contact : null };
    map.set(name, author);
    if (discord) map.set(discord, author);
  }
  return map;
}

async function processPokemon(
  pipeline: SpritePipeline,
  entry: { key: string; dex: number; form?: string | undefined },
  creditNames: Map<string, Author>,
) {
  const folder = `sprite/${String(entry.dex).padStart(4, '0')}${entry.form ? `/${entry.form}` : ''}`;
  const xml = await fetchFile(pipeline, `${folder}/AnimData.xml`);
  if (!xml) {
    return { key: entry.key, ok: false as const, reason: `${folder}/AnimData.xml がありません` };
  }
  const animData = parseAnimData(xml.toString('utf8'));

  // 動作ごとに、使う絵（代わりを含む）を決める
  const sheets = new Map<string, { def: AnimDef; png: Png }>();
  const loadSheet = async (name: string): Promise<{ def: AnimDef; png: Png } | null> => {
    const def = resolveCopy(animData, name);
    if (!def || def.durations.length === 0 || def.frameWidth === 0) return null;
    const cached = sheets.get(def.name);
    if (cached) return cached;
    const buf = await fetchFile(pipeline, `${folder}/${def.name}-Anim.png`);
    if (!buf) return null;
    const png = PNG.sync.read(buf);
    const sheet = { def, png };
    sheets.set(def.name, sheet);
    return sheet;
  };

  const animations: SpriteAnims['animations'] = {};
  const missing: SpriteAnims['missing'] = [];
  for (const wanted of pipeline.animations) {
    let name: string | undefined = wanted;
    const visited = new Set<string>();
    let sheet: { def: AnimDef; png: Png } | null = null;
    while (name !== undefined && !visited.has(name)) {
      visited.add(name);
      sheet = await loadSheet(name);
      if (sheet) break;
      name = pipeline.fallbacks[name];
    }
    if (name !== wanted) missing.push({ animation: wanted, usedInstead: sheet ? sheet.def.name : null });
    if (!sheet) continue;
    animations[wanted] = {
      source: sheet.def.name,
      frameWidth: sheet.def.frameWidth,
      frameHeight: sheet.def.frameHeight,
      durations: sheet.def.durations,
      frameKeyPrefix: sheet.def.name,
    };
  }

  // 使うシートを縦に積んで1枚のアトラスにする
  const used = [...sheets.values()].sort((a, b) => a.def.name.localeCompare(b.def.name));
  const width = Math.max(...used.map((s) => s.png.width));
  const height = used.reduce((sum, s) => sum + s.png.height, 0);
  if (width > pipeline.maxAtlasSize || height > pipeline.maxAtlasSize) {
    throw new Error(`${entry.key}: アトラスが大きすぎます (${width}x${height})`);
  }
  const atlas = new PNG({ width, height });
  const frames: Record<string, unknown> = {};
  let y = 0;
  for (const { def, png } of used) {
    PNG.bitblt(png, atlas, 0, 0, png.width, png.height, 0, y);
    const cols = Math.floor(png.width / def.frameWidth);
    const rows = Math.floor(png.height / def.frameHeight);
    if (cols !== def.durations.length) {
      throw new Error(`${entry.key}/${def.name}: コマ数が AnimData と一致しません (${cols} != ${def.durations.length})`);
    }
    for (let dir = 0; dir < SPRITE_DIRECTIONS.length; dir++) {
      // 1方向しかない動作は、全方向で同じ行を使う
      const row = rows >= SPRITE_DIRECTIONS.length ? dir : 0;
      for (let f = 0; f < cols; f++) {
        frames[`${def.name}/${dir}/${f}`] = {
          frame: { x: f * def.frameWidth, y: y + row * def.frameHeight, w: def.frameWidth, h: def.frameHeight },
          rotated: false,
          trimmed: false,
          spriteSourceSize: { x: 0, y: 0, w: def.frameWidth, h: def.frameHeight },
          sourceSize: { w: def.frameWidth, h: def.frameHeight },
        };
      }
    }
    y += png.height;
  }

  const anims: SpriteAnims = spriteAnimsSchema.parse({
    key: entry.key,
    dex: entry.dex,
    durationUnitMs: DURATION_UNIT_MS,
    directions: [...SPRITE_DIRECTIONS],
    animations,
    missing,
  });

  const outDir = join(OUT_DIR, entry.key);
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'atlas.png'), PNG.sync.write(atlas));
  await writeFile(
    join(outDir, 'atlas.json'),
    JSON.stringify({ frames, meta: { image: 'atlas.png', size: { w: width, h: height }, scale: '1' } }),
  );
  await writeFile(join(outDir, 'anims.json'), JSON.stringify(anims, null, 2));

  // 作者一覧（credits.txt の2列目が作者）
  const creditsTxt = await fetchFile(pipeline, `${folder}/credits.txt`);
  const authorIds = new Set<string>();
  for (const line of (creditsTxt?.toString('utf8') ?? '').split(/\r?\n/)) {
    const id = line.split('\t')[1];
    if (id) authorIds.add(id);
  }
  const authors = [...authorIds].map((id) => creditNames.get(id) ?? { name: id, contact: null });

  return {
    key: entry.key,
    ok: true as const,
    dex: entry.dex,
    folder,
    missing,
    authors,
    official: authors.some((a) => a.name === OFFICIAL_AUTHOR),
    atlasSize: `${width}x${height}`,
  };
}

async function main(): Promise<void> {
  const pipeline = spritePipelineSchema.parse(await readJson('data/sprites/pipeline.json'));
  const list = spritePokemonListSchema.parse(await readJson('data/sprites/pokemon.json'));
  const creditNamesBuf = await fetchFile(pipeline, 'credit_names.txt');
  const creditNames = parseCreditNames(creditNamesBuf?.toString('utf8') ?? '');

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const results = [];
  for (const entry of list.pokemon) results.push(await processPokemon(pipeline, entry, creditNames));

  const sourceUrl = `https://github.com/${pipeline.source.repo}/tree/${pipeline.source.ref}`;
  const credits = results.flatMap((r) =>
    r.ok ? [{ key: r.key, dex: r.dex, authors: r.authors, license: 'CC BY-NC 4.0', source: `${sourceUrl}/${r.folder}` }] : [],
  );
  await writeFile(join(OUT_DIR, 'credits.json'), JSON.stringify(credits, null, 2));
  await writeFile(join(OUT_DIR, 'report.json'), JSON.stringify(results, null, 2));

  // 報告
  console.log(`SpriteCollab ${pipeline.source.ref.slice(0, 7)} から ${results.length} 体を処理しました。`);
  for (const r of results) {
    if (!r.ok) {
      console.log(`  ✗ ${r.key}: ${r.reason}`);
      continue;
    }
    console.log(`  ✓ ${r.key} (#${r.dex}) アトラス ${r.atlasSize}  作者: ${r.authors.map((a) => a.name).join(', ')}`);
    if (r.official) console.log(`    ! 公式ゲーム（${OFFICIAL_AUTHOR}）の素材を含みます`);
    for (const m of r.missing) {
      console.log(`    - 欠けている動作: ${m.animation} → ${m.usedInstead ?? '代わりなし'}`);
    }
  }
  const missingCount = results.reduce((n, r) => n + (r.ok ? r.missing.length : 1), 0);
  console.log(missingCount === 0 ? '欠けている動作はありません。' : `欠けている動作など: ${missingCount} 件（public/sprites/report.json）`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
