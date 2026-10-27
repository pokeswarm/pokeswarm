import { achievementsConfig, generated, playablesConfig, shopConfig, statsConfig, uiConfig, unlocksConfig } from '../data';
import { localName } from '../data/simRules';
import { getLocale, t } from '../i18n';
import { visibleAchievementCondition } from '../meta/achievementText';
import { isPlayableUnlocked } from '../meta/progress';
import { regionStats } from '../meta/regionScope';
import { session } from '../meta/session';
import { windowCss, compactScreen } from '../render/pixelUi';
import { loadPokemonIcon, pixelArtIcon } from '../render/pokemonIcons';

export interface PokemonPickerOptions {
  /** 並べるポケモン（地方のプレイアブル。data/game/regions.json） */
  playables: readonly string[];
  /** その地方（解放は地方ごと。07 の66.1）。省くとカントー */
  region?: string;
  /** 解放済みのポケモンを選んだとき（クリック・矢印キー） */
  onSelect(key: string): void;
  /** 決める（ダブルクリック・Enter）。無ければ選ぶだけ */
  onConfirm?(key: string): void;
}

const compact = (): boolean => compactScreen();

/** 一覧で使うアイコンの画像（DOM）。一覧のマス・待合室の枠で使う */
export function pokemonIconImage(key: string, size: number, silhouette = false): HTMLImageElement {
  const img = document.createElement('img');
  img.alt = '';
  img.style.cssText = `width:${size}px;height:${size}px;object-fit:contain;image-rendering:pixelated;display:block`;
  const def = playablesConfig.pokemon[key];
  if (def) {
    // タマゴは自作のドット絵
    void (def.hatch ? Promise.resolve(pixelArtIcon(def.sprite, uiConfig.picker.silhouette)) : loadPokemonIcon(def.sprite, uiConfig.picker.silhouette)).then((icon) => {
      if (!icon) return;
      img.src = silhouette ? icon.silhouetteUrl : icon.url;
      // どのポケモンも、長い辺がマスいっぱいになる同じ大きさにそろえる（作者の依頼 2026年10月22日。整数倍だと大きさがばらついた）
      const s = size / Math.max(icon.width, icon.height);
      img.style.width = `${icon.width * s}px`;
      img.style.height = `${icon.height * s}px`;
      img.style.margin = `${(size - icon.height * s) / 2}px ${(size - icon.width * s) / 2}px`;
    });
  }
  return img;
}

/** 解放済みか（作者の決定: 解放していないポケモンも黒塗りで一覧に出す） */
export function isPokemonUnlocked(key: string, region?: string): boolean {
  return isPlayableUnlocked(session.store.current, unlocksConfig, key, playablesConfig.pokemon[key]?.unlock, region);
}

/**
 * ポケモンの一覧（作者の案 2026年10月22日）。ソロのポケモン選択と協力プレイの待合室で使う。
 * 選んだ地方のプレイアブルのポケモンを全部アイコンで並べ、まだ解放していないものは黒塗りにする（名前は「？？？」、解放の条件だけ見せる）。
 * 下に、マウスを乗せている（無ければ選んでいる）ポケモンの詳しい情報を出す
 */
export class PokemonPicker {
  readonly element: HTMLDivElement;
  private readonly keys: string[];
  private readonly cells = new Map<string, HTMLDivElement>();
  private readonly detail: HTMLDivElement;

  /** 下の詳しい欄（低い画面では、呼ぶ側が一覧の横へ移す） */
  get detailElement(): HTMLDivElement {
    return this.detail;
  }
  private selected: string | null = null;
  /** 矢印キーで動かしている場所（解放していないマスにも止まる） */
  private cursor = 0;
  private hovered: string | null = null;

