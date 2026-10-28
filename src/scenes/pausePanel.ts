import { compactScreen, windowCss } from '../render/pixelUi';
import { t } from '../i18n';
import { appendAudioControls } from './audioControls';
import { appendDamageNumbersControl } from './displayControls';

/** ポーズの画面の種類: paused = 自分が止めた（ソロ・ホスト）、hostPaused = ホストが止めた（ゲスト）、settings = 止めずに設定だけ（ゲスト） */
export type PauseKind = 'paused' | 'hostPaused' | 'settings';

/**
 * ポーズの画面（DOM。作者の決定 2026年10月25日）: Esc で開く。音量の設定と、閉じる（再開する）ボタン。
 * ソロとホストは全員のゲームを止める。ホスト以外は止めずに設定だけを出し、ホストが止めている間は その知らせを出す
 */
export class PausePanel {
  private readonly root: HTMLDivElement;
  private shown: PauseKind | null = null;

  constructor(
    /** 閉じるボタン（ソロ・ホストは再開、ゲストは設定を閉じる）。ホストが止めているときのゲストには出さない */
    private readonly onClose: () => void,
    /** ダメージの数字を切り替えた */
    private readonly onDamageNumbers: (on: boolean) => void,
  ) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(480px,92vw);max-height:96vh;overflow:auto;padding:24px;background:#000;color:#f8f8f8;border:4px solid #f8f8f8;box-shadow:inset 0 0 0 2px #000,inset 0 0 0 4px #f8f8f8;font-family:inherit;font-size:16px;line-height:1.6;border-radius:6px;z-index:25;box-sizing:border-box;display:none;flex-direction:column;gap:14px';
    document.body.appendChild(this.root);
  }

  /** 毎フレーム呼ぶ。種類が変わったときだけ作り直す（スライダーを動かしている途中で消えないように） */
  show(kind: PauseKind): void {
    if (this.shown === kind) return;
    this.shown = kind;
    if (compactScreen()) this.root.style.padding = '10px 14px';
    const title = document.createElement('div');
    title.style.cssText = 'font-size:24px;font-weight:bold';
    title.textContent = t(`pause.title.${kind}`);
    this.root.replaceChildren(title);
    if (kind === 'hostPaused') {
      const note = document.createElement('div');
      note.style.opacity = '0.85';
      note.textContent = t('pause.hostPausedNote');
      this.root.append(note);
    }
    appendAudioControls(this.root);
    // ダメージの数字の 出す・出さない（ラン中もすぐ切り替える。07 の110章）
    appendDamageNumbersControl(this.root, this.onDamageNumbers);
    if (kind !== 'hostPaused') {
      const close = document.createElement('button');
      close.style.cssText = `${windowCss('light')};min-height:44px;padding:8px 16px;cursor:pointer;font:inherit;font-size:16px;align-self:flex-end`;
      close.textContent = t(kind === 'paused' ? 'pause.resume' : 'pause.close');
      close.onclick = () => this.onClose();
      this.root.append(close);
    }
    this.root.style.display = 'flex';
  }

  hide(): void {
    if (this.shown === null) return;
    this.shown = null;
    this.root.style.display = 'none';
  }

  destroy(): void {
    this.root.remove();
  }
}
