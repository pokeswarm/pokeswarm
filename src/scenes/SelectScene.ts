import Phaser from 'phaser';
import { playablesConfig } from '../data';
import { t } from '../i18n';
import { windowCss } from '../render/pixelUi';
import { loadPokemonAtRuntime } from '../render/sprites/runtimeLoad';
import { isPokemonUnlocked, PokemonPicker } from './pokemonPicker';
import type { RunSceneData } from './RunScene';

/**
 * ポケモン選択（ソロ。DOM）。プレイアブルのポケモンを全部アイコンで並べ、まだ解放していないものは黒塗りにする（作者の案 2026年10月22日）。
 * クリック・矢印キーで選び、ダブルクリック・Enter・「はじめる」でランを始める。Esc でタイトルへ。
 */
export class SelectScene extends Phaser.Scene {
  constructor() {
    super('select');
  }

  create(): void {
    const root = document.createElement('div');
    root.style.cssText = `position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(960px,96vw);max-height:96vh;overflow:auto;${windowCss('dark')};padding:20px 24px;font-size:16px;line-height:1.6;box-sizing:border-box;z-index:20;display:flex;flex-direction:column;gap:12px`;
    document.body.append(root);
    let starting = false;
    let selected: string | null = null;
    const start = (key: string): void => {
      if (starting) return;
      starting = true;
      // 選んだポケモンのスプライトを読んでから始める（取得していなければ仮の円）
      void loadPokemonAtRuntime(this, playablesConfig.pokemon[key]!.sprite).then((loaded) => {
        if (!this.sys.isActive()) return;
        const data: RunSceneData = { pokemon: key, playerSprite: loaded?.manifest ?? null, coop: null };
        this.scene.start('run', data);
      });
    };
    const go = document.createElement('button');
    const picker = new PokemonPicker({
      onSelect: (key) => {
        selected = key;
        go.disabled = false;
        go.style.opacity = '1';
      },
      onConfirm: start,
    });
    const title = document.createElement('div');
    title.style.cssText = 'font-size:24px;text-align:center';
    title.textContent = t('select.title');
    const hint = document.createElement('div');
    hint.style.cssText = 'text-align:center;opacity:0.75';
    hint.textContent = t('select.hint');
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap';
    const button = `${windowCss('light')};min-height:44px;padding:6px 16px;cursor:pointer;font:inherit;font-size:16px`;
    go.style.cssText = `${button};opacity:0.45`;
    go.textContent = t('select.start');
    go.disabled = true;
    go.onclick = () => {
      if (selected) start(selected);
    };
    const back = document.createElement('button');
    back.style.cssText = button;
    back.textContent = t('select.back');
    back.onclick = () => this.scene.start('title');
    row.append(go, back);
    root.append(title, hint, picker.element, row);
    // 最初は一覧の先頭の解放済みのポケモンを選んでおく（Enter ですぐ始められる）
    const first = Object.keys(playablesConfig.pokemon).find(isPokemonUnlocked);
    if (first) {
      picker.setSelected(first);
      selected = first;
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
      else if (ev.key === 'Escape') this.scene.start('title');
    };
    window.addEventListener('keydown', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', onKey);
      root.remove();
    });
  }
}
