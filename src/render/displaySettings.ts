/**
 * 表示の設定（ダメージの数字など）。音量の設定と同じく、ブラウザに保存する（ほかの人には関係ないので Firestore には書かない）。
 * 保存できない環境（プライベートウィンドウなど）では、その場かぎりの設定として動く。
 */
export interface DisplaySettings {
  /** 自分の攻撃のダメージの数字を敵の上に出す（作者の決定 2026年10月28日: 初めは出さない） */
  damageNumbers: boolean;
}

const KEY = 'pokeswarm.display';
const DEFAULTS: DisplaySettings = { damageNumbers: false };

class DisplaySettingsStore {
  private value: DisplaySettings = { ...DEFAULTS };

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.value = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<DisplaySettings>) };
    } catch {
      // 読めなければ初期値
    }
  }

  get current(): Readonly<DisplaySettings> {
    return this.value;
  }

  update(change: Partial<DisplaySettings>): void {
    this.value = { ...this.value, ...change };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value));
    } catch {
      // 保存できなくても、その場では効かせる
    }
  }
}

export const displaySettings = new DisplaySettingsStore();
