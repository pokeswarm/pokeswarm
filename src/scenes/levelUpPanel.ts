import { generated } from '../data';
import { pixelTextureKey } from '../render/PixelArt';
import { moveTotalStrength } from '../data/moveStrength';
import { localName } from '../data/simRules';
import { getLocale, t, tMaybe } from '../i18n';
import type { Player } from '../sim/entities/player';
import { derivationCompletedBy } from '../sim/systems/leveling';
import { itemIconKey, moveIconKey } from '../render/Icons';
import { windowCss, compactScreen } from '../render/pixelUi';
import { isTouchDevice } from '../render/TouchJoystick';
import type { Modifiers } from '../sim/upgrades';
import type { UpgradeOffer, World } from '../sim/world';

/** カード1枚の表示用の文章 */
export interface OfferText {
  kind: string;
  name: string;
  /** レベルの変化（NEW / Lv 1 → 2） */
  level: string;
  /** 短い説明（技はタイプと出し方、持ち物は効果） */
  detail: string;
  /** 派生・固有技そのもののカード */
  special: boolean;
  /** 「おや……？」を出す（以前に達成した派生で、このカードを取ると条件がそろう） */
  evolvable: boolean;
  /** アイコンのテクスチャのキー */
  icon: string;
  /** このカードを取ると増えるもの（強化: 前のレベルとの差。新しい持ち物: 効果） */
  gains: string[];
}

/** 数を「+3」「−0.1」のように符号付きで（小数は2桁まで） */
function signed(v: number): string {
  const r = Math.round(v * 100) / 100;
  return r >= 0 ? `+${r}` : `−${Math.abs(r)}`;
}

/** 技のレベルが上がると変わる項目（見た目で分かるもの）。小さいほどよいものは sign -1 */
const MOVE_GAINS: { key: 'count' | 'size' | 'range' | 'pierce' | 'durationSeconds' | 'speed' | 'knockback' | 'statusChance' | 'cooldownSeconds' | 'hitIntervalSeconds'; sign: 1 | -1; scale?: number }[] = [
  { key: 'count', sign: 1 },
  { key: 'size', sign: 1 },
  { key: 'range', sign: 1 },
  { key: 'pierce', sign: 1 },
  { key: 'durationSeconds', sign: 1 },
  { key: 'speed', sign: 1 },
  { key: 'knockback', sign: 1 },
  { key: 'statusChance', sign: 1, scale: 100 },
  { key: 'cooldownSeconds', sign: -1 },
  { key: 'hitIntervalSeconds', sign: -1 },
];

/** 技をレベル level から level + 1 に上げたときに増えるもの。最後に総合の強さの伸び（%） */
export function moveGains(world: World, move: number, level: number): string[] {
  const def = world.rules.moves[move]!;
  // いつも効く技（かくばる・テクスチャー）: 次のレベルで足される効果
  if (def.passive.length > 0) {
    const a = def.passive[level - 1];
    const b = def.passive[level];
    return a && b ? modifierLines(world, modifierDiff(a, b)) : [];
  }
  const a = def.levels[level - 1];
  const b = def.levels[level];
  if (!a || !b) return [];
  const out: string[] = [];
  for (const g of MOVE_GAINS) {
    const d = (b[g.key] - a[g.key]) * (g.scale ?? 1);
    // 良くなったものだけ（数が増えて1発の威力が下がるなどは、総合の強さで見せる）
    if (!Number.isFinite(d) || d * g.sign <= 0) continue;
    out.push(t(`gain.${g.key}`, { v: signed(d) }));
  }
  const pa = { pattern: def.pattern } as Parameters<typeof moveTotalStrength>[0];
  const sa = moveTotalStrength(pa, a as unknown as Record<string, number>);
  const sb = moveTotalStrength(pa, b as unknown as Record<string, number>);
  if (Number.isFinite(sa) && sa > 0 && sb > sa) out.push(t('gain.strength', { v: Math.round(((sb - sa) / sa) * 100) }));
  return out;
}

