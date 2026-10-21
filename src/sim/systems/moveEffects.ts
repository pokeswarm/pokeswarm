import type { MoveEffect } from '../../data/schema';
import {
  MOTION_BOOMERANG,
  MOTION_FOLLOW,
  MOTION_LINEAR,
  MOTION_ORBIT,
  SHAPE_CIRCLE,
  SHAPE_LINE,
  type ProjectileSpawn,
} from '../entities/projectiles';
import { hash01 } from '../math';
import { rayLengthToObstacle } from '../obstacles';
import type { World } from '../world';

/**
 * 技の「効き方」の部品（作者の決定「技が進化すると遊びが変わる」。07_content_draft.md 22.4）。
 * 効き方から出す当たり判定は stage 1（さらに効き方を起こさない）。遅れて弾ける印は stage 2。
 * どの部品も、各ブラウザで同じように出す（命中の判定は、ほかの当たり判定と同じく持ち主のブラウザ）。
 * 乱数は使わない（向きは等しい角度に並べる）。
 */

/** 効き方を起こす元: 持ち主・技・威力・大きさ・位置・向き。直線なら長さ */
export interface FxSource {
  owner: number;
  move: number;
  level: number;
  damage: number;
  size: number;
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  length: number;
}

/** 段階 0 の当たり判定・技を使ったときに、trigger の効き方を起こす */
export function fireEffects(world: World, trigger: MoveEffect['trigger'], src: FxSource): void {
  const effects = world.rules.moves[src.move]?.effects;
  if (!effects || effects.length === 0) return;
  effects.forEach((fx, index) => {
    if (fx.trigger !== trigger) return;
    // 確率は共有の乱数ではなく、時刻と位置から決める（どのブラウザでも同じ見た目になる）
    if (fx.chance !== undefined && fx.chance < 1 && hash01(world.seed, world.tick, Math.floor(src.x) * 7919 + Math.floor(src.y), index) >= fx.chance) return;
    applyEffect(world, fx, index, src);
  });
}

function spawn(world: World, src: FxSource, over: Partial<ProjectileSpawn>): void {
  world.projectiles.add({
    owner: src.owner,
    move: src.move,
    level: src.level,
    motion: MOTION_LINEAR,
    x: src.x,
    y: src.y,
    vx: 0,
    vy: 0,
    ox: 0,
    oy: 0,
    angle: 0,
    angularSpeed: 0,
    orbitRadius: 0,
    life: 0.2,
    damage: src.damage,
    radius: src.size,
    pierce: Infinity,
    hitIntervalTicks: 0,
    shape: SHAPE_CIRCLE,
    length: 0,
    dirX: src.dirX,
    dirY: src.dirY,
    growth: 0,
    stage: 1,
    ...over,
  });
}

/** 遅れて弾ける印が消えたときに、その爆発を起こす */
export function fireDelayedExplosion(world: World, index: number, src: FxSource): void {
  const fx = world.rules.moves[src.move]?.effects[index];
  if (!fx?.explode) return;
  // 印の大きさはすでに爆発の大きさなので、もとの大きさに戻して渡す
  explode(world, fx.explode, { ...src, size: src.size / fx.explode.sizeMultiplier });
}

function explode(world: World, ex: NonNullable<MoveEffect['explode']>, src: FxSource): void {
  spawn(world, src, {
    damage: src.damage * ex.powerMultiplier,
    radius: src.size * ex.sizeMultiplier,
    life: 0.2,
    ...(ex.pull ? { knockback: -ex.pull } : {}),
  });
  world.events.push({ type: 'projectileHit', x: src.x, y: src.y, owner: src.owner, move: src.move });
}

