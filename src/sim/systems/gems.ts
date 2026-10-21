import type { PlayerId } from '../commands';
import { currentWaveIndex, findEnemyIndex, type World } from '../world';
import { addXp } from './leveling';

/**
 * 倒した敵の場所に経験値の玉を落とす（ソロ・ホストだけ。ゲストはホストから受け取る）。
 * 玉が上限に達していたら、新しい玉を作らずに、倒した場所に一番近い玉へ経験値をまとめる
 * （一番古い玉にまとめると、遠くの拾わない玉にたまり続け、経験値が出なくなったように見えるため）。
 * 倒れた敵はこの更新の最後に取り除かれるので、それより前に呼ぶ。
 */
export function dropGems(world: World): void {
  if (world.role === 'guest') return;
  const { gems, enemies: e } = world;
  const p = world.rules.pickups;
  // 協力プレイでは雑魚1体の経験値を人数に応じて減らす（倒す数が増えても、レベルの上がる速さがソロから大きく離れないように）
  const share = 1 / (1 + (world.rules.spawn.perExtraPlayer.xpSharePct * Math.max(0, world.players.length - 1)) / 100);
  const waveXp = world.waves[currentWaveIndex(world)]!.xpMultiplier * share;
  for (const ev of world.events) {
    if (ev.type !== 'enemyKilled') continue;
    const i = findEnemyIndex(world, ev.enemyId);
    if (i === -1) continue;
    // 経験値: 種類ごとの値（省略時は xpPerKill）。雑魚には時間帯の倍率を掛ける
    const kind = world.rules.enemies.kinds[e.kind[i]!];
    const value = (kind?.xp ?? p.xpPerKill) * ((kind?.rank ?? 'normal') === 'normal' ? waveXp : 1);
    if (value <= 0) continue;
    if (gems.count >= gems.capacity) {
      const g = gems.nearest(e.x[i]!, e.y[i]!);
      if (g === -1) continue;
      gems.value[g]! += value;
      world.events.push({ type: 'gemMerged', id: gems.id[g]!, value: gems.value[g]! });
      continue;
    }
    const id = world.nextGemId++;
    gems.add(id, e.x[i]!, e.y[i]!, value, p.gemRadius);
    world.events.push({ type: 'gemSpawned', id, x: e.x[i]!, y: e.y[i]!, value });
  }
}

/** 取得範囲に入った玉を、一番近いプレイヤーへ吸い寄せる（各ブラウザで計算する。見た目と触れる判定のため） */
export function moveGems(world: World): void {
  const { gems, players } = world;
  const speed = world.rules.pickups.magnetSpeed * world.dt;
  // マグネットの道具で吸い寄せられている玉（attracted 2）は速く、どれだけ遠くからでも来る
  const fast = world.rules.pickups.items.magnet.speed * world.dt;
  for (let i = 0; i < gems.count; i++) {
    gems.prevX[i] = gems.x[i]!;
    gems.prevY[i] = gems.y[i]!;
    if (gems.pending[i]) continue;
    let best = Infinity;
    let tx = 0;
    let ty = 0;
    for (const p of players) {
      const dx = p.x - gems.x[i]!;
      const dy = p.y - gems.y[i]!;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) {
        best = d2;
        tx = p.x;
        ty = p.y;
      }
      if (!gems.attracted[i] && d2 <= p.pickupRange * p.pickupRange) gems.attracted[i] = 1;
    }
    if (!gems.attracted[i] || best === Infinity || best === 0) continue;
    const d = Math.sqrt(best);
    const step = Math.min(gems.attracted[i] === 2 ? fast : speed, d);
    gems.x[i]! += ((tx - gems.x[i]!) / d) * step;
    gems.y[i]! += ((ty - gems.y[i]!) / d) * step;
  }
}

/**
 * 自分のプレイヤーが触れた玉を拾う。触れたかは自分のブラウザで判定する。
 * ソロ・ホストはその場で確定し、ゲストは自分の画面で消して見せてホストへ伝える。
 */
export function collectGems(world: World): void {
  const { gems } = world;
  const me = world.players.find((p) => p.id === world.localPlayerId);
  if (!me) return;
  const r = me.radius + world.rules.pickups.gemRadius;
  for (let i = gems.count - 1; i >= 0; i--) {
    if (gems.pending[i]) continue;
    const dx = gems.x[i]! - me.x;
    const dy = gems.y[i]! - me.y;
    if (dx * dx + dy * dy > r * r) continue;
    if (world.role === 'guest') {
      gems.pending[i] = 1;
      world.events.push({ type: 'pickupRequested', id: gems.id[i]!, by: me.id });
    } else {
      confirmPickup(world, gems.id[i]!, me.id);
    }
  }
}

/** ホスト（ソロ）: 玉の取得を確定する。すでに無ければ（先に誰かが拾った）何もしない */
export function confirmPickup(world: World, id: number, by: PlayerId): boolean {
  const g = world.gems.indexOf(id);
  if (g === -1) return false;
  const collector = world.players.find((p) => p.id === by);
  // 拾ったプレイヤーの経験値アップ（しあわせタマゴなど）を掛ける
  const value = world.gems.value[g]! * (1 + (collector?.mods.xpPct ?? 0) / 100);
  world.gems.removeAt(g);
  addXp(world, value);
  world.events.push({ type: 'gemCollected', id, by, value });
  return true;
}
