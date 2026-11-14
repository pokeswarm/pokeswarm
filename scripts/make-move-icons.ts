/**
 * 技のアイコンの絵を書き出す（07 の264・265章）。
 *   npm run move-icons                       data/render/move-icons.json を書き出す
 *   npm run move-icons -- --preview out.png  前の絵（白い絵柄）と新しい絵を並べた確認用の画像も書く
 *   npm run move-icons -- --pick 技,技 out.png  選んだ技のアイコンを 4 倍で並べた画像を書く（技を足したとき）
 *   npm run move-icons -- --sheet フォルダ    タイプごとに全部を並べた画像を書く
 *   npm run move-icons -- --auto             ICONS に書いていない（レシピの絵を 1 つ置いただけの）技を出す
 * 技を足したときの作り方と決まりは docs/09 の「技のアイコン」。絵の無い技があると止まる（終了コード 1）。
 *
 * 作者の決まり（2026年11月15日）: アイコンのドット絵に黒の輪郭線を使わない。技ごとに「何を発生させたか」から考えて 1 つのアイコンにする。
 * そこで、ゲームの中でその技が出すもの（src/render/moveArt.ts の技の絵: 火の玉・爪あと・水の流れ など）を、
 * アイコンの細かさで描き直して並べる（大きさ・向き・数をアイコンに合わせる）。形は絵の色の濃淡で出し、輪郭は足さない。
 * 絵は 32 × 32。外側の 2 ドットは枠なので、3〜28 の中に置く。背景はタイプの色を暗くした四角（描かない所）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { iconPixels, type IconTier } from '../src/render/iconPixels.ts';
import { drawMoveArt } from '../src/render/moveArt.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const N = 32;

/** ゲームの中で絵（moveArt）ではなく線や粒で描かれる演出（稲妻の線・天気の粒）を、同じ色で描く */
interface Draw {
  draw: (px: (string | null)[]) => void;
}

/** アイコンに置く技の絵 1 つ */
interface ArtLayer {
  /** 技の絵の名前（moveArt.ts） */
  art: string;
  /** 部品（main。線の絵は line で start・middle・end をつなぐ） */
  part?: string;
  /** 線の絵: middle をいくつ並べるか */
  line?: number;
  /** コマ（省略で真ん中のコマ） */
  frame?: number;
  /** 細かさ（1 がゲームの基準のマス数） */
  k: number;
  /** 置く中心 */
  x: number;
  y: number;
  /** 回す角度（度。右回り） */
  rot?: number;
  flip?: boolean;
  /** 暗い色も描く（輪郭ではなく、絵そのものの暗い色: マリルリの紺の尻尾） */
  keepDark?: boolean;
  /** 黒に近い色を、同じ色合いのまま明るくして描く（影のたまり・ほろびのうた の音符など、暗い色そのものが絵の技） */
  lift?: boolean;
  /** 白に寄せる割合（ものまね の写し: 同じ絵をうすく） */
  tint?: number;
}
type Layer = ArtLayer | Draw;

/** 種を決めた乱数（いつも同じ絵になる） */
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

function plot(px: (string | null)[], x: number, y: number, c: string): void {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix >= 2 && iy >= 2 && ix < N - 2 && iy < N - 2) px[iy * N + ix] = c;
}

/** 太さ r の線（点を細かく打つ） */
function line(px: (string | null)[], ax: number, ay: number, bx: number, by: number, r: number, c: string): void {
  const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 3) + 1;
  for (let i = 0; i <= steps; i++) {
    const x = ax + ((bx - ax) * i) / steps;
    const y = ay + ((by - ay) * i) / steps;
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) if (dx * dx + dy * dy <= r * r) plot(px, x + dx, y + dy, c);
  }
}

/** 稲妻の線（ゲームの lightningLine と同じ: 光の色の太い線に、白い芯。jitter で折れ曲がる） */
function lightning(from: [number, number], to: [number, number], o: { glow: string; core: string; width: number; jitter: number; seed: number; segs?: number }): Draw {
  return {
    draw: (px) => {
      const r = rng(o.seed);
      const n = o.segs ?? 6;
      const pts: [number, number][] = [from];
      const dx = to[0] - from[0];
      const dy = to[1] - from[1];
      const len = Math.hypot(dx, dy);
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const off = (r() * 2 - 1) * o.jitter;
        pts.push([from[0] + dx * t + (-dy / len) * off, from[1] + dy * t + (dx / len) * off]);
      }
      pts.push(to);
      for (let i = 1; i < pts.length; i++) line(px, pts[i - 1]![0], pts[i - 1]![1], pts[i]![0], pts[i]![1], o.width * 0.6, o.glow);
      for (let i = 1; i < pts.length; i++) line(px, pts[i - 1]![0], pts[i - 1]![1], pts[i]![0], pts[i]![1], o.width * 0.22, o.core);
    },
  };
}

/** 天気の粒（ゲームの weather と同じ色・向き。len は流れる筋の長さ） */
function weather(o: { colors: string[]; count: number; angle: number; len: [number, number]; size: number; seed: number }): Draw {
  return {
    draw: (px) => {
      const r = rng(o.seed);
      const a = ((o.angle + 90) * Math.PI) / 180;
      for (let i = 0; i < o.count; i++) {
        const x = 3 + r() * 26;
        const y = 3 + r() * 26;
        const l = o.len[0] + r() * (o.len[1] - o.len[0]);
        const c = o.colors[Math.floor(r() * o.colors.length)]!;
        line(px, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, o.size, c);
      }
    },
  };
}

function mixHex(a: string, b: string, k: number): string {
  const p = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = p(a);
  const y = p(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i]! - v) * k).toString(16).padStart(2, '0')).join('');
}

/**
 * ゲームの中で何も出ない技（いつも効く技・ネコにこばん など）の絵を、マスごとの色で描く（07 の266章）。
 * 輪郭は付けない。形は明るい面・暗い面の濃淡で出す（暗い面も黒ではなく、その物の色を暗くしたもの）
 */
function paint(fn: (x: number, y: number) => string | null): Draw {
  return {
    draw: (px) => {
      for (let y = 2; y < N - 2; y++) for (let x = 2; x < N - 2; x++) {
        const c = fn(x + 0.5, y + 0.5);
        if (c) px[y * N + x] = c;
      }
    },
  };
}