/** 持ち物の効果を、レベル level の値で1行ずつ（next があれば「今 → 次」） */
export function itemGains(world: World, item: number, level: number, next: number | null): string[] {
  const def = world.rules.items[item]!;
  const per = def.perLevel;
  const out: string[] = [];
  const pct = (v: number): string => `${signed(v)}%`;
  const line = (label: string, v: number, fmt: (v: number) => string): void => {
    if (v === 0) return;
    out.push(`${label} ${fmt(v * level)}${next !== null ? ` → ${fmt(v * next)}` : ''}`);
  };
  for (const [k, v] of Object.entries(per) as [keyof Modifiers, number | number[]][]) {
    if (Array.isArray(v)) {
      // タイプごとの効果
      v.forEach((x, type) => {
        if (!x) return;
        const typeKey = world.rules.types.names[type] ?? '';
        line(t(`mod.${k}`, { type: localName(generated.types[typeKey]?.names, getLocale(), typeKey) }), x, pct);
      });
      continue;
    }
    line(t(`mod.${k}`), v, k.endsWith('Pct') ? pct : signed);
  }
  if (def.powerMultiplier) out.push(t('mod.powerMultiplier', { v: def.powerMultiplier }));
  return out;
}

/** 効果の差（b − a） */
function modifierDiff(a: Modifiers, b: Modifiers): Modifiers {
  const out = { ...b } as Record<string, number | number[]>;
  for (const [k, v] of Object.entries(b) as [string, number | number[]][]) {
    const av = (a as unknown as Record<string, number | number[]>)[k];
    out[k] = Array.isArray(v) ? v.map((x, i) => x - ((av as number[] | undefined)?.[i] ?? 0)) : v - ((av as number | undefined) ?? 0);
  }
  return out as unknown as Modifiers;
}

/** 持ち物と同じ形の効果を、0 でないものだけ1行ずつ */
function modifierLines(world: World, mods: Modifiers): string[] {
  const out: string[] = [];
  const pct = (v: number): string => `${signed(v)}%`;
  for (const [k, v] of Object.entries(mods) as [keyof Modifiers, number | number[]][]) {
    if (Array.isArray(v)) {
      v.forEach((x, type) => {
        if (!x) return;
        const typeKey = world.rules.types.names[type] ?? '';
        out.push(`${t(`mod.${k}`, { type: localName(generated.types[typeKey]?.names, getLocale(), typeKey) })} ${pct(x)}`);
      });
    } else if (v) out.push(`${t(`mod.${k}`)} ${k.endsWith('Pct') ? pct(v) : signed(v)}`);
  }
  return out;
}

export function moveName(world: World, move: number): string {
  const key = world.rules.moves[move]!.key;
  return localName(generated.moves[key]?.names, getLocale(), key);
}

export function itemName(key: string): string {
  return localName(generated.items[key]?.names, getLocale(), key);
}

export function moveDetail(world: World, move: number): string {
  const def = world.rules.moves[move]!;
  const typeKey = world.rules.types.names[def.type] ?? '';
  return t('upgrade.detail', { type: localName(generated.types[typeKey]?.names, getLocale(), typeKey), pattern: tMaybe(`pattern.${def.pattern}`) });
}

/**
 * 候補を、カードに出す文章にする（名前は PokeAPI の各言語の名前、それ以外は翻訳ファイル）。
 * 派生の材料などのヒントは出さない。「おや……？」は、以前に達成した派生（discovered に派生先の技のキー）で、
 * このカードを取ると条件がそろうときだけ出す。
 */
