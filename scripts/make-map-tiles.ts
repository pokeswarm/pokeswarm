/**
 * マップの地面のタイル（128×128、繰り返して並べる）を、計算で描いて書き出す（生成AIを使わない自作のドット絵）。
 * 端は左右・上下でつながるように描く（模様は座標を 128 で折り返して置く。むらは周期のあるノイズ）。
 * 乱数はシード付きなので、何度実行しても同じ絵になる。
 *
 *   node scripts/make-map-tiles.ts <地方（johto・hoenn。省くと johto）> [タイル ID ...]
 *   npm run map-tiles -- hoenn
 *
 * 出力: public/map/<地方>/<タイル ID>.png（ゲームで使う）・assets/map/<地方>/preview/<タイル ID>.png（3×3 に並べた継ぎ目の確認用）
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const TILE = 128;
type Rgb = readonly [number, number, number];

const hex = (h: string): Rgb => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Canvas {
  readonly px: Rgb[] = [];
  constructor(fill: Rgb) {
    for (let i = 0; i < TILE * TILE; i++) this.px.push(fill);
  }
  private idx(x: number, y: number): number {
    const wx = ((Math.round(x) % TILE) + TILE) % TILE;
    const wy = ((Math.round(y) % TILE) + TILE) % TILE;
    return wy * TILE + wx;
  }
  get(x: number, y: number): Rgb {
    return this.px[this.idx(x, y)]!;
  }
  set(x: number, y: number, c: Rgb): void {
    this.px[this.idx(x, y)] = c;
  }
  /** 1文字が1ドットの絵を置く（"." は描かない）。端をまたいでも反対側につながる */
  stamp(x: number, y: number, rows: readonly string[], colors: Readonly<Record<string, Rgb>>): void {
    rows.forEach((row, dy) => [...row].forEach((ch, dx) => {
      const c = colors[ch];
      if (c) this.set(x + dx, y + dy, c);
    }));
  }
}

/** 周期 TILE のノイズ（0〜1）。格子の数 cells は TILE を割り切る数にする */
function periodicNoise(rand: () => number, cells: number): (x: number, y: number) => number {
  const grid = Array.from({ length: cells * cells }, () => rand());
  const at = (gx: number, gy: number) => grid[(((gy % cells) + cells) % cells) * cells + (((gx % cells) + cells) % cells)]!;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = (x / TILE) * cells, fy = (y / TILE) * cells;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = smooth(fx - x0), ty = smooth(fy - y0);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
    return a + (b - a) * ty;
  };
}

/** 大きいむらと小さいむらを重ねたノイズ（0〜1） */
function layeredNoise(rand: () => number, cells: number): (x: number, y: number) => number {
  const a = periodicNoise(rand, cells), b = periodicNoise(rand, cells * 2), c = periodicNoise(rand, cells * 4);
  return (x, y) => a(x, y) * 0.55 + b(x, y) * 0.3 + c(x, y) * 0.15;
}

/** 模様を、互いに離して（端をまたいだ距離で）置く場所を選ぶ */
function scatter(rand: () => number, count: number, minDist: number, taken: { x: number; y: number }[] = []): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const wrapDist = (a: number, b: number) => { const d = Math.abs(a - b) % TILE; return Math.min(d, TILE - d); };
  for (let tries = 0; out.length < count && tries < count * 60; tries++) {
    const p = { x: Math.floor(rand() * TILE), y: Math.floor(rand() * TILE) };
    if ([...taken, ...out].every((q) => Math.hypot(wrapDist(p.x, q.x), wrapDist(p.y, q.y)) >= minDist)) out.push(p);
  }
  taken.push(...out);
  return out;
}

/** 地のむら: ノイズの値で色を段に分け、ところどころ1ドットだけ明るい・暗い粒を混ぜる */
function base(c: Canvas, rand: () => number, noise: (x: number, y: number) => number, bands: readonly [number, Rgb][], grain: { pct: number; light: Rgb; dark: Rgb }): void {
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const n = noise(x, y);
    let col = bands[0]![1];
    for (const [at, b] of bands) if (n >= at) col = b;
    const r = rand();
    if (r < grain.pct / 2) col = grain.light;
    else if (r < grain.pct) col = grain.dark;
    c.set(x, y, col);
  }
}

/** 曲がりながら進む線（ひび・根・水路）。width 2 なら下にもう1ドット、shade があれば線の下に影 */
function wander(c: Canvas, rand: () => number, len: number, color: Rgb, opts: { bend?: number; width?: number; shade?: Rgb; light?: Rgb } = {}): void {
  let x = rand() * TILE, y = rand() * TILE, dir = rand() * Math.PI * 2;
  for (let s = 0; s < len; s++) {
    if (opts.light) c.set(x, y - 1, opts.light);
    c.set(x, y, color);
    if ((opts.width ?? 1) > 1) c.set(x, y + 1, color);
    if (opts.shade) c.set(x, y + (opts.width ?? 1), opts.shade);
    dir += (rand() - 0.5) * (opts.bend ?? 0.9);
    x += Math.cos(dir);
    y += Math.sin(dir);
  }
}

/** ふちを崩した丸い塊（水たまり・苔・雪の吹きだまり）。edge は外側の1ドットのふち */
function blob(c: Canvas, rand: () => number, cx: number, cy: number, rx: number, ry: number, fill: (x: number, y: number) => Rgb, edge?: Rgb): void {
  const wob = Array.from({ length: 12 }, () => 0.8 + rand() * 0.35);
  const radius = (a: number) => { const t = ((a / (Math.PI * 2)) * 12 + 12) % 12; const i = Math.floor(t); return wob[i]! + (wob[(i + 1) % 12]! - wob[i]!) * (t - i); };
  for (let dy = -ry - 2; dy <= ry + 2; dy++) for (let dx = -rx - 2; dx <= rx + 2; dx++) {
    const d = Math.hypot(dx / rx, dy / ry) / radius(Math.atan2(dy, dx));
    if (d <= 1) c.set(cx + dx, cy + dy, fill(dx, dy));
    else if (edge && d <= 1 + 1.2 / Math.min(rx, ry)) c.set(cx + dx, cy + dy, edge);
  }
}

/** 陰のある石（左上が明るく、右下に影）。大きさは2種類 */
function rock(c: Canvas, rand: () => number, x: number, y: number, col: { l: Rgb; m: Rgb; d: Rgb; k: Rgb }): void {
  c.stamp(x, y, rand() < 0.5 ? ['.ll.', 'lmmd', 'mmdd', '.kk.'] : ['lm.', 'mdd', '.k.'], col);
}

