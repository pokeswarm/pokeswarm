import type { World } from '../world';

export function movePlayers(world: World): void {
  for (const p of world.players) {
    p.prevX = p.x;
    p.prevY = p.y;
    if (p.invincibleTicks > 0) p.invincibleTicks--;
    // 倒れている間は動かない
    if (p.down) continue;
    if (p.remote) {
      // 別のブラウザのプレイヤー: 届いた位置から、押している方向へ少し先まで進んだと予測した位置へなめらかに寄せる
      // （位置は通信の都合でまとまって届くことがあり、そのまま使うとワープして見える）
      const ns = world.rules.netSmoothing;
      const ahead = Math.min(p.netAge, ns.predictTicks) * p.moveSpeed * world.dt * (p.inputX !== 0 && p.inputY !== 0 ? Math.SQRT1_2 : 1);
      const tx = p.netX + p.inputX * ahead;
      const ty = p.netY + p.inputY * ahead;
      p.netAge++;
      const dx = tx - p.x;
      const dy = ty - p.y;
      if (dx * dx + dy * dy > ns.snapDistance * ns.snapDistance) {
        p.x = p.prevX = tx;
        p.y = p.prevY = ty;
      } else {
        p.x += dx * ns.playerBlend;
        p.y += dy * ns.playerBlend;
      }
      continue;
    }
    if (p.inputX === 0 && p.inputY === 0) continue;
    // 斜めは 1/√2 倍。定数を使い、環境で結果が変わる Math 関数は使わない
    const scale = p.inputX !== 0 && p.inputY !== 0 ? Math.SQRT1_2 : 1;
    const step = p.moveSpeed * world.dt * scale;
    p.x += p.inputX * step;
    p.y += p.inputY * step;
    p.facingX = p.inputX;
    p.facingY = p.inputY;
  }
}
