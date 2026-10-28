/**
 * 画面を消さない（Screen Wake Lock API）。作者の報告 2026年10月28日: スマホの協力プレイでよく接続が切れる。
 * スマホは画面が消えるとページのタイマーごと止まり、相手から見ると「なにも届かない」まま切断になるため、ランと待合室の間は画面を点けたままにする。
 * ページが裏に回ると自動で外れるので、表に戻ったら取り直す。使えないブラウザでは何もしない。返す関数で外す
 */
export function holdScreenAwake(): () => void {
  type Sentinel = { release(): Promise<void> };
  const api = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } }).wakeLock;
  if (!api) return () => undefined;
  let sentinel: Sentinel | null = null;
  let done = false;
  const request = (): void => {
    if (done || document.visibilityState !== 'visible') return;
    api.request('screen').then(
      (s) => {
        if (done) void s.release();
        else sentinel = s;
      },
      // 電池の節約モードなどで断られることがある（そのまま続ける）
      (err: unknown) => console.info('[wakeLock] 画面を点けたままにできませんでした', err),
    );
  };
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') request();
  };
  document.addEventListener('visibilitychange', onVisible);
  request();
  return () => {
    done = true;
    document.removeEventListener('visibilitychange', onVisible);
    void sentinel?.release().catch(() => undefined);
    sentinel = null;
  };
}
