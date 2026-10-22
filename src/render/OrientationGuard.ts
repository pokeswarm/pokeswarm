import { uiConfig } from '../data';
import { t } from '../i18n';
import { isTouchDevice } from './TouchJoystick';

/**
 * スマホは横向きだけで遊ぶ（作者の決定 2026年10月22日。07 25.4）。タッチの端末が縦向きのときは「横にしてください」の画面を出す。
 * その間、ソロのランは止める（RunScene が blocked を見る）
 */
export class OrientationGuard {
  private readonly root: HTMLDivElement;

  constructor() {
    this.root = document.createElement('div');
    this.root.style.cssText = `position:fixed;inset:0;z-index:100;background:#000;color:${uiConfig.dark.text};display:none;align-items:center;justify-content:center;text-align:center;font-size:16px;line-height:2;padding:24px;box-sizing:border-box`;
    this.root.textContent = t('orientation.rotate');
    document.body.append(this.root);
    const check = (): void => {
      this.root.style.display = this.blocked ? 'flex' : 'none';
    };
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    check();
  }

  /** 縦向きで遊べない状態か */
  get blocked(): boolean {
    return isTouchDevice() && window.innerHeight > window.innerWidth;
  }
}

/** 起動時に1つだけ作る（main.ts） */
export let orientationGuard: OrientationGuard | null = null;

export function startOrientationGuard(): void {
  orientationGuard ??= new OrientationGuard();
}
