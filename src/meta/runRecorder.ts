import type { World } from '../sim/world';
import { elapsedSeconds } from '../sim/world';
import { addStat, maxStat } from './saveData';
import type { SaveStore } from './saveStore';
import type { ShopConfig } from '../data/schema';
import { coinsForRun, permanentBonus } from './shop';
import { refreshDerivedStats, type DerivedStatSources } from './progress';
import { HOME_REGION, regionStatKey } from './regionScope';

/**
 * ラン中の記録をセーブデータに足す（01_game_design.md 8.2）。
 * 出来事（撃破・進化・派生など）を observe で数えるだけにして、数分ごと（commit）とラン終了時（finish）に
 * まとめて足す（Firestore の書き込みを増やさない）。足した分は消すので、同じ分を2回足さない。
 *
 * 記録の名前（data/game/achievements.json の条件で使う）:
 *   kills, defeated.<ポケモン>, bossDefeated.<ポケモン>（中ボス・ボス・伝説として出たもの）, midbossKills, bossKills, legendaryKills, evolutions, evolvedTo.<ポケモン>,
 *   derivations, derived.<技>, uniqueMoves, playSeconds,
 *   runs, runs.<ポケモン>, runs.coop, clears, clears.<ポケモン>, clears.solo, clears.coop,
 *   bestKills, bestLevel, longestSeconds, bestMidbosses（最高記録）,
 *   reached.<ポケモン>（そのポケモンで1回のランに倒した中ボス・四天王の数の最高）, bestLevel.<ポケモン>（そのポケモンで届いた最高レベル）,
 *   distinctClears（クリアしたポケモンの種類の数）, uniqueKinds（出した固有技の種類の数）。最後の2つは足すのではなく、ほかの記録から数え直す
 * 協力プレイ（03_network.md 3.6）: 雑魚はとどめを刺した人だけ、中ボス・ボスは参加者全員に数える。
 * カントー以外の地方のランは、記録の名前の頭に "<地方>:" を付ける（02 の17章。コインの合計 coinsEarned だけは共通）。
 */
export class RunRecorder {
  private readonly pending = new Map<string, number>();
  private seconds = 0;
  /** このランで自分が倒した数（最高記録に使う） */
  private runKills = 0;
  /** このランで倒した中ボス・四天王・伝説（全員に数える。コインに使う） */
  private runMidbosses = 0;
  private runBosses = 0;
  private runLegendary = 0;
  private finished = false;
  /** ラン終了時にもらったコイン（結果画面に出す） */
  coinsEarned = 0;

  constructor(
    private readonly store: SaveStore,
    /** 使ったポケモン（data/game/playables.json のキー） */
    private readonly pokemon: string,
    /** コインの入り方（省略するとコインは入らない。テスト用） */
    private readonly shop: ShopConfig | null = null,
    /** 数え直す記録（distinctClears・uniqueKinds）のもと。省略すると数えない */
    private readonly derived: DerivedStatSources | null = null,
    /** 遊んでいる地方（記録の名前・永続強化のコインの増加に使う） */
    private readonly region: string = HOME_REGION,
  ) {}

  private count(key: string, n = 1): void {
    const k = regionStatKey(this.region, key);
    this.pending.set(k, (this.pending.get(k) ?? 0) + n);
  }

  /** 最高記録をその地方の記録に書く */
  private best(d: Parameters<typeof maxStat>[0], key: string, value: number): void {
    maxStat(d, regionStatKey(this.region, key), value);
  }

