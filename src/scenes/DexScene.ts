import Phaser from 'phaser';
import { generated, iconConfig, itemIcons, playablesConfig, regionsConfig } from '../data';
import { buildSimRules, localName } from '../data/simRules';
import { getLocale, t, tMaybe } from '../i18n';
import { lineMoves, obtainableItems, regionLineKeys, type LineDerive, type LineMoves } from '../meta/lineMoves';
import { dexCount, dexStates, dexTree, type DexEdge, type DexNode, type DexState } from '../meta/moveDex';
import { session } from '../meta/session';
import { ensureIconTextures, iconDataUrl, itemIconKey, moveIconKey } from '../render/Icons';
import { compactScreen, windowCss } from '../render/pixelUi';
import type { SimRules } from '../sim/rules';
import { damageClassBadge } from './levelUpPanel';
import { moveInfoLines, moveStatRows } from './moveInfo';
import { isPokemonUnlocked, pokemonIconImage, PokemonPicker } from './pokemonPicker';
import type { RegionSceneData } from './RegionScene';

export interface DexSceneData {
  /** 地方（ずかん → 地方 → ポケモン → わざ） */
  region: string;
  /** 開いているポケモン（無ければポケモンの一覧） */
  pokemon?: string;
  /** 開いている技（無ければ技のつながり） */
  move?: string;
}

/** 見つけた技の色（枠の外）。アイコンは 32 ドットなので、にじまないよう 32・64 で出す（07 の264章） */
const FOUND_BG = '#ffffff';
const UNKNOWN_BG = '#c8ced4';
const MAX_COLOR = '#e0a000';

/**
 * わざ図鑑（07 の262・263章。作者の案 2026年11月14日。DOM）: ずかん → 地方 → ポケモン → わざ → 技の詳細。
 * ポケモンの一覧は解放したものだけ押せる。押すと、そのポケモンで見つけた技のつながりを、アイコンと矢印だけで出す（src/meta/moveDex.ts）。
 * 見つけた技を押すと、技の詳細（効果の説明・数値・前後の技と素材）を出す。ダメージ以外の効き目を見られる唯一の場所（src/scenes/moveInfo.ts）。
 * Esc・「もどる」で、詳細 → わざ → ポケモン → 地方 の順に戻る
 */
export class DexScene extends Phaser.Scene {
  private rules!: SimRules;
  private region = '';
  private pokemon = '';
  private states: ReadonlyMap<string, DexState> = new Map();
  private compact = false;

  constructor() {
    super('dex');
  }