  constructor(private readonly opts: PokemonPickerOptions) {
    this.keys = [...opts.playables];
    this.element = document.createElement('div');
    this.element.style.cssText = `display:flex;flex-direction:column;gap:${compact() ? 6 : 12}px;min-width:0`;
    const size = compact() ? uiConfig.picker.cellCompact : uiConfig.picker.cell;
    const grid = document.createElement('div');
    // マスは横だけ列の幅いっぱいに広げる（一覧の左右の端を、下の詳しい欄の端とそろえる。高さは変えない）
    grid.style.cssText = `display:grid;grid-template-columns:repeat(auto-fill,minmax(${size + 8}px,1fr));gap:6px`;
    for (const key of this.keys) {
      const unlocked = isPokemonUnlocked(key, opts.region);
      const cell = document.createElement('div');
      cell.style.cssText = `${windowCss('light')};${unlocked ? '' : `background:${uiConfig.picker.lockedFill};box-shadow:none;`}padding:0;width:100%;height:${size + 8}px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;cursor:${unlocked ? 'pointer' : 'default'};border-width:4px`;
      cell.append(pokemonIconImage(key, size - 8, !unlocked));
      cell.onpointerenter = () => {
        this.hovered = key;
        this.renderDetail();
      };
      cell.onpointerleave = () => {
        if (this.hovered === key) this.hovered = null;
        this.renderDetail();
      };
      cell.onclick = () => {
        this.cursor = this.keys.indexOf(key);
        if (unlocked) this.select(key);
        else this.paint();
      };
      cell.ondblclick = () => {
        if (unlocked) this.opts.onConfirm?.(key);
      };
      this.cells.set(key, cell);
      grid.append(cell);
    }
    const count = document.createElement('div');
    count.style.cssText = 'text-align:center;opacity:0.85';
    count.textContent = t('select.count', { n: this.keys.filter((k) => isPokemonUnlocked(k, opts.region)).length, total: this.keys.length });
    this.detail = document.createElement('div');
    this.detail.style.cssText = `${windowCss('light')};padding:${compact() ? '4px 12px' : '10px 16px'};display:flex;align-items:center;gap:16px;min-height:${compact() ? 64 : 96}px;box-sizing:border-box`;
    this.element.append(count, grid, this.detail);
    this.paint();
  }

  /** 選んでいるポケモンを外から決める（待合室で、通信で返ってきた自分の選択） */
  setSelected(key: string | null): void {
    if (key === this.selected) return;
    this.selected = key;
    if (key) this.cursor = Math.max(0, this.keys.indexOf(key));
    this.paint();
  }

  /** 矢印キー。横は1つ、縦は1行ぶん動かす */
  move(dx: number, dy: number): void {
    const first = this.cells.get(this.keys[0]!);
    const columns = first ? [...this.cells.values()].filter((c) => c.offsetTop === first.offsetTop).length : 1;
    const next = this.cursor + dx + dy * columns;
    if (next < 0 || next >= this.keys.length) return;
    this.cursor = next;
    const key = this.keys[next]!;
    if (isPokemonUnlocked(key, this.opts.region)) this.select(key);
    else this.paint();
  }

  /** Enter: 選んでいるポケモンで決める */
  confirm(): void {
    if (this.selected) this.opts.onConfirm?.(this.selected);
  }

  private select(key: string): void {
    this.selected = key;
    this.paint();
    this.opts.onSelect(key);
  }

  private paint(): void {
    this.keys.forEach((key, i) => {
      const cell = this.cells.get(key)!;
      const on = key === this.selected;
      const color = on ? uiConfig.picker.selected : i === this.cursor ? uiConfig.window.inner : uiConfig.window.border;
      cell.style.borderColor = color;
      cell.style.outline = on ? `3px solid ${uiConfig.picker.selected}` : '';
    });
    this.renderDetail();
  }

