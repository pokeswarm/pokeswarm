# docs/pages: 作者が見る資料ページのひな型

`docs/` の自動で作る資料（json）を、見やすいページ（claude.ai の Artifact）にするための HTML のひな型。Claude が作り直して同じ URL へ publish する。ページは非公開（作者のアカウントで開ける。ほかの人に見せるときは作者がページの「共有」から）。

| ページ | ひな型 | 元データ（作り方） | 公開先 |
|---|---|---|---|
| わざ見本帳（技の強さ・数値・派生・localhost で演出を見るリンク） | `moves.template.html` | `docs/08_moves_table.json`（`npm run moves-table`） | https://claude.ai/artifact/HPN5NrfToRy6yR9wunaKof |
| わざ図鑑（ポケモンごとの最初の技・覚える技・派生/固有技） | `learnsets.template.html` | `docs/16_learnsets.json`（`npm run learnsets`） | https://claude.ai/artifact/Q6b3TWvrzN4dJDEx22LWrn |
| 実績と解放の一覧 | `achievements.template.html` | `docs/15_achievements.json`（`npm run achievements-table`） | https://claude.ai/artifact/LsWP1fPsQxGf7ggXZHHQdP |

## 作り直し方（Claude の手順）

1. 元データを作り直す（例: `npm run moves-table`）。
2. ひな型にデータと版を流し込む: `node scripts/make-doc-page.cjs docs/pages/moves.template.html docs/08_moves_table.json <出力先>.html`（`__DATA__` に json、`__VERSION__` に `data/site.json` の `appVersion`）。
3. 出力した HTML を、上の公開先の URL へ Artifact ツールで publish する（`url` を渡す。別の会話からは先に `read`）。

技を足す・直すたびに、わざ見本帳を作り直す（作者の依頼 2026年10月30日）。報告には見本帳の URL を付ける（技ごとの localhost のリンクはページの中にある）。
