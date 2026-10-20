import { generated } from '../data';
import { localName } from '../data/simRules';
import { getLocale, t, tMaybe } from '../i18n';
import type { Player } from '../sim/entities/player';
import type { UpgradeOffer, World } from '../sim/world';

/** 候補1つの表示用の文章 */
export interface OfferText {
  kind: string;
  name: string;
  detail: string;
  /** 派生・固有技（必ず出る候補）なら true（目立たせる） */
  special: boolean;
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

/** 候補を、画面に出す文章にする（名前は PokeAPI の各言語の名前、それ以外は翻訳ファイル） */
export function offerText(world: World, p: Player, offer: UpgradeOffer): OfferText {
  const r = world.rules;
  switch (offer.kind) {
    case 'moveNew':
      return { kind: t('upgrade.kind.moveNew'), name: moveName(world, offer.move), detail: `${t('levelUp.new')}　${moveDetail(world, offer.move)}`, special: false };
    case 'moveUp': {
      const pm = p.moves[offer.slot]!;
      return {
        kind: t('upgrade.kind.moveUp'),
        name: moveName(world, pm.move),
        detail: t('levelUp.levelChange', { from: pm.level, to: pm.level + 1 }),
        special: false,
      };
    }
    case 'itemNew': {
      const key = r.items[offer.item]!.key;
      return { kind: t('upgrade.kind.itemNew'), name: itemName(key), detail: `${t('levelUp.new')}　${tMaybe(`itemDesc.${key}`)}`, special: false };
    }
    case 'itemUp': {
      const it = p.items[offer.slot]!;
      const key = r.items[it.item]!.key;
      return {
        kind: t('upgrade.kind.itemUp'),
        name: itemName(key),
        detail: `${t('levelUp.levelChange', { from: it.level, to: it.level + 1 })}　${tMaybe(`itemDesc.${key}`)}`,
        special: false,
      };
    }
    case 'passiveNew': {
      const key = r.passives[offer.passive]!.key;
      return { kind: t('upgrade.kind.passiveNew'), name: itemName(key), detail: `${t('levelUp.new')}　${tMaybe(`itemDesc.${key}`)}`, special: false };
    }
    case 'passiveUp': {
      const ps = p.passives[offer.slot]!;
      const key = r.passives[ps.passive]!.key;
      return {
        kind: t('upgrade.kind.passiveUp'),
        name: itemName(key),
        detail: `${t('levelUp.levelChange', { from: ps.level, to: ps.level + 1 })}　${tMaybe(`itemDesc.${key}`)}`,
        special: false,
      };
    }
    case 'derive': {
      const item = r.items[offer.item]!;
      const params = { from: moveName(world, p.moves[offer.slot]!.move), to: moveName(world, offer.to), item: itemName(item.key) };
      return {
        kind: t(offer.unique ? 'upgrade.kind.unique' : 'upgrade.kind.derive'),
        name: moveName(world, offer.to),
        detail: t(item.consumable ? 'levelUp.deriveDetail' : 'levelUp.deriveKeepItem', params),
        special: true,
      };
    }
  }
}

/**
 * レベルアップの選択画面（DOM で出す。技術検証の段階の簡単なもの。見た目の作り込みはフェーズ4）。
 * 数字キー・クリックで選ぶ。R でリロール、S で見送る。
 */
export class LevelUpPanel {
  private readonly root: HTMLDivElement;
  private shownKey = '';
  private onKey: ((ev: KeyboardEvent) => void) | null = null;

  constructor(
    private readonly handlers: { choose: (index: number) => void; reroll: () => void; skip: () => void },
  ) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'fixed',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      width: 'min(520px, 92vw)',
      padding: '16px',
      background: 'rgba(10,16,10,0.92)',
      color: '#fff',
      font: '14px/1.5 sans-serif',
      borderRadius: '10px',
      border: '1px solid #4a6',
      zIndex: '20',
      display: 'none',
    });
    document.body.appendChild(this.root);
  }

  /** 毎フレーム呼ぶ。内容が変わったときだけ作り直す */
  show(level: number, offers: OfferText[], rerolls: number, secondsLeft: number): void {
    const key = JSON.stringify([level, offers, rerolls, secondsLeft]);
    if (key === this.shownKey) return;
    this.shownKey = key;
    const title = document.createElement('div');
    title.style.cssText = 'font-size:20px;font-weight:bold;margin-bottom:4px';
    title.textContent = t('levelUp.title', { level });
    const sub = document.createElement('div');
    sub.style.cssText = 'opacity:0.8;margin-bottom:10px';
    sub.textContent = `${t('levelUp.timeLeft', { seconds: secondsLeft })}　${t('levelUp.hint')}`;
    const list = offers.map((o, i) => {
      const b = document.createElement('button');
      b.style.cssText = `display:block;width:100%;text-align:left;margin:6px 0;padding:8px 10px;border-radius:8px;cursor:pointer;color:#fff;font:inherit;background:${o.special ? '#5a3a10' : '#1e2e1e'};border:1px solid ${o.special ? '#fb3' : '#486'}`;
      b.innerHTML = '';
      const head = document.createElement('div');
      head.textContent = `${i + 1}. [${o.kind}] ${o.name}`;
      head.style.fontWeight = 'bold';
      const detail = document.createElement('div');
      detail.textContent = o.detail;
      detail.style.opacity = '0.85';
      b.append(head, detail);
      b.onclick = () => this.handlers.choose(i);
      return b;
    });
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;gap:8px;margin-top:8px';
    const reroll = document.createElement('button');
    reroll.textContent = t('levelUp.reroll', { count: rerolls });
    reroll.disabled = rerolls <= 0;
    reroll.onclick = () => this.handlers.reroll();
    const skip = document.createElement('button');
    skip.textContent = t('levelUp.skip');
    skip.onclick = () => this.handlers.skip();
    for (const b of [reroll, skip]) b.style.cssText = 'flex:1;padding:6px;border-radius:6px;cursor:pointer';
    footer.append(reroll, skip);
    this.root.replaceChildren(title, sub, ...list, footer);
    this.root.style.display = 'block';
    if (!this.onKey) {
      this.onKey = (ev) => {
        // 移動キーを押したまま開いたときの自動の繰り返しで、勝手に選ばれないようにする
        if (ev.repeat) return;
        const n = Number(ev.key);
        if (n >= 1 && n <= 9) this.handlers.choose(n - 1);
        else if (ev.key === 'r' || ev.key === 'R') this.handlers.reroll();
        else if (ev.key === 's' || ev.key === 'S') this.handlers.skip();
      };
      window.addEventListener('keydown', this.onKey);
    }
  }

  hide(): void {
    if (this.root.style.display === 'none') return;
    this.root.style.display = 'none';
    this.shownKey = '';
    if (this.onKey) window.removeEventListener('keydown', this.onKey);
    this.onKey = null;
  }
}
