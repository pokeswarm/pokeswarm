/**
 * 音量の設定（全体・BGM・効果音・ミュート）。ブラウザに保存する（ほかの人には関係ないので Firestore には書かない）。
 * 保存できない環境（プライベートウィンドウなど）では、その場かぎりの設定として動く。
 */
export interface AudioSettings {
  master: number;
  bgm: number;
  sfx: number;
  muted: boolean;
}

const KEY = 'pokeswarm.audio';
const DEFAULTS: AudioSettings = { master: 0.8, bgm: 0.6, sfx: 0.8, muted: false };

export class AudioSettingsStore {
  private value: AudioSettings;
  private readonly listeners = new Set<() => void>();

  constructor() {
    this.value = { ...DEFAULTS };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.value = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AudioSettings>) };
    } catch {
      // 読めなければ初期値
    }
  }

  get current(): Readonly<AudioSettings> {
    return this.value;
  }

  update(change: Partial<AudioSettings>): void {
    this.value = { ...this.value, ...change };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value));
    } catch {
      // 保存できなくても、その場では効かせる
    }
    for (const fn of this.listeners) fn();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 効果音・BGM の実際の音量（ミュートなら 0） */
  volumeOf(kind: 'sfx' | 'bgm'): number {
    const v = this.value;
    return v.muted ? 0 : v.master * v[kind];
  }
}
