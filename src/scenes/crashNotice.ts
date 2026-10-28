import { t } from '../i18n';
import type { RunProbe } from '../meta/runProbe';
import { windowCss } from '../render/pixelUi';
import { formatTime } from './ResultScene';

/**
 * 前回のランが途中で終わっていたときの知らせ（DOM。07 の112章）。そのときの様子（経過・区間・敵の数・絵の量・つながり方）を出し、
 * 作者に報告してもらえるようにする。閉じるボタンで消す
 */
export function showCrashNotice(probe: RunProbe, coins: number | null): void {
  const root = document.createElement('div');
  root.style.cssText = `${windowCss('light')};position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:45;width:min(560px,94vw);max-height:92vh;overflow:auto;padding:12px 16px;font-size:14px;line-height:1.6;box-sizing:border-box;display:flex;flex-direction:column;gap:6px`;
  const line = (text: string, bold = false): void => {
    const d = document.createElement('div');
    if (bold) d.style.cssText = 'font-size:16px;font-weight:bold';
    d.textContent = text;
    root.append(d);
  };
  line(t('run.crash.title'), true);
  line(t(probe.closed ? 'run.crash.closed' : 'run.crash.reloaded'));
  if (coins !== null) line(t('run.crash.saved', { coins }));
  const transport = probe.transport === 'relay' ? t('net.mode.relay') : probe.transport === 'p2p' ? t('net.mode.p2p') : t('run.crash.solo');
  line(
    t('run.crash.detail', {
      time: formatTime(probe.seconds),
      section: probe.section + 1,
      enemies: probe.enemies,
      projectiles: probe.projectiles,
      players: probe.players,
      transport,
      texture: probe.textureMB,
      textures: probe.textures,
      fps: probe.fps,
      version: probe.version,
    }) + (probe.heapMB !== null ? ` ・ JS ${probe.heapMB}MB` : ''),
  );
  // 協力プレイ: 送りきれずにたまっている量と、送受信の量（07 の113章。前の版の記録には無い）
  if (probe.transport && probe.bufferedKB !== undefined)
    line(t('run.crash.net', { buffered: probe.bufferedKB, maxBuffered: probe.maxBufferedKB, sent: probe.sentKB, received: probe.receivedKB }));
  // 数の移り変わり（最初 → 最後。増えたものを先に。07 の118章）
  const trend = probe.trend ?? [];
  if (trend.length >= 2) {
    const first = trend[0]!;
    const last = trend[trend.length - 1]!;
    const keys = Object.keys(last.counts).sort((a, b) => (last.counts[b]! - (first.counts[b] ?? 0)) / Math.max(1, first.counts[b] ?? 0) - (last.counts[a]! - (first.counts[a] ?? 0)) / Math.max(1, first.counts[a] ?? 0));
    line(t('run.crash.trend', { from: formatTime(first.seconds), to: formatTime(last.seconds) }) + ' ' + keys.map((k) => `${k} ${first.counts[k] ?? '-'}→${last.counts[k]}`).join('・'));
  }
  const close = document.createElement('button');
  close.style.cssText = `${windowCss('light')};min-height:40px;padding:4px 14px;cursor:pointer;font:inherit;font-size:14px;align-self:flex-end`;
  close.textContent = t('run.crash.close');
  close.onclick = () => root.remove();
  root.append(close);
  document.body.append(root);
}