/** 光のきらめき（十字の小さな光） */
function glint(cx: number, cy: number, r: number, c = '#ffffff', mid = '#fff9c4'): Draw {
  return paint((x, y) => {
    const dx = Math.abs(x - cx);
    const dy = Math.abs(y - cy);
    if (dx < 0.6 && dy < 0.6) return c;
    if ((dx < 0.6 && dy < r) || (dy < 0.6 && dx < r)) return dx + dy < r * 0.55 ? c : mid;
    return null;
  });
}

/** つるぎのまい: 自分のまわりを回る剣（刃は鋼の色で、片側を白く光らせる。つばは金、柄は茶） */
function swordRing(count: number, twist: number): Draw {
  return paint((x, y) => {
    const dx = x - 16;
    const dy = y - 16;
    for (let i = 0; i < count; i++) {
      const a = ((i * 360) / count - 90) * (Math.PI / 180);
      // 剣の向き（外向きから twist 度ずらして、回っているように）
      const d = a + (twist * Math.PI) / 180;
      const ux = Math.cos(d);
      const uy = Math.sin(d);
      // 剣の根もと（円の上）
      const bx = Math.cos(a) * 3.2;
      const by = Math.sin(a) * 3.2;
      const along = (dx - bx) * ux + (dy - by) * uy;
      const side = -(dx - bx) * uy + (dy - by) * ux;
      if (along > 3.2 && along < 13.4) {
        const half = along > 11 ? (13.4 - along) * 0.6 : 1.45;
        if (Math.abs(side) < half) return side < -0.15 ? '#ffffff' : along > 9 ? '#e3eef3' : '#b0c4ce';
      }
      if (along > 2.2 && along <= 3.2 && Math.abs(side) < 2.6) return side < 0 ? '#ffe082' : '#ffb300';
      if (along > 0 && along <= 2.2 && Math.abs(side) < 0.7) return '#a1887f';
    }
    return null;
  });
}

/** ネコにこばん: 飛ぶ小判（たての楕円の金。左上が明るく、右下は濃い金。横の筋） */
function koban(cx: number, cy: number, rx: number, ry: number): Draw {
  return paint((x, y) => {
    const u = (x - cx) / rx;
    const v = (y - cy) / ry;
    const d = u * u + v * v;
    if (d > 1) return null;
    if (d > 0.62 && u + v > 0.2) return '#c88a00';
    if (d < 0.5 && u + v < -0.55) return '#fff59d';
    if (d < 0.62 && Math.abs(v) < 0.6 && Math.round((y - cy) * 1.0 + 100) % 2 === 0 && Math.abs(u) < 0.62) return '#f2b01e';
    return '#fdd835';
  });
}

/** かくばる: 角ばった結晶（面ごとに明るさを変える。ポリゴンの桃色と水色） */
function facetGem(cx: number, cy: number, w: number, h: number, rot: number): Draw {
  const a = (rot * Math.PI) / 180;
  return paint((x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const u = dx * Math.cos(a) + dy * Math.sin(a);
    const v = -dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(u) / w + Math.abs(v) / h > 1) return null;
    // 4 つの面と、真ん中の稜線
    if (Math.abs(v) < 0.5) return '#ffffff';
    if (v < 0) return u < 0 ? '#f8bbd0' : '#f06292';
    return u < 0 ? '#80deea' : '#26a69a';
  });
}

/** かたくなる: 硬くなった体の表面（六角の板が並んだ丸。板のすきまは同じ色の暗い色、斜めの光の帯） */
function hardShell(cx: number, cy: number, r: number): Draw {
  return paint((x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy);
    if (d > r) return null;
    // 六角の板: 六角の格子の中心のうち一番近いものの板。2 番目に近い中心との差が小さい所がすきま
    const s = 7;
    let best = Infinity;
    let second = Infinity;
    let lx = 0;
    let ly = 0;
    for (let row = -3; row <= 3; row++) {
      for (let col = -3; col <= 3; col++) {
        const px = col * s + (row % 2 ? s / 2 : 0);
        const py = row * s * 0.866;
        const e = Math.hypot(dx - px, dy - py);
        if (e < best) {
          second = best;
          best = e;
          lx = dx - px;
          ly = dy - py;
        } else if (e < second) second = e;
      }
    }
    const gap = second - best < 0.9;
    const shine = Math.abs(dx + dy + r * 0.5) < 1.6;
    if (d > r - 1.1) return '#8d8174';
    if (gap) return '#7d7066';
    if (shine) return '#fafafa';
    // 板ごとに左上を明るく（ふくらんだ板）
    return lx + ly < -1.6 ? '#e8e0dc' : lx + ly > 1.6 ? '#a89a90' : '#c9bcb4';
  });
}

/** まるくなる: 丸まった体（まり。うずの溝と、左上の光） */
function curledBall(cx: number, cy: number, r: number): Draw {
  return paint((x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy);
    if (d > r) return null;
    const ang = Math.atan2(dy, dx);
    // うず: 半径が角度とともに大きくなる線
    const t = (ang + Math.PI) / (2 * Math.PI);
    let groove = false;
    for (let k = 0; k < 3; k++) {
      const rr = (t + k) * (r / 2.6);
      if (Math.abs(d - rr) < 0.75 && rr < r - 1.2) groove = true;
    }
    if (Math.hypot(dx + r * 0.38, dy + r * 0.42) < r * 0.24) return '#fff3e0';
    if (groove) return '#a1673f';
    return dx * 0.6 + dy * 0.8 > r * 0.35 ? '#c98a55' : '#e8b07a';
  });
}

/** テクスチャー: 体の色（タイプ）が移り変わるタイル。左上の 1 ドットを明るく */
function typeTiles(colors: string[]): Draw {
  return paint((x, y) => {
    const gx = Math.floor((x - 5) / 7.5);
    const gy = Math.floor((y - 5) / 7.5);
    if (gx < 0 || gy < 0 || gx > 2 || gy > 2) return null;
    const fx = x - 5 - gx * 7.5;
    const fy = y - 5 - gy * 7.5;
    if (fx > 6.2 || fy > 6.2) return null;
    const c = colors[gy * 3 + gx]!;
    if (fx < 1.5 && fy < 1.5) return mixHex(c, '#ffffff', 0.6);
    return fx + fy > 9 ? mixHex(c, '#000000', 0.25) : c;
  });
}

