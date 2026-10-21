import type { SfxConfig, SfxPart } from '../data/schema';

/**
 * 8bit 風の効果音をコードで鳴らす（作者の決定: 効果音はファイルを使わない）。
 * 音ごとの部品（矩形波・三角波・のこぎり波・雑音、音の高さの動き、長さ、遅れ）は data/audio/sfx.json に書く。
 * 同じ音を続けて鳴らす間隔と、同時に鳴る数を絞って、たくさん倒しても音が割れないようにする。
 */
export class Synth {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly pulses = new Map<number, PeriodicWave>();
  private readonly lastPlayed = new Map<string, number>();
  private voices = 0;

  constructor(private readonly config: SfxConfig) {}

  /** ブラウザの決まりで、最初のクリックかキーの後でないと音を鳴らせない。そのときに呼ぶ */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.out = this.ctx.createGain();
    this.out.connect(this.ctx.destination);
  }

  setVolume(volume: number): void {
    if (this.out && this.ctx) this.out.gain.setValueAtTime(volume * this.config.volume, this.ctx.currentTime);
  }

  /**
   * 音を鳴らす。semitones で音の高さをずらし（経験値の玉を続けて拾うと上がる）、delay 秒後に鳴らす
   * （ふしぎなアメの連続レベルアップ）
   */
  play(id: string, opts: { semitones?: number; delay?: number } = {}): void {
    const ctx = this.ctx;
    const sound = this.config.sounds[id];
    if (!ctx || !this.out || !sound || ctx.state !== 'running') return;
    const now = performance.now() + (opts.delay ?? 0) * 1000;
    const last = this.lastPlayed.get(id) ?? -Infinity;
    if (now - last < sound.minIntervalMs) return;
    if (this.voices >= this.config.maxVoices) return;
    this.lastPlayed.set(id, now);
    const ratio = Math.pow(2, (opts.semitones ?? 0) / 12);
    const start = ctx.currentTime + (opts.delay ?? 0);
    let end = start;
    for (const part of sound.parts) end = Math.max(end, this.playPart(ctx, part, start, ratio));
    this.voices++;
    window.setTimeout(() => this.voices--, (end - ctx.currentTime) * 1000 + 20);
  }

  /** 部品を1つ鳴らし、鳴り終わる時刻を返す */
  private playPart(ctx: AudioContext, part: SfxPart, start: number, ratio: number): number {
    const t0 = start + part.delay;
    const t1 = t0 + part.duration;
    const gain = ctx.createGain();
    // 立ち上がりをわずかにつけて、プツッという音を防ぐ
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(part.volume, t0 + 0.004);
    gain.gain.linearRampToValueAtTime(0, t1);
    gain.connect(this.out!);
    let source: AudioScheduledSourceNode;
    if (part.wave === 'noise') {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer(ctx);
      src.loop = true;
      // 雑音は from の周波数より上を削って、音の高さの感じを出す
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(part.from * ratio, t0);
      if (part.to) filter.frequency.exponentialRampToValueAtTime(part.to * ratio, t1);
      src.connect(filter).connect(gain);
      source = src;
    } else {
      const osc = ctx.createOscillator();
      if (part.wave === 'square') osc.setPeriodicWave(this.pulse(ctx, part.duty));
      else osc.type = part.wave;
      osc.frequency.setValueAtTime(part.from * ratio, t0);
      if (part.to) osc.frequency.exponentialRampToValueAtTime(part.to * ratio, t1);
      osc.connect(gain);
      source = osc;
    }
    source.start(t0);
    source.stop(t1 + 0.02);
    source.onended = () => gain.disconnect();
    return t1;
  }

  /** 幅 duty の矩形波（ファミコンの 12.5%・25%・50% の音色） */
  private pulse(ctx: AudioContext, duty: number): PeriodicWave {
    let wave = this.pulses.get(duty);
    if (!wave) {
      const n = 64;
      const real = new Float32Array(n);
      const imag = new Float32Array(n);
      for (let k = 1; k < n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
      wave = ctx.createPeriodicWave(real, imag);
      this.pulses.set(duty, wave);
    }
    return wave;
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noise) {
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }
}
