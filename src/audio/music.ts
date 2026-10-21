import type { MusicScore } from '../data/schema';

/** 楽譜の中の1つの音（曲の始めからの秒数） */
export interface MusicNote {
  readonly channel: string;
  readonly time: number;
  readonly duration: number;
  /** 音の高さ（Hz）。ドラムは 0 */
  readonly freq: number;
  /** ドラムの種類（k・s・h）。音符なら null */
  readonly drum: string | null;
}

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C4"・"F#5"・"Bb3" を周波数にする（A4 = 440Hz） */
export function noteFrequency(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`音符 ${name} が読めません`);
  const semitone = NOTE_INDEX[m[1]!]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const midi = (Number(m[3]) + 1) * 12 + semitone;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** 楽譜を、鳴らす音の一覧と1周の長さ（秒）にする */
export function parseScore(score: MusicScore): { notes: MusicNote[]; length: number } {
  const step = 60 / score.bpm / score.stepsPerBeat;
  const notes: MusicNote[] = [];
  let offset = 0;
  for (const name of score.order) {
    const pattern = score.patterns[name];
    if (!pattern) throw new Error(`パターン ${name} がありません`);
    let steps = 0;
    for (const [channel, text] of Object.entries(pattern)) {
      const tokens = text.trim().split(/\s+/);
      steps = Math.max(steps, tokens.length);
      const drums = score.channels[channel]?.wave === 'noise';
      let open: { start: number; freq: number; drum: string | null } | null = null;
      const close = (end: number): void => {
        if (open) notes.push({ channel, time: offset + open.start * step, duration: (end - open.start) * step, freq: open.freq, drum: open.drum });
        open = null;
      };
      tokens.forEach((tok, i) => {
        if (tok === '-') return;
        close(i);
        if (tok === '.') return;
        open = drums ? { start: i, freq: 0, drum: tok } : { start: i, freq: noteFrequency(tok), drum: null };
      });
      close(tokens.length);
    }
    offset += steps * step;
  }
  notes.sort((a, b) => a.time - b.time);
  return { notes, length: offset };
}

/** 先読みして予約する長さ（秒）と、予約する間隔（ミリ秒） */
const LOOKAHEAD = 0.25;
const TICK_MS = 50;

/**
 * 楽譜の曲を Web Audio で鳴らし続ける（ループ）。少し先までの音を予約していく。
 * 音量（BGM の設定・曲の音量・切り替えのフェード）は out のゲインで変える
 */
export class MusicPlayer {
  private readonly out: GainNode;
  private readonly notes: MusicNote[];
  private readonly length: number;
  private readonly start: number;
  private next = 0;
  private loop = 0;
  private timer: number | null = null;
  private noise: AudioBuffer | null = null;

  constructor(
    private readonly ctx: AudioContext,
    private readonly score: MusicScore,
    destination: AudioNode,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(destination);
    const parsed = parseScore(score);
    this.notes = parsed.notes;
    this.length = parsed.length;
    this.start = ctx.currentTime + 0.05;
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
  }

  /** 音量を seconds かけて volume にする */
  fadeTo(volume: number, seconds: number): void {
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(volume, t + Math.max(0.01, seconds));
  }

  /** 小さくしてから止める */
  stop(seconds: number): void {
    this.fadeTo(0, seconds);
    window.setTimeout(() => {
      if (this.timer !== null) window.clearInterval(this.timer);
      this.timer = null;
      this.out.disconnect();
    }, seconds * 1000 + 100);
  }

  private schedule(): void {
    const until = this.ctx.currentTime + LOOKAHEAD;
    for (;;) {
      if (this.next >= this.notes.length) {
        this.next = 0;
        this.loop++;
      }
      const note = this.notes[this.next]!;
      const t = this.start + this.loop * this.length + note.time;
      if (t > until) break;
      if (t >= this.ctx.currentTime - 0.01) this.play(note, t);
      this.next++;
    }
  }

  private play(note: MusicNote, t: number): void {
    const ch = this.score.channels[note.channel];
    if (!ch) return;
    const gain = this.ctx.createGain();
    gain.connect(this.out);
    if (note.drum) {
      this.playDrum(note.drum, t, ch.volume, gain);
      return;
    }
    // 音の終わりを少し短くして、同じ高さが続いても区切りが聞こえるようにする
    const end = t + note.duration * 0.92;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(ch.volume, t + 0.005);
    gain.gain.setValueAtTime(ch.volume, Math.max(t + 0.005, end - 0.02));
    gain.gain.linearRampToValueAtTime(0, end);
    const osc = this.ctx.createOscillator();
    if (ch.wave === 'square') osc.setPeriodicWave(pulseWave(this.ctx, ch.duty));
    else osc.type = ch.wave === 'noise' ? 'square' : ch.wave;
    osc.frequency.setValueAtTime(note.freq, t);
    osc.connect(gain);
    osc.start(t);
    osc.stop(end + 0.02);
    osc.onended = () => gain.disconnect();
  }

  /** ドラム: k は低く下がる音、s は雑音、h は短く高い雑音 */
  private playDrum(kind: string, t: number, volume: number, gain: GainNode): void {
    if (kind === 'k') {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      gain.gain.setValueAtTime(volume * 3, t);
      gain.gain.linearRampToValueAtTime(0, t + 0.14);
      osc.connect(gain);
      osc.start(t);
      osc.stop(t + 0.16);
      osc.onended = () => gain.disconnect();
      return;
    }
    const len = kind === 's' ? 0.12 : 0.04;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    const filter = this.ctx.createBiquadFilter();
    filter.type = kind === 's' ? 'bandpass' : 'highpass';
    filter.frequency.value = kind === 's' ? 1800 : 7000;
    gain.gain.setValueAtTime(volume * (kind === 's' ? 1.6 : 0.8), t);
    gain.gain.linearRampToValueAtTime(0, t + len);
    src.connect(filter).connect(gain);
    src.start(t);
    src.stop(t + len + 0.02);
    src.onended = () => gain.disconnect();
  }

  private noiseBuffer(): AudioBuffer {
    if (!this.noise) {
      this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }
}

const pulses = new WeakMap<AudioContext, Map<number, PeriodicWave>>();

/** 幅 duty の矩形波（ファミコンの 12.5%・25%・50% の音色） */
export function pulseWave(ctx: AudioContext, duty: number): PeriodicWave {
  let byDuty = pulses.get(ctx);
  if (!byDuty) {
    byDuty = new Map();
    pulses.set(ctx, byDuty);
  }
  let wave = byDuty.get(duty);
  if (!wave) {
    const n = 64;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    wave = ctx.createPeriodicWave(real, imag);
    byDuty.set(duty, wave);
  }
  return wave;
}
