/**
 * 技のドット絵（作者の案 2026年10月23日: 光の円・線の代わりに、技ごとのドット絵を描く）を、計算で作る。
 *
 * 細かさをそろえる（作者の決定 2026年10月24日）: ポケモン・マップと同じく「1ドット＝ワールドの 2」にするため、
 * 絵は決まったマス数で作って引き伸ばすのではなく、必要な大きさのマス数で描き直す（drawMoveArt の k = 基準のマス数に対する倍率）。
 * どの絵も「基準のマス数での座標」（論理の座標）で形を決め、実際のマスは k 倍の細かさで塗る。
 * - shape: −1〜1 の座標の式で塗る（そのまま細かくなる）
 * - fill: 論理の座標（小数）で塗る。set: 論理の座標に、k の大きさの丸い点を打つ（根・しぶき）
 * - outline: 輪郭はいつも実際の 1 マス
 *
 * data/render/move-sprites.json（基準の k = 1）は scripts/make-move-sprites.ts が書き出す（技の指定の検証と確認用）。
 * ゲームの中では src/render/effects/MoveSprites.ts が、必要な k で描き直してテクスチャを作る。
 *
 * 公式の画像は使わず、乱数（種を固定）と図形だけで描く。絵ごとに:
 * - palette: 色の一覧。表の 0〜9 が色の番号、. が透明
 * - parts: 絵の部品。main（1枚の絵。円の範囲に合わせる）、start・middle・end（線の始まり・途中・終わり。途中は並べて長さに合わせる）
 * - 部品ごとにコマの並び。frameMs ごとに次のコマへ。loopFrom があれば、最後まで行ったらそのコマから繰り返す（伸びきった後の揺れ）
 */
type Grid = number[][]; // -1 = 透明、0〜 = 色の番号

export interface SpriteOut {
  palette: string[];
  frameMs: number;
  loopFrom?: number;
  parts: Record<string, string[][]>;
}

/** 今描いている細かさ（基準のマス数に対する倍率） */
let K = 1;

/** 種を固定した乱数（mulberry32） */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 論理の大きさ w × h の、実際には k 倍の細かさのマス */
function blank(w: number, h: number): Grid {
  const rw = Math.max(1, Math.round(w * K));
  const rh = Math.max(1, Math.round(h * K));
  return Array.from({ length: rh }, () => Array<number>(rw).fill(-1));
}

/** 実際のマスごとに、論理の座標（小数。マスの中心）で色を決めて塗る（-1 は塗らない） */
function fill(g: Grid, fn: (x: number, y: number) => number): Grid {
  for (let py = 0; py < g.length; py++) {
    for (let px = 0; px < g[0]!.length; px++) {
      const c = fn((px + 0.5) / K - 0.5, (py + 0.5) / K - 0.5);
      if (c >= 0) g[py]![px] = c;
    }
  }
  return g;
}

/** 論理の座標の色（無ければ -1） */
function get(g: Grid, x: number, y: number): number {
  return g[Math.round((y + 0.5) * K - 0.5)]?.[Math.round((x + 0.5) * K - 0.5)] ?? -1;
}

/** 0〜1 の決まった乱数（座標から。並び順に左右されない） */
function hash(a: number, b: number, c = 0): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function toRows(g: Grid): string[] {
  return g.map((row) => row.map((c) => (c < 0 ? '.' : String(c))).join(''));
}

/** 論理の座標に点を打つ（k が大きいときは、論理の 1 マスぶんの丸い点） */
function set(g: Grid, x: number, y: number, c: number): void {
  const cx = (x + 0.5) * K - 0.5;
  const cy = (y + 0.5) * K - 0.5;
  // 細かさが基準に近いときは、1 マスだけ
  if (K < 1.5) {
    const xi = Math.round(cx);
    const yi = Math.round(cy);
    if (yi >= 0 && yi < g.length && xi >= 0 && xi < g[0]!.length) g[yi]![xi] = c;
    return;
  }
  const r = K * 0.6 - 0.1;
  for (let py = Math.round(cy - r); py <= Math.round(cy + r); py++) {
    for (let px = Math.round(cx - r); px <= Math.round(cx + r); px++) {
      if (py < 0 || py >= g.length || px < 0 || px >= g[0]!.length) continue;
      if ((px - cx) ** 2 + (py - cy) ** 2 > (r + 0.35) ** 2) continue;
      g[py]![px] = c;
    }
  }
}

/** 論理の座標の線分に沿って、細かさに合わせた間隔で plot を呼ぶ（基準の細かさでは端の1点だけ） */
function segment(_g: Grid, x0: number, y0: number, x1: number, y1: number, plot: (x: number, y: number) => void): void {
  const n = K < 1.5 ? 1 : Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * K * 0.7));
  for (let i = K < 1.5 ? n : 1; i <= n; i++) plot(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n);
}

/** 色の付いたドットの外側に、輪郭の色を付ける（ドット絵らしく形をはっきりさせる） */
function outline(g: Grid, color: number): Grid {
  const out = g.map((r) => r.slice());
  for (let y = 0; y < g.length; y++) {
    for (let x = 0; x < g[0]!.length; x++) {
      if (g[y]![x]! >= 0) continue;
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => (g[y + dy!]?.[x + dx!] ?? -1) >= 0 && g[y + dy!]![x + dx!] !== color);
      if (near) out[y]![x] = color;
    }
  }
  return out;
}

// ---------------- ハードプラント: 地面を這って広がる根 ----------------
/**
 * 真ん中の根元から、何本もの根がうねりながら外へ這い出し、枝分かれする（上から見た地面）。
 * コマ 0〜3 で伸び、4・5 で先がうねる（loopFrom 4）。根元には若葉
 */
function roots(): SpriteOut {
  const size = 32;
  const c = size / 2;
  // 0 輪郭（こげ茶）・1 根の暗い所・2 根・3 根の明るい所・4 若葉の暗い所・5 若葉
  const palette = ['#2b1a12', '#4e342e', '#795548', '#a1887f', '#558b2f', '#9ccc65'];
  const r = rng(20261023);
  // 根の通り道を先に決める（どのコマでも同じ形で、伸びる長さだけ変える）
  interface Root { pts: [number, number][]; branches: { at: number; pts: [number, number][] }[] }
  const list: Root[] = [];
  const n = 6;
  for (let k = 0; k < n; k++) {
    let a = (k / n) * Math.PI * 2 + (r() - 0.5) * 0.6;
    // 根元のこぶの縁から出す
    let x = c + Math.cos(a) * 2;
    let y = c + Math.sin(a) * 2;
    const pts: [number, number][] = [];
    const len = 12 + Math.floor(r() * 3);
    for (let s = 0; s < len; s++) {
      // うねりながら外へ（真ん中へ戻らないよう、外向きに少し引っぱる）
      a += (r() - 0.5) * 0.6;
      x += Math.cos(a);
      y += Math.sin(a);
      pts.push([x, y]);
    }
    const branches: Root['branches'] = [];
    for (let b = 0; b < 2; b++) {
      const at = 4 + Math.floor(r() * (len - 6));
      const [bx0, by0] = pts[at]!;
      let ba = a + (r() < 0.5 ? -1 : 1) * (0.8 + r() * 0.5);
      let bx = bx0;
      let by = by0;
      const bp: [number, number][] = [];
      for (let s = 0; s < 4 + Math.floor(r() * 3); s++) {
        ba += (r() - 0.5) * 0.8;
        bx += Math.cos(ba);
        by += Math.sin(ba);
        bp.push([bx, by]);
      }
      branches.push({ at, pts: bp });
    }
    list.push({ pts, branches });
  }
  const frame = (grow: number, wiggle: number): Grid => {
    const g = blank(size, size);
    for (const root of list) {
      const shown = Math.max(1, Math.floor(root.pts.length * grow));
      // 先ほどうねる（コマで向きを変える）。点と点の間もつないで描く（細かく描き直したときに数珠つなぎにならないように）
      const at = (s: number): [number, number] => {
        const [x, y] = root.pts[s]!;
        const w = wiggle * Math.sin(s * 0.9 + wiggle * 2) * (s / root.pts.length) * 1.2;
        return [x + w, y - w];
      };
      for (let s = 0; s < shown; s++) {
        const thick = s < root.pts.length * 0.3;
        segment(g, ...(s > 0 ? at(s - 1) : at(s)), ...at(s), (x, y) => {
          set(g, x, y, 2);
          if (thick) {
            set(g, x + 1, y, 1);
            set(g, x, y - 1, 3);
          }
        });
      }
      for (const br of root.branches) {
        if (br.at >= shown) continue;
        const bShown = Math.max(0, Math.floor(br.pts.length * Math.min(1, (grow - br.at / root.pts.length) * 2)));
        const bAt = (s: number): [number, number] => [br.pts[s]![0] + wiggle * Math.sin(s + wiggle) * 0.6, br.pts[s]![1]];
        for (let s = 0; s < bShown; s++) segment(g, ...(s > 0 ? bAt(s - 1) : bAt(s)), ...bAt(s), (x, y) => set(g, x, y, s === 0 ? 1 : 2));
      }
    }
    // 根元（こぶ）と若葉
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) set(g, c + dx, c + dy, dx + dy < 0 ? 3 : 1);
    if (grow >= 0.75) {
      for (const [dx, dy, col] of [[-1, -3, 5], [0, -4, 5], [1, -3, 4], [2, -4, 5], [-2, -4, 4]] as const) set(g, c + dx + (wiggle > 0 ? 1 : 0) * (dy < -3 ? 1 : 0), c + dy, col);
    }
    return outline(g, 0);
  };
  const frames = [frame(0.25, 0), frame(0.5, 0), frame(0.75, 0), frame(1, 0), frame(1, 1), frame(1, -1)];
  return { palette, frameMs: 110, loopFrom: 4, parts: { main: frames.map(toRows) } };
}

// ---------------- ハードプラント: 地面を這って伸びる根（線） ----------------
/**
 * 横向きの1本の根。高さ H。途中の部品は幅 TILE で、並べてもつながる（うねりの周期を幅にそろえる）。
 * 始まりは地面から出る太い根元と土くれ、終わりは細くなる先と細い根。コマごとにうねりを少しずらす（這って見せる）
 */
function rootLine(): SpriteOut {
  const H = 12;
  const TILE = 12;
  // 0 輪郭・1 樹皮の暗い所・2 樹皮・3 樹皮の明るい所・4 土・5 若葉
  const palette = ['#24150e', '#4e342e', '#6d4c41', '#a1887f', '#8d6e63', '#9ccc65'];
  const FRAMES = 3;
  const mid = (H - 1) / 2;
  const cyAt = (x: number, f: number): number => mid + Math.sin(((x + f * 3) / TILE) * Math.PI * 2) * 1.6;
  /** 根の1点の色（x の位置の太さ half のうねる根。外なら -1） */
  const bark = (x: number, y: number, f: number, half: number): number => {
    const cy = cyAt(x, f);
    if (Math.abs(y - cy) > half + 0.5) return -1;
    const d = (y - cy) / Math.max(0.5, half);
    // 上側を明るく、下側を暗く。樹皮の節（斜めの筋）を入れる
    if ((Math.floor(x + y * 2) + 60) % 6 === 0 && Math.abs(d) < 0.8) return 1;
    return d < -0.4 ? 3 : d > 0.45 ? 1 : 2;
  };
  const start: Grid[] = [];
  const middle: Grid[] = [];
  const end: Grid[] = [];
  for (let f = 0; f < FRAMES; f++) {
    middle.push(outline(fill(blank(TILE, H), (x, y) => bark(x, y, f, 2.2)), 0));
    // 始まり: 太い根元が地面から出る（土くれ付き）
    const sOut = outline(fill(blank(TILE, H), (x, y) => bark(x, y, f, 3.6 - (x / TILE) * 1.4)), 0);
    const r = rng(4242 + f);
    for (let k = 0; k < 6; k++) {
      const x = Math.floor(r() * 5);
      const y = r() < 0.5 ? Math.floor(r() * 2) : H - 1 - Math.floor(r() * 2);
      if (get(sOut, x, y) < 0) set(sOut, x, y, 4);
    }
    start.push(sOut);
    // 終わり: 細くなって途切れ、細い根が2本分かれる
    const e = fill(blank(TILE, H), (x, y) => (x < TILE - 2.5 ? bark(x, y, f, Math.max(0.4, 2.2 - (x / (TILE - 3)) * 2)) : -1));
    const tipY = cyAt(TILE - 3, f);
    for (let k = 0; k < 3; k++) {
      set(e, TILE - 6 + k, tipY - 2 - k * 0.7, 2);
      set(e, TILE - 5 + k, tipY + 2 + k * 0.5, 2);
    }
    if (f === 1) set(e, TILE - 8, tipY - 3, 5);
    end.push(outline(e, 0));
  }
  return { palette, frameMs: 120, parts: { start: start.map(toRows), middle: middle.map(toRows), end: end.map(toRows) } };
}

// ---------------- ハイドロポンプ: 水流（始まり・途中・終わり） ----------------
/**
 * 横向きの水流。高さ H。途中の部品は幅 TILE で、並べてもつなぎ目が出ない（波の周期を幅にそろえる）。
 * コマごとに模様を前へずらして、流れて見せる。始まりは口が細く、終わりはしぶき
 */
function stream(): SpriteOut {
  const H = 14;
  const TILE = 8;
  // 0 輪郭（濃い青）・1 濃い青・2 青・3 明るい青・4 水色・5 白（泡）
  const palette = ['#0d2b5c', '#01579b', '#0288d1', '#29b6f6', '#81d4fa', '#ffffff'];
  const FRAMES = 4;
  const mid = (H - 1) / 2;
  // 泡の筋を行ごとにずらす量（横に流れる筋に見せる。並べてもつながるよう、ずらすだけで周期は TILE）
  const ROW_SHIFT = [0, 5, 2, 6, 1, 4, 7, 3, 5, 0, 6, 2, 4, 1];
  /** 流れの中の1点（x は流れの方向の位置。上下の端は波打つ） */
  const water = (x: number, y: number, f: number, half: number): number => {
    const phase = ((x + f * 2) / TILE) * Math.PI * 2;
    const top = mid - half + Math.sin(phase) * 0.6 - 0.5;
    const bottom = mid + half - Math.sin(phase + 1.3) * 0.6 + 0.5;
    if (y < top || y > bottom) return -1;
    const d = Math.abs(y - mid) / Math.max(1, half);
    // 泡の筋: 流れに乗って前へ進む
    const streak = (((x + f * 2 + ROW_SHIFT[(Math.floor(y + 0.5) + H) % H]! + 64) % TILE) + TILE) % TILE;
    if (d < 0.6 && streak < 2) return 5;
    if (d < 0.85 && streak >= 2 && streak < 3) return 4;
    return d > 0.85 ? 1 : d > 0.6 ? 2 : d > 0.3 ? 3 : 4;
  };
  const middle: Grid[] = [];
  const start: Grid[] = [];
  const end: Grid[] = [];
  for (let f = 0; f < FRAMES; f++) {
    middle.push(outline(fill(blank(TILE, H), (x, y) => water(x, y, f, 5)), 0));
    // 始まり: 口が細く、だんだん太くなる
    start.push(outline(fill(blank(TILE, H), (x, y) => water(x, y, f, 2 + (Math.max(0, x) / (TILE - 1)) * 3)), 0));
    // 終わり: 太さを保ったまま途切れ、しぶきが散る
    const EW = 12;
    const r = rng(777 + f * 31);
    const body = outline(fill(blank(EW, H), (x, y) => (x < 4.5 ? water(x, y, f, 5 - Math.max(0, x) * 0.6) : -1)), 0);
    for (let k = 0; k < 14; k++) {
      const x = 4 + Math.floor(r() * (EW - 4));
      const y = Math.round(mid + (r() - 0.5) * (H - 2) * (0.5 + (x / EW) * 0.6));
      const col = r() < 0.5 ? 5 : r() < 0.5 ? 4 : 3;
      if (get(body, x, y) >= 0) continue;
      set(body, x, y, col);
      if (r() < 0.35) set(body, x + 1, y, 4);
    }
    end.push(body);
  }
  return { palette, frameMs: 70, parts: { start: start.map(toRows), middle: middle.map(toRows), end: end.map(toRows) } };
}

// ---------------- 飛ぶ物（案 A）: 形を式で描く ----------------
/**
 * 大きさ size × size のマスに、u・v（−1〜1。u が右、v が下）の式で色を決めて描く（-1 は透明）。
 * rot だけ回した座標で式を呼ぶので、回転したコマも同じ式から作れる（葉っぱ・花びら）。最後に輪郭を付ける
 */
function shape(size: number, fn: (u: number, v: number) => number, rot = 0, edge = 0): Grid {
  const g = blank(size, size);
  const n = g.length;
  const c = Math.cos(-rot);
  const s = Math.sin(-rot);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const px = ((x + 0.5) / n) * 2 - 1;
      const py = ((y + 0.5) / n) * 2 - 1;
      const col = fn(px * c - py * s, px * s + py * c);
      if (col >= 0) g[y]![x] = col;
    }
  }
  return edge >= 0 ? outline(g, edge) : g;
}

/** 左上から光が当たる丸みの明るさ（−1 暗い 〜 1 明るい） */
function light(u: number, v: number, r: number): number {
  return (-u - v) / (Math.SQRT2 * Math.max(0.01, r));
}

/** ひのこ: 右へ進むゆらめく炎（尾は左。コマごとに尾がゆれる） */
function ember(): SpriteOut {
  // 0 輪郭（こげ赤）・1 赤・2 橙・3 黄・4 白
  const palette = ['#5d1a0e', '#d84315', '#ff9800', '#ffeb3b', '#fffde7'];
  const frames = [0, 1, 2].map((f) =>
    shape(16, (u, v) => {
      // 頭の丸（右寄り）と、左へ細くなる尾
      const head = Math.hypot(u - 0.25, v) / 0.5;
      const t = Math.max(0, Math.min(1, (0.3 - u) / 1.25));
      const wob = Math.sin(t * 5 + f * 2.1) * 0.18 * t;
      const tail = u < 0.3 && u > -0.95 && Math.abs(v - wob) < 0.5 * (1 - t) + 0.05;
      if (head > 1 && !tail) return -1;
      const d = head <= 1 ? head * 0.7 : 0.6 + t * 0.6;
      return d < 0.35 ? 4 : d < 0.6 ? 3 : d < 0.85 ? 2 : 1;
    }),
  );
  return { palette, frameMs: 80, parts: { main: frames.map(toRows) } };
}

/** みずでっぽう: 右へ進むしずく */
function waterDrop(): SpriteOut {
  const palette = ['#0d2b5c', '#0277bd', '#29b6f6', '#b3e5fc', '#ffffff'];
  const frames = [0, 1].map((f) =>
    shape(12, (u, v) => {
      const head = Math.hypot(u - 0.3, v) / 0.55;
      const t = Math.max(0, Math.min(1, (0.3 - u) / 1.2));
      const tail = u < 0.3 && u > -0.9 && Math.abs(v) < 0.55 * (1 - t);
      if (head > 1 && !tail) return -1;
      // 左上の光の点（コマで少し動く）
      if (Math.hypot(u - 0.4 + f * 0.08, v + 0.22) < 0.16) return 4;
      const l = light(u - 0.3, v, 0.55);
      return l > 0.45 ? 3 : l > -0.3 ? 2 : 1;
    }),
  );
  return { palette, frameMs: 100, parts: { main: frames.map(toRows) } };
}

/** あわ: うすい膜の泡（コマで少し伸び縮み） */
function bubble(): SpriteOut {
  const palette = ['#01579b', '#4fc3f7', '#b3e5fc', '#e1f5fe', '#ffffff'];
  const frames = [0, 1, 2, 1].map((f) =>
    shape(14, (u, v) => {
      const sx = 0.85 + f * 0.05;
      const sy = 0.95 - f * 0.05;
      const d = Math.hypot(u / sx, v / sy);
      if (d > 1) return -1;
      if (Math.hypot(u + 0.35, v + 0.4) < 0.18) return 4;
      if (d > 0.82) return 1;
      if (d > 0.68 && u + v < -0.2) return 2;
      // 中は透明。右下に うすい照り返し
      return d > 0.55 && u + v > 0.5 ? 3 : -1;
      // 中が透明なので輪郭は付けない（ふちの濃い色が輪郭の代わり）
    }, 0, -1),
  );
  return { palette, frameMs: 120, parts: { main: frames.map(toRows) } };
}

/** 葉っぱ（はっぱカッター）・花びら（はなびらのまい）: 線に並べる。コマで回る */
function leafLine(kind: 'leaf' | 'petal'): SpriteOut {
  const palette =
    kind === 'leaf' ? ['#1b3d14', '#33691e', '#558b2f', '#8bc34a', '#c5e1a5'] : ['#6a1b3a', '#c2185b', '#f06292', '#f8bbd0', '#ffffff'];
  const one = (rot: number): Grid =>
    shape(12, (u, v) => {
      // 葉: 先のとがった細長い形。花びら: 丸く先に切れ込み
      const inside = kind === 'leaf' ? (u / 0.95) ** 2 + (v / (0.42 * (1 - Math.abs(u) * 0.35))) ** 2 < 1 : (u / 0.8) ** 2 + (v / 0.55) ** 2 < 1 && !(u > 0.55 && Math.abs(v) < 0.12);
      if (!inside) return -1;
      if (kind === 'leaf' && Math.abs(v) < 0.08 && u > -0.85) return 1;
      const l = light(u, v, 0.8);
      return l > 0.4 ? 4 : l > -0.1 ? 3 : 2;
    }, rot);
  const frames = [0, 1, 2, 3].map((f) => {
    // 途中の部品: 幅 12 に葉を1枚（回る角度は場所ごとにずらさず、コマで回す）
    return one((f * Math.PI) / 4 + 0.4);
  });
  const rows = frames.map(toRows);
  return { palette, frameMs: 70, parts: { start: rows, middle: rows, end: rows } };
}

