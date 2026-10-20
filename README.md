# PokéSwarm

ポケモンを題材にしたサバイバー系（Vampire Survivors 型）のブラウザゲーム。最大4人の協力プレイ。

非公式・非営利のファンゲームです。任天堂・クリーチャーズ・ゲームフリーク・株式会社ポケモンとは関係ありません。

仕様は [docs/](docs/) を参照してください（最初に `docs/00_vision.md`）。

## 必要なもの

- Node.js 22 以上（開発は 24 で確認）
- npm

## 起動方法（Windows の PowerShell / コマンドプロンプト共通）

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
| `npm test` | テスト（シミュレーションの単体テスト）を実行 |
| `npm run bench` | シミュレーションの処理時間を敵の数ごとに計測 |
| `npm run balance` | 1ラン（15分）をシミュレーションだけで通し、御三家ごとに分ごとのレベルを出す（経験値の配分の確認） |
| `npm run pokeapi` | PokeAPI からポケモン・技・持ち物・タイプのデータを取得して `data/generated/` に出力（コミットする） |
| `npm run sprites` | SpriteCollab からスプライトを取得・変換して `public/sprites/` に出力（欠けている動作も報告） |
| `npm run typecheck` | 型チェックのみ |

## 操作（フェーズ1）

- 流れ: タイトル（Enter / クリック）→ ポケモン選択（数字キー / クリック）→ 15分のラン（途中で中ボス、15:00 でボス）→ ボスを倒せばクリア、倒れれば失敗 → 結果画面（R でもう一度、T でタイトル）
- 移動: WASD / 矢印キー
- 技: 自動で発動（最初の技はポケモンごと。ヒトカゲ: ひのこ、フシギダネ: つるのムチ、ゼニガメ: みずでっぽう）
- レベルアップ: 数字キーかクリックで選ぶ。R でリロール、X で見送る（リロール権 +1）。15秒で時間切れ（見送ると同じ）

確認用の URL パラメータ:

| パラメータ | 内容 |
|---|---|
| `?cap=3000&spawn=600` | 敵の上限と1秒あたりの出現数を一時的に変える（負荷の計測用） |
| `?pokemon=bulbasaur` | タイトルと選択を飛ばして、そのポケモンですぐに始める（charmander / bulbasaur / squirtle） |
| `?moves=ember:8,fire-spin:3` | 覚えている技とレベルを指定（技のキーは PokeAPI の英語名） |
| `?level=15` | そのレベルから始める（進化の確認用） |
| `?time=880` | ランの途中の秒数から始める（中ボス: 112・225、ボス: 900） |
| `?debug` | 詳しい情報（FPS・敵の数など）を最初から出す（ラン中は F3 で切り替え） |
| `?gallery` | プレイヤーのスプライトの待機・歩きを8方向すべて並べて表示 |

スプライトは `npm run sprites` で取得・変換したものをリポジトリに含めています（取得し直すときは同じコマンド）。

## Firebase の準備（ログイン・セーブ・協力プレイ）

1. `.env.example` を `.env.local` にコピーし、Firebase の Web アプリの設定値を入れる（`.env.local` はコミットしない）
2. Firebase コンソールで:
   - Authentication → Sign-in method: 「匿名」と「Google」を有効にする
   - Authentication → 設定 → 承認済みドメイン: 公開先（`pokeswarm.pokeswarm-dev.workers.dev` など）を追加
   - Firestore Database を作成し（場所は asia-northeast1）、ルールに `firestore.rules` の内容を貼り付けて公開する
   - Realtime Database のルールに `database.rules.json` の内容を貼り付けて公開する（協力プレイ用）
3. `npm run dev` を起動し直す

設定値が無ければ「オフライン」になり、記録はそのブラウザだけに保存されます。

公開版（Cloudflare Workers）のビルドには、Cloudflare のダッシュボードの Workers のビルド用の変数に、`.env.local` と同じ `VITE_FIREBASE_*` の7つを入れておく（値はリポジトリに入れない）。

## 2人の協力プレイ（技術検証版）

1. `.env.example` を `.env.local` にコピーし、Firebase の Web アプリの設定値を入れる（`.env.local` はコミットしない）
2. `npm run dev` を起動し直す（環境変数は起動時に読まれる）
3. 1つ目のウィンドウで `http://localhost:5173/?host` を開くと、参加用 URL が表示される
4. 2つ目のウィンドウでその URL を開くと接続して始まる

同じ PC で試すときは、タブではなく**ウィンドウを2つ並べる**と両方の動きが見られます（裏のタブもシミュレーションは進みますが、1秒ごとのカクついた動きになります）。

| URL | 内容 |
|---|---|
| `?host` | 部屋を作る（直接接続を試し、10秒でつながらなければ中継に切り替える） |
| `?host&relay` | 最初から Realtime Database の中継で始める |
| `?host&p2pfail` | 直接接続をわざと失敗させ、中継への切り替えを確かめる |
| `?join=<部屋ID>` | 部屋に入る |

左上の表示に、役割・通信の方式（直接 / 中継）・往復時間・送受信量が出ます。

## ディレクトリ

| 場所 | 内容 |
|---|---|
| `src/sim/` | シミュレーション（Phaser に依存しない。入力コマンドで固定間隔に進む） |
| `src/render/` | Phaser による描画・入力の読み取り |
| `src/scenes/` | Phaser のシーン |
| `src/data/` | `data/` の読み込みと型（スキーマ）による検証 |
| `src/i18n/` | 翻訳ファイル（日本語・英語） |
| `data/` | ゲームデータ（JSON） |
| `scripts/` | データ生成スクリプト |
| `docs/` | 仕様書 |
