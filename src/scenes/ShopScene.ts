import Phaser from 'phaser';
import { generated, playablesConfig, shopConfig } from '../data';
import { localName } from '../data/simRules';
import { getLocale, t, tMaybe } from '../i18n';
import { session } from '../meta/session';
import { compactScreen } from '../render/pixelUi';
import { buyPokemon, buyUpgrade, nextCost, refundAll, upgradeLevel } from '../meta/shop';

// 原作をまねた白い窓のボタン（作者の決定。2026年10月22日。src/render/pixelUi.ts の windowCss と同じ見た目）
const BUTTON = 'min-height:44px;padding:8px 14px;cursor:pointer;font:inherit;font-size:16px;background:#f8f8f8;color:#383848;border:4px solid #383848;border-radius:6px;box-shadow:inset 0 0 0 3px #f8f8f8,inset 0 0 0 5px #a8b8c8';

/**
 * フレンドリィショップ（永続強化。DOM。見た目の作り込みはフェーズ4）。
 * 所持コイン・強化ごとのレベルと次の費用・買う・すべての払い戻し。
 * 買ったものはセーブデータに入り、ランの始めに当てはめる。Firestore へは画面を出るときにまとめて書く
 */
export class ShopScene extends Phaser.Scene {
  constructor() {
    super('shop');
  }