  create(data: DexSceneData): void {
    const region = regionsConfig.regions.find((r) => r.id === data.region) ?? regionsConfig.regions.find((r) => r.available)!;
    this.region = region.id;
    this.rules = buildSimRules(region.id);
    ensureIconTextures(this, iconConfig, this.rules, itemIcons);
    const compact = compactScreen();
    this.compact = compact;
    const root = document.createElement('div');
    root.style.cssText = `position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(960px,96vw);max-height:96vh;overflow:auto;${windowCss('dark')};padding:${compact ? '6px 12px' : '16px 24px'};font-size:16px;line-height:1.6;box-sizing:border-box;z-index:20;display:flex;flex-direction:column;gap:${compact ? 4 : 12}px`;
    document.body.append(root);
    const back = (): void => {
      if (data.move) this.scene.restart({ region: region.id, pokemon: data.pokemon } satisfies DexSceneData);
      else if (data.pokemon) this.scene.restart({ region: region.id } satisfies DexSceneData);
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
    const lm = data.pokemon && unlocked(data.pokemon) ? lineMoves(this.rules, data.pokemon, obtainableItems(region.id)) : null;
    if (lm) {
      this.pokemon = lm.key;
      this.states = dexStates(session.store.current, region.id, lm);
      title.textContent = t('dex.movesTitle', { region: regionName });
      root.append(title);
      if (data.move && (this.states.get(data.move) ?? 'unknown') !== 'unknown') root.append(...this.infoView(lm, data.move));
      else root.append(...this.movesView(lm));
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

  private state(move: string): DexState {
    return this.states.get(move) ?? 'unknown';
  }

  private openMove(move: string): void {
    this.scene.restart({ region: this.region, pokemon: this.pokemon, move } satisfies DexSceneData);
  }

  /** 上のポケモンと見つけた数 */
  private header(lm: LineMoves): HTMLElement {
    const count = dexCount(lm, this.states);
    const head = document.createElement('div');
    head.style.cssText = `${windowCss('light')};padding:${this.compact ? '4px 12px' : '8px 16px'};display:flex;align-items:center;gap:16px`;
    const icon = pokemonIconImage(lm.key, this.compact ? 40 : 64);
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
    return head;
  }

  /** そのポケモンのわざ図鑑: 1 行に 1 つの最初の技から、派生を右へ。アイコンと矢印だけ */
  private movesView(lm: LineMoves): HTMLElement[] {
    const tree = dexTree(lm, this.states);
    const list = document.createElement('div');
    list.style.cssText = `display:flex;flex-direction:column;gap:${this.compact ? 4 : 8}px`;
    for (const node of tree) {
      const line = document.createElement('div');
      line.style.cssText = `${windowCss('light')};padding:${this.compact ? '4px 8px' : '6px 10px'};overflow-x:auto`;
      line.append(this.nodeView(node));
      list.append(line);
    }
    const legend = document.createElement('div');
    legend.style.cssText = 'opacity:0.75;font-size:14px';
    legend.textContent = t('dex.legend');
    return [this.header(lm), legend, list];
  }

  /** 技 1 つと、その先の派生（分かれるときは縦に並べる） */
  private nodeView(node: DexNode): HTMLElement {
    const box = document.createElement('div');
    box.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:nowrap';
    box.append(this.moveTile(node.move, this.compact ? 32 : 64));
    // 見つけていない技の先は見せない（あるかどうかも伏せる）
    if (node.state === 'unknown' || node.edges.length === 0) return box;
    const edges = document.createElement('div');
    edges.style.cssText = 'display:flex;flex-direction:column;gap:6px';
    for (const e of node.edges) edges.append(this.edgeView(e));
    box.append(edges);
    return box;
  }

  private edgeView(e: DexEdge): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px';
    row.append(this.arrow(e.derive, e.showMaterials), this.nodeView(e.next));
    return row;
  }

  /** 矢印と、その下の素材（持ち物・ランの Lv・一緒に持つ技）。アイコンで出し、名前は詳細で */
  private arrow(d: LineDerive, showMaterials: boolean): HTMLElement {
    const arrow = document.createElement('div');
    arrow.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;font-size:12px;line-height:1.1;flex:none;min-width:28px';
    const mark = document.createElement('div');
    mark.style.fontSize = '20px';
    mark.textContent = '→';
    arrow.append(mark);
    if (!showMaterials) return arrow;
    const mats = document.createElement('div');
    mats.style.cssText = 'display:flex;align-items:center;gap:2px';
    if (d.item) {
      const index = this.rules.items.findIndex((x) => x.key === d.item);
      if (index !== -1) {
        const img = this.iconImg(itemIconKey(this.rules, index), 32);
        img.title = localName(generated.items[d.item]?.names, getLocale(), d.item);
        mats.append(img);
      }
    }
    for (const need of d.needs) {
      const tile = this.moveTile(need.move, 32, false);
      if (need.level) {
        const w = document.createElement('div');
        w.style.cssText = 'display:flex;flex-direction:column;align-items:center';
        const lv = document.createElement('div');
        lv.textContent = `Lv${need.level}`;
        w.append(tile, lv);
        mats.append(w);
      } else mats.append(tile);
    }
    arrow.append(mats);
    if (d.minLevel) {
      const lv = document.createElement('div');
      lv.style.whiteSpace = 'nowrap';
      lv.textContent = t('dex.minLevel', { level: d.minLevel });
      arrow.append(lv);
    }
    return arrow;
  }

  /** 素材の「一緒に持つ技」は、図鑑のどこかで見つけていれば見せる */
  private knownAnywhere(move: string): boolean {
    if (this.state(move) !== 'unknown') return true;
    return Object.values(session.store.current.dex).some((list) => list.includes(move) || list.includes(`${move}!`));
  }

  /** 技のアイコン 1 つ（見つけていなければ「？」）。見つけた技は押すと詳細へ */
  private moveTile(move: string, size: number, clickable = true): HTMLElement {
    const own = this.state(move);
    const known = clickable ? own !== 'unknown' : this.knownAnywhere(move);
    const index = this.rules.moves.findIndex((m) => m.key === move);
    const tile = document.createElement(clickable && known ? 'button' : 'div');
    tile.style.cssText = `position:relative;flex:none;width:${size + 8}px;height:${size + 8}px;display:flex;align-items:center;justify-content:center;padding:0;border:2px solid ${known ? '#5a6878' : '#9aa4ae'};border-radius:4px;background:${known ? FOUND_BG : UNKNOWN_BG};box-sizing:content-box;font:inherit${clickable && known ? ';cursor:pointer' : ''}`;
    if (!known || index === -1) {
      const q = document.createElement('div');
      q.style.cssText = `opacity:0.7;font-size:${Math.round(size * 0.55)}px`;
      q.textContent = t('dex.unknown');
      tile.append(q);
      return tile;
    }
    const img = this.iconImg(moveIconKey(this.rules, index), size);
    tile.title = this.moveName(move);
    tile.append(img);
    if (clickable && own === 'maxed') {
      const star = document.createElement('div');
      star.style.cssText = `position:absolute;right:0;bottom:-2px;line-height:1;font-size:${size >= 40 ? 16 : 13}px;color:${MAX_COLOR};text-shadow:0 0 2px #000000,0 0 2px #000000`;
      star.textContent = '★';
      tile.append(star);
    }
    if (clickable) (tile as HTMLButtonElement).onclick = () => this.openMove(move);
    return tile;
  }

  private moveName(move: string): string {
    const def = this.rules.moves.find((m) => m.key === move) as { nameOf?: string } | undefined;
    return localName(generated.moves[move]?.names ?? generated.moves[def?.nameOf ?? '']?.names, getLocale(), move);
  }

  /** 技の詳細: 名前・ぶつり／とくしゅ・タイプと出し方・効果・数値・前後の技と素材 */
  private infoView(lm: LineMoves, move: string): HTMLElement[] {
    const rules = this.rules;
    const index = rules.moves.findIndex((m) => m.key === move);
    const def = rules.moves[index]!;
    const section = (): HTMLDivElement => {
      const s = document.createElement('div');
      s.style.cssText = `${windowCss('light')};padding:${this.compact ? '4px 10px' : '8px 16px'};display:flex;flex-direction:column;gap:4px`;
      return s;
    };
    const heading = (text: string): HTMLDivElement => {
      const h = document.createElement('div');
      h.style.cssText = 'font-size:14px;opacity:0.7';
      h.textContent = text;
      return h;
    };

    // 名前
    const head = section();
    head.style.flexDirection = 'row';
    head.style.alignItems = 'center';
    head.style.gap = '16px';
    head.append(this.iconImg(moveIconKey(rules, index), 64));
    const text = document.createElement('div');
    text.style.cssText = 'display:flex;flex-direction:column;gap:2px';
    const name = document.createElement('div');
    name.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:22px;flex-wrap:wrap';
    const label = document.createElement('span');
    label.textContent = this.moveName(move);
    name.append(label, damageClassBadge(def.damageClass, 14));
    const typeKey = rules.types.names[def.type] ?? '';
    const detail = document.createElement('div');
    detail.textContent = t('upgrade.detail', { type: localName(generated.types[typeKey]?.names, getLocale(), typeKey), pattern: tMaybe(`pattern.${def.sweepOnce ? 'sweepOnce' : def.pattern}`) });
    text.append(name, detail);
    if (this.state(move) === 'maxed') {
      const max = document.createElement('div');
      max.style.cssText = `color:${MAX_COLOR};font-size:14px`;
      max.textContent = `★ ${t('dex.maxed', { level: def.levels.length })}`;
      text.append(max);
    }
    head.append(text);

    // 効果
    const effects = section();
    effects.append(heading(t('dex.effects')));
    const lines = moveInfoLines(rules, def);
    for (const l of lines.length ? lines : [t('dex.noEffects')]) {
      const d = document.createElement('div');
      d.textContent = l;
      if (l.startsWith('・')) d.style.paddingLeft = '1em';
      effects.append(d);
    }

    const out: HTMLElement[] = [head, effects];

    // 数値（Lv1 → 最大 Lv）
    const rows = moveStatRows(def);
    if (rows.length) {
      const stats = section();
      stats.append(heading(`${t('dex.stats')}（${t('dex.statsHead', { level: def.levels.length })}）`));
      const grid = document.createElement('div');
      grid.style.cssText = `display:grid;grid-template-columns:repeat(auto-fill,minmax(${this.compact ? 180 : 220}px,1fr));gap:2px 16px`;
      for (const [k, a, b] of rows) {
        const cell = document.createElement('div');
        cell.style.whiteSpace = 'nowrap';
        cell.textContent = `${k}  ${a}${b !== null ? ` → ${b}` : ''}`;
        grid.append(cell);
      }
      stats.append(grid);
      out.push(stats);
    }

    // 前後の技（見つけた技だけ名前を出す。素材は図鑑のつながりと同じ決まり）
    const prev = lm.derives.filter((d) => d.to === move);
    const next = lm.derives.filter((d) => d.from === move);
    const link = (d: LineDerive, other: string, showMaterials: boolean, forward: boolean): HTMLElement => {
      const r = document.createElement('div');
      r.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap';
      const tile = this.moveTile(other, 32);
      const nm = document.createElement('span');
      nm.textContent = this.state(other) === 'unknown' ? t('dex.unknown') : this.moveName(other);
      const mats = showMaterials ? this.materialText(d) : '';
      const m = document.createElement('span');
      m.style.cssText = 'font-size:14px;opacity:0.85';
      m.textContent = mats;
      if (forward) r.append(this.arrowMark(), tile, nm, m);
      else r.append(tile, nm, this.arrowMark(), m);
      return r;
    };
    const prevKnown = prev.filter((d) => this.state(d.from) !== 'unknown');
    if (prevKnown.length) {
      const s = section();
      s.append(heading(t('dex.prev')));
      for (const d of prevKnown) s.append(link(d, d.from, true, false));
      out.push(s);
    }
    if (next.length) {
      const s = section();
      s.append(heading(t('dex.next')));
      const showMaterials = this.state(move) === 'maxed';
      for (const d of next) s.append(link(d, d.to, showMaterials || this.state(d.to) !== 'unknown', true));
      out.push(s);
    }
    return [this.header(lm), ...out];
  }

  private arrowMark(): HTMLElement {
    const a = document.createElement('span');
    a.style.fontSize = '18px';
    a.textContent = '→';
    return a;
  }

  /** 素材を文で（持ち物の名前・ランの Lv・一緒に持つ技） */
  private materialText(d: LineDerive): string {
    const parts: string[] = [];
    if (d.item) parts.push(localName(generated.items[d.item]?.names, getLocale(), d.item));
    for (const need of d.needs) {
      const moveLabel = this.knownAnywhere(need.move) ? this.moveName(need.move) : t('dex.unknown');
      parts.push(need.level ? t('dex.needsLevel', { move: moveLabel, level: need.level }) : t('dex.needs', { move: moveLabel }));
    }
    if (d.minLevel) parts.push(t('dex.minLevel', { level: d.minLevel }));
    return parts.join(' ');
  }

  private iconImg(key: string, size: number): HTMLImageElement {
    const img = document.createElement('img');
    img.alt = '';
    img.src = iconDataUrl(this, key);
    img.style.cssText = `width:${size}px;height:${size}px;image-rendering:pixelated;flex:none;display:block`;
    return img;
  }
}
