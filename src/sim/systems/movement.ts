import type { World } from '../world';

export function movePlayers(world: World): void {
  for (const p of world.players) {
    p.prevX = p.x;
    p.prevY = p.y;
    if (p.invincibleTicks > 0) p.invincibleTicks--;
    if (p.remote) {
      // 別のブラウザのプレイヤーは、本人から届いた位置をそのまま使う
      p.x = p.netX;
      p.y = p.netY;
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