/** 円に並べた技の絵（ちかい の輪: 属性の粒が自分のまわりを回る） */
function ringOf(art: string, count: number, r: number, k: number, extra: Partial<ArtLayer> = {}, turn = 90): ArtLayer[] {
  return Array.from({ length: count }, (_, i) => {
    const a = (i * 360) / count;
    return { art, k, x: 16 + Math.cos((a * Math.PI) / 180) * r, y: 16 + Math.sin((a * Math.PI) / 180) * r, rot: a + turn, ...extra };
  });
}

/** 技の名前ごとのアイコン（作者に見せる見本から。07 の265章） */
const ICONS: Record<string, Layer[]> = {
  // ひのこ: 火の玉が 2 つ、右上へ飛ぶ
  ember: [
    { art: 'ember', k: 1.2, x: 9.5, y: 22.5, rot: -35 },
    { art: 'ember', k: 1.55, x: 18.5, y: 13, rot: -35 },
  ],
  // かえんほうしゃ: 炎の流れ
  flamethrower: [{ art: 'flame-cone', k: 0.95, x: 16, y: 16, rot: -40 }],
  // ほのおのうず: 火の玉が 3 つ、まわりを回る
  'fire-spin': [0, 120, 240].map((a) => ({ art: 'fire-spin-ball', k: 0.95, x: 16 + Math.cos((a * Math.PI) / 180) * 7, y: 16 + Math.sin((a * Math.PI) / 180) * 7, rot: a + 90 })),
  // フレアドライブ: 体をつつむ炎
  'flare-blitz': [{ art: 'flame-shroud', k: 0.38, x: 16, y: 16 }],
  // ブラストバーン: 爆炎の柱と、弾ける炎
  'blast-burn': [
    { art: 'fire-geyser', k: 0.66, x: 16, y: 16 },
  ],
  // ほのおのパンチ: 炎の拳と、当たって弾ける炎
  'fire-punch': [
    { art: 'burst-fire', k: 0.6, x: 22, y: 11 },
    { art: 'fist-fire', k: 1.05, x: 14, y: 18, rot: -40 },
  ],
  // ふんか: 噴き上がる溶岩の玉
  eruption: [
    { art: 'flame-swirl', k: 0.75, x: 9.5, y: 20, rot: -120 },
    { art: 'flame-swirl', k: 0.75, x: 22.5, y: 20, rot: -60 },
    { art: 'flame-swirl', k: 0.95, x: 16, y: 11, rot: -90 },
  ],
  // ふんえん: 噴き出す煙の塊
  'lava-plume': [
    { art: 'plume-smoke', k: 0.62, x: 21.5, y: 10.5 },
    { art: 'plume-smoke', k: 0.8, x: 12, y: 19.5 },
  ],
  // だいもんじ: 炎の「大」の字（ゲームと同じ 5 本の腕と、真ん中の火の玉）
  'fire-blast': [
    ...[0, -90, 180, 60, 120].map((a) => ({ art: 'fire-blast-arm', line: 0, k: 0.72, x: 16 + Math.cos((a * Math.PI) / 180) * 6.5, y: 15 + Math.sin((a * Math.PI) / 180) * 6.5, rot: a })),
    { art: 'fire-blast-ball', k: 0.42, x: 16, y: 15 },
  ],
  // みずでっぽう: 水の弾が続けて飛ぶ
  'water-gun': [
    { art: 'water-drop', k: 0.75, x: 8.5, y: 23.5, rot: -40 },
    { art: 'water-drop', k: 0.95, x: 14.5, y: 17, rot: -40 },
    { art: 'water-drop', k: 1.2, x: 21.5, y: 10, rot: -40 },
  ],
  // しおふき: 噴き上がる水の柱
  'water-spout': [{ art: 'water-column', k: 0.66, x: 16, y: 16 }],
  // ハイドロカノン: 2 本の激流
  'hydro-cannon': [
    { art: 'water-stream', line: 2, k: 0.7, x: 13, y: 13, rot: -40 },
    { art: 'water-stream', line: 2, k: 0.7, x: 19, y: 19, rot: -40 },
  ],
  // ウェーブタックル: 水をまとって突っ込み、当たって弾ける
  'wave-crash': [
    { art: 'water-stream', line: 0, k: 0.75, x: 10, y: 22, rot: -40 },
    { art: 'aqua-tail-splash', frame: 3, k: 0.5, x: 20, y: 12 },
  ],
  // しおみず: しおの弾
  brine: [{ art: 'brine-shot', k: 1.2, x: 16, y: 16, rot: -40 }],
  // みずのはどう: 広がる水の輪
  'water-pulse': [
    { art: 'water-ring', k: 0.75, x: 9, y: 23, rot: -40 },
    { art: 'water-ring', k: 0.95, x: 15, y: 17, rot: -40 },
    { art: 'water-ring', k: 1.15, x: 21.5, y: 10.5, rot: -40 },
  ],
  // アクアテール: 水の玉の付いた尻尾を振る
  'aqua-tail': [{ art: 'aqua-tail-splash', frame: 1, k: 0.66, x: 14, y: 16, lift: true }],
  // ---- 線と粒の演出（ゲームの中で絵ではなく線・粒で描かれる技） ----
  // でんきショック: 敵へ走る細い稲妻
  'thunder-shock': [
    lightning([5, 9], [24, 23], { glow: '#ffeb3b', core: '#fffde7', width: 2.4, jitter: 3, seed: 3 }),
    { art: 'burst-spark', k: 0.55, x: 24, y: 23 },
  ],
  // かみなり: 空から落ちる太い稲妻
  thunder: [
    lightning([15, 3], [17, 23], { glow: '#ffeb3b', core: '#fffde7', width: 3.6, jitter: 3.5, seed: 9, segs: 7 }),
    { art: 'burst-thunder', k: 0.5, x: 16.5, y: 23.5 },
  ],
  // ボルテッカー: 電気をまとって突っ込む
  'volt-tackle': [
    lightning([4, 26], [19, 14], { glow: '#fbc02d', core: '#fffde7', width: 2.2, jitter: 2.5, seed: 4, segs: 5 }),
    lightning([7, 18], [19, 14], { glow: '#fff176', core: '#ffffff', width: 1.6, jitter: 2, seed: 8, segs: 4 }),
    lightning([12, 27], [19, 14], { glow: '#fff176', core: '#ffffff', width: 1.6, jitter: 2, seed: 12, segs: 4 }),
    { art: 'burst-thunder', k: 0.62, x: 20.5, y: 12 },
  ],
  // ボルトチェンジ: 敵へ跳んで、戻ってくる稲妻
  'volt-switch': [
    lightning([5, 11], [26, 13], { glow: '#fff176', core: '#ffffff', width: 2.2, jitter: 2.5, seed: 21 }),
    lightning([26, 13], [6, 22], { glow: '#fbc02d', core: '#fffde7', width: 2.2, jitter: 2.5, seed: 33 }),
    { art: 'burst-spark', k: 0.5, x: 26, y: 13 },
  ],
  // こなゆき: ゆっくり流れる粉雪
  'powder-snow': [weather({ colors: ['#ffffff', '#e1f5fe'], count: 22, angle: 10, len: [0, 0.6], size: 0.7, seed: 5 })],
  // ふぶき: 斜めに吹きつける雪
  blizzard: [weather({ colors: ['#ffffff', '#b3e5fc'], count: 34, angle: 38, len: [2, 5], size: 0.55, seed: 6 })],
  // あまごい: 降る雨
  'rain-dance': [weather({ colors: ['#e1f5fe', '#81d4fa'], count: 20, angle: 8, len: [3, 6], size: 0.5, seed: 7 })],
  // すなあらし: 横に吹く砂
  sandstorm: [weather({ colors: ['#e0b47c', '#a87a4a', '#f0d0a0'], count: 46, angle: -84, len: [1, 3.5], size: 0.55, seed: 8 })],
  // ヘビーボンバー: 落ちた所の衝撃
  'heavy-slam': [{ art: 'heavy-slam-quake', frame: 1, k: 0.78, x: 16, y: 16 }],
  // ダブルウイング: 2 回の翼の打ちが交わる
  'dual-wingbeat': [{ art: 'dual-wing-x', frame: 2, k: 0.5, x: 16, y: 16 }],
  // ---- ノーマル ----
  // でんこうせっか: 走り抜ける光の筋
  'quick-attack': [{ art: 'speed-streak', k: 1.3, x: 16, y: 16 }],
  // しんそく: 目にも止まらない速さで、ジグザグに走る筋
  'extreme-speed': [
    { art: 'speed-streak', k: 0.95, x: 12, y: 9 },
    { art: 'speed-streak', k: 0.95, x: 20, y: 16, flip: true },
    { art: 'speed-streak', k: 0.95, x: 12, y: 23 },
  ],
  // スピードスター: 追いかける星
  swift: [
    { art: 'star', k: 0.95, x: 10, y: 11 },
    { art: 'star', k: 1.15, x: 21, y: 13 },
    { art: 'star', k: 0.8, x: 13, y: 23 },
  ],
  // のしかかり: 落ちた所の土けむり
  'body-slam': [{ art: 'slam-crater', frame: 0, k: 0.82, x: 16, y: 16 }],
  // はたく: 手のひらで 1 回
  pound: [{ art: 'palm', k: 1.35, x: 16, y: 16 }],
  // おうふくビンタ: 何度もはたく
  'double-slap': [
    { art: 'palm', k: 1.0, x: 12, y: 10.5 },
    { art: 'palm', k: 1.0, x: 19, y: 21.5, flip: true },
  ],
  // ねこだまし: 両側から手をたたく
  'fake-out': [
    { art: 'palm', k: 0.95, x: 10, y: 16 },
    { art: 'palm', k: 0.95, x: 22, y: 16, flip: true },
  ],
  // あばれる: あちこちへ拳
  thrash: [
    { art: 'fist', k: 0.72, x: 10, y: 11, rot: -150 },
    { art: 'fist', k: 0.72, x: 22, y: 11, rot: -30 },
    { art: 'fist', k: 0.72, x: 16, y: 22, rot: 90 },
  ],
  // とっておき: 虹色の星
  'last-resort': [{ art: 'rainbow-stars', part: 'middle', k: 1.6, x: 16, y: 16 }],
  // ほろびのうた: 暗い音符
  'perish-song': [
    { art: 'perish-note', k: 1.1, x: 10, y: 12, lift: true },
    { art: 'perish-note', k: 1.3, x: 21, y: 10, lift: true },
    { art: 'perish-note', k: 1.0, x: 16, y: 22, lift: true },
  ],
  // なまける: 寝そべって回復の光
  'slack-off': [
    { art: 'heal-rise', k: 0.85, x: 15, y: 18 },
    { art: 'z-letter', k: 0.8, x: 23, y: 8 },
  ],
  // ---- くさ ----
  // はっぱカッター: 回りながら飛ぶ鋭い葉
  'razor-leaf': [
    { art: 'leaf', k: 1.35, x: 10.5, y: 20.5, rot: -20 },
    { art: 'leaf', k: 1.35, x: 21, y: 11, rot: 40 },
  ],
  // マジカルリーフ: まわりを回る葉
  'magical-leaf': [0, 120, 240].map((a) => ({ art: 'leaf', k: 1.05, x: 16 + Math.cos(((a - 90) * Math.PI) / 180) * 8, y: 16 + Math.sin(((a - 90) * Math.PI) / 180) * 8, rot: a })),
  // リーフストーム: うずを巻いて広がる葉
  'leaf-storm': [0, 1, 2, 3, 4, 5].map((i) => ({ art: 'leaf', k: 0.6 + i * 0.1, x: 16 + Math.cos(i * 1.15) * (3 + i * 1.9), y: 16 + Math.sin(i * 1.15) * (3 + i * 1.9), rot: (i * 1.15 * 180) / Math.PI + 90 })),
  // はなびらのまい: 舞う花びら
  'petal-dance': [0, 1, 2, 3, 4].map((i) => ({ art: 'petal', k: 0.85 + i * 0.07, x: 16 + Math.cos(i * 1.3 + 0.5) * (4 + i * 1.8), y: 16 + Math.sin(i * 1.3 + 0.5) * (4 + i * 1.8), rot: i * 70 })),
  // こうごうせい: 葉から立ちのぼる光
  synthesis: [
    { art: 'heal-rise', k: 0.85, x: 16, y: 13 },
    { art: 'leaf', k: 1.1, x: 16, y: 23, rot: -90 },
  ],
  // リーフブレード: 葉の刃で切る
  'leaf-blade': [{ art: 'blade-slash', line: 1, k: 1.1, x: 16, y: 16, rot: -40 }],
  // ---- かくとう ----
  // つっぱり: 続けて突き出す手のひら
  'arm-thrust': [
    { art: 'palm', k: 0.9, x: 13, y: 9 },
    { art: 'palm', k: 0.9, x: 19, y: 16 },
    { art: 'palm', k: 0.9, x: 13, y: 23 },
  ],
  // はっけい: 手のひらから衝撃
  'force-palm': [
    { art: 'kick-impact', k: 0.55, x: 22, y: 16 },
    { art: 'palm', k: 1.15, x: 12, y: 16 },
  ],
  // ばくれつパンチ: 当たって爆発する拳
  'dynamic-punch': [
    { art: 'burst-fire', k: 0.55, x: 22, y: 10 },
    { art: 'fist', k: 0.95, x: 13, y: 19, rot: -40 },
  ],
  // ---- ひこう ----
  // エアカッター: 並んで飛ぶ風の刃
  'air-cutter': [
    { art: 'air-cutter-blade', k: 0.85, x: 11, y: 11 },
    { art: 'air-cutter-blade', k: 0.85, x: 21, y: 21 },
  ],
  // ---- エスパー ----
  // ねんりき: 小さくつかむ念の輪
  confusion: [{ art: 'psy-grip', k: 0.75, x: 16, y: 16 }],
  // みらいよち: 未来を見る目
  'future-sight': [{ art: 'future-eye', k: 1.05, x: 16, y: 16 }],
  // ---- ゴースト・あく ----
  'shadow-ball': [{ art: 'shadow-sphere', frame: 0, k: 1.05, x: 16, y: 16 }],
  'phantom-force': [{ art: 'shadow-pool', k: 1.55, x: 16, y: 16, lift: true }],
  astonish: [
    { art: 'shadow-pool', frame: 0, k: 1.1, x: 16, y: 22, lift: true },
    { art: 'burst-shadow', k: 0.5, x: 16, y: 11 },
  ],
  'sucker-punch': [{ art: 'shadow-ambush', k: 0.8, x: 16, y: 16, lift: true }],
  bite: [{ art: 'fang-front-dark', part: 'front', frame: 0, k: 1.1, x: 16, y: 16.5 }],
  crunch: [{ art: 'dark-jaws', part: 'front', frame: 0, k: 0.9, x: 16, y: 16 }],
  // ---- でんき・どく のキバ ----
  'thunder-fang': [{ art: 'fang-front-electric', part: 'front', frame: 0, k: 1.1, x: 16, y: 16.5 }],
  'poison-fang': [{ art: 'fang-front-poison', part: 'front', frame: 0, k: 1.1, x: 16, y: 16.5 }],
  // スパーク・ワイルドボルト: 体のまわりの電気の輪
  spark: Array.from({ length: 8 }, (_, i) => ({ art: 'electric-ring', part: 'middle', k: 0.75, x: 16 + Math.cos((i * Math.PI) / 4) * 9, y: 16 + Math.sin((i * Math.PI) / 4) * 9, rot: i * 45 + 90 })),
  'wild-charge': [
    ...Array.from({ length: 8 }, (_, i) => ({ art: 'electric-ring', part: 'middle', k: 0.7, x: 13 + Math.cos((i * Math.PI) / 4) * 7.5, y: 19 + Math.sin((i * Math.PI) / 4) * 7.5, rot: i * 45 + 90 })),
    { art: 'speed-streak', k: 0.6, x: 23, y: 8, rot: -40 },
  ],
  // ---- いわ ----
  'rock-blast': [
    { art: 'rock', k: 0.75, x: 10, y: 21 },
    { art: 'rock', k: 0.65, x: 21, y: 22 },
    { art: 'rock', k: 0.9, x: 17, y: 11 },
  ],
  'stealth-rock': [
    { art: 'sharp-rocks', k: 1.2, x: 10, y: 20 },
    { art: 'sharp-rocks', k: 1.4, x: 21, y: 13 },
  ],
  // ---- みず の波 ----
  surf: [
    { art: 'wave-tile', part: 'middle', k: 0.85, x: 7, y: 19 },
    { art: 'wave-tile', part: 'middle', k: 0.85, x: 16, y: 18 },
    { art: 'wave-tile', part: 'middle', k: 0.85, x: 25, y: 19 },
    { art: 'wave-tile', part: 'middle', k: 0.85, x: 11.5, y: 10 },
    { art: 'wave-tile', part: 'middle', k: 0.85, x: 20.5, y: 10 },
  ],
  'muddy-water': [
    { art: 'wave-tile-mud', part: 'middle', k: 0.85, x: 7, y: 19 },
    { art: 'wave-tile-mud', part: 'middle', k: 0.85, x: 16, y: 18 },
    { art: 'wave-tile-mud', part: 'middle', k: 0.85, x: 25, y: 19 },
    { art: 'wave-tile-mud', part: 'middle', k: 0.85, x: 11.5, y: 10 },
    { art: 'wave-tile-mud', part: 'middle', k: 0.85, x: 20.5, y: 10 },
  ],
  // でんじは: 広がる電気の波
  'thunder-wave': [{ art: 'electric-cone', frame: 3, k: 0.85, x: 16, y: 16 }],
  // ドわすれ: 浮かぶ はてな
  amnesia: [{ art: 'amnesia-swirl', frame: 2, k: 0.85, x: 16, y: 16 }],
  // つじぎり: 闇の三日月
  'night-slash': [{ art: 'night-crescent', k: 1.3, x: 16, y: 16, lift: true }],
  // ギガドレイン: 吸い取る緑の玉のつながり
  'giga-drain': [0, 1, 2, 3].map((i) => ({ art: 'drain-line', part: 'end', frame: 1, k: 0.95 + i * 0.18, x: 24 - i * 5.5, y: 8 + i * 5.5 })),
  // ばかぢから: 両腕で押しつぶす
  superpower: [{ art: 'smash-arms', frame: 1, k: 0.5, x: 16, y: 16 }],
  // ローキック: 足払い
  'low-sweep': [{ art: 'low-kick-leg', k: 0.85, x: 16, y: 16, lift: true }],
  // いやしのねがい: 回復の光とハート
  'healing-wish': [
    { art: 'heal-rise', k: 0.85, x: 16, y: 18 },
    { art: 'charm-heart', k: 0.9, x: 16, y: 9 },
  ],
  // ほのおのキバ: 炎をまとったキバが閉じる
  'fire-fang': [{ art: 'fang-front-fire', part: 'front', frame: 0, k: 1.1, x: 16, y: 16.5 }],
  // ひっかく: 爪あと
  scratch: [{ art: 'claw', k: 2.1, x: 16, y: 16 }],
  // つるのムチ: しなるつる
  'vine-whip': [{ art: 'vine-line', line: 2, k: 1.05, x: 16, y: 16, rot: -40 }],
  // ハイドロポンプ: 水の激流
  'hydro-pump': [{ art: 'water-stream', line: 2, k: 0.78, x: 16, y: 16, rot: -40 }],
  // あわ: 大小の泡
  bubble: [
    { art: 'bubble', k: 1.25, x: 12.5, y: 18.5 },
    { art: 'bubble', k: 0.8, x: 22.5, y: 9.5 },
    { art: 'bubble', k: 0.6, x: 23.5, y: 23 },
  ],
  // 10まんボルト: 当たった所で弾ける雷
  thunderbolt: [{ art: 'burst-thunder', k: 1.05, x: 16, y: 16 }],
  // ---- ゲームの中で何も出ない技（07 の266章）: その技で自分に起きる変化を描く ----
  // つるぎのまい: 自分のまわりを回る剣
  'swords-dance': [swordRing(4, 28)],
  // かくばる: 体が角ばる（角ばった結晶と、とがった先の光）
  sharpen: [facetGem(13, 18, 6.5, 10.5, 35), facetGem(22, 10, 3.6, 6, 35), glint(23.5, 21.5, 2.6)],
  // かたくなる: 体の表面が硬い板になる
  harden: [hardShell(16, 16, 12), glint(22.5, 9, 2.8)],
  // まるくなる: 丸まった体
  'defense-curl': [curledBall(16, 16.5, 11.5), glint(24.5, 7.5, 2.4)],
  // てっぺき: 体を囲む鋼の板（ゲームの鋼の輪）と、真ん中の光
  'iron-defense': [{ art: 'steel-armor-ring', frame: 1, k: 0.82, x: 16, y: 16 }, glint(16, 16, 4)],
  // ビルドアップ: 体から立ちのぼる赤いオーラ（ゲームの絵）
  'bulk-up': [{ art: 'bulk-aura', frame: 2, k: 1.05, x: 16, y: 16.5 }],
  // こうそくいどう: 速くなる体と、置いていかれる筋
  agility: [
    { art: 'charge-streak', frame: 1, k: 0.85, x: 14, y: 10 },
    { art: 'charge-streak', frame: 1, k: 0.85, x: 18, y: 22 },
  ],
  // ロックオン: 敵に合わせる照準（ゲームの絵）
  'lock-on': [{ art: 'lock-on-reticle', frame: 1, k: 0.86, x: 16, y: 16 }],
  // テクスチャー: 体の色（タイプ）が移り変わる
  conversion: [typeTiles(['#ff7043', '#42a5f5', '#66bb6a', '#ffee58', '#f5f5f5', '#f06292', '#80deea', '#ab47bc', '#d4a056'])],
  // ちかい: 属性の粒が自分のまわりを回る（ほかの ちかい と合わせて強くなる）
  'fire-pledge': [...ringOf('ember', 6, 9, 0.75), { art: 'fire-blast-ball', k: 0.32, x: 16, y: 16 }],
  'grass-pledge': [...ringOf('leaf', 6, 9, 0.95), { art: 'seed-bomb', frame: 0, k: 0.6, x: 16, y: 16 }],
  'water-pledge': [...ringOf('water-drop', 6, 9, 0.8), { art: 'bubble', k: 0.75, x: 16, y: 16 }],
  // ものまね: 同じ技の絵と、それをまねた写し
  mimic: [
    { art: 'star', k: 1.05, x: 10.5, y: 12 },
    { art: 'star', k: 1.05, x: 21.5, y: 20, tint: 0.55 },
  ],
  // ゆびをふる: 何が出るか分からない、いろいろな技の絵
  metronome: [
    { art: 'ember', k: 1.15, x: 16, y: 9.5, rot: -90 },
    { art: 'water-drop', k: 1.15, x: 9, y: 21.5, rot: -90 },
    { art: 'leaf', k: 1.4, x: 22.5, y: 21.5, rot: -60 },
  ],
  // ネコにこばん: 弧を描いて飛ぶ小判
  'pay-day': [koban(8.5, 22, 2.6, 3.6), koban(15.5, 13.5, 3.2, 4.4), koban(23.5, 19.5, 3.8, 5.2), glint(13, 6.5, 2.2), glint(26, 9.5, 2)],
  // ねむる: 立ちのぼる Z と、回復の光
  rest: [
    { art: 'heal-rise', frame: 2, k: 0.6, x: 22, y: 23 },
    { art: 'snore-z', frame: 0, k: 0.62, x: 9.5, y: 22.5 },
    { art: 'snore-z', frame: 0, k: 0.82, x: 15.5, y: 15.5 },
    { art: 'snore-z', frame: 0, k: 1.05, x: 22.5, y: 8 },
  ],
};

