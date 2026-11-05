/**
 * 炎で書く字（ホウオウの だいもんじ。07 の207章）: 筆の線（交わる所から外へ向かう折れ線）に沿って、決まった間隔の点を並べる。
 * 当たる範囲と、予告・焦げ跡の絵が同じ点を使う（見えている形と当たる形を同じにする）
 */
export interface GlyphDef {
  readonly strokes: readonly (readonly (readonly [number, number])[])[];
  readonly spacing: number;
}

export interface GlyphPoint {
  readonly x: number;
  readonly y: number;
  /** 交わる所から線に沿って測った距離（火が外へ走る順番に使う） */
  readonly dist: number;
}

const FINE_SPACING = 8;
const cache = new WeakMap<GlyphDef, readonly GlyphPoint[]>();

export function glyphPoints(glyph: GlyphDef): readonly GlyphPoint[] {
  const hit = cache.get(glyph);
  if (hit) return hit;
  const out: GlyphPoint[] = [{ x: 0, y: 0, dist: 0 }];
  for (const stroke of glyph.strokes) {
    let walked = 0;
    let next = glyph.spacing;
    for (let k = 1; k < stroke.length; k++) {
      const [ax, ay] = stroke[k - 1]!;
      const [bx, by] = stroke[k]!;
      const len = Math.hypot(bx - ax, by - ay);
      while (next <= walked + len + 1e-6) {
        const t = (next - walked) / Math.max(1e-6, len);
        out.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t, dist: next });
        next += glyph.spacing;
      }
      walked += len;
    }
  }
  cache.set(glyph, out);
  return out;
}

const fineCache = new WeakMap<GlyphDef, readonly GlyphPoint[]>();
/** 絵を描くための細かい点（予告・焦げ跡をなめらかな線にする） */
export function glyphFinePoints(glyph: GlyphDef): readonly GlyphPoint[] {
  let hit = fineCache.get(glyph);
  if (!hit) {
    hit = glyphPoints({ strokes: glyph.strokes, spacing: FINE_SPACING });
    fineCache.set(glyph, hit);
  }
  return hit;
}

/** 字のいちばん遠い点までの距離 */
export function glyphReach(glyph: GlyphDef): number {
  return glyphPoints(glyph).reduce((m, p) => Math.max(m, p.dist), 0);
}
