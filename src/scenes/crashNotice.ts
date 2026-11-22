import { t } from '../i18n';
import { clearCrashReport, type CrashReport } from '../meta/runProbe';
import { windowCss } from '../render/pixelUi';
import { formatTime } from './ResultScene';

/** 落ちる直前の様子の文（知らせの窓と、コピーする文の先頭） */
function summaryLines(report: CrashReport): string[] {
  const { probe, coins } = report;
  const lines: string[] = [t(probe.closed ? 'run.crash.closed' : 'run.crash.reloaded')];
  if (coins !== null) lines.push(t('run.crash.saved', { coins }));
  const transport = probe.transport === 'relay' ? t('net.mode.relay') : probe.transport === 'p2p' ? t('net.mode.p2p') : t('run.crash.solo');
  lines.push(
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
    lines.push(t('run.crash.net', { buffered: probe.bufferedKB, maxBuffered: probe.maxBufferedKB, sent: probe.sentKB, received: probe.receivedKB }));
  // 数の移り変わり（最初 → 最後。増えたものを先に。07 の118章）
  const trend = probe.trend ?? [];
  if (trend.length >= 2) {
    const first = trend[0]!;
    const last = trend[trend.length - 1]!;
    const keys = Object.keys(last.counts).sort((a, b) => (last.counts[b]! - (first.counts[b] ?? 0)) / Math.max(1, first.counts[b] ?? 0) - (last.counts[a]! - (first.counts[a] ?? 0)) / Math.max(1, first.counts[a] ?? 0));
    lines.push(t('run.crash.trend', { from: formatTime(first.seconds), to: formatTime(last.seconds) }) + ' ' + keys.map((k) => `${k} ${first.counts[k] ?? '-'}→${last.counts[k]}`).join('・'));
  }
  return lines;
}

/**
 * 作者へ送る文（コピー用）: 上の文に、端末・役・固まり具合と、30 秒ごとの数の表を全部付ける。
 * 表の名前は RunScene.probeCounts のもの（調べる人が読むもので、翻訳しない）
 */
export function crashReportText(report: CrashReport): string {
  const { probe, device } = report;
  const out = [`PokéSwarm crash report v${probe.version}`, new Date(probe.at).toISOString(), device, ...summaryLines(report)];
  out.push(`role=${probe.role ?? '-'} worstFrameMs=${probe.worstFrameMs ?? '-'} simMs=${probe.simMs ?? '-'} closed=${probe.closed}`);
  const trend = probe.trend ?? [];
  if (trend.length > 0) {
    const keys = Object.keys(trend[trend.length - 1]!.counts);
    out.push(['time', ...keys].join('\t'));
    for (const s of trend) out.push([formatTime(s.seconds), ...keys.map((k) => s.counts[k] ?? '')].join('\t'));
  }
  return out.join('\n');
}

/**
 * クラッシュレポートの窓（DOM。07 の112章・344章）。前回ページごと落ちたランの、落ちる直前の様子を出す。
 * タイトルの「クラッシュレポート」のボタンから開く（自動では出さない。画面を覆うため）。コピーして作者へ送れる
 */
export function showCrashNotice(report: CrashReport, onDelete?: () => void): void {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:45;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center';
  const root = document.createElement('div');
  root.style.cssText = `${windowCss('light')};width:min(560px,94vw);max-height:92vh;overflow:auto;padding:12px 16px;font-size:14px;line-height:1.6;box-sizing:border-box;display:flex;flex-direction:column;gap:6px`;
  overlay.append(root);
  const close = (): void => overlay.remove();
  overlay.onpointerdown = (ev) => {
    ev.stopPropagation();
    if (ev.target === overlay) close();
  };
  const title = document.createElement('div');
  title.style.cssText = 'font-size:16px;font-weight:bold';
  title.textContent = t('run.crash.title');
  root.append(title);
  // 送る文の全部（コピーできないブラウザでも、長押しで選べるように見せておく）
  const full = document.createElement('textarea');
  full.readOnly = true;
  full.value = crashReportText(report);
  full.style.cssText = 'width:100%;height:96px;box-sizing:border-box;font:12px monospace;white-space:pre;flex:none';
  // ボタンは上に置く（横向きのスマホでは下が画面の外になり、スクロールしないと押せなかった）
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap';
  const button = (label: string, onClick: (b: HTMLButtonElement) => void): void => {
    const b = document.createElement('button');
    b.style.cssText = `${windowCss('light')};min-height:40px;padding:4px 14px;cursor:pointer;font:inherit;font-size:14px`;
    b.textContent = label;
    b.onclick = () => onClick(b);
    row.append(b);
  };
  button(t('run.crash.copy'), (b) => {
    const done = (): void => void (b.textContent = t('run.crash.copied'));
    const fallback = (): void => {
      full.select();
      if (document.execCommand('copy')) done();
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(full.value).then(done, fallback);
    else fallback();
  });
  if (onDelete)
    button(t('run.crash.delete'), () => {
      clearCrashReport();
      onDelete();
      close();
    });
  button(t('run.crash.close'), close);
  root.append(row);
  for (const text of summaryLines(report)) {
    const d = document.createElement('div');
    d.style.cssText = 'overflow-wrap:anywhere';
    d.textContent = text;
    root.append(d);
  }
  root.append(full);
  document.body.append(overlay);
}
