import type { PlayerId } from '../commands';
import { findEnemyIndex, type ItemKind, type World } from '../world';
import { healPlayer } from './health';
import { addXp, recomputeModifiers } from './leveling';

/**
 * マップに落ちる道具（作者の提案。2026年10月）:
 * - きずぐすり: 拾った人の HP を回復する（回復の手段は、基本的にこれだけにする）
 * - マグネット: マップ上の経験値の玉をすべて一気に吸い寄せる
 * - ふしぎなアメ: 中ボスが落とす。拾うと 1・3・5 レベルのどれかを抽選し、少し待ってから確定でレベルアップする
 * 落とすのと、拾ったかの確定（アメの抽選も）はソロ・ホスト。触れたかは自分のブラウザで判定する（経験値の玉と同じ）。
 */
export const ITEM_KINDS: readonly ItemKind[] = ['potion', 'magnet', 'rare-candy', 'buff'];

/** 倒した敵の場所に道具を落とす（雑魚はまれに、中ボスは決まった道具）。倒れた敵が取り除かれる前に呼ぶ */
export function dropItems(world: World): void {
  if (world.role === 'guest') return;
  const cfg = world.rules.pickups.items;
  for (const ev of world.events) {
    if (ev.type !== 'enemyKilled') continue;
    const kind = world.rules.enemies.kinds[ev.kind];
    const i = findEnemyIndex(world, ev.enemyId);
    if (!kind || i === -1) continue;
    let item: ItemKind | null = kind.drop ?? null;
    if (!item && (kind.rank ?? 'normal') === 'normal') {
      const r = world.rng.next();
      if (r < cfg.potion.dropChance) item = 'potion';
      else if (r < cfg.potion.dropChance + cfg.magnet.dropChance) item = 'magnet';
    }
    if (item) spawnItem(world, world.nextItemId++, item, world.enemies.x[i]!, world.enemies.y[i]!);
  }
}

export function spawnItem(world: World, id: number, kind: ItemKind, x: number, y: number): void {
  if (world.items.length >= world.rules.pickups.maxItems) return;
  world.items.push({ id, kind, x, y, pending: false });
  world.events.push({ type: 'itemSpawned', id, kind, x, y });
}

/** 自分が触れた道具を拾う。ソロ・ホストはその場で確定し、ゲストは自分の画面で消して見せてホストへ伝える */
export function collectItems(world: World): void {
  const me = world.players.find((p) => p.id === world.localPlayerId);
  if (!me || me.down) return;
  const r = me.radius + world.rules.pickups.itemRadius;
  for (const it of [...world.items]) {
    if (it.pending || (it.x - me.x) ** 2 + (it.y - me.y) ** 2 > r * r) continue;
    if (world.role === 'guest') {
      it.pending = true;
      world.events.push({ type: 'itemRequested', id: it.id, by: me.id });
    } else {
      confirmItem(world, it.id, me.id);
    }
  }
}

/** ホスト（ソロ）: 道具の取得を確定する（先着）。アメはここでレベルの数を抽選する */
export function confirmItem(world: World, id: number, by: PlayerId): void {
  const k = world.items.findIndex((x) => x.id === id);
  if (k === -1) return;
  const it = world.items[k]!;
  // アメはレベルの数、箱の強化はどの強化か（items.buff.buffs の番号）を抽選する
  const levels = it.kind === 'rare-candy' ? rollCandy(world, world.players.find((p) => p.id === by)?.candyWeight ?? 0) : it.kind === 'buff' ? rollBuff(world) : 0;
  applyItem(world, id, by, it.kind, levels);
}

/** 箱の強化を、重みで1つ選ぶ（番号） */
function rollBuff(world: World): number {
  const buffs = world.rules.pickups.items.buff?.buffs ?? [];
  let r = world.rng.next() * buffs.reduce((s, b) => s + b.weight, 0);
  for (let k = 0; k < buffs.length; k++) if ((r -= buffs[k]!.weight) < 0) return k;
  return Math.max(0, buffs.length - 1);
}

/** アメの当たりを引く。bonus は、拾った人の +2 以上の当たりの重みに足す（実績の報酬） */
function rollCandy(world: World, bonus: number): number {
  const table = world.rules.pickups.items['rare-candy'].levels.map((x) => ({ ...x, weight: x.weight + (x.levels > 1 ? bonus : 0) }));
  const total = table.reduce((s, x) => s + x.weight, 0);
  let r = world.rng.next() * total;
  for (const x of table) {
    if ((r -= x.weight) < 0) return x.levels;
  }
  return table[table.length - 1]!.levels;
}

/** 取得が確定した道具の効果（全員のブラウザで同じように当てはめる） */
export function applyItem(world: World, id: number, by: PlayerId, kind: ItemKind, levels: number): void {
  const k = world.items.findIndex((x) => x.id === id);
  if (k !== -1) world.items.splice(k, 1);
  const cfg = world.rules.pickups.items;
  if (kind === 'potion') {
    // HP は本人のブラウザで管理する（ほかの人の分は本人の画面で回復する）
    const p = world.players.find((x) => x.id === by);
    if (p) healPlayer(world, by, (p.maxHp * cfg.potion.healPct) / 100);
  } else if (kind === 'magnet') {
    // すべての玉を、速く吸い寄せる（2 = マグネット）
    const g = world.gems;
    for (let i = 0; i < g.count; i++) if (!g.pending[i]) g.attracted[i] = 2;
  } else if (kind === 'buff') {
    // 箱の強化: 拾った人に、決まった時間だけ効く（同じ強化を重ねて拾ったら時間を延ばす）
    const p = world.players.find((x) => x.id === by);
    const def = cfg.buff?.buffs[levels];
    if (p && def) {
      const ticks = Math.round(def.seconds / world.dt);
      const buffs = (p.buffs ??= []);
      const cur = buffs.find((b) => b.index === levels);
      if (cur) cur.ticksLeft = Math.max(cur.ticksLeft, ticks);
      else buffs.push({ index: levels, ticksLeft: ticks, totalTicks: ticks });
      recomputeModifiers(world, p);
    }
  } else {
    world.candies.push({ levels, ticksLeft: Math.round((cfg['rare-candy'].revealSeconds + cfg['rare-candy'].holdSeconds) / world.dt), by });
  }
  world.events.push({ type: 'itemCollected', id, by, kind, levels });
}

/** ふしぎなアメ: 抽選の演出の時間が過ぎたら、確定でレベルを上げる（選択は続けて出る） */
export function tickCandies(world: World): void {
  for (let c = world.candies.length - 1; c >= 0; c--) {
    const candy = world.candies[c]!;
    if (--candy.ticksLeft > 0) continue;
    world.candies.splice(c, 1);
    addLevels(world, candy.levels);
  }
}

/** n レベル上げる（そのレベルの残りの経験値を足すのを n 回） */
export function addLevels(world: World, n: number): void {
  const table = world.rules.leveling.xpToNext;
  for (let k = 0; k < n && world.level < world.rules.leveling.maxLevel; k++) {
    addXp(world, Math.max(0, (table[world.level] ?? 0) - world.xpIntoLevel));
  }
}
