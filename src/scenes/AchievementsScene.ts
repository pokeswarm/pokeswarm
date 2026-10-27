import Phaser from 'phaser';
import { achievementsConfig, generated, playablesConfig, regionsConfig } from '../data';
import { localName } from '../data/simRules';
import { getLocale, t } from '../i18n';
import { visibleAchievementCondition, achievementName, achievementReward } from '../meta/achievementText';
import { progressOf } from '../meta/progress';
import { regionStats } from '../meta/regionScope';
import { session } from '../meta/session';
import { compactScreen } from '../render/pixelUi';
import { regionPlayable } from './RegionScene';

// 原作をまねた白い窓のボタン（作者の決定。2026年10月22日。src/render/pixelUi.ts の windowCss と同じ見た目）
const BUTTON = 'min-height:44px;padding:8px 14px;cursor:pointer;font:inherit;font-size:16px;background:#f8f8f8;color:#383848;border:4px solid #383848;border-radius:6px;box-shadow:inset 0 0 0 3px #f8f8f8,inset 0 0 0 5px #a8b8c8';

/**
 * 実績の一覧（ポケモンの解放も実績に統合した）。条件は見せ、名前と報酬は達成するまで「？？？」。裏実績は条件も伏せる。
 * 1つの記録だけの条件は、進み具合（今の数 / 目標）も出す。
 * 実績は地方ごと（02 の17章）。上の地方のタブで、その地方の実績だけを見せる（遊べる地方で、実績のある地方だけ。1つならタブを出さない）。
 */
export class AchievementsScene extends Phaser.Scene {
  constructor() {
    super('achievements');
  }

  create(): void {
    // 作者の依頼（2026年10月22日）: 1行に1つの実績（名前・条件・報酬を横に並べる）。行が増えるので、見出しと戻るボタンは上に固定し、一覧だけを動かす
    const root = document.createElement('div');
    root.style.cssText =
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(1040px,96vw);height:min(90vh,900px);display:flex;flex-direction:column;padding:16px 20px;background:#000;color:#f8f8f8;border:4px solid #f8f8f8;box-shadow:inset 0 0 0 2px #000,inset 0 0 0 4px #f8f8f8;font-family:inherit;font-size:16px;line-height:1.6;border-radius:6px;z-index:20;box-sizing:border-box';
    // 低い画面（横向きのスマホ）では余白・文字・ボタンをつめる（ショップと同じ）
    const compact = compactScreen();
    if (compact) root.style.cssText += ';padding:8px 12px;height:96vh';
    document.body.appendChild(root);
    const columns = 'grid-template-columns:minmax(0,1.1fr) minmax(0,1.6fr) minmax(0,1.1fr)';
    let region = 'kanto';
    const render = (): void => {
      const save = session.store.current;
      const regions = regionsConfig.regions.filter((r) => regionPlayable(r) && achievementsConfig.achievements.some((a) => a.region === r.id));
      if (!regions.some((r) => r.id === region)) region = regions[0]?.id ?? 'kanto';
      const list = achievementsConfig.achievements.filter((a) => a.region === region);
      const done = list.filter((a) => save.achievements.includes(a.id)).length;
      const head = document.createElement('div');
      head.style.cssText = `display:flex;align-items:center;gap:16px;margin-bottom:${compact ? 4 : 10}px;flex:none`;
      const h = document.createElement('div');
      h.style.cssText = `font-size:${compact ? 20 : 24}px;font-weight:bold`;
      h.textContent = t('achievements.title');
      const count = document.createElement('div');
      count.style.flex = '1';
      count.textContent = t('achievements.count', { done, total: list.length });
      const back = document.createElement('button');
      back.style.cssText = BUTTON + (compact ? ';min-height:36px;padding:2px 10px' : '');
      back.textContent = t('achievements.back');
      back.onclick = () => this.scene.start('title');
      head.append(h, count, back);

      // 地方のタブ（選んでいる地方は明るく）
      const tabs = document.createElement('div');
      tabs.style.cssText = `display:flex;gap:8px;margin-bottom:${compact ? 4 : 8}px;flex:none`;
      for (const r of regions) {
        const tab = document.createElement('button');
        tab.style.cssText = BUTTON + (compact ? ';min-height:32px;padding:2px 10px' : ';min-height:36px;padding:4px 14px') + (r.id === region ? '' : ';opacity:0.5');
        tab.textContent = localName(generated.regions[r.id]?.names, getLocale(), r.id);
        tab.onclick = () => {
          region = r.id;
          render();
        };
        tabs.append(tab);
      }

      // 列の見出し
      const labels = document.createElement('div');
      labels.style.cssText = `display:grid;${columns};gap:12px;padding:0 12px 6px;opacity:0.7;flex:none;border-bottom:2px solid #f8f8f8`;
      for (const key of ['achievements.colName', 'achievements.colCondition', 'achievements.colReward'] as const) {
        const l = document.createElement('div');
        l.textContent = t(key);
        labels.append(l);
      }

      // 作者の決定（2026年10月22日）: 達成の条件は見せ、何の実績か（名前）と報酬は達成するまで伏せる。裏実績は条件も伏せる
      const rows = document.createElement('div');
      rows.style.cssText = 'flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:4px;padding-top:6px';
      for (const a of list) {
        const achieved = save.achievements.includes(a.id);
        const secret = a.hidden && !achieved;
        const row = document.createElement('div');
        row.style.cssText = `display:grid;${columns};gap:12px;align-items:center;padding:6px 12px;border-radius:6px;border:2px solid ${achieved ? '#f8d030' : '#585868'};background:${achieved ? '#3d2a08' : '#000000'};overflow-wrap:anywhere`;
        const name = document.createElement('div');
        name.textContent = achieved ? achievementName(a.id) : t('achievements.secret');
        name.style.color = achieved ? '#f8d030' : '#a0a0a8';
        const cond = document.createElement('div');
        // 条件と進み具合は、その実績の地方の記録で見る（02 の17章）
        const stats = regionStats(save.stats, a.region);
        cond.textContent = secret ? t('achievements.hiddenDesc') : visibleAchievementCondition(a, stats, achieved);
        const p = progressOf(stats, a.condition);
        if (!achieved && !secret && p && p.target > 1) {
          const prog = document.createElement('span');
          prog.style.cssText = 'opacity:0.7;margin-left:8px;white-space:nowrap';
          prog.textContent = t('achievements.progress', { current: Math.floor(p.current), target: p.target });
          cond.append(prog);
        }
        // 報酬: 達成するまで「？？？」（報酬があるかどうかも分からないように、まだのものはすべて出す）
        const playable = !!a.reward?.pokemon && Object.entries(playablesConfig.pokemon).some(([k, pl]) => (pl.unlock ?? k) === a.reward!.pokemon);
        const reward = document.createElement('div');
        reward.style.color = achieved ? '#a8e8a0' : '#a0a0a8';
        reward.textContent = (achieved ? achievementReward(a, playable) : t('achievements.secret')) ?? '';
        row.append(name, cond, reward);
        rows.append(row);
      }
      const scroll = root.querySelector<HTMLDivElement>('[data-rows]')?.scrollTop ?? 0;
      rows.dataset.rows = '1';
      root.replaceChildren(...(regions.length > 1 ? [head, tabs] : [head]), labels, rows);
      // 記録が変わって描き直しても、読んでいた場所のまま
      rows.scrollTop = scroll;
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