/** いわおとし・いわなだれ（岩）・ストーンエッジ（とがった石） */
function rock(kind: 'rock' | 'stone'): SpriteOut {
  const palette = kind === 'rock' ? ['#2b211b', '#5d4037', '#8d6e63', '#a1887f', '#d7ccc8'] : ['#1c2833', '#37474f', '#607d8b', '#90a4ae', '#eceff1'];
  const r = rng(kind === 'rock' ? 99 : 123);
  // ごつごつ: 角度ごとの半径をばらつかせる。石は 4 つの尖り
  const radii = Array.from({ length: 12 }, () => 0.72 + r() * 0.25);
  const g = shape(16, (u, v) => {
    const a = Math.atan2(v, u);
    const d = Math.hypot(u, v);
    let rr: number;
    if (kind === 'rock') {
      const k = ((a + Math.PI) / (Math.PI * 2)) * 12;
      const i = Math.floor(k) % 12;
      rr = radii[i]! + (radii[(i + 1) % 12]! - radii[i]!) * (k - Math.floor(k));
    } else {
      // とがった石の破片: 横に長いひし形（先が鋭い）
      rr = 1 / (Math.abs(Math.cos(a)) / 0.95 + Math.abs(Math.sin(a)) / 0.42);
    }
    if (d > rr) return -1;
    // ひび
    if (kind === 'rock' && Math.abs(u * 0.6 - v - 0.1) < 0.07 && d < rr * 0.8) return 1;
    // 石は面ごとに色を分ける
    // 石は面ごとに色を分ける（上の面が明るい。真ん中に稜線）
    if (kind === 'stone') return Math.abs(v) < 0.06 ? 4 : v < 0 ? (u < 0 ? 3 : 4) : u < 0 ? 1 : 2;
    const l = light(u, v, rr);
    return l > 0.5 ? 4 : l > 0.05 ? 3 : l > -0.45 ? 2 : 1;
  });
  return { palette, frameMs: 1000, parts: { main: [toRows(g)] } };
}

/** ホネブーメラン・ボーンラッシュ: 骨（回して飛ばす） */
function bone(): SpriteOut {
  const palette = ['#3e2f1c', '#a1887f', '#d7ccc8', '#efebe9', '#ffffff'];
  const g = shape(16, (u, v) => {
    const knob = [[-0.7, -0.22], [-0.7, 0.22], [0.7, -0.22], [0.7, 0.22]].some(([x, y]) => Math.hypot(u - x!, v - y!) < 0.24);
    const shaft = Math.abs(u) < 0.72 && Math.abs(v) < 0.14;
    if (!knob && !shaft) return -1;
    return v < -0.05 ? 4 : v < 0.1 ? 3 : 2;
  });
  return { palette, frameMs: 1000, parts: { main: [toRows(g)] } };
}

/** スピードスター: 星（回す。コマで中が瞬く） */
function star(): SpriteOut {
  const palette = ['#7a4a00', '#ff9800', '#ffd54f', '#fff59d', '#ffffff'];
  const frames = [0, 1].map((f) =>
    shape(14, (u, v) => {
      // 五角の星: 角の向きからのずれで半径を内側 0.42・外側 0.98 の間で変える（とがった形）
      const a = Math.atan2(v, u) + Math.PI / 2;
      const d = Math.hypot(u, v);
      const seg = (Math.PI * 2) / 5;
      const off = Math.abs((((a % seg) + seg) % seg) - seg / 2) / (seg / 2);
      const rr = 0.42 + 0.56 * off ** 1.4;
      if (d > rr) return -1;
      if (d < 0.18 + f * 0.1) return 4;
      return d < rr * 0.55 ? 3 : 2;
    }),
  );
  return { palette, frameMs: 90, parts: { main: frames.map(toRows) } };
}

/** どくばり: 右を向いた細い針（先が紫） */
function needle(): SpriteOut {
  const palette = ['#2a1033', '#6a1b9a', '#ab47bc', '#cfd8dc', '#ffffff'];
  const g = shape(14, (u, v) => {
    if (u < -0.95 || u > 0.98) return -1;
    // 根元が太く、先が鋭い
    const w = 0.3 * (1 - (u + 0.95) / 1.93) + 0.04;
    if (Math.abs(v) > w) return -1;
    if (u > 0.45) return 2;
    return v < 0 ? 4 : 3;
  });
  return { palette, frameMs: 1000, parts: { main: [toRows(g)] } };
}

/** ヘドロばくだん: 紫のぶよぶよした泥の玉（コマでふちが揺れ、泡が浮く） */
function sludge(): SpriteOut {
  const palette = ['#2a0d33', '#7b1fa2', '#ab47bc', '#ce93d8', '#f3e5f5'];
  const frames = [0, 1, 2].map((f) =>
    shape(16, (u, v) => {
      const a = Math.atan2(v, u);
      const rr = 0.78 + Math.sin(a * 5 + f * 2) * 0.08 + Math.sin(a * 3 - f) * 0.05;
      const d = Math.hypot(u, v);
      if (d > rr) return -1;
      // 泡
      if (Math.hypot(u - 0.25 + f * 0.05, v + 0.15 - f * 0.12) < 0.13) return 4;
      if (Math.hypot(u + 0.3, v - 0.25 + f * 0.08) < 0.09) return 3;
      const l = light(u, v, rr);
      return l > 0.45 ? 3 : l > -0.3 ? 2 : 1;
    }),
  );
  return { palette, frameMs: 110, parts: { main: frames.map(toRows) } };
}

/** シャドーボール（黒紫の玉に渦）・はどうだん（青い玉に波の輪）。コマで模様が回る */
function orb(kind: 'shadow' | 'aura'): SpriteOut {
  const palette = kind === 'shadow' ? ['#0b0410', '#1a0b24', '#4a148c', '#7e57c2', '#d1c4e9'] : ['#06264d', '#0d47a1', '#1e88e5', '#64b5f6', '#e3f2fd'];
  const frames = [0, 1, 2, 3].map((f) =>
    shape(16, (u, v) => {
      const d = Math.hypot(u, v);
      if (d > 0.9) return -1;
      const a = Math.atan2(v, u) + (f * Math.PI) / 2;
      if (kind === 'shadow') {
        // 渦の筋
        const swirl = Math.sin(a * 2 + d * 7);
        if (d < 0.25) return 1;
        return swirl > 0.55 ? 4 : swirl > 0 ? 3 : d > 0.75 ? 2 : 1;
      }
      // はどうだん: 中が明るく、外へ広がる波の輪
      const ring = Math.sin(d * 14 - f * 1.6 + Math.sin(a * 3) * 0.6);
      if (d < 0.3) return 4;
      return ring > 0.4 ? 3 : d > 0.75 ? 1 : 2;
    }),
  );
  return { palette, frameMs: 90, parts: { main: frames.map(toRows) } };
}

/** 線用の絵（葉・花びら）の途中の部品を、1枚の絵（main）として使う（放射状に飛ばす・うずで回す） */
function single(sp: SpriteOut): SpriteOut {
  return { ...sp, parts: { main: sp.parts.middle! } };
}

/** トライアタック: 三角の3つの角が ほのお（赤）・こおり（水色）・でんき（黄）の玉。回して飛ばす */
function triOrb(): SpriteOut {
  const palette = ['#1a1a2e', '#e53935', '#ff8a65', '#29b6f6', '#b3e5fc', '#fdd835', '#fff59d', '#ffffff'];
  const corners = [0, 1, 2].map((k) => [Math.cos(-Math.PI / 2 + (k * Math.PI * 2) / 3) * 0.6, Math.sin(-Math.PI / 2 + (k * Math.PI * 2) / 3) * 0.6] as const);
  const g = shape(16, (u, v) => {
    for (let k = 0; k < 3; k++) {
      const [cx, cy] = corners[k]!;
      const d = Math.hypot(u - cx, v - cy);
      if (d < 0.36) return d < 0.15 ? 7 : [2, 4, 6][k]! - (d > 0.26 ? 1 : 0);
    }
    // 角をつなぐ白い三角の線
    const inTri = corners.every(([cx, cy], k) => {
      const [nx, ny] = corners[(k + 1) % 3]!;
      return (nx - cx) * (v - cy) - (ny - cy) * (u - cx) >= -0.02;
    });
    const nearEdge = corners.some(([cx, cy], k) => {
      const [nx, ny] = corners[(k + 1) % 3]!;
      const len = Math.hypot(nx - cx, ny - cy);
      return Math.abs((nx - cx) * (cy - v) - (cx - u) * (ny - cy)) / len < 0.07;
    });
    return inTri && nearEdge ? 7 : -1;
  });
  return { palette, frameMs: 1000, parts: { main: [toRows(g)] } };
}

/**
 * はかいこうせん: 白と黒が入れ替わりながらチカチカするレーザー（作者の決定 2026年10月23日）。
 * 偶数のコマは白い芯に黒いふち、奇数のコマは黒い芯に白いふち。始まりは丸い光、終わりは広がる光
 */
function hyperBeam(palette = ['#0a0a0a', '#3a3a3a', '#8a8a8a', '#d6d6d6', '#ffffff'], flicker = true): SpriteOut {
  const H = 12;
  const TILE = 8;
  // 0 黒・1 濃い灰・2 灰・3 明るい灰・4 白（色を変えると色違いの光線。flicker なら1コマおきに明暗を入れかえる）
  const mid = (H - 1) / 2;
  const tone = (d: number, inv: boolean): number => {
    const c = d < 0.45 ? 4 : d < 0.7 ? 3 : d < 0.88 ? 2 : 0;
    return inv ? 4 - c : c;
  };
  const start: Grid[] = [];
  const middle: Grid[] = [];
  const end: Grid[] = [];
  for (let f = 0; f < 4; f++) {
    const inv = flicker && f % 2 === 1;
    middle.push(fill(blank(TILE, H), (_x, y) => tone(Math.min(1, Math.abs(y - mid) / (H / 2)), inv)));
    // 始まり: 丸く光る口
    start.push(
      fill(blank(TILE, H), (x, y) => {
        const d = Math.hypot((x - (TILE - 1)) / TILE, (y - mid) / (H / 2));
        return x >= TILE - 2.5 || d < 1 ? tone(Math.min(1, Math.abs(y - mid) / (H / 2) + Math.max(0, TILE - 1 - x) * 0.06), inv) : -1;
      }),
    );
    // 終わり: 先で広がって消える光
    const EW = 10;
    end.push(
      fill(blank(EW, H), (x, y) => {
        const half = 1 - Math.max(0, x) / EW;
        const d = Math.abs(y - mid) / (H / 2);
        if (d >= half + 0.15 || (x >= 5.5 && Math.floor(x + y + f) % 2 !== 0)) return -1;
        return tone(d / Math.max(0.2, half + 0.15), inv);
      }),
    );
  }
  return { palette, frameMs: 50, parts: { start: start.map(toRows), middle: middle.map(toRows), end: end.map(toRows) } };
}

// ---------------- 線の技（案 B） ----------------
/** 線の部品（始まり・途中・終わり）を、同じ作り方でまとめて作る。col(gx, y, f, part) が色（-1 透明） */
function lineParts(H: number, widths: { start: number; middle: number; end: number }, frames: number, col: (x: number, y: number, f: number, part: 'start' | 'middle' | 'end') => number, edge = 0): Record<string, string[][]> {
  const out: Record<string, string[][]> = { start: [], middle: [], end: [] };
  for (const part of ['start', 'middle', 'end'] as const) {
    for (let f = 0; f < frames; f++) {
      const g = fill(blank(widths[part], H), (x, y) => col(x, y, f, part));
      out[part]!.push(toRows(edge >= 0 ? outline(g, edge) : g));
    }
  }
  return out;
}

/**
 * 10まんボルト・でんきショック: ギザギザの稲妻。途中の部品は、端で真ん中の高さに戻るジグザグ（並べるとつながる）。
 * コマごとにジグザグの形を変えて、ちらつかせる
 */
