import Phaser from 'phaser';
import { generated, iconConfig, itemIcons, playablesConfig, regionsConfig } from '../data';
import { buildSimRules, localName } from '../data/simRules';
import { getLocale, t, tMaybe } from '../i18n';
import { lineMoves, obtainableItems, regionLineKeys, type LineMoves } from '../meta/lineMoves';
import { dexCount, dexStates, dexTree, type DexEdge, type DexNode } from '../meta/moveDex';
import { session } from '../meta/session';
import { ensureIconTextures, iconDataUrl, itemIconKey, moveIconKey } from '../render/Icons';
import { compactScreen, windowCss } from '../render/pixelUi';
import type { SimRules } from '../sim/rules';
import { damageClassBadge } from './levelUpPanel';
import { isPokemonUnlocked, pokemonIconImage, PokemonPicker } from './pokemonPicker';
import type { RegionSceneData } from './RegionScene';

export interface DexSceneData {
  /** 地方（ずかん → 地方 → ポケモン → わざ） */
  region: string;
  /** 開いているポケモン（無ければポケモンの一覧） */
  pokemon?: string;
}

/**
 * わざ図鑑（07 の262章。作者の案 2026年11月14日。DOM）: ずかん → 地方 → ポケモン → わざ。
 * ポケモンの一覧は解放したものだけ押せる。押すと、そのポケモンで見つけた技と、派生のつながり・素材を出す（src/meta/moveDex.ts）。
 * Esc・「もどる」で、わざ → ポケモン → 地方 の順に戻る
 */
export class DexScene extends Phaser.Scene {
  constructor() {
    super('dex');
  }