export function offerText(world: World, p: Player, offer: UpgradeOffer, discovered: ReadonlySet<string>): OfferText {
  const r = world.rules;
  const completes = derivationCompletedBy(world, p, offer);
  const evolvable = completes !== null && discovered.has(r.moves[completes.to]!.key);
  const base = { special: false, evolvable, gains: [] as string[] };
  switch (offer.kind) {
    case 'moveNew':
      return { ...base, icon: moveIconKey(r, offer.move), kind: t('upgrade.kind.moveNew'), name: moveName(world, offer.move), level: t('levelUp.new'), detail: moveDetail(world, offer.move) };
    case 'moveUp': {
      const pm = p.moves[offer.slot]!;
      return {
        ...base,
        icon: moveIconKey(r, pm.move),
        kind: t('upgrade.kind.moveUp'),
        name: moveName(world, pm.move),
        level: t('levelUp.levelChange', { from: pm.level, to: pm.level + 1 }),
        // 強化は増えるものだけ（説明はできるだけ短く。作者の決定）
        detail: '',
        gains: moveGains(world, pm.move, pm.level),
      };
    }
    case 'itemNew': {
      const key = r.items[offer.item]!.key;
      // 効果はカードの増えるものの欄に出す（説明は効果が無い持ち物だけ。つながりのヒモなど）
      const gains = itemGains(world, offer.item, 1, null);
      return { ...base, icon: itemIconKey(r, offer.item), kind: t('upgrade.kind.itemNew'), name: itemName(key), level: t('levelUp.new'), detail: gains.length ? '' : tMaybe(`itemDesc.${key}`), gains };
    }
    case 'itemUp': {
      const it = p.items[offer.slot]!;
      const key = r.items[it.item]!.key;
      return {
        ...base,
        icon: itemIconKey(r, it.item),
        kind: t('upgrade.kind.itemUp'),
        name: itemName(key),
        level: t('levelUp.levelChange', { from: it.level, to: it.level + 1 }),
        detail: '',
        gains: itemGains(world, it.item, it.level, it.level + 1),
      };
    }
    case 'heal':
      return { ...base, icon: pixelTextureKey('potion'), kind: t('upgrade.kind.fallback'), name: t('upgrade.heal.name'), level: '', detail: '', gains: [t('upgrade.heal.gain', { pct: r.leveling.fallback.healPct })] };
    case 'coins':
      return { ...base, icon: pixelTextureKey('coin'), kind: t('upgrade.kind.fallback'), name: t('upgrade.coins.name'), level: '', detail: '', gains: [t('upgrade.coins.gain', { coins: r.leveling.fallback.coins })] };
    case 'derive':
      return {
        icon: moveIconKey(r, offer.to),
        kind: t(offer.unique ? 'upgrade.kind.unique' : 'upgrade.kind.derive'),
        name: moveName(world, offer.to),
        level: t('levelUp.new'),
        detail: moveDetail(world, offer.to),
        special: true,
        evolvable: false,
        gains: [],
      };
  }
}

/**
 * レベルアップの選択画面（DOM。見た目の作り込みはフェーズ4）。
 * 画面の横幅いっぱいに、大きなカードを横に並べる。数字キー・クリックで選び、R でリロール、X で見送る。
 * B で除外のモードに入り、次に押した番号（クリック）の候補を除外する（派生・固有技は除外できない）。Esc でやめる。
 */
export class LevelUpPanel {
  private readonly root: HTMLDivElement;
  private shownKey = '';
  private onKey: ((ev: KeyboardEvent) => void) | null = null;
  /** 除外のモード（次に選んだ候補を除外する） */
  private banning = false;
  /** 最後に出した内容（除外のモードの切り替えで作り直すため） */
  private last: { level: number; offers: OfferText[]; rerolls: number; secondsLeft: number; bans: number; more: number } | null = null;

