import Phaser from 'phaser';
import { generated, regionsConfig, uiConfig } from '../data';
import { localName } from '../data/simRules';
import { getLocale, t } from '../i18n';
import { compactScreen, windowCss } from '../render/pixelUi';
import type { LobbySceneData } from './LobbyScene';
import { pokemonIconImage } from './pokemonPicker';
import type { SelectSceneData } from './SelectScene';

export interface RegionSceneData {
  /** 地方を決めた後: solo はポケモン選択、coop は部屋を作って待合室 */
  next: 'solo' | 'coop';
}

/** 最初に選んでおく地方（並びの先頭の遊べる地方） */
export function defaultRegion(): string {
  return regionsConfig.regions.find((r) => r.available)!.id;
}

/**
 * マップ（地方）の選択（作者の案 2026年10月22日。DOM）。プレイ → マップ選択 → ポケモン選択の順に進む。
 * 地方ごとにプレイアブルと出てくるポケモンが変わる。今遊べるのはカントーだけで、ほかの地方は「Coming soon」。
 * クリック・矢印キーで選び、Enter で決める。Esc でタイトルへ
 */
export class RegionScene extends Phaser.Scene {
  constructor() {
    super('region');
  }

  create(data: RegionSceneData): void {
    const regions = regionsConfig.regions;
    const root = document.createElement('div');
    root.style.cssText = `position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(960px,96vw);max-height:96vh;overflow:auto;${windowCss('dark')};padding:16px 24px;font-size:16px;line-height:1.6;box-sizing:border-box;z-index:20;display:flex;flex-direction:column;gap:12px`;
    document.body.append(root);
    // 低い画面（横向きのスマホ）では、案内の文を出さず、余白とカードをつめる
    const compact = compactScreen();
    if (compact) root.style.cssText += ';padding:6px 12px;gap:4px;max-height:100vh';
    const go = (id: string): void => {
      if (!regions.find((r) => r.id === id)?.available) return;
      if (data.next === 'coop') this.scene.start('lobby', { mode: 'host', region: id } satisfies LobbySceneData);
      else this.scene.start('select', { region: id } satisfies SelectSceneData);
    };
    const title = document.createElement('div');
    title.style.cssText = `font-size:${compact ? 20 : 24}px;text-align:center`;
    title.textContent = t('region.title');
    const hint = document.createElement('div');
    hint.style.cssText = 'text-align:center;opacity:0.75';
    hint.textContent = t('region.hint');
    if (compact) hint.style.display = 'none';
    const grid = document.createElement('div');
    grid.style.cssText = `display:grid;grid-template-columns:repeat(3,1fr);gap:${compact ? 6 : 10}px`;
    let cursor = Math.max(0, regions.findIndex((r) => r.available));
    const cards = regions.map((r, i) => {
      const card = document.createElement('div');
      card.style.cssText = `${windowCss('light')};${r.available ? 'cursor:pointer' : `background:${uiConfig.picker.lockedFill};box-shadow:none;cursor:default`};padding:${compact ? '4px 8px' : '10px 12px'};min-height:${compact ? 56 : 110}px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;text-align:center`;
      const name = document.createElement('div');
      name.style.fontSize = '20px';
      name.textContent = localName(generated.regions[r.id]?.names, getLocale(), r.id);
      card.append(name);
      if (r.available) {
        // 最初から選べるポケモンを3匹まで見せる
        const icons = document.createElement('div');
        icons.style.cssText = 'display:flex;gap:4px';
        for (const key of r.playables.slice(0, 3)) icons.append(pokemonIconImage(key, compact ? 28 : 40));
        const count = document.createElement('div');
        count.textContent = t('region.playables', { n: r.playables.length });
        card.append(icons, count);
      } else {
        const soon = document.createElement('div');
        soon.style.opacity = '0.8';
        soon.textContent = t('region.comingSoon');
        card.append(soon);
      }
      card.onpointerenter = () => {
        cursor = i;
        paint();
      };
      card.onclick = () => go(r.id);
      grid.append(card);
      return card;
    });
    const paint = (): void => {
      cards.forEach((c, i) => {
        c.style.borderColor = i === cursor ? uiConfig.picker.selected : uiConfig.window.border;
        c.style.outline = i === cursor && regions[i]!.available ? `3px solid ${uiConfig.picker.selected}` : '';
      });
    };
    paint();
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:flex-end';
    const back = document.createElement('button');
    back.style.cssText = `${windowCss('light')};min-height:${compact ? 36 : 44}px;padding:${compact ? '2px 12px' : '6px 16px'};cursor:pointer;font:inherit;font-size:16px`;
    back.textContent = t('select.back');
    back.onclick = () => this.scene.start('title');
    row.append(back);
    root.append(title, hint, grid, row);

    const onKey = (ev: KeyboardEvent): void => {
      const columns = cards.filter((c) => c.offsetTop === cards[0]!.offsetTop).length;
      const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
      const d = step[ev.key];
      if (d !== undefined) {
        ev.preventDefault();
        if (cursor + d >= 0 && cursor + d < regions.length) cursor += d;
        paint();
      } else if (ev.repeat) return;
      else if (ev.key === 'Enter') go(regions[cursor]!.id);
      else if (ev.key === 'Escape') this.scene.start('title');
    };
    window.addEventListener('keydown', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', onKey);
      root.remove();
    });
  }
}
