import type { IconConfig, ItemIcons } from '../data/schema';

/** アイコンの枠: タイプの技・派生技・固有技（持ち物・パッシブは base） */
export type IconTier = 'base' | 'derived' | 'unique';

function rgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function mix(a: [number, number, number], b: [number, number, number], k: number): [number, number, number] {
  return [Math.round(a[0] + (b[0] - a[0]) * k), Math.round(a[1] + (b[1] - a[1]) * k), Math.round(a[2] + (b[2] - a[2]) * k)];
}

/** "type:fire" ならタイプの色、"#rrggbb" ならその色 */
export function iconColor(data: IconConfig, color: string): string {
  return color.startsWith('type:') ? (data.typeColors[color.slice(5)] ?? '#888888') : color;
}

/**
 * アイコン1つ（size × size）の RGBA を作る（自作のドット絵。描画とプレビューで同じものを使う）。
 * 角を丸めた四角を色で塗り（上を少し明るく）、白い絵柄（ふちはその色）を重ね、枠を付ける
 */
export function iconPixels(data: IconConfig, glyph: string, color: string, tier: IconTier): Uint8ClampedArray {
  const n = data.size;
  const out = new Uint8ClampedArray(n * n * 4);
  const base = rgb(color);
  const black: [number, number, number] = [0, 0, 0];
  const white: [number, number, number] = [255, 255, 255];
  const frame = rgb(data.frame[tier]);
  const rows = data.glyphs[glyph] ?? [];
  const put = (x: number, y: number, c: [number, number, number]): void => {
    const i = (y * n + x) * 4;
    out[i] = c[0];
    out[i + 1] = c[1];
    out[i + 2] = c[2];
    out[i + 3] = 255;
  };
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const ex = Math.min(x, n - 1 - x);
      const ey = Math.min(y, n - 1 - y);
      // 角を丸める
      if (ex + ey < 1) continue;
      const border = ex === 0 || ey === 0 || ex + ey === 1;
      if (border) {
        put(x, y, frame);
        continue;
      }
      const ch = rows[y]?.[x] ?? '.';
      if (ch === '#') put(x, y, mix(base, white, 0.78));
      else if (ch === '+') put(x, y, mix(base, black, 0.15));
      else put(x, y, mix(base, black, y < n / 2 ? 0.45 : 0.6));
    }
  }
  // 固有技は内側にもう1本、細い光の枠
  if (tier === 'unique') {
    const glow = mix(frame, white, 0.5);
    for (let k = 2; k < n - 2; k++) {
      for (const [x, y] of [[k, 1], [k, n - 2], [1, k], [n - 2, k]] as const) {
        if ((rows[y]?.[x] ?? '.') === '.') put(x, y, glow);
      }
    }
  }
  return out;
}

/**
 * 持ち物のアイコン（size × size）の RGBA: 角を丸めた四角を背景の色で塗り、公式のアイテム画像を縮めたドット絵を真ん中に重ね、枠を付ける
 */
export function itemIconPixels(data: IconConfig, sprite: ItemIcons['items'][string], background: string): Uint8ClampedArray {
  const n = data.size;
  const out = new Uint8ClampedArray(n * n * 4);
  const bg = rgb(background);
  const black: [number, number, number] = [0, 0, 0];
  const frame = rgb(data.frame.base);
  const h = sprite.rows.length;
  const w = sprite.rows[0]?.length ?? 0;
  const ox = Math.floor((n - w) / 2);
  const oy = Math.floor((n - h) / 2);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const ex = Math.min(x, n - 1 - x);
      const ey = Math.min(y, n - 1 - y);
      if (ex + ey < 1) continue;
      const i = (y * n + x) * 4;
      const border = ex === 0 || ey === 0 || ex + ey === 1;
      const ch = sprite.rows[y - oy]?.[x - ox] ?? '.';
      const c = border ? frame : ch !== '.' && sprite.palette[ch] ? rgb(sprite.palette[ch]!) : mix(bg, black, y < n / 2 ? 0.35 : 0.5);
      out.set([c[0], c[1], c[2], 255], i);
    }
  }
  return out;
}

/** レベルの表示のひし形の RGBA（済んだものは段階ごとの色、まだのものは暗い枠だけ） */
export function starPixels(data: IconConfig, on: boolean, tier: IconTier = 'base'): { width: number; height: number; pixels: Uint8ClampedArray } {
  const rows = on ? data.stars.on : data.stars.off;
  const color = rgb(on ? data.pipColors[tier] : data.starColors.off);
  const h = rows.length;
  const w = rows[0]!.length;
  const pixels = new Uint8ClampedArray(w * h * 4);
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      if (row[x] === '.') continue;
      const i = (y * w + x) * 4;
      pixels.set([...color, 255], i);
    }
  });
  return { width: w, height: h, pixels };
}
