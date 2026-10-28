import Phaser from 'phaser';
import type { Axis } from '../sim/commands';

/** キーボードの状態を移動方向に変換する（WASD / 矢印キー） */
export class KeyboardInput {
  private readonly keys: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;

  constructor(scene: Phaser.Scene) {
    const kb = scene.input.keyboard;
    if (!kb) throw new Error('キーボード入力が使えません');
    const K = Phaser.Input.Keyboard.KeyCodes;
    // キーを横取り（capture）しない: 横取りはゲーム全体に残り、ランの後のフレンドの名前の入力などで w・a・s・d が打てなくなった（作者の報告 2026年10月29日）
    this.keys = kb.addKeys(
      {
        up: K.UP,
        down: K.DOWN,
        left: K.LEFT,
        right: K.RIGHT,
        w: K.W,
        a: K.A,
        s: K.S,
        d: K.D,
      },
      false,
    ) as KeyboardInput['keys'];
  }

  read(): { dx: Axis; dy: Axis } {
    const k = this.keys;
    const left = k.left.isDown || k.a.isDown;
    const right = k.right.isDown || k.d.isDown;
    const up = k.up.isDown || k.w.isDown;
    const down = k.down.isDown || k.s.isDown;
    return {
      dx: ((right ? 1 : 0) - (left ? 1 : 0)) as Axis,
      dy: ((down ? 1 : 0) - (up ? 1 : 0)) as Axis,
    };
  }
}