type TileDef = { seed: number; draw: (c: Canvas, rand: () => number) => void; fill: Rgb };

const JOHTO: Record<string, TileDef> = {
  // 区間0: 明るい黄緑の草原。草の芽・白と黄の小花・土の点
  meadow: {
    seed: 2901,
    fill: hex('5aa443'),
    draw(c, rand) {
      const n = layeredNoise(rand, 4);
      base(c, rand, n, [[0, hex('55a040')], [0.36, hex('5aa443')], [0.64, hex('60aa46')]], { pct: 0.12, light: hex('6ab44c'), dark: hex('4e933c') });
      const taken: { x: number; y: number }[] = [];
      const G = { d: hex('367a30'), m: hex('41863a'), l: hex('86ca5c') };
      for (const p of scatter(rand, 120, 6, taken)) {
        const tuft = rand() < 0.5
          ? ['l...l', 'd.l.d', '.d.d.', '..m..']
          : ['.l.l', 'd.d.', '.dm.'];
        c.stamp(p.x, p.y, tuft, G);
      }
      const F = { w: hex('f4f4ec'), s: hex('c9cfc0'), y: hex('f2cf3e'), o: hex('d99a2b') };
      for (const p of scatter(rand, 20, 8, taken)) c.stamp(p.x, p.y, ['.w.', 'wyw', '.s.'], F);
      for (const p of scatter(rand, 16, 8, taken)) c.stamp(p.x, p.y, ['y.', 'oy'], F);
      // 小さな草の葉（明るい1ドットと影）
      for (const p of scatter(rand, 90, 3, taken)) c.stamp(p.x, p.y, rand() < 0.5 ? ['l', 'd'] : ['.l', 'd.'], G);
      const D = { b: hex('8c7a4c'), d: hex('6f6040') };
      for (const p of scatter(rand, 10, 10, taken)) c.stamp(p.x, p.y, rand() < 0.5 ? ['bb', '.d'] : ['b', 'd'], D);
    },
  },
  // 区間3: 焦げた黒茶の地面。灰のむら・ひび・くすぶる火種・焦げた木片
  burned: {
    seed: 3501,
    fill: hex('3b2f29'),
    draw(c, rand) {
      const n = layeredNoise(rand, 4);
      const ash = layeredNoise(rand, 8);
      base(c, rand, n, [[0, hex('332924')], [0.35, hex('3b2f29')], [0.7, hex('43362e')]], { pct: 0.06, light: hex('4b3e35'), dark: hex('2c231f') });
      // 灰が積もった所（明るい灰色のむら。ふちは粒で崩す）
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const a = ash(x, y);
        if (a > 0.7) c.set(x, y, rand() < 0.12 ? hex('6f6761') : hex('5c534d'));
        else if (a > 0.66 && rand() < 0.35) c.set(x, y, hex('4d433d'));
      }
      // ひび: 曲がりながら進む細い線
      for (let i = 0; i < 14; i++) {
        let x = rand() * TILE, y = rand() * TILE, dir = rand() * Math.PI * 2;
        const len = 8 + Math.floor(rand() * 14);
        for (let s = 0; s < len; s++) {
          c.set(x, y, hex('1f1915'));
          dir += (rand() - 0.5) * 0.9;
          x += Math.cos(dir); y += Math.sin(dir);
        }
      }
      const taken: { x: number; y: number }[] = [];
      // 焦げた木片: 横か斜めの短い棒。上のふちが少し明るく、先が赤くくすぶることがある
      const W = { k: hex('17110d'), e: hex('6e4e36'), m: hex('2a1e17'), r: hex('d84c26'), o: hex('ffa040') };
      for (const p of scatter(rand, 10, 16, taken)) {
        const glow = rand() < 0.5;
        const sticks = [
          ['.eeeeeee' + (glow ? 'o' : 'e'), 'ekmkmkmk' + (glow ? 'r' : 'k'), '.kkkkkkk.'],
          ['...ee', '..ekk', '.ekk.', 'ekk..', (glow ? 'r' : 'k') + 'k...'],
          ['ee....', 'kkee..', '.kkkee', '...kk' + (glow ? 'r' : 'k')],
        ];
        c.stamp(p.x, p.y, sticks[Math.floor(rand() * sticks.length)]!, W);
      }
      // 火種: 赤い点のまわりに暗い赤のにじみ。ときどき明るい橙
      const E = { r: hex('e0502a'), o: hex('ffb048'), g: hex('7a3020') };
      for (const p of scatter(rand, 14, 10, taken)) {
        c.stamp(p.x, p.y, rand() < 0.5 ? ['.g.', 'gog', '.g.'] : ['gr', 'rg'], E);
      }
      // 焦げた石: 左上が明るく、右下に影
      const R = { l: hex('7d736b'), m: hex('5b524b'), d: hex('3a322c'), k: hex('1c1612') };
      for (const p of scatter(rand, 14, 10, taken)) c.stamp(p.x, p.y, rand() < 0.5 ? ['.ll.', 'lmmd', 'mmdd', '.kk.'] : ['lm.', 'mdd', '.k.'], R);
      // 小石と炭の粒
      const S = { a: hex('6b625b'), k: hex('1c1612') };
      for (const p of scatter(rand, 40, 4, taken)) c.stamp(p.x, p.y, rand() < 0.5 ? ['a', 'k'] : ['k'], S);
    },
  },
  // 区間1: 湿った茶灰色の洞くつの床。陰のある小石・浅い水たまり・ひび
  cave: {
    seed: 3201,
    fill: hex('5e544c'),
    draw(c, rand) {
      const n = layeredNoise(rand, 4);
      base(c, rand, n, [[0, hex('564d46')], [0.38, hex('5e544c')], [0.62, hex('665c53')]], { pct: 0.1, light: hex('6e6359'), dark: hex('4e4640') });
      for (let i = 0; i < 12; i++) wander(c, rand, 8 + Math.floor(rand() * 12), hex('3e3732'), { light: hex('6c6259') });
      const taken: { x: number; y: number }[] = [];
      for (const p of scatter(rand, 5, 30, taken)) {
        const rx = 4 + Math.floor(rand() * 3), ry = 2 + Math.floor(rand() * 2);
        blob(c, rand, p.x, p.y, rx, ry, (dx, dy) => (dy < 0 && dx < 0 && rand() < 0.4 ? hex('5f7a8c') : hex('3d4e5c')), hex('4a433d'));
      }
      const R = { l: hex('8a7f74'), m: hex('6c6157'), d: hex('4a413a'), k: hex('2e2824') };
      for (const p of scatter(rand, 22, 9, taken)) rock(c, rand, p.x, p.y, R);
      const S = { a: hex('7a6f65'), k: hex('3a332e') };
      for (const p of scatter(rand, 50, 4, taken)) c.stamp(p.x, p.y, rand() < 0.5 ? ['a', 'k'] : ['k'], S);
    },
  },
  // 区間2（夜）: 深緑の森の地面。落ち葉・根・苔・木漏れ日。夜に暗くするので少し明るめ
  forest: {
    seed: 3301,
    fill: hex('467e3a'),
    draw(c, rand) {
      const n = layeredNoise(rand, 4);
      const sun = periodicNoise(rand, 16);
      base(c, rand, n, [[0, hex('3f7535')], [0.38, hex('467e3a')], [0.64, hex('4c863e')]], { pct: 0.12, light: hex('55903f'), dark: hex('386b31') });
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) if (sun(x, y) > 0.82) c.set(x, y, rand() < 0.15 ? hex('6aa249') : hex('528c40'));
      for (let i = 0; i < 9; i++) wander(c, rand, 14 + Math.floor(rand() * 14), hex('5c4630'), { bend: 0.6, width: 2, shade: hex('2f5528'), light: hex('7a5f40') });
      const taken: { x: number; y: number }[] = [];
      const L = { a: hex('b8782c'), b: hex('8a5a26'), c: hex('c99a3a'), d: hex('6e4a22') };
      for (const p of scatter(rand, 34, 7, taken)) {
        const leaves = [['.a.', 'aab', '.b.'], ['cc', 'cd'], ['a.', 'ab', '.b'], ['.c', 'cd']];
        c.stamp(p.x, p.y, leaves[Math.floor(rand() * leaves.length)]!, L);
      }
      const M = { l: hex('7cbc55'), d: hex('2f5e2a') };
      for (const p of scatter(rand, 70, 4, taken)) c.stamp(p.x, p.y, rand() < 0.5 ? ['l', 'd'] : ['.l', 'ld'], M);
    },
  },
  // 区間4: 海に近い砂地。濡れた砂のむら・貝殻・波の泡の筋
  beach: {
    seed: 3801,
    fill: hex('e0c990'),
    draw(c, rand) {
      const n = layeredNoise(rand, 4);
      const wet = layeredNoise(rand, 4);
      base(c, rand, n, [[0, hex('dac288')], [0.38, hex('e0c990')], [0.64, hex('e6d09a')]], { pct: 0.14, light: hex('eedaa8'), dark: hex('cdb47c') });
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const w = wet(x, y);
        if (w > 0.72) c.set(x, y, rand() < 0.1 ? hex('c8b27e') : hex('d3bb84'));
      }
      const taken: { x: number; y: number }[] = [];
      // 泡の筋: 白い短い線と、下にうすい水色
      for (const p of scatter(rand, 9, 22, taken)) {
        const len = 6 + Math.floor(rand() * 6);
        for (let i = 0; i < len; i++) {
          const yy = p.y + Math.round(Math.sin(i * 0.7) * 0.6);
          c.set(p.x + i, yy, hex('fbfbf4'));
          if (rand() < 0.7) c.set(p.x + i, yy + 1, hex('b9dbe0'));
        }
      }
      const S = { w: hex('f6efe4'), p: hex('e8b4a8'), d: hex('b89a80') };
      for (const p of scatter(rand, 14, 10, taken)) {
        const shells = [['.ww.', 'wpwp', '.dd.'], ['wp', 'dd'], ['.w', 'wp', 'd.']];
        c.stamp(p.x, p.y, shells[Math.floor(rand() * shells.length)]!, S);
      }
      const G = { a: hex('a89070'), b: hex('8a7458') };
      for (const p of scatter(rand, 50, 4, taken)) c.stamp(p.x, p.y, rand() < 0.5 ? ['a'] : ['a', 'b'], G);
    },
  },
  // 区間5（夜）: 灯台の石の床。16ドットの石タイルと目地、ところどころ金属の格子、さびの差し色
  lighthouse: {
    seed: 3901,
    fill: hex('8a8a88'),
    draw(c, rand) {
      const CELL = 16;
      const stones = [hex('8a8a88'), hex('84837f'), hex('908f8a'), hex('7f807e')];
      for (let ty = 0; ty < TILE / CELL; ty++) for (let tx = 0; tx < TILE / CELL; tx++) {
        const grate = rand() < 0.06;
        const col = stones[Math.floor(rand() * stones.length)]!;
        for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
          const X = tx * CELL + x, Y = ty * CELL + y;
          let p = col;
          if (grate) p = (x % 4 === 1 || y % 4 === 1) ? hex('5a5e62') : hex('2a2c30');
          else if (rand() < 0.08) p = rand() < 0.5 ? hex('9a9994') : hex('767672');
          if (x === 0 || y === 0) p = hex('5c5b58');
          else if (x === 1 || y === 1) p = grate ? p : hex('a3a29d');
          else if (x === CELL - 1 || y === CELL - 1) p = grate ? hex('3a3c40') : hex('6e6d6a');
          c.set(X, Y, p);
        }
      }
      const taken: { x: number; y: number }[] = [];
      const R = { r: hex('9a5a30'), o: hex('c08040'), g: hex('c8a850') };
      for (const p of scatter(rand, 16, 10, taken)) c.stamp(p.x, p.y, rand() < 0.5 ? ['ro', '.r'] : ['g.', 'rg'], R);
      for (let i = 0; i < 6; i++) wander(c, rand, 5 + Math.floor(rand() * 5), hex('5e5d5a'), { bend: 1.2 });
    },
  },
  // 区間6a: 生い茂った濃い草原に、水たまりがいくつか
  lake_meadow: {
    seed: 6101,
    fill: hex('3f8a3a'),
    draw(c, rand) {
      const n = layeredNoise(rand, 4);
      base(c, rand, n, [[0, hex('3a8236')], [0.38, hex('3f8a3a')], [0.64, hex('45913e')]], { pct: 0.14, light: hex('52a046'), dark: hex('33742f') });
      const taken: { x: number; y: number }[] = [];
      // 水たまり: 青い水面に明るい波紋、ふちは暗い緑
      for (const p of scatter(rand, 4, 40, taken)) {
        const rx = 8 + Math.floor(rand() * 4), ry = 5 + Math.floor(rand() * 3);
        blob(c, rand, p.x, p.y, rx, ry, (dx, dy) => {
          if (dy === -Math.round(ry / 3) && Math.abs(dx) < rx / 2 && rand() < 0.7) return hex('a8d4f0');
          return dy < -ry / 3 ? hex('4f8fd0') : hex('3f78c0');
        }, hex('2a5e2a'));
      }
      // 背の高い草むら（密に）
      const G = { d: hex('285e26'), m: hex('2f6a2c'), l: hex('6cb850'), k: hex('1f4c1e') };
      for (const p of scatter(rand, 150, 5, taken)) {
        const tufts = [['l.l.l', 'dlmld', 'ddmdd', '.kdk.'], ['.l.l', 'ld.d', 'dmdm', '.kk.'], ['l..l', 'd.ld', 'dmd.', '.k..']];
        c.stamp(p.x, p.y, tufts[Math.floor(rand() * tufts.length)]!, G);
      }
    },
  },
  // 区間6b（夜）: 水色〜白の氷の床。ひび・白い霜・つるつるした反射の筋
  ice: {
    seed: 6201,
    fill: hex('b6dcec'),
    draw(c, rand) {
      const n = layeredNoise(rand, 4);
      base(c, rand, n, [[0, hex('aed4e6')], [0.38, hex('b6dcec')], [0.64, hex('c0e4f2')]], { pct: 0.08, light: hex('d2eef8'), dark: hex('9ec6dc') });
      for (let i = 0; i < 14; i++) wander(c, rand, 10 + Math.floor(rand() * 16), hex('82b0cc'), { bend: 0.7, light: hex('e8f8ff') });
      const taken: { x: number; y: number }[] = [];
      // 反射の筋: 右上がりの白い斜線
      for (const p of scatter(rand, 14, 16, taken)) {
        const len = 4 + Math.floor(rand() * 5);
        for (let i = 0; i < len; i++) c.set(p.x + i, p.y - i, i === 0 || i === len - 1 ? hex('dff4fc') : hex('ffffff'));
      }
      const F = { w: hex('ffffff'), f: hex('e0f2fa') };
      for (const p of scatter(rand, 26, 8, taken)) c.stamp(p.x, p.y, rand() < 0.5 ? ['.f.', 'fwf', '.f.'] : ['w', 'f'], F);
    },
  },
  // 区間7（夜）: 濃い藍〜紫の岩の洞くつ。青白い鉱物の粒と、細い水路
  dragon_cave: {
    seed: 7101,
    fill: hex('4c4872'),
    draw(c, rand) {
      const n = layeredNoise(rand, 4);
      base(c, rand, n, [[0, hex('46426a')], [0.38, hex('4c4872')], [0.64, hex('534f7a')]], { pct: 0.1, light: hex('5c5884'), dark: hex('3e3a60') });
      for (let i = 0; i < 4; i++) wander(c, rand, 26 + Math.floor(rand() * 18), hex('16152a'), { bend: 0.5, width: 2, shade: hex('2a2844'), light: hex('5a6aa8') });
      for (let i = 0; i < 8; i++) wander(c, rand, 6 + Math.floor(rand() * 8), hex('2c2944'));
      const taken: { x: number; y: number }[] = [];
      const M = { w: hex('dce8ff'), b: hex('8aa4e8'), d: hex('5a68a8') };
      for (const p of scatter(rand, 18, 9, taken)) {
        const gems = [['.w.', 'wbd', '.d.'], ['b.', 'wb'], ['.b', 'bd']];
        c.stamp(p.x, p.y, gems[Math.floor(rand() * gems.length)]!, M);
      }
      const R = { l: hex('5e5a82'), m: hex('4a466c'), d: hex('34304e'), k: hex('201d36') };
      for (const p of scatter(rand, 16, 10, taken)) rock(c, rand, p.x, p.y, R);
    },
  },
  // 区間8: 険しい灰色〜赤茶の岩肌。大きなひびと段差の影
  victory_rock: {
    seed: 8101,
    fill: hex('7e6e64'),
    draw(c, rand) {
      const n = layeredNoise(rand, 4);
      base(c, rand, n, [[0, hex('766760')], [0.38, hex('7e6e64')], [0.64, hex('86766a')]], { pct: 0.12, light: hex('92827a'), dark: hex('6c5e56') });
      const taken: { x: number; y: number }[] = [];
      // 段差: 上のふちが明るく、下に濃い影の帯
      for (const p of scatter(rand, 8, 26, taken)) {
        const len = 12 + Math.floor(rand() * 12);
        let yy = p.y;
        for (let i = 0; i < len; i++) {
          if (rand() < 0.2) yy += rand() < 0.5 ? -1 : 1;
          c.set(p.x + i, yy - 1, hex('a09088'));
          c.set(p.x + i, yy, hex('4e423c'));
          c.set(p.x + i, yy + 1, hex('5e514a'));
        }
      }
      for (let i = 0; i < 10; i++) wander(c, rand, 12 + Math.floor(rand() * 16), hex('4a3e38'), { bend: 0.8, light: hex('948478') });
      const R = { l: hex('a39388'), m: hex('84746a'), d: hex('5e514a'), k: hex('3e3430') };
      for (const p of scatter(rand, 20, 9, taken)) rock(c, rand, p.x, p.y, R);
      const S = { a: hex('9a8a80'), k: hex('4e423c') };
      for (const p of scatter(rand, 40, 4, taken)) c.stamp(p.x, p.y, rand() < 0.5 ? ['a', 'k'] : ['k'], S);
    },
  },
  // 区間9〜13: 金の縁取りの暗い紺の大理石の床。32ドットの格子、交わる所に金の飾り
  elite_hall: {
    seed: 9101,
    fill: hex('222c4c'),
    draw(c, rand) {
      const n = layeredNoise(rand, 4);
      base(c, rand, n, [[0, hex('1e2846')], [0.38, hex('222c4c')], [0.64, hex('263052')]], { pct: 0.06, light: hex('2c3758'), dark: hex('1a2240') });
      for (let i = 0; i < 12; i++) wander(c, rand, 16 + Math.floor(rand() * 20), hex('34416a'), { bend: 0.5 });
      for (let i = 0; i < 8; i++) wander(c, rand, 10 + Math.floor(rand() * 10), hex('3e4c78'), { bend: 0.4 });
      const CELL = 64;
      for (let a = 0; a < TILE; a++) for (let k = 0; k < TILE; k += CELL) {
        c.set(a, k, hex('a8884a'));
        c.set(a, k + 1, hex('5e4c2e'));
        c.set(k, a, hex('a8884a'));
        c.set(k + 1, a, hex('5e4c2e'));
      }
      const D = { g: hex('d0ae5c'), d: hex('7e6432'), k: hex('16203a') };
      for (let y = 0; y < TILE; y += CELL) for (let x = 0; x < TILE; x += CELL) c.stamp(x - 2, y - 2, ['..g..', '.gdg.', 'gdkdg', '.gdg.', '..g..'], D);
    },
  },
  // 区間14: 一面の雪。浅いくぼみ・凍った岩・きらめき
  snow: {
    seed: 14101,
    fill: hex('e0e8f0'),
    draw(c, rand) {
      const n = layeredNoise(rand, 4);
      base(c, rand, n, [[0, hex('d8e2ec')], [0.38, hex('e0e8f0')], [0.64, hex('e8eef5')]], { pct: 0.1, light: hex('f4f8fc'), dark: hex('ccd8e4') });
      const taken: { x: number; y: number }[] = [];
      const P = { s: hex('afbccd'), m: hex('c6d2df'), l: hex('ffffff') };
      for (const p of scatter(rand, 40, 8, taken)) c.stamp(p.x, p.y, rand() < 0.5 ? ['.mm.', 'msss', '.ll.'] : ['mm', 'ss', 'l.'], P);
      const R = { l: hex('a8b4c2'), m: hex('7e8a9a'), d: hex('5c6878'), k: hex('c4d0de') };
      for (const p of scatter(rand, 9, 18, taken)) {
        rock(c, rand, p.x, p.y, R);
        c.stamp(p.x, p.y - 1, ['.ll.'], { l: hex('ffffff') });
      }
      const S = { w: hex('ffffff'), b: hex('cfe0f0') };
      for (const p of scatter(rand, 24, 6, taken)) c.stamp(p.x, p.y, rand() < 0.5 ? ['.b.', 'bwb', '.b.'] : ['w'], S);
    },
  },
};

