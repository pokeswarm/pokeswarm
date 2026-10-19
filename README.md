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
| `npm run typecheck` | 型チェックのみ |

## 操作（現時点の技術検証版）

- 移動: WASD / 矢印キー

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