function lightning(): SpriteOut {
  const H = 12;
  const TILE = 8;
  // 0 輪郭（こい紺）・1 黄・2 うすい黄・3 白
  const palette = ['#1a1440', '#fdd835', '#fff59d', '#ffffff'];
  const mid = Math.floor(H / 2);
  const r = rng(555);
  // コマごとのジグザグ: 幅 TILE の中で 2 回折れる（端は真ん中）
  const paths = Array.from({ length: 4 }, () => {
    const a = mid + Math.round((r() - 0.5) * 7);
    const b = mid + Math.round((r() - 0.5) * 7);
    return (x: number): number => {
      const pts = [[0, mid], [3, a], [5, b], [TILE, mid]] as const;
      for (let k = 0; k < 3; k++) {
        const [x0, y0] = pts[k]!;
        const [x1, y1] = pts[k + 1]!;
        if (x >= x0 && x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      }
      return mid;
    };
  });
  const parts = lineParts(H, { start: 4, middle: TILE, end: 4 }, 4, (x, y, f, part) => {
    if (part !== 'middle') {
      // 始まり・終わり: 小さな火花
      const d = Math.hypot(x - (part === 'start' ? 3 : 0), y - mid);
      return d < 1.2 ? 3 : d < 2.2 ? 2 : (Math.floor(x + 0.5) + Math.floor(y + 0.5) + f) % 3 === 0 && d < 3.5 ? 1 : -1;
    }
    const py = paths[f]!(x);
    const prev = paths[f]!(Math.max(0, x - 1));
    const lo = Math.min(py, prev) - 0.6;
    const hi = Math.max(py, prev) + 0.6;
    if (y >= lo && y <= hi) return 3;
    if (y >= lo - 1 && y <= hi + 1) return 2;
    return -1;
  });
  return { palette, frameMs: 40, parts };
}

/** れいとうビーム: 水色の光線に、ふちから氷の結晶がとげのように出る。コマで きらめきが流れる */
function iceBeam(): SpriteOut {
  const H = 14;
  const TILE = 8;
  const palette = ['#0b2a45', '#4fc3f7', '#b3e5fc', '#e1f5fe', '#ffffff'];
  const mid = (H - 1) / 2;
  const parts = lineParts(H, { start: 6, middle: TILE, end: 8 }, 4, (x, y, f, part) => {
    const d = Math.abs(y - mid);
    const taper = part === 'start' ? 0.5 + x / 12 : part === 'end' ? 1 - x / 10 : 1;
    const half = 3.2 * taper;
    // 結晶のとげ（途中の部品の決まった位置）
    // 上は x=1〜3、下は x=5〜7 に斜めの結晶（上下交互）
    const up = y < mid;
    const k = up ? x - 1 : x - 5;
    if (part === 'middle' && k >= -0.5 && k <= 2.5 && d >= half && d < half + 3 - k) return k < 0.5 ? 4 : 3;
    if (d > half) return -1;
    if ((x + f * 2 + TILE * 4) % TILE < 1 && d < 1.5) return 4;
    return d < half * 0.4 ? 4 : d < half * 0.75 ? 3 : 2;
  });
  return { palette, frameMs: 70, parts };
}

/** オーロラビーム: 虹色の帯（色の段がコマごとに上へずれていく） */
function auroraBeam(): SpriteOut {
  const H = 12;
  const TILE = 8;
  const palette = ['#2a1a40', '#ff8a80', '#ffd180', '#ffff8d', '#b9f6ca', '#80d8ff', '#ea80fc'];
  const mid = (H - 1) / 2;
  const parts = lineParts(H, { start: 4, middle: TILE, end: 6 }, 6, (x, y, f, part) => {
    const taper = part === 'start' ? 0.6 + x / 10 : part === 'end' ? 1 - x / 8 : 1;
    const wave = Math.sin(((x + f) / TILE) * Math.PI * 2) * 0.6;
    const d = Math.abs(y - mid - wave);
    if (d > 4.6 * taper) return -1;
    return 1 + ((Math.floor(y - wave) + f + 60) % 6);
  });
  return { palette, frameMs: 80, parts };
}

/** サイケこうせん: ピンクと紫の輪が連なって進む（輪の位置がコマで前へ動く） */
function psyBeam(): SpriteOut {
  const H = 14;
  const TILE = 8;
  const palette = ['#2a0f2e', '#8e24aa', '#ce93d8', '#f48fb1', '#fce4ec'];
  const mid = (H - 1) / 2;
  const parts = lineParts(H, { start: 4, middle: TILE, end: 6 }, 4, (x, y, f, part) => {
    const d = Math.abs(y - mid);
    if (part === 'start') return d < 2 + x * 0.5 ? (d < 1 ? 4 : 3) : -1;
    if (part === 'end') return d < 3 - x * 0.4 ? (d < 1.2 ? 4 : 2) : -1;
    // 細い芯と、たての楕円の輪
    if (d < 1) return 4;
    const ringX = (f * 2) % TILE;
    const dx = Math.min(Math.abs(x - ringX), TILE - Math.abs(x - ringX));
    const e = (dx / 1.6) ** 2 + (d / 6) ** 2;
    if (e < 1 && e > 0.45) return dx < 0.8 ? 3 : 1;
    return d < 2 ? 2 : -1;
  });
  return { palette, frameMs: 70, parts };
}


/**
 * かえんほうしゃ・バブルこうせん: 扇形に引き伸ばす1枚の絵（右向き。左端が口）。
 * 炎は先へ行くほど広がる舌のような形がゆらめき、泡は大小の泡が散らばる
 */
function cone(kind: 'flame' | 'bubble' | 'sound' | 'electric'): SpriteOut {
  const W = 32;
  const H = 16;
  const palette =
    kind === 'flame' ? ['#4a0e05', '#c62828', '#ef6c00', '#ffb300', '#fff176', '#ffffff'] : kind === 'electric' ? ['#1a1440', '#f9a825', '#fdd835', '#ffffff', '#fff59d', '#ffffff'] : kind === 'sound' ? ['#880e4f', '#ec407a', '#f8bbd0', '#ffffff', '#fce4ec', '#ffffff'] : ['#01395e', '#0288d1', '#4fc3f7', '#b3e5fc', '#e1f5fe', '#ffffff'];
  const frames: Grid[] = [];
  for (let f = 0; f < 4; f++) {
    if (kind === 'electric') {
      // でんじは: 扇の中を根元から外へ進む、ぎざぎざの電気の弧（コマで外へ進み、4コマでつながる）
      const mid = (H - 1) / 2;
      const g = fill(blank(W, H), (x, y) => {
        const t = Math.max(0, Math.min(1, x / (W - 1)));
        const half = (H / 2) * (0.25 + 0.75 * t);
        if (Math.abs(y - mid) / Math.max(0.5, half) > 1) return -1;
        // 弧を縦の位置ごとに左右へずらして、ぎざぎざにする
        const zig = (Math.floor(y / 2) % 2 === 0 ? 1 : -1) * 0.5;
        const r = x - 0.22 * (y - mid) ** 2 + zig;
        const ph = (r - f * 2) / 8;
        const k = Math.abs(ph - Math.round(ph));
        if (k < 0.05) return 3;
        if (k < 0.1) return 2;
        return -1;
      });
      frames.push(g);
      continue;
    }
    if (kind === 'sound') {
      // 音の波（ハイパーボイス）: 扇の中に、根元から外へ進む「)))」の弧（コマで外へ進み、4コマでつながる）
      const mid = (H - 1) / 2;
      const g = fill(blank(W, H), (x, y) => {
        const t = Math.max(0, Math.min(1, x / (W - 1)));
        const half = (H / 2) * (0.25 + 0.75 * t);
        if (Math.abs(y - mid) / Math.max(0.5, half) > 1) return -1;
        // 端ほど後ろへ反らせて「)」の形にする（根元を中心にした弧は細い扇の中ではほぼまっすぐに見える）
        const r = x - 0.22 * (y - mid) ** 2;
        const ph = (r - f * 2) / 8;
        const k = Math.abs(ph - Math.round(ph));
        if (k < 0.07) return x < 12 ? 3 : 2;
        if (k < 0.13) return 1;
        return -1;
      });
      frames.push(outline(g, 0));
      continue;
    }
    if (kind === 'flame') {
      const g = fill(blank(W, H), (x, y) => {
        const t = Math.max(0, Math.min(1, x / (W - 1)));
        // 先へ行くほど広がり、ふちがゆらめく
        const half = (H / 2) * (0.2 + 0.8 * t) + Math.sin(x * 0.7 + f * 1.7) * 1.2 * t;
        const d = Math.abs(y - (H - 1) / 2) / Math.max(0.5, half);
        if (d > 1) return -1;
        // 先の 2 割は、ちぎれて消えていく。根元ほど白く熱い。ちらつく点（論理の 1 マスごとに決まる乱数）
        const noise = hash(Math.floor(x), Math.floor(y), 300 + f);
        if (t > 0.8 && noise < (t - 0.8) * 4.5) return -1;
        const heat = (1 - t) * 0.7 + (1 - d) * 0.6 + (hash(Math.floor(x * 2), Math.floor(y * 2), f) - 0.5) * 0.2;
        return heat > 1.05 ? 5 : heat > 0.85 ? 4 : heat > 0.65 ? 3 : heat > 0.4 ? 2 : 1;
      });
      frames.push(outline(g, 0));
    } else {
      // 泡: 扇形の中に大小の泡を散らす（先ほど大きい）
      const r = rng(400 + f);
      const bubbles = Array.from({ length: 22 }, (_, k) => {
        const t = r();
        const cx = 2 + t * (W - 4);
        const half = (H / 2) * (0.2 + 0.8 * t);
        const cy = (H - 1) / 2 + (r() * 2 - 1) * (half - 1) + Math.sin(f + k) * 0.6;
        return { cx, cy, rad: 0.8 + t * 1.8 + r() * 0.6 };
      });
      frames.push(
        fill(blank(W, H), (x, y) => {
          let c = -1;
          for (const b of bubbles) {
            const d = Math.hypot(x - b.cx, y - b.cy) / b.rad;
            if (d > 1) continue;
            if (d > 0.7) c = 2;
            else if (x < b.cx && y < b.cy) c = 5;
            else if (c < 0) c = 4;
          }
          return c;
        }),
      );
    }
  }
  return { palette, frameMs: 80, parts: { main: frames.map(toRows) } };
}

// ---------------- 地面・範囲（案 C） ----------------
/**
 * じしん・マグニチュード: 輪に沿って並べる、割れた地面の帯（横 = 輪の向き、縦 = 外へ向かう向き）。
 * 土の帯の真ん中をギザギザの割れ目が走り、ふちに石くれ。並べてもつながるよう、割れ目は端で真ん中に戻す
 */
function quakeCrack(): SpriteOut {
  const W = 12;
  const H = 8;
  // 0 輪郭・1 割れ目（こげ茶）・2 土の暗い所・3 土・4 土の明るい所・5 石くれ
  // 土と石（丸太に見えないよう、明るい土に暗い割れ目だけを入れる）
  const palette = ['#2a1d14', '#24170f', '#7b6352', '#9c8470', '#b8a38e', '#d7ccc8'];
  const mid = Math.floor((H - 1) / 2);
  const frames: Grid[] = [];
  for (let f = 0; f < 2; f++) {
    const r = rng(910 + f);
    // 石くれ: ふちから飛び出す（列ごと。上か下か）
    const stones = Array.from({ length: W }, () => (r() < 0.35 ? (r() < 0.5 ? 0 : H - 1) : -1));
    const g = fill(blank(W, H), (x, y) => {
      const xi = Math.max(0, Math.min(W - 1, Math.floor(x + 0.5)));
      if (stones[xi] !== -1 && Math.abs(y - stones[xi]!) < 0.5) return 5;
      if (y < 0.5 || y > H - 1.5) return -1;
      // 割れ目の高さ: 端で真ん中、間で上下に折れる
      const crack = mid + Math.sin((x / W) * Math.PI * 2) * 1.6 + (xi === 3 || xi === 8 ? (f ? 1 : -1) : 0);
      const d = Math.abs(y - crack);
      return d < 0.5 ? 1 : d < 1.5 ? 2 : y < mid ? 4 : 3;
    });
    frames.push(outline(g, 0));
  }
  return { palette, frameMs: 90, parts: { middle: frames.map(toRows) } };
}

/** ふぶき・こなゆき: 六つの枝の雪の結晶（回して飛ばす） */
function snowflake(): SpriteOut {
  const palette = ['#0d3550', '#81d4fa', '#e1f5fe', '#ffffff'];
  const g = shape(13, (u, v) => {
    const d = Math.hypot(u, v);
    if (d > 0.95) return -1;
    const a = Math.atan2(v, u);
    const seg = Math.PI / 3;
    const off = Math.abs((((a % seg) + seg) % seg) - seg / 2);
    // 枝: 角度のずれが小さい所（中心へ近いほど太い）
    const arm = Math.abs(Math.sin(seg / 2 - off)) * d;
    if (arm < 0.11) return d < 0.3 ? 3 : 2;
    // 枝の小枝
    if (d > 0.45 && d < 0.65 && arm < 0.24) return 1;
    return d < 0.18 ? 3 : -1;
  });
  return { palette, frameMs: 1000, parts: { main: [toRows(g)] } };
}

/** スモッグ・ヘドロウェーブ: 毒の煙のかたまり（ふくらんだ雲がゆっくり渦を巻く） */
function poisonCloud(): SpriteOut {
  const palette = ['#1f0a26', '#4a148c', '#7b1fa2', '#9c27b0', '#ce93d8', '#e1bee7'];
  const frames: Grid[] = [];
  for (let f = 0; f < 4; f++) {
    const r = rng(77);
    // 雲のかたまり: 円の中に小さな円（もくもく）を並べる。コマで回す
    const puffs = Array.from({ length: 9 }, (_, k) => {
      const a = (k / 9) * Math.PI * 2 + (f * Math.PI) / 8;
      const rr = 0.45 + r() * 0.2;
      return [Math.cos(a) * rr, Math.sin(a) * rr, 0.32 + r() * 0.12] as const;
    });
    const g = shape(24, (u, v) => {
      let inside = Math.hypot(u, v) < 0.5;
      let lit = false;
      for (const [cx, cy, pr] of puffs) {
        const d = Math.hypot(u - cx, v - cy);
        if (d < pr) {
          inside = true;
          // 膨らみの左上だけを明るく（丸く見せる）
          if (Math.hypot(u - cx + pr * 0.35, v - cy + pr * 0.35) < pr * 0.35) lit = true;
        }
      }
      if (!inside) return -1;
      if (lit) return 4;
      const l = light(u, v, 0.9);
      // 渦の筋
      const swirl = Math.sin(Math.atan2(v, u) * 2 + Math.hypot(u, v) * 6 - f * 1.2);
      return swirl > 0.9 ? 3 : l > 0.35 ? 3 : l > -0.35 ? 2 : 1;
    });
    frames.push(g);
  }
  return { palette, frameMs: 180, parts: { main: frames.map(toRows) } };
}

// ---------------- 体で当たる技（案 D） ----------------
/**
 * ほのおのキバ: 右を向いて上下のあごが閉じる牙（3コマで 開く → 半分 → 閉じる）。牙のまわりに炎のふち。
 * かみつく・かみくだく は同じ形で、あくタイプの色（黒いふち・こげ茶のあご）
 */
function fangBite(palette = ['#3b0d06', '#e53935', '#ff7043', '#cfc4bd', '#ffffff']): SpriteOut {
  const S = 16;
  // 0 輪郭・1 ふち（炎）・2 あご・3 牙の影・4 牙
  const frames: Grid[] = [];
  const mid = (S - 1) / 2;
  // 牙の先と先のすき間（開く → 半分 → 噛み合う）
  for (const gap of [6, 3, -1]) {
    const tip = (S - gap) / 2 - 1;
    // 牙: 上あごから下向き、下あごから上向きの三角を 2 本ずつ（左右にずらして噛み合う）
    const fang = (x: number, y: number, cx: number, down: boolean): number => {
      const k = down ? y - 3 : S - 4 - y;
      if (k < -0.5 || k > tip - 2 + 0.5) return -1;
      const half = Math.max(0, 1.6 - (Math.max(0, k) / Math.max(1, tip - 2)) * 1.6);
      return Math.abs(x - cx) <= half + 0.5 ? (x < cx ? 3 : 4) : -1;
    };
    const g = fill(blank(S, S), (x, y) => {
      for (const [cx, down] of [[5, true], [10, true], [7, false], [12, false]] as const) {
        const c = fang(x, y, cx, down);
        if (c >= 0) return c;
      }
      // 上あご・下あご（横長の弧）
      if (x < 1.5 || x > S - 2.5) return -1;
      const arch = Math.abs(x - mid) / 3;
      if (y >= 0.5 + arch && y < 2.5 + arch) return 2;
      if (y >= S - 3.5 - arch && y < S - 1.5 - arch) return 2;
      return -1;
    });
    frames.push(outline(outline(g, 1), 0));
  }
  return { palette, frameMs: 50, parts: { main: frames.map(toRows) } };
}

/**
 * かみつく・ほのおのキバ（作者の指摘 2026年10月27日: 正面の絵を1枚作り、どの向きでも回さずに使う）: 正面から見た、上のキバの列と下のキバの列。
 * 上の列はカメラに近いので広く大きく（両はしに長い犬歯）、下の列は狭く小さい。歯ぐきは上が ∩、下が ∪ に少し反る。上下から閉じ、閉じた所で光る。
 * fire は ほのおのキバ（赤い歯ぐきのふちから炎の舌が立つ）、dark は かみつく（あくの紫）
 */
function fangFace(kind: 'fire' | 'dark' | 'crunch', slope = 0, alignInner = false): SpriteOut {
  // 0 輪郭・1 歯ぐき（濃い）・2 歯ぐき（明るい）・3 炎・光・4 歯の影・5 白
  // crunch は かみくだく の下向き・上向き（黒い歯ぐきと白いキバ。光も灰）
  const palette =
    kind === 'fire'
      ? ['#3b0d06', '#c62828', '#ff7043', '#ffca28', '#f3d6c8', '#ffffff']
      : kind === 'crunch'
        ? ['#000000', '#0a0a0a', '#2a2a2a', '#5a5a5a', '#d6d6d6', '#ffffff']
        : ['#16071f', '#3d1060', '#7b1fa2', '#ce93d8', '#e7c6f0', '#ffffff'];
  const STEPS = [[0.34, 0, 0], [0.17, 0, 0], [-0.04, 1, 0], [-0.04, 0.6, 1], [-0.04, 0, 2]] as const;
  const tooth = (u: number, v: number, x: number, y0: number, dir: number, len: number, w: number): number => {
    const k = ((v - y0) * dir) / len;
    if (k < 0 || k > 1) return -1;
    const half = w * (1 - k);
    if (Math.abs(u - x) > half + 0.012) return -1;
    return u < x - half * 0.2 ? 4 : 5;
  };
  // 斜め（かみくだく。作者の指摘 2026年10月28日）: slope で右ほど下（負なら上）へ縦にずらす（回さない。キバと閉じる向きは画面の縦のまま）。
  // alignInner なら、下の列（狭い）を中央ではなく左（プレイヤーの側）の端にそろえる
  const lowShift = alignInner ? -(0.7 - 0.5) : 0;
  const zoom = slope !== 0 ? 1.12 : 1;
  const frames = STEPS.map(([gap, flash, fade], f) =>
    shape(32, (x, y) => {
      const u = x * zoom;
      const v = (y - x * slope) * zoom;
      // 閉じた所の光と火花
      if (flash > 0) {
        const d = Math.hypot(u, v);
        // かみくだく は白をキバだけにする（真ん中の光は描かず、火花は灰）
        if (d < 0.2 * flash && kind !== 'crunch') return d < 0.1 * flash ? 5 : 3;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2 + 0.2;
          const along = u * Math.cos(a) + v * Math.sin(a);
          const across = -u * Math.sin(a) + v * Math.cos(a);
          if (along > 0.24 && along < 0.24 + 0.28 * flash && Math.abs(across) < 0.035) return along < 0.34 && kind !== 'crunch' ? 5 : 3;
        }
      }
      if (fade === 2) return hash(Math.floor((u + 1) * 12), Math.floor((v + 1) * 12), 71 + f) < 0.07 && Math.abs(v) < 0.45 && Math.abs(u) < 0.7 ? 3 : -1;
      // 上の列: 歯ぐきのふち（下の線）は ∩ に反り、両はしが下がる
      const upGum = -gap - 0.06 + u * u * 0.18;
      const loGum = gap + 0.1 - (u - lowShift) * (u - lowShift) * 0.22;
      for (const [x, len, w] of [[-0.5, 0.44, 0.13], [0.5, 0.44, 0.13], [-0.25, 0.17, 0.08], [0, 0.17, 0.08], [0.25, 0.17, 0.08]] as const) {
        const c = tooth(u, v, x, upGum, 1, len, w);
        if (c >= 0) return c;
      }
      for (const [x, len, w] of [[-0.34, 0.32, 0.1], [0.34, 0.32, 0.1], [-0.11, 0.12, 0.065], [0.11, 0.12, 0.065]] as const) {
        const c = tooth(u, v, x + lowShift, loGum, -1, len, w);
        if (c >= 0) return c;
      }
      const cut = (c: number): number => (fade === 1 && c <= 2 && hash(Math.floor((u + 1) * 16), Math.floor((v + 1) * 16), 73) < 0.5 ? -1 : c);
      // 上の歯ぐき（厚み 0.14・幅 0.7）と、炎の舌（ほのおのキバ）
      if (Math.abs(u) < 0.7 && v <= upGum && v >= upGum - 0.14) return cut(v < upGum - 0.08 ? 1 : 2);
      if (kind === 'fire' && Math.abs(u) < 0.7) {
        const h = 0.12 + Math.max(0, Math.sin(u * 13 + f * 2.3)) * 0.14;
        if (v < upGum - 0.14 && v >= upGum - 0.14 - h) return cut(v < upGum - 0.14 - h * 0.5 ? 3 : 2);
      }
      // 下の歯ぐき（厚み 0.1・幅 0.5。遠いので小さい）と炎
      if (Math.abs(u - lowShift) < 0.5 && v >= loGum && v <= loGum + 0.1) return cut(v > loGum + 0.05 ? 1 : 2);
      if (kind === 'fire' && Math.abs(u - lowShift) < 0.5) {
        const h = 0.08 + Math.max(0, Math.sin(u * 15 + f * 2.7 + 1)) * 0.1;
        if (v > loGum + 0.1 && v <= loGum + 0.1 + h) return cut(v > loGum + 0.1 + h * 0.5 ? 3 : 2);
      }
      return -1;
    }),
  );
  return { palette, frameMs: 45, parts: { main: frames.map((g) => toRows(outline(g, 0))) } };
}

/** 斜めの傾き（30度）。歯ぐきは向きに直角: 斜め前（右下）は右ほど上がり、斜め後ろ（右上）は右ほど下がる */
const FANG_TILT = Math.tan((30 * Math.PI) / 180);

/**
 * かみつく・ほのおのキバ（作者の指摘 2026年10月28日: かみくだく の斜めと横を使う）: 下向き・上向きは正面の口、横は かみくだく と同じ肉食のあご（sideJaw）。
 * 斜めは正面の口を縦にずらして歯ぐきを向きに直角にし、下の列はプレイヤーの側（左）にそろえる（左向きは左右を返す）
 */
function fangFront(kind: 'fire' | 'dark'): SpriteOut {
  const face = fangFace(kind);
  const front = face.parts.main!;
  return {
    ...face,
    parts: { main: sideJaw(kind, 32), front, back: front, diag: fangFace(kind, -FANG_TILT, true).parts.main!, diagBack: fangFace(kind, FANG_TILT, true).parts.main! },
  };
}

/**
 * かみくだく（作者の指摘 2026年10月28日）: 黒いあごに白いキバだけ。横の あご（sideJaw）は かみつく・ほのおのキバ も それぞれの色で使う。
 * - 下向き・上向き（front・back）: かみつく と同じ正面の口（上の列が広く、下の列が狭い台形）を黒と白で。
 * - 斜め（diag・diagBack）: 正面の口を縦にずらして、上下の歯ぐきを平行なまま、向きに直角な斜めにする（回さない）。下の列はプレイヤーの側（左）の端にそろえる。
 *   キバは画面の縦にまっすぐ伸び、閉じる向きも画面の縦。
 * - 横（main。右向き）: 肉食のけものの頭の骨を横から見た形。後ろ（プレイヤーの側）のあごのつけ根を軸に、上あごと下あごが「<」の形に開いて閉じる。
 *   上あごは根元が厚く先が細い鼻先で、先が少し下へ曲がる。先に小さな前歯、その後ろに長い犬歯（下向き）、奥に小さな奥歯と大きな裂肉歯。
 *   下あごは上あごより短く細い。犬歯（上向き）は上の犬歯の少し前に立ち、閉じると上下の犬歯が交差する
 */
function sideJaw(kind: 'fire' | 'dark' | 'crunch', n: number): string[][] {
  // 色の番号は fangFace と同じ: 0 輪郭・1 あご（濃い）・2 あご・3 あごの照り・火花・炎・4 歯の影・5 白（歯）
  // コマごとの あごの開き（度）・火花・薄れ（0 開く → 1 半分 → 2 閉じる → 3 薄れる → 4 名残り）
  const STEPS = [[54, 0, 0], [28, 0, 0], [3, 1, 0], [3, 0.6, 1], [3, 0, 2]] as const;
  // あごの長さ（上あご）と、軸（あごのつけ根）の位置
  const L = 1.2;
  const HX = -0.62;
  const HY = 0.02;
  /** あごの中の位置 (x: 軸から先へ, y: 歯の向きが +) にあるとがった歯。根元 x0・長さ len・根元の半分の幅 w。少し後ろへ反る */
  const tooth = (x: number, y: number, x0: number, len: number, w: number): number => {
    if (y < -0.01) return -1;
    const k = y / len;
    if (k > 1) return -1;
    const c = x0 - k * k * w * 0.6;
    const half = w * (1 - k);
    if (Math.abs(x - c) > half + 0.01) return -1;
    return x < c - half * 0.25 ? 4 : 5;
  };
  const thin = (col: number, u: number, v: number, fade: number): number =>
    fade === 1 && col <= 3 && hash(Math.floor((u + 1) * 18), Math.floor((v + 1) * 18), 59) < 0.5 ? -1 : col;
  return STEPS.map(([deg, flash, fade], f) =>
      shape(n, (u, v) => {
        const half = (deg / 2) * (Math.PI / 180);
        // 火花: 犬歯の交わる所から
        if (flash > 0) {
          const cx = HX + L * 0.84;
          for (let k = 0; k < 7; k++) {
            const an = -1.2 + (k / 6) * 2.4;
            const along = (u - cx) * Math.cos(an) + (v - HY) * Math.sin(an);
            const across = -(u - cx) * Math.sin(an) + (v - HY) * Math.cos(an);
            if (along > 0.3 && along < 0.3 + 0.2 * flash && Math.abs(across) < 0.03) return 3;
          }
        }
        if (fade === 2) return hash(Math.floor((u + 1) * 14), Math.floor((v + 1) * 14), 69) < 0.05 && Math.abs(v) < 0.35 && u > HX && u < HX + L ? 3 : -1;
        const du = u - HX;
        const dv = v - HY;
        // 上あごの中の位置（上へ half だけ回した あご に沿う。y は下（歯の向き）が +）
        const ux = du * Math.cos(half) - dv * Math.sin(half);
        const uy = du * Math.sin(half) + dv * Math.cos(half);
        // 下あごの中の位置（下へ half だけ回す。y は上（歯の向き）が +）
        const lx = du * Math.cos(half) + dv * Math.sin(half);
        const ly = du * Math.sin(half) - dv * Math.cos(half);
        // 歯（あごより手前）。上: 前歯・犬歯・奥歯・裂肉歯。下: 前歯・犬歯・奥歯
        for (const [x0, len, w] of [[L * 0.97, 0.07, 0.03], [L * 0.8, 0.32, 0.075], [L * 0.62, 0.08, 0.045], [L * 0.5, 0.09, 0.05], [L * 0.36, 0.15, 0.08]] as const) {
          const c = tooth(ux, uy, x0, len, w);
          if (c >= 0) return c;
        }
        for (const [x0, len, w] of [[L * 0.86, 0.05, 0.025], [L * 0.76, 0.26, 0.065], [L * 0.58, 0.07, 0.04], [L * 0.44, 0.08, 0.045], [L * 0.3, 0.1, 0.05]] as const) {
          const c = tooth(lx, ly, x0, len, w);
          if (c >= 0) return c;
        }
        // 上あご: 根元の厚み 0.2 から先 0.08 へ細る鼻先。先は少し下へ曲がる（y は上が -）
        if (ux >= 0 && ux <= L) {
          const t = ux / L;
          const top = -(0.2 * (1 - t) + 0.08 * t) + Math.max(0, t - 0.85) * 0.4;
          const bot = Math.max(0, t - 0.9) * 0.4;
          if (uy >= top && uy <= bot) return thin(uy < top + 0.06 ? 3 : uy > bot - 0.04 ? 1 : 2, u, v, fade);
          // ほのおのキバ: 上あごの背から炎の舌が立つ
          if (kind === 'fire' && t > 0.08 && t < 0.95) {
            const h = 0.08 + Math.max(0, Math.sin(ux * 14 + f * 2.3)) * 0.12;
            if (uy < top && uy >= top - h) return thin(uy < top - h * 0.5 ? 3 : 2, u, v, fade);
          }
        }
        // 下あご: 上あごより短く（0.9）、根元 0.14 から先 0.06 へ細る
        const LL = L * 0.9;
        if (lx >= 0 && lx <= LL) {
          const t = lx / LL;
          const depth = 0.14 * (1 - t) + 0.06 * t;
          if (ly <= 0 && ly >= -depth) return thin(ly > -0.04 ? 1 : 2, u, v, fade);
          if (kind === 'fire' && t > 0.1 && t < 0.92) {
            const h = 0.06 + Math.max(0, Math.sin(lx * 15 + f * 2.7 + 1)) * 0.09;
            if (ly < -depth && ly >= -depth - h) return thin(ly < -depth - h * 0.5 ? 3 : 2, u, v, fade);
          }
        }
        // あごのつけ根（軸）の丸み
        if (Math.hypot(du, dv) < 0.08) return thin(2, u, v, fade);
        return -1;
      }),
  ).map((g) => toRows(outline(g, 0)));
}

/** かみくだく: 黒いあごに白いキバだけ（向きごとの絵は sideJaw の上の説明のとおり） */
function darkJaws(): SpriteOut {
  // 0 輪郭・1 あご（濃い黒）・2 あご（黒）・3 あごの照り（暗い灰）・4 歯の影（うすい灰）・5 白（歯）
  const palette = ['#000000', '#0a0a0a', '#2a2a2a', '#5a5a5a', '#d6d6d6', '#ffffff'];
  // 下向き・上向き・斜め: かみつく と同じ正面の口を黒と白で（32 マス。横の 36 マスと同じ大きさで描かれるよう、まわりに 2 マスずつ空きを足す）
  const pad = (r: string[]): string[] => {
    const empty = '.'.repeat(r[0]!.length + 4);
    return [empty, empty, ...r.map((row) => `..${row}..`), empty, empty];
  };
  const face = (slope: number): string[][] => fangFace('crunch', slope, slope !== 0).parts.main!.map(pad);
  const front = face(0);
  // 歯ぐきは向きに直角（作者の指摘 2026年10月28日。FANG_TILT）。どちらも下の列は左（プレイヤーの側）にそろえ、左向きは左右を返す
  // （左上は右上の、左下は右下の左右を返した絵で、下の列が右にそろう）
  return { palette, frameMs: 45, parts: { main: sideJaw('crunch', 36), front, back: front, diag: face(-FANG_TILT), diagBack: face(FANG_TILT) } };
}

/** フレアドライブ: 右へ突っ込む炎の弧（三日月形の炎。コマで炎の先がゆらめく） */
function flameCrash(): SpriteOut {
  const palette = ['#4a0e05', '#c62828', '#ef6c00', '#ffb300', '#fff176', '#ffffff'];
  const frames = [0, 1, 2].map((f) =>
    shape(20, (u, v) => {
      const d = Math.hypot(u + 0.35, v);
      const a = Math.atan2(v, u + 0.35);
      if (Math.abs(a) > 1.25) return -1;
      // 外側のふちはゆらめく炎の舌
      const outer = 0.95 + Math.sin(a * 7 + f * 2.1) * 0.08;
      const inner = 0.55 + Math.abs(a) * 0.15;
      if (d > outer || d < inner) return -1;
      const k = (d - inner) / (outer - inner);
      return k > 0.85 ? 1 : k > 0.6 ? 2 : k > 0.35 ? 3 : k > 0.15 ? 4 : 5;
    }),
  );
  return { palette, frameMs: 60, parts: { main: frames.map(toRows) } };
}

/** 右を向いた三日月形（ぶつかった衝撃・電気・手刀の弧の元）。thick は厚さ、col(k, a, f) は 0（内）〜1（外）と角度から色 */
function crescent(size: number, frames: number, thick: number, col: (k: number, a: number, f: number) => number, wobble = 0): Grid[] {
  return Array.from({ length: frames }, (_, f) =>
    shape(size, (u, v) => {
      const d = Math.hypot(u + 0.4, v);
      const a = Math.atan2(v, u + 0.4);
      if (Math.abs(a) > 1.2) return -1;
      const outer = 1.0 + Math.sin(a * 6 + f * 2) * wobble;
      const inner = outer - thick * (1 - Math.abs(a) / 1.6);
      if (d > outer || d < inner) return -1;
      return col((d - inner) / (outer - inner), a, f);
    }),
  );
}