type Grid = { w: number; h: number; px: (string | null)[] };

/** 黒に近い色を、色合いを残して明るくする（明るさ 0.24 ぐらいまで） */
function liftColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const l = Math.max(0.01, (0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!) / 255);
  const k = Math.min(6, 0.24 / l);
  return '#' + c.map((v) => Math.min(255, Math.round(v * k + 18)).toString(16).padStart(2, '0')).join('');
}

/** 黒に近い色（ゲームの絵のふちの暗い色）。アイコンでは黒の輪郭線を使わない（作者の決まり 2026年11月15日）ので描かない */
function nearBlack(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const l = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return l < 0.2;
}

/** 技の絵の 1 コマを、色のマス（hex か null）にする */
function artGrid(l: ArtLayer): Grid {
  const sp = drawMoveArt(l.art, l.k);
  if (!sp) throw new Error(`技の絵 ${l.art} がありません`);
  const pick = (part: string): string[] => {
    const frames = sp.parts[part];
    if (!frames) throw new Error(`技の絵 ${l.art} に部品 ${part} がありません（${Object.keys(sp.parts).join(', ')}）`);
    return frames[l.frame ?? Math.floor(frames.length / 2)] ?? frames[0]!;
  };
  const pieces: string[][] = l.line !== undefined ? [pick('start'), ...Array.from({ length: l.line }, () => pick('middle')), pick('end')] : [pick(l.part ?? 'main')];
  const h = Math.max(...pieces.map((p) => p.length));
  const w = pieces.reduce((a, p) => a + (p[0]?.length ?? 0), 0);
  const px: (string | null)[] = Array(w * h).fill(null);
  let ox = 0;
  for (const p of pieces) {
    const pw = p[0]?.length ?? 0;
    const oy = Math.floor((h - p.length) / 2);
    p.forEach((row, y) => [...row].forEach((ch, x) => {
      const c = ch === '.' ? undefined : sp.palette[parseInt(ch, 36)];
      if (c) {
        const put = (v: string): void => {
          px[(oy + y) * w + ox + x] = l.tint ? mixHex(v, '#ffffff', l.tint) : v;
        };
        if (!nearBlack(c) || l.keepDark) put(c);
        else if (l.lift) put(liftColor(c));
      }
    }));
    ox += pw;
  }
  return { w, h, px };
}