  create(data: DexSceneData): void {
    const region = regionsConfig.regions.find((r) => r.id === data.region) ?? regionsConfig.regions.find((r) => r.available)!;
    const rules = buildSimRules(region.id);
    ensureIconTextures(this, iconConfig, rules, itemIcons);
    const compact = compactScreen();
    const root = document.createElement('div');
    root.style.cssText = `position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(960px,96vw);max-height:96vh;overflow:auto;${windowCss('dark')};padding:${compact ? '6px 12px' : '16px 24px'};font-size:16px;line-height:1.6;box-sizing:border-box;z-index:20;display:flex;flex-direction:column;gap:${compact ? 4 : 12}px`;
    document.body.append(root);
    const back = (): void => {
      if (data.pokemon) this.scene.restart({ region: region.id } satisfies DexSceneData);
      else this.scene.start('region', { next: 'dex' } satisfies RegionSceneData);
    };
    const button = `${windowCss('light')};min-height:${compact ? 36 : 44}px;padding:${compact ? '2px 12px' : '6px 16px'};cursor:pointer;font:inherit;font-size:16px`;
    const backButton = document.createElement('button');
    backButton.style.cssText = button;
    backButton.textContent = t('select.back');
    backButton.onclick = back;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:flex-end';
    row.append(backButton);
    const title = document.createElement('div');
    title.style.cssText = `font-size:${compact ? 20 : 24}px;text-align:center`;
    const regionName = localName(generated.regions[region.id]?.names, getLocale(), region.id);

    // タマゴからかえるポケモンは、タマゴを解放していれば押せる
    const eggOf = new Map<string, string>();
    for (const k of region.playables) for (const b of playablesConfig.pokemon[k]?.hatch ?? []) eggOf.set(b, k);
    const unlocked = (key: string): boolean => isPokemonUnlocked(eggOf.get(key) ?? key, region.id);

    let picker: PokemonPicker | null = null;
    if (data.pokemon && unlocked(data.pokemon)) {
      const lm = lineMoves(rules, data.pokemon, obtainableItems(region.id));
      title.textContent = t('dex.movesTitle', { region: regionName });
      root.append(title);
      if (lm) root.append(...this.movesView(rules, region.id, lm, compact));
      root.append(row);
    } else {
      title.textContent = t('dex.title', { region: regionName });
      const hint = document.createElement('div');
      hint.style.cssText = 'text-align:center;opacity:0.75';
      hint.textContent = t('dex.hint');
      if (compact) hint.style.display = 'none';
      const open = (key: string): void => void this.scene.restart({ region: region.id, pokemon: key } satisfies DexSceneData);
      picker = new PokemonPicker({ playables: regionLineKeys(region.playables), region: region.id, isUnlocked: unlocked, onSelect: () => undefined, onClick: open, onConfirm: open });
      root.append(title, hint, picker.element, row);
    }

    const onKey = (ev: KeyboardEvent): void => {
      const dir: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const d = dir[ev.key];
      if (d && picker) {
        ev.preventDefault();
        picker.move(d[0], d[1]);
      } else if (ev.repeat) return;
      else if (ev.key === 'Enter') picker?.confirm();
      else if (ev.key === 'Escape') back();
    };
    window.addEventListener('keydown', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', onKey);
      root.remove();
    });
  }

  /** そのポケモンのわざ図鑑: 上にポケモンと見つけた数、下に技のつながり（1 行に 1 つの最初の技から、派生を右へ） */
  private movesView(rules: SimRules, region: string, lm: LineMoves, compact: boolean): HTMLElement[] {
    const states = dexStates(session.store.current, region, lm);
    const tree = dexTree(lm, states);
    const count = dexCount(lm, states);
    const head = document.createElement('div');
    head.style.cssText = `${windowCss('light')};padding:${compact ? '4px 12px' : '8px 16px'};display:flex;align-items:center;gap:16px`;
    const icon = pokemonIconImage(lm.key, compact ? 40 : 64);
    icon.style.flex = 'none';
    const name = document.createElement('div');
    name.style.cssText = 'display:flex;flex-direction:column;gap:2px';
    const n = document.createElement('div');
    n.style.fontSize = '20px';
    n.textContent = localName(generated.pokemon[lm.key]?.names, getLocale(), lm.key);
    const c = document.createElement('div');
    c.textContent = t('dex.count', { found: count.found, total: count.total });
    name.append(n, c);
    head.append(icon, name);
    const list = document.createElement('div');
    list.style.cssText = `display:flex;flex-direction:column;gap:${compact ? 4 : 8}px`;
    for (const root of tree) {
      const line = document.createElement('div');
      line.style.cssText = `${windowCss('light')};padding:${compact ? '4px 8px' : '6px 10px'};overflow-x:auto`;
      line.append(this.nodeView(rules, root, compact));
      list.append(line);
    }
    const legend = document.createElement('div');
    legend.style.cssText = 'opacity:0.75;font-size:14px';
    legend.textContent = t('dex.legend');
    return [head, legend, list];
  }

  /** 技 1 つと、その先の派生（分かれるときは縦に並べる） */
  private nodeView(rules: SimRules, node: DexNode, compact: boolean): HTMLElement {
    const box = document.createElement('div');
    box.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:nowrap';
    box.append(this.moveCard(rules, node, compact));
    // 見つけていない技の先は見せない（あるかどうかも伏せる）
    if (node.state === 'unknown' || node.edges.length === 0) return box;
    const edges = document.createElement('div');
    edges.style.cssText = 'display:flex;flex-direction:column;gap:6px';
    for (const e of node.edges) edges.append(this.edgeView(rules, e, compact));
    box.append(edges);
    return box;
  }

  private edgeView(rules: SimRules, e: DexEdge, compact: boolean): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px';
    const arrow = document.createElement('div');
    arrow.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;font-size:13px;line-height:1.2;flex:none';
    const mark = document.createElement('div');
    mark.style.fontSize = '18px';
    mark.textContent = '→';
    arrow.append(mark);
    if (e.showMaterials) {
      const d = e.derive;
      if (d.item) {
        const it = document.createElement('div');
        it.style.cssText = 'display:flex;align-items:center;gap:3px;white-space:nowrap';
        const index = rules.items.findIndex((x) => x.key === d.item);
        if (index !== -1) it.append(this.iconImg(itemIconKey(rules, index), 20));
        const label = document.createElement('span');
        label.textContent = localName(generated.items[d.item]?.names, getLocale(), d.item);
        it.append(label);
        arrow.append(it);
      }
      if (d.minLevel) {
        const lv = document.createElement('div');
        lv.textContent = t('dex.minLevel', { level: d.minLevel });
        arrow.append(lv);
      }
      for (const need of d.needs) {
        const nd = document.createElement('div');
        nd.style.whiteSpace = 'nowrap';
        const known = (e.next.state !== 'unknown') || this.knownMove(rules, need.move);
        const moveLabel = known ? localName(generated.moves[need.move]?.names, getLocale(), need.move) : t('dex.unknown');
        nd.textContent = need.level ? t('dex.needsLevel', { move: moveLabel, level: need.level }) : t('dex.needs', { move: moveLabel });
        arrow.append(nd);
      }
    }
    row.append(arrow, this.nodeView(rules, e.next, compact));
    return row;
  }

  /** 素材の「覚えている技」は、図鑑のどこかで見つけていれば名前を出す */
  private knownMove(_rules: SimRules, move: string): boolean {
    return Object.values(session.store.current.dex).some((list) => list.includes(move) || list.includes(`${move}!`));
  }

  private moveCard(rules: SimRules, node: DexNode, compact: boolean): HTMLElement {
    const card = document.createElement('div');
    const index = rules.moves.findIndex((m) => m.key === node.move);
    const known = node.state !== 'unknown' && index !== -1;
    card.style.cssText = `flex:none;display:flex;align-items:center;gap:6px;padding:${compact ? '2px 6px' : '4px 8px'};border:2px solid ${known ? '#5a6878' : '#9aa4ae'};border-radius:4px;background:${known ? '#ffffff' : '#c8ced4'};min-width:${compact ? 96 : 120}px;box-sizing:border-box`;
    if (!known) {
      const q = document.createElement('div');
      q.style.cssText = 'opacity:0.7;padding:0 6px';
      q.textContent = t('dex.unknown');
      card.append(q);
      return card;
    }
    const def = rules.moves[index]!;
    card.append(this.iconImg(moveIconKey(rules, index), compact ? 24 : 32));
    const text = document.createElement('div');
    text.style.cssText = 'display:flex;flex-direction:column;line-height:1.25';
    const name = document.createElement('div');
    name.style.cssText = 'display:flex;align-items:center;gap:4px;white-space:nowrap';
    const label = document.createElement('span');
    label.textContent = localName(generated.moves[def.key]?.names ?? generated.moves[(def as { nameOf?: string }).nameOf ?? '']?.names, getLocale(), def.key);
    name.append(label, damageClassBadge(def.damageClass, 12));
    const typeKey = rules.types.names[def.type] ?? '';
    const detail = document.createElement('div');
    detail.style.cssText = 'font-size:12px;opacity:0.8;white-space:nowrap';
    detail.textContent = t('upgrade.detail', { type: localName(generated.types[typeKey]?.names, getLocale(), typeKey), pattern: tMaybe(`pattern.${def.sweepOnce ? 'sweepOnce' : def.pattern}`) });
    text.append(name, detail);
    if (node.state === 'maxed') {
      const max = document.createElement('div');
      max.style.cssText = 'font-size:12px;color:#c07000';
      max.textContent = t('dex.maxed', { level: def.levels.length });
      text.append(max);
    }
    card.append(text);
    return card;
  }

  private iconImg(key: string, size: number): HTMLImageElement {
    const img = document.createElement('img');
    img.alt = '';
    img.src = iconDataUrl(this, key);
    img.style.cssText = `width:${size}px;height:${size}px;image-rendering:pixelated;flex:none`;
    return img;
  }
}
