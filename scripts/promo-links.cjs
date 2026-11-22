// 宣伝の動画を撮るためのリンク集（docs/31_promo_links.md）を作る。
// 元: docs/27_build_estimate.json（系統ごとの一番強い案）・docs/08_moves_table.json（技の名前）・data/game（持ち物・ボス）。
// 使い方: node scripts/promo-links.cjs（npm run promo-links）
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

const est = read('docs/27_build_estimate.json');
const movesTable = read('docs/08_moves_table.json');
const items = read('data/game/items.json').items;
const itemNames = read('data/generated/items.json');
const typeNames = read('data/generated/types.json');
const playables = read('data/game/playables.json').pokemon;

const BASE = 'http://localhost:5173/';
const name = (key) => est.names[key] ?? movesTable.names.pokemon?.[key] ?? key;
const itemName = (key) => itemNames[key]?.names?.ja ?? key;

// 最終の姿になるのに要るもの（石・交換の道具は持ち物に足す。なつきは ?friendship）
const EVO_ITEMS = {
  vileplume: ['leaf-stone'], starmie: ['water-stone'], arcanine: ['fire-stone'], alakazam: ['linking-cord'], machamp: ['linking-cord'], gengar: ['linking-cord'],
  wigglytuff: ['moon-stone'], clefable: ['moon-stone'], flareon: ['fire-stone'], jolteon: ['thunder-stone'], vaporeon: ['water-stone'],
  steelix: ['metal-coat'], scizor: ['metal-coat'], slowking: ['kings-rock'], porygon2: ['up-grade'], kingdra: ['dragon-scale'], poliwrath: ['water-stone'], milotic: ['prism-scale'],
};
const FRIENDSHIP = new Set(['espeon', 'umbreon', 'crobat', 'togetic', 'azumarill', 'clefable']);
const FRIENDSHIP_LINES = new Set(['pichu', 'cleffa', 'igglybuff', 'togepi', 'azurill']);

/** 持ち物を全部最大のレベルで（石などは 1）。進化に要るものを先頭に足す */
function itemsParam(keys, form) {
  const all = [...(EVO_ITEMS[form] ?? []), ...keys];
  return all.map((k) => `${k}:${items[k]?.maxLevel ?? 1}`).join(',');
}

/** 1 つのビルドの、場面に共通の部分（ポケモン・地方・レベル・技・持ち物・無敵） */
function buildQuery(region, line, build) {
  const q = [`pokemon=${line}`, `region=${region}`, 'level=100', `moves=${build.moves.map((m) => `${m.move}:${m.level}`).join(',')}`, `items=${itemsParam(build.items, build.form)}`];
  if (FRIENDSHIP.has(build.form) || FRIENDSHIP_LINES.has(line)) q.push('friendship');
  q.push('god');
  return q.join('&');
}
const url = (query, extra) => `${BASE}?${query}${extra ? '&' + extra : ''}`;
const link = (label, query, extra) => `[${label}](${url(query, extra)})`;

/** 系統の一番上の案（姿を選ぶときは form） */
function pick(region, line, form) {
  const l = est.regions[region].lines.find((x) => x.key === line);
  if (!l) throw new Error(`系統が無い: ${region} ${line}`);
  const b = form ? l.builds.find((x) => x.form === form) : l.builds[0];
  if (!b) throw new Error(`案が無い: ${region} ${line} ${form}`);
  return b;
}
const q = (region, line, form) => buildQuery(region, line, pick(region, line, form));
const movesText = (b) => b.moves.map((m) => name(m.move)).join('・');

// 雑魚を蹂躙する場面: 区間（?section）と、雑魚 2 倍（?spawnx=2）
const SWARM = { kanto: 'section=9&spawnx=2', johto: 'section=11&spawnx=2', hoenn: 'section=11&spawnx=2' };
// 系統ごとの表で使う、地方の代表のボスと伝説
const REGION_BOSS = { kanto: ['boss=dragonite', 'カイリュー'], johto: ['boss=dragonite', 'カイリュー'], hoenn: ['boss=salamence', 'ボーマンダとフライゴン'] };
const REGION_LEGEND = { kanto: ['legend=mewtwo', 'ミュウツー'], johto: ['legend=lugia', 'ルギア'], hoenn: ['legend=rayquaza', 'レックウザ'] };
const REGION_NAME = { kanto: 'カントー', johto: 'ジョウト', hoenn: 'ホウエン' };

const out = [];
const w = (s = '') => out.push(s);

