import { uiConfig } from '../data';
import type { Axis } from '../sim/commands';

/** タッチで操作できる端末か（スマホ・タブレット） */
export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);
}

/**
 * スマホのジョイスティック（作者の決定 2026年10月22日。07 25.4）: 画面の左半分の、触れた場所が中心になる。
 * 指を動かした向きを8方向に丸める（シミュレーションと通信の入力は8方向のまま）。少しだけ動かしたとき（遊び）は止まる。
 * 見た目は DOM（ドット調の輪とつまみ）。右半分と、DOM の画面（レベルアップのカードなど）への操作はじゃましない
 */
export class TouchJoystick {
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private pointer: number | null = null;
  private cx = 0;
  private cy = 0;
  private dx: Axis = 0;
  private dy: Axis = 0;
  private readonly onDown: (ev: PointerEvent) => void;
  private readonly onMove: (ev: PointerEvent) => void;
  private readonly onUp: (ev: PointerEvent) => void;

  constructor(
    canvas: HTMLCanvasElement,
    /** ここを触ったときは出さない（画面の座標。技・持ち物のアイコンをタップして詳細カードを出すため。07 の111章） */
    private readonly ignore: (clientX: number, clientY: number) => boolean = () => false,
  ) {
    const c = uiConfig.joystick;
    this.base = document.createElement('div');
    this.base.style.cssText = `position:fixed;width:${c.radius * 2}px;height:${c.radius * 2}px;margin:-${c.radius}px 0 0 -${c.radius}px;border:4px solid ${uiConfig.window.fill};border-radius:50%;background:rgba(0,0,0,0.25);box-sizing:border-box;pointer-events:none;z-index:15;display:none`;
    this.knob = document.createElement('div');
    this.knob.style.cssText = `position:fixed;width:${c.knob * 2}px;height:${c.knob * 2}px;margin:-${c.knob}px 0 0 -${c.knob}px;border:4px solid ${uiConfig.window.border};border-radius:50%;background:${uiConfig.window.fill};box-sizing:border-box;pointer-events:none;z-index:16;display:none`;
    document.body.append(this.base, this.knob);
    this.onDown = (ev) => {
      // 画面の左半分のゲームの画面（canvas）を触ったときだけ。DOM の画面の上では出さない
      if (this.pointer !== null || ev.pointerType === 'mouse' || ev.target !== canvas || ev.clientX > window.innerWidth / 2 || this.ignore(ev.clientX, ev.clientY)) return;
      this.pointer = ev.pointerId;
      this.cx = ev.clientX;
      this.cy = ev.clientY;
      this.base.style.left = `${this.cx}px`;
      this.base.style.top = `${this.cy}px`;
      this.base.style.display = 'block';
      this.knob.style.display = 'block';
      this.update(ev.clientX, ev.clientY);
    };
    this.onMove = (ev) => {
      if (ev.pointerId === this.pointer) this.update(ev.clientX, ev.clientY);
    };
    this.onUp = (ev) => {
      if (ev.pointerId !== this.pointer) return;
      this.pointer = null;
      this.dx = 0;
      this.dy = 0;
      this.base.style.display = 'none';
      this.knob.style.display = 'none';
    };
    window.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
  }

  /** 指の位置から向きを決める（8方向。遊びより近ければ止まる） */
  private update(x: number, y: number): void {
    const c = uiConfig.joystick;
    let vx = x - this.cx;
    let vy = y - this.cy;
    const d = Math.hypot(vx, vy);
    // つまみは輪の中に収める
    if (d > c.radius) {
      vx = (vx / d) * c.radius;
      vy = (vy / d) * c.radius;
    }
    this.knob.style.left = `${this.cx + vx}px`;
    this.knob.style.top = `${this.cy + vy}px`;
    if (d < c.deadzone) {
      this.dx = 0;
      this.dy = 0;
      return;
    }
    // 45° ごとの8方向に丸める
    const a = (Math.round(Math.atan2(vy, vx) / (Math.PI / 4)) * Math.PI) / 4;
    this.dx = Math.round(Math.cos(a)) as Axis;
    this.dy = Math.round(Math.sin(a)) as Axis;
  }

  read(): { dx: Axis; dy: Axis } {
    return { dx: this.dx, dy: this.dy };
  }

  destroy(): void {
    window.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    this.base.remove();
    this.knob.remove();
  }
}
