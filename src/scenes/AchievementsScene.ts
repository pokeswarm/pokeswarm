import Phaser from 'phaser';
import { achievementsConfig, playablesConfig } from '../data';
import { t } from '../i18n';
import { achievementCondition, achievementName, achievementReward } from '../meta/achievementText';
import { progressOf } from '../meta/progress';
import { session } from '../meta/session';

// 原作をまねた白い窓のボタン（作者の決定。2026年10月22日。src/render/pixelUi.ts の windowCss と同じ見た目）
const BUTTON = 'padding:8px 14px;cursor:pointer;font:inherit;font-size:16px;background:#f8f8f8;color:#383848;border:4px solid #383848;border-radius:6px;box-shadow:inset 0 0 0 3px #f8f8f8,inset 0 0 0 5px #a8b8c8';

/**
 * 実績の一覧（ポケモンの解放も実績に統合した）。条件は見せ、名前と報酬は達成するまで「？？？」。裏実績は条件も伏せる。
 * 1つの記録だけの条件は、進み具合（今の数 / 目標）も出す。
 */
export class AchievementsScene extends Phaser.Scene {
  constructor() {
    super('achievements');
  }

  create(): void {
    const root = document.createElement('div');
    root.style.cssText =
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(760px,92vw);max-height:90vh;overflow:auto;padding:24px;background:#000;color:#f8f8f8;border:4px solid #f8f8f8;box-shadow:inset 0 0 0 2px #000,inset 0 0 0 4px #f8f8f8;font-family:inherit;font-size:16px;line-height:1.6;border-radius:6px;z-index:20;box-sizing:border-box';
    document.body.appendChild(root);
    const render = (): void => {
      const save = session.store.current;
      const list = achievementsConfig.achievements;
      const done = list.filter((a) => save.achievements.includes(a.id)).length;
      const title = document.createElement('div');
      title.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px';
      const h = document.createElement('div');
      h.style.cssText = 'font-size:24px;font-weight:bold';
      h.textContent = t('achievements.title');
      const count = document.createElement('div');
      count.textContent = t('achievements.count', { done, total: list.length });
      title.append(h, count);

      // 作者の決定（2026年10月22日）: 達成の条件は見せ、何の実績か（名前）と報酬は達成するまで伏せる。裏実績は条件も伏せる
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px';
      for (const a of list) {
        const achieved = save.achievements.includes(a.id);
        const secret = a.hidden && !achieved;
        const cell = document.createElement('div');
        cell.style.cssText = `padding:10px 12px;border-radius:6px;border:2px solid ${achieved ? '#f8d030' : '#f8f8f8'};background:${achieved ? '#3d2a08' : '#000000'};${achieved ? '' : 'opacity:0.85'}`;
        const name = document.createElement('div');
        name.textContent = achieved ? achievementName(a.id) : t('achievements.secret');
        if (achieved) name.style.color = '#f8d030';
        const cond = document.createElement('div');
        cond.textContent = secret ? t('achievements.hiddenDesc') : achievementCondition(a);
        cell.append(name, cond);
        const p = progressOf(save.stats, a.condition);
        if (!achieved && !secret && p && p.target > 1) {
          const prog = document.createElement('div');
          prog.style.cssText = 'opacity:0.75';
          prog.textContent = t('achievements.progress', { current: Math.floor(p.current), target: p.target });
          cell.append(prog);
        }
        // 報酬: 達成するまで「？？？」（報酬があるかどうかも分からないように、まだのものはすべて出す）
        const playable = !!a.reward?.pokemon && Object.entries(playablesConfig.pokemon).some(([k, pl]) => (pl.unlock ?? k) === a.reward!.pokemon);
        const reward = achieved ? achievementReward(a, playable) : t('achievements.secret');
        if (reward) {
          const r = document.createElement('div');
          r.style.cssText = `color:${achieved ? '#a8e8a0' : '#a0a0a8'}`;
          r.textContent = t('achievements.reward', { reward });
          cell.append(r);
        }
        grid.append(cell);
      }

      const back = document.createElement('button');
      back.style.cssText = BUTTON + ';margin-top:16px';
      back.textContent = t('achievements.back');
      back.onclick = () => this.scene.start('title');
      root.replaceChildren(title, grid, back);
    };
    render();
    const off = session.store.onChange(render);
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') this.scene.start('title');
    };
    window.addEventListener('keydown', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      off();
      window.removeEventListener('keydown', onKey);
      root.remove();
    });
  }
}
