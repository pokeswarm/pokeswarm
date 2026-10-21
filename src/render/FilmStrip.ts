import Phaser from 'phaser';

/** フィルムのコマに入れるもの: ドット絵の画像（アイコンなど）か、作る関数（ポケモンのスプライトなど） */
export type FilmEntry = { texture: string; scale: number } | { make: (scene: Phaser.Scene) => Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform };

/**
 * 映写機のフィルムのように、コマが一列に流れていく帯（タイトル画面の演出。作者の案 2026年10月22日）。
 * 画面の真ん中を通る斜めの帯に、黒いコマと上下の送り穴を描き、中身（ポケモン・技・持ち物のアイコン）を順に流す。
 * 画面の外へ出たコマは反対の端へ回し、次の中身に入れ替える
 */
export class FilmStrip {
  private readonly root: Phaser.GameObjects.Container;
  private readonly cells: { box: Phaser.GameObjects.Container; content: Phaser.GameObjects.GameObject | null }[] = [];
  private next = 0;
  private length = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly entries: FilmEntry[],
    private readonly opts: {
      /** 帯の傾き（度） */
      angle: number;
      /** 流れる速さ（px/秒。マイナスで逆向き） */
      speed: number;
      /** 画面の真ん中からの、帯に垂直な方向のずれ（px） */
      offset: number;
      /** 1コマの幅と、帯の高さ */
      cell: number;
      height: number;
      depth: number;
      alpha: number;
    },
  ) {
    this.root = scene.add.container(0, 0).setDepth(opts.depth).setAlpha(opts.alpha).setAngle(opts.angle);
    this.layout();
  }

  /** 画面の大きさに合わせて、コマを並べ直す */
  layout(): void {
    const { width, height } = this.scene.scale;
    const o = this.opts;
    const rad = (o.angle * Math.PI) / 180;
    this.root.setPosition(width / 2 - Math.sin(rad) * o.offset, height / 2 + Math.cos(rad) * o.offset);
    this.length = Math.hypot(width, height) + o.cell * 2;
    const n = Math.ceil(this.length / o.cell) + 1;
    for (const c of this.cells) c.box.destroy();
    this.cells.length = 0;
    for (let k = 0; k < n; k++) {
      const box = this.scene.add.container(-this.length / 2 + k * o.cell, 0);
      this.drawFrame(box);
      this.root.add(box);
      const cell = { box, content: null as Phaser.GameObjects.GameObject | null };
      this.cells.push(cell);
      this.fill(cell);
    }
  }

  /** 1コマの枠: 黒い地に、上下の送り穴と、コマの区切り */
  private drawFrame(box: Phaser.GameObjects.Container): void {
    const { cell, height } = this.opts;
    const g = this.scene.add.graphics();
    g.fillStyle(0x101010).fillRect(-cell / 2, -height / 2, cell, height);
    // コマの窓（少し明るい）
    const win = height - 40;
    g.fillStyle(0x202830).fillRect(-cell / 2 + 6, -win / 2, cell - 12, win);
    // 送り穴（上下に2つずつ）
    g.fillStyle(0xe8e8e8);
    for (const sy of [-height / 2 + 6, height / 2 - 14]) {
      for (const sx of [-cell / 4 - 5, cell / 4 - 5]) g.fillRect(sx, sy, 10, 8);
    }
    box.add(g);
  }

  /** コマに次の中身を入れる */
  private fill(cell: { box: Phaser.GameObjects.Container; content: Phaser.GameObjects.GameObject | null }): void {
    cell.content?.destroy();
    cell.content = null;
    if (this.entries.length === 0) return;
    const e = this.entries[this.next++ % this.entries.length]!;
    const obj = 'texture' in e ? this.scene.add.image(0, 0, e.texture).setScale(e.scale) : e.make(this.scene);
    obj.setPosition(0, 0);
    cell.box.add(obj);
    cell.content = obj;
  }

  update(deltaMs: number): void {
    const o = this.opts;
    const dx = (o.speed * deltaMs) / 1000;
    const span = this.cells.length * o.cell;
    for (const c of this.cells) {
      c.box.x += dx;
      // 画面の外へ出たコマは反対の端へ回して、中身を入れ替える
      if (o.speed < 0 && c.box.x < -this.length / 2 - o.cell) {
        c.box.x += span;
        this.fill(c);
      } else if (o.speed > 0 && c.box.x > this.length / 2 + o.cell) {
        c.box.x -= span;
        this.fill(c);
      }
    }
  }

  destroy(): void {
    this.root.destroy();
  }
}
