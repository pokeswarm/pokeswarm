import Phaser from 'phaser';
import { t } from '../i18n';
import type { RunOutcome } from '../sim/world';
import type { RunSceneData } from './RunScene';

export interface RunSummary {
  outcome: RunOutcome;
  /** ランの経過秒数 */
  seconds: number;
  level: number;
  kills: number;
  /** 最後の姿のポケモンの名前（進化した後の名前） */
  pokemonName: string;
  /** 覚えていた技（名前と技のレベル） */
  moves: string[];
  /** このランで新しく達成した実績・解放したポケモン（名前） */
  newAchievements: string[];
  newUnlocks: string[];
  /** このランでもらったコイン */
  coins: number;
  /** 伝説戦の結果（伝説の名前と、won 倒した・lost 全員倒れた・timeUp 逃げられた） */
  legendary: { name: string; result: 'won' | 'lost' | 'timeUp' } | null;
}

export interface ResultSceneData {
  summary: RunSummary;
  /** もう一度遊ぶときのランの設定。協力プレイなら null（タイトルへ戻るだけ） */
  retry: RunSceneData | null;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 結果画面（見た目の作り込みはフェーズ4。コインと実績はフェーズ2） */
export class ResultScene extends Phaser.Scene {
  private params!: ResultSceneData;

  constructor() {
    super('result');
  }

  init(data: ResultSceneData): void {
    this.params = data;
  }

  create(): void {
    const { summary, retry } = this.params;
    let leaving = false;
    const again = (): void => {
      if (leaving || !retry) return;
      leaving = true;
      this.scene.start('run', retry);
    };
    const toTitle = (): void => {
      if (leaving) return;
      leaving = true;
      this.scene.start('title');
    };
    const layout = (): void => {
      this.children.removeAll(true);
      const { width, height } = this.scale;
      const clear = summary.outcome === 'clear';
      this.add
        .text(width / 2, height * 0.2, t(`run.${summary.outcome}`), { fontFamily: 'sans-serif', fontSize: '56px', fontStyle: 'bold', color: clear ? '#ffe082' : '#ef9a9a' })
        .setOrigin(0.5);
      const lines = [
        t('result.pokemon', { name: summary.pokemonName }),
        t('result.time', { time: formatTime(summary.seconds) }),
        t('result.level', { level: summary.level }),
        t('result.kills', { kills: summary.kills }),
        t('result.coins', { coins: summary.coins }),
        t('result.moves', { moves: summary.moves.join(' / ') }),
        ...(summary.legendary ? [t(`result.legendary.${summary.legendary.result}`, { name: summary.legendary.name })] : []),
        ...(summary.newAchievements.length ? ['', t('result.newAchievements', { list: summary.newAchievements.join(' / ') })] : []),
        ...(summary.newUnlocks.length ? [t('result.newUnlocks', { list: summary.newUnlocks.join(' / ') })] : []),
      ];
      this.add
        .text(width / 2, height * 0.33, lines, { fontFamily: 'sans-serif', fontSize: '22px', color: '#ffffff', align: 'center', lineSpacing: 10, wordWrap: { width: width * 0.9 } })
        .setOrigin(0.5, 0);
      const buttons: [string, () => void][] = [...(retry ? ([[t('result.retry'), again]] as [string, () => void][]) : []), [t('result.toTitle'), toTitle]];
      buttons.forEach(([label, onClick], i) => {
        const x = width / 2 + (i - (buttons.length - 1) / 2) * Math.min(320, width * 0.4);
        const bg = this.add.rectangle(x, height * 0.8, Math.min(280, width * 0.36), 56, 0x162416).setStrokeStyle(2, 0x4a7a4a).setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => bg.setStrokeStyle(3, 0xffb300));
        bg.on('pointerout', () => bg.setStrokeStyle(2, 0x4a7a4a));
        bg.on('pointerdown', onClick);
        this.add.text(x, height * 0.8, label, { fontFamily: 'sans-serif', fontSize: '20px', color: '#ffffff' }).setOrigin(0.5);
      });
    };
    layout();
    this.scale.on('resize', layout);
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.repeat) return;
      if (ev.key === 'r' || ev.key === 'R' || ev.key === 'Enter') again();
      else if (ev.key === 't' || ev.key === 'T' || ev.key === 'Escape') toTitle();
    };
    window.addEventListener('keydown', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', layout);
      window.removeEventListener('keydown', onKey);
    });
  }
}