  constructor(
    private readonly handlers: {
      choose: (index: number) => void;
      reroll: () => void;
      skip: () => void;
      ban: (index: number) => void;
      /** アイコンの画像の URL */
      iconUrl: (key: string) => string;
    },
  ) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'fixed',
      left: '0',
      right: '0',
      top: '50%',
      transform: 'translateY(-50%)',
      padding: '20px 2vw',
      background: 'rgba(0,0,0,0.55)',
      color: '#fff',
      font: '16px/1.5 inherit',
      zIndex: '20',
      display: 'none',
      boxSizing: 'border-box',
    });
    document.body.appendChild(this.root);
  }

  /** 毎フレーム呼ぶ。内容が変わったときだけ作り直す */
  show(level: number, offers: OfferText[], rerolls: number, secondsLeft: number, bans = 0, more = 0): void {
    this.last = { level, offers, rerolls, secondsLeft, bans, more };
    if (bans <= 0) this.banning = false;
    const key = JSON.stringify([level, offers, rerolls, secondsLeft, bans, more, this.banning]);
    if (key === this.shownKey) return;
    this.shownKey = key;

    // 原作をまねた白い窓（作者の決定。2026年10月22日）。説明はできるだけ短く: アイコン・名前・レベル・増えるもの
    const header = document.createElement('div');
    // 画面の高さが低い（横向きのスマホ）ときは、つめて表示する（作者の決定: 指で押せる大きさは保つ）
    const compact = compactScreen();
    const touch = isTouchDevice();
    this.root.style.padding = compact ? '6px 2vw' : '20px 2vw';
    header.style.cssText = `${windowCss('light')};display:flex;justify-content:space-between;align-items:center;padding:${compact ? '6px 14px' : '12px 20px'};margin-bottom:${compact ? 6 : 12}px;font-size:${compact ? 16 : 24}px`;
    const title = document.createElement('div');
    title.textContent = more > 0 ? t('levelUp.titleMore', { level, more }) : t('levelUp.title', { level });
    const timer = document.createElement('div');
    timer.style.cssText = 'font-size:24px';
    timer.textContent = String(secondsLeft);
    header.append(title, timer);

    const row = document.createElement('div');
    row.style.cssText = `display:flex;gap:${compact ? 8 : 16}px;align-items:stretch`;
    offers.forEach((o, i) => {
      const card = document.createElement('button');
      // 派生・固有技は金色の枠、「おや……？」は青い枠。除外のモードでは、除外できるカードを赤い枠に
      const accent = this.banning ? (o.special ? undefined : '#e04040') : o.special ? '#d8a020' : o.evolvable ? '#3890e8' : undefined;
      card.style.cssText = `${windowCss('light', accent)};flex:1 1 0;min-width:0;min-height:${compact ? 'auto' : '26vh'};padding:${compact ? '8px 10px 8px 28px' : '16px 18px 16px 34px'};font:inherit;cursor:pointer;text-align:left;display:flex;flex-direction:column;gap:${compact ? 6 : 10}px;overflow:hidden;position:relative`;
      // ▶ のカーソル（上に乗ったとき）
      const cursor = document.createElement('span');
      cursor.textContent = '▶';
      cursor.style.cssText = 'position:absolute;left:12px;top:22px;font-size:16px;visibility:hidden';
      card.onmouseenter = () => (cursor.style.visibility = 'visible');
      card.onmouseleave = () => (cursor.style.visibility = 'hidden');
      const name = document.createElement('div');
      // ドットがにじまないよう、文字は 8 の倍数の大きさ。狭い画面では名前を 16 にする
      name.style.cssText = `display:flex;align-items:center;gap:12px;font-size:${window.innerWidth >= 1100 ? 24 : 16}px;line-height:1.2;overflow-wrap:anywhere`;
      const icon = document.createElement('img');
      icon.src = this.handlers.iconUrl(o.icon);
      icon.alt = '';
      icon.style.cssText = 'width:48px;height:48px;image-rendering:pixelated;flex:none';
      const nameText = document.createElement('span');
      nameText.textContent = o.name;
      name.append(icon, nameText);
      const lv = document.createElement('div');
      lv.style.cssText = 'font-size:16px';
      lv.textContent = `${i + 1}　${o.level}`;
      card.append(cursor, lv, name);
      if (o.detail) {
        const detail = document.createElement('div');
        detail.style.cssText = 'font-size:16px;line-height:1.5;overflow-wrap:anywhere';
        detail.textContent = o.detail;
        card.append(detail);
      }
      // 取ると増えるもの（強くなった感が分かるように）
      if (o.gains.length) {
        const gains = document.createElement('div');
        gains.style.cssText = 'font-size:16px;line-height:1.6;color:#208838';
        gains.textContent = o.gains.join('\n');
        gains.style.whiteSpace = 'pre-line';
        card.append(gains);
      }
      if (o.evolvable) {
        const badge = document.createElement('div');
        badge.style.cssText = 'margin-top:auto;align-self:flex-start;padding:4px 10px;background:#3890e8;color:#f8f8f8;font-size:16px';
        badge.textContent = t('levelUp.evolvable');
        card.append(badge);
      }
      if (this.banning && o.special) card.style.opacity = '0.4';
      card.onclick = () => this.pick(i);
      row.append(card);
    });

    const footer = document.createElement('div');
    footer.style.cssText = `display:flex;gap:${compact ? 8 : 16}px;margin-top:${compact ? 6 : 12}px`;
    const reroll = document.createElement('button');
    // タッチの端末では、キーの案内（R・X・B）を出さない
    reroll.textContent = t(touch ? 'levelUp.rerollTouch' : 'levelUp.reroll', { count: rerolls });
    reroll.disabled = rerolls <= 0;
    reroll.onclick = () => this.handlers.reroll();
    const skip = document.createElement('button');
    skip.textContent = t(touch ? 'levelUp.skipTouch' : 'levelUp.skip');
    skip.onclick = () => this.handlers.skip();
    const ban = document.createElement('button');
    ban.textContent = t(touch ? 'levelUp.banTouch' : 'levelUp.ban', { count: bans });
    ban.disabled = bans <= 0;
    ban.onclick = () => this.toggleBan();
    for (const b of [reroll, skip, ban]) b.style.cssText = `${windowCss('light', b === ban && this.banning ? '#e04040' : undefined)};flex:1;min-height:44px;padding:${compact ? 6 : 10}px;cursor:pointer;font:inherit;font-size:16px;${b.disabled ? 'opacity:0.45;cursor:default' : ''}`;
    footer.append(reroll, skip, ban);

    this.root.replaceChildren(header, row, footer);
    this.root.style.display = 'block';
    if (!this.onKey) {
      this.onKey = (ev) => {
        // キーを押したまま開いたときの自動の繰り返しで、勝手に選ばれないようにする
        if (ev.repeat) return;
        const n = Number(ev.key);
        if (n >= 1 && n <= 9) this.pick(n - 1);
        else if (ev.key === 'b' || ev.key === 'B') this.toggleBan();
        else if (ev.key === 'Escape' && this.banning) this.toggleBan();
        else if (ev.key === 'r' || ev.key === 'R') this.handlers.reroll();
        // 見送るは移動キー（WASD）と重ならない X
        else if (ev.key === 'x' || ev.key === 'X') this.handlers.skip();
      };
      window.addEventListener('keydown', this.onKey);
    }
  }

  /** 候補を選ぶ。除外のモードなら除外する（派生・固有技は除外できない） */
  private pick(index: number): void {
    if (!this.banning) {
      this.handlers.choose(index);
      return;
    }
    const offer = this.last?.offers[index];
    if (!offer || offer.special) return;
    this.banning = false;
    this.handlers.ban(index);
  }

  private toggleBan(): void {
    if (!this.last || this.last.bans <= 0) return;
    this.banning = !this.banning;
    const l = this.last;
    this.show(l.level, l.offers, l.rerolls, l.secondsLeft, l.bans, l.more);
  }

  hide(): void {
    this.banning = false;
    if (this.root.style.display === 'none') return;
    this.root.style.display = 'none';
    this.shownKey = '';
    if (this.onKey) window.removeEventListener('keydown', this.onKey);
    this.onKey = null;
  }
}
