import type { SaveStore } from './saveStore';

/** セーブデータができる前に、ブラウザに仮に保存していた場所 */
const OLD_KEY = 'pokeswarm.discoveredDerivations';

/**
 * 派生（固有技を含む）を達成したことを記録する。派生先の技のキー（PokeAPI の名前）で持つ。
 * 選択画面の「おや……？」は、ここに記録された派生だけに出す。
 */
export function addDiscovery(store: SaveStore, moveKey: string): void {
  if (store.current.discoveries.includes(moveKey)) return;
  store.update((d) => {
    d.discoveries.push(moveKey);
  });
}

/** 以前ブラウザに仮に保存していた記録を、セーブデータへ移す（1回だけ） */
export function migrateOldDiscoveries(store: SaveStore): void {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(OLD_KEY) ?? 'null');
    if (!Array.isArray(raw)) return;
    for (const key of raw) if (typeof key === 'string') addDiscovery(store, key);
    localStorage.removeItem(OLD_KEY);
  } catch {
    // 読めなければ移さない（消えても遊べる記録）
  }
}
