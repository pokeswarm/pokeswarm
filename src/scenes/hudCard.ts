import { t } from '../i18n';
import { windowCss } from '../render/pixelUi';
import type { Player } from '../sim/entities/player';
import type { World } from '../sim/world';
import { damageClassBadge, itemGains, itemName, moveDetail, moveGains, moveName } from './levelUpPanel';

/**
 * プレイ画面の技・持ち物のアイコンにマウスを乗せたときの詳細カード（作者の案 2026年10月22日。PC だけ）。
 * WASD で操作している間はマウスが空いているので、アイコンに乗せると中身を見られる。
 * 出す場所はマウスの位置ではなく、アイコンの列のすぐ下に決めておく（遊ぶじゃまにならないように）。
 * 中身: アイコン・名前・レベル、技はタイプと出し方と次のレベルで増えるもの、持ち物は今の効果（次のレベルがあれば「今 → 次」）
 */
export class HudCard {
  private readonly root: HTMLDivElement;
  private shownKey = '';

  constructor(private readonly iconUrl: (key: string) => string) {
    this.root = document.createElement('div');
    this.root.style.cssText = `${windowCss('light')};position:fixed;z-index:12;display:none;width:min(320px,40vw);padding:10px 14px;font-size:16px;line-height:1.6;box-sizing:border-box;pointer-events:none`;
    document.body.append(this.root);
  }

  /** target のアイコンの詳細を、画面の (left, top) に出す。target が null なら隠す */
  show(world: World, p: Player, target: { kind: 'move' | 'item'; slot: number } | null, iconKey: string | null, left: number, top: number): void {
    if (!target || !iconKey) {
      this.hide();
      return;
    }
    const r = world.rules;
    let name: string;
    let level: string;
    const lines: string[] = [];
    let gains: string[] = [];
    let damageClass: 'physical' | 'special' | null = null;
    if (target.kind === 'move') {
      const pm = p.moves[target.slot];
      if (!pm) return this.hide();
      const max = r.moves[pm.move]!.levels.length;
      name = moveName(world, pm.move);
      damageClass = r.moves[pm.move]!.damageClass;
      level = t('hudCard.level', { level: pm.level, max });
      lines.push(moveDetail(world, pm.move));
      if (pm.level < max) {
        lines.push(t('hudCard.nextLevel'));
        gains = moveGains(world, pm.move, pm.level);
      } else {
        lines.push(t('hudCard.maxLevel'));
      }
    } else {
      const it = p.items[target.slot];
      if (!it) return this.hide();
      const def = r.items[it.item]!;
      name = itemName(def.key);
      level = t('hudCard.level', { level: it.level, max: def.maxLevel });
      gains = itemGains(world, it.item, it.level, it.level < def.maxLevel ? it.level + 1 : null);
    }
    const key = JSON.stringify([iconKey, name, damageClass, level, lines, gains, left, top]);
    if (key !== this.shownKey) {
      this.shownKey = key;
      const head = document.createElement('div');
      head.style.cssText = 'display:flex;align-items:center;gap:10px';
      const icon = document.createElement('img');
      icon.src = this.iconUrl(iconKey);
      icon.alt = '';
      icon.style.cssText = 'width:48px;height:48px;image-rendering:pixelated;flex:none';
      const title = document.createElement('div');
      const n = document.createElement('div');
      n.style.cssText = 'display:flex;align-items:center;gap:8px';
      const nt = document.createElement('span');
      nt.textContent = name;
      n.append(nt);
      if (damageClass) n.append(damageClassBadge(damageClass, 13));
      const l = document.createElement('div');
      l.textContent = level;
      title.append(n, l);
      head.append(icon, title);
      const body = document.createElement('div');
      body.style.cssText = 'white-space:pre-line;overflow-wrap:anywhere;margin-top:6px';
      body.textContent = lines.join('\n');
      const g = document.createElement('div');
      g.style.cssText = 'white-space:pre-line;color:#208838';
      g.textContent = gains.join('\n');
      this.root.replaceChildren(head, body, g);
      this.root.style.left = `${Math.round(left)}px`;
      this.root.style.top = `${Math.round(top)}px`;
    }
    this.root.style.display = 'block';
  }

  hide(): void {
    if (this.root.style.display === 'none') return;
    this.root.style.display = 'none';
    this.shownKey = '';
  }

  destroy(): void {
    this.root.remove();
  }
}