  private renderDetail(): void {
    const key = this.hovered ?? this.selected ?? this.keys[this.cursor] ?? null;
    if (!key) {
      this.detail.replaceChildren();
      return;
    }
    const unlocked = isPokemonUnlocked(key, this.opts.region);
    const size = compact() ? 48 : 80;
    const icon = pokemonIconImage(key, size, !unlocked);
    icon.style.flex = 'none';
    const text = document.createElement('div');
    text.style.cssText = 'display:flex;flex-direction:column;gap:4px;min-width:0;overflow-wrap:anywhere';
    const name = document.createElement('div');
    name.style.cssText = 'font-size:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    const lines: string[] = [];
    const egg = playablesConfig.pokemon[key]!.hatch;
    if (unlocked && egg) {
      // タマゴ: 何がうまれるかの候補（07 の57章）
      name.textContent = t('egg.name');
      lines.push(t('egg.hint'), t('egg.candidates', { names: egg.map((b) => localName(generated.pokemon[b]?.names, getLocale(), b)).join('・') }));
    } else if (unlocked) {
      const g = generated.pokemon[key];
      name.textContent = localName(g?.names, getLocale(), key);
      lines.push((g?.types ?? []).map((ty) => localName(generated.types[ty]?.names, getLocale(), ty)).join(' / '));
      const move = playablesConfig.pokemon[key]!.startingMoves[0] ?? '';
      lines.push(t('select.startingMove', { move: localName(generated.moves[move]?.names, getLocale(), move) }));
    } else {
      // 名前は伏せて、解放の条件だけ見せる（実績の一覧と同じ）
      name.textContent = t('select.locked');
      const id = playablesConfig.pokemon[key]!.unlock ?? key;
      const a = achievementsConfig.achievements.find((x) => x.reward?.pokemon === id && x.region === (this.opts.region ?? 'kanto'));
      // 半分を超えるまでは「？？？」（黒塗りのポケモンが条件の文で分からないように）
      const cond = a ? visibleAchievementCondition(a, regionStats(session.store.current.stats, a.region), false) : '';
      // コインで買えるポケモンは値段を出す
      const sale = shopConfig.pokemon.find((p) => p.key === key && p.region === (this.opts.region ?? 'kanto'));
      // 解放済みと同じく名前の下に2行（マウスを動かしても欄の高さが変わらないように）
      lines.push(t('select.notUnlocked'), sale ? t('select.buyHint', { cost: sale.cost }) : cond ? t('select.unlockHint', { condition: cond }) : '');
    }
    text.append(name);
    for (const l of lines) {
      // 1行に収める（折り返すと欄の高さが変わる）。収まらない分は … にして、マウスを乗せると全文
      const d = document.createElement('div');
      d.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      d.textContent = l || ' ';
      d.title = l;
      text.append(d);
    }
    this.detail.replaceChildren(icon, text);
    // 種族値（作者の決定 2026年10月25日: ポケモンごとの基礎ステータスを見せる）。ゲームでの強さは種族値のランクで決まるので、棒の色をランクで変える
    // 解放していないポケモンでも同じ大きさの欄を見えないまま置く（作者の指摘 2026年10月27日: 種族値の有無で欄の大きさが変わり、カーソルを動かすたびに画面がずれた）
    const base = generated.pokemon[key]?.baseStats;
    if (!compact()) {
      text.style.flex = '1';
      const stats = baseStatsElement(base ?? { hp: 0, attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0 });
      if (!unlocked || !base) stats.style.visibility = 'hidden';
      this.detail.append(stats);
    }
  }
}

const STAT_KEYS = ['hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed'] as const;
/** 棒の長さの上限にする種族値 */
const STAT_BAR_MAX = 150;
/** ランク（低い → 高い）ごとの棒の色 */
const RANK_COLORS = ['#e05040', '#e09030', '#d8c030', '#80c040', '#40b070', '#3090e0'];

function baseStatsElement(base: Readonly<Record<(typeof STAT_KEYS)[number], number>>): HTMLDivElement {
  const box = document.createElement('div');
  box.style.cssText = 'flex:none;display:grid;grid-template-columns:auto 2.2em 100px;gap:1px 6px;align-items:center;font-size:13px;line-height:1.25';
  for (const k of STAT_KEYS) {
    const name = document.createElement('div');
    name.textContent = t(`select.stat.${k}`);
    const value = document.createElement('div');
    value.style.textAlign = 'right';
    value.textContent = String(base[k]);
    const bar = document.createElement('div');
    bar.style.cssText = 'height:7px;background:#d0d8e0;border-radius:2px;overflow:hidden';
    const fill = document.createElement('div');
    let rank = 0;
    while (rank < statsConfig.rankThresholds.length && base[k] >= statsConfig.rankThresholds[rank]!) rank++;
    fill.style.cssText = `height:100%;width:${Math.min(100, (base[k] / STAT_BAR_MAX) * 100)}%;background:${RANK_COLORS[Math.min(rank, RANK_COLORS.length - 1)]}`;
    bar.append(fill);
    box.append(name, value, bar);
  }
  return box;
}
