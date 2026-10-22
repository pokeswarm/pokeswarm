# 05. 公開・運営・費用

印（【決定】【初期案】【要決定】）の意味は `01_game_design.md` の冒頭を参照。

## 1. 公開の構成

| 項目 | 内容 |
|---|---|
| コード | GitHub 組織 `pokeswarm` / リポジトリ `pokeswarm` |
| 配信 | Cloudflare Workers の静的アセット配信（Workers Builds の GitHub 連携。main へのプッシュで自動公開。設定は `wrangler.jsonc`） |
| 開発中のアドレス | Cloudflare Workers の無料アドレス https://pokeswarm.pokeswarm-dev.workers.dev/ |
| 本番のアドレス | https://pokeswarm.org/ （Cloudflare で取得。2026年10月22日に取得し、Workers のカスタムドメインに設定済み） |

- 【決定】ドメインは一般公開の前に取得する。公開後にアドレスを変えると、ログイン状態やブラウザ内のデータが引き継がれず、広まったリンクも切れるため。
- プルリクエストごとのプレビュー公開を使い、本番に出す前に確認する。

## 2. Firebase

| 機能 | 用途 |
|---|---|
| Authentication | Google ログイン、匿名ログイン（ゲスト） |
| Cloud Firestore | セーブデータ、フレンド、表示名 |
| Realtime Database | オンライン状態、招待、WebRTC の接続仲介、つながらない場合の中継 |

### 2.1 プラン
- 【初期案・推奨】**Blaze プラン（従量課金）**にする。無料の Spark プランは Realtime Database の同時接続が100までのため、オンライン状態の表示や招待がそれ以上の人数で使えなくなる。
- Blaze にも Spark と同じ無料枠がある（2026年10月時点の公式料金表）。
  - Realtime Database: 同時接続 データベースあたり20万、保存 1GB、ダウンロード 1日360MB（月約10GB）まで無料、超過は1GBあたり$1
  - Firestore: 読み取り1日5万回、書き込み1日2万回、削除1日2万回、保存1GiB、転送 月10GiBまで無料
- 中継の試算: 4人・30分のランを中継すると数十MB程度。月100〜200回程度までは無料枠に収まる見込み。
- **予算アラートを設定する**（初期案: 月$5で通知）。
- 想定外の請求を防ぐため、通信量・書き込み回数を抑える設計を守る（セーブはまとめて行う、中継時は送信頻度を下げる）。

### 2.2 セキュリティルール

- `firestore.rules` を変えたら、作者が Firebase コンソール（Firestore Database → ルール）に貼り付けて公開する（自動では反映されない）。2026年10月22日: 引き継ぎコード（`transfers`）のルールを足した。
- 引き継ぎコードの期限切れの残りを消す TTL: Firestore Database → TTL で、コレクショングループ `transfers`・項目 `expireAt` のポリシーを作る（無くても期限切れは読めないので害は無いが、残り続ける）。
- 自分のセーブデータは本人だけが読み書きできる。
- フレンド・招待のデータは、関係する本人同士だけが読める。
- メールアドレスなどの個人情報は、他のプレイヤーが読める場所に置かない。

## 3. 寄付（Ko-fi）

- 【決定】（作者。2026年10月22日）タイトルのメニューに「きふ（DONATE）」を置き、寄付の窓（`src/scenes/donatePanel.ts`）から Ko-fi のページを別のタブで開く。Ko-fi のページの URL は `data/render/ui.json` の `donate.url`（空のうちはボタンが「準備中」）。
- 呼びかけ文: 完全に1人で作っていること、寄付は**サーバーの維持費とアップデートの開発**に使うこと、**寄付はゲーム内の有利に一切ならず、寄付した人だけのものも無い**こと（ゲームの中の文は6つの言語。翻訳ファイルの `donate.*`）。

### 3.1 Ko-fi の紹介欄の文（作者が Ko-fi に貼る）
日本語:
> PokéSwarm は、わたし1人で作っている非公式・非営利のポケモンのファンゲーム（ブラウザで遊べるサバイバー系・最大4人の協力プレイ）です。無料・広告なしで、だれでも遊べるように続けています。
> いただいたご支援は、協力プレイなどのサーバーの維持費と、これからのアップデートの開発に大切に使わせていただきます。
> 寄付をしても、ゲームの中で有利になることや、寄付した人だけのものは一切ありません。楽しんでいただけたら、応援していただけるととてもうれしいです。
> ※任天堂・クリーチャーズ・ゲームフリーク・株式会社ポケモンとは関係ありません。

