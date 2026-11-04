import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';
import type { SpriteAnims } from '../../data/schema';
import type { EnemyStore } from '../../sim/entities/enemies';
import { EnemySprites } from './EnemySprites';

/** 動作の切り替え（07 の195.1章）: コマ数の違う動作へ切り替えるとき、新しい動作のコマ数を超えて始めない（超えると Phaser が止まる） */
describe('EnemySprites の動作の切り替え', () => {
  it('10 コマの動作の 8 コマ目から 4 コマの動作へ切り替えても、4 コマ以内から始める', () => {
    const plays: { key: string; startFrame?: number }[] = [];
    let current = 'x';
    let index = 8;
    const sprite = {
      anims: {
        get currentAnim() {
          return { key: current };
        },
        get currentFrame() {
          return { index };
        },
      },
      setDepth: () => sprite,
      setScale: () => sprite,
      setVisible: () => sprite,
      setPosition: () => sprite,
      setAlpha: () => sprite,
      clearTint: () => sprite,
      setTint: () => sprite,
      stop: () => sprite,
      play(cfg: { key: string; startFrame?: number }) {
        plays.push(cfg);
        current = cfg.key;
        return sprite;
      },
    };
    const scene = { add: { sprite: () => sprite }, time: { now: 0 } } as unknown as Phaser.Scene;
    const anim = (n: number) => ({ source: 'a', frameWidth: 1, frameHeight: 1, durations: Array.from({ length: n }, () => 1), frameKeyPrefix: 'a' });
    const manifest = { key: 'k', animations: { Walk: anim(4), Charge: anim(10) } } as unknown as SpriteAnims;
    const view = new EnemySprites(scene, () => manifest, 1, 'Walk', 0);
    const store = { count: 1, hp: [1], maxHp: [1], kind: [0], id: [7], x: [0], y: [0], prevX: [0], prevY: [0], radius: [10] } as unknown as EnemyStore;
    const area = { left: -100, top: -100, right: 100, bottom: 100 };
    view.update(store, 1, area, () => null, () => ({ anim: 'Charge', spin: false }));
    index = 9;
    view.update(store, 1, area, () => null, () => null);
    const last = plays.at(-1)!;
    expect(last.key).toContain('Walk');
    expect(last.startFrame).toBeLessThanOrEqual(3);
  });
});
