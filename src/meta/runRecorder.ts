import type { World } from '../sim/world';
import { elapsedSeconds } from '../sim/world';
import { addStat, maxStat } from './saveData';
import type { SaveStore } from './saveStore';

/**
 * ラン中の記録をセーブデータに足す（01_game_design.md 8.2）。
 * ラン中は数えるだけにして、数分ごと（commit）とラン終了時（finish）にまとめて足す。
 * 足した分を覚えておき、同じ分を2回足さない。
 */
export class RunRecorder {
  private kills = 0;
  private seconds = 0;
  private finished = false;

  constructor(
    private readonly store: SaveStore,
    /** 使ったポケモン（data/game/playables.json のキー） */
    private readonly pokemon: string,
  ) {}

  /** ここまでの撃破数・遊んだ時間を足す（変化が無ければ何もしない） */
  commit(world: World): void {
    if (this.finished) return;
    const kills = world.stats.kills - this.kills;
    const seconds = Math.floor(elapsedSeconds(world)) - this.seconds;
    if (kills <= 0 && seconds <= 0) return;
    this.kills += kills;
    this.seconds += seconds;
    this.store.update((d) => {
      addStat(d, 'kills', kills);
      addStat(d, 'playSeconds', seconds);
    });
  }

  /** ラン終了時: 残りを足し、回数・クリア・最高記録を記録する */
  finish(world: World): void {
    if (this.finished) return;
    this.commit(world);
    this.finished = true;
    const clear = world.outcome === 'clear';
    this.store.update((d) => {
      addStat(d, 'runs', 1);
      addStat(d, `runs.${this.pokemon}`, 1);
      if (clear) {
        addStat(d, 'clears', 1);
        addStat(d, `clears.${this.pokemon}`, 1);
      }
      maxStat(d, 'bestKills', world.stats.kills);
      maxStat(d, 'bestLevel', world.level);
      maxStat(d, 'longestSeconds', Math.floor(elapsedSeconds(world)));
    });
  }
}