English:
> PokéSwarm is an unofficial, non-commercial Pokémon fan game (a browser survivor-like with up to 4-player co-op), made entirely by one person. I keep it free and ad-free so that anyone can play.
> Your support goes toward the server costs (such as co-op play) and the development of future updates.
> Donations never give any in-game advantage, and there is nothing exclusive to donors. If you enjoy the game, a tip here would mean a lot to me.
> PokéSwarm is not affiliated with Nintendo, Creatures, GAME FREAK or The Pokémon Company.
- プレイ中に呼びかけを繰り返し表示しない。

## 4. 法的表記・プライバシー

ゲーム内（タイトル画面・オプション・クレジット）に次を表示する。

- 非公式・非営利のファンゲームであること。任天堂・クリーチャーズ・ゲームフリーク・株式会社ポケモンとは無関係であること。ポケモンの名称・キャラクターの権利は各権利者に帰属すること。
- 公式サイトは `pokeswarm.org` のみで、ゲームは無料であること（支払いを求める偽サイトへの注意）。
- 素材のクレジット: SpriteCollab（作者一覧・CC BY-NC 4.0）、PokeAPI、音楽・効果音・フォントの出典。
- プライバシー: 保存するデータ（表示名・セーブデータ・フレンド・オンライン状態）、Google ログイン時のメールアドレスは識別のためだけに保存し他人に表示しないこと、協力プレイでは相手のブラウザと直接接続するため IP アドレスが相手に見える可能性があること。
- アカウントとデータの削除方法。
- 権利者向けの連絡先（削除申請への対応）。

## 5. ライセンス

- 【要決定】自作コードのライセンス。
  - 素材（SpriteCollab）が非営利条件のため、ゲーム全体としては非営利で運営する。
  - コードを他人が再利用しやすくするなら MIT など、営利利用を防ぐなら非営利ライセンス（PolyForm Noncommercial など）。
- 参考にした他作品のコードを流用する場合は、そのライセンスに従い表記を残す。PokéSurvivor の場合、2026年10月14日以降の版は PolyForm Noncommercial、それ以前の版は MIT。

## 6. 削除申請への対応

- 権利者から申し入れがあった場合は、速やかに該当部分を公開停止する。
- ゲームの仕組みとキャラクターのデータ・素材を分離しておくことで、必要な部分だけを差し替え・停止できるようにする。

## 7. 無断の埋め込み・複製への対策（作者の相談 2026年10月22日）

無料・広告なしのブラウザゲームは、海賊サイトに埋め込まれたり、ファイルを丸ごとコピーされたりして、広告付きのページで配られることがある。完全には防げないので、何重かに対策する。

| | 対策 | 場所 |
|---|---|---|
| A | ほかのサイトの枠（iframe）の中では表示させない（`Content-Security-Policy: frame-ancestors 'self'`・`X-Frame-Options: SAMEORIGIN`） | `public/_headers`（Cloudflare の静的アセット配信が読む） |
| B | それでも枠の中で開かれたら、ゲームを始めずに「無断で埋め込まれています。公式サイトで遊んでください」と出す | `src/render/siteGuard.ts` |
| C | 公式以外のアドレスで動いたら、ゲームを始めずに「公式サイトではありません（無断の複製）」と出す。公式のアドレスは `data/site.json`（`pokeswarm.org`・`www`・開発用の `*.pokeswarm-dev.workers.dev`・`localhost`）。開発中（`npm run dev`）は確かめない | `src/render/siteGuard.ts`・`src/meta/officialSite.ts` |
| D | Firebase を公式のアドレスからしか使えないようにする（作者が設定済み 2026年10月22日）。コピー先では協力プレイ・ログイン・セーブが動かない | Firebase の承認済みドメイン、Google Cloud の Browser key のウェブサイトの制限 |
| E | タイトルの下に「公式サイトは https://pokeswarm.org だけ。広告の付いたページなどで遊んでいる場合は無断転載」と出す | `src/scenes/creditsPanel.ts` |

- 公式のアドレスを足すとき（新しいドメイン・別の配信先）は、`data/site.json` と、D の2か所（Firebase の承認済みドメイン・Browser key の制限）をそろえて直す。どれかが漏れると、そのアドレスでゲームが止まるかログインが失敗する。
- Browser key の制限には、ログインの画面が使う `https://<プロジェクトID>.firebaseapp.com/*` と開発用の `http://localhost:5173/*` も入れる。
- ブラウザに残るデータ（ゲストの記録）はアドレスごとなので、workers.dev で遊んだ記録は pokeswarm.org には引き継がれない（Google でログインした記録はサーバーにあるので引き継がれる）。