w('# 宣伝の動画を撮るためのリンク集');
w();
w('自動で作る資料（手で直さない）。作り方: `npm run promo-links`。元は `docs/27_build_estimate.json`（系統ごとの一番強い案）なので、技を変えたら `npm run build-estimate` の後に作り直す。場面の案を変えるときは `scripts/promo-links.cjs` を直す。');
w();
w('- 開く前に、開発サーバー（`npm run dev`）を動かしておく。リンクはすべて localhost（本番では使わない）。');
w('- どのリンクも **無敵（`god`）・レベル 100・技と持ち物は最大**。無敵でも画面には何も出ない。記録は保存されない。');
w('- 始まってすぐは雑魚が少ない。雑魚の場面は 20〜30 秒待ってから撮るとよい。');
w();
w('## 1. おすすめの場面');
w();
w('### 1.1 雑魚を蹂躙する');
w();
w('雑魚の数はふだんの 2 倍（`spawnx=2`）。後半の区間から始める。');
w();
w('| 場面 | 見どころ | リンク |');
w('|---|---|---|');
const swarmScenes = [
  ['kanto', 'charmander', null, '★ブラストバーン の爆発で群れが消える。看板のポケモン'],
  ['kanto', 'pikachu', null, '★ボルテッカー で群れを突っ切る。でんきだま'],
  ['kanto', 'gastly', null, 'ヘドロウェーブ と シャドーボール。カントーで一番強い'],
  ['kanto', 'mewtwo', null, '★サイコブレイク。絵が一番細かい伝説'],
  ['johto', 'cyndaquil', null, '★ふんか。画面いっぱいの炎'],
  ['johto', 'larvitar', null, 'ストーンエッジ と あくのはどう。重い一撃'],
  ['johto', 'scyther', 'scizor', 'バレットパンチ の連打と つるぎのまい'],
  ['johto', 'eevee', 'espeon', '★アシストパワー の玉の輪（作り直したばかり）。昼の区間（進化を聞かれたら「はい」）', 'section=11&spawnx=2'],
  ['johto', 'eevee', 'umbreon', '★イカサマ のしっぽで薙ぐ 2 連ダッシュ。夜の区間（進化を聞かれたら「はい」）', 'section=8&spawnx=2'],
  ['hoenn', 'ralts', null, 'ハイパーボイス と みらいよち（サーナイト）'],
  ['hoenn', 'torchic', null, 'インファイト と フレアドライブ（バシャーモ）'],
  ['hoenn', 'trapinch', null, 'じしん と ドラゴンダイブ（フライゴン）'],
];
for (const [region, line, form, note, extra] of swarmScenes) {
  const b = pick(region, line, form);
  w(`| ${name(b.form)}（${REGION_NAME[region]}） | ${note} | ${link('雑魚 2 倍', buildQuery(region, line, b), extra ?? SWARM[region])} |`);
}
w();
w('### 1.2 ボスと戦う');
w();
w('| 場面 | 見どころ | リンク |');
w('|---|---|---|');
const bossScenes = [
  ['kanto', 'dratini', null, 'boss=dragonite', 'カイリュー 対 四天王のカイリュー', '同じポケモンどうし。四天王の部屋'],
  ['kanto', 'abra', null, 'boss=gengar', 'フーディン 対 四天王のゲンガー', 'エスパー 対 ゴースト'],
  ['kanto', 'mew', null, 'legend=mewtwo', 'ミュウ 対 ミュウツー', '伝説どうし。ミュウツーの技の絵は一番細かい'],
  ['kanto', 'squirtle', null, 'legend=charizard', 'カメックス 対 色違いのリザードン', '御三家の対決'],
  ['kanto', 'pikachu', null, 'legend=zapdos', 'ピカチュウ 対 サンダー', '暗くなるマップと雷'],
  ['johto', 'cyndaquil', null, 'legend=red-pikachu', 'バクフーン 対 レッド', 'シロガネやま。ピカチュウ → エーフィとカビゴン → 御三家の 3 連戦'],
  ['johto', 'totodile', null, 'time=300&intruder=suicune&intruderat=20', 'オーダイル と スイクンの乱入', '20 秒後に雑魚の中へスイクンが駆け込んでくる'],
  ['johto', 'larvitar', null, 'boss=dragonite', 'バンギラス 対 ワタルのカイリュー', 'ジョウトの四天王の最後'],
  ['hoenn', 'mudkip', null, 'legend=groudon', 'ラグラージ 対 グラードンとカイオーガ', '2 体同時。天気が入れ替わる'],
  ['hoenn', 'bagon', null, 'legend=rayquaza', 'ボーマンダ 対 レックウザ', 'ドラゴンどうし。そらのはしら'],
  ['hoenn', 'latios', null, 'legend=deoxys', 'ラティオス 対 デオキシス', '姿を変えるデオキシス'],
  ['hoenn', 'torchic', null, 'boss=milotic', 'バシャーモ 対 ミロカロスとホエルオー', 'ホウエンの四天王の最後（2 体の組）'],
  ['hoenn', 'treecko', null, 'time=300&intruder=latias&intruderat=20', 'ジュカイン と ラティ兄妹の乱入', '20 秒後に 2 体が飛んでくる'],
];
for (const [region, line, form, extra, title, note] of bossScenes) w(`| ${title} | ${note} | ${link('開く', q(region, line, form), extra)} |`);
w();
w('### 1.3 最後の場面: ルギア 対 ホウオウ');
w();
const lugia = q('johto', 'lugia');
w(`- ${link('すぐホウオウ戦', lugia, 'legend=ho-oh')}（固定マップで 1 対 1）`);
w(`- ${link('雑魚の中から 8 秒後にホウオウ戦', lugia, 'legend=ho-oh&legendafter=8&spawnx=2&section=11')}（雑魚を蹴散らしているところに「DANGER」が出て、戦いへ切り替わる。動画の締めに向く）`);
w(`- 逆の組: ${link('ホウオウ 対 ルギア', q('johto', 'ho-oh'), 'legend=lugia')}`);
w(`- ルギアの技: ${movesText(pick('johto', 'lugia'))}`);
w();
w('## 2. 自分でリンクを作る');
w();
w('`http://localhost:5173/?` の後ろに、下の部品を `&` でつなぐ。');
w();
w('| 部品 | 意味 | 例 |');
w('|---|---|---|');
w('| `pokemon=コード` | 遊ぶポケモン（3章のコード。最初の姿で書く） | `pokemon=charmander` |');
w('| `region=コード` | 地方（`kanto`・`johto`・`hoenn`）。雑魚・ボス・マップが変わる | `region=johto` |');
w('| `level=数` | そのレベルから始める（レベルで進化する姿は最初から進化している） | `level=100` |');
w('| `moves=技:レベル,…` | 技（4 つまで。4章のコード。レベルは最大 8、伝説の技は 12。大きすぎる数は最大に丸める） | `moves=blast-burn:8,air-slash:8` |');
w('| `items=持ち物:レベル,…` | 持ち物（5章のコード）。進化の石・つながりのヒモなどを入れるとすぐ進化する | `items=charcoal:5,fire-stone:1` |');
w('| `friendship` | なつきの進化（クロバット・トゲチック・ピカチュウ（ピチューから）など）をすぐ起こす。イーブイは昼の区間でエーフィ、夜の区間でブラッキーを聞かれる | `friendship` |');
w('| `god` | 無敵（画面に何も出ない）。記録を保存しない | `god` |');
w('| `section=数` | その区間から始める（カントー 0〜12、ジョウト・ホウエン 0〜15。場所と雑魚が変わる。ジョウトの夜は 2・5・7・8） | `section=9` |');
w('| `time=秒` | ランの途中の時刻から始める | `time=300` |');
w('| `spawnx=倍` | 雑魚の数を何倍かにする | `spawnx=2` |');
w('| `boss=コード` | そのボス（四天王など）の区間から始めて、すぐ出す（6章） | `boss=dragonite` |');
w('| `legend=コード` | 最初から伝説と戦う（6章） | `legend=mewtwo` |');
w('| `legendafter=秒` | `legend=` の戦いを、その秒数だけ雑魚と戦ってから始める | `legendafter=8` |');
w('| `solo` | `legend=` で、同時に出る相手を出さない（グラードンだけ、など） | `solo` |');
w('| `intruder=コード`・`intruderat=秒` | 乱入する伝説（三犬・ラティ兄妹）を、その秒数の後に出す（`time=300` と一緒に） | `intruder=suicune&intruderat=20` |');
w('| `wings` | はねを持っている（レッドに勝つとルギア → ホウオウへ続く） | `wings` |');
w('| `shiny` | 色違い（見た目だけ） | `shiny` |');
w();
w('## 3. キャラのコードと、系統ごとのリンク');
w();
w('技と持ち物は、ボスへの見積もりが一番高い案（`docs/27`）。「雑魚」は雑魚 2 倍の後半の区間、「ボス」と「伝説」は地方の代表の相手。');
w();
for (const region of ['kanto', 'johto', 'hoenn']) {
  const [bossQ, bossName] = REGION_BOSS[region];
  const [legendQ, legendName] = REGION_LEGEND[region];
  w(`### ${REGION_NAME[region]}（ボス: ${bossName}／伝説: ${legendName}）`);
  w();
  w('| コード | 最初の姿 | 撮れる姿 | 技 | リンク |');
  w('|---|---|---|---|---|');
  for (const l of est.regions[region].lines) {
    if (!playables[l.key]) continue;
    const b = l.builds[0];
    if (!b) continue;
    const query = buildQuery(region, l.key, b);
    const links = [link('雑魚', query, SWARM[region]), link('ボス', query, bossQ), link('伝説', query, legendQ)].join(' ・ ');
    w(`| \`${l.key}\` | ${l.name} | ${name(b.form)} | ${movesText(b)} | ${links} |`);
  }
  w();
}
w('イーブイのほかの姿（ジョウト）:');
w();
for (const form of ['vaporeon', 'jolteon', 'flareon', 'espeon', 'umbreon']) {
  const l = est.regions.johto.lines.find((x) => x.key === 'eevee');
  const b = l.builds.find((x) => x.form === form);
  if (!b) continue;
  const sec = form === 'umbreon' ? 'section=8&spawnx=2' : SWARM.johto;
  w(`- ${name(form)}: ${link('雑魚', buildQuery('johto', 'eevee', b), sec)}（${movesText(b)}）`);
}
w();
w('## 4. 技のコード');
w();
w('`moves=` に書く。演出は「わざ見本帳」のページでも見られる。');
w();
w('| コード | 名前 | タイプ | 使える系統 |');
w('|---|---|---|---|');
for (const m of movesTable.moves) {
  const users = (m.users ?? []).map((u) => movesTable.names.pokemon?.[u] ?? name(u));
  w(`| \`${m.key}\` | ${m.name} | ${typeNames[m.type]?.names?.ja ?? m.type} | ${users.length > 8 ? users.slice(0, 8).join('・') + ' ほか' : users.join('・')} |`);
}
w();
w('## 5. 持ち物のコード');
w();
w('`items=` に書く。');
w();
w('| コード | 名前 | 最大レベル | 種類 |');
w('|---|---|---|---|');
const CATEGORY = { stat: '能力', type: 'タイプ', evolution: '進化' };
for (const [key, it] of Object.entries(items)) w(`| \`${key}\` | ${itemName(key)} | ${it.maxLevel} | ${CATEGORY[it.category] ?? it.category} |`);
w();
w('## 6. ボスのコード');
w();
w('| 地方 | `boss=`（四天王など。組のボスは相手も出る） | `legend=`（伝説） | `intruder=`（乱入） |');
w('|---|---|---|---|');
const kn = (id) => est.kindNames[id] ?? id;
const short = (id) => id.replace(/^(johto-|hoenn-)?boss-/, '').replace(/^legend-/, '').replace(/^shiny-/, '');
const BOSSES = {
  kanto: { boss: ['boss-lapras', 'boss-machamp', 'boss-gengar', 'boss-dragonite'], legend: ['legend-mewtwo', 'legend-mew', 'legend-articuno', 'legend-zapdos', 'legend-moltres', 'shiny-charizard', 'shiny-venusaur', 'shiny-blastoise'], intruder: [] },
  johto: { boss: ['johto-boss-xatu', 'johto-boss-crobat', 'johto-boss-machamp', 'johto-boss-houndoom', 'johto-boss-dragonite'], legend: ['red-pikachu', 'red-espeon', 'red-charizard', 'legend-lugia', 'legend-ho-oh'], intruder: ['legend-raikou', 'legend-entei', 'legend-suicune'] },
  hoenn: { boss: ['hoenn-boss-absol', 'hoenn-boss-dusclops', 'hoenn-boss-walrein', 'hoenn-boss-salamence', 'hoenn-boss-milotic'], legend: ['legend-groudon', 'legend-rayquaza', 'legend-deoxys'], intruder: ['legend-latias', 'legend-latios'] },
};
for (const region of ['kanto', 'johto', 'hoenn']) {
  const b = BOSSES[region];
  const cell = (ids, shiny) => ids.map((id) => `\`${short(id)}\` ${id.startsWith('shiny-') ? '色違いの' : ''}${id.startsWith('red-') ? 'レッドの' : ''}${kn(id)}`).join('<br>') || '—';
  w(`| ${REGION_NAME[region]}（\`region=${region}\`） | ${cell(b.boss)} | ${cell(b.legend)} | ${cell(b.intruder)} |`);
}
w();
w('- レッド戦: `red-pikachu` で 1 戦目から、`red-espeon` で 2 戦目（エーフィとカビゴン）、`red-charizard` で 3 戦目（御三家）から。');
w('- ホウエンの四天王は 2 体の組（アブソルとダーテング・サマヨールとジュペッタ・トドゼルガとオニゴーリ・ボーマンダとフライゴン・ミロカロスとホエルオー）。');
w('- `legend=groudon` はグラードンとカイオーガが一緒に出る。1 体だけにするなら `&solo`。');
w('- 中ボス（ジムリーダー）も `boss=` で出せる（例: `boss=onix`・`region=johto&boss=miltank`・`region=hoenn&boss=slaking`）。');
w();

fs.writeFileSync(path.join(root, 'docs/31_promo_links.md'), out.join('\n'));
console.log(`docs/31_promo_links.md を作った（${out.length} 行）`);