// ホウエン（13_hoenn_story_chart.md 4章）。南の島の地方なので、ジョウトより明るく彩度を高くする
const HOENN: Record<string, TileDef> = {
  // 区間0: 明るい南国の草原。白っぽい砂の小道の斑点・赤と黄の花・濃い草の芽
  route: {
    seed: 30001,
    fill: hex('4fb648'),
    draw(c, rand) {
      const n = layeredNoise(rand, 4);
      const sand = layeredNoise(rand, 8);
      base(c, rand, n, [[0, hex('48ac42')], [0.36, hex('4fb648')], [0.64, hex('58bf4e')]], { pct: 0.12, light: hex('66ca58'), dark: hex('3f9e3c') });
      const taken: { x: number; y: number }[] = [];
      const G = { d: hex('2e8030'), m: hex('38903a'), l: hex('8ade66') };
      for (const p of scatter(rand, 110, 6, taken)) {
        const tuft = rand() < 0.5 ? ['l...l', 'd.l.d', '.d.d.', '..m..'] : ['.l.l', 'd.d.', '.dm.'];
        c.stamp(p.x, p.y, tuft, G);
      }
      // 砂の斑点: ノイズの高い所を白っぽい砂に。ふちは草と混ざる粒で崩す
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const s = sand(x, y);
        if (s > 0.68) c.set(x, y, rand() < 0.08 ? hex('d6c48a') : rand() < 0.06 ? hex('fbf4d8') : hex('e8dcaa'));
        else if (s > 0.64 && rand() < 0.45) c.set(x, y, rand() < 0.5 ? hex('c8c486') : hex('e8dcaa'));
      }
      // 赤い花（黄色の芯）と、黄色の小花
      const F = { r: hex('e8403a'), p: hex('ff8a7a'), y: hex('ffd84a'), s: hex('2e8030') };
      for (const p of scatter(rand, 16, 10, taken)) c.stamp(p.x, p.y, ['.p.', 'ryr', '.r.', '.s.'], F);
      for (const p of scatter(rand, 18, 8, taken)) c.stamp(p.x, p.y, rand() < 0.5 ? ['y.', '.y'] : ['.y.', 'yyy'], F);
      for (const p of scatter(rand, 80, 3, taken)) c.stamp(p.x, p.y, rand() < 0.5 ? ['l', 'd'] : ['.l', 'd.'], G);
    },
  },
  // 区間3b: 赤茶の火山岩。黒い溶岩の固まり・細く赤く光る割れ目・軽石の粒
  volcano: {
    seed: 33002,
    fill: hex('7a4636'),
    draw(c, rand) {
      const n = layeredNoise(rand, 4);
      const basalt = layeredNoise(rand, 8);
      base(c, rand, n, [[0, hex('5e3328')], [0.36, hex('683a2e')], [0.64, hex('724234')]], { pct: 0.1, light: hex('82503e'), dark: hex('502b22') });
      // 黒い溶岩が固まった所（ノイズの高い所。ふちは粒で崩す）
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const b = basalt(x, y);
        if (b > 0.68) c.set(x, y, rand() < 0.22 ? hex('4a3a36') : rand() < 0.1 ? hex('241c1c') : hex('342828'));
        else if (b > 0.64 && rand() < 0.4) c.set(x, y, hex('3e2c26'));
      }
      // 光る割れ目: 暗いふちの中に赤、ところどころ橙
      for (let i = 0; i < 12; i++) {
        let x = rand() * TILE, y = rand() * TILE, dir = rand() * Math.PI * 2;
        const len = 14 + Math.floor(rand() * 18);
        for (let s = 0; s < len; s++) {
          c.set(x, y - 1, hex('3a1e18'));
          c.set(x, y + 1, hex('3a1e18'));
          c.set(x, y, rand() < 0.25 ? hex('ffa838') : hex('e8462a'));
          dir += (rand() - 0.5) * 0.8;
          x += Math.cos(dir); y += Math.sin(dir);
        }
      }
      const taken: { x: number; y: number }[] = [];
      const R = { l: hex('a86a52'), m: hex('84503e'), d: hex('5a3028'), k: hex('2c1a16') };
      for (const p of scatter(rand, 16, 10, taken)) rock(c, rand, p.x, p.y, R);
      // 軽石と炭の粒
      const S = { a: hex('b88a72'), k: hex('2c1a16'), o: hex('ff8a30') };
      for (const p of scatter(rand, 46, 4, taken)) c.stamp(p.x, p.y, rand() < 0.1 ? ['o'] : rand() < 0.5 ? ['a', 'k'] : ['k'], S);
    },
  },
  // 区間1: 灰褐色の花崗岩の床。白い石英の粒・暗い割れ目・陰のある石
  granite_cave: {
    seed: 31001,
    fill: hex('7a6e62'),
    draw(c, rand) {
      const n = layeredNoise(rand, 4);
      base(c, rand, n, [[0, hex('72665b')], [0.38, hex('7a6e62')], [0.64, hex('83766a')]], { pct: 0.16, light: hex('94887a'), dark: hex('62574e') });
      for (let i = 0; i < 12; i++) wander(c, rand, 10 + Math.floor(rand() * 14), hex('3e3530'), { bend: 0.7, light: hex('968a7e') });
      const taken: { x: number; y: number }[] = [];
      const R = { l: hex('a89c8e'), m: hex('8a7e72'), d: hex('5e544a'), k: hex('3a322c') };
      for (const p of scatter(rand, 20, 10, taken)) rock(c, rand, p.x, p.y, R);
      // 石英の粒（白とうすい桃）と、黒い雲母の粒
      const Q = { w: hex('eae6de'), p: hex('d8c4bc'), k: hex('2e2826') };
      for (const p of scatter(rand, 70, 4, taken)) c.stamp(p.x, p.y, rand() < 0.4 ? ['w'] : rand() < 0.5 ? ['p'] : ['k'], Q);
    },
  },
  // 区間2: 古い発電所の床。くすんだ金属の板・ボルト・黄色と黒の線・切れた配線
  power_plant: {
    seed: 32001,
    fill: hex('6c7478'),
    draw(c, rand) {
      const CELL = 32;
      const plates = [hex('6c7478'), hex('667074'), hex('727a7e'), hex('636b6f')];
      for (let ty = 0; ty < TILE / CELL; ty++) for (let tx = 0; tx < TILE / CELL; tx++) {
        const col = plates[Math.floor(rand() * plates.length)]!;
        const hazard = rand() < 0.12;
        for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
          let p = rand() < 0.07 ? (rand() < 0.5 ? hex('7c8488') : hex('5c6468')) : col;
          // 板の縁: 上と左が明るく、右と下が暗い
          if (x === 0 || y === 0) p = hex('3a4044');
          else if (x === 1 || y === 1) p = hex('8c9498');
          else if (x === CELL - 1 || y === CELL - 1) p = hex('4c5458');
          // 黄色と黒の斜めの線（危ない所）
          else if (hazard && y >= 4 && y < 10) p = Math.floor((x + y) / 3) % 2 === 0 ? hex('e0b830') : hex('2a2a2a');
          // 四隅のボルト
          if ((x === 4 || x === CELL - 5) && (y === 4 || y === CELL - 5)) p = hex('a8b0b4');
          if ((x === 5 || x === CELL - 4) && (y === 5 || y === CELL - 4)) p = hex('3a4044');
          c.set(tx * CELL + x, ty * CELL + y, p);
        }
      }
      // 切れた配線（赤・黄・黒）
      for (let i = 0; i < 5; i++) wander(c, rand, 14 + Math.floor(rand() * 12), [hex('c83a30'), hex('e0b830'), hex('22262a')][i % 3]!, { bend: 0.6, shade: hex('3a4044') });
      // さびのしみ
      const taken: { x: number; y: number }[] = [];
      const R = { r: hex('8a5a3a'), o: hex('a8703e') };
      for (const p of scatter(rand, 12, 12, taken)) c.stamp(p.x, p.y, rand() < 0.5 ? ['ro', 'r.'] : ['.r', 'ro', '.r'], R);
    },
  },
  // 区間3a: 灰が積もった草地。灰色の地面から、ところどころ緑がのぞく
  ash_field: {
    seed: 33001,
    fill: hex('9a9894'),
    draw(c, rand) {
      const n = layeredNoise(rand, 4);
      const green = layeredNoise(rand, 8);
      base(c, rand, n, [[0, hex('92908c')], [0.38, hex('9a9894')], [0.64, hex('a4a29e')]], { pct: 0.14, light: hex('b4b2ae'), dark: hex('85837f') });
      // 灰から草がのぞく所
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const g = green(x, y);
        if (g > 0.7) c.set(x, y, rand() < 0.3 ? hex('8a9a74') : hex('6e8a5a'));
        else if (g > 0.66 && rand() < 0.35) c.set(x, y, hex('8a9480'));
      }
      const taken: { x: number; y: number }[] = [];
      // 灰をかぶった草の芽
      const G = { d: hex('5a7448'), l: hex('b8bcb0') };
      for (const p of scatter(rand, 60, 6, taken)) c.stamp(p.x, p.y, rand() < 0.5 ? ['l.l', 'd.d', '.d.'] : ['.l', 'ld', 'd.'], G);
      // 灰の吹きだまり（白っぽい筋）
      for (const p of scatter(rand, 10, 20, taken)) {
        const len = 5 + Math.floor(rand() * 6);
        for (let i = 0; i < len; i++) { c.set(p.x + i, p.y, hex('c8c6c2')); if (rand() < 0.6) c.set(p.x + i, p.y + 1, hex('86847f')); }
      }
      const S = { a: hex('6a6864'), k: hex('4a4844') };
      for (const p of scatter(rand, 30, 5, taken)) c.stamp(p.x, p.y, rand() < 0.5 ? ['a', 'k'] : ['k'], S);
    },
  },
  // 区間4: 明るい黄土色の砂漠。風の筋（砂紋）と小石
  desert: {
    seed: 34001,
    fill: hex('dcb46e'),
    draw(c, rand) {
      const n = layeredNoise(rand, 4);
      base(c, rand, n, [[0, hex('d4ac66')], [0.38, hex('dcb46e')], [0.64, hex('e4bc78')]], { pct: 0.12, light: hex('ecc888'), dark: hex('c8a05e') });
      // 砂紋: ゆるく波打つ横の筋（明るい筋の下に影）。端でつながるように周期を TILE に合わせる
      for (let row = 0; row < 12; row++) {
        const y0 = row * (TILE / 12) + Math.floor(rand() * 3), phase = rand() * Math.PI * 2, amp = 1.5 + rand() * 1.5;
        for (let x = 0; x < TILE; x++) {
          if (rand() < 0.12) continue;
          const y = y0 + Math.round(Math.sin((x / TILE) * Math.PI * 4 + phase) * amp);
          c.set(x, y, hex('f0d294'));
          c.set(x, y + 1, hex('bf965a'));
        }
      }
      const taken: { x: number; y: number }[] = [];
      const R = { l: hex('c09a70'), m: hex('a07e58'), d: hex('7a5e42'), k: hex('5a4430') };
      for (const p of scatter(rand, 8, 18, taken)) rock(c, rand, p.x, p.y, R);
      const S = { a: hex('b08a5a'), k: hex('8a6a46') };
      for (const p of scatter(rand, 30, 5, taken)) c.stamp(p.x, p.y, rand() < 0.5 ? ['a'] : ['k'], S);
    },
  },
  // 区間5: 背の高い濃い緑の草と、濡れた黒い土。小さな水たまり（雨で暗くするので少し明るめ）
  rain_grass: {
    seed: 35001,
    fill: hex('3e9a44'),
    draw(c, rand) {
      const n = layeredNoise(rand, 4);
      const mud = layeredNoise(rand, 8);
      base(c, rand, n, [[0, hex('38923e')], [0.38, hex('3e9a44')], [0.64, hex('44a24a')]], { pct: 0.12, light: hex('52b056'), dark: hex('30843a') });
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const m = mud(x, y);
        if (m > 0.7) c.set(x, y, rand() < 0.1 ? hex('5a4a3a') : hex('46382c'));
        else if (m > 0.66 && rand() < 0.4) c.set(x, y, hex('3a5a30'));
      }
      const taken: { x: number; y: number }[] = [];
      // 水たまり: 空を映す明るい青、ふちは泥
      for (const p of scatter(rand, 5, 34, taken)) {
        const rx = 4 + Math.floor(rand() * 3), ry = 2 + Math.floor(rand() * 2);
        blob(c, rand, p.x, p.y, rx, ry, (_dx, dy) => (dy < 0 && rand() < 0.3 ? hex('b0d4ec') : hex('6a9cc8')), hex('3a3028'));
      }
      // 背の高い草むら
      const G = { d: hex('24702a'), m: hex('2c7c32'), l: hex('78cc6a'), k: hex('1c5a22') };
      for (const p of scatter(rand, 130, 5, taken)) {
        const tufts = [['l.l.l', 'dlmld', 'ddmdd', '.kdk.'], ['.l.l', 'ld.d', 'dmdm', '.kk.']];
        c.stamp(p.x, p.y, tufts[Math.floor(rand() * tufts.length)]!, G);
      }
    },
  },
  // 区間6: 霊山の石畳と草。苔むした石・白い霧の斑点・小さな花（供え物）
  pyre: {
    seed: 36001,
    fill: hex('5e7a5a'),
    draw(c, rand) {
      const n = layeredNoise(rand, 4);
      const mist = layeredNoise(rand, 4);
      base(c, rand, n, [[0, hex('587454')], [0.38, hex('5e7a5a')], [0.64, hex('648060')]], { pct: 0.12, light: hex('70906a'), dark: hex('4e6a4c') });
      const taken: { x: number; y: number }[] = [];
      // 苔むした敷石: 灰色の四角い石、ふちに苔
      for (const p of scatter(rand, 14, 24, taken)) {
        const w = 8 + Math.floor(rand() * 5), h = 6 + Math.floor(rand() * 3);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          let col = rand() < 0.1 ? hex('9c9a94') : hex('8a8882');
          if (y === 0 || x === 0) col = hex('a8a6a0');
          if (y === h - 1 || x === w - 1) col = hex('5e5c58');
          if ((x === 0 || y === h - 1) && rand() < 0.5) col = hex('6a8a5a');
          c.set(p.x + x, p.y + y, col);
        }
      }
      // 霧: うすい白を、ドットを間引いて重ねる
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) if (mist(x, y) > 0.7 && x % 2 === 0 && y % 2 === 0) c.set(x, y, hex('a8bcae'));
      // 小さな花（白と紫）
      const F = { w: hex('f0eef4'), v: hex('a68ad0'), s: hex('3e5a3c') };
      for (const p of scatter(rand, 14, 10, taken)) c.stamp(p.x, p.y, rand() < 0.5 ? ['.w.', 'wvw', '.s.'] : ['v.', '.s'], F);
      const G = { d: hex('3e5a3c'), l: hex('7c9a74') };
      for (const p of scatter(rand, 60, 5, taken)) c.stamp(p.x, p.y, rand() < 0.5 ? ['l.l', 'd.d'] : ['l', 'd'], G);
    },
  },
  // 区間7: 足首くらいの浅い海。透けた水色の下に白い砂、サンゴの欠片と波の光の筋
  shallows: {
    seed: 37001,
    fill: hex('5cc4d4'),
    draw(c, rand) {
      const n = layeredNoise(rand, 4);
      base(c, rand, n, [[0, hex('54bccd')], [0.38, hex('5cc4d4')], [0.64, hex('66ccda')]], { pct: 0.08, light: hex('7ad6e2'), dark: hex('4cb0c4') });
      const taken: { x: number; y: number }[] = [];
      // 水の下の白い砂の斑点
      for (const p of scatter(rand, 6, 30, taken)) {
        const rx = 6 + Math.floor(rand() * 4), ry = 4 + Math.floor(rand() * 2);
        blob(c, rand, p.x, p.y, rx, ry, () => (rand() < 0.1 ? hex('b4e8e4') : hex('9adcd8')));
      }
      // サンゴの欠片（桃・橙）
      const K = { p: hex('f08a9a'), o: hex('f4a868'), d: hex('b85a6a') };
      for (const p of scatter(rand, 12, 12, taken)) c.stamp(p.x, p.y, rand() < 0.5 ? ['p.p', '.p.', '.d.'] : ['o.', 'oo', 'd.'], K);
      // 波の光の筋: 白い短い波線
      for (const p of scatter(rand, 18, 14, taken)) {
        const len = 4 + Math.floor(rand() * 5);
        for (let i = 0; i < len; i++) c.set(p.x + i, p.y + (i % 4 === 1 || i % 4 === 2 ? -1 : 0), i === 0 || i === len - 1 ? hex('c8f0f4') : hex('ffffff'));
      }
    },
  },
  // 区間8: 暗い紫がかった岩の洞くつ。段差の影と、ところどころの小石
  victory_cave: {
    seed: 38001,
    fill: hex('5e5466'),
    draw(c, rand) {
      const n = layeredNoise(rand, 4);
      base(c, rand, n, [[0, hex('584e60')], [0.38, hex('5e5466')], [0.64, hex('665c6e')]], { pct: 0.12, light: hex('72687a'), dark: hex('4e4656') });
      const taken: { x: number; y: number }[] = [];
      for (const p of scatter(rand, 8, 26, taken)) {
        const len = 12 + Math.floor(rand() * 12);
        let yy = p.y;
        for (let i = 0; i < len; i++) {
          if (rand() < 0.2) yy += rand() < 0.5 ? -1 : 1;
          c.set(p.x + i, yy - 1, hex('80768a'));
          c.set(p.x + i, yy, hex('342e3c'));
          c.set(p.x + i, yy + 1, hex('443c4c'));
        }
      }
      for (let i = 0; i < 8; i++) wander(c, rand, 10 + Math.floor(rand() * 12), hex('3a3442'), { bend: 0.8, light: hex('766c80') });
      const R = { l: hex('8a809a'), m: hex('6a6078'), d: hex('4a4258'), k: hex('2e2838') };
      for (const p of scatter(rand, 20, 9, taken)) rock(c, rand, p.x, p.y, R);
      const S = { a: hex('7e748a'), k: hex('3a3442') };
      for (const p of scatter(rand, 40, 4, taken)) c.stamp(p.x, p.y, rand() < 0.5 ? ['a', 'k'] : ['k'], S);
    },
  },
  // 区間9〜13: 白と水色の石の床に金の縁取り（ジョウトの紺とは色を変える）
  elite_hall: {
    seed: 39001,
    fill: hex('a8c2ce'),
    draw(c, rand) {
      const n = layeredNoise(rand, 4);
      base(c, rand, n, [[0, hex('a2bcc8')], [0.38, hex('a8c2ce')], [0.64, hex('b0c8d4')]], { pct: 0.05, light: hex('bcd2dc'), dark: hex('96b2c0') });
      // 大理石の筋
      for (let i = 0; i < 10; i++) wander(c, rand, 16 + Math.floor(rand() * 20), hex('8eaabc'), { bend: 0.5 });
      for (let i = 0; i < 6; i++) wander(c, rand, 10 + Math.floor(rand() * 10), hex('c8dce4'), { bend: 0.4 });
      // 32ドットの格子に水色の目地、64ドットごとに金の線
      for (let a = 0; a < TILE; a++) for (let k = 0; k < TILE; k += 32) {
        c.set(a, k, hex('7aa2b8'));
        c.set(k, a, hex('7aa2b8'));
      }
      for (let a = 0; a < TILE; a++) for (let k = 0; k < TILE; k += 64) {
        c.set(a, k, hex('c8a04a'));
        c.set(a, k + 1, hex('8a6a2e'));
        c.set(k, a, hex('c8a04a'));
        c.set(k + 1, a, hex('8a6a2e'));
      }
      const D = { g: hex('e8c460'), d: hex('8a6a2e'), b: hex('4a90b8') };
      for (let y = 0; y < TILE; y += 64) for (let x = 0; x < TILE; x += 64) c.stamp(x - 2, y - 2, ['..g..', '.gdg.', 'gdbdg', '.gdg.', '..g..'], D);
    },
  },
  // 区間14: 青灰色の岩と、隕石の欠片が光る床。細い水の流れ
  meteor_falls: {
    seed: 40001,
    fill: hex('5a6878'),
    draw(c, rand) {
      const n = layeredNoise(rand, 4);
      base(c, rand, n, [[0, hex('546272')], [0.38, hex('5a6878')], [0.64, hex('627080')]], { pct: 0.12, light: hex('6e7c8c'), dark: hex('4a5868') });
      // 細い水の流れ（明るい水色、上に白い光）
      for (let i = 0; i < 2; i++) wander(c, rand, 70 + Math.floor(rand() * 30), hex('5aa0d0'), { bend: 0.25, width: 2, shade: hex('2e3a4a'), light: hex('c8ecff') });
      const taken: { x: number; y: number }[] = [];
      const R = { l: hex('7a8898'), m: hex('5e6c7c'), d: hex('3e4a58'), k: hex('262e3a') };
      for (const p of scatter(rand, 18, 10, taken)) rock(c, rand, p.x, p.y, R);
      // 隕石の欠片: 黒い粒の中に、緑と紫に光る点
      const M = { k: hex('1e2028'), g: hex('8af0b0'), v: hex('c08af0'), w: hex('f0f8ff') };
      for (const p of scatter(rand, 16, 10, taken)) {
        const shards = [['.k.', 'kgk', '.k.'], ['kv', 'wk'], ['.k', 'kg', 'k.']];
        c.stamp(p.x, p.y, shards[Math.floor(rand() * shards.length)]!, M);
      }
      const S = { a: hex('7a8898'), k: hex('2e3a48') };
      for (const p of scatter(rand, 40, 4, taken)) c.stamp(p.x, p.y, rand() < 0.5 ? ['a', 'k'] : ['k'], S);
    },
  },
};