/** たいあたり・はたく の衝撃: 白い三日月に砂ぼこりの粒 */
function impactCrescent(): SpriteOut {
  const palette = ['#3a3a3a', '#9e9e9e', '#e0e0e0', '#ffffff', '#c8b7a6'];
  const frames = crescent(18, 3, 0.45, (k, a, f) => ((Math.round(a * 9) + f) % 5 === 0 && k > 0.6 ? 4 : k > 0.75 ? 2 : 3), 0.05);
  return { palette, frameMs: 60, parts: { main: frames.map(toRows) } };
}

/** でんこうせっか: 右へ走る速さの筋（白い横線が流れる）と、先の光 */
function speedStreak(): SpriteOut {
  const palette = ['#2c3e50', '#b0bec5', '#eceff1', '#ffffff'];
  const frames: Grid[] = [];
  const rows = [1, 3, 5, 6, 8, 10];
  for (let f = 0; f < 3; f++) {
    frames.push(
      fill(blank(20, 12), (x, y) => {
        // 先の光（小さな十字）
        if (Math.abs(x - 18) + Math.abs(y - 5) <= 1.2) return 3;
        for (const [k, row] of rows.entries()) {
          if (Math.abs(y - row) > 0.5) continue;
          const len = 6 + ((k * 5 + f * 3) % 9);
          const end = 17 - ((k * 3 + f * 2) % 4);
          if (x < end - len - 0.5 || x > end + 0.5) continue;
          return x > end - 3 ? 3 : x > end - len / 2 ? 2 : 1;
        }
        return -1;
      }),
    );
  }
  return { palette, frameMs: 50, parts: { main: frames.map(toRows) } };
}

/** スパーク・ワイルドボルト: 黄色い電気の三日月に、ギザギザの火花 */
function sparkArc(): SpriteOut {
  const palette = ['#1a1440', '#f9a825', '#fdd835', '#fff59d', '#ffffff'];
  const frames = crescent(18, 3, 0.35, (k, a, f) => {
    const zig = Math.abs(((a * 10 + f * 3) % 2) - 1);
    return Math.abs(k - zig) < 0.25 ? 4 : k > 0.7 ? 1 : k > 0.4 ? 2 : 3;
  }, 0.1);
  return { palette, frameMs: 40, parts: { main: frames.map(toRows) } };
}

/** はたく・おうふくビンタ: 右を向いた ひらいた手のひら（肌色）と、うしろの動きの線 */
function palm(): SpriteOut {
  const palette = ['#3e2723', '#d7a37a', '#f2c9a0', '#ffe8d1', '#ffffff'];
  const g = shape(18, (u, v) => {
    // 手のひら（楕円）と、右へのびる4本の指・上の親指
    const hand = ((u + 0.05) / 0.38) ** 2 + (v / 0.42) ** 2 < 1;
    const finger = [-0.27, -0.09, 0.09, 0.27].some((fy) => u > 0.1 && u < 0.75 - Math.abs(fy) * 0.5 && Math.abs(v - fy) < 0.075);
    const thumb = u > -0.15 && u < 0.3 && Math.abs(v + 0.5 + (u - 0.05) * 0.4) < 0.08;
    if (hand || finger || thumb) return u + v < -0.15 ? 3 : 2;
    // 動きの線（左側）
    if (u < -0.5 && [-0.3, 0, 0.3].some((ly) => Math.abs(v - ly) < 0.05)) return 4;
    return -1;
  });
  return { palette, frameMs: 1000, parts: { main: [toRows(outline(g, 0))] } };
}

/** のしかかり（白い砂ぼこりの衝撃波）・ギガインパクト（橙と白のエネルギーの衝撃波）: 輪に沿って並べる帯 */
function shockRing(kind: 'dust' | 'giga' | 'dark' | 'snarl' | 'mud' | 'lava'): SpriteOut {
  const W = 10;
  const H = 8;
  // あくのはどう（紫がかった黒い輪）・バークアウト（黒い衝撃波。白い光の粒が少し）
  const palettes = {
    dust: ['#4e4e4e', '#9e9e9e', '#d7ccc8', '#f5f5f5', '#ffffff'],
    giga: ['#3b1400', '#e65100', '#ff9800', '#ffe082', '#ffffff'],
    dark: ['#0d0614', '#311b47', '#5e35b1', '#9575cd', '#ede7f6'],
    snarl: ['#000000', '#1a1a1a', '#3a2f3f', '#6d5f73', '#ffffff'],
    // だくりゅう（泥水）・ふんえん（溶岩）: あくのはどう と同じ輪の色違い（07 の103章）
    mud: ['#2e1f10', '#5d4027', '#8d6e4a', '#b89a72', '#e8dcc4'],
    lava: ['#3e0800', '#9a1c00', '#e64a19', '#ff9800', '#fff59d'],
  };
  const palette = palettes[kind];
  const frames: Grid[] = [];
  for (let f = 0; f < 3; f++) {
    frames.push(
      fill(blank(W, H), (x, y) => {
        // 外側（下）ほど明るく、内側（上）へもくもく薄れる。並べてつながるよう、ふちは周期 W
        const top = 2 + Math.sin(((x + f * 3) / W) * Math.PI * 2) * 1.2 - 0.5;
        if (y < top) return -1;
        if ((kind === 'giga' || kind === 'snarl') && hash(Math.floor(x * 2), Math.floor(y * 2), 700 + f) < 0.12) return 4;
        const k = (y - top) / (H - top);
        return k > 0.75 ? 4 : k > 0.45 ? 3 : k > 0.2 ? 2 : 1;
      }),
    );
  }
  return { palette, frameMs: 70, parts: { middle: frames.map(toRows) } };
}

/** ひっかく（白い3本の爪あと）・きりさく（大きく赤みのある3本）: 右を向いた、斜めに走る爪の筋 */
function claw(kind: 'small' | 'big'): SpriteOut {
  const palette = kind === 'small' ? ['#2c2c2c', '#bdbdbd', '#eeeeee', '#ffffff'] : ['#3b0a0a', '#e57373', '#ffcdd2', '#ffffff'];
  const g = shape(kind === 'small' ? 16 : 20, (u, v) => {
    // 3本の筋: 右上から左下へ、少し曲がる
    for (const off of [-0.5, 0, 0.5]) {
      const along = (u - v) / Math.SQRT2;
      const across = (u + v) / Math.SQRT2 - off - along * along * 0.25;
      const w = (kind === 'small' ? 0.09 : 0.11) * (1 - Math.abs(along) / 0.85);
      if (Math.abs(along) < 0.85 && Math.abs(across) < w) return Math.abs(across) < w * 0.4 ? 3 : 2;
    }
    return -1;
  });
  return { palette, frameMs: 1000, parts: { main: [toRows(outline(g, 0))] } };
}

/** れんぞくぎり: 黄緑の鎌の三日月（2コマで向きが入れ替わる） */
function furySlash(): SpriteOut {
  const palette = ['#1b3d14', '#7cb342', '#c5e1a5', '#f1f8e9'];
  const frames = crescent(18, 2, 0.32, (k) => (k > 0.65 ? 1 : k > 0.3 ? 2 : 3), 0.03);
  return { palette, frameMs: 70, parts: { main: frames.map((g) => toRows(outline(g, 0))) } };
}

/** ラスターカノン: 銀色の鋼の光線（ふちが青白く、真ん中に光の筋が流れる） */
function steelBeam(): SpriteOut {
  const H = 12;
  const TILE = 8;
  const palette = ['#1c2833', '#78909c', '#b0bec5', '#e0f7fa', '#ffffff'];
  const mid = (H - 1) / 2;
  const parts = lineParts(H, { start: 6, middle: TILE, end: 8 }, 4, (x, y, f, part) => {
    const taper = part === 'start' ? 0.4 + x / 8 : part === 'end' ? 1 - x / 9 : 1;
    const d = Math.abs(y - mid) / (4.6 * taper);
    if (d > 1) return -1;
    if (d < 0.3 && (x + f * 2) % TILE < 3) return 4;
    return d < 0.35 ? 3 : d < 0.7 ? 2 : 1;
  });
  return { palette, frameMs: 60, parts };
}

// ---------------- 渦の技（案 E） ----------------
/** うずしお: 上から見た渦（2本の腕が中心へ巻き込む。中心は暗い目、ふちに白い泡）。コマで回る */
function whirlpool(): SpriteOut {
  // 0 輪郭（濃い紺）・1 紺・2 青・3 水色・4 泡の白
  const palette = ['#0a1f44', '#0d47a1', '#1e88e5', '#64b5f6', '#e3f2fd'];
  const frames = [0, 1, 2, 3].map((f) =>
    shape(30, (u, v) => {
      const d = Math.hypot(u, v);
      if (d > 0.97) return -1;
      const a = Math.atan2(v, u);
      // 腕: 角度と距離の対数で巻く（外ほどゆるい）
      const arm = Math.sin(2 * a + Math.log(d + 0.05) * 5.5 - (f * Math.PI) / 2);
      if (d < 0.14) return 0;
      if (d > 0.84) return arm > 0.2 ? 4 : 3;
      if (arm > 0.75) return 4;
      if (arm > 0.2) return 3;
      return d < 0.35 ? 1 : 2;
    }, 0, -1),
  );
  return { palette, frameMs: 90, parts: { main: frames.map(toRows) } };
}

/** しおふき: 上から見た噴き上がる水（真ん中の白い水柱、まわりに広がる波の輪と、飛び散るしぶき）。コマで輪が外へ広がる */
function waterSpout(): SpriteOut {
  const palette = ['#0a2a5c', '#0277bd', '#29b6f6', '#b3e5fc', '#ffffff'];
  const frames = [0, 1, 2, 3].map((f) => {
    const r = rng(31 + f);
    const drops = Array.from({ length: 7 }, () => {
      const a = r() * Math.PI * 2;
      const rr = 0.55 + r() * 0.35;
      return [Math.cos(a) * rr, Math.sin(a) * rr, 0.07 + r() * 0.05] as const;
    });
    return shape(28, (u, v) => {
      const d = Math.hypot(u, v);
      // 真ん中の水柱（上から見て丸く、光る）
      if (d < 0.26) return Math.hypot(u + 0.08, v + 0.08) < 0.12 ? 4 : 3;
      if (d < 0.32) return 2;
      // 外へ広がる波の輪（コマで半径が増える）
      const ring = 0.45 + f * 0.11;
      if (Math.abs(d - ring) < 0.06) return 3;
      if (Math.abs(d - ring) < 0.1 && d < 0.95) return 2;
      for (const [cx, cy, pr] of drops) if (Math.hypot(u - cx, v - cy) < pr) return 4;
      return d < ring - 0.1 ? 1 : -1;
    });
  });
  return { palette, frameMs: 110, parts: { main: frames.map(toRows) } };
}

/**
 * ほのおのうず: 自分のまわりを回る火の玉（進む向きに向ける）。尾は後ろへ短くまっすぐ（作者の指摘 2026年10月24日:
 * 渦を巻く長い尾が、光の演出の残り火の軌跡とずれていた。回る軌跡は残り火に任せ、絵は火の玉そのものにする）
 */
/**
 * かえんぐるま: 上から見た、燃えて回る大きな車輪（作者の指摘 2026年10月27日: 自分が車輪の中心）。自分を囲む輪と、輪から内へのびる6本のスポーク、
 * 輪の外へ炎の舌。真ん中（自分の体）は描かない。レシピで回し、コマで炎がゆらめく
 */
function flameWheel(): SpriteOut {
  const palette = ['#4e1206', '#d84315', '#ff9800', '#ffeb3b', '#fffde7'];
  const frames = [0, 1, 2].map((f) =>
    shape(48, (u, v) => {
      const d = Math.hypot(u, v);
      const a = Math.atan2(v, u);
      // 輪の外の炎の舌（角度の波で。コマでゆらめく）
      const tongue = 0.86 + Math.max(0, Math.sin(a * 10 + f * 2.1)) * 0.13;
      if (d > tongue) return -1;
      if (d > 0.84) return d > 0.93 ? 1 : 2;
      // 輪（車輪のふち）
      if (d > 0.72) return d > 0.79 ? 3 : 4;
      // スポーク6本（輪から内へ、自分の体の手前まで）
      if (d < 0.42) return -1;
      for (let k = 0; k < 6; k++) {
        const sa = (k / 6) * Math.PI * 2;
        const along = u * Math.cos(sa) + v * Math.sin(sa);
        const across = -u * Math.sin(sa) + v * Math.cos(sa);
        if (along > 0 && Math.abs(across) < 0.045) return d > 0.6 ? 2 : 3;
      }
      return -1;
    }),
  );
  return { palette, frameMs: 70, parts: { main: frames.map(toRows) } };
}

function flameSwirl(): SpriteOut {
  const palette = ['#4e1206', '#d84315', '#ff9800', '#ffeb3b', '#fffde7'];
  const frames = [0, 1, 2].map((f) =>
    shape(18, (u, v) => {
      // 火の玉（右寄りの丸）
      const head = Math.hypot(u - 0.3, v) / 0.55;
      // 短い尾: 左へ細くなる炎の舌（コマでゆらめく）
      const t = Math.max(0, Math.min(1, (0.1 - u) / 0.95));
      const wob = Math.sin(t * 6 + f * 2.1) * 0.08 * t;
      const tail = u < 0.1 && u > -0.85 && Math.abs(v - wob) < 0.42 * (1 - t) + 0.03;
      if (head > 1 && !tail) return -1;
      const d = head <= 1 ? head * 0.75 : 0.5 + t * 0.45;
      return d < 0.3 ? 4 : d < 0.55 ? 3 : d < 0.8 ? 2 : 1;
    }),
  );
  return { palette, frameMs: 80, parts: { main: frames.map(toRows) } };
}

// ---------------- ボスの技が落ちたときの絵（案 F） ----------------
type BurstKind = 'ice' | 'meteor' | 'psy' | 'shadow' | 'fire' | 'thunder' | 'spark';

/**
 * 落ちた所ではじける絵（5コマ。最後のコマで止めて薄くする）: 真ん中の光が縮み、輪とかけらが外へ広がる。
 * ice（氷のとげ）・meteor（岩と炎）・psy（二重の輪）・shadow（影のもや）・fire（炎のかたまり）・thunder（稲妻が放射状に）・
 * spark（thunder と同じ形で 黒・黄・白。かみなりパンチのスプラッシュ）
 */
function burst(style: BurstKind): SpriteOut {
  const kind = style === 'spark' ? 'thunder' : style;
  const palettes: Record<BurstKind, string[]> = {
    ice: ['#0d3550', '#4fc3f7', '#b3e5fc', '#e1f5fe', '#ffffff'],
    meteor: ['#3e1a08', '#8d4a1f', '#ff7043', '#ffca28', '#fff8e1'],
    psy: ['#4a0e3a', '#ad1457', '#f06292', '#f8bbd0', '#ffffff'],
    shadow: ['#120a1f', '#311b5c', '#5e35b1', '#9575cd', '#d1c4e9'],
    fire: ['#4e1206', '#d84315', '#ff9800', '#ffeb3b', '#fffde7'],
    thunder: ['#3e2f00', '#f9a825', '#ffeb3b', '#fff59d', '#ffffff'],
    spark: ['#000000', '#212121', '#ffeb3b', '#fff59d', '#ffffff'],
  };
  const r = rng(kind.length * 17 + 3);
  const shards = Array.from({ length: kind === 'fire' || kind === 'meteor' ? 11 : 8 }, (_, k) => ({
    a: (k / (kind === 'fire' || kind === 'meteor' ? 11 : 8)) * Math.PI * 2 + (r() - 0.5) * 0.5,
    speed: 0.7 + r() * 0.35,
    size: kind === 'fire' || kind === 'meteor' || kind === 'shadow' ? 0.13 + r() * 0.07 : 0.09 + r() * 0.06,
  }));
  const frames = [0, 1, 2, 3, 4].map((f) => {
    const p = f / 4;
    return shape(32, (u, v) => {
      const d = Math.hypot(u, v);
      const a = Math.atan2(v, u);
      // 真ん中の光（縮む）
      const core = 0.5 * (1 - p) + 0.05;
      if (d < core * 0.55) return 4;
      if (d < core) return 3;
      // 広がる輪（氷・エスパー・稲妻だけ。炎・岩・影は かけらだけにする）
      const ring = 0.3 + 0.62 * p;
      const hasRing = kind === 'ice' || kind === 'psy' || kind === 'thunder';
      const ringW = kind === 'psy' ? 0.06 : 0.05 * (1 - p) + 0.02;
      if (hasRing && Math.abs(d - ring) < ringW) return kind === 'psy' ? 3 : 2;
      if (kind === 'psy' && Math.abs(d - ring * 0.62) < 0.045) return 2;
      // かけら
      for (const s of shards) {
        const dist = 0.2 + s.speed * 0.7 * p;
        const da = Math.atan2(Math.sin(a - s.a), Math.cos(a - s.a));
        if (kind === 'ice') {
          // 外を向いたとげ: 先ほど細い
          const along = d - dist;
          if (along > -0.34 && along < 0.06 && Math.abs(da) * d < 0.42 * (0.06 - along)) return along > -0.1 ? 4 : 3;
          continue;
        }
        if (kind === 'thunder') {
          // 中心から外へ、ぎざぎざに伸びる稲妻
          const zig = Math.sin(d * 22 + s.a * 5) * 0.035;
          if (d < dist + 0.1 && d > core && Math.abs(da * d - zig) < 0.03) return d > dist ? 4 : 3;
          continue;
        }
        if (kind === 'psy') continue;
        const cx = Math.cos(s.a) * dist;
        const cy = Math.sin(s.a) * dist;
        const sz = s.size * (1 - p * 0.4);
        const dd = Math.hypot(u - cx, v - cy);
        if (dd < sz) {
          if (kind === 'meteor') return dd < sz * 0.5 ? 1 : 0;
          return dd < sz * 0.5 ? 3 : 2;
        }
        // 炎・影は、かけらの後ろに尾
        if ((kind === 'fire' || kind === 'shadow' || kind === 'meteor') && Math.abs(da) * d < sz * 0.6 && d < dist && d > dist - 0.35) return kind === 'meteor' ? 2 : 1;
      }
      return -1;
    });
  });
  return { palette: palettes[style], frameMs: 80, loopFrom: 4, parts: { main: frames.map(toRows) } };
}

type StreakKind = 'white' | 'electric' | 'fire';

/** 突進の筋（直線の範囲に沿って、右へ流れる風の筋。start・middle・end） */
function streak(kind: StreakKind): SpriteOut {
  const palettes: Record<StreakKind, string[]> = {
    white: ['#37474f', '#90a4ae', '#cfd8dc', '#ffffff'],
    electric: ['#3e2f00', '#f9a825', '#fff176', '#ffffff'],
    fire: ['#4e1206', '#e64a19', '#ffb74d', '#fff8e1'],
  };
  const H = 12;
  const TILE = 12;
  const lanes = [2, 5, 8, 10];
  const parts = lineParts(H, { start: 6, middle: TILE, end: 8 }, 3, (x, y, f, part) => {
    const taper = part === 'start' ? x / 6 : part === 'end' ? 1 - x / 8 : 1;
    for (const [k, lane] of lanes.entries()) {
      if (Math.abs(y - lane) > (k === 1 || k === 2 ? 0.8 : 0.4)) continue;
      // ずれながら流れる破線
      const phase = (x + f * 4 + k * 5) % TILE;
      if (phase < TILE * (0.35 + taper * 0.45)) return k === 1 || k === 2 ? 3 : 2;
    }
    return -1;
  });
  return { palette: palettes[kind], frameMs: 60, parts };
}

// ---------------- 残りの技（案 G） ----------------
/** かぜおこし: 小さなつむじ風（白い渦の筋が2本。回して使う） */
function gustSwirl(): SpriteOut {
  const palette = ['#37474f', '#b0bec5', '#eceff1', '#ffffff'];
  const g = shape(14, (u, v) => {
    const d = Math.hypot(u, v);
    if (d > 0.95 || d < 0.15) return -1;
    const arm = Math.sin(2 * Math.atan2(v, u) + d * 6);
    return arm > 0.55 ? (d < 0.5 ? 3 : 2) : arm > 0.2 ? 1 : -1;
  }, 0, -1);
  return { palette, frameMs: 1000, parts: { main: [toRows(g)] } };
}

/** エアスラッシュ: 空気の刃（水色がかった白い三日月。右へ進む） */
function airBlade(): SpriteOut {
  const palette = ['#263238', '#80deea', '#e0f7fa', '#ffffff'];
  const frames = crescent(16, 2, 0.4, (k, _a, f) => (k > 0.7 ? 1 : (k > 0.35) !== (f === 1) ? 2 : 3), 0.03);
  return { palette, frameMs: 60, parts: { main: frames.map((g) => toRows(outline(g, 0))) } };
}

/** フリーズドライ: とがった氷のかけら（右へ進む。左上が光る） */
function iceShard(): SpriteOut {
  const palette = ['#0d3550', '#4fc3f7', '#b3e5fc', '#ffffff'];
  const g = shape(14, (u, v) => {
    // 右へとがったひし形（後ろは少し太い）
    const w = u > 0 ? 0.42 * (1 - u / 0.95) : 0.42 * (1 + u / 0.75);
    if (u > 0.95 || u < -0.75 || Math.abs(v) > w) return -1;
    return v < -w * 0.3 ? 3 : v < w * 0.3 ? 2 : 1;
  });
  return { palette, frameMs: 1000, parts: { main: [toRows(g)] } };
}

/** つるのムチ: 緑のつる（ふしのある線。start・middle・end。先は細く丸まる） */
function vineLine(): SpriteOut {
  const palette = ['#1b3d14', '#2e7d32', '#66bb6a', '#a5d6a7'];
  const H = 10;
  const mid = (H - 1) / 2;
  const parts = lineParts(H, { start: 4, middle: 10, end: 8 }, 2, (x, y, f, part) => {
    // 途中の部品の幅でちょうど1周する波（並べるとつながる）
    const wave = Math.sin(((x + f * 5) / 10) * Math.PI * 2) * 1.2;
    const taper = part === 'end' ? 1 - x / 9 : 1;
    const dy = Math.abs(y - mid - wave * (part === 'middle' ? 1 : 0.5));
    if (dy > 2.2 * taper + 0.3) return -1;
    // ふし（数マスごとに明るい点）と、小さな葉
    if (part === 'middle' && Math.abs(x - 4) < 0.5 && y < mid - 1 && y > mid - 4) return 2;
    return dy < 0.8 ? 3 : 2;
  }, 0);
  return { palette, frameMs: 90, parts };
}

