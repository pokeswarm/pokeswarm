const STORAGE_KEY = 'pokeswarm.discoveredDerivations';

/**
 * 一度でも達成した派生（固有技を含む）の記録。派生先の技のキー（PokeAPI の名前）で持つ。
 * 選択画面の「進化できる！」は、ここに記録された派生だけに出す。
 * セーブデータ（フェーズ2）ができるまでは、ブラウザに仮に保存する（消えても遊べる）。
 */
export class Discoveries {
  private readonly set: Set<string>;

  constructor() {
    this.set = new Set(Discoveries.read());
  }

  get all(): ReadonlySet<string> {
    return this.set;
  }

  add(moveKey: string): void {
    if (this.set.has(moveKey)) return;
    this.set.add(moveKey);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.set]));
    } catch {
      // 保存できない環境（プライベートブラウズなど）では、このラン中だけ覚えておく
    }
  }

  private static read(): string[] {
    try {
      const v: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }
}