/** アイコンを描く: 絵を順に重ねる（回すときはゲームと同じく近いマスを取る） */
function drawIcon(layers: Layer[]): (string | null)[] {
  const out: (string | null)[] = Array(N * N).fill(null);
  for (const l of layers) {
    if ('draw' in l) {
      l.draw(out);
      continue;
    }
    const g = artGrid(l);
    const a = ((l.rot ?? 0) * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (let y = 2; y < N - 2; y++) {
      for (let x = 2; x < N - 2; x++) {
        const dx = x + 0.5 - l.x;
        const dy = y + 0.5 - l.y;
        // 逆に回して絵の中の位置へ
        let u = dx * c + dy * s + g.w / 2;
        const v = -dx * s + dy * c + g.h / 2;
        if (l.flip) u = g.w - u;
        const sx = Math.floor(u);
        const sy = Math.floor(v);
        if (sx < 0 || sy < 0 || sx >= g.w || sy >= g.h) continue;
        const col = g.px[sy * g.w + sx];
        if (col) out[y * N + x] = col;
      }
    }
  }
  return out;
}

function toArt(px: (string | null)[]): { palette: string[]; rows: string[] } {
  const palette: string[] = [];
  const rows: string[] = [];
  for (let y = 0; y < N; y++) {
    let row = '';
    for (let x = 0; x < N; x++) {
      const c = px[y * N + x];
      if (!c) {
        row += '.';
        continue;
      }
      let i = palette.indexOf(c);
      if (i === -1) {
        i = palette.length;
        palette.push(c);
      }
      row += i.toString(36);
    }
    rows.push(row);
  }
  if (palette.length > 36) throw new Error('色が 36 を超えました');
  return { palette, rows };
}

const read = (p: string): unknown => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const moves = (read('data/game/moves.json') as { moves: Record<string, { pattern: string; effect: string; nameOf?: string }> }).moves;
const recipes = (read('data/effects/recipes.json') as { recipes: Record<string, Record<string, unknown>> }).recipes;
const genMoves = read('data/generated/moves.json') as Record<string, { type: string; names: { ja: string } }>;

/** レシピの中の技の絵の名前（sprite・strike・効き方の絵 など。書いてある順） */
function recipeArts(o: unknown, acc: string[] = []): string[] {
  if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) {
      if (k === 'id' && typeof v === 'string') acc.push(v);
      else recipeArts(v, acc);
    }
  }
  return acc;
}