/** やどりぎのタネ: 真ん中のタネから、つるが巻きながら伸びる（コマで伸びて止まる） */
function leechSeed(): SpriteOut {
  const palette = ['#2e1b0e', '#6d4c41', '#a1887f', '#2e7d32', '#81c784'];
  const frames = [0, 1, 2, 3].map((f) =>
    shape(26, (u, v) => {
      const d = Math.hypot(u, v);
      // タネ（茶色の楕円）
      const seed = Math.hypot(u / 0.22, v / 0.3);
      if (seed < 1) return Math.hypot(u + 0.06, v + 0.1) < 0.1 ? 2 : 1;
      // つる: 4本、渦を巻きながら外へ（コマで長くなる）
      const reach = 0.35 + f * 0.18;
      if (d > reach) return -1;
      const a = Math.atan2(v, u);
      const arm = Math.sin(4 * a - d * 7);
      return arm > 0.8 ? 4 : arm > 0.55 ? 3 : -1;
    }),
  );
  return { palette, frameMs: 120, loopFrom: 3, parts: { main: frames.map(toRows) } };
}

/** タネばくだん: 大きなタネのさや（緑の丸に白い筋。少しふくらんで脈打つ） */
function seedBomb(): SpriteOut {
  const palette = ['#1b3d14', '#33691e', '#7cb342', '#c5e1a5', '#f1f8e9'];
  const frames = [0, 1].map((f) =>
    shape(16, (u, v) => {
      const r = 0.82 + f * 0.08;
      const d = Math.hypot(u, v) / r;
      if (d > 1) return -1;
      if (Math.hypot(u + 0.3, v + 0.3) < 0.18) return 4;
      // さやの筋（縦）
      if (Math.abs(Math.sin(u * 5)) < 0.18 && d < 0.85) return 3;
      const l = light(u, v, r);
      return l > 0.4 ? 3 : l > -0.3 ? 2 : 1;
    }),
  );
  return { palette, frameMs: 200, parts: { main: frames.map(toRows) } };
}

/** ねむりごな: 青緑の粉のもや（ゆっくり渦を巻き、きらきら光る粒） */
function sleepCloud(): SpriteOut {
  const palette = ['#0b2b2b', '#00897b', '#4db6ac', '#b2dfdb', '#ffffff'];
  const frames: Grid[] = [];
  for (let f = 0; f < 4; f++) {
    const r = rng(19);
    const puffs = Array.from({ length: 8 }, (_, k) => {
      const a = (k / 8) * Math.PI * 2 + (f * Math.PI) / 10;
      const rr = 0.45 + r() * 0.2;
      return [Math.cos(a) * rr, Math.sin(a) * rr, 0.3 + r() * 0.12] as const;
    });
    const sparkles = Array.from({ length: 6 }, () => [r() * 1.6 - 0.8, r() * 1.6 - 0.8] as const);
    frames.push(
      shape(24, (u, v) => {
        let inside = Math.hypot(u, v) < 0.45;
        for (const [cx, cy, pr] of puffs) if (Math.hypot(u - cx, v - cy) < pr) inside = true;
        if (!inside) return -1;
        // きらきら（コマごとに光る粒が変わる）
        for (const [k, [sx, sy]] of sparkles.entries()) if ((k + f) % 3 === 0 && Math.hypot(u - sx, v - sy) < 0.07) return 4;
        const swirl = Math.sin(Math.atan2(v, u) * 2 + Math.hypot(u, v) * 6 - f * 1.2);
        const l = light(u, v, 0.9);
        return swirl > 0.85 ? 3 : l > 0.3 ? 3 : l > -0.4 ? 2 : 1;
      }),
    );
  }
  return { palette, frameMs: 200, parts: { main: frames.map(toRows) } };
}

/** でんじほう: ぱちぱち光る電気の玉（中が白く、外に小さな稲妻が走る） */
function zapOrb(): SpriteOut {
  const palette = ['#3e2f00', '#f9a825', '#ffeb3b', '#fff59d', '#ffffff'];
  const frames = [0, 1, 2].map((f) =>
    shape(18, (u, v) => {
      const d = Math.hypot(u, v);
      const a = Math.atan2(v, u);
      if (d < 0.3) return 4;
      if (d < 0.55) return d < 0.42 ? 3 : 2;
      // 外の稲妻: コマごとに違う向きへ
      for (let k = 0; k < 4; k++) {
        const base = (k / 4) * Math.PI * 2 + f * 0.9;
        const da = Math.atan2(Math.sin(a - base - Math.sin(d * 18) * 0.25), Math.cos(a - base - Math.sin(d * 18) * 0.25));
        if (d < 0.95 && Math.abs(da) * d < 0.06) return 3;
      }
      return d < 0.6 ? 1 : -1;
    }),
  );
  return { palette, frameMs: 70, parts: { main: frames.map(toRows) } };
}

// ---------------- 光の演出だけだった技（作者の依頼 2026年10月24日） ----------------
/** 五角の星の中か（論理の座標。中心 cx, cy・外の半径 R）。中ほど 1 に近い値、外は -1 */
function starDepth(x: number, y: number, cx: number, cy: number, R: number, turn = 0): number {
  const a = Math.atan2(y - cy, x - cx) + Math.PI / 2 + turn;
  const d = Math.hypot(x - cx, y - cy) / R;
  const seg = (Math.PI * 2) / 5;
  const off = Math.abs((((a % seg) + seg) % seg) - seg / 2) / (seg / 2);
  const rr = 0.42 + 0.56 * off ** 1.4;
  return d > rr ? -1 : 1 - d / rr;
}

/**
 * こうそくスピン: 扇形（右向き、左端が自分）を回転の向き（下）へなぎ払う水の筋。
 * 筋は自分を中心にした弧で、回る向きの先（下）ほど明るく、後ろ（上）はしぶきになって消える。コマで筋が先へ流れる
 */
function spinSpray(): SpriteOut {
  const W = 24;
  const H = 24;
  const palette = ['#01395e', '#0288d1', '#4fc3f7', '#b3e5fc', '#ffffff'];
  const frames = [0, 1, 2].map((f) =>
    fill(blank(W, H), (x, y) => {
      const t = x / (W - 1);
      const s = (y - (H - 1) / 2) / ((H - 1) / 2);
      if (t < 0.12 || t > 0.98 || Math.abs(s) > t * 0.98) return -1;
      // 扇の中の向き（−1 後ろ 〜 1 先）
      const side = s / Math.max(0.05, t);
      for (const [k, rad] of [0.45, 0.68, 0.9].entries()) {
        // 先ほど太く、後ろへ細くなる。弧は先へ行くほど外へふくらむ（なぎ払う刃の形）
        const w = 0.012 + (side + 1) * 0.022;
        const dist = Math.abs(t - rad + (1 - side * side) * 0.06);
        if (dist > w) continue;
        // 後ろへ行くほど途切れる（コマで途切れる所が先へ流れる）
        const n = hash(Math.floor(side * 8 - f * 2), k, 900);
        if (side < -0.2 && n < (-0.2 - side) * 1.2) return -1;
        const c = dist / w;
        return side < -0.3 ? 2 : c < 0.4 ? 4 : c < 0.75 ? 3 : 2;
      }
      // 先のふちに散るしぶき
      if (side > 0.75 && t > 0.4 && hash(Math.floor(x), Math.floor(y), 910 + f) < 0.12) return 3;
      return -1;
    }),
  );
  return { palette, frameMs: 70, parts: { main: frames.map(toRows) } };
}

/**
 * うたう: 外へ広がる輪に並べる音符（横 = 輪の向き、縦 = 外へ向かう向き。下が外）。
 * 1枚に8分音符が1つ。コマで上下にはずむ
 */
function noteRing(): SpriteOut {
  const W = 12;
  const H = 12;
  // 0 輪郭（濃い紫）・1 桃・2 うす桃・3 白
  const palette = ['#4a148c', '#ec407a', '#f8bbd0', '#ffffff'];
  const frames = [0, 1, 2, 1].map((f) => {
    const bob = (f - 1) * 0.8;
    const g = fill(blank(W, H), (x, y) => {
      const yy = y - bob;
      // 玉（少し傾いた楕円）
      const hx = x - 4.5;
      const hy = yy - 8;
      if (((hx + hy * 0.4) / 2.1) ** 2 + (hy / 1.5) ** 2 < 1) return hx + hy < -1 ? 2 : 1;
      // 棒
      if (Math.abs(x - 6.3) < 0.6 && yy > 2 && yy < 8) return 1;
      // 旗
      if (x > 6.3 && x < 9.2 && yy > 2 + (x - 6.3) * 0.6 && yy < 4.2 + (x - 6.3) * 0.9) return 2;
      return -1;
    });
    return outline(g, 0);
  });
  // middle は輪に並べる用、main は1つずつ飛ぶ音符（うたう）用
  return { palette, frameMs: 120, parts: { main: frames.map(toRows), middle: frames.map(toRows) } };
}

/** ほろびのうた: 輪に沿って並べる、橙の波動の帯と音符（外側＝下ほど明るい。並べてつながるよう、波の周期は W） */
function perishRing(): SpriteOut {
  const W = 12;
  const H = 10;
  const palette = ['#3b1400', '#e65100', '#ff9800', '#ffcc80', '#ffffff'];
  const frames: Grid[] = [];
  for (let f = 0; f < 3; f++) {
    const g = fill(blank(W, H), (x, y) => {
      // 音符（帯の内側に1つ。コマで上下に揺れる）
      const bob = [0, -0.7, 0][f]!;
      const hx = x - 3.5;
      const hy = y - 4.2 - bob;
      if (((hx + hy * 0.4) / 1.7) ** 2 + (hy / 1.2) ** 2 < 1) return 4;
      if (Math.abs(x - 5) < 0.55 && y - bob > 0.5 && y - bob < 4.2) return 4;
      if (x > 5 && x < 7.2 && y - bob > 0.5 + (x - 5) * 0.5 && y - bob < 2 + (x - 5) * 0.7) return 3;
      // 波動の帯（下側）
      const top = 6 + Math.sin(((x + f * 4) / W) * Math.PI * 2) * 1.2;
      if (y < top) return -1;
      const k = (y - top) / (H - top);
      return k > 0.7 ? 3 : k > 0.35 ? 2 : 1;
    });
    frames.push(outline(g, 0));
  }
  return { palette, frameMs: 90, parts: { middle: frames.map(toRows) } };
}

/** ハイパーボイス: 自分を中心に、何重にも外へ広がる音の波（途切れた輪。コマで外へ進み、4コマで1つぶん進んでつながる） */
function soundWaves(): SpriteOut {
  const palette = ['#880e4f', '#ec407a', '#f8bbd0', '#ffffff'];
  const frames = [0, 1, 2, 3].map((f) =>
    shape(40, (u, v) => {
      const d = Math.hypot(u, v);
      if (d > 0.98 || d < 0.12) return -1;
      const a = Math.atan2(v, u);
      const ph = (d - f * 0.0625) / 0.25;
      const k = ph - Math.round(ph);
      // 外のふちで切れかけた輪は描かない（点々が残る）
      if (Math.abs(k) > 0.11 || Math.round(ph) * 0.25 + f * 0.0625 > 0.92) return -1;
      // 輪を6つに区切った「)))」の形（輪ごとに区切りをずらす）
      const ring = Math.round(ph);
      const seg = (((a / (Math.PI * 2)) * 6 + ring * 0.5) % 1 + 1) % 1;
      if (seg < 0.14) return -1;
      // 芯は明るく、ふちは桃色（草の上で白く沈まないように）。真ん中に近い輪ほど白い
      if (Math.abs(k) < 0.04) return d < 0.45 ? 3 : 2;
      return 1;
    }, 0, -1),
  );
  return { palette, frameMs: 75, parts: { main: frames.map(toRows) } };
}

/** なまける: 体のまわりから立ちのぼる緑の十字と光の粒（コマで上へ流れ、4コマでつながる）。こうごうせい は同じ形で日の光の色 */
function healRise(palette = ['#1b5e20', '#43a047', '#a5d6a7', '#ffffff']): SpriteOut {
  const r = rng(77);
  const motes = Array.from({ length: 7 }, (_, k) => ({ x: -0.75 + (k / 6) * 1.5 + (r() - 0.5) * 0.15, ph: r(), plus: k % 2 === 0 }));
  const frames = [0, 1, 2, 3].map((f) =>
    shape(28, (u, v) => {
      for (const m of motes) {
        const p = (m.ph + f / 4) % 1;
        const my = 0.8 - p * 1.6;
        const sz = 0.16 * Math.sin(p * Math.PI) + 0.04;
        if (m.plus) {
          const dx = Math.abs(u - m.x);
          const dy = Math.abs(v - my);
          if ((dx < sz && dy < sz * 0.36) || (dy < sz && dx < sz * 0.36)) return dx < sz * 0.36 && dy < sz * 0.36 ? 3 : 2;
        } else if (Math.hypot(u - m.x, v - my) < sz * 0.45) return 3;
      }
      return -1;
    }),
  );
  return { palette, frameMs: 110, parts: { main: frames.map(toRows) } };
}

/** ドわすれ: 頭の上をぐるぐる回る3つの「？」と、軌道に沿って光る粒（コマで 1/3 周ずつ回ってつながる） */
function amnesiaSwirl(): SpriteOut {
  const palette = ['#0d2b5c', '#42a5f5', '#bbdefb', '#ffffff'];
  // 「？」の形（5 × 7）
  const Q = ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'];
  const S = 32;
  const frames = [0, 1, 2, 3].map((f) => {
    const g = fill(blank(S, S), (x, y) => {
      const u = (x - (S - 1) / 2) / (S / 2);
      const v = (y - (S - 1) / 2) / (S / 2);
      for (let k = 0; k < 3; k++) {
        const a = ((k + f / 4) / 3) * Math.PI * 2;
        // 上から見た楕円の軌道（頭の上を回る）
        const cx = (S - 1) / 2 + Math.cos(a) * S * 0.32 - 2;
        const cy = (S - 1) / 2 + Math.sin(a) * S * 0.16 - S * 0.18 - 3;
        const qx = Math.floor(x - cx);
        const qy = Math.floor(y - cy);
        if (Q[qy]?.[qx] === '#') return Math.sin(a) > 0 ? 3 : 2;
      }
      // 軌道に沿って光る小さな粒（コマで回る）
      for (let k = 0; k < 6; k++) {
        const a = ((k + f / 4 + 0.5) / 6) * Math.PI * 2;
        if (Math.hypot(u - Math.cos(a) * 0.62, v - Math.sin(a) * 0.32 + 0.36) < 0.035) return 2;
      }
      return -1;
    });
    return outline(g, 0);
  });
  return { palette, frameMs: 140, parts: { main: frames.map(toRows) } };
}

/** とっておき: 外へ広がる輪に並べる、虹色の星（1枚に大小2つ。コマで色が順に変わる） */
function rainbowStars(): SpriteOut {
  const W = 14;
  const H = 12;
  // 0 輪郭・1〜6 虹の色・7 白
  const palette = ['#3a1d4a', '#ff5252', '#ffab40', '#ffee58', '#69f0ae', '#40c4ff', '#e040fb', '#ffffff'];
  const frames = [0, 1, 2, 3, 4, 5].map((f) => {
    const g = fill(blank(W, H), (x, y) => {
      const big = starDepth(x, y, 4.5, 6.5, 4.4, f * 0.25);
      if (big >= 0) return big > 0.6 ? 7 : 1 + (f % 6);
      const small = starDepth(x, y, 11, 3.5, 2.6, -f * 0.3);
      if (small >= 0) return small > 0.6 ? 7 : 1 + ((f + 3) % 6);
      // きらめく点
      if (hash(Math.floor(x), Math.floor(y), 950 + f) < 0.04) return 7;
      return -1;
    });
    return outline(g, 0);
  });
  return { palette, frameMs: 60, parts: { middle: frames.map(toRows) } };
}

// ---------------- 作者の感想で見直した技（2026年10月25日） ----------------
/** なめらかな雲の模様（0〜1）。論理の座標 x, y を格子の大きさ cell で区切り、格子点の乱数をなめらかにつなぐ */
function noise(x: number, y: number, cell: number, seed: number): number {
  const gx = x / cell;
  const gy = y / cell;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const sx = (gx - x0) ** 2 * (3 - 2 * (gx - x0));
  const sy = (gy - y0) ** 2 * (3 - 2 * (gy - y0));
  const h = (i: number, j: number): number => hash(x0 + i, y0 + j, seed);
  const top = h(0, 0) + (h(1, 0) - h(0, 0)) * sx;
  const bottom = h(0, 1) + (h(1, 1) - h(0, 1)) * sx;
  return top + (bottom - top) * sy;
}

/**
 * ブラストバーン: 地面のくぼみから噴き上がる炎の柱（横から見た姿。根元が絵の下の方 y = 34 にある。レシピの originY で
 * 根元を当たり判定の中心に合わせる）。コマ 0 でくぼみが赤く光り、1〜3 で炎が噴き上がり、3・4 でゆらめき続ける（loopFrom 3）。
 * 柱の芯は白く、上と外ほど赤い。ふちはぎざぎざで、上に火の粉が舞う
 */
function fireGeyser(): SpriteOut {
  const W = 24;
  const H = 40;
  const cx = (W - 1) / 2;
  const gy = 34;
  // 0 輪郭・1 濃い赤・2 赤橙・3 橙・4 黄・5 白・6 こげた地面・7 くぼみのふち
  const palette = ['#2e0a04', '#b71c1c', '#e64a19', '#ff9800', '#ffeb3b', '#fffde7', '#3e2723', '#8d6e63'];
  const heights = [3, 15, 27, 32, 30];
  const frames = heights.map((ht, f) => {
    const r = rng(600 + f);
    const embers = Array.from({ length: f === 0 ? 0 : 3 + f * 2 }, () => [cx + (r() - 0.5) * 18, gy - ht * (0.45 + r() * 0.6) - 2, r()] as const);
    const g = fill(blank(W, H), (x, y) => {
      const up = gy - y;
      if (up >= -1 && up <= ht) {
        const t = Math.max(0, up) / Math.max(1, ht);
        // 幅: 根元は広く、少し上で細くなり、上の方でふくらんでから先が尖る
        let half = 7 - 2.6 * Math.min(1, t * 2.2) + 2.4 * Math.sin(Math.PI * Math.min(1, t * 1.1)) * (f >= 2 ? 1 : 0.5);
        if (t > 0.78) half *= ((1 - t) / 0.22) ** 0.8;
        // ゆらめき（縦の波で左右にずらす）と、ぎざぎざのふち
        const sway = Math.sin(up * 0.42 + f * 1.9) * (0.4 + t * 1.8);
        const jag = (noise(x, y - f * 3, 2.2, 610 + f) - 0.5) * (1.2 + t * 2.2);
        const d = Math.abs(x - cx - sway) / Math.max(0.3, half + jag);
        if (d <= 1) {
          // 芯ほど明るく、上と外ほど赤い。根元は特に熱い
          const heat = (1 - d) * (1.05 - t * 0.8) + Math.max(0, 1 - up / 7) * 0.25 + (noise(x, y + f * 4, 3, 620 + f) - 0.5) * 0.25;
          return heat > 0.72 ? 5 : heat > 0.5 ? 4 : heat > 0.3 ? 3 : heat > 0.13 ? 2 : 1;
        }
      }
      // 地面のくぼみ（楕円）。ふちは土、中はこげて赤く光る割れ目
      const ex = (x - cx) / 10.5;
      const ey = (y - gy) / 3.4;
      const ed = ex * ex + ey * ey;
      if (ed <= 1) {
        if (ed > 0.6) return 7;
        return hash(Math.floor(x * 1.5), Math.floor(y * 1.5), 630) < (f === 0 ? 0.45 : 0.25) ? (f === 0 ? 4 : 3) : 6;
      }
      for (const [ex2, ey2, s] of embers) if (Math.abs(x - ex2) + Math.abs(y - ey2) < 0.9) return s > 0.5 ? 4 : 3;
      return -1;
    });
    return toRows(outline(g, 0));
  });
  return { palette, frameMs: 90, loopFrom: 3, parts: { main: [0, 1, 2, 3, 4].map((i) => frames[i]!) } };
}

/**
 * だいばくはつ: 広がる爆発の火の玉（上から見た円）。5コマで、白い芯 → 黄と橙のうねる炎 → 赤と黒い煙へ移る。
 * ふちは雲のようにもこもこさせ、丸い円に見えないようにする
 */
function explosionCore(): SpriteOut {
  // 0 輪郭（こげ茶）・1 煙の暗い所・2 煙・3 濃い赤・4 赤橙・5 橙・6 黄・7 白
  const palette = ['#1a0b06', '#2d1b14', '#5d4037', '#b71c1c', '#e64a19', '#ff9800', '#ffeb3b', '#fffde7'];
  const frames = [0, 1, 2, 3, 4].map((f) => {
    const p = f / 4;
    return shape(40, (u, v) => {
      const d = Math.hypot(u, v);
      const n = noise(u * 20, v * 20, 3.2, 700 + f);
      const n2 = noise(u * 20 + 50, v * 20, 1.6, 710 + f);
      // もこもこのふち
      if (d > 0.86 + (n - 0.5) * 0.22) return -1;
      // 熱さ: 真ん中ほど熱く、時間とともに冷めて煙になる
      const heat = (1 - d) * (1.35 - p * 1.1) + (n - 0.5) * 0.55 + (n2 - 0.5) * 0.25 + 0.15 - p * 0.15;
      if (heat > 0.95) return 7;
      if (heat > 0.75) return 6;
      if (heat > 0.55) return 5;
      if (heat > 0.38) return 4;
      if (heat > 0.24) return 3;
      return heat > 0.08 ? 2 : 1;
    });
  });
  return { palette, frameMs: 100, loopFrom: 4, parts: { main: frames.map(toRows) } };
}

/**
 * だいばくはつの端: 広がる爆発のふちに並べる、外へ噴き出す炎の舌と、飛び散る岩くず（輪に沿って並べる帯。下が外）。
 * 並べてもつながるよう、炎の高さは幅 W の周期。コマで炎の舌が伸び縮みする（レシピの varyTiles で1枚ずつ違うコマにする）
 */
