import Phaser from 'phaser';
import { freshHatchSeed, hatchedPokemon } from '../meta/hatch';
import { playablesConfig, regionsConfig } from '../data';
import { t } from '../i18n';
import { compactScreen, windowCss } from '../render/pixelUi';
import { loadPokemonAtRuntime } from '../render/sprites/runtimeLoad';
import { isPokemonUnlocked, PokemonPicker } from './pokemonPicker';
import { LoadoutOptionsPanel } from './loadoutOptionsPanel';
import { shinySpriteKey } from '../meta/loadoutOptions';
import type { RunSceneData } from './RunScene';
import { devAllRegions, type RegionSceneData } from './RegionScene';

export interface SelectSceneData {
  /** マップの選択で選んだ地方（data/game/regions.json） */
  region: string;
}

/**
 * ポケモン選択（ソロ。DOM）。マップの選択の次の画面。選んだ地方のプレイアブルのポケモンを全部アイコンで並べ、まだ解放していないものは黒塗りにする（作者の案 2026年10月22日）。
 * クリック・矢印キーで選び、ダブルクリック・Enter・「はじめる」でランを始める。Esc でマップの選択へ戻る。
 */
export class SelectScene extends Phaser.Scene {
  constructor() {
    super('select');
  }

  create(data: SelectSceneData): void {
    const region = regionsConfig.regions.find((r) => r.id === data.region && (r.available || devAllRegions())) ?? regionsConfig.regions.find((r) => r.available)!;
    const back = (): void => void this.scene.start('region', { next: 'solo' } satisfies RegionSceneData);
    const root = document.createElement('div');
    root.style.cssText = `position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(960px,96vw);max-height:96vh;overflow:auto;${windowCss('dark')};padding:20px 24px;font-size:16px;line-height:1.6;box-sizing:border-box;z-index:20;display:flex;flex-direction:column;gap:12px`;
    document.body.append(root);
    // 低い画面（横向きのスマホ）では、案内の文を出さず、余白をつめる
    const compact = compactScreen();
    if (compact) root.style.cssText += ';padding:6px 12px;gap:4px;max-height:100vh';
    let starting = false;
    let selected: string | null = null;
    // 最初の持ち物・色違い（そのポケモンでクリアした・色違いを解放したときだけ出る）
    const options = new LoadoutOptionsPanel(() => undefined, region.id);
    const start = (key: string): void => {
      if (starting) return;
      starting = true;
      // 選んだポケモンのスプライトを読んでから始める（取得していなければ仮の円）
      options.setPokemon(key);
      const { startItem, shiny } = options.options;
      // タマゴは、ここでかえるベイビィポケモンを引く（ランの最初に、かえる演出を見せる）
      const pokemon = hatchedPokemon(key, freshHatchSeed());
      const sprite = playablesConfig.pokemon[pokemon]!.sprite;
      void loadPokemonAtRuntime(this, shiny ? shinySpriteKey(sprite) : sprite).then((loaded) => {
        if (!this.sys.isActive()) return;
        const data: RunSceneData = { pokemon, region: region.id, playerSprite: loaded?.manifest ?? null, coop: null, startItem, shiny, ...(pokemon !== key && { hatchedFrom: key }) };
        this.scene.start('run', data);
      });
    };
    const go = document.createElement('button');
    const picker = new PokemonPicker({
      playables: region.playables,
      onSelect: (key) => {
        selected = key;
        options.setPokemon(key);
        go.disabled = false;
        go.style.opacity = '1';
      },
      onConfirm: start,
    });
    const title = document.createElement('div');
    title.style.cssText = `font-size:${compact ? 20 : 24}px;text-align:center`;
    title.textContent = t('select.title');
    const hint = document.createElement('div');
    hint.style.cssText = 'text-align:center;opacity:0.75';
    hint.textContent = t('select.hint');
    if (compact) hint.style.display = 'none';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap';
    const button = `${windowCss('light')};min-height:${compact ? 36 : 44}px;padding:${compact ? '2px 12px' : '6px 16px'};cursor:pointer;font:inherit;font-size:16px`;
    go.style.cssText = `${button};opacity:0.45`;
    go.textContent = t('select.start');
    go.disabled = true;
    go.onclick = () => {
      if (selected) start(selected);
    };
    const backButton = document.createElement('button');
    backButton.style.cssText = button;
    backButton.textContent = t('select.back');
    backButton.onclick = back;
    row.append(go, backButton);
    // 低い画面（横向きのスマホ）では2列にする: 左に一覧、右に詳しい欄・最初の持ち物・ボタン（縦に並べると収まらず、ボタンが画面の外に出ていた）
    if (compact) {
      const right = document.createElement('div');
      right.style.cssText = 'display:flex;flex-direction:column;gap:6px;min-width:0';
      row.style.justifyContent = 'stretch';
      for (const b of [go, backButton]) b.style.flex = '1 1 0';
      right.append(picker.detailElement, options.element, row);
      const body = document.createElement('div');
      body.style.cssText = 'display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:10px;align-items:start';
      body.append(picker.element, right);
      root.append(title, body);
    } else root.append(title, hint, picker.element, options.element, row);
    // 最初は一覧の先頭の解放済みのポケモンを選んでおく（Enter ですぐ始められる）
    const first = region.playables.find(isPokemonUnlocked);
    if (first) {
      picker.setSelected(first);
      selected = first;
      options.setPokemon(first);
      go.disabled = false;
      go.style.opacity = '1';
    }

    const onKey = (ev: KeyboardEvent): void => {
      const dir: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const d = dir[ev.key];
      if (d) {
        ev.preventDefault();
        picker.move(d[0], d[1]);
      } else if (ev.repeat) return;
      else if (ev.key === 'Enter') picker.confirm();
      else if (ev.key === 'Escape') back();
    };
    window.addEventListener('keydown', onKey);
    // 画面の向きが変わって、低い画面かどうかが変わったら作り直す（並べ方が違うため）
    const onResize = (): void => {
      if (compactScreen() !== compact && !starting) this.scene.restart(data);
    };
    window.addEventListener('resize', onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      root.remove();
    });
  }
}