/**
 * ICONS に無い技: ゲームの中で技が出す絵（レシピの sprite、無ければ strike・効き方の絵）を 1 つ、アイコンいっぱいに置く。
 * 横に長い絵（線・扇・流れ）は斜めに置いて長さを使う
 */
function autoLayers(keys: string[]): Layer[] | null {
  for (const key of keys) {
    const rc = recipes[moves[key]!.effect];
    if (!rc) continue;
    const sprite = rc.sprite as { id?: string } | undefined;
    const strike = rc.strike as { id?: string } | undefined;
    const id = sprite?.id ?? strike?.id ?? recipeArts(rc)[0];
    const sp = id ? drawMoveArt(id, 1) : null;
    if (!id || !sp) continue;
    const mid = (part: string): string[] => sp.parts[part]![Math.floor(sp.parts[part]!.length / 2)]!;
    if (sp.parts.main) {
      const fr = mid('main');
      const w = fr[0]!.length;
      const h = fr.length;
      if (w / h >= 1.6) return [{ art: id, k: Math.min(31 / w, 13 / h), x: 16, y: 16, rot: -40 }];
      return [{ art: id, k: 25 / Math.max(w, h), x: 16, y: 16 }];
    }
    if (sp.parts.start && sp.parts.middle && sp.parts.end) {
      const w = mid('start')[0]!.length + mid('middle')[0]!.length * 2 + mid('end')[0]!.length;
      const h = Math.max(mid('start').length, mid('middle').length, mid('end').length);
      return [{ art: id, line: 2, k: Math.min(31 / w, 13 / h), x: 16, y: 16, rot: -40 }];
    }
  }
  return null;
}

