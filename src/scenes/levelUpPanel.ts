import { generated } from '../data';
import { localName } from '../data/simRules';
import { getLocale, t, tMaybe } from '../i18n';
import type { Player } from '../sim/entities/player';
import { derivationCompletedBy } from '../sim/systems/leveling';
import { itemIconKey, moveIconKey } from '../render/Icons';
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
}

function moveName(world: World, move: number): string {
  const key = world.rules.moves[move]!.key;
  return localName(generated.moves[key]?.names, getLocale(), key);
}

function itemName(key: string): string {
  return localName(generated.items[key]?.names, getLocale(), key);
}

function moveDetail(world: World, move: number): string {
  const def = world.rules.moves[move]!;
  const typeKey = world.rules.types.names[def.type] ?? '';
  return `${localName(generated.types[typeKey]?.names, getLocale(), typeKey)}・${tMaybe(`pattern.${def.pattern}`)}`;
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
  const base = { special: false, evolvable };
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
        detail: moveDetail(world, pm.move),
      };
    }
    case 'itemNew': {
      const key = r.items[offer.item]!.key;
      return { ...base, icon: itemIconKey(r, offer.item), kind: t('upgrade.kind.itemNew'), name: itemName(key), level: t('levelUp.new'), detail: tMaybe(`itemDesc.${key}`) };
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
        detail: tMaybe(`itemDesc.${key}`),
      };
    }
    case 'derive':
      return {
        icon: moveIconKey(r, offer.to),
        kind: t(offer.unique ? 'upgrade.kind.unique' : 'upgrade.kind.derive'),
        name: moveName(world, offer.to),
        level: t('levelUp.new'),
        detail: moveDetail(world, offer.to),
        special: true,
        evolvable: false,
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
  private last: { level: number; offers: OfferText[]; rerolls: number; secondsLeft: number; bans: number } | null = null;

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
      background: 'rgba(8,14,8,0.88)',
      color: '#fff',
      font: '16px/1.5 sans-serif',
      zIndex: '20',
      display: 'none',
      boxSizing: 'border-box',
    });
    document.body.appendChild(this.root);
  }

  /** 毎フレーム呼ぶ。内容が変わったときだけ作り直す */
  show(level: number, offers: OfferText[], rerolls: number, secondsLeft: number, bans = 0): void {
    this.last = { level, offers, rerolls, secondsLeft, bans };
    if (bans <= 0) this.banning = false;
    const key = JSON.stringify([level, offers, rerolls, secondsLeft, bans, this.banning]);
    if (key === this.shownKey) return;
    this.shownKey = key;

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px';
    const title = document.createElement('div');
    title.style.cssText = 'font-size:26px;font-weight:bold';
    title.textContent = t('levelUp.title', { level });
    const timer = document.createElement('div');
    timer.style.cssText = 'opacity:0.85';
    timer.textContent = `${t('levelUp.timeLeft', { seconds: secondsLeft })}　${t(this.banning ? 'levelUp.banHint' : 'levelUp.hint')}`;
    header.append(title, timer);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:2vw;align-items:stretch';
    offers.forEach((o, i) => {
      const card = document.createElement('button');
      // 除外のモードでは、除外できるカードを赤く、できないカードを薄くする
      const border = this.banning ? (o.special ? '#4a7a4a' : '#ef5350') : o.special ? '#ffb300' : o.evolvable ? '#4fc3f7' : '#4a7a4a';
      const bg = this.banning && !o.special ? '#3a1414' : o.special ? '#3d2a08' : '#162416';
      card.style.cssText = `flex:1 1 0;min-width:0;min-height:30vh;padding:18px;border-radius:14px;border:2px solid ${border};background:${bg};color:#fff;font:inherit;cursor:pointer;text-align:left;display:flex;flex-direction:column;gap:8px;overflow:hidden`;
      const top = document.createElement('div');
      top.style.cssText = 'display:flex;justify-content:space-between;gap:8px;font-size:14px;opacity:0.85';
      const kind = document.createElement('span');
      kind.textContent = `${i + 1}. ${o.kind}`;
      const lv = document.createElement('span');
      lv.textContent = o.level;
      top.append(kind, lv);
      const name = document.createElement('div');
      name.style.cssText = 'font-size:clamp(20px,2.4vw,30px);font-weight:bold;line-height:1.2;overflow-wrap:anywhere;display:flex;align-items:center;gap:10px';
      const icon = document.createElement('img');
      icon.src = this.handlers.iconUrl(o.icon);
      icon.alt = '';
      icon.style.cssText = 'width:48px;height:48px;image-rendering:pixelated;flex:none';
      const nameText = document.createElement('span');
      nameText.textContent = o.name;
      name.append(icon, nameText);
      const detail = document.createElement('div');
      detail.style.cssText = 'font-size:clamp(14px,1.3vw,17px);opacity:0.9;overflow-wrap:anywhere';
      detail.textContent = o.detail;
      card.append(top, name, detail);
      if (o.evolvable) {
        const badge = document.createElement('div');
        badge.style.cssText = 'margin-top:auto;align-self:flex-start;padding:2px 10px;border-radius:10px;background:#0277bd;font-weight:bold;font-size:14px';
        badge.textContent = t('levelUp.evolvable');
        card.append(badge);
      }
      if (this.banning && o.special) card.style.opacity = '0.4';
      card.onclick = () => this.pick(i);
      row.append(card);
    });

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;gap:2vw;margin-top:14px';
    const reroll = document.createElement('button');
    reroll.textContent = t('levelUp.reroll', { count: rerolls });
    reroll.disabled = rerolls <= 0;
    reroll.onclick = () => this.handlers.reroll();
    const skip = document.createElement('button');
    skip.textContent = t('levelUp.skip');
    skip.onclick = () => this.handlers.skip();
    const ban = document.createElement('button');
    ban.textContent = t('levelUp.ban', { count: bans });
    ban.disabled = bans <= 0;
    ban.onclick = () => this.toggleBan();
    for (const b of [reroll, skip, ban]) b.style.cssText = 'flex:1;padding:10px;border-radius:8px;cursor:pointer;font:inherit';
    if (this.banning) ban.style.outline = '3px solid #ef5350';
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
    this.show(l.level, l.offers, l.rerolls, l.secondsLeft, l.bans);
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