  create(): void {
    const root = document.createElement('div');
    root.style.cssText =
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(1040px,96vw);height:min(90vh,900px);display:flex;flex-direction:column;padding:16px 20px;background:#000;color:#f8f8f8;border:4px solid #f8f8f8;box-shadow:inset 0 0 0 2px #000,inset 0 0 0 4px #f8f8f8;font-family:inherit;font-size:16px;line-height:1.6;border-radius:6px;z-index:20;box-sizing:border-box';
    // 低い画面（横向きのスマホ）では余白・文字・ボタンをつめる
    const compact = compactScreen();
    if (compact) root.style.cssText += ';padding:8px 12px;height:96vh';
    const button = BUTTON + (compact ? ';min-height:36px;padding:2px 10px' : '');
    document.body.appendChild(root);
    const render = (): void => {
      const save = session.store.current;
      const header = document.createElement('div');
      header.style.cssText = `display:flex;align-items:center;gap:12px;margin-bottom:${compact ? 4 : 10}px;flex:none;flex-wrap:wrap`;
      const title = document.createElement('div');
      title.style.cssText = `font-size:${compact ? 20 : 24}px;font-weight:bold`;
      title.textContent = t('shop.title');
      const coins = document.createElement('div');
      coins.style.cssText = `font-size:${compact ? 20 : 24}px;color:#ffe082;flex:1`;
      coins.textContent = t('shop.coins', { coins: save.coins });
      header.append(title, coins);

      // 作者の依頼（2026年10月22日）: 1行に1つの強化（名前・ランク・効果・買うボタンを横に並べる。実績の一覧と同じ形）
      const columns = 'grid-template-columns:minmax(0,1fr) 6em minmax(0,2fr) 9em';
      const labels = document.createElement('div');
      labels.style.cssText = `display:grid;${columns};gap:12px;padding:0 12px 6px;opacity:0.7;flex:none;border-bottom:2px solid #f8f8f8`;
      for (const key of ['shop.colName', 'shop.colRank', 'shop.colEffect'] as const) {
        const l = document.createElement('div');
        l.textContent = t(key);
        labels.append(l);
      }
      const list = document.createElement('div');
      list.style.cssText = 'flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:4px;padding-top:6px';
      // コインで買えるポケモン（作者の決定 2026年10月23日）。強化の上に、見出しを付けて並べる
      if (shopConfig.pokemon.length > 0) {
        const heading = document.createElement('div');
        heading.style.cssText = 'padding:2px 12px;opacity:0.7';
        heading.textContent = t('shop.pokemonSection');
        list.append(heading);
      }
      for (const item of shopConfig.pokemon) {
        const unlockName = playablesConfig.pokemon[item.key]?.unlock ?? item.key;
        const owned = save.unlocked.includes(unlockName);
        const row = document.createElement('div');
        row.style.cssText = `display:grid;${columns};gap:12px;align-items:center;padding:4px 12px;border-radius:6px;border:2px solid ${owned ? '#f8d030' : '#585868'};background:${owned ? '#3d2a08' : '#000000'};overflow-wrap:anywhere`;
        const name = document.createElement('div');
        name.textContent = localName(generated.pokemon[item.key]?.names, getLocale(), item.key);
        if (owned) name.style.color = '#f8d030';
        const state = document.createElement('div');
        state.textContent = owned ? t('shop.owned') : '';
        const desc = document.createElement('div');
        desc.style.opacity = '0.85';
        desc.textContent = t('shop.pokemonDesc');
        const buy = document.createElement('button');
        buy.style.cssText = BUTTON + ';width:100%;min-height:36px;padding:2px 8px';
        buy.textContent = owned ? t('shop.owned') : t('shop.buy', { cost: item.cost });
        buy.disabled = owned || save.coins < item.cost;
        if (buy.disabled) buy.style.opacity = '0.5';
        buy.onclick = () => session.store.update((d) => void buyPokemon(d, shopConfig, item.key, unlockName));
        row.append(name, state, desc, buy);
        list.append(row);
      }
      if (shopConfig.pokemon.length > 0) {
        const heading = document.createElement('div');
        heading.style.cssText = 'padding:8px 12px 2px;opacity:0.7';
        heading.textContent = t('shop.title');
        list.append(heading);
      }
      for (const def of shopConfig.upgrades) {
        const level = upgradeLevel(save, def.id);
        const cost = nextCost(def, level);
        const maxed = cost === null;
        const row = document.createElement('div');
        row.style.cssText = `display:grid;${columns};gap:12px;align-items:center;padding:4px 12px;border-radius:6px;border:2px solid ${level > 0 ? '#f8d030' : '#585868'};background:${level > 0 ? '#3d2a08' : '#000000'};overflow-wrap:anywhere`;
        const name = document.createElement('div');
        name.textContent = tMaybe(`shop.${def.id}.name`);
        if (level > 0) name.style.color = '#f8d030';
        const lv = document.createElement('div');
        lv.textContent = t('shop.level', { level, max: def.maxLevel });
        const desc = document.createElement('div');
        desc.style.opacity = '0.85';
        desc.textContent = tMaybe(`shop.${def.id}.desc`);
        const buy = document.createElement('button');
        buy.style.cssText = BUTTON + ';width:100%;min-height:36px;padding:2px 8px';
        buy.textContent = maxed ? t('shop.maxed') : t('shop.buy', { cost });
        buy.disabled = maxed || save.coins < cost;
        if (buy.disabled) buy.style.opacity = '0.5';
        buy.onclick = () => session.store.update((d) => void buyUpgrade(d, shopConfig, def.id));
        row.append(name, lv, desc, buy);
        list.append(row);
      }

      const footer = document.createElement('div');
      footer.style.cssText = `display:flex;gap:8px;margin-top:${compact ? 4 : 10}px;flex-wrap:wrap;flex:none`;
      const refund = document.createElement('button');
      refund.style.cssText = button;
      refund.textContent = t('shop.refund');
      const spent = shopConfig.upgrades.reduce((sum, d) => {
        const l = upgradeLevel(save, d.id);
        return sum + (d.baseCost * l * (l + 1)) / 2;
      }, 0);
      refund.disabled = spent === 0;
      if (refund.disabled) refund.style.opacity = '0.5';
      refund.onclick = () => {
        if (window.confirm(t('shop.refundConfirm', { coins: spent }))) session.store.update((d) => void refundAll(d, shopConfig));
      };
      const back = document.createElement('button');
      back.style.cssText = button;
      back.textContent = t('shop.back');
      back.onclick = () => this.scene.start('title');
      header.append(back);
      footer.append(refund);
      const scroll = root.querySelector<HTMLDivElement>('[data-list]')?.scrollTop ?? 0;
      list.dataset.list = '1';
      root.replaceChildren(header, labels, list, footer);
      // 買って描き直しても、見ていた場所のまま
      list.scrollTop = scroll;
    };
    render();
    const off = session.store.onChange(render);
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') this.scene.start('title');
    };
    window.addEventListener('keydown', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      off();
      window.removeEventListener('keydown', onKey);
      root.remove();
      // 買い物はまとめて保存する（書き込みの回数を抑える）
      void session.store.flush();
    });
  }
}