// 技の名前ごと（同じ名前 nameOf の技はまとめて 1 枚）
const byName = new Map<string, string[]>();
for (const [k, m] of Object.entries(moves)) {
  const n = m.nameOf ?? k;
  byName.set(n, [...(byName.get(n) ?? []), k]);
}
const out: Record<string, { palette: string[]; rows: string[] }> = {};
const missing: string[] = [];
const auto: string[] = [];
for (const [name, keys] of byName) {
  const own = ICONS[name];
  const layers = own ?? autoLayers([...keys].sort((a, b) => (a === name ? -1 : b === name ? 1 : 0)));
  if (!layers) {
    missing.push(name);
    continue;
  }
  if (!own) auto.push(name);
  out[name] = toArt(drawIcon(layers));
}
for (const key of Object.keys(ICONS)) if (!byName.has(key)) throw new Error(`技の名前 ${key} が data/game/moves.json にありません`);
const ja = (n: string): string => `${genMoves[n]?.names.ja ?? n}(${n})`;
if (process.argv.includes('--auto')) console.log(`レシピの絵を 1 つ置いただけの技（${auto.length}）: ${auto.map(ja).join(' ')}`);
if (missing.length) {
  // 技を足したときに、アイコンを作り忘れないように止める（docs/09 の「技のアイコン」）
  console.error(
    `アイコンの絵が無い技: ${missing.map(ja).join(' ')}\n` +
      '  ゲームの中で何も出ない技（いつも効く技 など）は、自動では作れません。ICONS に、その技で起きること（自分に起きる変化）を描いてください（docs/09 の「技のアイコン」）。',
  );
  process.exitCode = 1;
}
const file = path.join(ROOT, 'data/render/move-icons.json');
fs.writeFileSync(file, JSON.stringify({ credit: '自作（scripts/make-move-icons.ts が src/render/moveArt.ts の技の絵から作る）', size: N, icons: out }, null, 2) + '\n');
console.log(`${Object.keys(out).length} 個の絵を ${path.relative(ROOT, file)} に書きました`);

