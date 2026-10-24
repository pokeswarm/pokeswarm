import { drawMoveArt } from './moveArt';

/**
 * 技のドット絵を、ゲームとは別の処理（Web Worker）で描き直す（大きな絵は数十ミリ秒かかり、ゲームが一瞬止まるため）。
 * 受け取る: { id, step, k }。返す: { id, step, sp }（描けなければ sp は null）
 */
const scope = self as unknown as { onmessage: ((e: MessageEvent<{ id: string; step: number; k: number }>) => void) | null; postMessage(data: unknown): void };
scope.onmessage = (e) => {
  const { id, step, k } = e.data;
  scope.postMessage({ id, step, sp: drawMoveArt(id, k) });
};