function blastEdge(): SpriteOut {
  const W = 12;
  const H = 14;
  // 0 輪郭・1 煙・2 濃い赤・3 赤橙・4 橙・5 黄・6 白・7 岩くず
  const palette = ['#1a0b06', '#3e2723', '#b71c1c', '#e64a19', '#ff9800', '#ffeb3b', '#fffde7', '#6d4c41'];
  const frames = [0, 1, 2, 3].map((f) => {
    const g = fill(blank(W, H), (x, yy) => {
      // 下が外なので、上下を返して描く
      const y = H - 1 - yy;
      const ph = (x / W) * Math.PI * 2;
      // 炎の舌の先の高さ（上が外。小さいほど外へ伸びる）
      const tip = 6 - 3.2 * Math.max(0, Math.sin(ph * 2 + f * 1.3)) - 1.8 * Math.max(0, Math.sin(ph * 3 - f * 2.1 + 1)) + (noise(Math.cos(ph) * 3 + 3, Math.sin(ph) * 3 + f * 5, 2, 720) - 0.5) * 1.5;
      if (y < tip) {
        // 舌の先より外: 飛び散る岩くず
        const rx = Math.floor(x + 0.5);
        const ry = Math.floor(y + 0.5);
        return hash(rx, ry, 730 + f) < 0.05 && y > 0.5 ? 7 : -1;
      }
      const k = (y - tip) / (H - tip);
      // 内側（下）へ行くほど煙になって薄れる（下の方は抜く）
      if (k > 0.8 && noise(x, y, 2, 740 + f) < (k - 0.8) * 4) return -1;
      return k < 0.12 ? 6 : k < 0.28 ? 5 : k < 0.45 ? 4 : k < 0.6 ? 3 : k < 0.72 ? 2 : 1;
    });
    return toRows(outline(g, 0));
  });
  return { palette, frameMs: 70, parts: { middle: frames } };
}

/**
 * しおふき: 使ったポケモンから真上へ噴き上がる潮（横から見た姿。根元が絵の下の方 y = 37）。
 * コマ 0 で根元の水しぶき、1・2 で高く噴き上がり、先が冠のように開き、3 で崩れてしずくになる
 */
function waterColumn(): SpriteOut {
  const W = 16;
  const H = 40;
  const cx = (W - 1) / 2;
  const gy = 37;
  const palette = ['#0a2a5c', '#0277bd', '#29b6f6', '#b3e5fc', '#ffffff'];
  const heights = [8, 26, 34, 30];
  const frames = heights.map((ht, f) => {
    const r = rng(800 + f);
    const drops = Array.from({ length: f === 0 ? 3 : 6 + f * 2 }, () => [cx + (r() - 0.5) * (f === 3 ? 15 : 12), gy - ht + (r() - 0.3) * (f === 3 ? 18 : 7), r()] as const);
    const g = fill(blank(W, H), (x, y) => {
      const up = gy - y;
      // 崩れるコマは、柱の上の方が途切れ途切れ
      const broken = f === 3 && up > 12 && noise(x, y, 2.5, 810) < 0.5;
      if (up >= 0 && up <= ht && !broken) {
        const t = up / ht;
        // 柱: 細く、先で冠のように開く
        const half = 2.4 + (t > 0.82 && f > 0 ? (t - 0.82) * 22 : 0) + (up < 3 ? 2.2 - up * 0.7 : 0);
        const sway = Math.sin(up * 0.5 + f * 2) * 0.5;
        const dx = x - cx - sway;
        if (Math.abs(dx) <= half) {
          // 左を明るく（光の筋）、右を濃く
          const k = dx / half;
          return k < -0.45 ? 4 : k < 0.1 ? 3 : k < 0.6 ? 2 : 1;
        }
      }
      // 根元の水の輪
      const ex = (x - cx) / 6.5;
      const ey = (y - gy) / 1.8;
      if (Math.abs(ex * ex + ey * ey - 0.75) < 0.3) return 3;
      for (const [dx2, dy2, s] of drops) if (Math.hypot(x - dx2, y - dy2) < 0.8 + s * 0.4) return s > 0.6 ? 4 : 3;
      return -1;
    });
    return toRows(outline(g, 0));
  });
  return { palette, frameMs: 110, loopFrom: 3, parts: { main: frames } };
}

/**
 * ヘドロウェーブ: 蛇行しながら進む毒のヘドロ（通った道に並べる 途中 と、先の 終わり）。途中はぶよぶよの帯に泡、
 * 終わりは丸いヘドロの頭。コマで泡が動く
 */
function sludgeTrail(): SpriteOut {
  const H = 10;
  const TILE = 8;
  const palette = ['#2a0d33', '#7b1fa2', '#ab47bc', '#ce93d8', '#f3e5f5'];
  const mid = (H - 1) / 2;
  const parts = lineParts(H, { start: 4, middle: TILE, end: 12 }, 3, (x, y, f, part) => {
    if (part === 'end') {
      // 頭: 右寄りの丸いかたまりと、左へつながる首
      const d = Math.hypot(x - 7, y - mid) / 4.4;
      const neck = x < 7 && Math.abs(y - mid) < 3 - (7 - x) * 0.1;
      if (d > 1 && !neck) return -1;
      if (Math.hypot(x - 8 + f * 0.4, y - mid + 1.6) < 1) return 4;
      return d < 0.45 ? 3 : y < mid - 0.5 ? 3 : y > mid + 1.5 ? 1 : 2;
    }
    // 帯: 端で同じ太さになるよう、太さの揺れは幅 TILE の周期
    const half = 3 + Math.sin(((x + f * 2) / TILE) * Math.PI * 2) * 0.7;
    if (Math.abs(y - mid) > half) return -1;
    if (hash(Math.floor(x + f * 3), Math.floor(y), 820) < 0.07) return 4;
    return y < mid - half * 0.35 ? 3 : y > mid + half * 0.5 ? 1 : 2;
  });
  return { palette, frameMs: 90, parts };
}

/**
 * スパーク・ワイルドボルト: 広がって縮む電気の輪に並べる、ジグザグの稲妻（横 = 輪の向き）。端は真ん中の高さに戻すので、
 * 並べると1本の輪につながる。コマごとに折れ方を変え、ふちから小さな火花が飛ぶ
 */
function electricRing(): SpriteOut {
  const W = 12;
  const H = 10;
  // 0 輪郭・1 濃い黄・2 黄・3 うすい黄・4 白
  const palette = ['#1a1440', '#f9a825', '#fdd835', '#fff59d', '#ffffff'];
  const mid = (H - 1) / 2;
  const frames = [0, 1, 2, 3].map((f) => {
    const r = rng(900 + f);
    const pts: [number, number][] = [[0, mid]];
    for (let k = 1; k < 5; k++) pts.push([(k * W) / 5 + (r() - 0.5) * 0.8, mid + (k % 2 === 0 ? 1 : -1) * (1.5 + r() * 2.2)]);
    pts.push([W, mid]);
    const yAt = (x: number): number => {
      for (let k = 0; k < pts.length - 1; k++) {
        const [x0, y0] = pts[k]!;
        const [x1, y1] = pts[k + 1]!;
        if (x >= x0 && x <= x1) return y0 + ((y1 - y0) * (x - x0)) / Math.max(0.01, x1 - x0);
      }
      return mid;
    };
    const spark = Math.floor(r() * W);
    const sparkUp = r() < 0.5;
    const g = fill(blank(W, H), (x, y) => {
      const a = yAt(x);
      const b = yAt(Math.max(0, x - 1));
      const lo = Math.min(a, b) - 0.45;
      const hi = Math.max(a, b) + 0.45;
      if (y >= lo && y <= hi) return 4;
      if (y >= lo - 0.75 && y <= hi + 0.75) return 2;
      // 小さな火花: 稲妻から斜めに短く
      const sy = sparkUp ? lo - (x - spark) : hi + (x - spark);
      if (x > spark && x < spark + 2.5 && Math.abs(y - sy) < 0.5) return 3;
      return -1;
    });
    return toRows(outline(g, 0));
  });
  return { palette, frameMs: 45, parts: { middle: frames } };
}

/**
 * 10まんボルト: 自分のまわりで ばちばちとはじける電気（上から見た円）。真ん中から外へ、枝分かれするぎざぎざの稲妻が
 * ばらばらの長さで伸びる（丸い形に見えないように）。コマごとに形を変えて、ちらつかせる
 */
function electricCrackle(): SpriteOut {
  const S = 40;
  const c = (S - 1) / 2;
  const palette = ['#1a1440', '#f9a825', '#fdd835', '#fff59d', '#ffffff'];
  const frames = [0, 1, 2, 3].map((f) => {
    const r = rng(950 + f);
    const g = blank(S, S);
    // 稲妻: まっすぐな短い線を、行きたい向きの左右へ交互に鋭く折りながらつなぐ（丸くうねらせない）
    const bolt = (x: number, y: number, a0: number, len: number, depth: number): void => {
      let px = x;
      let py = y;
      const seg = depth === 0 ? 4.5 : 3;
      const steps = Math.max(2, Math.round(len / seg));
      for (let k = 0; k < steps; k++) {
        const a = a0 + (k % 2 === 0 ? 1 : -1) * (0.3 + r() * 0.4);
        const nx = px + Math.cos(a) * seg;
        const ny = py + Math.sin(a) * seg;
        // 粗い絵（k = 1）でも途切れないよう、細かさに関係なく線の上を細かく打つ
        const steps2 = Math.max(2, Math.ceil(seg * Math.max(1, K) * 1.5));
        for (let q = 0; q <= steps2; q++) set(g, px + ((nx - px) * q) / steps2, py + ((ny - py) * q) / steps2, depth === 0 ? 4 : 3);
        px = nx;
        py = ny;
        // 枝分かれ（短くまっすぐ）
        if (depth === 0 && k > 0 && r() < 0.3) bolt(px, py, a0 + (r() < 0.5 ? -1 : 1) * (0.7 + r() * 0.4), len * 0.3, 1);
      }
    };
    const n = 5 + Math.floor(r() * 2);
    for (let k = 0; k < n; k++) bolt(c, c, (k / n) * Math.PI * 2 + (r() - 0.5) * 0.8, 9 + r() * 10, 0);
    // 真ん中の光
    for (let dy = -1.5; dy <= 1.5; dy += 0.5) for (let dx = -1.5; dx <= 1.5; dx += 0.5) if (Math.hypot(dx, dy) < 1.6) set(g, c + dx, c + dy, 4);
    // 稲妻のまわりに黄色の光（輪郭の内側）
    const glow = g.map((row) => row.slice());
    for (let y = 0; y < g.length; y++) {
      for (let x = 0; x < g[0]!.length; x++) {
        if (g[y]![x]! >= 0) continue;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => (g[y + dy!]?.[x + dx!] ?? -1) >= 3)) glow[y]![x] = 2;
      }
    }
    return toRows(outline(glow, 0));
  });
  return { palette, frameMs: 45, parts: { main: frames } };
}

/**
 * マグニチュード・じしん: ぐらぐら揺れる地面（上から見た円）。土のかたまりに、真ん中から割れ目が走り、ふちに石くれと砂ぼこり。
 * コマ 0〜2 で割れ目が伸び、3・4 で砂ぼこりが舞う（loopFrom 3）。描く位置はレシピの shake で揺らす
 */
function quakeZone(): SpriteOut {
  // 0 輪郭・1 割れ目・2 土の暗い所・3 土・4 土の明るい所・5 石くれ・6 砂ぼこり
  const palette = ['#2a1d14', '#1a110b', '#6d5644', '#8d7560', '#ad957c', '#d7ccc8', '#cbb79a'];
  const r = rng(1010);
  const cracks = Array.from({ length: 7 }, (_, k) => ({ a: (k / 7) * Math.PI * 2 + (r() - 0.5) * 0.6, len: 0.55 + r() * 0.35, wob: r() * 10 }));
  const make = (grow: number, f: number): string[] =>
    toRows(
      shape(32, (u, v) => {
        const d = Math.hypot(u, v);
        const a = Math.atan2(v, u);
        const edge = 0.74 + (noise(Math.cos(a) * 6 + 6, Math.sin(a) * 6 + 6, 1.4, 1020) - 0.5) * 0.22;
        if (d > edge) {
          // ふちの外の砂ぼこり
          if (f >= 3 && d < edge + 0.2 && noise(u * 16, v * 16 - f * 2, 1.5, 1030 + f) > 0.68) return 6;
          return -1;
        }
        for (const ck of cracks) {
          const da = Math.atan2(Math.sin(a - ck.a), Math.cos(a - ck.a));
          const along = d / (ck.len * grow);
          if (along > 1) continue;
          const zig = Math.sin(d * 18 + ck.wob) * 0.05;
          if (Math.abs(da * d - zig) < 0.045 * (1.2 - along)) return 1;
        }
        if (d > edge - 0.1 && hash(Math.floor((u + 1) * 12), Math.floor((v + 1) * 12), 1040) < 0.3) return 5;
        const l = light(u, v, edge) + (noise(u * 16, v * 16, 2, 1050) - 0.5) * 0.8;
        return l > 0.35 ? 4 : l > -0.3 ? 3 : 2;
      }),
    );
  return { palette, frameMs: 90, loopFrom: 3, parts: { main: [make(0.35, 0), make(0.7, 1), make(1, 2), make(1, 3), make(1, 4)] } };
}

/**
 * フレアドライブ: 自分の周りに広がる獄炎の地面（上から見た円。作者の依頼 2026年10月28日。07 の115章）。
 * 黒く冷えた岩のふちの中で、マグマがうねって流れ、泡がふくらんでは弾ける（6コマでくり返す）
 */
function magmaPool(): SpriteOut {
  // 0 ふち・1 冷えた岩・2 暗い赤・3 赤・4 だいだい・5 黄・6 白く光る所
  const palette = ['#1a0805', '#4a1a0c', '#8e1b08', '#d84315', '#ff8f00', '#ffd54f', '#fff8e1'];
  const r = rng(1310);
  const bubbles = Array.from({ length: 7 }, () => ({ u: (r() - 0.5) * 1.1, v: (r() - 0.5) * 1.1, phase: Math.floor(r() * 6), size: 0.07 + r() * 0.07 }));
  const make = (f: number): string[] =>
    toRows(
      shape(32, (u, v) => {
        const d = Math.hypot(u, v);
        const a = Math.atan2(v, u);
        const edge = 0.82 + (noise(Math.cos(a) * 5 + 5, Math.sin(a) * 5 + 5, 1.3, 1320) - 0.5) * 0.16;
        if (d > edge) return -1;
        if (d > edge - 0.05) return 0;
        // ふちは冷えた岩が点々と
        if (d > edge - 0.14 && noise(u * 14, v * 14, 1.6, 1330) > 0.5) return 1;
        // 泡: コマごとにふくらみ（白く光る芯）、最後のコマで弾けて輪になる
        for (const b of bubbles) {
          const t = (f - b.phase + 6) % 6;
          if (t > 3) continue;
          const bd = Math.hypot(u - b.u, v - b.v);
          const size = b.size * (0.5 + t * 0.35);
          if (t === 3) {
            if (Math.abs(bd - size) < 0.035) return 5;
          } else if (bd < size) return bd < size * 0.45 ? 6 : 5;
        }
        // 表面に浮かぶ冷えた岩の板（ゆっくり流れる）。板のすき間から光るマグマがのぞく
        const crust = noise(u * 4.5 + f * 0.12, v * 4.5 + f * 0.08, 1.4, 1360);
        if (crust > 0.6) return crust > 0.68 ? 1 : 2;
        // うねって流れるマグマ（コマで模様が流れる）。中ほど熱く、板の近くは暗い
        const flow = noise(u * 5 + f * 0.35, v * 5 - f * 0.2, 2, 1340) + (noise(u * 11 - f * 0.5, v * 11, 1.5, 1350) - 0.5) * 0.4;
        const heat = flow - d * 0.3 - (crust - 0.45) * 0.8;
        return heat > 0.62 ? 5 : heat > 0.46 ? 4 : heat > 0.28 ? 3 : 2;
      }),
    );
  return { palette, frameMs: 110, parts: { main: [0, 1, 2, 3, 4, 5].map(make) } };
}

/** ストーンエッジ: 地面を走る亀裂の先（はじける岩くずと土ぼこり。上から見た円）。コマで岩くずが跳ねる */
function crackHead(): SpriteOut {
  const palette = ['#1c1a17', '#4e4a44', '#7d756b', '#a89f93', '#e0d9cf', '#cbb79a'];
  const frames = [0, 1, 2].map((f) => {
    const r = rng(1150 + f);
    const chips = Array.from({ length: 6 }, () => [(r() - 0.5) * 1.4, (r() - 0.5) * 1.4, 0.12 + r() * 0.1] as const);
    return toRows(
      shape(16, (u, v) => {
        for (const [cx, cy, s] of chips) {
          const d = Math.abs(u - cx) + Math.abs(v - cy);
          if (d < s) return u - cx + v - cy < 0 ? 4 : 2;
        }
        const d = Math.hypot(u, v);
        if (d < 0.5 + (noise(u * 8, v * 8, 1.5, 1160 + f) - 0.5) * 0.4) return d < 0.25 ? 1 : 5;
        return -1;
      }),
    );
  });
  return { palette, frameMs: 80, parts: { main: frames } };
}

/**
 * ぜったいれいど: 凍りついた敵の氷の像（横から見た姿。根元が絵の下の方 y = 25）。角ばった氷の柱の中に、凍った影が見える。
 * コマ 0 で足元から凍り、1・2 で光がきらめき、3 でひびが入る（loopFrom 3）
 */
function iceStatue(): SpriteOut {
  const W = 20;
  const H = 28;
  const cx = (W - 1) / 2;
  const gy = 25;
  // 0 輪郭・1 凍った影・2 濃い水色・3 水色・4 うすい水色・5 白
  const palette = ['#0d3550', '#5b8fbf', '#4fc3f7', '#81d4fa', '#e1f5fe', '#ffffff'];
  const make = (grow: number, f: number): string[] => {
    const g = fill(blank(W, H), (x, y) => {
      const up = gy - y;
      const top = 21 * grow;
      // 足元の霜（楕円）
      const ex = (x - cx) / 8.5;
      const ey = (y - gy) / 2.2;
      if (up < 0) return ex * ex + ey * ey <= 1 ? (hash(Math.floor(x), Math.floor(y), 1200) < 0.3 ? 5 : 4) : -1;
      if (up > top + 3) return -1;
      // 柱: 六角の柱を横から見た形（左右の面と、とがった頭）
      const half = 6.5 - Math.max(0, up - top) * 2.2;
      const dx = x - cx;
      if (Math.abs(dx) > half) return -1;
      // ひび（最後のコマ）
      if (f === 3 && Math.abs(dx - (up - 10) * 0.3 - (Math.floor(up / 3) % 2 === 0 ? 0.8 : -0.8)) < 0.5 && up > 3 && up < 20) return 5;
      // 中の凍った影（体と頭と耳。どのポケモンにも見えるよう、ぼんやりした形）
      const body = (dx / 4.4) ** 2 + ((up - 7) / 4) ** 2 < 1;
      const head = Math.hypot(dx, up - 13) < 2.8;
      const ears = Math.abs(Math.abs(dx) - 1.8) < 0.7 && up > 14.5 && up < 17;
      if ((body || head || ears) && up < top) return 1;
      // きらめき
      if (f > 0 && Math.hypot(dx + 3 - f, up - 15 + f * 2) < 0.9) return 5;
      // 面の塗り分け: 左の面が明るい
      return dx < -half * 0.35 ? 4 : dx < half * 0.3 ? 3 : 2;
    });
    return toRows(outline(g, 0));
  };
  return { palette, frameMs: 160, loopFrom: 3, parts: { main: [make(0.45, 0), make(1, 1), make(1, 2), make(1, 3)] } };
}

/** フリーズドライ: 細長い氷の結晶の針（右へ進む）。真ん中に小さな枝が2本ずつ出る（雪の結晶の腕のように） */
function iceNeedle(): SpriteOut {
  const palette = ['#0d3550', '#4fc3f7', '#b3e5fc', '#ffffff'];
  const g = shape(18, (u, v) => {
    // 針: 先が鋭く、後ろも細い
    const w = u > -0.1 ? 0.13 * (1 - (u + 0.1) / 1.05) : 0.13 * (1 + (u + 0.1) / 0.85);
    if (u < -0.95 || u > 0.95) return -1;
    if (Math.abs(v) <= w + 0.02) return v < -0.02 ? 3 : 2;
    // 小さな枝: 後ろへ斜めに
    for (const bx of [-0.35, 0.15]) {
      const along = bx - u;
      if (along > 0 && along < 0.3 && Math.abs(Math.abs(v) - along * 0.9) < 0.06) return 2;
    }
    return -1;
  });
  return { palette, frameMs: 1000, parts: { main: [toRows(g)] } };
}

/**
 * つのでつく: 白い三角錐のツノ（右向き。作者の指摘 2026年10月27日: 針ではなくツノ）。左が丸い底（楕円が少し見える）、右が鋭い先。
 * 上の面が明るく、下へ向かって灰色の影
 */
function horn(palette = ['#3b3631', '#8d8a86', '#cfcbc6', '#f2efea', '#ffffff', '#b8ae9f']): SpriteOut {
  // 0 輪郭・1 影・2 灰・3 白・4 光・5 底
  const g = shape(16, (u, v) => {
    // 絵の左 3 割は空ける（底が使ったポケモンの体に隠れないよう、前に出す）
    if (u > 0.96) return -1;
    const w = 0.42 * Math.max(0, (0.96 - u) / 1.26);
    // 底: 左端の縦長の楕円
    const base = ((u + 0.3) / 0.12) ** 2 + (v / 0.42) ** 2 <= 1;
    if (u < -0.3 && !base) return -1;
    if (u >= -0.3 && Math.abs(v) > w) return -1;
    if (u < -0.24 && base) return 5;
    const d = v / Math.max(0.02, w);
    return d < -0.55 ? 4 : d < -0.05 ? 3 : d < 0.55 ? 2 : 1;
  });
  return { palette, frameMs: 1000, parts: { main: [toRows(g)] } };
}

/**
 * メガホーン: 大きな槍（ランス）のようなツノ（右向き。作者の指摘 2026年10月27日: より大きく、槍のように）。
 * 長い円錐の穂先に ねじれた溝、根元に丸い鍔（つば）、後ろに短い柄。先は鋭く光る
 */
