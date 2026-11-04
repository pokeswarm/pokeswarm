import { abilityMoveSpeedFactor } from '../ability';
import type { World } from '../world';

export function movePlayers(world: World): void {
  for (const p of world.players) {
    p.prevX = p.x;
    p.prevY = p.y;
    if (p.invincibleTicks > 0) p.invincibleTicks--;
    if (p.recoverTicks) p.recoverTicks--;
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
    // ボスの技で押し飛ばされている間（ほえる・あてみなげ。07 の167章）: 瞬間移動させず、短くすべらせる。入力では動けない
    if (p.pushTicks) {
      p.pushTicks--;
      p.x += (p.pushVx ?? 0) * world.dt;
      p.y += (p.pushVy ?? 0) * world.dt;
      continue;
    }
    // 体が動く技で進んでいる間（のしかかり・すてみタックル。07 の177章）: 入力では動けない
    if (p.dashTicks) {
      p.dashTicks--;
      p.x += (p.dashVx ?? 0) * world.dt;
      p.y += (p.dashVy ?? 0) * world.dt;
      continue;
    }
    // 技の反動で動けない間（ギガインパクト）
    if (p.recoverTicks) continue;
    // 泣いている間（トゲピー）は動けない
    if (p.cryTicks) {
      p.cryTicks--;
      continue;
    }
    if (p.inputX === 0 && p.inputY === 0) continue;
    // ねむる（カビゴン）の起きる動きの間は動けない（眠っているときに動こうとすると、起きる動きが始まる）
    if (p.sleep && (p.sleep.asleep || p.sleep.wakeTicks > 0)) continue;
    // 凍っている間（伝説戦のぜったいれいど）は動けない
    if (p.frozenTicks) continue;
    // 斜めは 1/√2 倍。定数を使い、環境で結果が変わる Math 関数は使わない
    const scale = p.inputX !== 0 && p.inputY !== 0 ? Math.SQRT1_2 : 1;
    // 凍った床の上は遅くなる（伝説の範囲技が残したもの）
    // すいすい: あめの間は速い（特性。07 の133章）
    // ねむけ（ボスの うたう・さいみんじゅつ など。07 の167章）: 遅くなる
    const drowsy = p.drowsyTicks ? 1 - (world.rules.stage.bossRules.drowsySlowPct ?? 55) / 100 : 1;
    const step = p.moveSpeed * world.dt * scale * (1 - (p.zoneSlowPct ?? 0) / 100) * abilityMoveSpeedFactor(world, p) * drowsy;
    p.x += p.inputX * step;
    p.y += p.inputY * step;
    p.walked += step;
    // トゲピー: 歩いた距離 everyDistance ごとに止まって泣く（07 の66.4）
    const cry = world.rules.lines?.[p.line]?.cry;
    if (cry && cry.forms.includes(p.species)) {
      p.cryWalked = (p.cryWalked ?? 0) + step;
      if (p.cryWalked >= cry.everyDistance) {
        p.cryWalked -= cry.everyDistance;
        p.cryTicks = Math.round(cry.seconds / world.dt);
        world.events.push({ type: 'cried', playerId: p.id });
      }
    }
    p.facingX = p.inputX;
    p.facingY = p.inputY;
  }
}
