import type { BgmConfig } from '../data/schema';

/**
 * BGM（作者が用意した音声ファイル。data/audio/bgm.json）。曲が変わるときは前の曲を小さくしながら次の曲を大きくする。
 * ファイルがまだ無い曲・読めない曲は鳴らさない（エラーにしない）。ブラウザの決まりで、最初のクリックかキーの後に鳴り始める。
 */
export class BgmPlayer {
  private current: { id: string; el: HTMLAudioElement } | null = null;
  private wanted: string | null = null;
  private unlocked = false;
  private volume = 1;
  private readonly failed = new Set<string>();
  private readonly fading = new Set<HTMLAudioElement>();

  constructor(private readonly config: BgmConfig) {}

  unlock(): void {
    this.unlocked = true;
    if (this.wanted && !this.current) this.play(this.wanted);
    else void this.current?.el.play().catch(() => undefined);
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.current) this.current.el.volume = this.trackVolume(this.current.id);
  }

  /** 曲を変える（null で止める）。同じ曲ならそのまま続ける */
  play(id: string | null): void {
    this.wanted = id;
    if (this.current?.id === id) return;
    if (this.current) this.fadeOut(this.current.el);
    this.current = null;
    if (!id || !this.unlocked || this.failed.has(id)) return;
    const track = this.config.tracks[id];
    if (!track) return;
    const el = new Audio(`${import.meta.env.BASE_URL}${track.file}`);
    el.loop = true;
    el.volume = 0;
    el.addEventListener('error', () => {
      this.failed.add(id);
      if (this.current?.el === el) this.current = null;
    });
    this.current = { id, el };
    void el.play().catch(() => undefined);
    this.fade(el, this.trackVolume(id));
  }

  private trackVolume(id: string): number {
    return Math.min(1, (this.config.tracks[id]?.volume ?? 1) * this.volume);
  }

  private fadeOut(el: HTMLAudioElement): void {
    this.fading.add(el);
    this.fade(el, 0, () => {
      el.pause();
      el.src = '';
      this.fading.delete(el);
    });
  }

  /** 音量を fadeSeconds かけて target まで変える */
  private fade(el: HTMLAudioElement, target: number, done?: () => void): void {
    const ms = this.config.fadeSeconds * 1000;
    const from = el.volume;
    const start = performance.now();
    const step = (): void => {
      const k = ms <= 0 ? 1 : Math.min(1, (performance.now() - start) / ms);
      // 途中で音量の設定が変わったら、鳴っている曲は今の設定に合わせる
      const to = this.current?.el === el ? this.trackVolume(this.current.id) : target;
      el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k < 1) window.setTimeout(step, 50);
      else done?.();
    };
    step();
  }
}