function megahornLance(): SpriteOut {
  // 0 輪郭・1 影・2 灰・3 白・4 光・5 溝（虫の緑）・6 鍔
  const palette = ['#1f2a17', '#7d8a78', '#c9d1c4', '#f1f5ee', '#ffffff', '#7cb342', '#9e9d24'];
  const frames = [0, 1].map((f) =>
    shape(32, (u, v) => {
      if (u > 0.98) return -1;
      // 柄: 後ろの短い棒
      if (u < -0.74) return u > -0.92 && Math.abs(v) < 0.08 ? (v < 0 ? 3 : 1) : -1;
      // 鍔: 穂先の根元の丸い板
      if (u < -0.6) return Math.abs(v) < 0.42 * Math.sqrt(Math.max(0, 1 - ((u + 0.67) / 0.08) ** 2)) ? (v < -0.12 ? 3 : v < 0.14 ? 6 : 1) : -1;
      // 穂先: 長い円錐
      const w = 0.3 * ((0.98 - u) / 1.58);
      if (Math.abs(v) > w) return -1;
      const d = v / Math.max(0.01, w);
      // 先の光（コマでまたたく）
      if (u > 0.78 && d < 0.2 && f === 1) return 4;
      // ねじれた溝: 斜めの筋
      if (((u * 9 + d * 1.2 + 40) % 1.6) < 0.32 && u < 0.75) return 5;
      return d < -0.5 ? 4 : d < 0 ? 3 : d < 0.55 ? 2 : 1;
    }),
  );
  return { palette, frameMs: 120, parts: { main: frames.map(toRows) } };
}

/**
 * リーフブレード（07 の130章。作者の指摘 2026年10月29日: ひっかく・きりさく の絵は使わない）: 抜刀して画面を横一閃に切る白黒の剣筋。
 * 細い白い芯に黒いふち、両端は細くとがる。2コマで白と黒が入れ替わる（明滅）
 */
function bladeSlash(): SpriteOut {
  const palette = ['#000000', '#ffffff', '#9e9e9e'];
  const H = 8;
  const mid = (H - 1) / 2;
  const parts = lineParts(H, { start: 10, middle: 12, end: 10 }, 2, (x, y, f, part) => {
    const taper = part === 'start' ? x / 10 : part === 'end' ? 1 - x / 10 : 1;
    const dy = Math.abs(y - mid);
    if (dy > 0.6 + 2.6 * taper) return -1;
    const core = dy < 0.4 + 1.2 * taper;
    return core === (f === 0) ? 1 : 0;
  }, -1);
  return { palette, frameMs: 50, parts };
}

/**
 * リーフブレードの残像: 自分の周りを1周、刃が通り抜けた後の薄い黄緑の筋（輪に沿って並べる）。
 * 長方形のかたまりに見えないよう、1ドットの細い線を何本か引く（作者の指摘 2026年10月29日）。内側ほど長く明るい
 */
function bladeRing(): SpriteOut {
  const palette = ['#33691e', '#9ccc65', '#ccff90', '#f1f8e9'];
  const W = 16;
  const H = 8;
  const lanes: [number, number, number][] = [
    // [高さ, 線の長さの割合, 色]
    [1, 0.95, 3],
    [3, 0.7, 2],
    [5, 0.5, 2],
    [7, 0.3, 1],
  ];
  const frames: Grid[] = [];
  for (let f = 0; f < 2; f++) {
    frames.push(
      fill(blank(W, H), (x, y) => {
        for (const [k, [lane, len, c]] of lanes.entries()) {
          // どの細かさでも実際の1マスの太さの線（並べてつながるよう、線の切れ目は周期 W）
          if (Math.round((y + 0.5) * K - 0.5) !== Math.round((lane + 0.5) * K - 0.5)) continue;
          if ((x + f * 5 + k * 7) % W < W * len) return c;
        }
        return -1;
      }),
    );
  }
  return { palette, frameMs: 60, parts: { middle: frames.map(toRows) } };
}

/** ウェーブタックル: 当たった敵から上がる水しぶき（王冠のように外へ散るしずく。2コマで広がる） */
function waterSplash(): SpriteOut {
  const palette = ['#0d3550', '#0288d1', '#4fc3f7', '#e1f5fe'];
  const frames = [0, 1].map((f) =>
    shape(18, (u, v) => {
      const d = Math.hypot(u, v);
      const a = Math.atan2(v, u);
      // 真ん中の白い泡
      if (d < 0.14 - f * 0.06) return 3;
      // 外へ散る しずく（8方向。コマで外へ）
      for (let k = 0; k < 8; k++) {
        const ak = (k / 8) * Math.PI * 2 + 0.2;
        const r = 0.45 + f * 0.3 + (k % 2) * 0.1;
        const dx = u - Math.cos(ak) * r;
        const dy = v - Math.sin(ak) * r;
        if (Math.hypot(dx, dy) < 0.07 - f * 0.015) return k % 2 ? 2 : 3;
      }
      // 輪（水の冠）
      const ring = 0.38 + f * 0.25;
      if (Math.abs(d - ring) < 0.04 && Math.sin(a * 6) > -0.3) return 1;
      return -1;
    }),
  );
  return { palette, frameMs: 90, parts: { main: frames.map((g) => toRows(outline(g, 0))) } };
}

/**
 * ブレイズキック（作者の指摘 2026年10月29日: 脚っぽくなくてよい。炎をまとった脚らしきもの）: 右へ突き出す、炎に包まれた細長い脚。
 * 芯は明るい黄白、先は丸く光り、上下のふちから炎の舌が後ろへなびく（2コマでゆらぐ）
 */
function flameLeg(): SpriteOut {
  // 0 輪郭・1 濃い赤・2 だいだい・3 黄・4 黄白
  const palette = ['#4e1206', '#d84315', '#ff9800', '#ffe082', '#fff8e1'];
  const frames = [0, 1].map((f) =>
    shape(32, (u, w) => {
      if (u > 0.97 || u < -0.97) return -1;
      // 見た目と当たり判定をそろえる: 長さに対して細い（太さは長さの 2 割ほど）
      const v = w * 2.2;
      // 脚の芯: 根元は細く、先へ太くなって丸い先（足先）
      const tip = Math.hypot(u - 0.72, v) < 0.24;
      const core = 0.08 + 0.12 * ((u + 0.97) / 1.69);
      if (tip || (u < 0.72 && Math.abs(v) < core)) return Math.abs(v) < core * 0.45 || Math.hypot(u - 0.76, v) < 0.12 ? 4 : 3;
      // 炎: 芯のまわりを包み、後ろ（左）ほど外へなびく舌
      const flick = Math.sin(u * 11 + f * 2.4 + (v > 0 ? 1.3 : 0)) * 0.07;
      const flame = core + 0.1 + (0.97 - u) * 0.16 + flick;
      if (Math.abs(v) < flame && u < 0.9) return Math.abs(v) < flame * 0.72 ? 2 : 1;
      return -1;
    }),
  );
  return { palette, frameMs: 90, parts: { main: frames.map((g) => toRows(outline(g, 0))) } };
}

/**
 * つららおとし: 空から落ちる大きな氷の塊（下向きにとがる。作者の指摘 2026年10月27日）。上はぎざぎざの割れ口、
 * 下へ細くなって鋭い先。左の面が明るく、真ん中に稜線
 */
function iceChunk(): SpriteOut {
  // 0 輪郭・1 濃い青・2 青・3 水色・4 白
  const palette = ['#0d3550', '#0277bd', '#4fc3f7', '#b3e5fc', '#ffffff'];
  const g = shape(22, (u, v) => {
    // 上の割れ口（ぎざぎざ）
    const top = -0.8 + Math.abs(Math.sin(u * 7.5)) * 0.14;
    if (v < top || v > 0.97) return -1;
    // 上 3 割は太く、そこから下の先へ細くなる
    const w = v < -0.35 ? 0.62 - (v + 0.8) * 0.12 : 0.57 * Math.max(0, (0.97 - v) / 1.32);
    if (Math.abs(u) > w) return -1;
    const d = u / Math.max(0.02, w);
    if (Math.abs(d) < 0.08) return 4;
    if (v < top + 0.1) return 3;
    return d < -0.45 ? 3 : d < 0 ? 2 : d < 0.6 ? 2 : 1;
  });
  return { palette, frameMs: 1000, parts: { main: [toRows(g)] } };
}

/** すなあらしの砂粒: 小さな粒（白黒で描き、天気の色で茶色にする。天気の粒は落ちる向きに回すので、縦長に描くと横に流れて見える） */
function sandGrain(): SpriteOut {
  const palette = ['#9e9e9e', '#e0e0e0', '#ffffff'];
  // 細長い筋（風で流れる砂）。先が明るく、後ろが暗い
  const g = fill(blank(3, 9), (x, y) => (((x - 1) / 1.5) ** 2 + ((y - 4) / 4.6) ** 2 > 1 ? -1 : y > 5.5 ? 2 : y > 2.5 ? 1 : 0));
  return { palette, frameMs: 1000, parts: { main: [toRows(g)] } };
}

/** あまごいの雨: 小さなしずく（ティアドロップ形。上がとがり、下が丸い。白黒で描き、天気の色で水色にする） */
function rainDrop(): SpriteOut {
  const palette = ['#9e9e9e', '#e0e0e0', '#ffffff'];
  const g = blank(4, 8);
  fill(g, (x, y) => {
    // 下の丸（中心 y = 5.2、半径 1.6）と、上へ細くなる先
    const cx = 1.5;
    const round = Math.hypot(x - cx, y - 5.2) <= 1.75;
    const tip = y >= 0 && y < 5.2 && Math.abs(x - cx) <= 1.75 * (y / 5.2) ** 1.3;
    if (!round && !tip) return -1;
    return x < cx - 0.3 && y > 3.5 ? 2 : x > cx + 0.6 ? 0 : 1;
  });
  return { palette, frameMs: 1000, parts: { main: [toRows(g)] } };
}

/**
 * ストーンエッジ: 地面から突き出した、茶色いごつごつの岩の柱（横から見た姿。根元が絵の下の方 y = 21。作者の指摘 2026年10月25日:
 * 細いとげではなく、尖った岩肌）。大きな岩と、横に小さな岩。左の面が明るく、ひびが入る。根元に土ぼこり。
 * コマ 0 で地面から出かけ、1 で伸びきる（loopFrom 1）
 */
function rockSpire(): SpriteOut {
  const W = 18;
  const H = 24;
  const gy = 21;
  // 0 輪郭・1 ひび・2 暗い面・3 岩・4 明るい面・5 光の当たるふち・6 土ぼこり
  const palette = ['#24160e', '#3e2a1e', '#7a5238', '#a0704e', '#c4936a', '#e0b88e', '#c8ac8a'];
  // 岩: [根元の左, 根元の右, 先の x, 高さ, 稜線の根元の x]
  const rocks = [
    [2, 13, 8.5, 19, 7],
    [11, 17, 15.5, 10, 14],
  ] as const;
  const make = (grow: number): string[] => {
    const g = fill(blank(W, H), (x, y) => {
      for (const [l, r, tx, ht, ridge] of rocks) {
        const top = gy - ht * grow;
        if (y < top || y > gy) continue;
        const t = (gy - y) / (gy - top);
        // ごつごつのふち（高さごとに少し出入り）
        const jag = (hash(Math.floor(y * 0.7), Math.floor(l), 1300) - 0.5) * 1.6 * (1 - t);
        const xl = l + (tx - l) * t + jag;
        const xr = r + (tx - r) * t - jag * 0.6;
        if (x < xl || x > xr) continue;
        const xm = ridge + (tx - ridge) * t;
        // ひび（斜めの折れ線）
        if (Math.abs(x - xm - Math.sin(y * 0.9) * 1.2 - 1.5) < 0.35 && t > 0.15 && t < 0.8) return 1;
        if (x < xm) return x < xl + 1 && t < 0.9 ? 5 : 4;
        return x > xr - 1.2 ? 2 : 3;
      }
      // 根元の土ぼこり
      const ex = (x - 9) / 9;
      const ey = (y - gy - 0.5) / 2;
      if (ex * ex + ey * ey <= 1 && hash(Math.floor(x), Math.floor(y), 1310) < 0.92) return 6;
      return -1;
    });
    return toRows(outline(g, 0));
  };
  return { palette, frameMs: 70, loopFrom: 1, parts: { main: [make(0.45), make(1)] } };
}

/**
 * じわれ: 地面を走る黒い亀裂（じしんの揺れの絵の割れ目と同じ色。線に合わせる。作者の案 2026年10月25日）。
 * 並べてもつながるよう、ぎざぎざの周期は途中の部品の幅。始まり・終わりは細くなる
 */
function crackLine(): SpriteOut {
  const H = 8;
  const TILE = 8;
  const palette = ['#2a1d14', '#1a110b', '#5d4a3a'];
  const mid = (H - 1) / 2;
  const parts = lineParts(H, { start: 4, middle: TILE, end: 6 }, 1, (x, y, _f, part) => {
    const taper = part === 'start' ? 0.4 + (x / 4) * 0.6 : part === 'end' ? 1 - x / 6 : 1;
    // 折れ線（三角の波）でぎざぎざにする（なめらかな波だと、這う虫のように見える）
    const ph = ((part === 'middle' ? x : x * 1.3) / TILE + 0.25) % 1;
    const cy = mid + (Math.abs(ph * 2 - 1) * 2 - 1) * 1.5;
    const d = Math.abs(y - cy);
    if (d < 0.9 * taper) return 1;
    if (d < 1.8 * taper) return 2;
    return -1;
  }, 0);
  return { palette, frameMs: 1000, parts };
}

// ---------------- かくとう・ドラゴンの技（作者の依頼 2026年10月25日: 絵の作りこみから） ----------------
/** 角を丸めた四角の中か（論理の u・v。中心 cx, cy・半分の幅 hw, hh・角の丸み r） */
function inRoundRect(u: number, v: number, cx: number, cy: number, hw: number, hh: number, r: number): boolean {
  const dx = Math.max(0, Math.abs(u - cx) - (hw - r));
  const dy = Math.max(0, Math.abs(v - cy) - (hh - r));
  return dx * dx + dy * dy <= r * r;
}

/**
 * からてチョップ: 縦に走る手刀の刃（右へふくらむ三日月。前へなぎ払う向きに置く）。真ん中が太く両端がとがり、
 * 芯は白、ふちは青。後ろ（左）に速さの線。コマで刃の光が流れる
 */
function karateChop(): SpriteOut {
  // 0 輪郭・1 濃い青・2 青・3 うすい青・4 白・5 速さの線
  const palette = ['#0d1b2a', '#1e5aa8', '#64b5f6', '#bbdefb', '#ffffff', '#e3f2fd'];
  const frames = [0, 1].map((f) =>
    shape(24, (u, v) => {
      // 刃: 中心 (-1.1, 0)・半径 1.55 の円の弧に沿った帯
      const d = Math.hypot(u + 1.1, v) - 1.55;
      const half = 0.17 * Math.max(0, 1 - (Math.abs(v) / 0.95) ** 1.6);
      if (Math.abs(v) < 0.95 && Math.abs(d + half * 0.3) < half) {
        const k = (d + half * 0.3) / half;
        // 光の筋がコマで上下へ流れる
        if (Math.abs(v - (f ? 0.35 : -0.35)) < 0.08 && k > -0.4) return 4;
        return k > 0.55 ? 1 : k > 0.1 ? 2 : k > -0.5 ? 3 : 4;
      }
      // 速さの線（刃の後ろ）
      for (const [ly, len] of [[-0.45, 0.35], [-0.1, 0.5], [0.3, 0.4]] as const) {
        const x0 = -0.2 - Math.abs(ly) * 0.2 - (f ? 0.05 : 0);
        if (Math.abs(v - ly) < 0.035 && u < x0 && u > x0 - len) return 5;
      }
      return -1;
    }),
  );
  return { palette, frameMs: 70, parts: { main: frames.map(toRows) } };
}

/**
 * クロスチョップ: 前方に大きく交わる2本の手刀（X）。刃は少しふくらんだ斜めの線で、真ん中が太く両端がとがる。
 * 2本は上下に鏡写しで、交わる所に光がはじける。コマ 0 で刃が走り、1・2 で光が瞬く（loopFrom 1）
 */
function crossChop(palette = ['#0d1b2a', '#1e5aa8', '#64b5f6', '#bbdefb', '#ffffff', '#fff59d']): SpriteOut {
  // 右上から左下への刃（v を返すと、もう1本）。左下から伸びていく
  const blade = (u: number, v: number, grow: number): number => {
    const c = Math.SQRT1_2;
    const x = (u - v) * c;
    const y = (u + v) * c;
    if (x < 0.95 - 1.9 * grow) return -1;
    // 外（右下）へ少しふくらむ
    const d = y - 0.12 * (1 - x * x);
    const half = 0.15 * Math.max(0, 1 - (Math.abs(x) / 0.95) ** 1.5);
    if (Math.abs(x) > 0.95 || Math.abs(d) > half) return -1;
    const k = Math.abs(d) / half;
    return k > 0.75 ? 1 : k > 0.45 ? 2 : k > 0.2 ? 3 : 4;
  };
  const frames = [0.55, 1, 1].map((grow, f) =>
    shape(36, (u, v) => {
      // 交わった所の光（とげのある星）
      if (f > 0) {
        const a = Math.atan2(v, u);
        const r = Math.hypot(u, v);
        const spike = 0.12 + 0.16 * Math.abs(Math.cos(a * 2 + (f === 2 ? Math.PI / 2 : 0))) ** 6;
        if (r < spike) return r < 0.07 ? 4 : 5;
      }
      const a = blade(u, v, grow);
      const b = blade(u, -v, grow);
      if (a < 0) return b;
      if (b < 0) return a;
      return Math.max(a, b);
    }),
  );
  return { palette, frameMs: 80, loopFrom: 1, parts: { main: frames.map(toRows) } };
}

type PunchKind = 'plain' | 'mach' | 'focus' | 'fire' | 'thunder' | 'bullet';

/**
 * こぶし（右へ突き出した横からの姿）: 4つの関節のでこぼこと指の筋、前に巻いた親指、赤い手首のバンド。種類ごとにまわりを飾る
 * （作者の決定 2026年10月25日。ワンリキーのパンチ）:
 * plain（ばくれつパンチ）= 後ろに速さの線・先に衝撃の光、mach（マッハパンチ）= 長い速さの筋と白い残像、focus（きあいパンチ）= 橙の気のふち取り、
 * fire（ほのおのパンチ）= 後ろへなびく炎、thunder（かみなりパンチ）= まわりに走る稲妻
 */
function punch(kind: PunchKind = 'plain'): SpriteOut {
  // 0 輪郭・1 バンドの暗い所・2 バンド・3 肌の影・4 肌・5 肌の明るい所・6 白・7〜9 飾りの色（種類ごと。9 は先の衝撃の光にも使う）
  const deco: Record<PunchKind, string[]> = {
    plain: ['#ffb300', '#ffe082', '#fff176'],
    mach: ['#b3e5fc', '#e1f5fe', '#ffffff'],
    focus: ['#ff6d00', '#ffab40', '#ffe0b2'],
    fire: ['#d84315', '#ff9800', '#ffeb3b'],
    thunder: ['#f9a825', '#ffeb3b', '#fffde7'],
    bullet: ['#90a4ae', '#cfd8dc', '#ffffff'],
  };
  // バレットパンチ（ハッサム）: 赤いはがねのはさみの色（バンドは鋼の灰色）。飾りは マッハパンチ と同じ速さの筋を鋼の色で
  const palette = kind === 'bullet' ? ['#2b0808', '#37474f', '#78909c', '#8e1b1b', '#d32f2f', '#ef9a9a', '#ffffff', ...deco[kind]] : ['#2b1408', '#a31515', '#e53935', '#d8875c', '#f5bd8f', '#ffe3c8', '#ffffff', ...deco[kind]];
  const frames = [0, 1, 2].map((f) => {
    const r = rng(1700 + f);
    const sparks = Array.from({ length: 3 }, () => ({ a: r() * Math.PI * 2, len: 0.25 + r() * 0.15 }));
    return shape(24, (u, v) => {
      const knuckle = [-0.29, -0.1, 0.09, 0.27].some((ky) => Math.hypot(u - 0.52, v - ky) < 0.11);
      const body = inRoundRect(u, v, 0.2, -0.02, 0.36, 0.38, 0.12) || knuckle;
      const thumb = inRoundRect(u, v, 0.2, 0.3, 0.26, 0.09, 0.08);
      const band = inRoundRect(u, v, -0.27, -0.02, 0.12, 0.3, 0.05);
      const arm = u < -0.39 && u > -0.62 && Math.abs(v + 0.02) < 0.22;
      const fist = body || thumb || band || arm;
      if (fist) {
        if (thumb) return v > 0.34 ? 3 : 4;
        if (body) {
          if (u > 0.22 && [-0.2, -0.01, 0.18].some((ly) => Math.abs(v - ly) < 0.025)) return 3;
          if (v < -0.22 && u > -0.05) return 5;
          return v > 0.18 ? 3 : 4;
        }
        if (band) return v > 0.12 ? 1 : 2;
        return v > 0.08 ? 3 : 4;
      }
      // こぶしのまわり（輪郭のすぐ外）までの近さ
      const near = Math.max(0, 1 - Math.min(Math.hypot(u - 0.3, (v + 0.02) * 1.15) - 0.42, 1) / 0.2);
      if (kind === 'focus') {
        // 気のふち取り: こぶしのまわりを2重に囲む
        const d = Math.hypot((u - 0.15) / 0.82, (v + 0.02) / 0.62);
        if (d > 0.82 && d < 0.95 && (Math.floor(Math.atan2(v, u) * 6 + f * 2) % 3 !== 0)) return d < 0.88 ? 8 : 7;
        if (d >= 0.95 && d < 1.02 && f !== 1) return 9;
      }
      if (kind === 'fire') {
        // 後ろ（左）へなびく炎の舌（3本）
        for (const [k, oy] of [[0, -0.28], [1, 0], [2, 0.26]] as const) {
          const t = (-0.15 - u) / 0.8;
          if (t < 0 || t > 1) continue;
          const wob = Math.sin(t * 7 + f * 2 + k * 2) * 0.06 * t;
          const w = 0.14 * (1 - t) + 0.02;
          const d = Math.abs(v - oy * (1 + t * 0.5) - wob);
          if (d < w) return d < w * 0.4 ? 9 : t < 0.5 ? 8 : 7;
        }
        if (near > 0.6 && hash(Math.floor(u * 20), Math.floor(v * 20), 1710 + f) < 0.3) return 8;
      }
      if (kind === 'thunder') {
        // まわりに走る短い稲妻（こぶしの外へ、折れ線で）
        for (const sp of sparks) {
          const ca = Math.cos(sp.a);
          const sa = Math.sin(sp.a);
          const x0 = 0.25 + ca * 0.45;
          const y0 = sa * 0.42;
          const along = (u - x0) * ca + (v - y0) * sa;
          if (along < 0 || along > sp.len) continue;
          const side = -(u - x0) * sa + (v - y0) * ca;
          const zig = (Math.abs(((along / 0.08) % 2) - 1) - 0.5) * 0.06;
          if (Math.abs(side - zig) < 0.03) return 9;
          if (Math.abs(side - zig) < 0.06) return 8;
        }
      }
      if (kind === 'mach' || kind === 'bullet') {
        // 長い速さの筋と、少しずれた白い残像のふち
        for (const [ly, len] of [[-0.34, 0.5], [-0.12, 0.7], [0.1, 0.62], [0.3, 0.45]] as const) {
          if (Math.abs(v - ly) < 0.03 && u < -0.66 + 0.2 && u > -0.66 - len + f * 0.05) return 9;
        }
        const ghost = inRoundRect(u + 0.18, v, 0.2, -0.02, 0.36, 0.38, 0.12);
        if (ghost) return 7;
        return -1;
      }
      // 速さの線（後ろ）と、先の衝撃の光
      for (const [ly, len] of [[-0.3, 0.25], [0, 0.32], [0.26, 0.22]] as const) {
        if (Math.abs(v - ly) < 0.035 && u < -0.68 && u > -0.68 - len - (f % 2) * 0.08) return kind === 'fire' ? 8 : 6;
      }
      if (f === 1 || kind === 'focus') {
        const a = Math.atan2(v, u - 0.82);
        const rr = Math.hypot(u - 0.82, v);
        if (u > 0.68 && rr < 0.12 + 0.12 * Math.abs(Math.cos(a * 3)) ** 4) return 9;
      }
      return -1;
    });
  });
  return { palette, frameMs: 70, parts: { main: frames.map(toRows) } };
}

