import { generated } from '../data';
import { localName } from '../data/simRules';
import { getLocale, t } from '../i18n';
import { canChooseStartItem, canUseShiny, rememberedOptions, rememberOptions, startItemChoices } from '../meta/loadoutOptions';
import { session } from '../meta/session';
import { windowCss } from '../render/pixelUi';

export interface LoadoutOptions {
  startItem: string | null;
  shiny: boolean;
}

/**
 * ポケモン選択・待合室の、ラン開始時に選ぶもの（作者の決定 2026年10月24日）: 最初の持ち物（そのポケモンでクリアすると選べる）と色違い。
 * 選んだものはポケモンごとにこのブラウザに覚え、次に同じポケモンを選んだときに戻す
 */
export class LoadoutOptionsPanel {
  readonly element: HTMLDivElement;
  private pokemon: string | null = null;
  private value: LoadoutOptions = { startItem: null, shiny: false };

  constructor(
    private readonly onChange: (options: LoadoutOptions) => void,
    /** 遊ぶ地方（最初の持ち物・色違いは、その地方のクリアと実績で決まる） */
    private readonly region = 'kanto',
  ) {
    this.element = document.createElement('div');
    this.element.style.cssText = 'display:flex;gap:16px;align-items:center;flex-wrap:wrap;min-height:36px';
  }

  get options(): LoadoutOptions {
    return { ...this.value };
  }

  /** 選んでいるポケモンが変わったとき */
  setPokemon(pokemon: string | null): void {
    if (pokemon === this.pokemon) return;
    this.pokemon = pokemon;
    const save = session.store.current;
    if (!pokemon) {
      this.value = { startItem: null, shiny: false };
    } else {
      const kept = rememberedOptions(pokemon);
      const choices = canChooseStartItem(save, pokemon, this.region) ? startItemChoices(save, pokemon, this.region) : [];
      this.value = { startItem: kept.startItem && choices.includes(kept.startItem) ? kept.startItem : null, shiny: kept.shiny && canUseShiny(save, pokemon, this.region) };
    }
    this.render();
    this.onChange(this.options);
  }

  private set(next: LoadoutOptions): void {
    this.value = next;
    if (this.pokemon) rememberOptions(this.pokemon, next);
    this.onChange(this.options);
  }

  private render(): void {
    const pokemon = this.pokemon;
    this.element.replaceChildren();
    if (!pokemon) return;
    const save = session.store.current;
    const item = document.createElement('label');
    item.style.cssText = 'display:flex;gap:8px;align-items:center';
    const label = document.createElement('span');
    label.textContent = t('select.startItem');
    item.append(label);
    if (canChooseStartItem(save, pokemon, this.region)) {
      const select = document.createElement('select');
      select.style.cssText = `${windowCss('light')};font:inherit;font-size:16px;padding:2px 8px;min-height:32px`;
      const none = document.createElement('option');
      none.value = '';
      none.textContent = t('select.startItemNone');
      select.append(none);
      for (const key of startItemChoices(save, pokemon, this.region)) {
        const o = document.createElement('option');
        o.value = key;
        o.textContent = localName(generated.items[key]?.names, getLocale(), key);
        select.append(o);
      }
      select.value = this.value.startItem ?? '';
      select.onchange = () => this.set({ ...this.value, startItem: select.value || null });
      // 矢印キーはポケモンの一覧を動かすので、ここでは止める
      select.onkeydown = (ev) => ev.stopPropagation();
      item.append(select);
    } else {
      const locked = document.createElement('span');
      locked.style.opacity = '0.7';
      locked.textContent = t('select.startItemLocked');
      item.append(locked);
    }
    this.element.append(item);
    if (canUseShiny(save, pokemon, this.region)) {
      const shiny = document.createElement('label');
      shiny.style.cssText = 'display:flex;gap:6px;align-items:center;cursor:pointer';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = this.value.shiny;
      box.onchange = () => this.set({ ...this.value, shiny: box.checked });
      const text = document.createElement('span');
      text.textContent = t('select.shiny');
      shiny.append(box, text);
      this.element.append(shiny);
    }
  }
}