const REGION_TILES: Record<string, Record<string, TileDef>> = { johto: JOHTO, hoenn: HOENN };

function toPng(px: readonly Rgb[], w: number, h: number): Buffer {
  const png = new PNG({ width: w, height: h });
  px.forEach((p, i) => {
    png.data[i * 4] = p[0];
    png.data[i * 4 + 1] = p[1];
    png.data[i * 4 + 2] = p[2];
    png.data[i * 4 + 3] = 255;
  });
  return PNG.sync.write(png);
}

const region = process.argv[2] ?? 'johto';
const TILES = REGION_TILES[region];
if (!TILES) throw new Error(`地方 ${region} のタイルがありません`);
const ids = process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(TILES);
const outDir = path.join('public', 'map', region);
const previewDir = path.join('assets', 'map', region, 'preview');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(previewDir, { recursive: true });
for (const id of ids) {
  const def = TILES[id];
  if (!def) throw new Error(`タイル ${id} の描き方がありません`);
  const c = new Canvas(def.fill);
  def.draw(c, mulberry32(def.seed));
  fs.writeFileSync(path.join(outDir, `${id}.png`), toPng(c.px, TILE, TILE));
  const preview: Rgb[] = [];
  for (let y = 0; y < TILE * 3; y++) for (let x = 0; x < TILE * 3; x++) preview.push(c.get(x, y));
  fs.writeFileSync(path.join(previewDir, `${id}.png`), toPng(preview, TILE * 3, TILE * 3));
  console.log(`${outDir}/${id}.png（色の数 ${new Set(c.px.map((p) => p.join(','))).size}）`);
}