  /** 1回の更新の後に呼び、その更新の出来事を数える */
  observe(world: World): void {
    if (this.finished) return;
    const me = world.localPlayerId;
    for (const ev of world.events) {
      switch (ev.type) {
        case 'enemyKilled': {
          const kind = world.rules.enemies.kinds[ev.kind];
          if (!kind) break;
          const rank = kind.rank ?? 'normal';
          const species = kind.species ?? kind.id;
          // 雑魚は自分がとどめを刺したときだけ、中ボス・ボスは全員に数える
          if (rank === 'normal' && ev.by !== me) break;
          if (ev.by === me) {
            this.count('kills');
            this.runKills++;
          }
          this.count(`defeated.${species}`);
          if (rank !== 'normal') this.count(`bossDefeated.${species}`);
          if (rank === 'midboss') {
            this.count('midbossKills');
            this.runMidbosses++;
          }
          if (rank === 'boss') {
            this.count('bossKills');
            this.runBosses++;
          }
          if (rank === 'legendary') {
            this.count('legendaryKills');
            this.runLegendary++;
          }
          break;
        }
        case 'evolved':
          if (ev.playerId !== me) break;
          this.count('evolutions');
          this.count(`evolvedTo.${world.rules.species[ev.to]?.key ?? ev.to}`);
          break;
        case 'upgradeChosen':
          if (ev.playerId !== me || ev.offer.kind !== 'derive') break;
          this.count('derivations');
          this.count(`derived.${world.rules.moves[ev.offer.to]?.key ?? ev.offer.to}`);
          if (ev.offer.unique) this.count('uniqueMoves');
          break;
        default:
          break;
      }
    }
  }

  /** ここまでに数えた分と遊んだ時間をセーブデータに足す（足すものが無ければ何もしない） */
  commit(world: World): void {
    if (this.finished) return;
    const seconds = Math.floor(elapsedSeconds(world)) - this.seconds;
    if (seconds > 0) {
      this.count('playSeconds', seconds);
      this.seconds += seconds;
    }
    if (this.pending.size === 0) return;
    const add = [...this.pending];
    this.pending.clear();
    this.store.update((d) => {
      for (const [key, n] of add) addStat(d, key, n);
    });
  }

  /** ラン中の、ここまでにもらえるコインの見込み（画面上部に出す。終わったときの計算と同じ。クリアと伝説は含めない） */
  liveCoins(world: World): number {
    if (!this.shop) return 0;
    const greed = permanentBonus(this.store.current, this.shop, this.region).coinPct;
    return Math.floor(
      coinsForRun(this.shop, { seconds: elapsedSeconds(world), kills: this.runKills, midbosses: this.runMidbosses, bosses: this.runBosses, clear: false, legendaryWon: false }) *
        (1 + greed / 100),
    ) + this.bonusCoins(world);
  }

  /** レベルアップの「コイン」・ネコにこばん でもらった分（自分の分だけ。ネコにこばんの端数は切り捨てる） */
  private bonusCoins(world: World): number {
    return Math.floor(world.players.find((p) => p.id === world.localPlayerId)?.bonusCoins ?? 0);
  }

  /** ラン終了時: 残りを足し、回数・クリア・最高記録を記録する */
  finish(world: World): void {
    if (this.finished) return;
    const clear = world.outcome === 'clear';
    this.count('runs');
    if (world.role !== 'solo') this.count('runs.coop');
    this.count(`runs.${this.pokemon}`);
    if (clear) {
      this.count('clears');
      this.count(`clears.${this.pokemon}`);
      this.count(world.role === 'solo' ? 'clears.solo' : 'clears.coop');
    }
    this.commit(world);
    this.finished = true;
    // コイン（01_game_design.md 8.3。失敗・切断でも、そこまでの分をもらえる）
    const greed = this.shop ? permanentBonus(this.store.current, this.shop, this.region).coinPct : 0;
    this.coinsEarned = this.shop
      ? Math.floor(
          coinsForRun(this.shop, {
          seconds: elapsedSeconds(world),
          kills: this.runKills,
          midbosses: this.runMidbosses,
          bosses: this.runBosses,
          clear,
          legendaryWon: this.runLegendary > 0,
          }) *
            (1 + greed / 100),
        ) + this.bonusCoins(world)
      : this.bonusCoins(world);
    this.store.update((d) => {
      d.coins += this.coinsEarned;
      if (this.coinsEarned > 0) d.stats.coinsEarned = (d.stats.coinsEarned ?? 0) + this.coinsEarned;
      this.best(d, 'bestKills', this.runKills);
      this.best(d, 'bestMidbosses', this.runMidbosses);
      this.best(d, 'bestLevel', world.level);
      this.best(d, `reached.${this.pokemon}`, this.runMidbosses + this.runBosses);
      this.best(d, `bestLevel.${this.pokemon}`, world.level);
      if (this.derived) refreshDerivedStats(d.stats, this.derived, this.region);
      this.best(d, 'longestSeconds', Math.floor(elapsedSeconds(world)));
    });
  }
}
