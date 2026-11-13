import Phaser from 'phaser';
import { findEnemyIndex, type World } from '../../sim/world';

/**
 * 色違いのカメックスの技の絵（07 の256章）。見た目だけ（当たりはシミュレーション）:
 * 究極のハイドロカノンで、甲羅にこもったカメックスの甲羅から飛び出す 2 本の砲塔（水流の向きに回る）。水流そのものはプレイヤーの技の絵（recipes の bossActive）
 */
export class ShinyBlastoiseWater {
  private readonly g: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, depth: number) {
    this.g = scene.add.graphics().setDepth(depth);
  }

  update(world: World, alpha: number): void {
    this.g.clear();
    const moves = world.rules.stage.moves;
    // 技ごとに、ボスに結んだ 1 本目と同じ組の 2 本目を集める
    const groups = new Map<number, World['hazards'][number][]>();
    for (const h of world.hazards) {
      const id = moves[h.move]?.id;
      if (id !== 'blastoise-s-ultimate-cw' && id !== 'blastoise-s-ultimate-ccw') continue;
      const key = h.group ?? 0;
      groups.set(key, [...(groups.get(key) ?? []), h]);
    }
    for (const arms of groups.values()) {
      const owner = arms.find((h) => h.dasher !== -1);
      const b = owner ? findEnemyIndex(world, owner.dasher) : -1;
      if (!owner || b === -1) continue;
      const e = world.enemies;
      const bx = e.prevX[b]! + (e.x[b]! - e.prevX[b]!) * alpha;
      const by = e.prevY[b]! + (e.y[b]! - e.prevY[b]!) * alpha;
      // 予告の始めの 0.4 秒で砲塔がせり出す
      const out = owner.activeTicks !== undefined ? 1 : Math.min(1, ((owner.totalTicks - owner.ticksLeft + alpha) * world.dt) / 0.4);
      // 画面の奥（上）を向く砲塔は甲羅の後ろに見えるよう先に、手前を向くものは後に描く
      const sorted = [...arms].sort((p, q) => p.dirY - q.dirY);
      for (const h of sorted) this.drawBarrel(bx, by - 6, h.dirX, h.dirY, e.radius[b]!, out, owner.activeTicks !== undefined);
    }
  }

  /** 砲塔 1 本: 甲羅の縁から外へ突き出す銀色の筒。先は暗い口と、撃っている間は口もとの水しぶき */
  private drawBarrel(x: number, y: number, dx: number, dy: number, r: number, out: number, firing: boolean): void {
    const g = this.g;
    const e = 1 - (1 - out) * (1 - out);
    const from = r * 0.15;
    const to = r * (0.6 + 1.0 * e);
    const w = r * 0.5;
    const x0 = x + dx * from;
    const y0 = y + dy * from;
    const x1 = x + dx * to;
    const y1 = y + dy * to;
    // 影と輪郭
    g.lineStyle(w + 6, 0x263238, 0.9).lineBetween(x0, y0, x1, y1);
    // 筒（銀）と、上側の光
    g.lineStyle(w, 0x9aa7b0, 1).lineBetween(x0, y0, x1, y1);
    const nx = -dy;
    const ny = dx;
    const side = ny < 0 ? 1 : -1;
    g.lineStyle(w * 0.28, 0xdfe7ec, 0.9).lineBetween(x0 + nx * side * w * 0.22, y0 + ny * side * w * 0.22, x1 + nx * side * w * 0.22, y1 + ny * side * w * 0.22);
    // 根元の継ぎ目の輪
    g.lineStyle(3, 0x546e7a, 1).lineBetween(x0 + dx * 6 + nx * w * 0.5, y0 + dy * 6 + ny * w * 0.5, x0 + dx * 6 - nx * w * 0.5, y0 + dy * 6 - ny * w * 0.5);
    // 口: 太い縁と暗い穴
    g.fillStyle(0x37474f, 1).fillCircle(x1, y1, w * 0.62);
    g.fillStyle(0x10171b, 1).fillCircle(x1 + dx * 2, y1 + dy * 2, w * 0.36);
    if (firing) {
      g.fillStyle(0xe1f5fe, 0.85).fillCircle(x1 + dx * w * 0.35, y1 + dy * w * 0.35, w * 0.42);
      g.fillStyle(0x4fc3f7, 0.55).fillCircle(x1 + dx * w * 0.6 + nx * w * 0.3, y1 + dy * w * 0.6 + ny * w * 0.3, w * 0.25);
      g.fillStyle(0x4fc3f7, 0.55).fillCircle(x1 + dx * w * 0.6 - nx * w * 0.3, y1 + dy * w * 0.6 - ny * w * 0.3, w * 0.25);
    }
  }
}
