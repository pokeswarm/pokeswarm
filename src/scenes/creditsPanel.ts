import { bgmConfig, itemIcons, uiConfig, siteConfig } from '../data';
import { t } from '../i18n';
import { compactScreen, windowCss } from '../render/pixelUi';

/** SpriteCollab の取得結果（public/sprites/credits.json）の1件 */
interface SpriteCredit {
  key: string;
  authors: { name: string; contact?: string }[];
  license: string;
  source: string;
}

/**
 * タイトル画面の下の、非公式の注意書きとクレジット（作者の決定 2026年10月22日。00_vision.md 4章）。
 * 注意書きはいつも出し、「クレジット」を押すと出典と権利の一覧を窓で出す
 */
export class TitleFooter {
  private readonly root: HTMLDivElement;
  private panel: HTMLDivElement | null = null;

  constructor() {
    this.root = document.createElement('div');
    this.root.style.cssText = `position:fixed;left:0;right:0;bottom:0;z-index:19;display:flex;align-items:center;gap:12px;padding:6px 12px;background:rgba(0,0,0,0.75);color:${uiConfig.dark.text};font-size:16px;line-height:1.4;box-sizing:border-box`;
    const notice = document.createElement('div');
    const compact = compactScreen();
    if (compact) {
      // 低い画面（横向きのスマホ）では1行だけ（作者の指摘 2026年10月22日: 帯が画面を覆っていた）。全文はクレジットの窓に出す
      this.root.style.padding = '4px 8px';
      notice.style.cssText = 'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      notice.textContent = t('footer.short', { url: siteConfig.officialUrl.replace(/^https?:\/\//, '') });
    } else {
      notice.style.cssText = 'flex:1;min-width:0;overflow-wrap:anywhere';
      notice.textContent = t('footer.notice');
      // 公式サイトのアドレス（広告の付いたページなどで遊んでいる人に、無断転載だと分かるように）
      const official = document.createElement('div');
      official.style.cssText = `color:${uiConfig.picker.selected}`;
      official.textContent = t('footer.official', { url: siteConfig.officialUrl });
      notice.append(official);
    }
    const button = document.createElement('button');
    button.style.cssText = `${windowCss('light')};min-height:${compact ? 36 : 44}px;padding:${compact ? '2px 10px' : '6px 12px'};cursor:pointer;font:inherit;font-size:16px;flex:none`;
    button.textContent = t('footer.credits');
    // タイトル画面のクリックで先へ進まないように止める
    button.onpointerdown = (ev) => ev.stopPropagation();
    button.onclick = (ev) => {
      ev.stopPropagation();
      void this.openCredits();
    };
    this.root.append(notice, button);
    document.body.append(this.root);
  }

  /** 下の帯の高さ（ログインの窓をその上に置くため） */
  get height(): number {
    return this.root.getBoundingClientRect().height;
  }

  private async openCredits(): Promise<void> {
    if (this.panel) return;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:40;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div');
    box.style.cssText = `${windowCss('dark')};width:min(760px,92vw);max-height:86vh;overflow:auto;padding:20px 24px;font-size:16px;line-height:1.7;box-sizing:border-box`;
    overlay.append(box);
    this.panel = overlay;
    document.body.append(overlay);
    const close = (): void => {
      overlay.remove();
      this.panel = null;
      window.removeEventListener('keydown', onKey);
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    overlay.onpointerdown = (ev) => {
      ev.stopPropagation();
      if (ev.target === overlay) close();
    };

    const section = (title: string, lines: string[]): void => {
      const h = document.createElement('div');
      h.style.cssText = 'font-size:16px;color:#f8d030;margin-top:12px';
      h.textContent = title;
      box.append(h);
      for (const line of lines) {
        const p = document.createElement('div');
        p.style.cssText = 'overflow-wrap:anywhere';
        p.textContent = line;
        box.append(p);
      }
    };
    const head = document.createElement('div');
    head.style.cssText = 'font-size:24px';
    head.textContent = t('credits.title');
    box.append(head);
    section(t('credits.notice'), [t('credits.noticeBody'), t('footer.official', { url: siteConfig.officialUrl })]);
    // ポケモンのドット絵: SpriteCollab の作者（重ねて出さない）。公式ゲーム由来の素材の権利の表記
    let authors: string[] = [];
    try {
      const base = import.meta.env.BASE_URL ?? '/';
      const list = (await (await fetch(`${base}sprites/credits.json`)).json()) as SpriteCredit[];
      authors = [...new Set(list.flatMap((c) => c.authors.map((a) => a.name)))].sort();
    } catch {
      authors = [];
    }
    section(t('credits.sprites'), [t('credits.spritesBody'), ...(authors.length ? [t('credits.spritesAuthors', { list: authors.join(', ') })] : [])]);
    section(t('credits.items'), [itemIcons.credit, itemIcons.source]);
    section(t('credits.data'), [t('credits.dataBody')]);
    section(t('credits.fonts'), [...uiConfig.font.credits]);
    section(t('credits.music'), [...new Set(Object.values(bgmConfig.tracks).map((x) => x.credit).filter((x): x is string => !!x))]);
    const back = document.createElement('button');
    back.style.cssText = `${windowCss('light')};min-height:44px;margin-top:16px;padding:6px 16px;cursor:pointer;font:inherit;font-size:16px`;
    back.textContent = t('credits.close');
    back.onclick = close;
    box.append(back);
  }

  destroy(): void {
    this.panel?.remove();
    this.root.remove();
  }
}
