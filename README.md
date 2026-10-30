# PokéSwarm

ポケモンを題材にしたサバイバー系（Vampire Survivors 型）・ローグライトのブラウザゲーム。最大4人の協力プレイ。公開先: https://pokeswarm.org/

非公式・非営利のファンゲームです。任天堂・クリーチャーズ・ゲームフリーク・株式会社ポケモンとは関係ありません。

仕様は [docs/](docs/) を参照してください（最初に `docs/00_vision.md`、今の状態と版の番号は `docs/06_roadmap.md`）。

## 必要なもの

- Node.js 22 以上（開発は 24 で確認）
- npm

## 起動方法

```
npm install
npm run dev
```

表示された `http://localhost:5173/` をブラウザで開きます。

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバーを起動（保存すると自動で再読み込み） |
| `npm run build` | 型チェックのうえ `dist/` に本番用ファイルを出力 |
| `npm run preview` | `dist/` の内容をローカルで配信して確認 |
| `npm test` | テスト（シミュレーション・データの検証）を実行 |
| `npm run typecheck` | 型チェックのみ |
| `npm run bench` | シミュレーションの処理時間を敵の数ごとに計測 |
| `npm run balance` | 1ランをシミュレーションだけで通し、系統ごとに分ごとのレベルを出す（`BALANCE_REGION=johto BALANCE_UPGRADES=3` で地方と強化の段階） |
| `npm run balance-moves` | 技の数値を段階ごとの強さの帯にそろえる |
| `npm run moves-table` | 技の一覧表 `docs/08_moves_table.md` を作る |
| `npm run move-dps` | 技の DPS を測って `docs/14_move_dps.{md,json}` を作る |
| `npm run achievements-table` | 実績と解放の一覧 `docs/15_achievements.{md,json}` を作る |
| `npm run learnsets` | ポケモンごとの技の一覧 `docs/16_learnsets.json` を作る |
| `npm run pokeapi` | PokeAPI からポケモン・技・持ち物・タイプのデータを取得して `data/generated/` に出力（コミットする） |
| `npm run sprites` | SpriteCollab からドット絵を取得・変換して `public/sprites/` に出力 |
| `npm run map-tiles` | 地方のマップのタイルをコードで描いて `public/map/` に出力 |

## 遊び方

- タイトルのメニュー: SOLO（ソロ）・MULTI（協力プレイ）・FRIENDS（フレンド）・ACHIEVEMENTS（実績）・SHOP（フレンドリィショップ）・SETTINGS（設定）・DONATE（寄付）。クリックか ↑↓ と Enter。
- 流れ: 地方を選ぶ → ポケモンを選ぶ → ラン（区間のボスを倒して進み、最後のボスを倒すとクリア。クリアの後に伝説戦が起きることがある）→ 結果画面。
- 移動: WASD / 矢印キー（スマホは画面の左側のジョイスティック）。技は自動で出ます。
- レベルアップ: 候補から技・持ち物を選ぶ。リロールと見送りができ、候補の除外（BAN）の回数はショップで増やす。
- 協力プレイ: MULTI で部屋を作ると参加用 URL が出る。相手がその URL を開くと待合室に入る（最大4人）。Google でログインした人どうしはフレンド登録と招待ができる。同じ PC で試すときは、タブではなくウィンドウを並べる（裏のタブは画面の更新が止まる）。

## 確認用の URL パラメータ

ソロだけで効くもの（`?pokemon=` で始めたラン）:

| パラメータ | 内容 |
|---|---|
| `?pokemon=bulbasaur` | タイトルと選択を飛ばして、そのポケモンですぐに始める（キーは `data/game/playables.json`） |
| `&region=johto` | 地方を指定（無ければそのポケモンを遊べる最初の地方） |
| `&moves=ember:8,fire-spin:3` | 覚えている技とレベル（技のキーは PokeAPI の英語名） |
| `&items=pp-max:2,charcoal:3` | 持ち物とレベル |
| `&level=15` | そのレベルから始める |
| `&time=1015` | ランの途中の秒数から始める（それより前のボスは出ない） |
| `&section=3` | その区間から始める |
| `&cap=1000&spawn=180` | 敵の上限と1秒あたりの出現数 |
| `&spawnx=2` | 雑魚の出る数と上限を、ふだんの何倍かにする |
| `&legend=mewtwo` | 最初から伝説戦（`legend-<名前>`・`shiny-<名前>`・id）。`&legendafter=12` で12秒後に始める |
| `&intruder=raikou` | 少し後に伝説（三犬）が乱入する |
| `&wings` | はね（ぎんいろ・にじいろ）を最初から持っている |
| `&god` | 自分は無敵（受けたはずのダメージは数えて出す） |
| `&shiny` | 色違い（見た目だけ） |
| `&debug` | 詳しい情報（FPS・敵の数など）を最初から出す（ラン中は F3 で切り替え） |
| `&gallery` | プレイヤーのドット絵の待機・歩きを8方向すべて並べて表示 |

`?legend`・`?intruder`・`?wings`・`?god` を付けたランは記録を保存しません。

開発版（`npm run dev`）だけで効くもの:

| パラメータ | 内容 |
|---|---|
| `?unlock=all` | 全ポケモンと公開中の地方を解放済みとして選べる（セーブは変えない） |
| `?regions=all` | 未公開の地方（Coming soon）も選べる |
| `?restore=50000` | 伝説以外の実績を全部達成にし、コインをその数にする |

協力プレイ:

| パラメータ | 内容 |
|---|---|
| `?host` | 部屋を作る（直接接続を試し、10秒でつながらなければ中継に切り替える） |
| `?host&relay` | 最初から Realtime Database の中継で始める |
| `?host&p2pfail` | 直接接続をわざと失敗させ、中継への切り替えを確かめる |
| `?join=<部屋ID>` | 部屋に入る（待合室へ） |

## Firebase の準備（ログイン・セーブ・協力プレイ）

1. `.env.example` を `.env.local` にコピーし、Firebase の Web アプリの設定値を入れる（`.env.local` はコミットしない）
2. Firebase コンソールで:
   - Authentication → Sign-in method: 「匿名」と「Google」を有効にする
   - Authentication → 設定 → 承認済みドメイン: 公開先（`pokeswarm.org` など）を追加
   - Firestore Database を作成し（場所は asia-northeast1）、ルールに `firestore.rules` の内容を貼り付けて公開する
   - Realtime Database のルールに `database.rules.json` の内容を貼り付けて公開する（協力プレイ・オンライン状態・招待用）
3. `npm run dev` を起動し直す

設定値が無ければ「オフライン」になり、記録はそのブラウザだけに保存されます。

公開版（Cloudflare Workers）のビルドには、Cloudflare のダッシュボードの Workers のビルド用の変数に、`.env.local` と同じ `VITE_FIREBASE_*` の7つを入れておく（値はリポジトリに入れない）。

## ディレクトリ

| 場所 | 内容 |
|---|---|
| `src/sim/` | シミュレーション（Phaser に依存しない。入力コマンドで固定間隔に進む） |
| `src/render/` | Phaser による描画・入力の読み取り |
| `src/scenes/` | Phaser のシーンと DOM の窓 |
| `src/net/` | 協力プレイの通信（WebRTC・中継・同期） |
| `src/meta/` | セーブ・記録・実績・ショップ |
| `src/firebase/` | ログイン・Firestore・Realtime Database |
| `src/audio/` | 効果音と BGM（コードで鳴らす 8bit 音） |
| `src/data/` | `data/` の読み込みと型（スキーマ）による検証 |
| `src/i18n/` | 翻訳ファイル（6言語） |
| `data/game/` | ゲームデータ（技・持ち物・敵・ステージ・実績など） |
| `data/regions/` | 地方ごとのステージ（区間・ボス・伝説戦） |
| `data/generated/` | PokeAPI から取得したデータ |
| `data/audio/music/` | BGM の楽譜 |
| `public/sprites/`・`public/map/` | ドット絵（SpriteCollab）とマップのタイル |
| `scripts/` | データ生成スクリプト |
| `docs/` | 仕様書と決定の記録 |