/**
 * にどげり: 右へ突き出した蹴り（横から見た足）。すねから足の甲、つま先は丸く、足の裏は濃い色。つま先に衝撃の光、
 * 後ろに速さの弧。コマ 1 で光が大きくなる
 */
function kick(): SpriteOut {
  // 0 輪郭・1 足の裏・2 影・3 足・4 明るい所・5 速さの線・6 衝撃
  const palette = ['#2b1408', '#7a3b1e', '#c98a5e', '#f0bf93', '#ffe3c8', '#ffffff', '#fff176'];
  const frames = [0, 1].map((f) =>
    shape(24, (u, v) => {
      const toe = Math.hypot(u - 0.82, v - 0.02);
      if (toe < 0.1 + f * 0.06 + 0.08 * Math.abs(Math.cos(Math.atan2(v - 0.02, u - 0.82) * 3)) ** 4) return 6;
      // すね（左上から足首へ）
      const t = Math.max(0, Math.min(1, ((u + 0.85) * 0.62 + (v + 0.75) * 0.78) / 1.02));
      const sx = -0.85 + 0.62 * t;
      const sy = -0.75 + 0.78 * t;
      const shin = Math.hypot(u - sx, v - sy) < 0.17 && t < 0.98;
      // 足: つま先が丸い横長の形
      const foot = inRoundRect(u, v, 0.22, 0.04, 0.46, 0.17, 0.15) || Math.hypot(u - 0.56, v + 0.01) < 0.15;
      if (foot) {
        if (v > 0.13) return 1;
        return v < -0.06 ? 4 : 3;
      }
      if (shin) return u + v < -1.05 ? 4 : u - v > -0.35 ? 2 : 3;
      // 速さの弧（すねの後ろ）
      const r = Math.hypot(u + 0.2, v + 0.15);
      if (u < -0.15 && v > -0.2 && Math.abs(r - 0.62 - f * 0.05) < 0.035) return 5;
      if (u < -0.3 && v > 0 && Math.abs(r - 0.82 - f * 0.05) < 0.03) return 5;
      return -1;
    }),
  );
  return { palette, frameMs: 70, parts: { main: frames.map(toRows) } };
}

/**
 * まわしげり: なぎ払う蹴りの残像（右へふくらむ大きな弧。先＝上ほど太く明るく、後ろ＝下ほど細く途切れる）と、
 * 弧の先ではじける衝撃の光
 */
function kickArc(): SpriteOut {
  // 0 輪郭・1 濃い橙・2 橙・3 うすい橙・4 白・5 衝撃
  const palette = ['#2b1408', '#e65100', '#ffb74d', '#ffe0b2', '#ffffff', '#fff176'];
  const frames = [0, 1].map((f) =>
    shape(28, (u, v) => {
      // 弧の先（右上）の衝撃の光
      const sx = 0.32;
      const sy = -0.72;
      const a = Math.atan2(v - sy, u - sx);
      if (Math.hypot(u - sx, v - sy) < 0.1 + f * 0.04 + 0.1 * Math.abs(Math.cos(a * 3)) ** 4) return 5;
      // 弧: 中心 (-0.9, 0)・半径 1.35 の円に沿った帯
      const d = Math.hypot(u + 0.9, v) - 1.35;
      const t = (v + 0.75) / 1.6;
      if (t < 0 || t > 1) return -1;
      const half = 0.04 + 0.16 * (1 - t);
      if (Math.abs(d + half * 0.2) > half) return -1;
      if (t > 0.55 && hash(Math.floor(v * 12), f, 1400) < (t - 0.55) * 1.6) return -1;
      const k = (d + half * 0.2) / half;
      return k > 0.6 ? 1 : k > 0.15 ? 2 : k > -0.4 ? 3 : 4;
    }),
  );
  return { palette, frameMs: 70, parts: { main: frames.map(toRows) } };
}

/**
 * ドラゴンテール: 前方をなぎ払う竜のしっぽ（左下から右へ弧を描き、先はひれ）。上の面が明るく、腹側に節。
 * 後ろに速さの弧。コマでしっぽが少ししなる
 */
/**
 * つばさでうつ: 広げた白い翼（右向き。付け根が左、先が右）。風切り羽が扇のように並び、先は水色（作者の依頼 2026年10月28日。07 の117章）。
 * なぎ払うときは、通った後に残像を残す（レシピの afterimages）
 */
function wing(): SpriteOut {
  // 0 輪郭・1 羽の影・2 うすい灰・3 白・4 光・5 羽先の水色
  const palette = ['#37474f', '#90a4ae', '#cfd8dc', '#f5f7f8', '#ffffff', '#b3e5fc'];
  const root = [-0.82, 0.05] as const;
  // 風切り羽: 付け根から扇のように（上から下へ。上の羽ほど長い）
  const feathers = Array.from({ length: 6 }, (_, k) => {
    const a = (-30 + k * 18) * (Math.PI / 180);
    return { dx: Math.cos(a), dy: Math.sin(a), len: 1.62 - k * 0.15, w: 0.12 };
  });
  const g = shape(28, (u, v) => {
    let got = -1;
    // 下の羽から順に塗り、上の羽を重ねる
    for (let k = feathers.length - 1; k >= 0; k--) {
      const f = feathers[k]!;
      const px = u - root[0];
      const py = v - root[1];
      const along = px * f.dx + py * f.dy;
      const across = -px * f.dy + py * f.dx;
      if (along < 0 || along > f.len) continue;
      // 先がとがった羽（先へ行くほど細く、少し反る）
      const t = along / f.len;
      const half = f.w * (t < 0.75 ? 1 : (1 - t) / 0.25) + 0.01;
      const bend = across - t * t * 0.12;
      if (Math.abs(bend) > half) continue;
      const side = bend / half;
      got = t > 0.82 ? 5 : side < -0.55 ? 4 : side < 0.35 ? 3 : 2;
      // 羽の下のふちは濃く（1枚ずつ分かれて見えるように）
      if (side > 0.62) got = 0;
      else if (side > 0.35 && t > 0.3) got = 1;
    }
    // 付け根の覆い羽（丸いかたまり）
    const cu = (u + 0.58) / 0.36;
    const cv = (v + 0.12) / 0.26;
    if (cu * cu + cv * cv <= 1) got = cv < -0.3 ? 4 : cv < 0.4 ? 3 : 2;
    return got;
  });
  return { palette, frameMs: 1000, parts: { main: [toRows(outline(g, 0))] } };
}

function tailSwipe(palette = ['#120a2e', '#283593', '#5c6bc0', '#9fa8da', '#e8eaf6', '#9575cd', '#ffffff']): SpriteOut {
  // 0 輪郭・1 腹側の暗い色・2 しっぽ・3 うすい色・4 白い光・5 ひれ・6 速さの線（アイアンテール は鋼の灰色）
  const frames = [0, 1].map((f) => {
    const p0 = [-0.95, 0.7] as const;
    const p1 = [-0.1, 0.55 - f * 0.08] as const;
    const p2 = [0.68, -0.15 + f * 0.05] as const;
    const at = (t: number): [number, number] => [
      (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
      (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1],
    ];
    const pts = Array.from({ length: 41 }, (_, i) => at(i / 40));
    return toRows(
      shape(28, (u, v) => {
        // しっぽの中心線（2次のベジエ曲線）への一番近い点
        let best = 9;
        let bt = 0;
        pts.forEach(([x, y], i) => {
          const d = Math.hypot(u - x, v - y);
          if (d < best) {
            best = d;
            bt = i / 40;
          }
        });
        const half = 0.2 * (1 - bt) + 0.05;
        if (best < half && bt < 0.98) {
          // 節（腹側の横線）と、上下の塗り分け（上が明るい）
          if (Math.abs(((bt * 9) % 1) - 0.5) < 0.06 && bt < 0.85) return 1;
          const side = (v - at(bt)[1]) / half;
          return side < -0.45 ? 4 : side < 0.15 ? 3 : side < 0.6 ? 2 : 1;
        }
        // 先のひれ（三角）
        const tx = u - p2[0];
        const ty = v - p2[1];
        if (tx > -0.12 && tx < 0.28 && Math.abs(ty) < 0.22 * (1 - (tx + 0.12) / 0.4)) return ty < 0 ? 5 : 2;
        // 速さの弧（しっぽの上）
        if (best > half + 0.08 && best < half + 0.13 && v < at(bt)[1] && bt > 0.2 && bt < 0.85 && (bt * 10 + f) % 2 < 1.3) return 6;
        return -1;
      }),
    );
  });
  return { palette, frameMs: 80, parts: { main: frames } };
}

/**
 * りゅうのいかり: 右へ飛ぶ紫の竜の炎（頭は丸く、後ろへ3本の炎の舌がゆらめく。芯は桃色に白く光る）。
 * 続けて飛ばすと1本につながった炎に見える。4コマでゆらめく
 */
function dragonFire(): SpriteOut {
  // 0 輪郭・1 濃い紫・2 紫・3 うすい紫・4 桃・5 白
  const palette = ['#14062e', '#4527a0', '#7c4dff', '#b388ff', '#ea80fc', '#fce4ff'];
  const frames = [0, 1, 2, 3].map((f) =>
    shape(18, (u, v) => {
      const head = Math.hypot(u - 0.3, v) / 0.48;
      // 炎の舌: 頭から後ろへ、上・真ん中・下の3本
      let tongue = 9;
      for (const [k, off] of [[0, -0.22], [1, 0], [2, 0.22]] as const) {
        const t = (0.3 - u) / 1.15;
        const len = k === 1 ? 1 : 0.7;
        if (t < 0 || t > len) continue;
        const wob = Math.sin(t * 6 + f * 1.6 + k * 2) * 0.1 * t;
        const w = 0.2 * (1 - t / len) + 0.02;
        const d = Math.abs(v - off * (1 - t * 0.3) - wob) / w;
        if (d < 1) tongue = Math.min(tongue, d * 0.5 + t * 0.6);
      }
      if (head > 1 && tongue > 1) return -1;
      const heat = head <= 1 ? head * 0.8 : 0.45 + tongue * 0.6;
      return heat < 0.3 ? 5 : heat < 0.5 ? 4 : heat < 0.7 ? 3 : heat < 0.9 ? 2 : 1;
    }),
  );
  return { palette, frameMs: 70, parts: { main: frames.map(toRows) } };
}

/**
 * りゅうのはどう: 進む向きに立てて並ぶ、竜の気の輪（縦長の楕円の輪。右へ進む）。手前（右）の弧が明るく、奥（左）は暗い。
 * コマで輪の光が回る
 */
function dragonRing(): SpriteOut {
  // 0 輪郭・1 濃い紫・2 紫・3 青緑・4 うすい青緑・5 白
  const palette = ['#120a2e', '#4527a0', '#7e57c2', '#26c6da', '#b2ebf2', '#ffffff'];
  const frames = [0, 1, 2].map((f) =>
    shape(24, (u, v) => {
      const e = Math.hypot(u / 0.34, v / 0.92);
      if (Math.abs(e - 0.84) > 0.15) return -1;
      const a = Math.atan2(v / 0.92, u / 0.34);
      // 手前（右）ほど明るい。光の点がコマで回る
      const front = Math.cos(a);
      if (Math.abs(Math.sin(a - (f * Math.PI * 2) / 3)) < 0.18 && front > -0.2) return 5;
      const k = Math.abs(e - 0.84) / 0.15;
      if (k > 0.7) return front > 0 ? 2 : 1;
      return front > 0.3 ? 4 : front > -0.3 ? 3 : 2;
    }),
  );
  return { palette, frameMs: 70, parts: { main: frames.map(toRows) } };
}

/**
 * ドラゴンダイブ: 体当たりで広がる竜の気の衝撃波（輪に沿って並べる帯。下が外）。外のふちに白と青緑の炎の舌、
 * 内側へ紫に薄れる。並べてもつながるよう、舌の高さは幅 W の周期
 */
function dragonShock(): SpriteOut {
  const W = 12;
  const H = 10;
  // 0 輪郭・1 濃い紫・2 紫・3 うすい紫・4 青緑・5 うすい青緑・6 白
  const palette = ['#120a2e', '#311b92', '#5e35b1', '#9575cd', '#26c6da', '#b2ebf2', '#ffffff'];
  const frames = [0, 1, 2].map((f) => {
    const g = fill(blank(W, H), (x, yy) => {
      const y = H - 1 - yy;
      const ph = (x / W) * Math.PI * 2;
      const tip = 3.5 - 2.2 * Math.max(0, Math.sin(ph * 2 + f * 1.4)) - 1.2 * Math.max(0, Math.sin(ph * 3 - f * 2 + 1));
      if (y < tip) return -1;
      const k = (y - tip) / (H - tip);
      if (k > 0.75 && noise(Math.cos(ph) * 3 + 3, Math.sin(ph) * 3 + y, 1.5, 1500 + f) < (k - 0.75) * 4) return -1;
      return k < 0.12 ? 6 : k < 0.25 ? 5 : k < 0.4 ? 4 : k < 0.58 ? 3 : k < 0.75 ? 2 : 1;
    });
    return toRows(outline(g, 0));
  });
  return { palette, frameMs: 70, parts: { middle: frames } };
}

/** 自作の絵であることの表記（data/render/move-sprites.json の credit） */
export const MOVE_ART_CREDIT = '自作（src/render/moveArt.ts で計算して描いた。公式の素材は使っていない）';

/** 絵の名前 → 描く関数 */
const MOVE_ART: Record<string, () => SpriteOut> = {
    'frenzy-plant': () => roots(),
    'root-line': () => rootLine(),
    'water-stream': () => stream(),
    ember: () => ember(),
    'water-drop': () => waterDrop(),
    bubble: () => bubble(),
    'leaf-line': () => leafLine('leaf'),
    'petal-line': () => leafLine('petal'),
    leaf: () => single(leafLine('leaf')),
    petal: () => single(leafLine('petal')),
    'tri-orb': () => triOrb(),
    'hyper-beam': () => hyperBeam(),
    // ソーラービーム（色違いのフシギバナ）: はかいこうせんの形で、内側が白・外側が黄緑。点滅はしない
    'solar-beam': () => hyperBeam(['#33691e', '#76b82a', '#c6ef5a', '#f4ffc4', '#ffffff'], false),
    lightning: () => lightning(),
    'ice-beam': () => iceBeam(),
    'aurora-beam': () => auroraBeam(),
    psybeam: () => psyBeam(),
    'flame-cone': () => cone('flame'),
    'bubble-cone': () => cone('bubble'),
    'sound-cone': () => cone('sound'),
    'electric-cone': () => cone('electric'),
    'quake-crack': () => quakeCrack(),
    snowflake: () => snowflake(),
    'poison-cloud': () => poisonCloud(),
    'fang-bite': () => fangBite(),
    'dark-jaws': () => darkJaws(),
    'fang-front-dark': () => fangFront('dark'),
    'fang-front-fire': () => fangFront('fire'),
    'dark-fang': () => fangBite(['#0e0a0a', '#3e2723', '#5d4037', '#bdb4ae', '#ffffff']),
    'flame-crash': () => flameCrash(),
    'impact-crescent': () => impactCrescent(),
    'speed-streak': () => speedStreak(),
    'spark-arc': () => sparkArc(),
    chop: () => karateChop(),
    'cross-chop': () => crossChop(),
    fist: () => punch('plain'),
    'fist-mach': () => punch('mach'),
    'fist-bullet': () => punch('bullet'),
    'fist-focus': () => punch('focus'),
    'fist-fire': () => punch('fire'),
    'fist-thunder': () => punch('thunder'),
    kick: () => kick(),
    'kick-arc': () => kickArc(),
    'tail-swipe': () => tailSwipe(),
    'tail-iron': () => tailSwipe(['#1c2833', '#455a64', '#90a4ae', '#cfd8dc', '#ffffff', '#b0bec5', '#ffffff']),
    // つばさでうつ: 広げた白い翼（07 の117章）
    wing: () => wing(),
    'dragon-ring': () => dragonRing(),
    'dragon-shock': () => dragonShock(),
    palm: () => palm(),
    'dust-ring': () => shockRing('dust'),
    'giga-ring': () => shockRing('giga'),
    'dark-ring': () => shockRing('dark'),
    'snarl-ring': () => shockRing('snarl'),
    'mud-ring': () => shockRing('mud'),
    'lava-ring': () => shockRing('lava'),
    claw: () => claw('small'),
    'claw-big': () => claw('big'),
    'fury-slash': () => furySlash(),
    'x-scissor': () => crossChop(['#10240a', '#33691e', '#7cb342', '#c5e1a5', '#ffffff', '#f0f4c3']),
    // クロスポイズン: 同じ X の刃を毒の紫で
    'x-poison': () => crossChop(['#1a0624', '#6a1b9a', '#ab47bc', '#e1bee7', '#ffffff', '#f3e5f5']),
    'steel-beam': () => steelBeam(),
    rock: () => rock('rock'),
    stone: () => rock('stone'),
    bone: () => bone(),
    star: () => star(),
    needle: () => needle(),
    sludge: () => sludge(),
    'shadow-orb': () => orb('shadow'),
    'aura-orb': () => orb('aura'),
    whirlpool: () => whirlpool(),
    'water-spout': () => waterSpout(),
    'flame-swirl': () => flameSwirl(),
    'flame-wheel': () => flameWheel(),
    'burst-ice': () => burst('ice'),
    'burst-meteor': () => burst('meteor'),
    'burst-psy': () => burst('psy'),
    'burst-shadow': () => burst('shadow'),
    'burst-fire': () => burst('fire'),
    'burst-thunder': () => burst('thunder'),
    'burst-spark': () => burst('spark'),
    'streak-white': () => streak('white'),
    'streak-electric': () => streak('electric'),
    'streak-fire': () => streak('fire'),
    'gust-swirl': () => gustSwirl(),
    'air-blade': () => airBlade(),
    'ice-shard': () => iceShard(),
    'vine-line': () => vineLine(),
    'leech-seed': () => leechSeed(),
    'seed-bomb': () => seedBomb(),
    'sleep-cloud': () => sleepCloud(),
    'zap-orb': () => zapOrb(),
    'dragon-flame': () => dragonFire(),
    'spin-spray': () => spinSpray(),
    'note-ring': () => noteRing(),
    'sound-waves': () => soundWaves(),
    'perish-ring': () => perishRing(),
    'heal-rise': () => healRise(),
    'sun-rise': () => healRise(['#5d4a00', '#c0ca33', '#fff176', '#ffffff']),
    // つきのひかり: 同じ形で、月の光の色（淡い黄色と白）
    'moon-rise': () => healRise(['#4a3a6a', '#f8bbd0', '#fff9c4', '#ffffff']),
    'amnesia-swirl': () => amnesiaSwirl(),
    'rainbow-stars': () => rainbowStars(),
    'fire-geyser': () => fireGeyser(),
    'explosion-core': () => explosionCore(),
    'blast-edge': () => blastEdge(),
    'water-column': () => waterColumn(),
    'sludge-trail': () => sludgeTrail(),
    'electric-ring': () => electricRing(),
    'electric-crackle': () => electricCrackle(),
    'quake-zone': () => quakeZone(),
    'magma-pool': () => magmaPool(),
    'rock-spire': () => rockSpire(),
    'crack-line': () => crackLine(),
    'crack-head': () => crackHead(),
    'ice-statue': () => iceStatue(),
    'ice-needle': () => iceNeedle(),
    horn: () => horn(),
    // つつく: つのでつく と同じ形の、黄色いくちばし（07 の116章）
    beak: () => horn(['#4a2c05', '#c77800', '#ffb300', '#ffe082', '#fffde7', '#8d5a00']),
    'megahorn-lance': () => megahornLance(),
    'ice-chunk': () => iceChunk(),
    'sand-grain': () => sandGrain(),
    'rain-drop': () => rainDrop(),
    'blade-slash': () => bladeSlash(),
    'blade-ring': () => bladeRing(),
    'flame-leg': () => flameLeg(),
    'water-splash': () => waterSplash(),
};

/** 絵の名前の一覧 */
export const moveArtIds = (): string[] => Object.keys(MOVE_ART);

/**
 * 絵を細かさ k で描く（k = 1 が基準のマス数。2 なら縦横 2 倍のマス数で描き直す）。無い名前なら null。
 * 描いている間だけ K を変える（ほかの描画と同時には動かない）
 */
export function drawMoveArt(id: string, k: number): SpriteOut | null {
  const make = MOVE_ART[id];
  if (!make) return null;
  const prev = K;
  K = Math.max(0.25, k);
  try {
    return make();
  } finally {
    K = prev;
  }
}
