import Phaser from 'phaser';
import { shopConfig } from '../data';
import { t, tMaybe } from '../i18n';
import { session } from '../meta/session';
import { buyUpgrade, nextCost, refundAll, upgradeLevel } from '../meta/shop';

// 原作をまねた白い窓のボタン（作者の決定。2026年10月22日。src/render/pixelUi.ts の windowCss と同じ見た目）
const BUTTON = 'padding:8px 14px;cursor:pointer;font:inherit;font-size:16px;background:#f8f8f8;color:#383848;border:4px solid #383848;border-radius:6px;box-shadow:inset 0 0 0 3px #f8f8f8,inset 0 0 0 5px #a8b8c8';

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
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(760px,92vw);max-height:90vh;overflow:auto;padding:24px;background:#000;color:#f8f8f8;border:4px solid #f8f8f8;box-shadow:inset 0 0 0 2px #000,inset 0 0 0 4px #f8f8f8;font-family:inherit;font-size:16px;line-height:1.6;border-radius:6px;z-index:20;box-sizing:border-box';
    document.body.appendChild(root);
    const render = (): void => {
      const save = session.store.current;
      const header = document.createElement('div');
      header.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px';
      const title = document.createElement('div');
      title.style.cssText = 'font-size:24px;font-weight:bold';
      title.textContent = t('shop.title');
      const coins = document.createElement('div');
      coins.style.cssText = 'font-size:24px;color:#ffe082';
      coins.textContent = t('shop.coins', { coins: save.coins });
      header.append(title, coins);

      const list = document.createElement('div');
      list.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px';
      for (const def of shopConfig.upgrades) {
        const level = upgradeLevel(save, def.id);
        const cost = nextCost(def, level);
        const cell = document.createElement('div');
        cell.style.cssText = 'padding:10px 12px;border-radius:6px;border:2px solid #f8f8f8;background:#000000;display:flex;flex-direction:column;gap:4px';
        const name = document.createElement('div');
        name.style.cssText = 'display:flex;justify-content:space-between;font-weight:bold';
        const n = document.createElement('span');
        n.textContent = tMaybe(`shop.${def.id}.name`);
        const lv = document.createElement('span');
        lv.textContent = t('shop.level', { level, max: def.maxLevel });
        name.append(n, lv);
        const desc = document.createElement('div');
        desc.style.cssText = 'font-size:16px;opacity:0.85';
        desc.textContent = tMaybe(`shop.${def.id}.desc`);
        const buy = document.createElement('button');
        buy.style.cssText = BUTTON + ';margin-top:auto';
        buy.textContent = cost === null ? t('shop.maxed') : t('shop.buy', { cost });
        buy.disabled = cost === null || save.coins < cost;
        if (buy.disabled) buy.style.opacity = '0.5';
        buy.onclick = () => session.store.update((d) => void buyUpgrade(d, shopConfig, def.id));
        cell.append(name, desc, buy);
        list.append(cell);
      }

      const footer = document.createElement('div');
      footer.style.cssText = 'display:flex;gap:8px;margin-top:16px;flex-wrap:wrap';
      const refund = document.createElement('button');
      refund.style.cssText = BUTTON;
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
      back.style.cssText = BUTTON;
      back.textContent = t('shop.back');
      back.onclick = () => this.scene.start('title');
      footer.append(refund, back);
      root.replaceChildren(header, list, footer);
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