function applyEffect(world: World, fx: MoveEffect, index: number, src: FxSource): void {
  const ticks = (s: number): number => Math.max(1, Math.round(s / world.dt));
  const angle0 = Math.atan2(src.dirY, src.dirX);
  if (fx.explode) {
    const ex = fx.explode;
    if (ex.delaySeconds) {
      // 印: 当たらない円を置き（段階 2 は当たりの判定をしない）、消えたときに元の威力・大きさで弾ける
      spawn(world, src, { radius: src.size * ex.sizeMultiplier, life: ex.delaySeconds, stage: 2, fxIndex: index });
    } else {
      explode(world, ex, src);
    }
  }
  if (fx.puddle) {
    const pd = fx.puddle;
    const base = { damage: src.damage * pd.powerMultiplier, radius: src.size * pd.sizeMultiplier, life: pd.durationSeconds, hitIntervalTicks: ticks(pd.hitIntervalSeconds) };
    if (pd.alongSpacing && src.length > 0) {
      for (let d = 0; d <= src.length; d += pd.alongSpacing) spawn(world, src, { ...base, x: src.x + src.dirX * d, y: src.y + src.dirY * d });
    } else {
      spawn(world, src, base);
    }
  }
  if (fx.split) {
    const sp = fx.split;
    const spread = (Math.min(360, sp.spreadDegrees) * Math.PI) / 180;
    for (let k = 0; k < sp.count; k++) {
      // 360° なら等しい角度で一周、それ以外は向きを中心に広げる
      const a = spread >= Math.PI * 2 ? angle0 + (k / sp.count) * Math.PI * 2 : angle0 + (sp.count === 1 ? 0 : (k / (sp.count - 1) - 0.5) * spread);
      const vx = Math.cos(a) * sp.speed;
      const vy = Math.sin(a) * sp.speed;
      spawn(world, src, {
        motion: sp.boomerang ? MOTION_BOOMERANG : MOTION_LINEAR,
        vx,
        vy,
        ox: vx,
        oy: vy,
        damage: src.damage * sp.powerMultiplier,
        radius: src.size * sp.sizeMultiplier,
        life: sp.durationSeconds,
        pierce: 3,
      });
    }
  }
  if (fx.chain) chain(world, fx.chain, src);
  if (fx.orbit) {
    const ob = fx.orbit;
    for (let k = 0; k < ob.count; k++) {
      const a = angle0 + (k / ob.count) * Math.PI * 2;
      spawn(world, src, {
        motion: MOTION_ORBIT,
        x: src.x + Math.cos(a) * ob.radius,
        y: src.y + Math.sin(a) * ob.radius,
        angle: a,
        angularSpeed: (ob.speed * Math.PI) / 180,
        orbitRadius: ob.radius,
        damage: src.damage * ob.powerMultiplier,
        radius: src.size * ob.sizeMultiplier,
        life: ob.durationSeconds,
        hitIntervalTicks: ticks(ob.hitIntervalSeconds),
      });
    }
  }
  if (fx.spikes) {
    const sk = fx.spikes;
    for (let k = 0; k < sk.count; k++) {
      const a = angle0 + (k / sk.count) * Math.PI * 2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      spawn(world, src, {
        shape: SHAPE_LINE,
        length: rayLengthToObstacle(world, src.x, src.y, dx, dy, sk.length),
        dirX: dx,
        dirY: dy,
        damage: src.damage * sk.powerMultiplier,
        radius: src.size * sk.sizeMultiplier,
        life: sk.durationSeconds,
        hitIntervalTicks: ticks(sk.hitIntervalSeconds),
      });
    }
  }
  if (fx.wave) {
    const wv = fx.wave;
    spawn(world, src, {
      // 持ち主の位置から出す波は持ち主に付いていく（ox・oy は 0）。それ以外はその場で広がる
      motion: src.length === 0 && world.players.some((p) => p.id === src.owner && p.x === src.x && p.y === src.y) ? MOTION_FOLLOW : MOTION_LINEAR,
      damage: src.damage * wv.powerMultiplier,
      radius: src.size,
      growth: Math.max(0, (wv.radius - src.size) / wv.durationSeconds),
      life: wv.durationSeconds,
    });
  }
}

/** 連鎖の部品: その場から一番近い敵へ、さらに近くの敵へと count 回飛び移る線 */
function chain(world: World, ch: NonNullable<MoveEffect['chain']>, src: FxSource): void {
  const e = world.enemies;
  let x = src.x;
  let y = src.y;
  const used = new Set<number>();
  for (let k = 0; k < ch.count; k++) {
    const n = world.enemyHash.queryRect(x - ch.range, y - ch.range, x + ch.range, y + ch.range, world.scratch);
    let best = -1;
    let bestD2 = ch.range * ch.range;
    for (let q = 0; q < n; q++) {
      const i = world.scratch[q]!;
      if (e.hp[i]! <= 0 || used.has(e.id[i]!)) continue;
      const d2 = (e.x[i]! - x) ** 2 + (e.y[i]! - y) ** 2;
      // 自分のいる場所の敵（当たった敵）は飛ばす。同じ距離なら id の小さいほう
      if (d2 < 1) {
        used.add(e.id[i]!);
        continue;
      }
      if (d2 < bestD2 || (d2 === bestD2 && best !== -1 && e.id[i]! < e.id[best]!)) {
        bestD2 = d2;
        best = i;
      }
    }
    if (best === -1) break;
    used.add(e.id[best]!);
    const len = Math.sqrt(bestD2) || 1;
    spawn(world, src, {
      x,
      y,
      shape: SHAPE_LINE,
      length: len,
      dirX: (e.x[best]! - x) / len,
      dirY: (e.y[best]! - y) / len,
      damage: src.damage * ch.powerMultiplier,
      radius: src.size * ch.sizeMultiplier,
      life: 0.2,
    });
    x = e.x[best]!;
    y = e.y[best]!;
  }
}
