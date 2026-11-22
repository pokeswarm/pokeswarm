# 宣伝の動画を撮るためのリンク集

自動で作る資料（手で直さない）。作り方: `npm run promo-links`。元は `docs/27_build_estimate.json`（系統ごとの一番強い案）なので、技を変えたら `npm run build-estimate` の後に作り直す。場面の案を変えるときは `scripts/promo-links.cjs` を直す。

- 開く前に、開発サーバー（`npm run dev`）を動かしておく。リンクはすべて localhost（本番では使わない）。
- どのリンクも **無敵（`god`）・レベル 100・技と持ち物は最大**。無敵でも画面には何も出ない。記録は保存されない。
- 始まってすぐは雑魚が少ない。雑魚の場面は 20〜30 秒待ってから撮るとよい。

## 1. おすすめの場面

### 1.1 雑魚を蹂躙する

雑魚の数はふだんの 2 倍（`spawnx=2`）。後半の区間から始める。

| 場面 | 見どころ | リンク |
|---|---|---|
| リザードン（カントー） | ★ブラストバーン の爆発で群れが消える。看板のポケモン | [雑魚 2 倍](http://localhost:5173/?pokemon=charmander&region=kanto&level=100&moves=blast-burn:8,air-slash:8,flare-blitz:8,dragon-rage:8&items=charcoal:5,sharp-beak:5,x-attack:5,metronome:5,pp-max:2,x-sp-atk:5&god&section=9&spawnx=2) |
| ピカチュウ（カントー） | ★ボルテッカー で群れを突っ切る。でんきだま | [雑魚 2 倍](http://localhost:5173/?pokemon=pikachu&region=kanto&level=100&moves=volt-tackle:8,wild-charge:8,thunderbolt:8,swift:8&items=light-ball:1,magnet:5,pp-max:2,quick-claw:5,x-attack:5,dire-hit:5&god&section=9&spawnx=2) |
| ゲンガー（カントー） | ヘドロウェーブ と シャドーボール。カントーで一番強い | [雑魚 2 倍](http://localhost:5173/?pokemon=gastly&region=kanto&level=100&moves=sludge-wave:8,sludge-bomb:8,dark-pulse:8,shadow-ball:8&items=linking-cord:1,poison-barb:5,spell-tag:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5&god&section=9&spawnx=2) |
| ミュウツー（カントー） | ★サイコブレイク。絵が一番細かい伝説 | [雑魚 2 倍](http://localhost:5173/?pokemon=mewtwo&region=kanto&level=100&moves=psystrike:8,shadow-ball:8,future-sight:8,recover:8&items=twisted-spoon:5,x-sp-atk:5,spell-tag:5,pp-max:2,metronome:5,dire-hit:5&god&section=9&spawnx=2) |
| バクフーン（ジョウト） | ★ふんか。画面いっぱいの炎 | [雑魚 2 倍](http://localhost:5173/?pokemon=cyndaquil&region=johto&level=100&moves=eruption:8,double-edge:8,body-slam:8,flare-blitz:8&items=charcoal:5,pp-max:2,silk-scarf:5,x-attack:5,metronome:5,dire-hit:5&god&section=11&spawnx=2) |
| バンギラス（ジョウト） | ストーンエッジ と あくのはどう。重い一撃 | [雑魚 2 倍](http://localhost:5173/?pokemon=larvitar&region=johto&level=100&moves=stone-edge:8,rock-blast:8,dark-pulse:8,tackle:8&items=hard-stone:5,soft-sand:5,pp-max:2,metronome:5,razor-claw:2,x-attack:5&god&section=11&spawnx=2) |
| ハッサム（ジョウト） | バレットパンチ の連打と つるぎのまい | [雑魚 2 倍](http://localhost:5173/?pokemon=scyther&region=johto&level=100&moves=bullet-punch:8,double-edge:8,aerial-ace:8,swords-dance:8&items=metal-coat:1,silk-scarf:5,razor-claw:2,x-attack:5,pp-max:2,metronome:5,dire-hit:5&god&section=11&spawnx=2) |
| エーフィ（ジョウト） | ★アシストパワー の玉の輪（作り直したばかり）。昼の区間（進化を聞かれたら「はい」） | [雑魚 2 倍](http://localhost:5173/?pokemon=eevee&region=johto&level=100&moves=stored-power:8,double-edge:8,future-sight:8,calm-mind:12&items=x-sp-atk:5,silk-scarf:5,twisted-spoon:5,metronome:5,pp-max:2,dire-hit:5&friendship&god&section=11&spawnx=2) |
| ブラッキー（ジョウト） | ★イカサマ のしっぽで薙ぐ 2 連ダッシュ。夜の区間（進化を聞かれたら「はい」） | [雑魚 2 倍](http://localhost:5173/?pokemon=eevee&region=johto&level=100&moves=foul-play-umbreon:8,snarl:8,double-edge:8,dark-pulse:8&items=black-glasses:5,silk-scarf:5,pp-max:2,metronome:5,x-attack:5,dire-hit:5&friendship&god&section=8&spawnx=2) |
| サーナイト（ホウエン） | ハイパーボイス と みらいよち（サーナイト） | [雑魚 2 倍](http://localhost:5173/?pokemon=ralts&region=hoenn&level=100&moves=hyper-voice:8,future-sight-gardevoir:8,shadow-ball:8,swift:8&items=silk-scarf:5,twisted-spoon:5,spell-tag:5,pp-max:2,metronome:5,x-sp-atk:5&god&section=11&spawnx=2) |
| バシャーモ（ホウエン） | インファイト と フレアドライブ（バシャーモ） | [雑魚 2 倍](http://localhost:5173/?pokemon=torchic&region=hoenn&level=100&moves=close-combat:16,slash:8,double-edge:8,flare-blitz:8&items=black-belt:5,silk-scarf:5,x-attack:5,pp-max:2,metronome:5,dire-hit:5&god&section=11&spawnx=2) |
| フライゴン（ホウエン） | じしん と ドラゴンダイブ（フライゴン） | [雑魚 2 倍](http://localhost:5173/?pokemon=trapinch&region=hoenn&level=100&moves=earthquake-hoenn:8,dragon-rush:8,dragon-pulse:8,swift:8&items=soft-sand:5,dragon-fang:5,metronome:5,pp-max:2,x-attack:5,dire-hit:5&god&section=11&spawnx=2) |

### 1.2 ボスと戦う

| 場面 | 見どころ | リンク |
|---|---|---|
| カイリュー 対 四天王のカイリュー | 同じポケモンどうし。四天王の部屋 | [開く](http://localhost:5173/?pokemon=dratini&region=kanto&level=100&moves=outrage:8,air-slash:8,dragon-pulse:8,swift:8&items=dragon-fang:5,sharp-beak:5,metronome:5,pp-max:2,x-sp-atk:5,dire-hit:5&god&boss=dragonite) |
| フーディン 対 四天王のゲンガー | エスパー 対 ゴースト | [開く](http://localhost:5173/?pokemon=abra&region=kanto&level=100&moves=future-sight-alakazam:8,swift:8,psybeam:8,night-shade:8&items=linking-cord:1,twisted-spoon:5,quick-claw:5,x-sp-atk:5,dire-hit:5,pp-max:2,silk-scarf:5&god&boss=gengar) |
| ミュウ 対 ミュウツー | 伝説どうし。ミュウツーの技の絵は一番細かい | [開く](http://localhost:5173/?pokemon=mew&region=kanto&level=100&moves=sacred-fire:8,metronome:8,hyper-voice:8,lock-on:8&items=silk-scarf:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5,charcoal:5&god&legend=mewtwo) |
| カメックス 対 色違いのリザードン | 御三家の対決 | [開く](http://localhost:5173/?pokemon=squirtle&region=kanto&level=100&moves=water-spout:8,hydro-cannon:8,bubble-beam:8,body-slam:8&items=mystic-water:5,silk-scarf:5,pp-max:2,metronome:5,light-clay:5,x-sp-atk:5&god&legend=charizard) |
| ピカチュウ 対 サンダー | 暗くなるマップと雷 | [開く](http://localhost:5173/?pokemon=pikachu&region=kanto&level=100&moves=volt-tackle:8,wild-charge:8,thunderbolt:8,swift:8&items=light-ball:1,magnet:5,pp-max:2,quick-claw:5,x-attack:5,dire-hit:5&god&legend=zapdos) |
| バクフーン 対 レッド | シロガネやま。ピカチュウ → エーフィとカビゴン → 御三家の 3 連戦 | [開く](http://localhost:5173/?pokemon=cyndaquil&region=johto&level=100&moves=eruption:8,double-edge:8,body-slam:8,flare-blitz:8&items=charcoal:5,pp-max:2,silk-scarf:5,x-attack:5,metronome:5,dire-hit:5&god&legend=red-pikachu) |
| オーダイル と スイクンの乱入 | 20 秒後に雑魚の中へスイクンが駆け込んでくる | [開く](http://localhost:5173/?pokemon=totodile&region=johto&level=100&moves=crunch:8,liquidation:8,water-gun:8,whirlpool:8&items=black-glasses:5,x-attack:5,mystic-water:5,metronome:5,dire-hit:5,x-sp-atk:5&god&time=300&intruder=suicune&intruderat=20) |
| バンギラス 対 ワタルのカイリュー | ジョウトの四天王の最後 | [開く](http://localhost:5173/?pokemon=larvitar&region=johto&level=100&moves=stone-edge:8,rock-blast:8,dark-pulse:8,tackle:8&items=hard-stone:5,soft-sand:5,pp-max:2,metronome:5,razor-claw:2,x-attack:5&god&boss=dragonite) |
| ラグラージ 対 グラードンとカイオーガ | 2 体同時。天気が入れ替わる | [開く](http://localhost:5173/?pokemon=mudkip&region=hoenn&level=100&moves=muddy-water-hoenn:8,mud-shot:8,wave-crash:8,water-pledge:1&items=mystic-water:5,soft-sand:5,metronome:5,pp-max:2,x-sp-atk:5,dire-hit:5&god&legend=groudon) |
| ボーマンダ 対 レックウザ | ドラゴンどうし。そらのはしら | [開く](http://localhost:5173/?pokemon=bagon&region=hoenn&level=100&moves=air-slash:8,outrage:8,dragon-pulse:8,swift:8&items=sharp-beak:5,dragon-fang:5,metronome:5,pp-max:2,x-sp-atk:5,dire-hit:5&god&legend=rayquaza) |
| ラティオス 対 デオキシス | 姿を変えるデオキシス | [開く](http://localhost:5173/?pokemon=latios&region=hoenn&level=100&moves=draco-meteor-latios:12,luster-purge-latios:12,dragon-breath-latios:12,dragon-dance-latios:12&items=x-sp-atk:5,metronome:5,dragon-fang:5,twisted-spoon:5,dire-hit:5,pp-max:2&god&legend=deoxys) |
| バシャーモ 対 ミロカロスとホエルオー | ホウエンの四天王の最後（2 体の組） | [開く](http://localhost:5173/?pokemon=torchic&region=hoenn&level=100&moves=close-combat:16,slash:8,double-edge:8,flare-blitz:8&items=black-belt:5,silk-scarf:5,x-attack:5,pp-max:2,metronome:5,dire-hit:5&god&boss=milotic) |
| ジュカイン と ラティ兄妹の乱入 | 20 秒後に 2 体が飛んでくる | [開く](http://localhost:5173/?pokemon=treecko&region=hoenn&level=100&moves=fury-cutter:8,leaf-blade:8,leaf-storm:8,grass-pledge:1&items=silver-powder:5,pp-max:2,miracle-seed:5,metronome:5,x-attack:5,dire-hit:5&god&time=300&intruder=latias&intruderat=20) |

### 1.3 最後の場面: ルギア 対 ホウオウ

- [すぐホウオウ戦](http://localhost:5173/?pokemon=lugia&region=johto&level=100&moves=aeroblast-lugia:12,hydro-pump-lugia:12,extrasensory-lugia:12,gust-lugia:12&items=x-sp-atk:5,metronome:5,sharp-beak:5,dire-hit:5,twisted-spoon:5,pp-max:2&god&legend=ho-oh)（固定マップで 1 対 1）
- [雑魚の中から 8 秒後にホウオウ戦](http://localhost:5173/?pokemon=lugia&region=johto&level=100&moves=aeroblast-lugia:12,hydro-pump-lugia:12,extrasensory-lugia:12,gust-lugia:12&items=x-sp-atk:5,metronome:5,sharp-beak:5,dire-hit:5,twisted-spoon:5,pp-max:2&god&legend=ho-oh&legendafter=8&spawnx=2&section=11)（雑魚を蹴散らしているところに「DANGER」が出て、戦いへ切り替わる。動画の締めに向く）
- 逆の組: [ホウオウ 対 ルギア](http://localhost:5173/?pokemon=ho-oh&region=johto&level=100&moves=sky-attack-hooh:12,sacred-fire-hooh:12,gust-hooh:12,recover-hooh:12&items=x-attack:5,metronome:5,sharp-beak:5,charcoal:5,dire-hit:5,pp-max:2&god&legend=lugia)
- ルギアの技: エアロブラスト・ハイドロポンプ・じんつうりき・かぜおこし

## 2. 自分でリンクを作る

`http://localhost:5173/?` の後ろに、下の部品を `&` でつなぐ。

| 部品 | 意味 | 例 |
|---|---|---|
| `pokemon=コード` | 遊ぶポケモン（3章のコード。最初の姿で書く） | `pokemon=charmander` |
| `region=コード` | 地方（`kanto`・`johto`・`hoenn`）。雑魚・ボス・マップが変わる | `region=johto` |
| `level=数` | そのレベルから始める（レベルで進化する姿は最初から進化している） | `level=100` |
| `moves=技:レベル,…` | 技（4 つまで。4章のコード。レベルは最大 8、伝説の技は 12。大きすぎる数は最大に丸める） | `moves=blast-burn:8,air-slash:8` |
| `items=持ち物:レベル,…` | 持ち物（5章のコード）。進化の石・つながりのヒモなどを入れるとすぐ進化する | `items=charcoal:5,fire-stone:1` |
| `friendship` | なつきの進化（クロバット・トゲチック・ピカチュウ（ピチューから）など）をすぐ起こす。イーブイは昼の区間でエーフィ、夜の区間でブラッキーを聞かれる | `friendship` |
| `god` | 無敵（画面に何も出ない）。記録を保存しない | `god` |
| `section=数` | その区間から始める（カントー 0〜12、ジョウト・ホウエン 0〜15。場所と雑魚が変わる。ジョウトの夜は 2・5・7・8） | `section=9` |
| `time=秒` | ランの途中の時刻から始める | `time=300` |
| `spawnx=倍` | 雑魚の数を何倍かにする | `spawnx=2` |
| `boss=コード` | そのボス（四天王など）の区間から始めて、すぐ出す（6章） | `boss=dragonite` |
| `legend=コード` | 最初から伝説と戦う（6章） | `legend=mewtwo` |
| `legendafter=秒` | `legend=` の戦いを、その秒数だけ雑魚と戦ってから始める | `legendafter=8` |
| `solo` | `legend=` で、同時に出る相手を出さない（グラードンだけ、など） | `solo` |
| `intruder=コード`・`intruderat=秒` | 乱入する伝説（三犬・ラティ兄妹）を、その秒数の後に出す（`time=300` と一緒に） | `intruder=suicune&intruderat=20` |
| `wings` | はねを持っている（レッドに勝つとルギア → ホウオウへ続く） | `wings` |
| `shiny` | 色違い（見た目だけ） | `shiny` |

## 3. キャラのコードと、系統ごとのリンク

技と持ち物は、ボスへの見積もりが一番高い案（`docs/27`）。「雑魚」は雑魚 2 倍の後半の区間、「ボス」と「伝説」は地方の代表の相手。

### カントー（ボス: カイリュー／伝説: ミュウツー）

| コード | 最初の姿 | 撮れる姿 | 技 | リンク |
|---|---|---|---|---|
| `charmander` | ヒトカゲ | リザードン | ブラストバーン・エアスラッシュ・フレアドライブ・りゅうのいかり | [雑魚](http://localhost:5173/?pokemon=charmander&region=kanto&level=100&moves=blast-burn:8,air-slash:8,flare-blitz:8,dragon-rage:8&items=charcoal:5,sharp-beak:5,x-attack:5,metronome:5,pp-max:2,x-sp-atk:5&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=charmander&region=kanto&level=100&moves=blast-burn:8,air-slash:8,flare-blitz:8,dragon-rage:8&items=charcoal:5,sharp-beak:5,x-attack:5,metronome:5,pp-max:2,x-sp-atk:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=charmander&region=kanto&level=100&moves=blast-burn:8,air-slash:8,flare-blitz:8,dragon-rage:8&items=charcoal:5,sharp-beak:5,x-attack:5,metronome:5,pp-max:2,x-sp-atk:5&god&legend=mewtwo) |
| `bulbasaur` | フシギダネ | フシギバナ | はっぱカッター・ヘドロばくだん・ギガドレイン・のしかかり | [雑魚](http://localhost:5173/?pokemon=bulbasaur&region=kanto&level=100&moves=razor-leaf:8,sludge-bomb:8,giga-drain:8,body-slam:8&items=miracle-seed:5,poison-barb:5,silk-scarf:5,pp-max:2,metronome:5,x-attack:5&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=bulbasaur&region=kanto&level=100&moves=razor-leaf:8,sludge-bomb:8,giga-drain:8,body-slam:8&items=miracle-seed:5,poison-barb:5,silk-scarf:5,pp-max:2,metronome:5,x-attack:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=bulbasaur&region=kanto&level=100&moves=razor-leaf:8,sludge-bomb:8,giga-drain:8,body-slam:8&items=miracle-seed:5,poison-barb:5,silk-scarf:5,pp-max:2,metronome:5,x-attack:5&god&legend=mewtwo) |
| `squirtle` | ゼニガメ | カメックス | しおふき・ハイドロカノン・バブルこうせん・のしかかり | [雑魚](http://localhost:5173/?pokemon=squirtle&region=kanto&level=100&moves=water-spout:8,hydro-cannon:8,bubble-beam:8,body-slam:8&items=mystic-water:5,silk-scarf:5,pp-max:2,metronome:5,light-clay:5,x-sp-atk:5&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=squirtle&region=kanto&level=100&moves=water-spout:8,hydro-cannon:8,bubble-beam:8,body-slam:8&items=mystic-water:5,silk-scarf:5,pp-max:2,metronome:5,light-clay:5,x-sp-atk:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=squirtle&region=kanto&level=100&moves=water-spout:8,hydro-cannon:8,bubble-beam:8,body-slam:8&items=mystic-water:5,silk-scarf:5,pp-max:2,metronome:5,light-clay:5,x-sp-atk:5&god&legend=mewtwo) |
| `onix` | イワーク | イワーク | ストーンエッジ・ロックブラスト・のしかかり・マグニチュード | [雑魚](http://localhost:5173/?pokemon=onix&region=kanto&level=100&moves=stone-edge:8,rock-blast:8,body-slam:8,magnitude:8&items=hard-stone:5,pp-max:2,silk-scarf:5,metronome:5,x-attack:5,razor-claw:2&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=onix&region=kanto&level=100&moves=stone-edge:8,rock-blast:8,body-slam:8,magnitude:8&items=hard-stone:5,pp-max:2,silk-scarf:5,metronome:5,x-attack:5,razor-claw:2&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=onix&region=kanto&level=100&moves=stone-edge:8,rock-blast:8,body-slam:8,magnitude:8&items=hard-stone:5,pp-max:2,silk-scarf:5,metronome:5,x-attack:5,razor-claw:2&god&legend=mewtwo) |
| `staryu` | ヒトデマン | スターミー | こうそくスピン・バブルこうせん・スピードスター・ハイドロポンプ | [雑魚](http://localhost:5173/?pokemon=staryu&region=kanto&level=100&moves=rapid-spin:8,bubble-beam:8,swift:8,hydro-pump:8&items=water-stone:1,metronome:5,mystic-water:5,pp-max:2,silk-scarf:5,x-attack:5,dire-hit:5&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=staryu&region=kanto&level=100&moves=rapid-spin:8,bubble-beam:8,swift:8,hydro-pump:8&items=water-stone:1,metronome:5,mystic-water:5,pp-max:2,silk-scarf:5,x-attack:5,dire-hit:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=staryu&region=kanto&level=100&moves=rapid-spin:8,bubble-beam:8,swift:8,hydro-pump:8&items=water-stone:1,metronome:5,mystic-water:5,pp-max:2,silk-scarf:5,x-attack:5,dire-hit:5&god&legend=mewtwo) |
| `pikachu` | ピカチュウ | ピカチュウ | ボルテッカー・ワイルドボルト・１０まんボルト・スピードスター | [雑魚](http://localhost:5173/?pokemon=pikachu&region=kanto&level=100&moves=volt-tackle:8,wild-charge:8,thunderbolt:8,swift:8&items=light-ball:1,magnet:5,pp-max:2,quick-claw:5,x-attack:5,dire-hit:5&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=pikachu&region=kanto&level=100&moves=volt-tackle:8,wild-charge:8,thunderbolt:8,swift:8&items=light-ball:1,magnet:5,pp-max:2,quick-claw:5,x-attack:5,dire-hit:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=pikachu&region=kanto&level=100&moves=volt-tackle:8,wild-charge:8,thunderbolt:8,swift:8&items=light-ball:1,magnet:5,pp-max:2,quick-claw:5,x-attack:5,dire-hit:5&god&legend=mewtwo) |
| `oddish` | ナゾノクサ | ラフレシア | はなびらのまい・はっぱカッター・ヘドロばくだん・ねむりごな | [雑魚](http://localhost:5173/?pokemon=oddish&region=kanto&level=100&moves=petal-dance:8,razor-leaf:8,sludge-bomb:8,sleep-powder:8&items=leaf-stone:1,miracle-seed:5,wide-lens:5,poison-barb:5,metronome:5,pp-max:2,x-sp-atk:5&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=oddish&region=kanto&level=100&moves=petal-dance:8,razor-leaf:8,sludge-bomb:8,sleep-powder:8&items=leaf-stone:1,miracle-seed:5,wide-lens:5,poison-barb:5,metronome:5,pp-max:2,x-sp-atk:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=oddish&region=kanto&level=100&moves=petal-dance:8,razor-leaf:8,sludge-bomb:8,sleep-powder:8&items=leaf-stone:1,miracle-seed:5,wide-lens:5,poison-barb:5,metronome:5,pp-max:2,x-sp-atk:5&god&legend=mewtwo) |
| `koffing` | ドガース | マタドガス | ヘドロウェーブ・だいばくはつ・ヘドロばくだん・サイケこうせん | [雑魚](http://localhost:5173/?pokemon=koffing&region=kanto&level=100&moves=sludge-wave:8,explosion:8,sludge-bomb:8,psybeam:8&items=poison-barb:5,silk-scarf:5,hp-up:5,pp-max:2,metronome:5,x-sp-atk:5&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=koffing&region=kanto&level=100&moves=sludge-wave:8,explosion:8,sludge-bomb:8,psybeam:8&items=poison-barb:5,silk-scarf:5,hp-up:5,pp-max:2,metronome:5,x-sp-atk:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=koffing&region=kanto&level=100&moves=sludge-wave:8,explosion:8,sludge-bomb:8,psybeam:8&items=poison-barb:5,silk-scarf:5,hp-up:5,pp-max:2,metronome:5,x-sp-atk:5&god&legend=mewtwo) |
| `abra` | ケーシィ | フーディン | みらいよち・スピードスター・サイケこうせん・ナイトヘッド | [雑魚](http://localhost:5173/?pokemon=abra&region=kanto&level=100&moves=future-sight-alakazam:8,swift:8,psybeam:8,night-shade:8&items=linking-cord:1,twisted-spoon:5,quick-claw:5,x-sp-atk:5,dire-hit:5,pp-max:2,silk-scarf:5&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=abra&region=kanto&level=100&moves=future-sight-alakazam:8,swift:8,psybeam:8,night-shade:8&items=linking-cord:1,twisted-spoon:5,quick-claw:5,x-sp-atk:5,dire-hit:5,pp-max:2,silk-scarf:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=abra&region=kanto&level=100&moves=future-sight-alakazam:8,swift:8,psybeam:8,night-shade:8&items=linking-cord:1,twisted-spoon:5,quick-claw:5,x-sp-atk:5,dire-hit:5,pp-max:2,silk-scarf:5&god&legend=mewtwo) |
| `growlithe` | ガーディ | ウインディ | すてみタックル・フレアドライブ・スピードスター・ほのおのうず | [雑魚](http://localhost:5173/?pokemon=growlithe&region=kanto&level=100&moves=double-edge:8,flare-blitz:8,swift:8,fire-spin:8&items=fire-stone:1,silk-scarf:5,x-attack:5,pp-max:2,metronome:5,light-clay:5,charcoal:5&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=growlithe&region=kanto&level=100&moves=double-edge:8,flare-blitz:8,swift:8,fire-spin:8&items=fire-stone:1,silk-scarf:5,x-attack:5,pp-max:2,metronome:5,light-clay:5,charcoal:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=growlithe&region=kanto&level=100&moves=double-edge:8,flare-blitz:8,swift:8,fire-spin:8&items=fire-stone:1,silk-scarf:5,x-attack:5,pp-max:2,metronome:5,light-clay:5,charcoal:5&god&legend=mewtwo) |
| `rhyhorn` | サイホーン | サイドン | ロックブラスト・じわれ・のしかかり・いわおとし | [雑魚](http://localhost:5173/?pokemon=rhyhorn&region=kanto&level=100&moves=rock-blast:8,fissure:8,body-slam:8,rock-throw:8&items=pp-max:2,soft-sand:5,x-defense:5,silk-scarf:5,metronome:5,wide-lens:5&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=rhyhorn&region=kanto&level=100&moves=rock-blast:8,fissure:8,body-slam:8,rock-throw:8&items=pp-max:2,soft-sand:5,x-defense:5,silk-scarf:5,metronome:5,wide-lens:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=rhyhorn&region=kanto&level=100&moves=rock-blast:8,fissure:8,body-slam:8,rock-throw:8&items=pp-max:2,soft-sand:5,x-defense:5,silk-scarf:5,metronome:5,wide-lens:5&god&legend=mewtwo) |
| `lapras` | ラプラス | ラプラス | ハイパーボイス・のしかかり・こおりのつぶて・こなゆき | [雑魚](http://localhost:5173/?pokemon=lapras&region=kanto&level=100&moves=hyper-voice:8,body-slam:8,ice-shard:8,powder-snow:8&items=silk-scarf:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5,x-attack:5&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=lapras&region=kanto&level=100&moves=hyper-voice:8,body-slam:8,ice-shard:8,powder-snow:8&items=silk-scarf:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5,x-attack:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=lapras&region=kanto&level=100&moves=hyper-voice:8,body-slam:8,ice-shard:8,powder-snow:8&items=silk-scarf:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5,x-attack:5&god&legend=mewtwo) |
| `machop` | ワンリキー | カイリキー | ばくれつパンチ・ほのおのパンチ・かみなりパンチ | [雑魚](http://localhost:5173/?pokemon=machop&region=kanto&level=100&moves=dynamic-punch:8,fire-punch:8,thunder-punch:8&items=linking-cord:1,dire-hit:5,fire-stone:1,thunder-stone:1,black-belt:5,x-attack:5,pp-max:2&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=machop&region=kanto&level=100&moves=dynamic-punch:8,fire-punch:8,thunder-punch:8&items=linking-cord:1,dire-hit:5,fire-stone:1,thunder-stone:1,black-belt:5,x-attack:5,pp-max:2&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=machop&region=kanto&level=100&moves=dynamic-punch:8,fire-punch:8,thunder-punch:8&items=linking-cord:1,dire-hit:5,fire-stone:1,thunder-stone:1,black-belt:5,x-attack:5,pp-max:2&god&legend=mewtwo) |
| `gastly` | ゴース | ゲンガー | ヘドロウェーブ・ヘドロばくだん・あくのはどう・シャドーボール | [雑魚](http://localhost:5173/?pokemon=gastly&region=kanto&level=100&moves=sludge-wave:8,sludge-bomb:8,dark-pulse:8,shadow-ball:8&items=linking-cord:1,poison-barb:5,spell-tag:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=gastly&region=kanto&level=100&moves=sludge-wave:8,sludge-bomb:8,dark-pulse:8,shadow-ball:8&items=linking-cord:1,poison-barb:5,spell-tag:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=gastly&region=kanto&level=100&moves=sludge-wave:8,sludge-bomb:8,dark-pulse:8,shadow-ball:8&items=linking-cord:1,poison-barb:5,spell-tag:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5&god&legend=mewtwo) |
| `dratini` | ミニリュウ | カイリュー | げきりん・エアスラッシュ・りゅうのはどう・スピードスター | [雑魚](http://localhost:5173/?pokemon=dratini&region=kanto&level=100&moves=outrage:8,air-slash:8,dragon-pulse:8,swift:8&items=dragon-fang:5,sharp-beak:5,metronome:5,pp-max:2,x-sp-atk:5,dire-hit:5&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=dratini&region=kanto&level=100&moves=outrage:8,air-slash:8,dragon-pulse:8,swift:8&items=dragon-fang:5,sharp-beak:5,metronome:5,pp-max:2,x-sp-atk:5,dire-hit:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=dratini&region=kanto&level=100&moves=outrage:8,air-slash:8,dragon-pulse:8,swift:8&items=dragon-fang:5,sharp-beak:5,metronome:5,pp-max:2,x-sp-atk:5,dire-hit:5&god&legend=mewtwo) |
| `psyduck` | コダック | コダック | しねんのずつき・バブルこうせん・スピードスター・ねんりき | [雑魚](http://localhost:5173/?pokemon=psyduck&region=kanto&level=100&moves=zen-headbutt:8,bubble-beam:8,swift:8,confusion:8&items=silk-scarf:5,twisted-spoon:5,mystic-water:5,metronome:5,x-attack:5,dire-hit:5&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=psyduck&region=kanto&level=100&moves=zen-headbutt:8,bubble-beam:8,swift:8,confusion:8&items=silk-scarf:5,twisted-spoon:5,mystic-water:5,metronome:5,x-attack:5,dire-hit:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=psyduck&region=kanto&level=100&moves=zen-headbutt:8,bubble-beam:8,swift:8,confusion:8&items=silk-scarf:5,twisted-spoon:5,mystic-water:5,metronome:5,x-attack:5,dire-hit:5&god&legend=mewtwo) |
| `jigglypuff` | プリン | プクリン | おうふくビンタ・エコーボイス・チャームボイス・あまえる | [雑魚](http://localhost:5173/?pokemon=jigglypuff&region=kanto&level=100&moves=double-slap:8,echoed-voice:8,disarming-voice:8,charm:8&items=moon-stone:1,x-attack:5,metronome:5,silk-scarf:5,pp-max:2,x-sp-atk:5,dire-hit:5&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=jigglypuff&region=kanto&level=100&moves=double-slap:8,echoed-voice:8,disarming-voice:8,charm:8&items=moon-stone:1,x-attack:5,metronome:5,silk-scarf:5,pp-max:2,x-sp-atk:5,dire-hit:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=jigglypuff&region=kanto&level=100&moves=double-slap:8,echoed-voice:8,disarming-voice:8,charm:8&items=moon-stone:1,x-attack:5,metronome:5,silk-scarf:5,pp-max:2,x-sp-atk:5,dire-hit:5&god&legend=mewtwo) |
| `slowpoke` | ヤドン | ヤドラン | しねんのずつき・バブルこうせん・スピードスター・なまける | [雑魚](http://localhost:5173/?pokemon=slowpoke&region=kanto&level=100&moves=zen-headbutt:8,bubble-beam:8,swift:8,slack-off:8&items=silk-scarf:5,twisted-spoon:5,mystic-water:5,metronome:5,x-attack:5,dire-hit:5&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=slowpoke&region=kanto&level=100&moves=zen-headbutt:8,bubble-beam:8,swift:8,slack-off:8&items=silk-scarf:5,twisted-spoon:5,mystic-water:5,metronome:5,x-attack:5,dire-hit:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=slowpoke&region=kanto&level=100&moves=zen-headbutt:8,bubble-beam:8,swift:8,slack-off:8&items=silk-scarf:5,twisted-spoon:5,mystic-water:5,metronome:5,x-attack:5,dire-hit:5&god&legend=mewtwo) |
| `snorlax` | カビゴン | カビゴン | ギガインパクト・あくび・ねむる・いびき | [雑魚](http://localhost:5173/?pokemon=snorlax&region=kanto&level=100&moves=giga-impact:8,yawn:8,rest:1,snore:8&items=silk-scarf:5,hp-up:5,pp-max:2,x-attack:5,metronome:5,dire-hit:5&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=snorlax&region=kanto&level=100&moves=giga-impact:8,yawn:8,rest:1,snore:8&items=silk-scarf:5,hp-up:5,pp-max:2,x-attack:5,metronome:5,dire-hit:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=snorlax&region=kanto&level=100&moves=giga-impact:8,yawn:8,rest:1,snore:8&items=silk-scarf:5,hp-up:5,pp-max:2,x-attack:5,metronome:5,dire-hit:5&god&legend=mewtwo) |
| `eevee` | イーブイ | ブースター | やけっぱち・ニトロチャージ・すてみタックル・スピードスター | [雑魚](http://localhost:5173/?pokemon=eevee&region=kanto&level=100&moves=temper-flare:8,flame-charge:8,double-edge:8,swift:8&items=fire-stone:1,charcoal:5,silk-scarf:5,pp-max:2,metronome:5,x-attack:5,dire-hit:5&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=eevee&region=kanto&level=100&moves=temper-flare:8,flame-charge:8,double-edge:8,swift:8&items=fire-stone:1,charcoal:5,silk-scarf:5,pp-max:2,metronome:5,x-attack:5,dire-hit:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=eevee&region=kanto&level=100&moves=temper-flare:8,flame-charge:8,double-edge:8,swift:8&items=fire-stone:1,charcoal:5,silk-scarf:5,pp-max:2,metronome:5,x-attack:5,dire-hit:5&god&legend=mewtwo) |
| `doduo` | ドードー | ドードリオ | トライアタック・すてみタックル・つばさでうつ・エアカッター | [雑魚](http://localhost:5173/?pokemon=doduo&region=kanto&level=100&moves=tri-attack:8,double-edge:8,wing-attack:8,air-cutter:8&items=sharp-beak:5,silk-scarf:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=doduo&region=kanto&level=100&moves=tri-attack:8,double-edge:8,wing-attack:8,air-cutter:8&items=sharp-beak:5,silk-scarf:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=doduo&region=kanto&level=100&moves=tri-attack:8,double-edge:8,wing-attack:8,air-cutter:8&items=sharp-beak:5,silk-scarf:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5&god&legend=mewtwo) |
| `meowth` | ニャース | ニャース | ハイパーボイス・きりさく・すてみタックル・のしかかり | [雑魚](http://localhost:5173/?pokemon=meowth&region=kanto&level=100&moves=hyper-voice:8,slash:8,double-edge:8,body-slam:8&items=silk-scarf:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5,x-attack:5&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=meowth&region=kanto&level=100&moves=hyper-voice:8,slash:8,double-edge:8,body-slam:8&items=silk-scarf:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5,x-attack:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=meowth&region=kanto&level=100&moves=hyper-voice:8,slash:8,double-edge:8,body-slam:8&items=silk-scarf:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5,x-attack:5&god&legend=mewtwo) |
| `porygon` | ポリゴン | ポリゴン | トライアタック・かくばる・テクスチャー・ロックオン | [雑魚](http://localhost:5173/?pokemon=porygon&region=kanto&level=100&moves=tri-attack:8,sharpen:8,conversion:8,lock-on:8&items=silk-scarf:5,x-sp-atk:5,dire-hit:5,metronome:5,pp-max:2&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=porygon&region=kanto&level=100&moves=tri-attack:8,sharpen:8,conversion:8,lock-on:8&items=silk-scarf:5,x-sp-atk:5,dire-hit:5,metronome:5,pp-max:2&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=porygon&region=kanto&level=100&moves=tri-attack:8,sharpen:8,conversion:8,lock-on:8&items=silk-scarf:5,x-sp-atk:5,dire-hit:5,metronome:5,pp-max:2&god&legend=mewtwo) |
| `scyther` | ストライク | ストライク | れんぞくぎり・エアスラッシュ・すてみタックル・ダブルウイング | [雑魚](http://localhost:5173/?pokemon=scyther&region=kanto&level=100&moves=fury-cutter:8,air-slash:8,double-edge:8,dual-wingbeat:8&items=silver-powder:5,sharp-beak:5,silk-scarf:5,metronome:5,pp-max:2,x-attack:5&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=scyther&region=kanto&level=100&moves=fury-cutter:8,air-slash:8,double-edge:8,dual-wingbeat:8&items=silver-powder:5,sharp-beak:5,silk-scarf:5,metronome:5,pp-max:2,x-attack:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=scyther&region=kanto&level=100&moves=fury-cutter:8,air-slash:8,double-edge:8,dual-wingbeat:8&items=silver-powder:5,sharp-beak:5,silk-scarf:5,metronome:5,pp-max:2,x-attack:5&god&legend=mewtwo) |
| `magnemite` | コイル | レアコイル | ラスターカノン・ワイルドボルト・スピードスター・たいあたり | [雑魚](http://localhost:5173/?pokemon=magnemite&region=kanto&level=100&moves=flash-cannon:8,wild-charge:8,swift:8,tackle:8&items=magnet:5,zoom-lens:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=magnemite&region=kanto&level=100&moves=flash-cannon:8,wild-charge:8,swift:8,tackle:8&items=magnet:5,zoom-lens:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=magnemite&region=kanto&level=100&moves=flash-cannon:8,wild-charge:8,swift:8,tackle:8&items=magnet:5,zoom-lens:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5&god&legend=mewtwo) |
| `mewtwo` | ミュウツー | ミュウツー | サイコブレイク・シャドーボール・みらいよち・じこさいせい | [雑魚](http://localhost:5173/?pokemon=mewtwo&region=kanto&level=100&moves=psystrike:8,shadow-ball:8,future-sight:8,recover:8&items=twisted-spoon:5,x-sp-atk:5,spell-tag:5,pp-max:2,metronome:5,dire-hit:5&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=mewtwo&region=kanto&level=100&moves=psystrike:8,shadow-ball:8,future-sight:8,recover:8&items=twisted-spoon:5,x-sp-atk:5,spell-tag:5,pp-max:2,metronome:5,dire-hit:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=mewtwo&region=kanto&level=100&moves=psystrike:8,shadow-ball:8,future-sight:8,recover:8&items=twisted-spoon:5,x-sp-atk:5,spell-tag:5,pp-max:2,metronome:5,dire-hit:5&god&legend=mewtwo) |
| `mew` | ミュウ | ミュウ | せいなるほのお・ゆびをふる・ハイパーボイス・ロックオン | [雑魚](http://localhost:5173/?pokemon=mew&region=kanto&level=100&moves=sacred-fire:8,metronome:8,hyper-voice:8,lock-on:8&items=silk-scarf:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5,charcoal:5&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=mew&region=kanto&level=100&moves=sacred-fire:8,metronome:8,hyper-voice:8,lock-on:8&items=silk-scarf:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5,charcoal:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=mew&region=kanto&level=100&moves=sacred-fire:8,metronome:8,hyper-voice:8,lock-on:8&items=silk-scarf:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5,charcoal:5&god&legend=mewtwo) |
| `articuno` | フリーザー | フリーザー | フリーズドライ・こごえるかぜ・ふぶき・こおりのつぶて | [雑魚](http://localhost:5173/?pokemon=articuno&region=kanto&level=100&moves=freeze-dry-articuno:12,icy-wind-articuno:12,blizzard-articuno:12,ice-shard-articuno:12&items=never-melt-ice:5,metronome:5,x-sp-atk:5,dire-hit:5,pp-max:2,wide-lens:5&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=articuno&region=kanto&level=100&moves=freeze-dry-articuno:12,icy-wind-articuno:12,blizzard-articuno:12,ice-shard-articuno:12&items=never-melt-ice:5,metronome:5,x-sp-atk:5,dire-hit:5,pp-max:2,wide-lens:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=articuno&region=kanto&level=100&moves=freeze-dry-articuno:12,icy-wind-articuno:12,blizzard-articuno:12,ice-shard-articuno:12&items=never-melt-ice:5,metronome:5,x-sp-atk:5,dire-hit:5,pp-max:2,wide-lens:5&god&legend=mewtwo) |
| `zapdos` | サンダー | サンダー | でんじほう・１０まんボルト・ドリルくちばし・でんきショック | [雑魚](http://localhost:5173/?pokemon=zapdos&region=kanto&level=100&moves=zap-cannon-zapdos:12,thunderbolt-zapdos:12,drill-peck-zapdos:12,thunder-shock-zapdos:12&items=magnet:5,metronome:5,x-sp-atk:5,dire-hit:5,sharp-beak:5,x-attack:5&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=zapdos&region=kanto&level=100&moves=zap-cannon-zapdos:12,thunderbolt-zapdos:12,drill-peck-zapdos:12,thunder-shock-zapdos:12&items=magnet:5,metronome:5,x-sp-atk:5,dire-hit:5,sharp-beak:5,x-attack:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=zapdos&region=kanto&level=100&moves=zap-cannon-zapdos:12,thunderbolt-zapdos:12,drill-peck-zapdos:12,thunder-shock-zapdos:12&items=magnet:5,metronome:5,x-sp-atk:5,dire-hit:5,sharp-beak:5,x-attack:5&god&legend=mewtwo) |
| `moltres` | ファイヤー | ファイヤー | ゴッドバード・ねっぷう・もえつきる・ひのこ | [雑魚](http://localhost:5173/?pokemon=moltres&region=kanto&level=100&moves=sky-attack-moltres:12,heat-wave-moltres:12,burn-up-moltres:12,ember-moltres:12&items=metronome:5,charcoal:5,sharp-beak:5,x-sp-atk:5,dire-hit:5,x-attack:5&god&section=9&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=moltres&region=kanto&level=100&moves=sky-attack-moltres:12,heat-wave-moltres:12,burn-up-moltres:12,ember-moltres:12&items=metronome:5,charcoal:5,sharp-beak:5,x-sp-atk:5,dire-hit:5,x-attack:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=moltres&region=kanto&level=100&moves=sky-attack-moltres:12,heat-wave-moltres:12,burn-up-moltres:12,ember-moltres:12&items=metronome:5,charcoal:5,sharp-beak:5,x-sp-atk:5,dire-hit:5,x-attack:5&god&legend=mewtwo) |

### ジョウト（ボス: カイリュー／伝説: ルギア）

| コード | 最初の姿 | 撮れる姿 | 技 | リンク |
|---|---|---|---|---|
| `cyndaquil` | ヒノアラシ | バクフーン | ふんか・すてみタックル・のしかかり・フレアドライブ | [雑魚](http://localhost:5173/?pokemon=cyndaquil&region=johto&level=100&moves=eruption:8,double-edge:8,body-slam:8,flare-blitz:8&items=charcoal:5,pp-max:2,silk-scarf:5,x-attack:5,metronome:5,dire-hit:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=cyndaquil&region=johto&level=100&moves=eruption:8,double-edge:8,body-slam:8,flare-blitz:8&items=charcoal:5,pp-max:2,silk-scarf:5,x-attack:5,metronome:5,dire-hit:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=cyndaquil&region=johto&level=100&moves=eruption:8,double-edge:8,body-slam:8,flare-blitz:8&items=charcoal:5,pp-max:2,silk-scarf:5,x-attack:5,metronome:5,dire-hit:5&god&legend=lugia) |
| `chikorita` | チコリータ | メガニウム | はっぱカッター・ソーラービーム・ギガドレイン・のしかかり | [雑魚](http://localhost:5173/?pokemon=chikorita&region=johto&level=100&moves=razor-leaf:8,solar-beam:8,giga-drain:8,body-slam:8&items=miracle-seed:5,zoom-lens:5,silk-scarf:5,pp-max:2,metronome:5,light-clay:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=chikorita&region=johto&level=100&moves=razor-leaf:8,solar-beam:8,giga-drain:8,body-slam:8&items=miracle-seed:5,zoom-lens:5,silk-scarf:5,pp-max:2,metronome:5,light-clay:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=chikorita&region=johto&level=100&moves=razor-leaf:8,solar-beam:8,giga-drain:8,body-slam:8&items=miracle-seed:5,zoom-lens:5,silk-scarf:5,pp-max:2,metronome:5,light-clay:5&god&legend=lugia) |
| `totodile` | ワニノコ | オーダイル | かみくだく・アクアブレイク・みずでっぽう・うずしお | [雑魚](http://localhost:5173/?pokemon=totodile&region=johto&level=100&moves=crunch:8,liquidation:8,water-gun:8,whirlpool:8&items=black-glasses:5,x-attack:5,mystic-water:5,metronome:5,dire-hit:5,x-sp-atk:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=totodile&region=johto&level=100&moves=crunch:8,liquidation:8,water-gun:8,whirlpool:8&items=black-glasses:5,x-attack:5,mystic-water:5,metronome:5,dire-hit:5,x-sp-atk:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=totodile&region=johto&level=100&moves=crunch:8,liquidation:8,water-gun:8,whirlpool:8&items=black-glasses:5,x-attack:5,mystic-water:5,metronome:5,dire-hit:5,x-sp-atk:5&god&legend=lugia) |
| `pichu` | ピチュー | ピカチュウ | ボルテッカー・ワイルドボルト・１０まんボルト・スピードスター | [雑魚](http://localhost:5173/?pokemon=pichu&region=johto&level=100&moves=volt-tackle:8,wild-charge:8,thunderbolt:8,swift:8&items=light-ball:1,magnet:5,pp-max:2,x-attack:5,dire-hit:5,metronome:5&friendship&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=pichu&region=johto&level=100&moves=volt-tackle:8,wild-charge:8,thunderbolt:8,swift:8&items=light-ball:1,magnet:5,pp-max:2,x-attack:5,dire-hit:5,metronome:5&friendship&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=pichu&region=johto&level=100&moves=volt-tackle:8,wild-charge:8,thunderbolt:8,swift:8&items=light-ball:1,magnet:5,pp-max:2,x-attack:5,dire-hit:5,metronome:5&friendship&god&legend=lugia) |
| `cleffa` | ピィ | ピクシー | ハイパーボイス・はたく・のしかかり・スピードスター | [雑魚](http://localhost:5173/?pokemon=cleffa&region=johto&level=100&moves=hyper-voice:8,pound:8,body-slam:8,swift:8&items=moon-stone:1,silk-scarf:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5,x-attack:5&friendship&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=cleffa&region=johto&level=100&moves=hyper-voice:8,pound:8,body-slam:8,swift:8&items=moon-stone:1,silk-scarf:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5,x-attack:5&friendship&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=cleffa&region=johto&level=100&moves=hyper-voice:8,pound:8,body-slam:8,swift:8&items=moon-stone:1,silk-scarf:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5,x-attack:5&friendship&god&legend=lugia) |
| `igglybuff` | ププリン | プクリン | おうふくビンタ・エコーボイス・チャームボイス・あまえる | [雑魚](http://localhost:5173/?pokemon=igglybuff&region=johto&level=100&moves=double-slap:8,echoed-voice:8,disarming-voice:8,charm:8&items=moon-stone:1,x-attack:5,metronome:5,silk-scarf:5,pp-max:2,x-sp-atk:5,dire-hit:5&friendship&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=igglybuff&region=johto&level=100&moves=double-slap:8,echoed-voice:8,disarming-voice:8,charm:8&items=moon-stone:1,x-attack:5,metronome:5,silk-scarf:5,pp-max:2,x-sp-atk:5,dire-hit:5&friendship&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=igglybuff&region=johto&level=100&moves=double-slap:8,echoed-voice:8,disarming-voice:8,charm:8&items=moon-stone:1,x-attack:5,metronome:5,silk-scarf:5,pp-max:2,x-sp-atk:5,dire-hit:5&friendship&god&legend=lugia) |
| `togepi` | トゲピー | トゲチック | マジカルシャイン・のしかかり・スピードスター・ゆびをふる | [雑魚](http://localhost:5173/?pokemon=togepi&region=johto&level=100&moves=dazzling-gleam:8,body-slam:8,swift:8,metronome-baby:8&items=sharp-beak:5,light-clay:5,silk-scarf:5,pp-max:2,metronome:5,x-sp-atk:5&friendship&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=togepi&region=johto&level=100&moves=dazzling-gleam:8,body-slam:8,swift:8,metronome-baby:8&items=sharp-beak:5,light-clay:5,silk-scarf:5,pp-max:2,metronome:5,x-sp-atk:5&friendship&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=togepi&region=johto&level=100&moves=dazzling-gleam:8,body-slam:8,swift:8,metronome-baby:8&items=sharp-beak:5,light-clay:5,silk-scarf:5,pp-max:2,metronome:5,x-sp-atk:5&friendship&god&legend=lugia) |
| `onix` | イワーク | ハガネール | ストーンエッジ・ロックブラスト・アイアンテール・のしかかり | [雑魚](http://localhost:5173/?pokemon=onix&region=johto&level=100&moves=stone-edge:8,rock-blast:8,iron-tail:8,body-slam:8&items=metal-coat:1,hard-stone:5,pp-max:2,silk-scarf:5,metronome:5,x-attack:5,razor-claw:2&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=onix&region=johto&level=100&moves=stone-edge:8,rock-blast:8,iron-tail:8,body-slam:8&items=metal-coat:1,hard-stone:5,pp-max:2,silk-scarf:5,metronome:5,x-attack:5,razor-claw:2&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=onix&region=johto&level=100&moves=stone-edge:8,rock-blast:8,iron-tail:8,body-slam:8&items=metal-coat:1,hard-stone:5,pp-max:2,silk-scarf:5,metronome:5,x-attack:5,razor-claw:2&god&legend=lugia) |
| `scyther` | ストライク | ハッサム | バレットパンチ・すてみタックル・つばめがえし・つるぎのまい | [雑魚](http://localhost:5173/?pokemon=scyther&region=johto&level=100&moves=bullet-punch:8,double-edge:8,aerial-ace:8,swords-dance:8&items=metal-coat:1,silk-scarf:5,razor-claw:2,x-attack:5,pp-max:2,metronome:5,dire-hit:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=scyther&region=johto&level=100&moves=bullet-punch:8,double-edge:8,aerial-ace:8,swords-dance:8&items=metal-coat:1,silk-scarf:5,razor-claw:2,x-attack:5,pp-max:2,metronome:5,dire-hit:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=scyther&region=johto&level=100&moves=bullet-punch:8,double-edge:8,aerial-ace:8,swords-dance:8&items=metal-coat:1,silk-scarf:5,razor-claw:2,x-attack:5,pp-max:2,metronome:5,dire-hit:5&god&legend=lugia) |
| `gastly` | ゴース | ゲンガー | ヘドロウェーブ・ヘドロばくだん・あくのはどう・シャドーボール | [雑魚](http://localhost:5173/?pokemon=gastly&region=johto&level=100&moves=sludge-wave:8,sludge-bomb:8,dark-pulse:8,shadow-ball:8&items=linking-cord:1,poison-barb:5,spell-tag:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=gastly&region=johto&level=100&moves=sludge-wave:8,sludge-bomb:8,dark-pulse:8,shadow-ball:8&items=linking-cord:1,poison-barb:5,spell-tag:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=gastly&region=johto&level=100&moves=sludge-wave:8,sludge-bomb:8,dark-pulse:8,shadow-ball:8&items=linking-cord:1,poison-barb:5,spell-tag:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5&god&legend=lugia) |
| `slowpoke` | ヤドン | ヤドキング | みらいよち・しねんのずつき・バブルこうせん・なまける | [雑魚](http://localhost:5173/?pokemon=slowpoke&region=johto&level=100&moves=future-sight-alakazam:8,zen-headbutt:8,bubble-beam:8,slack-off:8&items=kings-rock:1,twisted-spoon:5,silk-scarf:5,mystic-water:5,x-sp-atk:5,dire-hit:5,x-attack:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=slowpoke&region=johto&level=100&moves=future-sight-alakazam:8,zen-headbutt:8,bubble-beam:8,slack-off:8&items=kings-rock:1,twisted-spoon:5,silk-scarf:5,mystic-water:5,x-sp-atk:5,dire-hit:5,x-attack:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=slowpoke&region=johto&level=100&moves=future-sight-alakazam:8,zen-headbutt:8,bubble-beam:8,slack-off:8&items=kings-rock:1,twisted-spoon:5,silk-scarf:5,mystic-water:5,x-sp-atk:5,dire-hit:5,x-attack:5&god&legend=lugia) |
| `porygon` | ポリゴン | ポリゴン２ | トライアタック・かくばる・テクスチャー・ロックオン | [雑魚](http://localhost:5173/?pokemon=porygon&region=johto&level=100&moves=tri-attack:8,sharpen:8,conversion:8,lock-on:8&items=up-grade:1,silk-scarf:5,x-sp-atk:5,dire-hit:5,metronome:5,pp-max:2&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=porygon&region=johto&level=100&moves=tri-attack:8,sharpen:8,conversion:8,lock-on:8&items=up-grade:1,silk-scarf:5,x-sp-atk:5,dire-hit:5,metronome:5,pp-max:2&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=porygon&region=johto&level=100&moves=tri-attack:8,sharpen:8,conversion:8,lock-on:8&items=up-grade:1,silk-scarf:5,x-sp-atk:5,dire-hit:5,metronome:5,pp-max:2&god&legend=lugia) |
| `eevee` | イーブイ | ブースター | やけっぱち・ニトロチャージ・すてみタックル・スピードスター | [雑魚](http://localhost:5173/?pokemon=eevee&region=johto&level=100&moves=temper-flare:8,flame-charge:8,double-edge:8,swift:8&items=fire-stone:1,charcoal:5,silk-scarf:5,pp-max:2,metronome:5,x-attack:5,dire-hit:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=eevee&region=johto&level=100&moves=temper-flare:8,flame-charge:8,double-edge:8,swift:8&items=fire-stone:1,charcoal:5,silk-scarf:5,pp-max:2,metronome:5,x-attack:5,dire-hit:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=eevee&region=johto&level=100&moves=temper-flare:8,flame-charge:8,double-edge:8,swift:8&items=fire-stone:1,charcoal:5,silk-scarf:5,pp-max:2,metronome:5,x-attack:5,dire-hit:5&god&legend=lugia) |
| `houndour` | デルビル | ヘルガー | バークアウト・だいもんじ・フレアドライブ・ほのおのうず | [雑魚](http://localhost:5173/?pokemon=houndour&region=johto&level=100&moves=snarl:8,fire-blast:8,flare-blitz:8,fire-spin:8&items=black-glasses:5,charcoal:5,x-attack:5,pp-max:2,metronome:5,x-sp-atk:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=houndour&region=johto&level=100&moves=snarl:8,fire-blast:8,flare-blitz:8,fire-spin:8&items=black-glasses:5,charcoal:5,x-attack:5,pp-max:2,metronome:5,x-sp-atk:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=houndour&region=johto&level=100&moves=snarl:8,fire-blast:8,flare-blitz:8,fire-spin:8&items=black-glasses:5,charcoal:5,x-attack:5,pp-max:2,metronome:5,x-sp-atk:5&god&legend=lugia) |
| `mareep` | メリープ | デンリュウ | でんじほう・のしかかり・スピードスター・でんじは | [雑魚](http://localhost:5173/?pokemon=mareep&region=johto&level=100&moves=zap-cannon:8,body-slam:8,swift:8,thunder-wave:8&items=magnet:5,x-sp-atk:5,silk-scarf:5,pp-max:2,light-clay:5,metronome:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=mareep&region=johto&level=100&moves=zap-cannon:8,body-slam:8,swift:8,thunder-wave:8&items=magnet:5,x-sp-atk:5,silk-scarf:5,pp-max:2,light-clay:5,metronome:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=mareep&region=johto&level=100&moves=zap-cannon:8,body-slam:8,swift:8,thunder-wave:8&items=magnet:5,x-sp-atk:5,silk-scarf:5,pp-max:2,light-clay:5,metronome:5&god&legend=lugia) |
| `heracross` | ヘラクロス | ヘラクロス | れんぞくぎり・リベンジ・のしかかり・つっぱり | [雑魚](http://localhost:5173/?pokemon=heracross&region=johto&level=100&moves=fury-cutter:8,revenge:8,body-slam:8,arm-thrust:8&items=silver-powder:5,black-belt:5,silk-scarf:5,pp-max:2,metronome:5,x-attack:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=heracross&region=johto&level=100&moves=fury-cutter:8,revenge:8,body-slam:8,arm-thrust:8&items=silver-powder:5,black-belt:5,silk-scarf:5,pp-max:2,metronome:5,x-attack:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=heracross&region=johto&level=100&moves=fury-cutter:8,revenge:8,body-slam:8,arm-thrust:8&items=silver-powder:5,black-belt:5,silk-scarf:5,pp-max:2,metronome:5,x-attack:5&god&legend=lugia) |
| `swinub` | ウリムー | イノムー | つららおとし・れいとうビーム・のしかかり・マグニチュード | [雑魚](http://localhost:5173/?pokemon=swinub&region=johto&level=100&moves=icicle-crash:8,ice-beam:8,body-slam:8,magnitude:8&items=never-melt-ice:5,hard-stone:5,silk-scarf:5,metronome:5,pp-max:2,x-attack:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=swinub&region=johto&level=100&moves=icicle-crash:8,ice-beam:8,body-slam:8,magnitude:8&items=never-melt-ice:5,hard-stone:5,silk-scarf:5,metronome:5,pp-max:2,x-attack:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=swinub&region=johto&level=100&moves=icicle-crash:8,ice-beam:8,body-slam:8,magnitude:8&items=never-melt-ice:5,hard-stone:5,silk-scarf:5,metronome:5,pp-max:2,x-attack:5&god&legend=lugia) |
| `pidgey` | ポッポ | ピジョット | エアスラッシュ・すてみタックル・つばさでうつ・エアカッター | [雑魚](http://localhost:5173/?pokemon=pidgey&region=johto&level=100&moves=air-slash:8,double-edge:8,wing-attack:8,air-cutter:8&items=sharp-beak:5,silk-scarf:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=pidgey&region=johto&level=100&moves=air-slash:8,double-edge:8,wing-attack:8,air-cutter:8&items=sharp-beak:5,silk-scarf:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=pidgey&region=johto&level=100&moves=air-slash:8,double-edge:8,wing-attack:8,air-cutter:8&items=sharp-beak:5,silk-scarf:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5&god&legend=lugia) |
| `zubat` | ズバット | クロバット | クロスポイズン・エアスラッシュ・エアカッター・かみつく | [雑魚](http://localhost:5173/?pokemon=zubat&region=johto&level=100&moves=cross-poison:8,air-slash:8,air-cutter:8,bite:8&items=poison-barb:5,razor-claw:2,sharp-beak:5,metronome:5,pp-max:2,x-attack:5&friendship&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=zubat&region=johto&level=100&moves=cross-poison:8,air-slash:8,air-cutter:8,bite:8&items=poison-barb:5,razor-claw:2,sharp-beak:5,metronome:5,pp-max:2,x-attack:5&friendship&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=zubat&region=johto&level=100&moves=cross-poison:8,air-slash:8,air-cutter:8,bite:8&items=poison-barb:5,razor-claw:2,sharp-beak:5,metronome:5,pp-max:2,x-attack:5&friendship&god&legend=lugia) |
| `miltank` | ミルタンク | ミルタンク | ころがる・すてみタックル・ミルクのみ・まるくなる | [雑魚](http://localhost:5173/?pokemon=miltank&region=johto&level=100&moves=rollout:8,double-edge:8,milk-drink:8,defense-curl:8&items=silk-scarf:5,hard-stone:5,metronome:5,x-attack:5,pp-max:2,dire-hit:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=miltank&region=johto&level=100&moves=rollout:8,double-edge:8,milk-drink:8,defense-curl:8&items=silk-scarf:5,hard-stone:5,metronome:5,x-attack:5,pp-max:2,dire-hit:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=miltank&region=johto&level=100&moves=rollout:8,double-edge:8,milk-drink:8,defense-curl:8&items=silk-scarf:5,hard-stone:5,metronome:5,x-attack:5,pp-max:2,dire-hit:5&god&legend=lugia) |
| `larvitar` | ヨーギラス | バンギラス | ストーンエッジ・ロックブラスト・あくのはどう・たいあたり | [雑魚](http://localhost:5173/?pokemon=larvitar&region=johto&level=100&moves=stone-edge:8,rock-blast:8,dark-pulse:8,tackle:8&items=hard-stone:5,soft-sand:5,pp-max:2,metronome:5,razor-claw:2,x-attack:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=larvitar&region=johto&level=100&moves=stone-edge:8,rock-blast:8,dark-pulse:8,tackle:8&items=hard-stone:5,soft-sand:5,pp-max:2,metronome:5,razor-claw:2,x-attack:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=larvitar&region=johto&level=100&moves=stone-edge:8,rock-blast:8,dark-pulse:8,tackle:8&items=hard-stone:5,soft-sand:5,pp-max:2,metronome:5,razor-claw:2,x-attack:5&god&legend=lugia) |
| `horsea` | タッツー | キングドラ | しおみず・りゅうせいぐん・バブルこうせん・たつまき | [雑魚](http://localhost:5173/?pokemon=horsea&region=johto&level=100&moves=brine:8,draco-meteor:8,bubble-beam:8,twister:8&items=dragon-scale:1,mystic-water:5,metronome:5,pp-max:2,x-sp-atk:5,dragon-fang:5,dire-hit:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=horsea&region=johto&level=100&moves=brine:8,draco-meteor:8,bubble-beam:8,twister:8&items=dragon-scale:1,mystic-water:5,metronome:5,pp-max:2,x-sp-atk:5,dragon-fang:5,dire-hit:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=horsea&region=johto&level=100&moves=brine:8,draco-meteor:8,bubble-beam:8,twister:8&items=dragon-scale:1,mystic-water:5,metronome:5,pp-max:2,x-sp-atk:5,dragon-fang:5,dire-hit:5&god&legend=lugia) |
| `poliwag` | ニョロモ | ニョロボン | ばくれつパンチ・じごくぐるま・バブルこうせん・ハイドロポンプ | [雑魚](http://localhost:5173/?pokemon=poliwag&region=johto&level=100&moves=dynamic-punch:8,submission:8,bubble-beam:8,hydro-pump:8&items=water-stone:1,black-belt:5,mystic-water:5,x-attack:5,metronome:5,dire-hit:5,light-clay:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=poliwag&region=johto&level=100&moves=dynamic-punch:8,submission:8,bubble-beam:8,hydro-pump:8&items=water-stone:1,black-belt:5,mystic-water:5,x-attack:5,metronome:5,dire-hit:5,light-clay:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=poliwag&region=johto&level=100&moves=dynamic-punch:8,submission:8,bubble-beam:8,hydro-pump:8&items=water-stone:1,black-belt:5,mystic-water:5,x-attack:5,metronome:5,dire-hit:5,light-clay:5&god&legend=lugia) |
| `raikou` | ライコウ | ライコウ | ライジングボルト・エレキフィールド・しんそく・じゅうでん | [雑魚](http://localhost:5173/?pokemon=raikou&region=johto&level=100&moves=rising-voltage-raikou:12,electric-terrain-raikou:12,extreme-speed-raikou:12,charge-raikou:12&items=magnet:5,metronome:5,x-sp-atk:5,dire-hit:5,silk-scarf:5,x-attack:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=raikou&region=johto&level=100&moves=rising-voltage-raikou:12,electric-terrain-raikou:12,extreme-speed-raikou:12,charge-raikou:12&items=magnet:5,metronome:5,x-sp-atk:5,dire-hit:5,silk-scarf:5,x-attack:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=raikou&region=johto&level=100&moves=rising-voltage-raikou:12,electric-terrain-raikou:12,extreme-speed-raikou:12,charge-raikou:12&items=magnet:5,metronome:5,x-sp-atk:5,dire-hit:5,silk-scarf:5,x-attack:5&god&legend=lugia) |
| `entei` | エンテイ | エンテイ | オーバーヒート・ふんえん・ふんか・せいなるほのお | [雑魚](http://localhost:5173/?pokemon=entei&region=johto&level=100&moves=overheat-entei:12,lava-plume-entei:12,eruption-entei:12,sacred-fire-entei:12&items=charcoal:5,metronome:5,x-sp-atk:5,dire-hit:5,pp-max:2,x-attack:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=entei&region=johto&level=100&moves=overheat-entei:12,lava-plume-entei:12,eruption-entei:12,sacred-fire-entei:12&items=charcoal:5,metronome:5,x-sp-atk:5,dire-hit:5,pp-max:2,x-attack:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=entei&region=johto&level=100&moves=overheat-entei:12,lava-plume-entei:12,eruption-entei:12,sacred-fire-entei:12&items=charcoal:5,metronome:5,x-sp-atk:5,dire-hit:5,pp-max:2,x-attack:5&god&legend=lugia) |
| `suicune` | スイクン | スイクン | なみのり・ミラーコート・ぜったいれいど・めいそう | [雑魚](http://localhost:5173/?pokemon=suicune&region=johto&level=100&moves=surf-suicune:12,mirror-coat-suicune:12,sheer-cold-suicune:12,calm-mind:12&items=metronome:5,x-sp-atk:5,mystic-water:5,dire-hit:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=suicune&region=johto&level=100&moves=surf-suicune:12,mirror-coat-suicune:12,sheer-cold-suicune:12,calm-mind:12&items=metronome:5,x-sp-atk:5,mystic-water:5,dire-hit:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=suicune&region=johto&level=100&moves=surf-suicune:12,mirror-coat-suicune:12,sheer-cold-suicune:12,calm-mind:12&items=metronome:5,x-sp-atk:5,mystic-water:5,dire-hit:5&god&legend=lugia) |
| `lugia` | ルギア | ルギア | エアロブラスト・ハイドロポンプ・じんつうりき・かぜおこし | [雑魚](http://localhost:5173/?pokemon=lugia&region=johto&level=100&moves=aeroblast-lugia:12,hydro-pump-lugia:12,extrasensory-lugia:12,gust-lugia:12&items=x-sp-atk:5,metronome:5,sharp-beak:5,dire-hit:5,twisted-spoon:5,pp-max:2&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=lugia&region=johto&level=100&moves=aeroblast-lugia:12,hydro-pump-lugia:12,extrasensory-lugia:12,gust-lugia:12&items=x-sp-atk:5,metronome:5,sharp-beak:5,dire-hit:5,twisted-spoon:5,pp-max:2&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=lugia&region=johto&level=100&moves=aeroblast-lugia:12,hydro-pump-lugia:12,extrasensory-lugia:12,gust-lugia:12&items=x-sp-atk:5,metronome:5,sharp-beak:5,dire-hit:5,twisted-spoon:5,pp-max:2&god&legend=lugia) |
| `ho-oh` | ホウオウ | ホウオウ | ゴッドバード・せいなるほのお・かぜおこし・じこさいせい | [雑魚](http://localhost:5173/?pokemon=ho-oh&region=johto&level=100&moves=sky-attack-hooh:12,sacred-fire-hooh:12,gust-hooh:12,recover-hooh:12&items=x-attack:5,metronome:5,sharp-beak:5,charcoal:5,dire-hit:5,pp-max:2&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=ho-oh&region=johto&level=100&moves=sky-attack-hooh:12,sacred-fire-hooh:12,gust-hooh:12,recover-hooh:12&items=x-attack:5,metronome:5,sharp-beak:5,charcoal:5,dire-hit:5,pp-max:2&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=ho-oh&region=johto&level=100&moves=sky-attack-hooh:12,sacred-fire-hooh:12,gust-hooh:12,recover-hooh:12&items=x-attack:5,metronome:5,sharp-beak:5,charcoal:5,dire-hit:5,pp-max:2&god&legend=lugia) |
| `celebi` | セレビィ | セレビィ | リーフストーム・みらいよち・ギガドレイン・いやしのねがい | [雑魚](http://localhost:5173/?pokemon=celebi&region=johto&level=100&moves=leaf-storm-celebi:8,future-sight-celebi:8,giga-drain:8,healing-wish:8&items=miracle-seed:5,x-sp-atk:5,twisted-spoon:5,metronome:5,pp-max:2,dire-hit:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=celebi&region=johto&level=100&moves=leaf-storm-celebi:8,future-sight-celebi:8,giga-drain:8,healing-wish:8&items=miracle-seed:5,x-sp-atk:5,twisted-spoon:5,metronome:5,pp-max:2,dire-hit:5&god&boss=dragonite) ・ [伝説](http://localhost:5173/?pokemon=celebi&region=johto&level=100&moves=leaf-storm-celebi:8,future-sight-celebi:8,giga-drain:8,healing-wish:8&items=miracle-seed:5,x-sp-atk:5,twisted-spoon:5,metronome:5,pp-max:2,dire-hit:5&god&legend=lugia) |

### ホウエン（ボス: ボーマンダとフライゴン／伝説: レックウザ）

| コード | 最初の姿 | 撮れる姿 | 技 | リンク |
|---|---|---|---|---|
| `treecko` | キモリ | ジュカイン | れんぞくぎり・リーフブレード・リーフストーム・くさのちかい | [雑魚](http://localhost:5173/?pokemon=treecko&region=hoenn&level=100&moves=fury-cutter:8,leaf-blade:8,leaf-storm:8,grass-pledge:1&items=silver-powder:5,pp-max:2,miracle-seed:5,metronome:5,x-attack:5,dire-hit:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=treecko&region=hoenn&level=100&moves=fury-cutter:8,leaf-blade:8,leaf-storm:8,grass-pledge:1&items=silver-powder:5,pp-max:2,miracle-seed:5,metronome:5,x-attack:5,dire-hit:5&god&boss=salamence) ・ [伝説](http://localhost:5173/?pokemon=treecko&region=hoenn&level=100&moves=fury-cutter:8,leaf-blade:8,leaf-storm:8,grass-pledge:1&items=silver-powder:5,pp-max:2,miracle-seed:5,metronome:5,x-attack:5,dire-hit:5&god&legend=rayquaza) |
| `torchic` | アチャモ | バシャーモ | インファイト・きりさく・すてみタックル・フレアドライブ | [雑魚](http://localhost:5173/?pokemon=torchic&region=hoenn&level=100&moves=close-combat:16,slash:8,double-edge:8,flare-blitz:8&items=black-belt:5,silk-scarf:5,x-attack:5,pp-max:2,metronome:5,dire-hit:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=torchic&region=hoenn&level=100&moves=close-combat:16,slash:8,double-edge:8,flare-blitz:8&items=black-belt:5,silk-scarf:5,x-attack:5,pp-max:2,metronome:5,dire-hit:5&god&boss=salamence) ・ [伝説](http://localhost:5173/?pokemon=torchic&region=hoenn&level=100&moves=close-combat:16,slash:8,double-edge:8,flare-blitz:8&items=black-belt:5,silk-scarf:5,x-attack:5,pp-max:2,metronome:5,dire-hit:5&god&legend=rayquaza) |
| `mudkip` | ミズゴロウ | ラグラージ | だくりゅう・マッドショット・ウェーブタックル・みずのちかい | [雑魚](http://localhost:5173/?pokemon=mudkip&region=hoenn&level=100&moves=muddy-water-hoenn:8,mud-shot:8,wave-crash:8,water-pledge:1&items=mystic-water:5,soft-sand:5,metronome:5,pp-max:2,x-sp-atk:5,dire-hit:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=mudkip&region=hoenn&level=100&moves=muddy-water-hoenn:8,mud-shot:8,wave-crash:8,water-pledge:1&items=mystic-water:5,soft-sand:5,metronome:5,pp-max:2,x-sp-atk:5,dire-hit:5&god&boss=salamence) ・ [伝説](http://localhost:5173/?pokemon=mudkip&region=hoenn&level=100&moves=muddy-water-hoenn:8,mud-shot:8,wave-crash:8,water-pledge:1&items=mystic-water:5,soft-sand:5,metronome:5,pp-max:2,x-sp-atk:5,dire-hit:5&god&legend=rayquaza) |
| `makuhita` | マクノシタ | ハリテヤマ | ばかぢから・のしかかり・カウンター・からげんき | [雑魚](http://localhost:5173/?pokemon=makuhita&region=hoenn&level=100&moves=superpower:8,body-slam:8,counter:8,facade:8&items=black-belt:5,silk-scarf:5,pp-max:2,metronome:5,x-attack:5,dire-hit:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=makuhita&region=hoenn&level=100&moves=superpower:8,body-slam:8,counter:8,facade:8&items=black-belt:5,silk-scarf:5,pp-max:2,metronome:5,x-attack:5,dire-hit:5&god&boss=salamence) ・ [伝説](http://localhost:5173/?pokemon=makuhita&region=hoenn&level=100&moves=superpower:8,body-slam:8,counter:8,facade:8&items=black-belt:5,silk-scarf:5,pp-max:2,metronome:5,x-attack:5,dire-hit:5&god&legend=rayquaza) |
| `electrike` | ラクライ | ライボルト | ワイルドボルト・すてみタックル・のしかかり・１０まんボルト | [雑魚](http://localhost:5173/?pokemon=electrike&region=hoenn&level=100&moves=wild-charge-hoenn:8,double-edge:8,body-slam:8,thunderbolt:8&items=magnet:5,silk-scarf:5,pp-max:2,metronome:5,x-attack:5,dire-hit:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=electrike&region=hoenn&level=100&moves=wild-charge-hoenn:8,double-edge:8,body-slam:8,thunderbolt:8&items=magnet:5,silk-scarf:5,pp-max:2,metronome:5,x-attack:5,dire-hit:5&god&boss=salamence) ・ [伝説](http://localhost:5173/?pokemon=electrike&region=hoenn&level=100&moves=wild-charge-hoenn:8,double-edge:8,body-slam:8,thunderbolt:8&items=magnet:5,silk-scarf:5,pp-max:2,metronome:5,x-attack:5,dire-hit:5&god&legend=rayquaza) |
| `numel` | ドンメル | バクーダ | ふんか・のしかかり・ほのおのうず・あくび | [雑魚](http://localhost:5173/?pokemon=numel&region=hoenn&level=100&moves=eruption:8,body-slam:8,fire-spin:8,yawn:8&items=charcoal:5,silk-scarf:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=numel&region=hoenn&level=100&moves=eruption:8,body-slam:8,fire-spin:8,yawn:8&items=charcoal:5,silk-scarf:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5&god&boss=salamence) ・ [伝説](http://localhost:5173/?pokemon=numel&region=hoenn&level=100&moves=eruption:8,body-slam:8,fire-spin:8,yawn:8&items=charcoal:5,silk-scarf:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5&god&legend=rayquaza) |
| `slakoth` | ナマケロ | ケッキング | ギガインパクト・ふいうち・カウンター・あばれる | [雑魚](http://localhost:5173/?pokemon=slakoth&region=hoenn&level=100&moves=giga-impact:8,sucker-punch:8,counter:8,thrash:8&items=silk-scarf:5,pp-max:2,x-attack:5,metronome:5,dire-hit:5,light-clay:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=slakoth&region=hoenn&level=100&moves=giga-impact:8,sucker-punch:8,counter:8,thrash:8&items=silk-scarf:5,pp-max:2,x-attack:5,metronome:5,dire-hit:5,light-clay:5&god&boss=salamence) ・ [伝説](http://localhost:5173/?pokemon=slakoth&region=hoenn&level=100&moves=giga-impact:8,sucker-punch:8,counter:8,thrash:8&items=silk-scarf:5,pp-max:2,x-attack:5,metronome:5,dire-hit:5,light-clay:5&god&legend=rayquaza) |
| `swablu` | チルット | チルタリス | ゴッドバード・ハイパーボイス・りゅうのいかり・つつく | [雑魚](http://localhost:5173/?pokemon=swablu&region=hoenn&level=100&moves=sky-attack-hoenn:8,hyper-voice:8,dragon-rage:8,peck:8&items=razor-claw:2,silk-scarf:5,pp-max:2,metronome:5,sharp-beak:5,x-attack:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=swablu&region=hoenn&level=100&moves=sky-attack-hoenn:8,hyper-voice:8,dragon-rage:8,peck:8&items=razor-claw:2,silk-scarf:5,pp-max:2,metronome:5,sharp-beak:5,x-attack:5&god&boss=salamence) ・ [伝説](http://localhost:5173/?pokemon=swablu&region=hoenn&level=100&moves=sky-attack-hoenn:8,hyper-voice:8,dragon-rage:8,peck:8&items=razor-claw:2,silk-scarf:5,pp-max:2,metronome:5,sharp-beak:5,x-attack:5&god&legend=rayquaza) |
| `absol` | アブソル | アブソル | イカサマ・きりさく・すてみタックル・あくのはどう | [雑魚](http://localhost:5173/?pokemon=absol&region=hoenn&level=100&moves=foul-play:8,slash:8,double-edge:8,dark-pulse:8&items=razor-claw:2,silk-scarf:5,pp-max:2,metronome:5,x-attack:5,dire-hit:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=absol&region=hoenn&level=100&moves=foul-play:8,slash:8,double-edge:8,dark-pulse:8&items=razor-claw:2,silk-scarf:5,pp-max:2,metronome:5,x-attack:5,dire-hit:5&god&boss=salamence) ・ [伝説](http://localhost:5173/?pokemon=absol&region=hoenn&level=100&moves=foul-play:8,slash:8,double-edge:8,dark-pulse:8&items=razor-claw:2,silk-scarf:5,pp-max:2,metronome:5,x-attack:5,dire-hit:5&god&legend=rayquaza) |
| `shuppet` | カゲボウズ | ジュペッタ | ゴーストダイブ・シャドーボール・ふいうち | [雑魚](http://localhost:5173/?pokemon=shuppet&region=hoenn&level=100&moves=phantom-force:8,shadow-ball:8,sucker-punch:8&items=spell-tag:5,x-attack:5,pp-max:2,dire-hit:5,metronome:5,x-sp-atk:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=shuppet&region=hoenn&level=100&moves=phantom-force:8,shadow-ball:8,sucker-punch:8&items=spell-tag:5,x-attack:5,pp-max:2,dire-hit:5,metronome:5,x-sp-atk:5&god&boss=salamence) ・ [伝説](http://localhost:5173/?pokemon=shuppet&region=hoenn&level=100&moves=phantom-force:8,shadow-ball:8,sucker-punch:8&items=spell-tag:5,x-attack:5,pp-max:2,dire-hit:5,metronome:5,x-sp-atk:5&god&legend=rayquaza) |
| `spheal` | タマザラシ | トドゼルガ | ぜったいれいど・れいとうビーム・みずでっぽう・うずしお | [雑魚](http://localhost:5173/?pokemon=spheal&region=hoenn&level=100&moves=sheer-cold-hoenn:8,ice-beam:8,water-gun:8,whirlpool:8&items=never-melt-ice:5,metronome:5,x-sp-atk:5,dire-hit:5,light-clay:5,pp-max:2&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=spheal&region=hoenn&level=100&moves=sheer-cold-hoenn:8,ice-beam:8,water-gun:8,whirlpool:8&items=never-melt-ice:5,metronome:5,x-sp-atk:5,dire-hit:5,light-clay:5,pp-max:2&god&boss=salamence) ・ [伝説](http://localhost:5173/?pokemon=spheal&region=hoenn&level=100&moves=sheer-cold-hoenn:8,ice-beam:8,water-gun:8,whirlpool:8&items=never-melt-ice:5,metronome:5,x-sp-atk:5,dire-hit:5,light-clay:5,pp-max:2&god&legend=rayquaza) |
| `bagon` | タツベイ | ボーマンダ | エアスラッシュ・げきりん・りゅうのはどう・スピードスター | [雑魚](http://localhost:5173/?pokemon=bagon&region=hoenn&level=100&moves=air-slash:8,outrage:8,dragon-pulse:8,swift:8&items=sharp-beak:5,dragon-fang:5,metronome:5,pp-max:2,x-sp-atk:5,dire-hit:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=bagon&region=hoenn&level=100&moves=air-slash:8,outrage:8,dragon-pulse:8,swift:8&items=sharp-beak:5,dragon-fang:5,metronome:5,pp-max:2,x-sp-atk:5,dire-hit:5&god&boss=salamence) ・ [伝説](http://localhost:5173/?pokemon=bagon&region=hoenn&level=100&moves=air-slash:8,outrage:8,dragon-pulse:8,swift:8&items=sharp-beak:5,dragon-fang:5,metronome:5,pp-max:2,x-sp-atk:5,dire-hit:5&god&legend=rayquaza) |
| `feebas` | ヒンバス | ミロカロス | ハイドロポンプ・のしかかり・スピードスター・たつまき | [雑魚](http://localhost:5173/?pokemon=feebas&region=hoenn&level=100&moves=hydro-pump-hoenn:8,body-slam:8,swift:8,twister:8&items=prism-scale:1,mystic-water:5,silk-scarf:5,pp-max:2,light-clay:5,metronome:5,x-sp-atk:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=feebas&region=hoenn&level=100&moves=hydro-pump-hoenn:8,body-slam:8,swift:8,twister:8&items=prism-scale:1,mystic-water:5,silk-scarf:5,pp-max:2,light-clay:5,metronome:5,x-sp-atk:5&god&boss=salamence) ・ [伝説](http://localhost:5173/?pokemon=feebas&region=hoenn&level=100&moves=hydro-pump-hoenn:8,body-slam:8,swift:8,twister:8&items=prism-scale:1,mystic-water:5,silk-scarf:5,pp-max:2,light-clay:5,metronome:5,x-sp-atk:5&god&legend=rayquaza) |
| `ralts` | ラルトス | サーナイト | ハイパーボイス・みらいよち・シャドーボール・スピードスター | [雑魚](http://localhost:5173/?pokemon=ralts&region=hoenn&level=100&moves=hyper-voice:8,future-sight-gardevoir:8,shadow-ball:8,swift:8&items=silk-scarf:5,twisted-spoon:5,spell-tag:5,pp-max:2,metronome:5,x-sp-atk:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=ralts&region=hoenn&level=100&moves=hyper-voice:8,future-sight-gardevoir:8,shadow-ball:8,swift:8&items=silk-scarf:5,twisted-spoon:5,spell-tag:5,pp-max:2,metronome:5,x-sp-atk:5&god&boss=salamence) ・ [伝説](http://localhost:5173/?pokemon=ralts&region=hoenn&level=100&moves=hyper-voice:8,future-sight-gardevoir:8,shadow-ball:8,swift:8&items=silk-scarf:5,twisted-spoon:5,spell-tag:5,pp-max:2,metronome:5,x-sp-atk:5&god&legend=rayquaza) |
| `trapinch` | ナックラー | フライゴン | じしん・ドラゴンダイブ・りゅうのはどう・スピードスター | [雑魚](http://localhost:5173/?pokemon=trapinch&region=hoenn&level=100&moves=earthquake-hoenn:8,dragon-rush:8,dragon-pulse:8,swift:8&items=soft-sand:5,dragon-fang:5,metronome:5,pp-max:2,x-attack:5,dire-hit:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=trapinch&region=hoenn&level=100&moves=earthquake-hoenn:8,dragon-rush:8,dragon-pulse:8,swift:8&items=soft-sand:5,dragon-fang:5,metronome:5,pp-max:2,x-attack:5,dire-hit:5&god&boss=salamence) ・ [伝説](http://localhost:5173/?pokemon=trapinch&region=hoenn&level=100&moves=earthquake-hoenn:8,dragon-rush:8,dragon-pulse:8,swift:8&items=soft-sand:5,dragon-fang:5,metronome:5,pp-max:2,x-attack:5,dire-hit:5&god&legend=rayquaza) |
| `aron` | ココドラ | ボスゴドラ | メタルバースト・ロックブラスト・のしかかり・いわおとし | [雑魚](http://localhost:5173/?pokemon=aron&region=hoenn&level=100&moves=metal-burst:8,rock-blast:8,body-slam:8,rock-throw:8&items=pp-max:2,silk-scarf:5,x-attack:5,metronome:5,dire-hit:5,hard-stone:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=aron&region=hoenn&level=100&moves=metal-burst:8,rock-blast:8,body-slam:8,rock-throw:8&items=pp-max:2,silk-scarf:5,x-attack:5,metronome:5,dire-hit:5,hard-stone:5&god&boss=salamence) ・ [伝説](http://localhost:5173/?pokemon=aron&region=hoenn&level=100&moves=metal-burst:8,rock-blast:8,body-slam:8,rock-throw:8&items=pp-max:2,silk-scarf:5,x-attack:5,metronome:5,dire-hit:5,hard-stone:5&god&legend=rayquaza) |
| `azurill` | ルリリ | マリルリ | アクアテール・ハイパーボイス・バブルこうせん・スピードスター | [雑魚](http://localhost:5173/?pokemon=azurill&region=hoenn&level=100&moves=aqua-tail-azumarill:8,hyper-voice:8,bubble-beam:8,swift:8&items=silk-scarf:5,mystic-water:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5&friendship&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=azurill&region=hoenn&level=100&moves=aqua-tail-azumarill:8,hyper-voice:8,bubble-beam:8,swift:8&items=silk-scarf:5,mystic-water:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5&friendship&god&boss=salamence) ・ [伝説](http://localhost:5173/?pokemon=azurill&region=hoenn&level=100&moves=aqua-tail-azumarill:8,hyper-voice:8,bubble-beam:8,swift:8&items=silk-scarf:5,mystic-water:5,pp-max:2,metronome:5,x-sp-atk:5,dire-hit:5&friendship&god&legend=rayquaza) |
| `wynaut` | ソーナノ | ソーナンス | みちづれ・カウンター・アンコール・しんぴのまもり | [雑魚](http://localhost:5173/?pokemon=wynaut&region=hoenn&level=100&moves=destiny-bond:8,counter:8,encore:8,safeguard:8&items=spell-tag:5,light-clay:5,metronome:5,x-sp-atk:5,dire-hit:5,pp-max:2&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=wynaut&region=hoenn&level=100&moves=destiny-bond:8,counter:8,encore:8,safeguard:8&items=spell-tag:5,light-clay:5,metronome:5,x-sp-atk:5,dire-hit:5,pp-max:2&god&boss=salamence) ・ [伝説](http://localhost:5173/?pokemon=wynaut&region=hoenn&level=100&moves=destiny-bond:8,counter:8,encore:8,safeguard:8&items=spell-tag:5,light-clay:5,metronome:5,x-sp-atk:5,dire-hit:5,pp-max:2&god&legend=rayquaza) |
| `barboach` | ドジョッチ | ナマズン | だいちのちから・スピードスター・すなじごく・みずでっぽう | [雑魚](http://localhost:5173/?pokemon=barboach&region=hoenn&level=100&moves=earth-power:8,swift:8,sand-tomb:8,water-gun:8&items=soft-sand:5,pp-max:2,metronome:5,light-clay:5,x-sp-atk:5,dire-hit:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=barboach&region=hoenn&level=100&moves=earth-power:8,swift:8,sand-tomb:8,water-gun:8&items=soft-sand:5,pp-max:2,metronome:5,light-clay:5,x-sp-atk:5,dire-hit:5&god&boss=salamence) ・ [伝説](http://localhost:5173/?pokemon=barboach&region=hoenn&level=100&moves=earth-power:8,swift:8,sand-tomb:8,water-gun:8&items=soft-sand:5,pp-max:2,metronome:5,light-clay:5,x-sp-atk:5,dire-hit:5&god&legend=rayquaza) |
| `mawile` | クチート | クチート | じゃれつく・うたう・ほのおのキバ・ふいうち | [雑魚](http://localhost:5173/?pokemon=mawile&region=hoenn&level=100&moves=play-rough-hoenn:8,sing:8,fire-fang:8,sucker-punch:8&items=pp-max:2,x-attack:5,metronome:5,dire-hit:5,silk-scarf:5,x-sp-atk:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=mawile&region=hoenn&level=100&moves=play-rough-hoenn:8,sing:8,fire-fang:8,sucker-punch:8&items=pp-max:2,x-attack:5,metronome:5,dire-hit:5,silk-scarf:5,x-sp-atk:5&god&boss=salamence) ・ [伝説](http://localhost:5173/?pokemon=mawile&region=hoenn&level=100&moves=play-rough-hoenn:8,sing:8,fire-fang:8,sucker-punch:8&items=pp-max:2,x-attack:5,metronome:5,dire-hit:5,silk-scarf:5,x-sp-atk:5&god&legend=rayquaza) |
| `latias` | ラティアス | ラティアス | ミストボール・りゅうのはどう・ねんりき・いやしのはどう | [雑魚](http://localhost:5173/?pokemon=latias&region=hoenn&level=100&moves=mist-ball-latias:12,dragon-pulse-latias:12,confusion-latias:12,heal-pulse-latias:12&items=x-sp-atk:5,metronome:5,twisted-spoon:5,dragon-fang:5,dire-hit:5,pp-max:2&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=latias&region=hoenn&level=100&moves=mist-ball-latias:12,dragon-pulse-latias:12,confusion-latias:12,heal-pulse-latias:12&items=x-sp-atk:5,metronome:5,twisted-spoon:5,dragon-fang:5,dire-hit:5,pp-max:2&god&boss=salamence) ・ [伝説](http://localhost:5173/?pokemon=latias&region=hoenn&level=100&moves=mist-ball-latias:12,dragon-pulse-latias:12,confusion-latias:12,heal-pulse-latias:12&items=x-sp-atk:5,metronome:5,twisted-spoon:5,dragon-fang:5,dire-hit:5,pp-max:2&god&legend=rayquaza) |
| `latios` | ラティオス | ラティオス | りゅうせいぐん・ラスターパージ・りゅうのいぶき・りゅうのまい | [雑魚](http://localhost:5173/?pokemon=latios&region=hoenn&level=100&moves=draco-meteor-latios:12,luster-purge-latios:12,dragon-breath-latios:12,dragon-dance-latios:12&items=x-sp-atk:5,metronome:5,dragon-fang:5,twisted-spoon:5,dire-hit:5,pp-max:2&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=latios&region=hoenn&level=100&moves=draco-meteor-latios:12,luster-purge-latios:12,dragon-breath-latios:12,dragon-dance-latios:12&items=x-sp-atk:5,metronome:5,dragon-fang:5,twisted-spoon:5,dire-hit:5,pp-max:2&god&boss=salamence) ・ [伝説](http://localhost:5173/?pokemon=latios&region=hoenn&level=100&moves=draco-meteor-latios:12,luster-purge-latios:12,dragon-breath-latios:12,dragon-dance-latios:12&items=x-sp-atk:5,metronome:5,dragon-fang:5,twisted-spoon:5,dire-hit:5,pp-max:2&god&legend=rayquaza) |
| `jirachi` | ジラーチ | ジラーチ | はめつのねがい・ねんりき・ねがいごと・いやしのねがい | [雑魚](http://localhost:5173/?pokemon=jirachi&region=hoenn&level=100&moves=doom-desire:8,confusion:8,wish:8,healing-wish:8&items=x-sp-atk:5,dire-hit:5,light-clay:5,twisted-spoon:5&god&section=11&spawnx=2) ・ [ボス](http://localhost:5173/?pokemon=jirachi&region=hoenn&level=100&moves=doom-desire:8,confusion:8,wish:8,healing-wish:8&items=x-sp-atk:5,dire-hit:5,light-clay:5,twisted-spoon:5&god&boss=salamence) ・ [伝説](http://localhost:5173/?pokemon=jirachi&region=hoenn&level=100&moves=doom-desire:8,confusion:8,wish:8,healing-wish:8&items=x-sp-atk:5,dire-hit:5,light-clay:5,twisted-spoon:5&god&legend=rayquaza) |

イーブイのほかの姿（ジョウト）:

- ブースター: [雑魚](http://localhost:5173/?pokemon=eevee&region=johto&level=100&moves=temper-flare:8,flame-charge:8,double-edge:8,swift:8&items=fire-stone:1,charcoal:5,silk-scarf:5,pp-max:2,metronome:5,x-attack:5,dire-hit:5&god&section=11&spawnx=2)（やけっぱち・ニトロチャージ・すてみタックル・スピードスター）
- エーフィ: [雑魚](http://localhost:5173/?pokemon=eevee&region=johto&level=100&moves=stored-power:8,double-edge:8,future-sight:8,calm-mind:12&items=x-sp-atk:5,silk-scarf:5,twisted-spoon:5,metronome:5,pp-max:2,dire-hit:5&friendship&god&section=11&spawnx=2)（アシストパワー・すてみタックル・みらいよち・めいそう）
- ブラッキー: [雑魚](http://localhost:5173/?pokemon=eevee&region=johto&level=100&moves=foul-play-umbreon:8,snarl:8,double-edge:8,dark-pulse:8&items=black-glasses:5,silk-scarf:5,pp-max:2,metronome:5,x-attack:5,dire-hit:5&friendship&god&section=8&spawnx=2)（イカサマ・バークアウト・すてみタックル・あくのはどう）

## 4. 技のコード

`moves=` に書く。演出は「わざ見本帳」のページでも見られる。

| コード | 名前 | タイプ | 使える系統 |
|---|---|---|---|
| `tackle` | たいあたり | ノーマル | フシギダネ・ゼニガメ・イワーク・ヒトデマン・ドガース・サイホーン・ラプラス・ワンリキー ほか |
| `quick-attack` | でんこうせっか | ノーマル | ピカチュウ・ガーディ・イーブイ・ドードー・ニャース・ストライク・ミュウ・ヒノアラシ ほか |
| `swift` | スピードスター | ノーマル | ヒトカゲ・ヒトデマン・ピカチュウ・ケーシィ・ガーディ・ミニリュウ・コダック・ヤドン ほか |
| `extreme-speed-raikou` | しんそく | ノーマル | ライコウ |
| `recover-hooh` | じこさいせい | ノーマル | ホウオウ |
| `mimic` | ものまね | ノーマル | ミュウ |
| `pound` | はたく | ノーマル | プリン・ミュウ・ピィ・ププリン・トゲピー・ニョロモ・キモリ |
| `sing` | うたう | ノーマル | ラプラス・プリン・ニャース・ミュウ・ピィ・ププリン・チルット・ラルトス ほか |
| `slack-off` | なまける | ノーマル | ヤドン・ミュウ・ナマケロ |
| `giga-impact-rush` | ギガインパクト | ノーマル |  |
| `body-slam-bounce` | のしかかり | ノーマル |  |
| `scratch` | ひっかく | ノーマル | ヒトカゲ・コダック・ニャース・ストライク・ミュウ・ワニノコ・キモリ・アチャモ ほか |
| `lock-on` | ロックオン | ノーマル | ポリゴン・ミュウ |
| `sharpen` | かくばる | ノーマル | ポリゴン・ミュウ |
| `conversion` | テクスチャー | ノーマル | ポリゴン・ミュウ |
| `metronome-baby` | ゆびをふる | ノーマル | ピィ・トゲピー |
| `recover` | じこさいせい | ノーマル | ミュウツー |
| `morning-sun` | あさのひざし | ノーマル | イーブイ |
| `horn-attack` | つのでつく | ノーマル | サイホーン・ミュウ・ヘラクロス・ウリムー |
| `whirlwind` | ふきとばし | ノーマル | ミニリュウ・ドードー・ミュウ・ポッポ・ズバット・マクノシタ |
| `fake-out` | ねこだまし | ノーマル | マクノシタ |
| `yawn` | あくび | ノーマル | カビゴン・ミズゴロウ・ドンメル・ナマケロ |
| `encore` | アンコール | ノーマル | ソーナノ |
| `safeguard` | しんぴのまもり | ノーマル | ソーナノ |
| `harden` | かたくなる | ノーマル | イワーク・ミュウ・ココドラ |
| `defense-curl` | まるくなる | ノーマル | ミュウ・ミルタンク |
| `milk-drink` | ミルクのみ | ノーマル | ミュウ・ミルタンク |
| `snore` | いびき | ノーマル | カビゴン・ミュウ |
| `stomp` | ふみつけ | ノーマル | ミュウ・ミルタンク |
| `last-resort-rush` | とっておき | ノーマル |  |
| `last-resort-stars` | とっておき | ノーマル |  |
| `last-resort-slam` | とっておき | ノーマル |  |
| `last-resort-burst` | とっておき | ノーマル |  |
| `wish` | ねがいごと | ノーマル | ジラーチ |
| `hyper-voice` | ハイパーボイス | ノーマル | ラプラス・ニャース・ミュウ・ピィ・チルット・ラルトス・ルリリ |
| `double-edge` | すてみタックル | ノーマル | ピカチュウ・ガーディ・イーブイ・ドードー・ニャース・ストライク・ミュウ・ヒノアラシ ほか |
| `body-slam` | のしかかり | ノーマル | フシギダネ・ゼニガメ・イワーク・ドガース・サイホーン・ラプラス・ワンリキー・コダック ほか |
| `rapid-spin` | こうそくスピン | ノーマル | ヒトデマン |
| `explosion` | だいばくはつ | ノーマル | ドガース |
| `extreme-speed` | しんそく | ノーマル | ガーディ |
| `hyper-beam` | はかいこうせん | ノーマル | ミニリュウ・タツベイ |
| `tri-attack` | トライアタック | ノーマル | ドードー・ポリゴン |
| `metronome` | ゆびをふる | ノーマル | ミュウ |
| `double-slap` | おうふくビンタ | ノーマル | プリン・ププリン |
| `last-resort` | とっておき | ノーマル | イーブイ |
| `giga-impact` | ギガインパクト | ノーマル | カビゴン・ナマケロ |
| `pay-day` | ネコにこばん | ノーマル | ニャース |
| `slash` | きりさく | ノーマル | ヒトカゲ・ニャース・ストライク・ミュウ・ワニノコ・アチャモ・ナマケロ・アブソル |
| `echoed-voice` | エコーボイス | ノーマル | プリン・ププリン |
| `perish-song` | ほろびのうた | ノーマル | ラプラス |
| `swords-dance` | つるぎのまい | ノーマル | ストライク |
| `facade` | からげんき | ノーマル | マクノシタ |
| `thrash` | あばれる | ノーマル | ナマケロ |
| `ember` | ひのこ | ほのお | ヒトカゲ・ガーディ・イーブイ・ミュウ・ヒノアラシ・デルビル・アチャモ・ドンメル ほか |
| `fire-fang` | ほのおのキバ | ほのお | ヒトカゲ・ガーディ・イーブイ・ミュウ・ヒノアラシ・イワーク・デルビル・ヨーギラス ほか |
| `fire-spin` | ほのおのうず | ほのお | ヒトカゲ・ガーディ・イーブイ・ミュウ・ヒノアラシ・デルビル・アチャモ・ドンメル |
| `flame-charge` | ニトロチャージ | ほのお | ミュウ・イーブイ |
| `eruption-entei` | ふんか | ほのお | エンテイ |
| `lava-plume-entei` | ふんえん | ほのお | エンテイ |
| `overheat-entei` | オーバーヒート | ほのお | エンテイ |
| `sacred-fire-entei` | せいなるほのお | ほのお | エンテイ |
| `heat-wave-moltres` | ねっぷう | ほのお | ファイヤー |
| `burn-up-moltres` | もえつきる | ほのお | ファイヤー |
| `ember-moltres` | ひのこ | ほのお | ファイヤー |
| `sacred-fire-hooh` | せいなるほのお | ほのお | ホウオウ |
| `fire-punch` | ほのおのパンチ | ほのお | ワンリキー・アチャモ |
| `fire-pledge` | ほのおのちかい | ほのお | アチャモ |
| `blaze-kick` | ブレイズキック | ほのお | アチャモ |
| `sacred-fire` | せいなるほのお | ほのお | ミュウ |
| `flamethrower` | かえんほうしゃ | ほのお | ヒトカゲ・ガーディ・イーブイ・ミュウ・ヒノアラシ・デルビル・アチャモ・タツベイ |
| `flare-blitz` | フレアドライブ | ほのお | ヒトカゲ・ガーディ・イーブイ・ミュウ・ヒノアラシ・デルビル・アチャモ |
| `blast-burn` | ブラストバーン | ほのお | ヒトカゲ |
| `temper-flare` | やけっぱち | ほのお | イーブイ |
| `eruption` | ふんか | ほのお | ヒノアラシ・ドンメル |
| `lava-plume` | ふんえん | ほのお | ドンメル |
| `fire-blast` | だいもんじ | ほのお | デルビル |
| `water-gun` | みずでっぽう | みず | ゼニガメ・ヒトデマン・ラプラス・コダック・ヤドン・イーブイ・ミュウ・ワニノコ ほか |
| `bubble` | あわ | みず | ゼニガメ・ヒトデマン・ラプラス・コダック・ヤドン・イーブイ・ミュウ・タッツー ほか |
| `water-pulse-vaporeon` | みずのはどう | みず | ミュウ・イーブイ |
| `aqua-ring` | アクアリング | みず | イーブイ |
| `surf-suicune` | なみのり | みず | スイクン |
| `hydro-pump-lugia` | ハイドロポンプ | みず | ルギア |
| `whirlpool` | うずしお | みず | ゼニガメ・ヒトデマン・ラプラス・コダック・ヤドン・イーブイ・ミュウ・ワニノコ ほか |
| `aqua-jet` | アクアジェット | みず | ゼニガメ・コダック・ミュウ・ワニノコ |
| `rain-dance` | あまごい | みず | ニョロモ |
| `water-pledge` | みずのちかい | みず | ミズゴロウ |
| `wave-crash` | ウェーブタックル | みず | ミズゴロウ |
| `aqua-tail-slam-azumarill` | アクアテール | みず |  |
| `aqua-tail-cw` | アクアテール | みず |  |
| `aqua-tail-ccw` | アクアテール | みず |  |
| `aqua-tail-flip` | アクアテール | みず |  |
| `hydro-pump` | ハイドロポンプ | みず | ゼニガメ・ヒトデマン・ラプラス・コダック・ヤドン・イーブイ・ミュウ・ワニノコ ほか |
| `water-spout` | しおふき | みず | ゼニガメ・ミュウ |
| `liquidation` | アクアブレイク | みず | ミュウ・ワニノコ |
| `brine` | しおみず | みず | タッツー |
| `hydro-cannon` | ハイドロカノン | みず | ゼニガメ |
| `hydro-pump-hoenn` | ハイドロポンプ | みず | ヒンバス |
| `muddy-water-hoenn` | だくりゅう | みず | ミズゴロウ |
| `bubble-beam` | バブルこうせん | みず | ゼニガメ・ヒトデマン・ラプラス・コダック・ヤドン・イーブイ・ミュウ・タッツー ほか |
| `muddy-water` | だくりゅう | みず | イーブイ |
| `water-pulse` | みずのはどう | みず | ミズゴロウ・ヒンバス・ドジョッチ |
| `surf` | なみのり | みず | タマザラシ |
| `aqua-tail-azumarill` | アクアテール | みず | ルリリ |
| `vine-whip` | つるのムチ | くさ | フシギダネ・ナゾノクサ・ミュウ・チコリータ |
| `leech-seed` | やどりぎのタネ | くさ | フシギダネ・ナゾノクサ・ミュウ・チコリータ・セレビィ・キモリ |
| `sleep-powder` | ねむりごな | くさ | フシギダネ・ナゾノクサ・ミュウ・チコリータ |
| `magical-leaf` | マジカルリーフ | くさ | フシギダネ・ナゾノクサ・ミュウ・チコリータ・ピィ・トゲピー・セレビィ・キモリ ほか |
| `leaf-storm` | リーフストーム | くさ | フシギダネ・ナゾノクサ・ミュウ・チコリータ・キモリ |
| `leafage` | このは | くさ | キモリ |
| `grass-pledge` | くさのちかい | くさ | キモリ |
| `razor-leaf` | はっぱカッター | くさ | フシギダネ・ナゾノクサ・ミュウ・チコリータ |
| `giga-drain` | ギガドレイン | くさ | フシギダネ・ナゾノクサ・ミュウ・チコリータ・セレビィ・キモリ |
| `petal-dance` | はなびらのまい | くさ | ナゾノクサ |
| `frenzy-plant` | ハードプラント | くさ | フシギダネ |
| `synthesis` | こうごうせい | くさ | チコリータ |
| `solar-beam` | ソーラービーム | くさ | チコリータ |
| `leaf-blade` | リーフブレード | くさ | キモリ |
| `leaf-storm-celebi` | リーフストーム | くさ | セレビィ |
| `energy-ball` | エナジーボール | くさ | セレビィ |
| `thunder-shock` | でんきショック | でんき | ピカチュウ・イーブイ・ポリゴン・コイル・ミュウ・ピチュー・メリープ・ラクライ |
| `spark` | スパーク | でんき | ピカチュウ・ポリゴン・コイル・ミュウ・ピチュー・ラクライ |
| `charge-raikou` | じゅうでん | でんき | ライコウ |
| `rising-voltage-raikou` | ライジングボルト | でんき | ライコウ |
| `electric-terrain-raikou` | エレキフィールド | でんき | ライコウ |
| `zap-cannon-zapdos` | でんじほう | でんき | サンダー |
| `thunderbolt-zapdos` | １０まんボルト | でんき | サンダー |
| `thunder-shock-zapdos` | でんきショック | でんき | サンダー |
| `thunder-punch` | かみなりパンチ | でんき | ワンリキー |
| `thunder-wave` | でんじは | でんき | ピカチュウ・ミニリュウ・イーブイ・ポリゴン・コイル・ミュウ・ピチュー・メリープ ほか |
| `volt-switch` | ボルトチェンジ | でんき |  |
| `thunderbolt` | １０まんボルト | でんき | ピカチュウ・イーブイ・ポリゴン・コイル・ミュウ・ピチュー・メリープ・ラクライ |
| `wild-charge` | ワイルドボルト | でんき | ピカチュウ・イーブイ・コイル・ミュウ・ピチュー |
| `volt-tackle` | ボルテッカー | でんき | ピカチュウ・ピチュー |
| `zap-cannon` | でんじほう | でんき | メリープ |
| `thunder` | かみなり | でんき | ピカチュウ・ピチュー |
| `discharge` | ほうでん | でんき | メリープ |
| `thunder-fang` | かみなりのキバ | でんき | ラクライ |
| `wild-charge-hoenn` | ワイルドボルト | でんき | ラクライ |
| `electro-ball` | エレキボール | でんき | イーブイ |
| `powder-snow` | こなゆき | こおり | ラプラス・ミュウ・ウリムー・タマザラシ |
| `sheer-cold` | ぜったいれいど | こおり | ミュウ |
| `aurora-beam` | オーロラビーム | こおり | ラプラス・イーブイ・ミュウ・ウリムー・タマザラシ |
| `sheer-cold-suicune` | ぜったいれいど | こおり | スイクン |
| `freeze-dry-articuno` | フリーズドライ | こおり | フリーザー |
| `icy-wind-articuno` | こごえるかぜ | こおり | フリーザー |
| `blizzard-articuno` | ふぶき | こおり | フリーザー |
| `ice-shard-articuno` | こおりのつぶて | こおり | フリーザー |
| `icicle-crash-giant` | つららおとし | こおり |  |
| `ice-shard` | こおりのつぶて | こおり | ラプラス・ミュウ・ウリムー |
| `blizzard` | ふぶき | こおり | ラプラス・ミュウ・ウリムー・タマザラシ |
| `ice-beam` | れいとうビーム | こおり | ラプラス・ミュウ・ウリムー・タマザラシ |
| `ice-fang` | こおりのキバ | こおり | ウリムー |
| `sheer-cold-hoenn` | ぜったいれいど | こおり | タマザラシ |
| `icicle-crash` | つららおとし | こおり | ウリムー |
| `mach-punch` | マッハパンチ | かくとう | ワンリキー・ミュウ |
| `double-kick` | にどげり | かくとう | アチャモ |
| `bulk-up` | ビルドアップ | かくとう | アチャモ・マクノシタ |
| `close-combat-sweep` | インファイト | かくとう |  |
| `close-combat-kick` | インファイト | かくとう |  |
| `arm-thrust` | つっぱり | かくとう | ミュウ・ヘラクロス・マクノシタ |
| `counter` | カウンター | かくとう | ヒトカゲ・サイホーン・ワンリキー・ミュウ・ヘラクロス・ニョロモ・アチャモ・マクノシタ ほか |
| `submission` | じごくぐるま | かくとう | ニョロモ |
| `focus-punch` | きあいパンチ | かくとう | ワンリキー・ミュウ |
| `revenge` | リベンジ | かくとう | ミュウ・ヘラクロス |
| `dynamic-punch` | ばくれつパンチ | かくとう | ワンリキー・ニョロモ |
| `low-sweep` | ローキック | かくとう | アチャモ |
| `close-combat` | インファイト | かくとう | アチャモ |
| `force-palm` | はっけい | かくとう | マクノシタ |
| `superpower` | ばかぢから | かくとう | マクノシタ |
| `smog` | スモッグ | どく | ドガース・ゴース・イーブイ・ミュウ・デルビル |
| `acid-spray` | アシッドボム | どく | フシギダネ・ナゾノクサ・ドガース・ゴース・ミュウ |
| `sludge-bomb` | ヘドロばくだん | どく | フシギダネ・ナゾノクサ・ドガース・ゴース・ミュウ |
| `sludge-wave` | ヘドロウェーブ | どく | ドガース・ゴース・ミュウ |
| `poison-fang` | どくどくのキバ | どく | ズバット |
| `cross-poison` | クロスポイズン | どく | ズバット |
| `magnitude` | マグニチュード | じめん | イワーク・サイホーン・ミュウ・ウリムー・ヨーギラス・ミズゴロウ・ドンメル・ナックラー ほか |
| `mud-slap` | どろかけ | じめん | ミズゴロウ・ドンメル・ナックラー・ココドラ・ドジョッチ |
| `sand-tomb` | すなじごく | じめん | ミズゴロウ・ナックラー・ドジョッチ |
| `earthquake` | じしん | じめん | イワーク・サイホーン・ミュウ・ウリムー・ヨーギラス・ミズゴロウ・ドンメル・ナックラー ほか |
| `fissure` | じわれ | じめん | サイホーン |
| `mud-shot` | マッドショット | じめん | ミズゴロウ・ドジョッチ |
| `earth-power` | だいちのちから | じめん | ドジョッチ |
| `earthquake-hoenn` | じしん | じめん | ナックラー |
| `dig` | あなをほる | じめん | ナックラー |
| `gust` | かぜおこし | ひこう | ミュウ・ポッポ・ズバット |
| `sky-attack-moltres` | ゴッドバード | ひこう | ファイヤー |
| `drill-peck-zapdos` | ドリルくちばし | ひこう | サンダー |
| `aeroblast-lugia` | エアロブラスト | ひこう | ルギア |
| `gust-lugia` | かぜおこし | ひこう | ルギア |
| `sky-attack-hooh` | ゴッドバード | ひこう | ホウオウ |
| `gust-hooh` | かぜおこし | ひこう | ホウオウ |
| `sky-attack` | ゴッドバード | ひこう | ミュウ |
| `peck` | つつく | ひこう | ドードー・ミュウ・ウリムー・アチャモ・チルット |
| `brave-bird` | ブレイブバード | ひこう |  |
| `air-cutter` | エアカッター | ひこう | ヒトカゲ・ミニリュウ・ドードー・ストライク・ミュウ・トゲピー・ポッポ・ズバット ほか |
| `dual-wingbeat` | ダブルウイング | ひこう | ヒトカゲ・ミニリュウ・ストライク・ミュウ・トゲピー・ポッポ・ズバット・チルット ほか |
| `aeroblast` | エアロブラスト | ひこう | ミュウ |
| `air-slash` | エアスラッシュ | ひこう | ヒトカゲ・ミニリュウ・ストライク・ミュウ・トゲピー・ポッポ・ズバット・タツベイ |
| `wing-attack` | つばさでうつ | ひこう | ドードー・ミュウ・ポッポ |
| `aerial-ace` | つばめがえし | ひこう | ヒトカゲ・ミニリュウ・ストライク・ミュウ・トゲピー・ポッポ・ズバット・チルット ほか |
| `hurricane` | ぼうふう | ひこう | ポッポ |
| `sky-attack-hoenn` | ゴッドバード | ひこう | チルット |
| `confusion` | ねんりき | エスパー | ヒトデマン・ケーシィ・コダック・ヤドン・イーブイ・ミュウツー・ミュウ・セレビィ ほか |
| `psybeam` | サイケこうせん | エスパー | ヒトデマン・ドガース・ケーシィ・コダック・ヤドン・イーブイ・ポリゴン・ミュウツー ほか |
| `future-sight` | みらいよち | エスパー | ミュウツー・ミュウ・イーブイ |
| `mirror-coat-suicune` | ミラーコート | エスパー | スイクン |
| `calm-mind` | めいそう | エスパー | イーブイ・スイクン |
| `extrasensory-lugia` | じんつうりき | エスパー | ルギア |
| `mist-ball-latias` | ミストボール | エスパー | ラティアス |
| `heal-pulse-latias` | いやしのはどう | エスパー | ラティアス |
| `confusion-latias` | ねんりき | エスパー | ラティアス |
| `luster-purge-latios` | ラスターパージ | エスパー | ラティオス |
| `rest` | ねむる | エスパー | カビゴン |
| `agility` | こうそくいどう | エスパー | イーブイ |
| `healing-wish` | いやしのねがい | エスパー | セレビィ・ジラーチ |
| `mirror-coat` | ミラーコート | エスパー | ソーナノ |
| `reflect` | リフレクター | エスパー |  |
| `magic-coat` | マジックコート | エスパー |  |
| `mist-ball` | ミストボール | エスパー |  |
| `luster-purge` | ラスターパージ | エスパー |  |
| `psychic` | サイコキネシス | エスパー | ヒトデマン・ケーシィ・ヤドン・イーブイ・ミュウツー・ミュウ・ラルトス・ジラーチ |
| `stored-power` | アシストパワー | エスパー | イーブイ |
| `psystrike` | サイコブレイク | エスパー | ミュウツー |
| `amnesia` | ドわすれ | エスパー | ヤドン |
| `zen-headbutt` | しねんのずつき | エスパー | コダック・ヤドン |
| `future-sight-gardevoir` | みらいよち | エスパー | ラルトス |
| `future-sight-alakazam` | みらいよち | エスパー | ケーシィ・ヤドン |
| `future-sight-celebi` | みらいよち | エスパー | セレビィ |
| `pin-missile` | ミサイルばり | むし | ミュウ・イーブイ |
| `fury-cutter` | れんぞくぎり | むし | ストライク・ミュウ・ヘラクロス・キモリ |
| `x-scissor` | シザークロス | むし | ストライク |
| `megahorn` | メガホーン | むし | ヘラクロス |
| `rock-throw` | いわおとし | いわ | イワーク・サイホーン・ミュウ・ヨーギラス・ミズゴロウ・ココドラ |
| `sandstorm` | すなあらし | いわ | ヨーギラス |
| `stealth-rock` | ステルスロック | いわ | イワーク・サイホーン・ミュウ・ヨーギラス・ココドラ |
| `rock-blast` | ロックブラスト | いわ | イワーク・サイホーン・ミュウ・ヨーギラス・ココドラ |
| `rock-slide` | いわなだれ | いわ | イワーク・サイホーン・ミュウ・ヨーギラス・ミズゴロウ・ココドラ |
| `stone-edge` | ストーンエッジ | いわ | イワーク・ヨーギラス |
| `rollout` | ころがる | いわ | ミルタンク |
| `night-shade` | ナイトヘッド | ゴースト | ケーシィ・ゴース・ミュウ・カゲボウズ・ラルトス |
| `lick` | したでなめる | ゴースト | ゴース・ミュウ・カゲボウズ |
| `astonish` | おどろかす | ゴースト | ゴース・ミュウ・カゲボウズ |
| `shadow-ball` | シャドーボール | ゴースト | ゴース・ミュウツー・ミュウ・カゲボウズ・ラルトス |
| `hex` | たたりめ | ゴースト | ゴース |
| `phantom-force` | ゴーストダイブ | ゴースト | カゲボウズ |
| `destiny-bond` | みちづれ | ゴースト | ソーナノ |
| `dragon-tail` | ドラゴンテール | ドラゴン | ミニリュウ・ミュウ・タツベイ・ヒンバス・ナックラー |
| `dragon-rage` | りゅうのいかり | ドラゴン | ヒトカゲ・ミニリュウ・ミュウ・チルット・タツベイ |
| `dragon-pulse-latias` | りゅうのはどう | ドラゴン | ラティアス |
| `dragon-dance-latios` | りゅうのまい | ドラゴン | ラティオス |
| `draco-meteor-latios` | りゅうせいぐん | ドラゴン | ラティオス |
| `dragon-breath-latios` | りゅうのいぶき | ドラゴン | ラティオス |
| `twister` | たつまき | ドラゴン | タッツー・ヒンバス |
| `dragon-breath` | りゅうのいぶき | ドラゴン | ナックラー |
| `outrage-hit` | げきりん | ドラゴン |  |
| `outrage-last` | げきりん | ドラゴン |  |
| `dragon-rush` | ドラゴンダイブ | ドラゴン | ミニリュウ・ミュウ・ナックラー |
| `dragon-pulse` | りゅうのはどう | ドラゴン | ミニリュウ・ミュウ・チルット・タツベイ・ヒンバス・ナックラー |
| `outrage` | げきりん | ドラゴン | ミニリュウ・タツベイ |
| `dragon-claw` | ドラゴンクロー | ドラゴン | ミニリュウ・タツベイ |
| `draco-meteor` | りゅうせいぐん | ドラゴン | タッツー |
| `dark-pulse` | あくのはどう | あく | ゴース・イーブイ・ミュウ・デルビル・ヨーギラス・アブソル |
| `sucker-punch` | ふいうち | あく | ナマケロ・アブソル・カゲボウズ・クチート |
| `bite` | かみつく | あく | イーブイ・ワニノコ・ズバット |
| `crunch` | かみくだく | あく | ワニノコ |
| `snarl` | バークアウト | あく | デルビル・イーブイ |
| `night-slash` | つじぎり | あく | アブソル |
| `foul-play` | イカサマ | あく | アブソル |
| `foul-play-umbreon` | イカサマ | あく | イーブイ |
| `iron-tail` | アイアンテール | はがね | イワーク |
| `bullet-punch` | バレットパンチ | はがね | ストライク |
| `metal-claw` | メタルクロー | はがね | ココドラ・クチート |
| `heavy-slam` | ヘビーボンバー | はがね | カビゴン |
| `iron-defense` | てっぺき | はがね | イワーク・ココドラ |
| `flash-cannon` | ラスターカノン | はがね | コイル |
| `iron-head` | アイアンヘッド | はがね | ココドラ・クチート |
| `meteor-mash` | コメットパンチ | はがね | ダンバル |
| `meteor-mash-jirachi` | コメットパンチ | はがね | ジラーチ |
| `metal-burst` | メタルバースト | はがね | ココドラ |
| `doom-desire` | はめつのねがい | はがね | ジラーチ |
| `moonlight` | つきのひかり | フェアリー | イーブイ・ピィ |
| `charm` | あまえる | フェアリー | プリン・ミュウ・ププリン |
| `disarming-voice` | チャームボイス | フェアリー | プリン・ミュウ・ププリン |
| `play-rough` | じゃれつく | フェアリー | プリン・ププリン |
| `dazzling-gleam-jigglypuff` | マジカルシャイン | フェアリー | プリン・ププリン |
| `play-rough-hoenn` | じゃれつく | フェアリー | クチート |
| `moonblast` | ムーンフォース | フェアリー | ピィ |
| `dazzling-gleam` | マジカルシャイン | フェアリー | トゲピー |

## 5. 持ち物のコード

`items=` に書く。

| コード | 名前 | 最大レベル | 種類 |
|---|---|---|---|
| `x-attack` | プラスパワー | 5 | 能力 |
| `x-sp-atk` | スペシャルアップ | 5 | 能力 |
| `x-defense` | ディフェンダー | 5 | 能力 |
| `hp-up` | マックスアップ | 5 | 能力 |
| `x-speed` | スピーダー | 5 | 能力 |
| `dire-hit` | クリティカット | 5 | 能力 |
| `pp-max` | ポイントマックス | 2 | 能力 |
| `wide-lens` | こうかくレンズ | 5 | 能力 |
| `light-clay` | ひかりのねんど | 5 | 能力 |
| `zoom-lens` | フォーカスレンズ | 5 | 能力 |
| `razor-claw` | するどいツメ | 2 | 能力 |
| `quick-claw` | せんせいのツメ | 5 | 能力 |
| `metronome` | メトロノーム | 5 | 能力 |
| `dowsing-machine` | ダウジングマシン | 5 | 能力 |
| `lucky-egg` | しあわせタマゴ | 5 | 能力 |
| `silk-scarf` | シルクのスカーフ | 5 | タイプ |
| `silver-powder` | ぎんのこな | 5 | タイプ |
| `charcoal` | もくたん | 5 | タイプ |
| `mystic-water` | しんぴのしずく | 5 | タイプ |
| `miracle-seed` | きせきのタネ | 5 | タイプ |
| `magnet` | じしゃく | 5 | タイプ |
| `never-melt-ice` | とけないこおり | 5 | タイプ |
| `black-belt` | くろおび | 5 | タイプ |
| `poison-barb` | どくバリ | 5 | タイプ |
| `black-glasses` | くろいメガネ | 5 | タイプ |
| `soft-sand` | やわらかいすな | 5 | タイプ |
| `sharp-beak` | するどいくちばし | 5 | タイプ |
| `twisted-spoon` | まがったスプーン | 5 | タイプ |
| `hard-stone` | かたいいし | 5 | タイプ |
| `spell-tag` | のろいのおふだ | 5 | タイプ |
| `dragon-fang` | りゅうのキバ | 5 | タイプ |
| `fire-stone` | ほのおのいし | 1 | 進化 |
| `water-stone` | みずのいし | 1 | 進化 |
| `thunder-stone` | かみなりのいし | 1 | 進化 |
| `leaf-stone` | リーフのいし | 1 | 進化 |
| `moon-stone` | つきのいし | 1 | 進化 |
| `linking-cord` |  つながりのヒモ | 1 | 進化 |
| `kings-rock` | おうじゃのしるし | 1 | 進化 |
| `metal-coat` | メタルコート | 1 | 進化 |
| `up-grade` | アップグレード | 1 | 進化 |
| `dragon-scale` | りゅうのウロコ | 1 | 進化 |
| `light-ball` | でんきだま | 1 | 進化 |
| `everstone` | かわらずのいし | 1 | 進化 |
| `prism-scale` | きれいなウロコ | 1 | 進化 |

## 6. ボスのコード

| 地方 | `boss=`（四天王など。組のボスは相手も出る） | `legend=`（伝説） | `intruder=`（乱入） |
|---|---|---|---|
| カントー（`region=kanto`） | `lapras` ラプラス<br>`machamp` カイリキー<br>`gengar` ゲンガー<br>`dragonite` カイリュー | `mewtwo` ミュウツー<br>`mew` ミュウ<br>`articuno` フリーザー<br>`zapdos` サンダー<br>`moltres` ファイヤー<br>`charizard` 色違いのリザードン<br>`venusaur` 色違いのフシギバナ<br>`blastoise` 色違いのカメックス | — |
| ジョウト（`region=johto`） | `xatu` ネイティオ<br>`crobat` クロバット<br>`machamp` カイリキー<br>`houndoom` ヘルガー<br>`dragonite` カイリュー | `red-pikachu` レッドのピカチュウ<br>`red-espeon` レッドのエーフィ<br>`red-charizard` レッドのリザードン<br>`lugia` ルギア<br>`ho-oh` ホウオウ | `raikou` ライコウ<br>`entei` エンテイ<br>`suicune` スイクン |
| ホウエン（`region=hoenn`） | `absol` アブソル<br>`dusclops` サマヨール<br>`walrein` トドゼルガ<br>`salamence` ボーマンダ<br>`milotic` ミロカロス | `groudon` グラードン<br>`rayquaza` レックウザ<br>`deoxys` デオキシス | `latias` ラティアス<br>`latios` ラティオス |

- レッド戦: `red-pikachu` で 1 戦目から、`red-espeon` で 2 戦目（エーフィとカビゴン）、`red-charizard` で 3 戦目（御三家）から。
- ホウエンの四天王は 2 体の組（アブソルとダーテング・サマヨールとジュペッタ・トドゼルガとオニゴーリ・ボーマンダとフライゴン・ミロカロスとホエルオー）。
- `legend=groudon` はグラードンとカイオーガが一緒に出る。1 体だけにするなら `&solo`。
- 中ボス（ジムリーダー）も `boss=` で出せる（例: `boss=onix`・`region=johto&boss=miltank`・`region=hoenn&boss=slaking`）。