// 確認用の画像（選んだ技だけ）: --pick 技,技,… <ファイル> で、4 倍で 8 列に並べる（足した技を見るとき）
const pickAt = process.argv.indexOf('--pick');
if (pickAt !== -1) {
  const icons = read('data/render/icons.json') as Parameters<typeof iconPixels>[0];
  const names = (process.argv[pickAt + 1] ?? '').split(',').filter(Boolean);
  for (const n of names) if (!out[n]) throw new Error(`技の名前 ${n} のアイコンがありません`);
  const S = 4;
  const cols = Math.min(8, names.length);
  const cell = N * S + 12;
  const png = new PNG({ width: cols * cell + 12, height: Math.ceil(names.length / cols) * cell + 12 });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([42, 44, 56, 255], i);
  names.forEach((n, i) => {
    const px = iconPixels(icons, 'nearest', icons.typeColors[genMoves[n]?.type ?? 'normal'] ?? '#888888', 'base', out[n]);
    const ox = 12 + (i % cols) * cell;
    const oy = 12 + Math.floor(i / cols) * cell;
    for (let y = 0; y < N * S; y++) for (let x = 0; x < N * S; x++) {
      const si = (Math.floor(y / S) * N + Math.floor(x / S)) * 4;
      if (px[si + 3]) png.data.set([px[si]!, px[si + 1]!, px[si + 2]!, 255], ((oy + y) * png.width + ox + x) * 4);
    }
  });
  const dest = path.resolve(process.argv[pickAt + 2] ?? 'move-icons-pick.png');
  fs.writeFileSync(dest, PNG.sync.write(png));
  console.log(`確認用の画像: ${dest}（${names.map((n, i) => `${i + 1}.${ja(n)}`).join(' ')}）`);
}

// 確認用の画像（タイプごと）: --sheet <フォルダ> で、新しいアイコンを 3 倍で 8 列に並べる（並びは名前の順に出す）
const sheetAt = process.argv.indexOf('--sheet');
if (sheetAt !== -1) {
  const icons = read('data/render/icons.json') as Parameters<typeof iconPixels>[0];
  const dir = path.resolve(process.argv[sheetAt + 1] ?? 'move-icon-sheets');
  fs.mkdirSync(dir, { recursive: true });
  const byType = new Map<string, string[]>();
  for (const name of Object.keys(out)) {
    const t = genMoves[name]?.type ?? 'normal';
    byType.set(t, [...(byType.get(t) ?? []), name]);
  }
  for (const [type, names] of byType) {
    const cols = 8;
    const cell = 96 + 8;
    const png = new PNG({ width: cols * cell + 8, height: Math.ceil(names.length / cols) * cell + 8 });
    for (let i = 0; i < png.data.length; i += 4) png.data.set([42, 44, 56, 255], i);
    names.forEach((n, i) => {
      const px = iconPixels(icons, 'nearest', icons.typeColors[type] ?? '#888888', 'base', out[n]);
      const ox = 8 + (i % cols) * cell;
      const oy = 8 + Math.floor(i / cols) * cell;
      for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
        const si = (Math.floor(y / 3) * N + Math.floor(x / 3)) * 4;
        if (px[si + 3]) png.data.set([px[si]!, px[si + 1]!, px[si + 2]!, 255], ((oy + y) * png.width + ox + x) * 4);
      }
    });
    fs.writeFileSync(path.join(dir, `${type}.png`), PNG.sync.write(png));
    console.log(`${type}: ${names.map((n, i) => `${i + 1}.${genMoves[n]?.names.ja ?? n}`).join(' ')}`);
  }
}

// 確認用の画像: 1 行に 1 技（前の絵 ×3・新しい絵 ×3・新しい絵の 1 倍と 2 倍）
const previewAt = process.argv.indexOf('--preview');
if (previewAt !== -1) {
  const icons = read('data/render/icons.json') as Parameters<typeof iconPixels>[0];
  const gen = read('data/generated/moves.json') as Record<string, { type: string }>;
  const der = read('data/game/derivations.json') as { derivations: { to: string }[]; unique: { to: string }[] };
  const tierOf = (k: string): IconTier => (der.unique.some((d) => d.to === k) ? 'unique' : der.derivations.some((d) => d.to === k) ? 'derived' : 'base');
  const keys = Object.keys(out);
  const cols = 2;
  const cellW = 96 + 8 + 96 + 8 + 32 + 8 + 64 + 24;
  const cellH = 96 + 8;
  const png = new PNG({ width: cols * cellW + 8, height: Math.ceil(keys.length / cols) * cellH + 8 });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([42, 44, 56, 255], i);
  const blit = (px: Uint8ClampedArray, ox: number, oy: number, s: number): void => {
    for (let y = 0; y < N * s; y++) {
      for (let x = 0; x < N * s; x++) {
        const si = (Math.floor(y / s) * N + Math.floor(x / s)) * 4;
        if (!px[si + 3]) continue;
        png.data.set([px[si]!, px[si + 1]!, px[si + 2]!, 255], ((oy + y) * png.width + ox + x) * 4);
      }
    }
  };
  keys.forEach((k, i) => {
    const color = icons.typeColors[gen[k]?.type ?? 'normal'] ?? '#888888';
    const glyph = icons.moveGlyphs[k] ?? icons.moves[moves[byName.get(k)![0]!]!.pattern] ?? 'nearest';
    const ox = 8 + (i % cols) * cellW;
    const oy = 8 + Math.floor(i / cols) * cellH;
    blit(iconPixels(icons, glyph, color, tierOf(k)), ox, oy, 3);
    const neu = iconPixels(icons, glyph, color, tierOf(k), out[k]);
    blit(neu, ox + 104, oy, 3);
    blit(neu, ox + 208, oy + 32, 1);
    blit(neu, ox + 248, oy + 16, 2);
  });
  const dest = path.resolve(process.argv[previewAt + 1] ?? 'move-icons-preview.png');
  fs.writeFileSync(dest, PNG.sync.write(png));
  console.log(`確認用の画像: ${dest}（${keys.join(', ')}）`);
}
