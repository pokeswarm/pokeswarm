import Phaser from 'phaser';
import { bgmConfig, uiConfig } from '../data';
import { drawWindow, pixelButton, px } from '../render/pixelUi';
import { audio } from '../audio';
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
  /** このランで達成した実績の報酬（持ち物・コイン・バフ。解放したポケモンは newUnlocks） */
  rewards?: string[];
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
    audio.bgm.play(bgmConfig.scenes.result);
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
    // 真っ黒な背景に白い枠の窓を置き、ドットの文字で結果を出す（作者の決定。2026年10月22日）
    const layout = (): void => {
      this.children.removeAll(true);
      this.cameras.main.setBackgroundColor('#000000');
      const { width, height } = this.scale;
      const clear = summary.outcome === 'clear';
      // 画面の高さが低い（横向きのスマホ）ときは、見出しを小さくし、技を右に並べて1画面に収める
      const compact = height < 520;
      const boxW = Math.min(width - 32, compact ? 760 : 720);
      const x0 = (width - boxW) / 2;
      const g = this.add.graphics();
      // 見出し
      const headY = compact ? 8 : 24;
      const headH = compact ? 44 : 72;
      drawWindow(g, x0, headY, boxW, headH, 'dark');
      this.add.text(width / 2, headY + headH / 2, t(`run.${summary.outcome}`), px(compact ? 24 : 32, clear ? '#f8d030' : '#f87878')).setOrigin(0.5);
      // 結果（左に項目、右に値）
      const rows: [string, string][] = [
        [t('result.label.pokemon'), summary.pokemonName],
        [t('result.label.time'), formatTime(summary.seconds)],
        [t('result.label.level'), String(summary.level)],
        [t('result.label.kills'), String(summary.kills)],
        [t('result.label.coins'), String(summary.coins)],
      ];
      const lineH = compact ? 24 : 32;
      const listTop = headY + headH + (compact ? 8 : 16);
      const pad = compact ? 14 : 24;
      const extra: string[] = [
        ...(summary.legendary ? [t(`result.legendary.${summary.legendary.result}`, { name: summary.legendary.name })] : []),
        ...(summary.newAchievements.length ? [t('result.newAchievements', { list: summary.newAchievements.join(' / ') })] : []),
        ...(summary.newUnlocks.length ? [t('result.newUnlocks', { list: summary.newUnlocks.join(' / ') })] : []),
        ...(summary.rewards?.length ? [t('result.rewards', { list: summary.rewards.join(' / ') })] : []),
      ];
      const movesText = summary.moves.join('\n');
      // 狭いときは、項目と値を左半分、技を右半分に並べる
      const movesBelow = compact ? 0 : 8 + summary.moves.length * 24;
      const body = Math.max(rows.length * lineH, compact ? summary.moves.length * 24 : 0);
      const listH = pad + body + movesBelow + (extra.length ? 12 + extra.length * 24 : 0) + pad;
      drawWindow(g, x0, listTop, boxW, listH, 'dark');
      const text = uiConfig.dark.text;
      rows.forEach(([label, value], i) => {
        const y = listTop + pad + i * lineH;
        this.add.text(x0 + 32, y, label, px(16, text));
        this.add.text(compact ? x0 + boxW / 2 - 16 : x0 + boxW - 32, y, value, px(16, text)).setOrigin(1, 0);
      });
      const movesTop = compact ? listTop + pad : listTop + pad + rows.length * lineH + 8;
      this.add.text(compact ? x0 + boxW / 2 + 16 : x0 + 32, movesTop, movesText, px(16, '#a8d8f8', { lineSpacing: 8 }));
      const extraTop = listTop + pad + body + movesBelow + 12;
      if (extra.length) this.add.text(x0 + 32, extraTop, extra.join('\n'), px(16, '#f8d030', { lineSpacing: 8, wordWrap: { width: boxW - 64 } }));
      // ボタン
      const buttons: [string, () => void][] = [...(retry ? ([[t('result.retry'), again]] as [string, () => void][]) : []), [t('result.toTitle'), toTitle]];
      const by = Math.min(height - 30, listTop + listH + (compact ? 32 : 48));
      const bw = Math.min(280, (boxW - 16) / buttons.length);
      buttons.forEach(([label, onClick], i) => {
        const x = width / 2 + (i - (buttons.length - 1) / 2) * (bw + 16);
        pixelButton(this, x, by, bw, compact ? 44 : 48, label, onClick, { kind: 'dark' });
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
