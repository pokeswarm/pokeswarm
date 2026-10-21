import type { BgmConfig, MusicScore } from '../data/schema';
import { MusicPlayer } from './music';

/** 鳴っている曲: 作者が用意したファイル（HTML の audio）か、楽譜をコードで鳴らすもの */
type Playing = { id: string; kind: 'file'; el: HTMLAudioElement } | { id: string; kind: 'score'; player: MusicPlayer };

/**
 * BGM（data/audio/bgm.json）。曲ごとに、作者が用意したファイル（file）か、コードで鳴らす 8bit の楽譜（score）を使う。
 * 両方あればファイルを先に使い、読めなければ楽譜にする。どちらも無ければ鳴らさない（エラーにしない）。
 * 曲が変わるときは前の曲を小さくしながら次の曲を大きくする。ブラウザの決まりで、最初のクリックかキーの後に鳴り始める。
 */
export class BgmPlayer {
  private current: Playing | null = null;
  private wanted: string | null = null;
  private unlocked = false;
  private volume = 1;
  private readonly failedFiles = new Set<string>();

  constructor(
    private readonly config: BgmConfig,
    private readonly scores: Readonly<Record<string, MusicScore>>,
    /** 効果音と同じ音の出口（楽譜の曲を鳴らす） */
    private readonly context: () => { ctx: AudioContext; destination: AudioNode } | null,
  ) {}

  unlock(): void {
    this.unlocked = true;
    if (this.wanted && !this.current) this.start(this.wanted);
    else if (this.current?.kind === 'file') void this.current.el.play().catch(() => undefined);
  }

  setVolume(volume: number): void {
    this.volume = volume;
    const c = this.current;
    if (!c) return;
    if (c.kind === 'file') c.el.volume = this.trackVolume(c.id);
    else c.player.fadeTo(this.trackVolume(c.id), 0.05);
  }

  /** 曲を変える（null で止める）。同じ曲ならそのまま続ける */
  play(id: string | null): void {
    this.wanted = id;
    if (this.current?.id === id) return;
    this.stopCurrent();
    if (id && this.unlocked) this.start(id);
  }

  private start(id: string): void {
    const track = this.config.tracks[id];
    if (!track) return;
    if (track.file && !this.failedFiles.has(id)) this.startFile(id, track.file);
    else if (track.score) this.startScore(id, track.score);
  }

  private startFile(id: string, file: string): void {
    const el = new Audio(`${import.meta.env.BASE_URL}${file}`);
    el.loop = true;
    el.volume = 0;
    el.addEventListener('error', () => {
      // ファイルがまだ無い・読めない: 楽譜があれば楽譜で鳴らす
      this.failedFiles.add(id);
      if (this.current?.kind === 'file' && this.current.el === el) {
        this.current = null;
        if (this.wanted === id) this.start(id);
      }
    });
    this.current = { id, kind: 'file', el };
    void el.play().catch(() => undefined);
    this.fadeElement(el, () => this.trackVolume(id));
  }

  private startScore(id: string, scoreName: string): void {
    const score = this.scores[scoreName];
    const out = this.context();
    if (!score || !out) return;
    const player = new MusicPlayer(out.ctx, score, out.destination);
    player.fadeTo(this.trackVolume(id), this.config.fadeSeconds);
    this.current = { id, kind: 'score', player };
  }

  private stopCurrent(): void {
    const c = this.current;
    this.current = null;
    if (!c) return;
    if (c.kind === 'score') {
      c.player.stop(this.config.fadeSeconds);
      return;
    }
    this.fadeElement(c.el, () => 0, () => {
      c.el.pause();
      c.el.src = '';
    });
  }

  private trackVolume(id: string): number {
    return Math.min(1, (this.config.tracks[id]?.volume ?? 1) * this.volume);
  }

  /** ファイルの曲の音量を fadeSeconds かけて target() まで変える（途中で設定が変わっても合わせる） */
  private fadeElement(el: HTMLAudioElement, target: () => number, done?: () => void): void {
    const ms = this.config.fadeSeconds * 1000;
    const from = el.volume;
    const start = performance.now();
    const step = (): void => {
      const k = ms <= 0 ? 1 : Math.min(1, (performance.now() - start) / ms);
      el.volume = Math.max(0, Math.min(1, from + (target() - from) * k));
      if (k < 1) window.setTimeout(step, 50);
      else done?.();
    };
    step();
  }
}
